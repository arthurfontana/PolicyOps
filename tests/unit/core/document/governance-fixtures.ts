import {
  addChangeRequestItem,
  createChangeRequest,
  type CreateChangeRequestInput,
} from '@/core/document/change-requests';
import { createComponent } from '@/core/document/components';
import type { PolicyOpsDocument } from '@/core/document/schema';
import {
  createComponentDraft,
  publishComponentVersion,
} from '@/core/versioning/component-lifecycle';
import { apply, baseDocument, createTestMatrix, IDS, type TestCtx } from '../versioning/fixtures';

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
  document = matriz.document;

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
