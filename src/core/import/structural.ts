import { decodePath } from '../axes/paths';
import type { Command, Ctx } from '../command';
import type {
  Axis,
  AxisRole,
  Cell,
  Domain,
  Matrix,
  MatrixVersion,
  PolicyOpsDocument,
} from '../document/schema';
import { DomainError } from '../errors';
import {
  createCompatibility,
  createCompatibilityDraft,
  publishCompatibility,
  saveCompatibilityMap,
} from '../library/compatibility';
import { createVariableDraft, publishVariable, saveVariableDomains } from '../library/variables';
import { computeResnapshot, type ResnapshotPlan } from '../reconcile/resnapshot';
import { createDraft as createMatrixDraft } from '../versioning/lifecycle';
import type { ImportPlan, MatrixPlan, UnknownTuple } from './plan';

/**
 * Resolução assistida de divergência estrutural — docs/12-carga-de-matrizes.md
 * RN-06, CT-03 e §7 (S25); docs/05-regras-de-negocio.md §5 (evolução da
 * biblioteca); docs/04-eixos-aninhados.md §3 e §5; docs/13-decisoes.md
 * DEC-CARGA-009.
 *
 * `planStructuralChanges` é **puro**: não escreve no documento recebido. Para
 * calcular o `ResnapshotPlan` sem duplicar o motor de `computeResnapshot`, ele
 * monta um documento de trabalho descartável — aplica de verdade, em memória,
 * os mesmos comandos que `applyStructural` aplicaria de verdade no documento
 * do usuário (`variable/createDraft` + `saveDomains`, `compat/*`,
 * `version/createDraft`) e chama `computeResnapshot` sobre ele. O documento de
 * trabalho nunca sai desta função.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Domínios a acrescentar numa variável de eixo, deduzidos das tuplas desconhecidas. */
export type StructuralDomainChange = {
  variableId: string;
  variableCode: string;
  axis: AxisRole;
  level: number;
  /** Versão publicada de onde os domínios atuais vieram; `null` se a variável nunca publicou. */
  fromVersionNumber: number | null;
  /** Só os domínios **novos** — os que a variável ainda não tem. */
  domains: Domain[];
};

/** Alteração no mapa de compatibilidade entre dois níveis adjacentes do mesmo eixo. */
export type StructuralCompatibilityChange = {
  parentVariableId: string;
  parentVariableCode: string;
  childVariableId: string;
  childVariableCode: string;
  axis: AxisRole;
  /** Já existe regra publicada para o par — o mapa abaixo só a completa. */
  exists: boolean;
  /** O mapa completo (existente + pares novos observados no arquivo). */
  allow: Record<string, string[]>;
  /** Só os pares que o arquivo trouxe e a regra atual não permitia. */
  addedPairs: Array<[string, string]>;
};

export type StructuralPlan = {
  /** `MatrixPlan.key` — a mesma chave usada no plano da carga. */
  key: string;
  code: string;
  name: string;
  matrixId: string;
  baseVersionId: string;
  domainChanges: StructuralDomainChange[];
  compatibilityChanges: StructuralCompatibilityChange[];
  /** Um `ResnapshotPlan` por eixo afetado — normalmente só um, às vezes os dois. */
  resnapshot: Partial<Record<AxisRole, ResnapshotPlan>>;
  /** Combinações que passam a existir, somadas entre os eixos afetados. */
  newCombinations: number;
  /** Combinações que deixam de existir — deve ser sempre zero (a resolução nunca remove). */
  droppedCombinations: number;
  /** Células que seriam perdidas — deve ser sempre vazio (ver `droppedCombinations`). */
  lostCells: Array<{ key: string; cell: Cell }>;
};

// ---------------------------------------------------------------------------
// Ctx determinístico para o documento de trabalho descartável
// ---------------------------------------------------------------------------

function scratchCtx(): Ctx {
  let counter = 0;
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    actor: 'sistema',
    now: () => now,
    newId: () => `structural-preview-${(counter += 1)}`,
  };
}

