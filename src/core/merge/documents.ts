import type {
  Attachment,
  CatalogItem,
  CatalogItemKind,
  Cell,
  ChangeRequest,
  CompatibilityRule,
  DocEvent,
  DocumentMeta,
  ImportProfile,
  Matrix,
  MatrixVersion,
  PolicyComponent,
  PolicyOpsDocument,
  Project,
  Release,
  Template,
  Variable,
} from '../document/schema';
import { CURRENT_SCHEMA_VERSION } from '../document/schema';
import type {
  MergeAction,
  MergeActionKind,
  MergeChoice,
  MergeConflict,
  MergeConflictOption,
  MergeEntityKind,
  MergeEntityRef,
  MergeFieldDiff,
  MergeOptions,
  MergeResolution,
  MergeResolutions,
  MergeResult,
  MergeSide,
} from './types';

/**
 * Merge de documentos — docs/06-persistencia-e-concorrencia.md §7.
 *
 * Duas pessoas abriram o mesmo arquivo do SharePoint e as duas salvaram. Este
 * módulo decide o que sobrevive. **Errar aqui apaga o trabalho de alguém em
 * silêncio**, e por isso três regras guiam cada linha daqui:
 *
 * 1. **Nenhuma versão publicada se perde, em nenhum cenário.** Publicada é
 *    imutável; no pior caso ela é renumerada e sinalizada, nunca descartada.
 * 2. **O resultado é sempre um documento válido** (`validateDocument` sem
 *    erros). Quando a união crua feriria uma invariante — duas publicadas na
 *    mesma matriz, dois rascunhos, dois códigos iguais —, o merge normaliza de
 *    forma explícita e registra o que fez.
 * 3. **Nada é mesclado sem o usuário ver.** Tudo que é automático sai em
 *    `applied`; o que precisa de decisão sai em `conflicts`. A função é total:
 *    sem resoluções, cada conflito usa o `defaultChoice` — a tela é que troca
 *    as escolhas e recalcula.
 *
 * O que torna isso tratável é o modelo: versões publicadas são imutáveis, ids
 * são estáveis, e quase tudo é append-only. A união resolve a maior parte.
 *
 * **Sobre a linha "mesmo item, um lado inalterado — vence o lado alterado"**:
 * sem o ancestral comum em mãos, "inalterado" não se lê do conteúdo. Duas
 * evidências resolvem, nesta ordem:
 * - *estrutural*: se um lado só acrescentou (versões novas) e o resto é
 *   idêntico, não há divergência nenhuma — a união já é a resposta;
 * - *auditoria*: `events` é append-only e carimba quem mexeu em quê. Um evento
 *   que existe só de um lado e aponta para a entidade **é** a prova de que
 *   aquele lado a alterou. Se só um lado tem essa prova, ele vence, e a
 *   aplicação aparece na lista que o usuário revisa antes de confirmar.
 * Sem nenhuma das duas, vira conflito — que é o comportamento seguro.
 */

// ---------------------------------------------------------------------------
// Utilidades puras
// ---------------------------------------------------------------------------
// #region: utilidades-puras

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortDeep(source[key]);
    return out;
  }
  return value;
}

/**
 * Chave canônica de comparação: JSON com as chaves ordenadas. Os dois lados
 * chegam por caminhos diferentes (um do Immer, outro de `JSON.parse`), então
 * comparar por ordem de inserção acusaria diferença onde não há.
 */
function keyOf(value: unknown): string {
  if (value === undefined) return ' undefined';
  return JSON.stringify(sortDeep(value)) ?? ' undefined';
}

