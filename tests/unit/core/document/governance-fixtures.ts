import {
  addChangeRequestItem,
  createChangeRequest,
  transitionChangeRequest,
  type CreateChangeRequestInput,
} from '@/core/document/change-requests';
import { createComponent } from '@/core/document/components';
import { linkChangeRequestDraft } from '@/core/document/cr-drafts';
import type { CrStatus, PolicyOpsDocument } from '@/core/document/schema';
import {
  createComponentDraft,
  publishComponentVersion,
} from '@/core/versioning/component-lifecycle';
import {
  apply,
  baseDocument,
  createTestMatrix,
  fillAllCells,
  IDS,
  type TestCtx,
} from '../versioning/fixtures';

/**
 * Cenário-base do épico Governança, montado **pelos próprios comandos** (nunca
 * à mão): a política do CT-GOV-01 — a regra "Goodlist" publicada em v1 — mais o
 * espelho de uma matriz, que é o caso do item de DB que aponta rascunho de
 * matriz em vez de rascunho de componente (docs/14 §3.3).
 *
 * Não é fixture de arquivo: `tests/fixtures/mini-politica.json` é a política em
 * repouso das invariantes de árvore (I27–I29) e não tem DB nenhum; o que a S32b
 * exercita é a **sequência de comandos**, e montá-la por comando é o que prova
 * que o caminho existe sem tela.
 */

export const VIGENCIA_V1 = '2026-01-01T00:00:00.000Z';
export const VIGENCIA_PROPOSTA = '2026-09-01T00:00:00.000Z';

export type GovernanceScenario = {
  document: PolicyOpsDocument;
  /** Componente `RULE` "Goodlist", com v1 publicada. */
  goodlistId: string;
  goodlistV1: string;
  /** Componente `RULE` sem versão nenhuma — o item `CREATE` do DB. */
  novaRegraId: string;
  /** Espelho de matriz, com o rascunho v1 da matriz em aberto. */
  espelhoId: string;
  matrixId: string;
  matrixDraftId: string;
};

export function politica(ctx: TestCtx): GovernanceScenario {
  let document = baseDocument();

  const goodlist = apply(
    document,
    ctx,
    createComponent({
      projectId: IDS.projectA,
      code: 'REGRA_GOODLIST',
      name: 'Goodlist',
      type: 'RULE',
    }),
  );
  document = goodlist.document;

  const draft = apply(
    document,
    ctx,
    createComponentDraft({
      componentId: goodlist.data.componentId,
      payload: { kind: 'RULE', businessDescription: 'Aprova sempre que o cliente estiver na lista.' },
    }),
  );
  document = draft.document;

  const publicada = apply(
    document,
    ctx,
    publishComponentVersion({ versionId: draft.data.versionId, effectiveFrom: VIGENCIA_V1 }),
  );
  document = publicada.document;

  const novaRegra = apply(
    document,
    ctx,
    createComponent({
      projectId: IDS.projectA,
      code: 'REGRA_NOVA',
      name: 'Regra nova',
      type: 'RULE',
    }),
  );
  document = novaRegra.document;

  const matriz = createTestMatrix(document, ctx, 'MTZ_CORTE');
  // Rascunho de matriz **publicável**: I6 exige zero combinações pendentes, e
  // a publicação por DB (S36) não afrouxa nenhuma regra de `version/publish`.
  document = fillAllCells(matriz.document, ctx, matriz.data.versionId);

  const espelho = apply(
    document,
    ctx,
    createComponent({
      projectId: IDS.projectA,
      code: 'ESPELHO_CORTE',
      name: 'Matriz de corte',
      type: 'MATRIX',
      matrixId: matriz.data.matrixId,
    }),
  );
  document = espelho.document;

  return {
    document,
    goodlistId: goodlist.data.componentId,
    goodlistV1: draft.data.versionId,
    novaRegraId: novaRegra.data.componentId,
    espelhoId: espelho.data.componentId,
    matrixId: matriz.data.matrixId,
    matrixDraftId: matriz.data.versionId,
  };
}

/** DB em `DRAFT`, com motivador e vigência — falta só o item para submeter (RN-GOV-03). */
export function criarDb(
  doc: PolicyOpsDocument,
  ctx: TestCtx,
  overrides: Partial<CreateChangeRequestInput> = {},
): { document: PolicyOpsDocument; changeRequestId: string } {
  const criado = apply(
    doc,
    ctx,
    createChangeRequest({
      code: 'DB_515',
      title: 'Goodlist passa a olhar o valor do pedido',
      motivators: ['RISCO'],
      proposedEffectiveDate: VIGENCIA_PROPOSTA,
      ...overrides,
    }),
  );
  return { document: criado.document, changeRequestId: criado.data.changeRequestId };
}

/** DB pronto para submeter: motivador, vigência e um item `UPDATE` sobre a Goodlist. */
export function dbSubmetivel(
  doc: PolicyOpsDocument,
  ctx: TestCtx,
  componentId: string,
  overrides: Partial<CreateChangeRequestInput> = {},
): { document: PolicyOpsDocument; changeRequestId: string } {
  const criado = criarDb(doc, ctx, overrides);
  const comItem = apply(
    criado.document,
    ctx,
    addChangeRequestItem({
      changeRequestId: criado.changeRequestId,
      componentId,
      changeType: 'UPDATE',
      currentSummary: 'Hoje aprova sempre que estiver na lista.',
      proposedSummary: 'Aprova só se o valor do pedido for menor ou igual ao limite em lista.',
    }),
  );
  return { document: comItem.document, changeRequestId: criado.changeRequestId };
}

/**
 * A cadeia inteira do grafo (docs/14 §5) até `to`, pelos comandos de transição
 * — decisão de aprovação incluída como transição simples, porque quem testa
 * `approvals` é o teste da decisão, não este atalho.
 */
export const CAMINHO_ATE_PUBLICAR: readonly CrStatus[] = [
  'SUBMITTED',
  'IN_REVIEW',
  'APPROVED',
  'IN_DEVELOPMENT',
  'IN_VALIDATION',
  'READY_FOR_RELEASE',
];

export function avancarAte(
  doc: PolicyOpsDocument,
  ctx: TestCtx,
  changeRequestId: string,
  to: CrStatus,
): PolicyOpsDocument {
  let document = doc;
  for (const status of CAMINHO_ATE_PUBLICAR) {
    document = apply(document, ctx, transitionChangeRequest({ changeRequestId, to: status })).document;
    if (status === to) break;
  }
  return document;
}

/**
 * O DB-515 do CT-GOV-01 pronto para publicar: item `UPDATE` sobre a Goodlist
 * com rascunho vinculado e o DB em `READY_FOR_RELEASE`.
 */
export function dbPublicavel(
  doc: PolicyOpsDocument,
  ctx: TestCtx,
  componentId: string,
  proposta = 'Aprova só se o valor do pedido for menor ou igual ao limite em lista.',
): { document: PolicyOpsDocument; changeRequestId: string; draftVersionId: string } {
  const comItem = dbSubmetivel(doc, ctx, componentId);
  const vinculado = apply(
    comItem.document,
    ctx,
    linkChangeRequestDraft({
      changeRequestId: comItem.changeRequestId,
      componentId,
      payload: { kind: 'RULE', businessDescription: proposta },
    }),
  );
  return {
    document: avancarAte(vinculado.document, ctx, comItem.changeRequestId, 'READY_FOR_RELEASE'),
    changeRequestId: comItem.changeRequestId,
    draftVersionId: vinculado.data.draftVersionId,
  };
}