// ---------------------------------------------------------------------------
// Dedução dos domínios e da compatibilidade a partir das tuplas desconhecidas
// ---------------------------------------------------------------------------

/**
 * Rótulo de exibição a partir do código, quando não há mais o texto original
 * do arquivo à mão (o plano da carga só guarda o código já resolvido e a
 * linha, não o rótulo bruto — `ImportPlan.unknownTuples`). Decisão de
 * implementação, não de arquitetura: o domínio nasce com este rótulo e pode
 * ser editado depois pelo editor normal da biblioteca, como qualquer domínio.
 */
function humanizeCode(code: string): string {
  return code
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => (part.length <= 3 ? part : part[0] + part.slice(1).toLowerCase()))
    .join(' ');
}

type LevelInfo = { variableId: string; variableCode: string; existingCodes: Set<string>; maxPosition: number };

/**
 * O que já existe **na biblioteca**, não no snapshot congelado da matriz — é a
 * pergunta certa para decidir se falta criar um domínio. `resolveImport`
 * (`resolve.ts`) só deixa passar, para uma coluna de eixo, um valor cujo
 * código já é domínio **publicado** da variável (`IMPORT_UNMAPPED_VALUE` barra
 * o resto, e bloqueia o plano inteiro — RN-16); então todo código que aparece
 * em `unknownTuples` já existe na variável quando o passo 3 do assistente
 * (US-04) foi seguido antes do plano. O caso comum de `STRUCTURAL`, por isso,
 * é a matriz **atrasada** em relação à biblioteca (a combinação já existe lá,
 * só falta o resnapshot desta matriz) — e é por isso que a checagem usa a
 * versão publicada da variável, não `level.domains` da matriz: comparar contra
 * o snapshot congelado criaria um domínio "novo" que já existe, e
 * `variable/saveDomains` rejeitaria o código duplicado. O caminho de domínio
 * genuinamente novo continua suportado (o `variable/createDraft` +
 * `saveDomains` + `publish` de `applyLibrarySteps` roda de qualquer forma
 * quando o código não está nem na biblioteca), só não é o caminho comum.
 */
function levelInfos(doc: PolicyOpsDocument, axis: Axis): LevelInfo[] {
  return axis.levels.map((level) => {
    const variable = doc.variables.find((candidate) => candidate.id === level.variableId);
    const published = variable?.versions.find((version) => version.state === 'PUBLISHED');
    const domains = published?.domains ?? level.domains;
    return {
      variableId: level.variableId,
      variableCode: variable?.code ?? level.variableId,
      existingCodes: new Set(domains.map((domain) => domain.code)),
      maxPosition: domains.reduce((max, domain) => Math.max(max, domain.position), -1),
    };
  });
}

/**
 * A partir das tuplas desconhecidas de um eixo, deduz os domínios que faltam
 * em cada nível e os pares de compatibilidade que faltam entre níveis
 * adjacentes — a mesma leitura de `unknownTuplesOf` (`plan.ts`), desta vez
 * decompondo o caminho em códigos por nível (docs/04 §2).
 */
