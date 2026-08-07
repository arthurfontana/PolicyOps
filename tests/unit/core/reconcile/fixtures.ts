import type { Command, Ctx } from '@/core/command';
import type { DefaultForUnlisted, Domain, PolicyOpsDocument } from '@/core/document/schema';
import {
  createCompatibilityDraft,
  publishCompatibility,
  saveCompatibilityMap,
} from '@/core/library/compatibility';
import {
  createVariableDraft,
  publishVariable,
  saveVariableDomains,
} from '@/core/library/variables';
import { createDraft, createMatrix, publishVersion } from '@/core/versioning/lifecycle';
import {
  apply,
  baseDocument,
  fillAllCells,
  IDS,
  type TestCtx,
} from '../versioning/fixtures';

/**
 * Fixtures da reconciliação (S16).
 *
 * Tudo é montado pelos **próprios comandos**: publicar uma versão nova de
 * variável ou de regra é exatamente o que o usuário faz na biblioteca, e é
 * justamente esse caminho que precisa provar não tocar nas matrizes
 * publicadas. Montar o documento à mão esconderia o que está sendo testado.
 */

export function domainsOf(...codes: string[]): Domain[] {
  return codes.map((code, position) => ({ code, label: `Rótulo ${code}`, position }));
}

/** Publica uma versão nova da variável com o conjunto de domínios informado. */
export function publishVariableWith(
  doc: PolicyOpsDocument,
  ctx: Ctx,
  variableId: string,
  domains: Domain[],
): PolicyOpsDocument {
  const draft = apply(doc, ctx, createVariableDraft({ variableId }));
  const saved = apply(
    draft.document,
    ctx,
    saveVariableDomains({ variableId, versionId: draft.data.versionId, domains }),
  );
  return apply(
    saved.document,
    ctx,
    publishVariable({ variableId, versionId: draft.data.versionId, notes: 'Evolução da biblioteca.' }),
  ).document;
}

/** Publica uma versão nova da regra de compatibilidade com o mapa informado. */
export function publishCompatibilityWith(
  doc: PolicyOpsDocument,
  ctx: Ctx,
  ruleId: string,
  allow: Record<string, string[]>,
  defaultForUnlisted: DefaultForUnlisted = 'NONE',
): PolicyOpsDocument {
  const draft = apply(doc, ctx, createCompatibilityDraft({ ruleId }));
  const saved = apply(
    draft.document,
    ctx,
    saveCompatibilityMap({ ruleId, versionId: draft.data.versionId, allow, defaultForUnlisted }),
  );
  return apply(
    saved.document,
    ctx,
    publishCompatibility({ ruleId, versionId: draft.data.versionId, notes: 'Nova regra.' }),
  ).document;
}

export type Scenario = {
  document: PolicyOpsDocument;
  matrixId: string;
  /** v1, publicada e vigente — a que **nunca** pode ser tocada. */
  published: string;
  /** v2, rascunho aberto, clone integral da v1. */
  draft: string;
};

function scenario(
  ctx: TestCtx,
  command: Command<unknown, { matrixId: string; versionId: string }>,
): Scenario {
  const created = apply(baseDocument(), ctx, command);
  const published = created.data.versionId;
  let doc = fillAllCells(created.document, ctx, published);
  doc = apply(doc, ctx, publishVersion({ versionId: published, notes: 'Publicação inicial.' })).document;
  const draft = apply(doc, ctx, createDraft({ matrixId: created.data.matrixId }));
  return {
    document: draft.document,
    matrixId: created.data.matrixId,
    published,
    draft: draft.data.versionId,
  };
}

/**
 * Matriz simples: X = `SCORE` (R1, R2, R3) × Y = `RESTRITIVO` (SEM, ALTO).
 * 6 combinações, todas decididas na v1 publicada, e uma v2 em rascunho.
 */
export function simpleScenario(ctx: TestCtx): Scenario {
  return scenario(
    ctx,
    createMatrix({
      projectId: IDS.projectA,
      code: 'MTZ_SIMPLES',
      name: 'Matriz simples',
      x: { levels: [{ variableId: IDS.score }] },
      y: { levels: [{ variableId: IDS.restritivo }] },
    }),
  );
}

/**
 * Matriz aninhada: X = `SCORE` (3 tuplas) × Y = `SEGMENTO › FAT` (8 tuplas sob
 * a regra publicada). 24 combinações, todas decididas, e uma v2 em rascunho.
 */
export function nestedScenario(ctx: TestCtx): Scenario {
  return scenario(
    ctx,
    createMatrix({
      projectId: IDS.projectA,
      code: 'MTZ_PJ',
      name: 'Matriz PJ',
      x: { levels: [{ variableId: IDS.score }] },
      y: { levels: [{ variableId: IDS.segmento }, { variableId: IDS.fat }] },
    }),
  );
}

/** O mapa publicado de `SEG_X_FATURAMENTO` no documento base. */
export const SEG_X_FAT_ALLOW: Record<string, string[]> = {
  VAREJO: ['ATE_100K', '100K_500K', '500K_1M'],
  ATACADO: ['500K_1M', '1M_10M', 'ACIMA_10M'],
  CORPORATE: ['1M_10M', 'ACIMA_10M'],
};
