import {
  addChangeRequestItem,
  createChangeRequest,
  transitionChangeRequest,
  type CreateChangeRequestInput,
} from '@/core/document/change-requests';
import { createComponent } from '@/core/document/components';
import { linkChangeRequestDraft } from '@/core/document/cr-drafts';
import type { CrStatus, PolicyOpsDocument } from '@/core/document/schema';
import { createDraft, publishVersion } from '@/core/versioning/lifecycle';
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

// ---------------------------------------------------------------------------
// Fotografia histórica e comparação de política (S39)
// ---------------------------------------------------------------------------

/**
 * As três datas em que a política do `politicaComTresMudancas` muda — e nada
 * acontece fora delas. É o que permite afirmar "a comparação março × agosto
 * lista **exatamente** o que os DBs do intervalo mudaram" sem depender de
 * relógio nem de ordem de execução.
 */
export const MUDANCAS = {
  /** A Goodlist ganha v2. */
  goodlist: '2026-03-01T00:00:00.000Z',
  /** A "Regra nova" ganha a primeira versão — ela não existia antes. */
  regraNova: '2026-06-01T00:00:00.000Z',
  /** A matriz de corte ganha v2, com uma célula reprovada. */
  matriz: '2026-08-01T00:00:00.000Z',
} as const;

export type TresMudancasScenario = GovernanceScenario & {
  goodlistV2: string;
  regraNovaV1: string;
  /** v1 da matriz, vigente desde `VIGENCIA_V1`. */
  matrixV1: string;
  matrixV2: string;
};

/**
 * A política do épico com **três** alterações em datas conhecidas — uma de
 * cada natureza que a comparação de política precisa distinguir: componente
 * alterado (nova versão), componente que passa a existir, e matriz alterada
 * (a segunda fonte da fotografia, DEC-GOV-002).
 *
 * Continua montada só por comandos, como `politica`: uma fixture de fotografia
 * histórica escrita à mão provaria apenas que o objeto literal casa com o
 * `expect`, não que publicar produz aquela história.
 */
export function politicaComTresMudancas(ctx: TestCtx): TresMudancasScenario {
  const base = politica(ctx);
  let document = base.document;

  // A matriz precisa de uma v1 vigente desde o começo para que a mudança de
  // agosto seja um diff de matriz, e não o nascimento dela.
  document = apply(
    document,
    ctx,
    publishVersion({ versionId: base.matrixDraftId, notes: 'Publicação inicial da matriz.', effectiveFrom: VIGENCIA_V1 }),
  ).document;

  const goodlistV2 = apply(
    document,
    ctx,
    createComponentDraft({
      componentId: base.goodlistId,
      payload: {
        kind: 'RULE',
        businessDescription: 'Aprova só se o valor do pedido for menor ou igual ao limite em lista.',
        outcome: 'Aprovar',
      },
    }),
  );
  document = apply(
    goodlistV2.document,
    ctx,
    publishComponentVersion({ versionId: goodlistV2.data.versionId, effectiveFrom: MUDANCAS.goodlist }),
  ).document;

  const regraNovaV1 = apply(
    document,
    ctx,
    createComponentDraft({
      componentId: base.novaRegraId,
      payload: { kind: 'RULE', businessDescription: 'Deriva para a Mesa quando o aging passa de 30 dias.' },
    }),
  );
  document = apply(
    regraNovaV1.document,
    ctx,
    publishComponentVersion({ versionId: regraNovaV1.data.versionId, effectiveFrom: MUDANCAS.regraNova }),
  ).document;

  const matrixV2 = apply(document, ctx, createDraft({ matrixId: base.matrixId }));
  document = fillAllCells(matrixV2.document, ctx, matrixV2.data.versionId, 'REPROVADO');
  document = apply(
    document,
    ctx,
    publishVersion({ versionId: matrixV2.data.versionId, notes: 'Fecha o corte.', effectiveFrom: MUDANCAS.matriz }),
  ).document;

  return {
    ...base,
    document,
    goodlistV2: goodlistV2.data.versionId,
    regraNovaV1: regraNovaV1.data.versionId,
    matrixV1: base.matrixDraftId,
    matrixV2: matrixV2.data.versionId,
  };
}