function deduceAxisChanges(
  doc: PolicyOpsDocument,
  axis: Axis,
  role: AxisRole,
  unknown: readonly UnknownTuple[],
): { domains: StructuralDomainChange[]; compatibility: StructuralCompatibilityChange[] } {
  const infos = levelInfos(doc, axis);
  const newDomainsByLevel: Domain[][] = infos.map(() => []);
  const seenByLevel: Array<Set<string>> = infos.map((info) => new Set(info.existingCodes));
  const pairsByLevel = new Map<number, Map<string, Set<string>>>(); // key = level index of child

  for (const tuple of unknown) {
    if (tuple.role !== role) continue;
    const codes = decodePath(tuple.path);
    for (let index = 0; index < codes.length; index += 1) {
      const code = codes[index]!;
      const info = infos[index];
      if (info === undefined) continue;
      if (!seenByLevel[index]!.has(code)) {
        seenByLevel[index]!.add(code);
        newDomainsByLevel[index]!.push({
          code,
          label: humanizeCode(code),
          position: info.maxPosition + 1 + newDomainsByLevel[index]!.length,
        });
      }
      if (index > 0) {
        const parentCode = codes[index - 1]!;
        const bucket = pairsByLevel.get(index) ?? new Map<string, Set<string>>();
        const children = bucket.get(parentCode) ?? new Set<string>();
        children.add(code);
        bucket.set(parentCode, children);
        pairsByLevel.set(index, bucket);
      }
    }
  }

  const domains: StructuralDomainChange[] = [];
  infos.forEach((info, index) => {
    if (newDomainsByLevel[index]!.length === 0) return;
    const variable = doc.variables.find((candidate) => candidate.id === info.variableId);
    const published = variable?.versions.find((version) => version.state === 'PUBLISHED');
    domains.push({
      variableId: info.variableId,
      variableCode: info.variableCode,
      axis: role,
      level: index,
      fromVersionNumber: published?.number ?? null,
      domains: newDomainsByLevel[index]!,
    });
  });

  const compatibility: StructuralCompatibilityChange[] = [];
  for (const [childIndex, bucket] of pairsByLevel) {
    const parentInfo = infos[childIndex - 1]!;
    const childInfo = infos[childIndex]!;
    const rule = doc.compatibility.find(
      (candidate) =>
        candidate.archivedAt === undefined &&
        candidate.parentVariableId === parentInfo.variableId &&
        candidate.childVariableId === childInfo.variableId,
    );
    const published = rule?.versions.find((version) => version.state === 'PUBLISHED');
    const allow: Record<string, string[]> = published === undefined ? {} : structuredCloneAllow(published.allow);
    const addedPairs: Array<[string, string]> = [];
    for (const [parentCode, children] of bucket) {
      const current = new Set(allow[parentCode] ?? []);
      let changed = false;
      for (const childCode of children) {
        if (!current.has(childCode)) {
          current.add(childCode);
          addedPairs.push([parentCode, childCode]);
          changed = true;
        }
      }
      if (changed || allow[parentCode] === undefined) {
        allow[parentCode] = [...current];
      }
    }
    if (addedPairs.length === 0) continue;
    compatibility.push({
      parentVariableId: parentInfo.variableId,
      parentVariableCode: parentInfo.variableCode,
      childVariableId: childInfo.variableId,
      childVariableCode: childInfo.variableCode,
      axis: role,
      exists: published !== undefined,
      allow,
      addedPairs,
    });
  }

  return { domains, compatibility };
}

function structuredCloneAllow(allow: Record<string, string[]>): Record<string, string[]> {
  const copy: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(allow)) copy[key] = [...values];
  return copy;
}

// ---------------------------------------------------------------------------
// Aplicação (real ou em documento de trabalho descartável) dos comandos de
// biblioteca — compartilhada entre `planStructuralChanges` e `applyStructural`.
// ---------------------------------------------------------------------------

export type StructuralRun = { doc: PolicyOpsDocument; inverses: Command[] };

function runStep<O>(run: StructuralRun, ctx: Ctx, command: Command<unknown, O>): O {
  const result = command.run(run.doc, ctx);
  if (!result.ok) throw result.error;
  run.doc = result.document;
  run.inverses.push(result.inverse);
  return result.data;
}

/**
 * Aplica os domínios e o mapa de compatibilidade de um `StructuralPlan` sobre
 * `run.doc` — pelos comandos normais da biblioteca (RN-17: a carga nunca tem
 * caminho privilegiado de escrita). Usada tanto pelo preview (documento
 * descartável) quanto pela aplicação real.
 */