function same(a: unknown, b: unknown): boolean {
  return keyOf(a) === keyOf(b);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * Ordem de uma coleção sem `position`: `createdAt` (docs/03 §1), e **só**
 * `createdAt`. O `sort` do JavaScript é estável, então itens criados no mesmo
 * instante mantêm a ordem em que estavam — mesclar um documento com ele mesmo
 * devolve o arquivo idêntico, byte a byte, e o histórico do SharePoint não
 * enche de reordenações inventadas.
 */
function byCreatedAt<T extends { createdAt: string }>(a: T, b: T): number {
  return a.createdAt.localeCompare(b.createdAt);
}

/** Desempate total, para as coleções em que `position` manda. */
function byCreatedAtThenId<T extends { createdAt: string; id: string }>(a: T, b: T): number {
  return byCreatedAt(a, b) || a.id.localeCompare(b.id);
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * Id derivado, determinístico, no formato `nanoid(12)`.
 *
 * O merge é puro: não recebe gerador de ids. Quando "manter os dois" precisa
 * de um id novo (o perdedor de um rascunho divergente entra como cópia
 * arquivada), ele é derivado do id de origem — mesma entrada, mesmo id, o que
 * mantém o merge reprodutível e comparável entre execuções.
 */
function derivedId(seed: string, taken: Set<string>): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let hash = 0x811c9dc5;
    let out = '';
    for (let position = 0; position < 12; position++) {
      const chunk = `${seed}#${attempt}:${position}`;
      for (let i = 0; i < chunk.length; i++) {
        hash ^= chunk.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      out += ID_ALPHABET[hash % ID_ALPHABET.length];
    }
    if (!taken.has(out)) {
      taken.add(out);
      return out;
    }
  }
  /* c8 ignore next 2 -- mil colisões seguidas de um hash de 12 caracteres não acontece */
  throw new Error('Não foi possível derivar um id livre para o merge.');
}

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------
// #region: contexto

type EventMatcher = (event: DocEvent) => boolean;

type MergeCtx = {
  mine: PolicyOpsDocument;
  theirs: PolicyOpsDocument;
  resolutions: MergeResolutions;
  at: string;
  actions: MergeAction[];
  conflicts: MergeConflict[];
  /** Eventos exclusivos de cada lado — a prova de quem alterou o quê. */
  mineOnlyEvents: DocEvent[];
  theirsOnlyEvents: DocEvent[];
  /** Todo id de versão já visto ou derivado — o que garante id derivado livre. */
  usedIds: Set<string>;
  /** De qual lado veio cada versão de matriz e cada template do resultado. */
  provenance: Map<string, MergeSide | 'BOTH'>;
};

function otherSide(side: MergeSide): MergeSide {
  return side === 'MINE' ? 'THEIRS' : 'MINE';
}

function pick<T>(side: MergeSide, mine: T, theirs: T): T {
  return side === 'MINE' ? mine : theirs;
}

function sideLabel(side: MergeSide): string {
  return side === 'MINE' ? 'o seu documento' : 'o arquivo';
}

function addAction(
  ctx: MergeCtx,
  action: Omit<MergeAction, 'needsReview'> & { needsReview?: boolean },
): void {
  ctx.actions.push(action);
}

/** O lado que tem prova de auditoria de ter mexido nesta entidade — se só um tiver. */
function changedSideByAudit(ctx: MergeCtx, matcher: EventMatcher): MergeSide | null {
  const inMine = ctx.mineOnlyEvents.some(matcher);
  const inTheirs = ctx.theirsOnlyEvents.some(matcher);
  if (inMine && !inTheirs) return 'MINE';
  if (inTheirs && !inMine) return 'THEIRS';
  return null;
}

function scopeMatcher(field: keyof DocEvent['scope'], id: string): EventMatcher {
  return (event) => event.scope[field] === id;
}

function catalogMatcher(item: CatalogItem): EventMatcher {
  return (event) => {
    if (event.type !== 'CATALOG_CHANGED') return false;
    const payload = event.payload as { kind?: unknown; code?: unknown } | undefined;
    return payload?.kind === item.kind && payload?.code === item.code;
  };
}

// ---------------------------------------------------------------------------
// Diferença campo a campo
// ---------------------------------------------------------------------------
// #region: diferenca-campo-a-campo

const FIELD_LABEL: Record<string, string> = {
  allow: 'Mapa de compatibilidade',
  appVersion: 'Versão do aplicativo',
  archivedAt: 'Arquivado em',
  axes: 'Eixos',
  childVariableId: 'Variável filha',
  code: 'Código',
  color: 'Cor',
  createdAt: 'Criado em',
  createdBy: 'Criado por',
  defaults: 'Preenchimento padrão',
  description: 'Descrição',
  domains: 'Domínios',
  kind: 'Tipo de item',
  label: 'Rótulo',
  name: 'Nome',
  notes: 'Notas',
  numericValue: 'Valor',
  parentVariableId: 'Variável pai',
  position: 'Posição',
  projectId: 'Projeto',
  savedAt: 'Salvo em',
  savedBy: 'Salvo por',
  seedRules: 'Regras de preenchimento',
  shortLabel: 'Rótulo curto',
  type: 'Tipo',
};

/**
 * Campos que podem ser escolhidos **campo a campo** (§7, itens de biblioteca).
 * Fora desta lista estão os estruturais — código, tipo, posição, eixos —, que
 * seguem a escolha do item inteiro: misturar o tipo de um lado com os domínios
 * do outro montaria um item incoerente.
 */
const CHOOSABLE_FIELDS = new Set([
  'archivedAt',
  'color',
  'description',
  'label',
  'name',
  'notes',
  'numericValue',
  'shortLabel',
]);

function fieldLabel(key: string): string {
  return FIELD_LABEL[key] ?? key;
}

function formatFieldValue(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  const text = JSON.stringify(sortDeep(value)) ?? '—';
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

function scalarFieldDiffs<T extends object>(mine: T, theirs: T, skip: string[]): MergeFieldDiff[] {
  const keys = [
    ...new Set([...Object.keys(mine), ...Object.keys(theirs)]),
  ]
    .filter((key) => key !== 'id' && !skip.includes(key))
    .sort();

  const diffs: MergeFieldDiff[] = [];
  for (const key of keys) {
    const mineValue = (mine as Record<string, unknown>)[key];
    const theirsValue = (theirs as Record<string, unknown>)[key];
    if (same(mineValue, theirsValue)) continue;
    diffs.push({
      key,
      label: fieldLabel(key),
      mine: formatFieldValue(mineValue),
      theirs: formatFieldValue(theirsValue),
      choosable: CHOOSABLE_FIELDS.has(key),
    });
  }
  return diffs;
}

type Resolved = {
  choice: MergeChoice;
  base: MergeSide;
  sideFor: (key: string) => MergeSide;
};

function resolvedFrom(resolution: MergeResolution): Resolved {
  const base: MergeSide = resolution.choice === 'THEIRS' ? 'THEIRS' : 'MINE';
  return {
    choice: resolution.choice,
    base,
    sideFor: (key) => resolution.fields?.[key] ?? base,
  };
}

/** Monta o item aplicando a escolha do item e as sobreposições campo a campo. */
function assemble<T extends object>(
  mine: T,
  theirs: T,
  fields: MergeFieldDiff[],
  resolved: Resolved,
): T {
  const result = clone(pick(resolved.base, mine, theirs)) as Record<string, unknown>;
  for (const field of fields) {
    if (!field.choosable) continue;
    const source = pick(resolved.sideFor(field.key), mine, theirs) as Record<string, unknown>;
    const value = source[field.key];
    if (value === undefined) delete result[field.key];
    else result[field.key] = clone(value);
  }
  return result as T;
}

// ---------------------------------------------------------------------------
// Conflitos
// ---------------------------------------------------------------------------
// #region: conflitos

const MINE_WINS_OPTION: MergeConflictOption = {
  choice: 'MINE',
  label: 'Manter o meu',
  detail: 'O conteúdo do arquivo é descartado neste ponto.',
};

const THEIRS_WINS_OPTION: MergeConflictOption = {
  choice: 'THEIRS',
  label: 'Usar o do arquivo',
  detail: 'O seu conteúdo é descartado neste ponto.',
};

function registerConflict(ctx: MergeCtx, conflict: MergeConflict): Resolved {
  ctx.conflicts.push(conflict);
  return resolvedFrom(ctx.resolutions[conflict.id] ?? { choice: conflict.defaultChoice });
}

// ---------------------------------------------------------------------------
// Coleções simples: catálogo, projetos, templates
// ---------------------------------------------------------------------------
// #region: colecoes-simples-catalogo-projetos-templates

type ItemSpec<T> = {
  entityKind: MergeEntityKind;
  actionKind: MergeActionKind;
  /** "A variável", "O item de catálogo" — entra nas frases prontas. */
  noun: string;
  label: (item: T) => string;
  matcher: (item: T) => EventMatcher;
  skip?: string[];
};

function entityRef<T extends { id: string }>(spec: ItemSpec<T>, item: T): MergeEntityRef {
  return { kind: spec.entityKind, id: item.id, label: spec.label(item) };
}

/**
 * O par de um item presente nos dois lados. Devolve o item resolvido; empilha
 * ação ou conflito conforme o caso.
 *
 * `extraFields` e `assembleExtra` existem para os itens com `versions`: a
 * união das versões é feita fora, e as versões que divergem entram como
 * pseudocampos (`versions.<id>`) na mesma tabela campo a campo.
 */
function mergePair<T extends { id: string }>(
  ctx: MergeCtx,
  spec: ItemSpec<T>,
  mine: T,
  theirs: T,
  extraFields: MergeFieldDiff[] = [],
  assembleExtra?: (item: T, resolved: Resolved) => T,
): T {
  const fields = [...scalarFieldDiffs(mine, theirs, spec.skip ?? []), ...extraFields];
  const finish = (resolved: Resolved): T => {
    const item = assemble(mine, theirs, fields, resolved);
    return assembleExtra === undefined ? item : assembleExtra(item, resolved);
  };

  if (fields.length === 0) {
    return finish({ choice: 'MINE', base: 'MINE', sideFor: () => 'MINE' });
  }

  const audit = changedSideByAudit(ctx, spec.matcher(mine));
  if (audit !== null) {
    addAction(ctx, {
      kind: 'CHANGED_SIDE_WINS',
      side: audit,
      entity: entityRef(spec, mine),
      summary: `${spec.noun} "${spec.label(mine)}" foi alterado só em ${sideLabel(audit)} — o histórico prova que ${sideLabel(otherSide(audit))} não mexeu nele. Vence o lado alterado.`,
    });
    return finish({ choice: audit, base: audit, sideFor: () => audit });
  }

  const resolved = registerConflict(ctx, {
    id: `ITEM_DIVERGED:${spec.entityKind}:${mine.id}`,
    kind: 'ITEM_DIVERGED',
    entity: entityRef(spec, mine),
    title: `${spec.noun} "${spec.label(mine)}" foi editado dos dois lados`,
    summary: `${fields.length} campo(s) diferem. Escolha um lado, ou resolva campo a campo.`,
    options: [MINE_WINS_OPTION, THEIRS_WINS_OPTION],
    defaultChoice: 'MINE',
    fields,
    preview: { kind: 'FIELDS' },
  });
  return finish(resolved);
}

function mergeFlatCollection<T extends { id: string; createdAt: string }>(
  ctx: MergeCtx,
  mine: T[],
  theirs: T[],
  spec: ItemSpec<T>,
): T[] {
  const mineById = byId(mine);
  const theirsById = byId(theirs);
  const out: T[] = [];

  const union = (item: T, side: MergeSide): void => {
    out.push(clone(item));
    ctx.provenance.set(item.id, side);
    addAction(ctx, {
      kind: spec.actionKind,
      side,
      entity: entityRef(spec, item),
      summary: `${spec.noun} "${spec.label(item)}" existe só em ${sideLabel(side)} e entra por união.`,
    });
  };

  for (const item of mine) {
    const counterpart = theirsById.get(item.id);
    if (counterpart === undefined) {
      union(item, 'MINE');
      continue;
    }
    ctx.provenance.set(item.id, 'BOTH');
    out.push(mergePair(ctx, spec, item, counterpart));
  }
  for (const item of theirs) {
    if (!mineById.has(item.id)) union(item, 'THEIRS');
  }

  return out.sort(byCreatedAt);
}

// ---------------------------------------------------------------------------
// Bibliotecas versionadas: variáveis e regras de compatibilidade
// ---------------------------------------------------------------------------
// #region: bibliotecas-versionadas-variaveis-e-regras-de-compatibilidade

type LibraryVersion = {
  id: string;
  number: number;
  state: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
  createdAt: string;
  publishedAt?: string;
};

const LIBRARY_STATE_LABEL: Record<LibraryVersion['state'], string> = {
  DRAFT: 'rascunho',
  PUBLISHED: 'publicada',
  SUPERSEDED: 'substituída',
};

function libraryVersionSummary(version: LibraryVersion): string {
  return `versão ${version.number} (${LIBRARY_STATE_LABEL[version.state]})`;
}

/**
 * União das versões de um item de biblioteca. Versão que existe só de um lado
 * entra sempre — a lista é append-only. Versão com o mesmo id e conteúdo
 * diferente vira um pseudocampo `versions.<id>` na tabela campo a campo.
 */
function libraryVersionFields<V extends LibraryVersion>(mine: V[], theirs: V[]): MergeFieldDiff[] {
  const theirsById = byId(theirs);
  const fields: MergeFieldDiff[] = [];
  for (const version of mine) {
    const counterpart = theirsById.get(version.id);
    if (counterpart === undefined || same(version, counterpart)) continue;
    fields.push({
      key: `versions.${version.id}`,
      label: `Versão ${version.number}`,
      mine: libraryVersionSummary(version),
      theirs: libraryVersionSummary(counterpart),
      choosable: true,
    });
  }
  return fields;
}

function unionLibraryVersions<V extends LibraryVersion>(
  mine: V[],
  theirs: V[],
  resolved: Resolved,
): V[] {
  const mineById = byId(mine);
  const theirsById = byId(theirs);
  const out: V[] = [];
  for (const version of mine) {
    const counterpart = theirsById.get(version.id);
    if (counterpart === undefined || same(version, counterpart)) {
      out.push(clone(version));
      continue;
    }
    out.push(clone(pick(resolved.sideFor(`versions.${version.id}`), version, counterpart)));
  }
  for (const version of theirs) {
    if (!mineById.has(version.id)) out.push(clone(version));
  }
  return out.sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
}

/**
 * Normaliza a lista de versões de um item de biblioteca depois da união:
 * I11 (no máximo uma DRAFT e uma PUBLISHED) e números sem repetição.
 *
 * Duas publicadas independentes não podem ser descartadas — publicada é
 * imutável. A mais recente fica vigente e a outra vira `SUPERSEDED`,
 * sinalizada para revisão. Dois rascunhos independentes ferem I11 e não têm
 * como coexistir: viram conflito, decidido pelo usuário.
 */
function normalizeLibraryVersions<V extends LibraryVersion>(
  ctx: MergeCtx,
  versions: V[],
  entity: MergeEntityRef,
  noun: string,
  itemLabel: string,
  sideOf: (version: V) => MergeSide | 'BOTH',
): V[] {
  let out = versions.map(clone);

  const drafts = out.filter((version) => version.state === 'DRAFT');
  if (drafts.length > 1) {
    const mineDraft = drafts.find((version) => sideOf(version) === 'MINE') ?? drafts[0]!;
    const theirsDraft = drafts.find((version) => version.id !== mineDraft.id)!;
    const resolved = registerConflict(ctx, {
      id: `ITEM_DIVERGED:${entity.kind}:${entity.id}:DRAFTS`,
      kind: 'ITEM_DIVERGED',
      entity,
      title: `${noun} "${itemLabel}" ganhou um rascunho de cada lado`,
      summary:
        'Só pode haver um rascunho por item de biblioteca (I11). O rascunho não escolhido é descartado.',
      options: [MINE_WINS_OPTION, THEIRS_WINS_OPTION],
      defaultChoice: 'MINE',
      fields: [
        {
          key: 'draft',
          label: 'Rascunho',
          mine: libraryVersionSummary(mineDraft),
          theirs: libraryVersionSummary(theirsDraft),
          choosable: false,
        },
      ],
      preview: { kind: 'FIELDS' },
    });
    const winner = resolved.base === 'MINE' ? mineDraft : theirsDraft;
    out = out.filter((version) => version.state !== 'DRAFT' || version.id === winner.id);
  }

  const published = out.filter((version) => version.state === 'PUBLISHED');
  if (published.length > 1) {
    const ordered = [...published].sort(
      (a, b) =>
        (a.publishedAt ?? a.createdAt).localeCompare(b.publishedAt ?? b.createdAt) ||
        a.id.localeCompare(b.id),
    );
    const current = ordered[ordered.length - 1]!;
    for (const version of ordered) {
      if (version.id === current.id) continue;
      const target = out.find((candidate) => candidate.id === version.id)!;
      target.state = 'SUPERSEDED';
      addAction(ctx, {
        kind: 'LIFECYCLE_ADVANCED',
        side: sideOf(version) === 'BOTH' ? 'BOTH' : sideOf(version),
        entity,
        summary: `${noun} "${itemLabel}" foi publicado dos dois lados. A versão ${current.number} fica vigente e a versão ${version.number} passa a substituída — nada foi descartado.`,
        needsReview: true,
      });
    }
  }

  const usedNumbers = new Set<number>();
  let next = out.reduce((max, version) => Math.max(max, version.number), 0) + 1;
  for (const version of [...out].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )) {
    if (!usedNumbers.has(version.number)) {
      usedNumbers.add(version.number);
      continue;
    }
    const previousNumber = version.number;
    version.number = next++;
    usedNumbers.add(version.number);
    addAction(ctx, {
      kind: 'RENUMBERED',
      side: sideOf(version) === 'BOTH' ? 'BOTH' : sideOf(version),
      entity,
      summary: `${noun} "${itemLabel}" tinha duas versões numeradas ${previousNumber}. A segunda virou versão ${version.number} — confira a numeração.`,
      needsReview: true,
    });
  }

  return out.sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
}

function mergeLibraryCollection<
  V extends LibraryVersion,
  T extends { id: string; createdAt: string; versions: V[] },
>(ctx: MergeCtx, mine: T[], theirs: T[], spec: ItemSpec<T>, noun: string): T[] {
  const mineById = byId(mine);
  const theirsById = byId(theirs);
  const out: T[] = [];

  const union = (item: T, side: MergeSide): void => {
    out.push(clone(item));
    ctx.provenance.set(item.id, side);
    addAction(ctx, {
      kind: spec.actionKind,
      side,
      entity: entityRef(spec, item),
      summary: `${spec.noun} "${spec.label(item)}" existe só em ${sideLabel(side)} e entra por união, com as ${item.versions.length} versão(ões).`,
    });
  };

  for (const item of mine) {
    const counterpart = theirsById.get(item.id);
    if (counterpart === undefined) {
      union(item, 'MINE');
      continue;
    }
    ctx.provenance.set(item.id, 'BOTH');

    const versionFields = libraryVersionFields(item.versions, counterpart.versions);
    const addedByThem = counterpart.versions.filter(
      (version) => !item.versions.some((candidate) => candidate.id === version.id),
    );
    const addedByMe = item.versions.filter(
      (version) => !counterpart.versions.some((candidate) => candidate.id === version.id),
    );

    const merged = mergePair(
      ctx,
      { ...spec, skip: [...(spec.skip ?? []), 'versions'] },
      item,
      counterpart,
      versionFields,
      (assembled, resolved) => {
        const versions = unionLibraryVersions(item.versions, counterpart.versions, resolved);
        const sideOf = (version: V): MergeSide | 'BOTH' => {
          const inMine = item.versions.some((candidate) => candidate.id === version.id);
          const inTheirs = counterpart.versions.some((candidate) => candidate.id === version.id);
          return inMine && inTheirs ? 'BOTH' : inMine ? 'MINE' : 'THEIRS';
        };
        return {
          ...assembled,
          versions: normalizeLibraryVersions(
            ctx,
            versions,
            entityRef(spec, item),
            noun,
            spec.label(item),
            sideOf,
          ),
        };
      },
    );

    for (const [side, added] of [
      ['THEIRS', addedByThem],
      ['MINE', addedByMe],
    ] as const) {
      for (const version of added) {
        addAction(ctx, {
          kind: 'UNION_LIBRARY_ITEM',
          side,
          entity: entityRef(spec, item),
          summary: `A ${libraryVersionSummary(version)} de "${spec.label(item)}" existe só em ${sideLabel(side)} e entra por união.`,
        });
      }
    }

    out.push(merged);
  }

  for (const item of theirs) {
    if (!mineById.has(item.id)) union(item, 'THEIRS');
  }

  return out.sort(byCreatedAt);
}

// ---------------------------------------------------------------------------
// Matrizes
// ---------------------------------------------------------------------------
// #region: matrizes

const MATRIX_STATE_RANK: Record<MatrixVersion['state'], number> = {
  DRAFT: 0,
  ARCHIVED: 1,
  PUBLISHED: 2,
  SUPERSEDED: 3,
};

const MATRIX_STATE_LABEL: Record<MatrixVersion['state'], string> = {
  DRAFT: 'rascunho',
  ARCHIVED: 'arquivada',
  PUBLISHED: 'publicada',
  SUPERSEDED: 'substituída',
};

function isSealed(version: MatrixVersion): boolean {
  return version.state === 'PUBLISHED' || version.state === 'SUPERSEDED';
}

/**
 * Conteúdo da versão sem os campos que o ciclo de vida carimba. Duas versões
 * com o mesmo id e a mesma chave de conteúdo são a mesma coisa em momentos
 * diferentes da vida — publicar não altera eixos nem células.
 */
function versionContentKey(version: MatrixVersion): string {
  return keyOf({
    number: version.number,
    axes: version.axes,
    cells: version.cells,
    baseVersionId: version.baseVersionId,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
  });
}

function versionRefOf(matrix: Matrix, version: MatrixVersion): MergeEntityRef {
  return {
    kind: 'MATRIX_VERSION',
    id: version.id,
    label: `${matrix.code} v${version.number}`,
    matrixId: matrix.id,
  };
}

/**
 * Um rascunho candidato a ser **o** rascunho aberto da matriz. Todo rascunho
 * que entra na união vira candidato: I1 permite um só, e quem escolhe é
 * `resolveDrafts`.
 */
type DraftCandidate = { version: MatrixVersion; side: MergeSide };

/**
 * União das versões de uma matriz, id a id. Nenhuma versão selada
 * (`PUBLISHED`/`SUPERSEDED`) sai daqui descartada — no máximo ela é
 * renumerada mais adiante.
 */
function mergeMatrixVersions(
  ctx: MergeCtx,
  matrix: Matrix,
  mine: MatrixVersion[],
  theirs: MatrixVersion[],
): { versions: MatrixVersion[]; drafts: DraftCandidate[] } {
  const mineById = byId(mine);
  const theirsById = byId(theirs);
  const versions: MatrixVersion[] = [];
  const drafts: DraftCandidate[] = [];

  const unionAction = (version: MatrixVersion, side: MergeSide): void => {
    addAction(ctx, {
      kind: isSealed(version) ? 'UNION_PUBLISHED_VERSION' : 'UNION_DRAFT',
      side,
      entity: versionRefOf(matrix, version),
      summary: isSealed(version)
        ? `A versão ${version.number} de "${matrix.code}" está ${MATRIX_STATE_LABEL[version.state]} só em ${sideLabel(side)} e entra por união — versão publicada é imutável e nunca conflita.`
        : `A versão ${version.number} de "${matrix.code}" (${MATRIX_STATE_LABEL[version.state]}) existe só em ${sideLabel(side)} e entra por união.`,
    });
  };

  const take = (version: MatrixVersion, side: MergeSide | 'BOTH'): void => {
    const copy = clone(version);
    versions.push(copy);
    ctx.provenance.set(copy.id, side);
    if (copy.state === 'DRAFT') {
      drafts.push({ version: copy, side: side === 'BOTH' ? 'MINE' : side });
    }
  };

  for (const version of mine) {
    const counterpart = theirsById.get(version.id);
    if (counterpart === undefined) {
      unionAction(version, 'MINE');
      take(version, 'MINE');
      continue;
    }

    if (same(version, counterpart)) {
      take(version, 'BOTH');
      continue;
    }

    // Mesmo id, mesmo conteúdo, estados diferentes: alguém publicou, substituiu
    // ou descartou. O ciclo de vida só anda para a frente — vence o estado
    // mais avançado.
    if (versionContentKey(version) === versionContentKey(counterpart)) {
      const winnerSide: MergeSide =
        MATRIX_STATE_RANK[counterpart.state] > MATRIX_STATE_RANK[version.state]
          ? 'THEIRS'
          : MATRIX_STATE_RANK[counterpart.state] < MATRIX_STATE_RANK[version.state]
            ? 'MINE'
            : keyOf(counterpart) > keyOf(version)
              ? 'THEIRS'
              : 'MINE';
      const winner = pick(winnerSide, version, counterpart);
      if (winner.state !== version.state || winner.state !== counterpart.state) {
        addAction(ctx, {
          kind: 'LIFECYCLE_ADVANCED',
          side: winnerSide,
          entity: versionRefOf(matrix, winner),
          summary: `A versão ${winner.number} de "${matrix.code}" passou a ${MATRIX_STATE_LABEL[winner.state]} em ${sideLabel(winnerSide)}. O estado mais avançado prevalece.`,
        });
      }
      take(winner, 'BOTH');
      continue;
    }

    const mineDraft = version.state === 'DRAFT';
    const theirsDraft = counterpart.state === 'DRAFT';

    if (mineDraft && theirsDraft) {
      // Um lado editou o rascunho e o outro não: o histórico prova qual foi, e
      // vence o lado alterado (§7, última linha da tabela automática).
      const audit = changedSideByAudit(ctx, scopeMatcher('versionId', version.id));
      if (audit !== null) {
        const winner = pick(audit, version, counterpart);
        addAction(ctx, {
          kind: 'CHANGED_SIDE_WINS',
          side: audit,
          entity: versionRefOf(matrix, winner),
          summary: `O rascunho da versão ${winner.number} de "${matrix.code}" foi editado só em ${sideLabel(audit)} — o histórico prova que ${sideLabel(otherSide(audit))} não mexeu nele. Vence o lado alterado.`,
        });
        take(winner, audit);
        continue;
      }
      // Os dois editaram: decidido no bloco de rascunhos, com os dois
      // conteúdos ainda em mãos.
      drafts.push({ version: clone(version), side: 'MINE' });
      drafts.push({ version: clone(counterpart), side: 'THEIRS' });
      continue;
    }

    if (mineDraft !== theirsDraft) {
      // Um lado publicou o rascunho e o outro continuou editando. A publicada
      // entra sempre; o rascunho perdido vira candidato, e o usuário decide se
      // quer guardá-lo.
      const sealedSide: MergeSide = mineDraft ? 'THEIRS' : 'MINE';
      const sealed = pick(sealedSide, version, counterpart);
      const lost = pick(otherSide(sealedSide), version, counterpart);
      unionAction(sealed, sealedSide);
      take(sealed, sealedSide);
      drafts.push({ version: clone(lost), side: otherSide(sealedSide) });
      continue;
    }

    // Duas versões seladas com o mesmo id e conteúdos diferentes. Não deveria
    // acontecer — publicada é imutável —, e por isso é tratada como o caso
    // grave de §7: as duas sobrevivem, uma delas como cópia arquivada.
    const resolved = registerConflict(ctx, {
      id: `PUBLISHED_CLASH:${matrix.id}:${version.id}`,
      kind: 'PUBLISHED_CLASH',
      entity: versionRefOf(matrix, version),
      title: `A versão ${version.number} de "${matrix.code}" está publicada com conteúdos diferentes`,
      summary:
        'Caso grave: versão publicada é imutável e os dois lados divergem. As duas são preservadas — a não escolhida entra como cópia arquivada, renumerada, para revisão manual.',
      options: [
        { ...MINE_WINS_OPTION, label: 'Manter a minha na vigência', detail: 'A do arquivo entra como cópia arquivada.' },
        { ...THEIRS_WINS_OPTION, label: 'Manter a do arquivo na vigência', detail: 'A minha entra como cópia arquivada.' },
      ],
      defaultChoice: 'MINE',
      fields: [],
      preview: {
        kind: 'MATRIX_VERSION',
        matrixId: matrix.id,
        mineVersionId: version.id,
        theirsVersionId: counterpart.id,
      },
    });
    const winner = pick(resolved.base, version, counterpart);
    const loser = pick(otherSide(resolved.base), version, counterpart);
    take(winner, resolved.base);
    const archived = archivedCopy(ctx, matrix, loser, versions);
    versions.push(archived);
    ctx.provenance.set(archived.id, otherSide(resolved.base));
    addAction(ctx, {
      kind: 'ARCHIVED_LOSER',
      side: otherSide(resolved.base),
      entity: versionRefOf(matrix, loser),
      summary: `A outra versão ${loser.number} de "${matrix.code}" foi preservada como cópia arquivada — revise manualmente.`,
      needsReview: true,
    });
  }

  for (const version of theirs) {
    if (mineById.has(version.id)) continue;
    unionAction(version, 'THEIRS');
    take(version, 'THEIRS');
  }

  return { versions, drafts };
}

const MERGE_NOTE = 'Preservada pelo merge de documentos — revise e descarte se não for mais necessária.';

/**
 * Cópia arquivada do perdedor: fora da linha de vigência, com nota, e com um
 * id livre — o dele mesmo quando ainda não foi usado no resultado (o caso de
 * dois rascunhos com ids diferentes), um id derivado quando o vencedor já
 * ocupou aquele id.
 */
function archivedCopy(
  ctx: MergeCtx,
  matrix: Matrix,
  version: MatrixVersion,
  placed: MatrixVersion[],
): MatrixVersion {
  const copy = clone(version);
  if (placed.some((candidate) => candidate.id === copy.id)) {
    copy.id = derivedId(`${matrix.code}:archived:${version.id}`, ctx.usedIds);
  }
  ctx.usedIds.add(copy.id);
  copy.state = 'ARCHIVED';
  copy.archivedAt = ctx.at;
  copy.notes = version.notes === undefined ? MERGE_NOTE : `${version.notes} · ${MERGE_NOTE}`;
  delete copy.effectiveFrom;
  delete copy.effectiveTo;
  return copy;
}

/**
 * I1: uma matriz tem no máximo um rascunho. Quando os dois lados chegam com
 * rascunhos diferentes, §7 manda escolher um — ou manter os dois, com o
 * perdedor virando `ARCHIVED` com nota.
 */
function resolveDrafts(
  ctx: MergeCtx,
  matrix: Matrix,
  versions: MatrixVersion[],
  drafts: DraftCandidate[],
): MatrixVersion[] {
  // Todo rascunho que entrou na união é candidato, então o que sobra aqui são
  // as versões seladas e as arquivadas.
  const sealed = versions.filter((version) => version.state !== 'DRAFT');

  /**
   * Materializa um candidato. Quando o id dele já está ocupado por uma versão
   * selada — o lado de lá publicou justamente aquele rascunho —, as edições
   * entram como uma versão nova, ainda em rascunho, em vez de sumirem.
   */
  const materialize = (candidate: DraftCandidate, into: MatrixVersion[]): MatrixVersion => {
    const taken = into.some((version) => version.id === candidate.version.id);
    const draft = taken
      ? reviveDraft(ctx, matrix, candidate.version, into, candidate.side)
      : clone(candidate.version);
    ctx.usedIds.add(draft.id);
    ctx.provenance.set(draft.id, candidate.side);
    return draft;
  };

  if (drafts.length <= 1) {
    const only = drafts[0];
    if (only === undefined) return versions;
    return [...sealed, materialize(only, sealed)];
  }

  const mineDraft = drafts.find((candidate) => candidate.side === 'MINE') ?? drafts[0]!;
  const theirsDraft = drafts.find((candidate) => candidate !== mineDraft)!;

  const resolved = registerConflict(ctx, {
    id: `DRAFT_DIVERGED:${matrix.id}`,
    kind: 'DRAFT_DIVERGED',
    entity: {
      kind: 'MATRIX',
      id: matrix.id,
      label: `${matrix.code} — ${matrix.name}`,
      matrixId: matrix.id,
    },
    title: `A matriz "${matrix.code}" tem rascunhos diferentes dos dois lados`,
    summary:
      'Só pode haver um rascunho aberto por matriz (I1). Compare os dois antes de decidir.',
    options: [
      {
        choice: 'KEEP_BOTH',
        label: 'Manter os dois',
        detail: 'O seu rascunho continua aberto; o do arquivo entra como versão arquivada, com nota. Nada se perde.',
      },
      { ...MINE_WINS_OPTION, label: 'Manter o meu rascunho', detail: 'O rascunho do arquivo é descartado.' },
      { ...THEIRS_WINS_OPTION, label: 'Usar o rascunho do arquivo', detail: 'O seu rascunho é descartado.' },
    ],
    defaultChoice: 'KEEP_BOTH',
    fields: [],
    preview: {
      kind: 'MATRIX_VERSION',
      matrixId: matrix.id,
      mineVersionId: mineDraft.version.id,
      theirsVersionId: theirsDraft.version.id,
    },
  });

  const winnerCandidate = resolved.base === 'MINE' ? mineDraft : theirsDraft;
  const loserCandidate = resolved.base === 'MINE' ? theirsDraft : mineDraft;

  let out = [...sealed, materialize(winnerCandidate, sealed)];

  if (resolved.choice === 'KEEP_BOTH') {
    const archived = archivedCopy(ctx, matrix, loserCandidate.version, out);
    archived.number = nextFreeNumber(out);
    ctx.provenance.set(archived.id, loserCandidate.side);
    out = [...out, archived];
    addAction(ctx, {
      kind: 'ARCHIVED_LOSER',
      side: loserCandidate.side,
      entity: versionRefOf(matrix, loserCandidate.version),
      summary: `O rascunho de ${sideLabel(loserCandidate.side)} em "${matrix.code}" entrou como versão ${archived.number}, arquivada e com nota.`,
    });
  }

  return out;
}

function nextFreeNumber(versions: MatrixVersion[]): number {
  return versions.reduce((max, version) => Math.max(max, version.number), 0) + 1;
}

/** Rascunho cujo id já foi ocupado pela versão publicada do outro lado. */
function reviveDraft(
  ctx: MergeCtx,
  matrix: Matrix,
  draft: MatrixVersion,
  versions: MatrixVersion[],
  side: MergeSide,
): MatrixVersion {
  const copy = clone(draft);
  copy.id = derivedId(`${matrix.code}:draft:${draft.id}`, ctx.usedIds);
  copy.number = nextFreeNumber(versions);
  copy.baseVersionId = draft.id;
  addAction(ctx, {
    kind: 'RENUMBERED',
    side,
    entity: versionRefOf(matrix, draft),
    summary: `A versão ${draft.number} de "${matrix.code}" foi publicada de um lado e continuava em edição do outro. As edições do rascunho viraram a versão ${copy.number}, ainda em rascunho — confira antes de publicar.`,
    needsReview: true,
  });
  return copy;
}

/**
 * Numeração sem repetição. Publicada com o mesmo número e conteúdo diferente é
 * o caso grave de §7: renumera o perdedor e sinaliza para revisão manual.
 */
function normalizeMatrixNumbers(
  ctx: MergeCtx,
  matrix: Matrix,
  versions: MatrixVersion[],
): MatrixVersion[] {
  const out = versions.map(clone);
  const chronological = [...out].sort(
    (a, b) =>
      (a.effectiveFrom ?? a.createdAt).localeCompare(b.effectiveFrom ?? b.createdAt) ||
      a.number - b.number ||
      a.id.localeCompare(b.id),
  );

  const byNumber = new Map<number, MatrixVersion[]>();
  for (const version of chronological) {
    byNumber.set(version.number, [...(byNumber.get(version.number) ?? []), version]);
  }

  const renumber: MatrixVersion[] = [];
  for (const [, group] of byNumber) {
    if (group.length < 2) continue;
    const sealed = group.filter(isSealed);
    if (sealed.length > 1) {
      const [first, second] = [sealed[0]!, sealed[1]!];
      const mineSide = ctx.provenance.get(first.id) === 'THEIRS' ? second : first;
      const theirsSide: MatrixVersion = mineSide === first ? second : first;
      const resolved = registerConflict(ctx, {
        id: `PUBLISHED_CLASH:${matrix.id}:N${first.number}`,
        kind: 'PUBLISHED_CLASH',
        entity: versionRefOf(matrix, first),
        title: `Duas versões ${first.number} publicadas em "${matrix.code}"`,
        summary:
          'Caso grave: os dois lados publicaram a versão com o mesmo número e conteúdos diferentes. As duas são preservadas; a perdedora é renumerada e fica sinalizada para revisão manual.',
        options: [
          { ...MINE_WINS_OPTION, label: 'Meu lado mantém o número', detail: 'A versão do arquivo é renumerada.' },
          { ...THEIRS_WINS_OPTION, label: 'O arquivo mantém o número', detail: 'A minha versão é renumerada.' },
        ],
        // A publicação mais antiga fica com o número: a numeração segue a
        // ordem em que as versões entraram em vigência.
        defaultChoice: ctx.provenance.get(first.id) === 'THEIRS' ? 'THEIRS' : 'MINE',
        fields: [],
        preview: {
          kind: 'MATRIX_VERSION',
          matrixId: matrix.id,
          mineVersionId: mineSide.id,
          theirsVersionId: theirsSide.id,
        },
      });
      const keeper = resolved.base === 'MINE' ? mineSide : theirsSide;
      for (const version of group) if (version.id !== keeper.id) renumber.push(version);
      continue;
    }
    // Rascunho e publicada com o mesmo número: quem cede é o rascunho.
    const keeper = group.find(isSealed) ?? group[0]!;
    for (const version of group) if (version.id !== keeper.id) renumber.push(version);
  }

  let next = out.reduce((max, version) => Math.max(max, version.number), 0) + 1;
  for (const version of renumber) {
    const previousNumber = version.number;
    version.number = next++;
    const side = ctx.provenance.get(version.id);
    addAction(ctx, {
      kind: 'RENUMBERED',
      side: side === undefined || side === 'BOTH' ? 'BOTH' : side,
      entity: versionRefOf(matrix, version),
      summary: `Duas versões de "${matrix.code}" tinham o número ${previousNumber}. A de ${sideLabel(side === 'THEIRS' ? 'THEIRS' : 'MINE')} virou a versão ${version.number} — revise manualmente.`,
      needsReview: isSealed(version),
    });
  }

  return out;
}

/**
 * I2 e I4: a linha do tempo de uma matriz é uma cadeia sem buracos nem
 * sobreposições, e só a última publicação fica vigente. Recalcular a cadeia
 * depois da união é o que torna duas publicações independentes compatíveis —
 * elas viram uma sequência, na ordem em que entraram em vigência.
 */
function chainEffectivity(
  ctx: MergeCtx,
  matrix: Matrix,
  versions: MatrixVersion[],
): MatrixVersion[] {
  const out = versions.map(clone);
  const timed = out
    .filter(isSealed)
    .sort(
      (a, b) =>
        (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? '') ||
        a.number - b.number ||
        a.id.localeCompare(b.id),
    );

  timed.forEach((version, index) => {
    const next = timed[index + 1];
    const previousState = version.state;
    if (next === undefined) {
      version.state = 'PUBLISHED';
      delete version.effectiveTo;
    } else {
      version.state = 'SUPERSEDED';
      version.effectiveTo = next.effectiveFrom;
    }
    if (previousState === 'PUBLISHED' && version.state === 'SUPERSEDED') {
      addAction(ctx, {
        kind: 'LIFECYCLE_ADVANCED',
        side: 'BOTH',
        entity: versionRefOf(matrix, version),
        summary: `A versão ${version.number} de "${matrix.code}" passou a substituída: a versão ${next!.number} assumiu a vigência em ${next!.effectiveFrom}.`,
      });
    }
  });

  return out.sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
}

const MATRIX_SPEC: ItemSpec<Matrix> = {
  entityKind: 'MATRIX',
  actionKind: 'UNION_MATRIX',
  noun: 'A matriz',
  label: (matrix) => `${matrix.code} — ${matrix.name}`,
  matcher: (matrix) => scopeMatcher('matrixId', matrix.id),
  skip: ['versions'],
};

function mergeMatrices(ctx: MergeCtx): Matrix[] {
  const mineById = byId(ctx.mine.matrices);
  const theirsById = byId(ctx.theirs.matrices);
  const out: Matrix[] = [];

  const union = (matrix: Matrix, side: MergeSide): void => {
    const copy = clone(matrix);
    for (const version of copy.versions) {
      ctx.provenance.set(version.id, side);
      ctx.usedIds.add(version.id);
    }
    out.push(copy);
    addAction(ctx, {
      kind: 'UNION_MATRIX',
      side,
      entity: entityRef(MATRIX_SPEC, matrix),
      summary: `A matriz "${MATRIX_SPEC.label(matrix)}" existe só em ${sideLabel(side)} e entra por união, com as ${matrix.versions.length} versão(ões).`,
    });
  };

  for (const matrix of ctx.mine.matrices) {
    const counterpart = theirsById.get(matrix.id);
    if (counterpart === undefined) {
      union(matrix, 'MINE');
      continue;
    }

    const shell = mergePair(ctx, MATRIX_SPEC, matrix, counterpart);
    const { versions, drafts } = mergeMatrixVersions(
      ctx,
      matrix,
      matrix.versions,
      counterpart.versions,
    );
    for (const version of versions) ctx.usedIds.add(version.id);
    let merged = resolveDrafts(ctx, matrix, versions, drafts);
    merged = normalizeMatrixNumbers(ctx, matrix, merged);
    merged = chainEffectivity(ctx, matrix, merged);
    out.push({ ...shell, versions: merged });
  }

  for (const matrix of ctx.theirs.matrices) {
    if (!mineById.has(matrix.id)) union(matrix, 'THEIRS');
  }

  return out.sort(byCreatedAt);
}

// ---------------------------------------------------------------------------
// Códigos duplicados
// ---------------------------------------------------------------------------
// #region: codigos-duplicados

type CodedEntity = { id: string; code: string };

function freeCode(code: string, taken: Set<string>): string {
  for (let suffix = 2; ; suffix++) {
    const candidate = `${code}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * §7, último caso: o mesmo `code` criado do zero dos dois lados para entidades
 * diferentes. Renomeia um deles — I18 exige `code` único no escopo.
 *
 * Referências a **catálogo** são por código (docs/03 §6.2), então renomear um
 * item de catálogo obriga a reescrever as células que o citam. Só as versões
 * que vieram exclusivamente do lado renomeado citam o código novo: um código
 * criado do zero depois que os dois documentos se separaram não existia no
 * ancestral comum, e portanto nenhuma versão comum aos dois lados o referencia.
 * Variáveis, regras, projetos, matrizes e templates são referenciados por id —
 * renomear o código deles não mexe em nada mais.
 */
function resolveCodeClashes(
  ctx: MergeCtx,
  scopeLabel: string,
  entityKind: MergeEntityKind,
  noun: string,
  entities: CodedEntity[],
  onRename: (entity: CodedEntity, code: string, side: MergeSide) => void,
): void {
  const groups = new Map<string, CodedEntity[]>();
  for (const entity of entities) {
    groups.set(entity.code, [...(groups.get(entity.code) ?? []), entity]);
  }
  const taken = new Set(entities.map((entity) => entity.code));

  for (const [code, group] of groups) {
    if (group.length < 2) continue;
    for (let index = 1; index < group.length; index++) {
      const first = group[0]!;
      const other = group[index]!;
      const firstSide = ctx.provenance.get(first.id) ?? 'BOTH';
      const otherProvenance = ctx.provenance.get(other.id) ?? 'BOTH';
      // "O meu" é o que não veio exclusivamente do arquivo.
      const mineEntity = otherProvenance === 'THEIRS' ? first : firstSide === 'THEIRS' ? other : first;
      const theirsEntity = mineEntity === first ? other : first;
      // Quem chegou depois cede o código: se um dos dois já existia nos dois
      // documentos, ele é o dono original e mantém o código.
      const keeper = firstSide === 'BOTH' ? first : otherProvenance === 'BOTH' ? other : mineEntity;
      const defaultChoice: MergeChoice = keeper === mineEntity ? 'MINE' : 'THEIRS';

      const resolved = registerConflict(ctx, {
        id: `CODE_CLASH:${entityKind}:${scopeLabel}:${code}:${[first.id, other.id].sort().join('|')}`,
        kind: 'CODE_CLASH',
        entity: { kind: entityKind, id: other.id, label: code },
        title: `O código "${code}" foi criado dos dois lados, para ${noun}s diferentes`,
        summary: `Um código é único no seu escopo (I18) e imutável depois de criado. Um dos dois precisa ser renomeado — o outro fica como está.`,
        options: [
          { choice: 'MINE', label: 'Meu lado mantém o código', detail: `${noun} do arquivo é renomeado.` },
          { choice: 'THEIRS', label: 'O arquivo mantém o código', detail: `${noun} do meu documento é renomeado.` },
        ],
        defaultChoice,
        fields: [
          {
            key: 'code',
            label: 'Código',
            mine: `${code} (${mineEntity.id})`,
            theirs: `${code} (${theirsEntity.id})`,
            choosable: false,
          },
        ],
        preview: { kind: 'FIELDS' },
      });

      const loser = resolved.base === 'MINE' ? theirsEntity : mineEntity;
      const loserSide: MergeSide = resolved.base === 'MINE' ? 'THEIRS' : 'MINE';
      const renamed = freeCode(code, taken);
      taken.add(renamed);
      onRename(loser, renamed, loserSide);
      addAction(ctx, {
        kind: 'RENAMED',
        side: loserSide,
        entity: { kind: entityKind, id: loser.id, label: renamed },
        summary: `${noun} "${code}" de ${sideLabel(loserSide)} foi renomeado para "${renamed}" — o mesmo código estava em uso para outra entidade.`,
        needsReview: true,
      });
    }
  }
}

function rewriteCatalogCode(
  document: PolicyOpsDocument,
  ctx: MergeCtx,
  item: CatalogItem,
  from: string,
  to: string,
  side: MergeSide,
): void {
  // `null` = kind que nenhuma célula referencia; renomear o código dele não
  // obriga a reescrever matriz nem template.
  const field: Record<CatalogItemKind, keyof Cell | null> = {
    DECISION: 'decision',
    OFFER: 'offer',
    LIMIT: 'limit',
    TAG: null,
    MOTIVATOR: null,
    IMPACT_CATEGORY: null,
  };
  const cellField = field[item.kind];

  for (const matrix of document.matrices) {
    for (const version of matrix.versions) {
      if (ctx.provenance.get(version.id) !== side) continue;
      if (cellField === null) continue;
      for (const cell of Object.values(version.cells)) {
        if (cell[cellField] === from) (cell as Record<string, unknown>)[cellField] = to;
      }
    }
  }

  for (const template of document.templates) {
    if (ctx.provenance.get(template.id) !== side) continue;
    const key = cellField as 'decision' | 'offer' | 'limit' | null;
    if (key === null) continue;
    if (template.defaults?.[key] === from) template.defaults[key] = to;
    for (const rule of template.seedRules) {
      if (rule.set[key] === from) rule.set[key] = to;
    }
  }
}

// ---------------------------------------------------------------------------
// Eventos, metadados e posições
// ---------------------------------------------------------------------------
// #region: eventos-metadados-e-posicoes

function mergeEvents(ctx: MergeCtx): DocEvent[] {
  const merged = new Map<string, DocEvent>();
  for (const event of ctx.mine.events) merged.set(event.id, event);
  for (const event of ctx.theirs.events) if (!merged.has(event.id)) merged.set(event.id, event);

  // Ordenação **estável** por `at`, e só por `at`: eventos do mesmo instante
  // mantêm a ordem em que foram registrados, que é a ordem causal. Desempatar
  // por id embaralharia o histórico de quem publicou e substituiu na mesma
  // milésima de segundo.
  const events = [...merged.values()].map(clone).sort((a, b) => a.at.localeCompare(b.at));

  if (ctx.theirsOnlyEvents.length > 0 || ctx.mineOnlyEvents.length > 0) {
    addAction(ctx, {
      kind: 'UNION_EVENTS',
      side: 'BOTH',
      entity: { kind: 'EVENTS', id: 'events', label: 'Histórico de auditoria' },
      summary: `O histórico vira a união dos dois lados: ${events.length} eventos, ordenados por data e sem repetição (${ctx.theirsOnlyEvents.length} vindos do arquivo).`,
    });
  }
  return events;
}

function maxString(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

const DOCUMENT_SPEC: ItemSpec<DocumentMeta> = {
  entityKind: 'DOCUMENT',
  actionKind: 'META_MERGED',
  noun: 'O documento',
  label: (meta) => meta.name,
  // Renomear o documento não gera evento (`DocEventType` é fechado, docs/03
  // §8), então não há prova de auditoria: nome diferente é sempre decisão.
  matcher: () => () => false,
  skip: ['revision', 'savedAt', 'savedBy', 'appVersion', 'createdAt'],
};

/**
 * Metadados do documento.
 *
 * Nome e descrição são conteúdo — se divergem, é decisão do usuário, e o merge
 * não escolhe por ele. O resto é derivado de forma **simétrica**, para que
 * `merge(a,b)` e `merge(b,a)` deem o mesmo: a revisão é a maior das duas (o
 * salvamento seguinte incrementa a partir dela, e o arquivo nunca "volta no
 * tempo"), o carimbo de salvamento é o mais recente e a criação é a mais
 * antiga.
 */
function mergeMeta(ctx: MergeCtx): DocumentMeta {
  const mine = ctx.mine.meta;
  const theirs = ctx.theirs.meta;

  const chosen = mergePair(ctx, DOCUMENT_SPEC, mine, theirs);
  const savedAt = maxString(mine.savedAt, theirs.savedAt);
  const savedBy =
    savedAt === null
      ? (mine.savedBy ?? theirs.savedBy)
      : (pick(savedAt === theirs.savedAt ? 'THEIRS' : 'MINE', mine, theirs).savedBy ??
        mine.savedBy ??
        theirs.savedBy);

  const meta: DocumentMeta = {
    ...chosen,
    id: mine.id,
    revision: Math.max(mine.revision, theirs.revision),
    savedAt,
    savedBy,
    appVersion: mine.appVersion >= theirs.appVersion ? mine.appVersion : theirs.appVersion,
    createdAt: mine.createdAt <= theirs.createdAt ? mine.createdAt : theirs.createdAt,
  };

  if (mine.id !== theirs.id) {
    addAction(ctx, {
      kind: 'META_MERGED',
      side: 'BOTH',
      entity: { kind: 'DOCUMENT', id: mine.id, label: mine.name },
      summary: `Os dois arquivos têm identificadores de documento diferentes (${mine.id} e ${theirs.id}) — provavelmente não são o mesmo documento. O merge seguiu com o seu identificador; confira o resultado antes de salvar.`,
      needsReview: true,
    });
  }

  if (!same(mine, meta) || !same(theirs, meta)) {
    addAction(ctx, {
      kind: 'META_MERGED',
      side: 'BOTH',
      entity: { kind: 'DOCUMENT', id: meta.id, label: meta.name },
      summary: `Dados do documento: nome "${meta.name}", revisão ${meta.revision}, último salvamento por ${meta.savedBy ?? '—'}.`,
    });
  }
  return meta;
}

/**
 * `position` é 0-based e sem buracos (docs/03 §1). Depois da união, os dois
 * lados podem ter criado itens na mesma posição: a ordem é reconstruída de
 * forma determinística e simétrica.
 */
function renumberPositions<T extends { position: number; createdAt: string; id: string }>(
  items: T[],
): T[] {
  return [...items]
    .sort((a, b) => a.position - b.position || byCreatedAtThenId(a, b))
    .map((item, position) => ({ ...item, position }));
}

/**
 * `CatalogItem.position` é 0-based sem buracos *dentro de cada `kind`*
 * (docs/03-modelo-do-documento.md §5), não no array `catalog` inteiro —
 * mesma convenção usada por `catalog/create` e `catalog/reorder`
 * (src/core/library/catalog.ts). Renumerar o array plano misturaria as
 * sequências de DECISION/OFFER/LIMIT/TAG.
 */
function renumberCatalogPositions(items: CatalogItem[]): CatalogItem[] {
  const byKind = new Map<CatalogItemKind, CatalogItem[]>();
  for (const item of items) {
    const list = byKind.get(item.kind);
    if (list) list.push(item);
    else byKind.set(item.kind, [item]);
  }
  const renumbered = new Map<string, CatalogItem>();
  for (const list of byKind.values()) {
    for (const item of renumberPositions(list)) renumbered.set(item.id, item);
  }
  return items.map((item) => renumbered.get(item.id)!);
}

/** O instante mais recente que os dois documentos conhecem. */
function latestInstant(mine: PolicyOpsDocument, theirs: PolicyOpsDocument): string {
  let latest = mine.meta.createdAt;
  for (const document of [mine, theirs]) {
    if (document.meta.savedAt !== null && document.meta.savedAt > latest) latest = document.meta.savedAt;
    if (document.meta.createdAt > latest) latest = document.meta.createdAt;
    for (const event of document.events) if (event.at > latest) latest = event.at;
  }
  return latest;
}

// ---------------------------------------------------------------------------
// mergeDocuments
// ---------------------------------------------------------------------------
// #region: merge-documents

const VARIABLE_SPEC: ItemSpec<Variable> = {
  entityKind: 'VARIABLE',
  actionKind: 'UNION_LIBRARY_ITEM',
  noun: 'A variável',
  label: (variable) => `${variable.code} — ${variable.name}`,
  matcher: (variable) => scopeMatcher('variableId', variable.id),
};

const COMPATIBILITY_SPEC: ItemSpec<CompatibilityRule> = {
  entityKind: 'COMPATIBILITY',
  actionKind: 'UNION_LIBRARY_ITEM',
  noun: 'A regra de compatibilidade',
  label: (rule) => `${rule.code} — ${rule.name}`,
  matcher: (rule) => scopeMatcher('compatibilityId', rule.id),
};

const CATALOG_SPEC: ItemSpec<CatalogItem> = {
  entityKind: 'CATALOG',
  actionKind: 'UNION_LIBRARY_ITEM',
  noun: 'O item de catálogo',
  label: (item) => `${item.code} — ${item.label}`,
  matcher: catalogMatcher,
};

const PROJECT_SPEC: ItemSpec<Project> = {
  entityKind: 'PROJECT',
  actionKind: 'UNION_PROJECT',
  noun: 'O projeto',
  label: (project) => `${project.code} — ${project.name}`,
  matcher: (project) => scopeMatcher('projectId', project.id),
};

const TEMPLATE_SPEC: ItemSpec<Template> = {
  entityKind: 'TEMPLATE',
  actionKind: 'UNION_TEMPLATE',
  noun: 'O template',
  label: (template) => `${template.code} — ${template.name}`,
  // `DocEventType` não tem evento de template (docs/03 §8 é fechado): sem
  // prova de auditoria, divergência de template é sempre conflito.
  matcher: () => () => false,
};

const IMPORT_PROFILE_SPEC: ItemSpec<ImportProfile> = {
  entityKind: 'IMPORT_PROFILE',
  actionKind: 'UNION_IMPORT_PROFILE',
  noun: 'O perfil de carga',
  label: (profile) => `${profile.code} — ${profile.name}`,
  // `DocEvent.scope` não tem `profileId` (docs/03 §8): sem prova de
  // auditoria por escopo, divergência de perfil é sempre conflito — mesmo
  // raciocínio de TEMPLATE_SPEC.
  matcher: () => () => false,
};

const COMPONENT_SPEC: ItemSpec<PolicyComponent> = {
  entityKind: 'COMPONENT',
  actionKind: 'UNION_COMPONENT',
  noun: 'O componente',
  label: (component) => `${component.code} — ${component.name}`,
  matcher: (component) => scopeMatcher('componentId', component.id),
};

/**
 * Componentes de política (schema 5).
 *
 * `PolicyComponent` tem `versions` com o mesmo ciclo de três estados das
 * bibliotecas, então reusa `mergeLibraryCollection` inteiro — inclusive a
 * normalização de I29 (uma `DRAFT`, uma `PUBLISHED`, números sem repetição),
 * que é a mesma de I11. O que **não** é reusado é `position`: a de componente é
 * 0-based por grupo de irmãos (I28), não pela coleção inteira.
 */
function mergeComponents(ctx: MergeCtx): PolicyComponent[] {
  const merged = mergeLibraryCollection(
    ctx,
    ctx.mine.components,
    ctx.theirs.components,
    COMPONENT_SPEC,
    'O componente',
  );
  return renumberSiblingPositions(merged);
}

/** `position` 0-based sem buracos **entre irmãos** (I28), grupo a grupo. */
function renumberSiblingPositions(components: PolicyComponent[]): PolicyComponent[] {
  const groups = new Map<string, PolicyComponent[]>();
  for (const component of components) {
    const key = `${component.projectId}/${component.parentId ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), component]);
  }
  const renumbered = new Map<string, PolicyComponent>();
  for (const group of groups.values()) {
    for (const component of renumberPositions(group)) renumbered.set(component.id, component);
  }
  return components.map((component) => renumbered.get(component.id)!);
}

