import { expect } from 'vitest';
import { allCombinations } from '@/core/axes/combinations';
import type { Command, CommandResult, Ctx } from '@/core/command';
import { applyCellPatch, type PatchCoord } from '@/core/versioning/cells';
import {
  createDraft,
  createMatrix,
  discardDraft,
  locateVersion,
  publishVersion,
  type CreateMatrixData,
} from '@/core/versioning/lifecycle';
import type {
  CatalogItem,
  Domain,
  PolicyOpsDocument,
  Variable,
  VariableVersion,
} from '@/core/document/schema';
import { DomainError, type DomainErrorCode } from '@/core/errors';

/**
 * Fixtures da camada de comandos.
 *
 * Os ids são legíveis **e** válidos: `nanoid(12)` usa o alfabeto
 * `[A-Za-z0-9_-]`, então um rótulo curto preenchido com `_` até 12 caracteres
 * passa por `idSchema`. Isso deixa as falhas auto-explicativas sem abrir mão de
 * poder rodar `validateDocument` sobre o resultado.
 */
export function fixedId(label: string): string {
  if (label.length > 12) throw new Error(`Rótulo de id longo demais: "${label}".`);
  return label.padEnd(12, '_');
}

/** Instante inicial de todo teste: 1º de janeiro de 2026, meia-noite UTC. */
export const T0 = '2026-01-01T00:00:00.000Z';

export type TestCtx = Ctx & {
  /** Avança o relógio determinístico em `ms` milissegundos. */
  advance: (ms: number) => void;
  /** Define o instante atual. */
  setNow: (iso: string) => void;
};

/**
 * `Ctx` determinístico: o mesmo comando com o mesmo `ctx` produz exatamente o
 * mesmo documento. É o que a regra 1 de docs/08 §1 compra.
 */
export function testCtx(actor = 'Arthur', startISO = T0): TestCtx {
  let clock = new Date(startISO).getTime();
  let sequence = 0;
  return {
    actor,
    now: () => new Date(clock),
    newId: () => {
      sequence += 1;
      return `id-${String(sequence).padStart(9, '0')}`;
    },
    advance: (ms) => {
      clock += ms;
    },
    setNow: (iso) => {
      clock = new Date(iso).getTime();
    },
  };
}

export const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Documento base
// ---------------------------------------------------------------------------

function domains(...codes: string[]): Domain[] {
  return codes.map((code, position) => ({ code, label: `Rótulo ${code}`, position }));
}

function manyDomains(prefix: string, count: number): Domain[] {
  return Array.from({ length: count }, (_unused, position) => ({
    code: `${prefix}${position}`,
    label: `${prefix} ${position}`,
    position,
  }));
}

function publishedVersion(id: string, versionDomains: Domain[], number = 1): VariableVersion {
  return {
    id,
    number,
    state: 'PUBLISHED',
    createdAt: T0,
    createdBy: 'Equipe',
    publishedAt: T0,
    publishedBy: 'Equipe',
    domains: versionDomains,
  };
}

function variable(
  id: string,
  code: string,
  name: string,
  versions: VariableVersion[],
): Variable {
  return { id, code, name, type: 'CATEGORICAL', createdAt: T0, versions };
}

export const IDS = {
  score: fixedId('score'),
  scoreV1: fixedId('scoreV1'),
  scoreV2: fixedId('scoreV2'),
  restritivo: fixedId('restr'),
  restritivoV1: fixedId('restrV1'),
  segmento: fixedId('segmento'),
  segmentoV1: fixedId('segmentoV1'),
  fat: fixedId('fat'),
  fatV1: fixedId('fatV1'),
  semPublicada: fixedId('sempub'),
  semPublicadaV1: fixedId('sempubV1'),
  bigX: fixedId('bigx'),
  bigXV1: fixedId('bigxV1'),
  bigY: fixedId('bigy'),
  bigYV1: fixedId('bigyV1'),
  compatRule: fixedId('segxfat'),
  compatV1: fixedId('segxfatV1'),
  projectA: fixedId('projA'),
  projectB: fixedId('projB'),
} as const;

export const SCORE_DOMAINS = domains('R1', 'R2', 'R3');
export const RESTRITIVO_DOMAINS = domains('SEM', 'ALTO');
export const SEGMENTO_DOMAINS = domains('VAREJO', 'ATACADO', 'CORPORATE');
export const FAT_DOMAINS = domains('ATE_100K', '100K_500K', '500K_1M', '1M_10M', 'ACIMA_10M');

/** As 8 tuplas de `SEGMENTO › FAT` sob a regra publicada, na ordem do grid. */
export const SEG_X_FAT_TUPLES = [
  'VAREJO|ATE_100K',
  'VAREJO|100K_500K',
  'VAREJO|500K_1M',
  'ATACADO|500K_1M',
  'ATACADO|1M_10M',
  'ATACADO|ACIMA_10M',
  'CORPORATE|1M_10M',
  'CORPORATE|ACIMA_10M',
];