export function applyLibrarySteps(
  run: StructuralRun,
  ctx: Ctx,
  domainChanges: readonly StructuralDomainChange[],
  compatibilityChanges: readonly StructuralCompatibilityChange[],
): void {
  for (const change of domainChanges) {
    const draft = runStep(run, ctx, createVariableDraft({ variableId: change.variableId }));
    const variable = run.doc.variables.find((candidate) => candidate.id === change.variableId)!;
    const draftVersion = variable.versions.find((version) => version.id === draft.versionId)!;
    runStep(
      run,
      ctx,
      saveVariableDomains({
        variableId: change.variableId,
        versionId: draft.versionId,
        domains: [...draftVersion.domains, ...change.domains],
        ...(draftVersion.groupingDimensions === undefined
          ? {}
          : { groupingDimensions: draftVersion.groupingDimensions }),
        ...(draftVersion.boundaryMode === undefined ? {} : { boundaryMode: draftVersion.boundaryMode }),
      }),
    );
    runStep(
      run,
      ctx,
      publishVariable({
        variableId: change.variableId,
        versionId: draft.versionId,
        notes: `Resolução de estrutura da carga — domínio(s) ${change.domains.map((domain) => domain.code).join(', ')}.`,
      }),
    );
  }

  for (const change of compatibilityChanges) {
    let ruleId: string;
    if (!change.exists) {
      const created = runStep(
        run,
        ctx,
        createCompatibility({
          code: `AUTO_${change.parentVariableCode}_${change.childVariableCode}`.slice(0, 64),
          name: `${change.parentVariableCode} × ${change.childVariableCode}`,
          parentVariableId: change.parentVariableId,
          childVariableId: change.childVariableId,
        }),
      );
      ruleId = created.ruleId;
      runStep(
        run,
        ctx,
        saveCompatibilityMap({
          ruleId,
          versionId: created.versionId,
          allow: change.allow,
          defaultForUnlisted: 'NONE',
        }),
      );
      runStep(
        run,
        ctx,
        publishCompatibility({
          ruleId,
          versionId: created.versionId,
          notes: 'Resolução de estrutura da carga — mapa criado a partir do arquivo.',
        }),
      );
      continue;
    }
    const rule = run.doc.compatibility.find(
      (candidate) =>
        candidate.parentVariableId === change.parentVariableId &&
        candidate.childVariableId === change.childVariableId &&
        candidate.archivedAt === undefined,
    )!;
    ruleId = rule.id;
    const draft = runStep(run, ctx, createCompatibilityDraft({ ruleId }));
    runStep(
      run,
      ctx,
      saveCompatibilityMap({
        ruleId,
        versionId: draft.versionId,
        allow: change.allow,
        defaultForUnlisted: 'NONE',
      }),
    );
    runStep(
      run,
      ctx,
      publishCompatibility({
        ruleId,
        versionId: draft.versionId,
        notes: 'Resolução de estrutura da carga — pares novos do arquivo.',
      }),
    );
  }
}

// `publishVariable`/`publishCompatibility` são irreversíveis por desenho (I3 —
// versão publicada nunca é reescrita, `docs/05-regras-de-negocio.md` §1): o
// próprio comando devolve `irreversible(...)` como inverso. `applyStructural`
// aceita essa mesma assimetria que já existe em todo o resto do sistema — o
// "inverso íntegro" pedido pela sessão cobre tudo o que é reversível por
// desenho (rascunhos de variável/compatibilidade, o rascunho da matriz e o
// resnapshot); a publicação da biblioteca, como em qualquer outro fluxo do
// PolicyOps, não volta atrás sozinha. Ver nota no relatório da sessão.

// ---------------------------------------------------------------------------
// planStructuralChanges — puro
// ---------------------------------------------------------------------------

function axisOfVersion(version: MatrixVersion, role: AxisRole): Axis {
  return role === 'X' ? version.axes.x : version.axes.y;
}

/**
 * Um `StructuralPlan` por matriz `STRUCTURAL` do plano da carga — o que
 * precisa mudar na biblioteca e na estrutura da matriz para que ela deixe de
 * divergir, e o impacto (`ResnapshotPlan`) de aplicar isso. Função pura: o
 * documento de trabalho usado para calcular o `ResnapshotPlan` nunca é
 * devolvido nem escrito de volta em `doc`.
 */