/**
 * Alcance mínimo para as coleções que nenhum comando escreve ainda
 * (`changeRequests`, `releases`, `attachments` — S32b/S34): **união por id**,
 * lado esquerdo com preferência quando o id existe nos dois. Não perder o dado
 * é o requisito; comparar campo a campo um DB ou uma release é da S32b, junto
 * dos comandos que os criam.
 */
function unionById<T extends { id: string }>(
  ctx: MergeCtx,
  mine: T[],
  theirs: T[],
  noun: string,
): T[] {
  const mineById = byId(mine);
  const out = mine.map(clone);
  let fromTheirs = 0;
  for (const item of theirs) {
    if (mineById.has(item.id)) continue;
    out.push(clone(item));
    fromTheirs++;
  }
  if (fromTheirs > 0) {
    addAction(ctx, {
      kind: 'UNION_GOVERNANCE',
      side: 'THEIRS',
      entity: { kind: 'DOCUMENT', id: 'governance', label: noun },
      summary: `${fromTheirs} ${noun} existia(m) só no arquivo e entra(m) por união.`,
    });
  }
  return out;
}

/**
 * I12: uma única regra de compatibilidade publicada por par (pai, filho). Dois
 * lados podem ter criado e publicado regras diferentes para o mesmo par —
 * descartar uma delas seria perder trabalho, então a mais recente fica vigente
 * e a outra passa a substituída, sinalizada.
 */