function catalogItem(
  id: string,
  kind: CatalogItem['kind'],
  code: string,
  label: string,
  position: number,
  extra: Partial<CatalogItem> = {},
): CatalogItem {
  return { id, kind, code, label, position, createdAt: T0, ...extra };
}

/**
 * Documento base: bibliotecas prontas, dois projetos, nenhuma matriz. As
 * matrizes nascem pelos próprios comandos — testar o ciclo de vida contra uma
 * matriz montada à mão esconderia justamente o que está sendo testado.
 */
export function baseDocument(): PolicyOpsDocument {
  return {
    schemaVersion: 4,
    meta: {
      id: fixedId('doc'),
      name: 'Documento de teste',
      revision: 0,
      savedAt: null,
      savedBy: null,
      appVersion: '0.1.0',
      createdAt: T0,
    },
    variables: [
      variable(IDS.score, 'SCORE', 'Score', [publishedVersion(IDS.scoreV1, SCORE_DOMAINS)]),
      variable(IDS.restritivo, 'RESTRITIVO', 'Restritivo', [
        publishedVersion(IDS.restritivoV1, RESTRITIVO_DOMAINS),
      ]),
      variable(IDS.segmento, 'SEGMENTO', 'Segmento', [
        publishedVersion(IDS.segmentoV1, SEGMENTO_DOMAINS),
      ]),
      variable(IDS.fat, 'FAT', 'Faturamento', [publishedVersion(IDS.fatV1, FAT_DOMAINS)]),
      variable(IDS.semPublicada, 'SEM_PUB', 'Sem versão publicada', [
        {
          id: IDS.semPublicadaV1,
          number: 1,
          state: 'DRAFT',
          createdAt: T0,
          createdBy: 'Equipe',
          domains: domains('A', 'B'),
        },
      ]),
      variable(IDS.bigX, 'BIG_X', 'Eixo grande X', [
        publishedVersion(IDS.bigXV1, manyDomains('X', 30)),
      ]),
      variable(IDS.bigY, 'BIG_Y', 'Eixo grande Y', [
        publishedVersion(IDS.bigYV1, manyDomains('Y', 21)),
      ]),
    ],
    compatibility: [
      {
        id: IDS.compatRule,
        code: 'SEG_X_FATURAMENTO',
        name: 'Segmento × Faturamento',
        parentVariableId: IDS.segmento,
        childVariableId: IDS.fat,
        createdAt: T0,
        versions: [
          {
            id: IDS.compatV1,
            number: 1,
            state: 'PUBLISHED',
            createdAt: T0,
            createdBy: 'Equipe',
            publishedAt: T0,
            publishedBy: 'Equipe',
            parentVariableVersionId: IDS.segmentoV1,
            childVariableVersionId: IDS.fatV1,
            allow: {
              VAREJO: ['ATE_100K', '100K_500K', '500K_1M'],
              ATACADO: ['500K_1M', '1M_10M', 'ACIMA_10M'],
              CORPORATE: ['1M_10M', 'ACIMA_10M'],
            },
            defaultForUnlisted: 'NONE',
          },
        ],
      },
    ],
    catalog: [
      catalogItem(fixedId('catAprov'), 'DECISION', 'APROVADO', 'Aprovado', 0, {
        color: '#16A34A',
      }),
      catalogItem(fixedId('catReprov'), 'DECISION', 'REPROVADO', 'Reprovado', 1, {
        color: '#DC2626',
      }),
      catalogItem(fixedId('catManual'), 'DECISION', 'ANALISE_MANUAL', 'Análise manual', 2),
      catalogItem(fixedId('catOfA'), 'OFFER', 'OFERTA_A', 'Oferta A', 0),
      catalogItem(fixedId('catOfB'), 'OFFER', 'OFERTA_B', 'Oferta B', 1),
      catalogItem(fixedId('catOfVelha'), 'OFFER', 'OFERTA_VELHA', 'Oferta descontinuada', 2, {
        archivedAt: T0,
      }),
      catalogItem(fixedId('catLim'), 'LIMIT', 'LIM_1000', 'Limite R$ 1.000', 0, {
        numericValue: '1000',
      }),
      catalogItem(fixedId('catTag'), 'TAG', 'REVISAR', 'Revisar', 0),
    ],
    projects: [
      {
        id: IDS.projectA,
        code: 'PROJ_A',
        name: 'Projeto A',
        position: 0,
        createdAt: T0,
      },
      {
        id: IDS.projectB,
        code: 'PROJ_B',
        name: 'Projeto B',
        position: 1,
        createdAt: T0,
      },
    ],
    matrices: [],
    templates: [],
    importProfiles: [],
    events: [
      {
        id: fixedId('evt1'),
        at: T0,
        actor: 'Equipe',
        type: 'DOCUMENT_CREATED',
        scope: {},
        summary: 'Equipe criou o documento de teste.',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Execução de comandos nos testes
// ---------------------------------------------------------------------------

export type Applied<O> = {
  document: PolicyOpsDocument;
  data: O;
  result: Extract<CommandResult<O>, { ok: true }>;
};

/** Executa e falha o teste se o comando não der certo. */
export function apply<O>(
  doc: PolicyOpsDocument,
  ctx: Ctx,
  command: Command<unknown, O>,
): Applied<O> {
  const result = command.run(doc, ctx);
  if (!result.ok) {
    throw new Error(`Esperava sucesso de "${command.type}", veio ${result.error.code}: ${result.error.message}`);
  }
  return { document: result.document, data: result.data, result };
}

/** Executa esperando falha, e devolve o erro para inspeção dos `details`. */
export function expectFailure(
  doc: PolicyOpsDocument,
  ctx: Ctx,
  command: Command<unknown, unknown>,
  code: DomainErrorCode,
): DomainError {
  const result = command.run(doc, ctx);
  expect(result.ok, `Esperava falha ${code} de "${command.type}", mas o comando deu certo.`).toBe(
    false,
  );
  const error = (result as { ok: false; error: DomainError }).error;
  expect(error.code).toBe(code);
  // Regra 4: nenhum estado parcial — o documento recebido segue intacto.
  return error;
}

/** O documento sem a lista de eventos — o que precisa ser deep-equal num round-trip. */
export function withoutEvents(doc: PolicyOpsDocument): Omit<PolicyOpsDocument, 'events'> {
  const { events, ...rest } = doc;
  void events;
  return rest;
}

// ---------------------------------------------------------------------------
// Matrizes montadas pelos próprios comandos
// ---------------------------------------------------------------------------

/** Matriz simples: X = SCORE (3 tuplas) × Y = RESTRITIVO (2 tuplas) = 6 combinações. */
export function createTestMatrix(
  doc: PolicyOpsDocument,
  ctx: Ctx,
  code = 'MTZ_A',
): Applied<CreateMatrixData> {
  return apply(
    doc,
    ctx,
    createMatrix({
      projectId: IDS.projectA,
      code,
      name: `Matriz ${code}`,
      x: { levels: [{ variableId: IDS.score }] },
      y: { levels: [{ variableId: IDS.restritivo }] },
    }),
  );
}

/** Todas as coordenadas do grid desta versão, na ordem de leitura. */
export function coordsOf(doc: PolicyOpsDocument, versionId: string): PatchCoord[] {
  const { version } = locateVersion(doc, versionId);
  return allCombinations(version).map(({ xPath, yPath }) => ({ xPath, yPath }));
}

/** Decide todas as combinações — pré-requisito de I6 para publicar. */
export function fillAllCells(
  doc: PolicyOpsDocument,
  ctx: Ctx,
  versionId: string,
  decision = 'APROVADO',
): PolicyOpsDocument {
  return apply(
    doc,
    ctx,
    applyCellPatch({ versionId, patch: { coords: coordsOf(doc, versionId), set: { decision } } }),
  ).document;
}

export type AllStates = {
  document: PolicyOpsDocument;
  matrixId: string;
  /** v1, publicada e depois substituída. */
  superseded: string;
  /** v2, rascunho descartado — o número 2 fica queimado. */
  archived: string;
  /** v3, publicada e vigente. */
  published: string;
  /** v4, rascunho aberto. */
  draft: string;
};

/**
 * Uma matriz com uma versão em **cada** estado do ciclo de vida. É a base dos
 * testes de I3: todo comando que escreve precisa recusar as três versões
 * imutáveis.
 */
export function documentWithAllStates(ctx: TestCtx): AllStates {
  const created = createTestMatrix(baseDocument(), ctx);
  const matrixId = created.data.matrixId;
  const superseded = created.data.versionId;

  let doc = fillAllCells(created.document, ctx, superseded);
  doc = apply(doc, ctx, publishVersion({ versionId: superseded, notes: 'Publicação inicial.' }))
    .document;

  const v2 = apply(doc, ctx, createDraft({ matrixId }));
  doc = apply(v2.document, ctx, discardDraft({ versionId: v2.data.versionId })).document;

  const v3 = apply(doc, ctx, createDraft({ matrixId }));
  ctx.advance(DAY);
  doc = apply(v3.document, ctx, publishVersion({ versionId: v3.data.versionId, notes: 'Segunda publicação.' })).document;

  const v4 = apply(doc, ctx, createDraft({ matrixId }));

  return {
    document: v4.document,
    matrixId,
    superseded,
    archived: v2.data.versionId,
    published: v3.data.versionId,
    draft: v4.data.versionId,
  };
}