export function planStructuralChanges(
  doc: PolicyOpsDocument,
  plan: ImportPlan,
): StructuralPlan[] {
  const results: StructuralPlan[] = [];

  for (const matrixPlan of plan.matrices) {
    if (matrixPlan.status !== 'STRUCTURAL') continue;
    if (matrixPlan.matrixId === undefined || matrixPlan.baseVersionId === undefined) continue;
    const matrix = doc.matrices.find((candidate) => candidate.id === matrixPlan.matrixId);
    const version = matrix?.versions.find((candidate) => candidate.id === matrixPlan.baseVersionId);
    if (matrix === undefined || version === undefined) continue;

    results.push(buildStructuralPlan(doc, matrix, version, matrixPlan));
  }

  return results;
}

function buildStructuralPlan(
  doc: PolicyOpsDocument,
  matrix: Matrix,
  baseVersion: MatrixVersion,
  matrixPlan: MatrixPlan,
): StructuralPlan {
  const roles: AxisRole[] = ['X', 'Y'];
  const domainChanges: StructuralDomainChange[] = [];
  const compatibilityChanges: StructuralCompatibilityChange[] = [];
  const affectedRoles: AxisRole[] = [];

  for (const role of roles) {
    const axis = axisOfVersion(baseVersion, role);
    const deduced = deduceAxisChanges(doc, axis, role, matrixPlan.unknownTuples);
    if (deduced.domains.length === 0 && deduced.compatibility.length === 0) continue;
    affectedRoles.push(role);
    domainChanges.push(...deduced.domains);
    compatibilityChanges.push(...deduced.compatibility);
  }

  // Monta o documento de trabalho descartável: aplica de verdade os mesmos
  // passos de biblioteca, cria um rascunho da matriz e resnapshota — só para
  // ler o `ResnapshotPlan` resultante. Nada disto sai desta função.
  const ctx = scratchCtx();
  const run: StructuralRun = { doc, inverses: [] };
  applyLibrarySteps(run, ctx, domainChanges, compatibilityChanges);
  const draftVersionId = runStep(
    run,
    ctx,
    createMatrixDraft({ matrixId: matrix.id, baseVersionId: baseVersion.id }),
  ).versionId;

  const resnapshot: Partial<Record<AxisRole, ResnapshotPlan>> = {};
  let newCombinations = 0;
  let droppedCombinations = 0;
  const lostCells: Array<{ key: string; cell: Cell }> = [];

  let workingVersion = run.doc.matrices
    .find((candidate) => candidate.id === matrix.id)!
    .versions.find((candidate) => candidate.id === draftVersionId)!;

  for (const role of affectedRoles) {
    const computed = computeResnapshot(run.doc, workingVersion, role);
    resnapshot[role] = computed.plan;
    newCombinations += computed.plan.newCombinations;
    droppedCombinations += computed.plan.droppedCombinations;
    lostCells.push(...computed.plan.droppedCells);
    // Encadeia: o segundo eixo (quando os dois divergem) resnapshota sobre o
    // resultado do primeiro, não sobre o rascunho original.
    workingVersion = computed.version;
  }

  if (droppedCombinations > 0 || lostCells.length > 0) {
    // Não deveria acontecer nunca (a resolução só acrescenta domínios), mas se
    // acontecer é melhor travar alto e alto do que silenciar uma perda de
    // célula (RN-01, acceptance criteria da S25).
    throw new DomainError(
      'IMPORT_STRUCTURE_RESOLUTION_INVALID',
      `A resolução estrutural de "${matrixPlan.code}" perderia células — isso não deveria acontecer numa resolução que só acrescenta domínios.`,
      { code: matrixPlan.code, droppedCombinations, lostCells: lostCells.length },
    );
  }

  return {
    key: matrixPlan.key,
    code: matrixPlan.code,
    name: matrixPlan.name,
    matrixId: matrix.id,
    baseVersionId: baseVersion.id,
    domainChanges,
    compatibilityChanges,
    resnapshot,
    newCombinations,
    droppedCombinations,
    lostCells,
  };
}