function normalizeCompatibilityPairs(ctx: MergeCtx, rules: CompatibilityRule[]): CompatibilityRule[] {
  const out = rules.map(clone);
  const groups = new Map<string, CompatibilityRule[]>();
  for (const rule of out) {
    if (!rule.versions.some((version) => version.state === 'PUBLISHED')) continue;
    const key = `${rule.parentVariableId}|${rule.childVariableId}`;
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const publishedAtOf = (rule: CompatibilityRule): string =>
      rule.versions.find((version) => version.state === 'PUBLISHED')?.publishedAt ?? rule.createdAt;
    const ordered = [...group].sort(
      (a, b) => publishedAtOf(a).localeCompare(publishedAtOf(b)) || a.id.localeCompare(b.id),
    );
    const current = ordered[ordered.length - 1]!;
    for (const rule of ordered) {
      if (rule.id === current.id) continue;
      const version = rule.versions.find((candidate) => candidate.state === 'PUBLISHED')!;
      version.state = 'SUPERSEDED';
      addAction(ctx, {
        kind: 'LIFECYCLE_ADVANCED',
        side: 'BOTH',
        entity: entityRef(COMPATIBILITY_SPEC, rule),
        summary: `As regras "${rule.code}" e "${current.code}" cobrem o mesmo par de variáveis e as duas estavam publicadas (I12). "${current.code}" fica vigente e "${rule.code}" passa a substituída — nada foi descartado.`,
        needsReview: true,
      });
    }
  }
  return out;
}