// ---------------------------------------------------------------------------
// Agrupamento em lote — matrizes que compartilham a mesma mudança de biblioteca
// ---------------------------------------------------------------------------

/** Assinatura da mudança de biblioteca de um `StructuralPlan` — mesma assinatura = mesmo lote. */
export function libraryChangeSignature(plan: StructuralPlan): string {
  const domains = plan.domainChanges
    .map((change) => `${change.variableId}:${change.domains.map((domain) => domain.code).sort().join(',')}`)
    .sort();
  const compat = plan.compatibilityChanges
    .map(
      (change) =>
        `${change.parentVariableId}>${change.childVariableId}:${change.addedPairs
          .map(([parent, child]) => `${parent}-${child}`)
          .sort()
          .join(',')}`,
    )
    .sort();
  return JSON.stringify({ domains, compat });
}

/** Agrupa os `StructuralPlan`s por mudança de biblioteca idêntica — ação em lote da interface. */
export function groupByLibraryChange(plans: readonly StructuralPlan[]): StructuralPlan[][] {
  const groups = new Map<string, StructuralPlan[]>();
  for (const plan of plans) {
    const signature = libraryChangeSignature(plan);
    const bucket = groups.get(signature) ?? [];
    bucket.push(plan);
    groups.set(signature, bucket);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Mesclagem — a mesma mudança de biblioteca não é aplicada duas vezes
// ---------------------------------------------------------------------------

/**
 * Uma variável (ou par de compatibilidade) pode faltar o mesmo domínio para
 * **várias** matrizes `STRUCTURAL` do lote — cada `StructuralPlan` foi
 * calculado independentemente, contra o mesmo documento original
 * (`planStructuralChanges` nunca escreve). Aplicar o lote matriz a matriz sem
 * mesclar chamaria `variable/createDraft` duas vezes para a mesma variável, e
 * a segunda leva `DRAFT_ALREADY_EXISTS` — ou, pior, tentaria recriar um
 * domínio que a primeira matriz do lote já publicou. `mergeDomainChanges` e
 * `mergeCompatibilityChanges` juntam os pedidos por variável/par, de modo que
 * `applyStructural` aplique a mudança de biblioteca **uma vez** para o lote
 * inteiro, e só então crie o rascunho e o resnapshot de cada matriz.
 */
export function mergeDomainChanges(
  plans: readonly StructuralPlan[],
): StructuralDomainChange[] {
  const byVariable = new Map<string, StructuralDomainChange>();
  for (const plan of plans) {
    for (const change of plan.domainChanges) {
      const existing = byVariable.get(change.variableId);
      if (existing === undefined) {
        byVariable.set(change.variableId, { ...change, domains: [...change.domains] });
        continue;
      }
      const seen = new Set(existing.domains.map((domain) => domain.code));
      let nextPosition = existing.domains.reduce((max, domain) => Math.max(max, domain.position), -1) + 1;
      for (const domain of change.domains) {
        if (!seen.has(domain.code)) {
          seen.add(domain.code);
          existing.domains.push({ ...domain, position: nextPosition });
          nextPosition += 1;
        }
      }
    }
  }
  return [...byVariable.values()];
}

export function mergeCompatibilityChanges(
  plans: readonly StructuralPlan[],
): StructuralCompatibilityChange[] {
  const byPair = new Map<string, StructuralCompatibilityChange>();
  for (const plan of plans) {
    for (const change of plan.compatibilityChanges) {
      const key = `${change.parentVariableId}>${change.childVariableId}`;
      const existing = byPair.get(key);
      if (existing === undefined) {
        byPair.set(key, {
          ...change,
          allow: structuredCloneAllow(change.allow),
          addedPairs: [...change.addedPairs],
        });
        continue;
      }
      for (const [parentCode, childCode] of change.addedPairs) {
        const current = new Set(existing.allow[parentCode] ?? []);
        if (!current.has(childCode)) {
          current.add(childCode);
          existing.allow[parentCode] = [...current];
          existing.addedPairs.push([parentCode, childCode]);
        }
      }
    }
  }
  return [...byPair.values()];
}