/**
 * Mescla dois documentos que descendem do mesmo arquivo.
 *
 * Sem `resolutions`, cada conflito é aplicado com o seu `defaultChoice` — a
 * função é total e sempre devolve um documento válido. A tela de merge chama
 * de novo, com as decisões do usuário, e mostra o resultado antes de gravar.
 */
export function mergeDocuments(
  mine: PolicyOpsDocument,
  theirs: PolicyOpsDocument,
  options: MergeOptions = {},
): MergeResult {
  const mineEventIds = new Set(mine.events.map((event) => event.id));
  const theirsEventIds = new Set(theirs.events.map((event) => event.id));

  const ctx: MergeCtx = {
    mine,
    theirs,
    resolutions: options.resolutions ?? {},
    at: options.at ?? latestInstant(mine, theirs),
    actions: [],
    conflicts: [],
    mineOnlyEvents: mine.events.filter((event) => !theirsEventIds.has(event.id)),
    theirsOnlyEvents: theirs.events.filter((event) => !mineEventIds.has(event.id)),
    usedIds: new Set<string>(),
    provenance: new Map<string, MergeSide | 'BOTH'>(),
  };

  for (const document of [mine, theirs]) {
    for (const matrix of document.matrices) {
      for (const version of matrix.versions) ctx.usedIds.add(version.id);
    }
  }

  const meta = mergeMeta(ctx);
  const variables = mergeLibraryCollection(ctx, mine.variables, theirs.variables, VARIABLE_SPEC, 'A variável');
  const compatibility = normalizeCompatibilityPairs(
    ctx,
    mergeLibraryCollection(
      ctx,
      mine.compatibility,
      theirs.compatibility,
      COMPATIBILITY_SPEC,
      'A regra de compatibilidade',
    ),
  );
  const catalog = renumberCatalogPositions(mergeFlatCollection(ctx, mine.catalog, theirs.catalog, CATALOG_SPEC));
  const projects = renumberPositions(mergeFlatCollection(ctx, mine.projects, theirs.projects, PROJECT_SPEC));
  const templates = mergeFlatCollection(ctx, mine.templates, theirs.templates, TEMPLATE_SPEC);
  const importProfiles = mergeFlatCollection(
    ctx,
    mine.importProfiles,
    theirs.importProfiles,
    IMPORT_PROFILE_SPEC,
  );
  const components = mergeComponents(ctx);
  const changeRequests = unionById<ChangeRequest>(
    ctx,
    mine.changeRequests,
    theirs.changeRequests,
    'solicitação(ões) de alteração',
  );
  const releases = unionById<Release>(ctx, mine.releases, theirs.releases, 'release(s)');
  const attachments = unionById<Attachment>(
    ctx,
    mine.attachments ?? [],
    theirs.attachments ?? [],
    'anexo(s)',
  );
  const matrices = mergeMatrices(ctx);
  const events = mergeEvents(ctx);

  const merged: PolicyOpsDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta,
    variables,
    compatibility,
    catalog,
    projects,
    matrices,
    templates,
    importProfiles,
    components,
    changeRequests,
    releases,
    events,
  };
  // Lista vazia não é gravada (docs/03 §1): o campo é opcional e some inteiro.
  if (attachments.length > 0) merged.attachments = attachments;

  resolveCodeClashes(ctx, 'variables', 'VARIABLE', 'A variável', merged.variables, (entity, code) => {
    merged.variables.find((variable) => variable.id === entity.id)!.code = code;
  });
  resolveCodeClashes(ctx, 'compatibility', 'COMPATIBILITY', 'A regra', merged.compatibility, (entity, code) => {
    merged.compatibility.find((rule) => rule.id === entity.id)!.code = code;
  });
  resolveCodeClashes(ctx, 'projects', 'PROJECT', 'O projeto', merged.projects, (entity, code) => {
    merged.projects.find((project) => project.id === entity.id)!.code = code;
  });
  resolveCodeClashes(ctx, 'templates', 'TEMPLATE', 'O template', merged.templates, (entity, code) => {
    merged.templates.find((template) => template.id === entity.id)!.code = code;
  });
  resolveCodeClashes(
    ctx,
    'importProfiles',
    'IMPORT_PROFILE',
    'O perfil de carga',
    merged.importProfiles,
    (entity, code) => {
      merged.importProfiles.find((profile) => profile.id === entity.id)!.code = code;
    },
  );
  for (const kind of ['DECISION', 'OFFER', 'LIMIT', 'TAG'] as const) {
    resolveCodeClashes(
      ctx,
      `catalog:${kind}`,
      'CATALOG',
      'O item de catálogo',
      merged.catalog.filter((item) => item.kind === kind),
      (entity, code, side) => {
        const item = merged.catalog.find((candidate) => candidate.id === entity.id)!;
        const from = item.code;
        item.code = code;
        rewriteCatalogCode(merged, ctx, item, from, code, side);
      },
    );
  }
  for (const project of merged.projects) {
    resolveCodeClashes(
      ctx,
      `components:${project.id}`,
      'COMPONENT',
      'O componente',
      merged.components.filter((component) => component.projectId === project.id),
      (entity, code) => {
        merged.components.find((component) => component.id === entity.id)!.code = code;
      },
    );
    resolveCodeClashes(
      ctx,
      `matrices:${project.id}`,
      'MATRIX',
      'A matriz',
      merged.matrices.filter((matrix) => matrix.projectId === project.id),
      (entity, code) => {
        merged.matrices.find((matrix) => matrix.id === entity.id)!.code = code;
      },
    );
  }

  return { merged, applied: ctx.actions, conflicts: ctx.conflicts };
}
