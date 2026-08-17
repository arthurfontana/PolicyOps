import { describe, expect, it } from 'vitest';
import {
  addChangeRequestItem,
  approveChangeRequest,
  cancelChangeRequest,
  createChangeRequest,
  getChangeRequestPendingSummary,
  listChangeRequests,
  listChangeRequestsForComponent,
  locateChangeRequest,
  rejectChangeRequest,
  removeChangeRequestItem,
  returnChangeRequest,
  setChangeRequestRelease,
  suggestNextChangeRequestCode,
  transitionChangeRequest,
  updateChangeRequest,
  updateChangeRequestItem,
} from '@/core/document/change-requests';
import { cancelRelease, createRelease } from '@/core/document/releases';
import { createComponentDraft } from '@/core/versioning/component-lifecycle';
import { publishVersion } from '@/core/versioning/lifecycle';
import type { ChangeRequest, PolicyOpsDocument } from '@/core/document/schema';
import { validateDocument } from '@/core/document/validate';
import { apply, baseDocument, expectFailure, fillAllCells, IDS, testCtx, type TestCtx } from '../versioning/fixtures';
import {
  criarDb,
  dbSubmetivel,
  politica,
  VIGENCIA_PROPOSTA,
  type GovernanceScenario,
} from './governance-fixtures';

/**
 * Comandos da Solicitação de Alteração — docs/14 §3.3/§5, docs/08 §3.
 *
 * O que estes testes protegem, além do óbvio:
 *
 * - **o inverso devolve o documento byte a byte**, com a única exceção da
 *   trilha do DB, que é append-only pela mesma mecânica de `doc.events`
 *   (DEC-GOV-019) — `semTrilha` é quem isola isso;
 * - **aprovar não publica** (RN-GOV-04, CT-GOV-02): nenhuma versão muda de
 *   estado, e o rascunho continua rascunho;
 * - **item congelado a partir de APPROVED** (CT-GOV-04), com a devolução
 *   reabrindo a edição sem apagar o histórico de aprovação.
 */

/** O documento sem as trilhas dos DBs — o que precisa ser deep-equal num round-trip. */
function semTrilha(doc: PolicyOpsDocument): unknown {
  return {
    ...doc,
    events: [],
    changeRequests: doc.changeRequests.map((cr) => ({ ...cr, events: [] })),
  };
}

function cr(doc: PolicyOpsDocument, changeRequestId: string): ChangeRequest {
  return locateChangeRequest(doc, changeRequestId).changeRequest;
}

/** Executa o comando e, em seguida, o inverso — devolve os dois documentos. */
function ida(
  doc: PolicyOpsDocument,
  ctx: TestCtx,
  command: Parameters<typeof apply>[2],
): { depois: PolicyOpsDocument; desfeito: PolicyOpsDocument } {
  const aplicado = apply(doc, ctx, command);
  const desfeito = aplicado.result.inverse.run(aplicado.document, ctx);
  if (!desfeito.ok) {
    throw new Error(`O inverso de "${command.type}" falhou: ${desfeito.error.message}`);
  }
  return { depois: aplicado.document, desfeito: desfeito.document };
}

function cenario(ctx: TestCtx): GovernanceScenario {
  return politica(ctx);
}

// ---------------------------------------------------------------------------
// changeRequest/create
// ---------------------------------------------------------------------------

describe('changeRequest/create', () => {
  it('nasce em DRAFT, sem itens, sem aprovações e com o solicitante carimbado', () => {
    const ctx = testCtx();
    const { document } = criarDb(cenario(ctx).document, ctx);
    const db = document.changeRequests[0]!;

    expect(db).toMatchObject({
      code: 'DB_515',
      status: 'DRAFT',
      motivators: ['RISCO'],
      requestedBy: 'Arthur',
      items: [],
      approvals: [],
      acceptanceCriteria: [],
      testScenarios: [],
      impacts: [],
      proposedEffectiveDate: VIGENCIA_PROPOSTA,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(db.owner).toBeUndefined();
    expect(db.priority).toBeUndefined();
    expect(validateDocument(document).ok).toBe(true);
  });

  it('grava CR_CREATED na trilha do próprio DB, e nada em doc.events', () => {
    const ctx = testCtx();
    const base = cenario(ctx).document;
    const eventosAntes = base.events.length;
    const { document, changeRequestId } = criarDb(base, ctx);

    const trilha = cr(document, changeRequestId).events;
    expect(trilha).toHaveLength(1);
    expect(trilha[0]).toMatchObject({
      type: 'CR_CREATED',
      actor: 'Arthur',
      scope: { changeRequestId },
    });
    expect(document.events).toHaveLength(eventosAntes);
  });

  it('aceita os campos opcionais e omite os ausentes', () => {
    const ctx = testCtx();
    const { document, changeRequestId } = criarDb(cenario(ctx).document, ctx, {
      owner: 'Marina',
      priority: 'HIGH',
      requestedBy: 'Bruno',
      motivationText: { blocks: [{ id: 'blk000000001', type: 'paragraph', text: [{ text: 'Contexto.' }] }] },
      spec: { blocks: [] },
      acceptanceCriteria: [{ given: 'cliente na lista', then: 'aprova se valor ≤ limite' }],
      testScenarios: [{ kind: 'REGRESSAO', description: 'cliente na lista com valor acima do limite' }],
      impacts: [{ category: 'SISTEMAS', description: 'motor de decisão' }],
    });

    expect(cr(document, changeRequestId)).toMatchObject({
      owner: 'Marina',
      priority: 'HIGH',
      requestedBy: 'Bruno',
      impacts: [{ category: 'SISTEMAS', description: 'motor de decisão' }],
    });
    expect(validateDocument(document).ok).toBe(true);
  });

  it('recusa código duplicado, código fora do padrão e título em branco', () => {
    const ctx = testCtx();
    const { document } = criarDb(cenario(ctx).document, ctx);

    expectFailure(document, ctx, createChangeRequest({ code: 'DB_515', title: 'Outro' }), 'DUPLICATE_CODE');
    expectFailure(document, ctx, createChangeRequest({ code: 'DB-516', title: 'Outro' }), 'INVALID_INPUT');
    expectFailure(document, ctx, createChangeRequest({ code: 'DB_516', title: '  ' }), 'INVALID_INPUT');
    expectFailure(
      document,
      ctx,
      createChangeRequest({ code: 'DB_516', title: 'Outro', requestedBy: ' ' }),
      'INVALID_INPUT',
    );
    expectFailure(
      document,
      ctx,
      createChangeRequest({ code: 'DB_516', title: 'Outro', owner: ' ' }),
      'INVALID_INPUT',
    );
  });

  it('recusa motivador e categoria de impacto fora do catálogo', () => {
    const ctx = testCtx();
    const base = cenario(ctx).document;

    expectFailure(
      base,
      ctx,
      createChangeRequest({ code: 'DB_516', title: 'X', motivators: ['INEXISTENTE'] }),
      'CATALOG_REF_MISSING',
    );
    expectFailure(
      base,
      ctx,
      createChangeRequest({ code: 'DB_516', title: 'X', motivators: ['minusculo'] }),
      'INVALID_INPUT',
    );
    expectFailure(
      base,
      ctx,
      createChangeRequest({ code: 'DB_516', title: 'X', impacts: [{ category: 'NAO_EXISTE' }] }),
      'CATALOG_REF_MISSING',
    );
  });

  it('recusa vigência proposta fora do formato ISO', () => {
    const ctx = testCtx();
    expectFailure(
      cenario(ctx).document,
      ctx,
      createChangeRequest({ code: 'DB_516', title: 'X', proposedEffectiveDate: '01/09/2026' }),
      'INVALID_INPUT',
    );
  });

  it('deduplica motivadores repetidos', () => {
    const ctx = testCtx();
    const { document, changeRequestId } = criarDb(cenario(ctx).document, ctx, {
      motivators: ['RISCO', 'RISCO', 'REGULATORIO'],
    });
    expect(cr(document, changeRequestId).motivators).toEqual(['RISCO', 'REGULATORIO']);
  });

  it('tem inverso exato: desfazer some com o DB, refazer devolve idêntico', () => {
    const ctx = testCtx();
    const base = cenario(ctx).document;
    const criado = apply(base, ctx, createChangeRequest({ code: 'DB_515', title: 'Goodlist' }));

    const desfeito = criado.result.inverse.run(criado.document, ctx);
    expect(desfeito.ok).toBe(true);
    if (!desfeito.ok) return;
    expect(desfeito.document.changeRequests).toEqual([]);

    const refeito = desfeito.inverse.run(desfeito.document, ctx);
    expect(refeito.ok).toBe(true);
    if (!refeito.ok) return;
    expect(refeito.document.changeRequests).toEqual(criado.document.changeRequests);

    // E o inverso do refazer volta a remover — o par fecha nos dois sentidos.
    const denovo = refeito.inverse.run(refeito.document, ctx);
    expect(denovo.ok).toBe(true);
    if (denovo.ok) expect(denovo.document.changeRequests).toEqual([]);
  });

  it('o inverso de create recusa remover DB que já tem escopo', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const criado = apply(cena.document, ctx, createChangeRequest({ code: 'DB_515', title: 'Goodlist' }));
    const comItem = apply(
      criado.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: criado.data.changeRequestId,
        componentId: cena.goodlistId,
        changeType: 'UPDATE',
        proposedSummary: 'Proposto',
      }),
    );
    const desfeito = criado.result.inverse.run(comItem.document, ctx);
    expect(desfeito.ok).toBe(false);
    if (!desfeito.ok) expect(desfeito.error.code).toBe('CR_TRANSITION_INVALID');
  });
});

// ---------------------------------------------------------------------------
// changeRequest/update
// ---------------------------------------------------------------------------

describe('changeRequest/update', () => {
  it('edita metadados com semântica de três estados e volta byte a byte no inverso', () => {
    const ctx = testCtx();
    const { document, changeRequestId } = criarDb(cenario(ctx).document, ctx, {
      owner: 'Marina',
      priority: 'HIGH',
      spec: { blocks: [] },
    });

    const { depois, desfeito } = ida(
      document,
      ctx,
      updateChangeRequest({
        changeRequestId,
        title: 'Goodlist com teto por pedido',
        owner: null,
        priority: 'CRITICAL',
        motivators: ['REGULATORIO'],
        motivationText: { blocks: [] },
        spec: null,
        acceptanceCriteria: [{ given: 'A', then: 'B' }],
        testScenarios: [{ kind: 'UNIT', description: 'C' }],
        impacts: [{ category: 'OPERACAO' }],
        proposedEffectiveDate: null,
      }),
    );

    const editado = cr(depois, changeRequestId);
    expect(editado.title).toBe('Goodlist com teto por pedido');
    expect(editado.owner).toBeUndefined();
    expect(editado.priority).toBe('CRITICAL');
    expect(editado.motivators).toEqual(['REGULATORIO']);
    expect(editado.spec).toBeUndefined();
    expect(editado.proposedEffectiveDate).toBeUndefined();
    expect(semTrilha(desfeito)).toEqual(semTrilha(document));
  });

  it('apaga prioridade e dono com null', () => {
    const ctx = testCtx();
    const { document, changeRequestId } = criarDb(cenario(ctx).document, ctx, {
      owner: 'Marina',
      priority: 'HIGH',
    });
    const limpo = apply(
      document,
      ctx,
      updateChangeRequest({ changeRequestId, owner: null, priority: null }),
    );

    expect(cr(limpo.document, changeRequestId).priority).toBeUndefined();
    expect(cr(limpo.document, changeRequestId).owner).toBeUndefined();
  });

  it('não mexe no que não veio no input', () => {
    const ctx = testCtx();
    const { document, changeRequestId } = criarDb(cenario(ctx).document, ctx, { owner: 'Marina' });
    const editado = apply(document, ctx, updateChangeRequest({ changeRequestId, title: 'Outro título' }));

    expect(cr(editado.document, changeRequestId)).toMatchObject({
      title: 'Outro título',
      owner: 'Marina',
      motivators: ['RISCO'],
      proposedEffectiveDate: VIGENCIA_PROPOSTA,
    });
  });

  it('não aceita DB fechado, título em branco nem referência inexistente', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = dbSubmetivel(cena.document, ctx, cena.goodlistId);

    expectFailure(document, ctx, updateChangeRequest({ changeRequestId, title: ' ' }), 'INVALID_INPUT');
    expectFailure(document, ctx, updateChangeRequest({ changeRequestId, owner: ' ' }), 'INVALID_INPUT');
    expectFailure(
      document,
      ctx,
      updateChangeRequest({ changeRequestId, motivators: ['SUMIU'] }),
      'CATALOG_REF_MISSING',
    );
    expectFailure(
      document,
      ctx,
      updateChangeRequest({ changeRequestId, proposedEffectiveDate: 'ontem' }),
      'INVALID_INPUT',
    );
    expectFailure(
      document,
      ctx,
      updateChangeRequest({ changeRequestId: 'naoexiste12' }),
      'NOT_FOUND',
    );

    const cancelado = apply(document, ctx, cancelChangeRequest({ changeRequestId })).document;
    expectFailure(
      cancelado,
      ctx,
      updateChangeRequest({ changeRequestId, title: 'Depois de cancelado' }),
      'CR_TRANSITION_INVALID',
    );
  });

  it('continua editável depois de APPROVED — o congelamento é do escopo, não do metadado', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const aprovado = ateAprovado(cena, ctx);

    const editado = apply(
      aprovado.document,
      ctx,
      updateChangeRequest({ changeRequestId: aprovado.changeRequestId, owner: 'Marina' }),
    );
    expect(cr(editado.document, aprovado.changeRequestId).owner).toBe('Marina');
  });
});

// ---------------------------------------------------------------------------
// Itens (RN-GOV-02, I30)
// ---------------------------------------------------------------------------

describe('changeRequest/addItem · removeItem · updateItem', () => {
  it('adiciona itens no fim, com "hoje" e "proposto", e valida o documento', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = dbSubmetivel(cena.document, ctx, cena.goodlistId);

    const comSegundo = apply(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.novaRegraId,
        changeType: 'CREATE',
        proposedSummary: 'Regra nova de teto por canal.',
      }),
    );

    expect(cr(comSegundo.document, changeRequestId).items.map((item) => item.componentId)).toEqual([
      cena.goodlistId,
      cena.novaRegraId,
    ]);
    expect(cr(comSegundo.document, changeRequestId).items[0]).toEqual({
      componentId: cena.goodlistId,
      changeType: 'UPDATE',
      currentSummary: 'Hoje aprova sempre que estiver na lista.',
      proposedSummary: 'Aprova só se o valor do pedido for menor ou igual ao limite em lista.',
    });
    expect(validateDocument(comSegundo.document).ok).toBe(true);
  });

  it('RN-GOV-02: o mesmo componente não entra duas vezes no mesmo DB', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = dbSubmetivel(cena.document, ctx, cena.goodlistId);

    const error = expectFailure(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.goodlistId,
        changeType: 'DOC_ONLY',
        proposedSummary: 'De novo',
      }),
      'INVALID_INPUT',
    );
    expect(error.message).toContain('uma vez só por DB');
  });

  it('dois DBs abertos podem tocar o mesmo componente (RN-GOV-02, segunda metade)', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const primeiro = dbSubmetivel(cena.document, ctx, cena.goodlistId);
    const segundo = dbSubmetivel(primeiro.document, ctx, cena.goodlistId, { code: 'DB_519' });

    expect(listChangeRequestsForComponent(segundo.document, cena.goodlistId)).toHaveLength(2);
    expect(
      listChangeRequestsForComponent(segundo.document, cena.goodlistId, { openOnly: true }),
    ).toHaveLength(2);
    expect(listChangeRequestsForComponent(segundo.document, cena.novaRegraId)).toEqual([]);

    const cancelado = apply(
      segundo.document,
      ctx,
      cancelChangeRequest({ changeRequestId: segundo.changeRequestId }),
    ).document;
    expect(listChangeRequestsForComponent(cancelado, cena.goodlistId, { openOnly: true })).toHaveLength(1);
  });

  it('valida as referências do item: componente, versão base e rascunho', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = criarDb(cena.document, ctx);

    expectFailure(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: 'naoexiste12',
        changeType: 'UPDATE',
        proposedSummary: 'X',
      }),
      'NOT_FOUND',
    );
    expectFailure(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.goodlistId,
        changeType: 'UPDATE',
        baseVersionId: 'naoexiste12',
        proposedSummary: 'X',
      }),
      'NOT_FOUND',
    );
    expectFailure(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.goodlistId,
        changeType: 'UPDATE',
        draftVersionId: 'naoexiste12',
        proposedSummary: 'X',
      }),
      'NOT_FOUND',
    );
    // Versão publicada não é rascunho.
    expectFailure(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.goodlistId,
        changeType: 'UPDATE',
        draftVersionId: cena.goodlistV1,
        proposedSummary: 'X',
      }),
      'VERSION_NOT_DRAFT',
    );
    expectFailure(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.goodlistId,
        changeType: 'UPDATE',
        proposedSummary: '   ',
      }),
      'INVALID_INPUT',
    );
    expectFailure(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.goodlistId,
        changeType: 'UPDATE',
        currentSummary: '  ',
        proposedSummary: 'X',
      }),
      'INVALID_INPUT',
    );
  });

  it('I30: o rascunho vinculado precisa apontar de volta para este DB', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = criarDb(cena.document, ctx);
    const outro = criarDb(document, ctx, { code: 'DB_519' });

    const semVinculo = apply(
      outro.document,
      ctx,
      createComponentDraft({
        componentId: cena.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Proposta.' },
      }),
    );
    const soltoErro = expectFailure(
      semVinculo.document,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.goodlistId,
        changeType: 'UPDATE',
        draftVersionId: semVinculo.data.versionId,
        proposedSummary: 'X',
      }),
      'INVALID_INPUT',
    );
    expect(soltoErro.message).toContain('não aponta nenhum DB');

    const doOutro = apply(
      document,
      ctx,
      createComponentDraft({
        componentId: cena.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Proposta.' },
        changeRequestId: outro.changeRequestId,
      }),
    );
    const alheioErro = expectFailure(
      doOutro.document,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.goodlistId,
        changeType: 'UPDATE',
        draftVersionId: doOutro.data.versionId,
        proposedSummary: 'X',
      }),
      'INVALID_INPUT',
    );
    expect(alheioErro.message).toContain('pertence a outro DB');

    // Com o vínculo certo, entra.
    const meu = apply(
      document,
      ctx,
      createComponentDraft({
        componentId: cena.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Proposta.' },
        changeRequestId,
      }),
    );
    const comRascunho = apply(
      meu.document,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.goodlistId,
        changeType: 'UPDATE',
        baseVersionId: cena.goodlistV1,
        draftVersionId: meu.data.versionId,
        proposedSummary: 'X',
      }),
    );
    expect(cr(comRascunho.document, changeRequestId).items[0]!.draftVersionId).toBe(meu.data.versionId);
    expect(validateDocument(comRascunho.document).ok).toBe(true);
  });

  it('item sobre espelho de matriz vincula rascunho da matriz', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = criarDb(cena.document, ctx);

    const comMatriz = apply(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.espelhoId,
        changeType: 'UPDATE',
        draftVersionId: cena.matrixDraftId,
        proposedSummary: 'Corte novo do cineminha.',
      }),
    );
    expect(cr(comMatriz.document, changeRequestId).items[0]!.draftVersionId).toBe(cena.matrixDraftId);
    expect(validateDocument(comMatriz.document).ok).toBe(true);

    expectFailure(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.espelhoId,
        changeType: 'UPDATE',
        baseVersionId: 'naoexiste12',
        proposedSummary: 'X',
      }),
      'NOT_FOUND',
    );
    expectFailure(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.espelhoId,
        changeType: 'UPDATE',
        draftVersionId: 'naoexiste12',
        proposedSummary: 'X',
      }),
      'NOT_FOUND',
    );
  });

  it('espelho apontando matriz que sumiu do documento é NOT_FOUND', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = criarDb(cena.document, ctx);
    // I27 impede isso num documento válido; o comando recusa mesmo assim, para
    // que um documento adulterado não vire item de DB pendurado no vazio.
    const semMatriz = structuredClone(document);
    semMatriz.matrices = [];

    expectFailure(
      semMatriz,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.espelhoId,
        changeType: 'UPDATE',
        proposedSummary: 'X',
      }),
      'NOT_FOUND',
    );
  });

  it('espelho de matriz publicada não serve como rascunho de item', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = criarDb(cena.document, ctx);
    const publicada = publicarMatriz(document, ctx, cena);

    expectFailure(
      publicada,
      ctx,
      addChangeRequestItem({
        changeRequestId,
        componentId: cena.espelhoId,
        changeType: 'UPDATE',
        draftVersionId: cena.matrixDraftId,
        proposedSummary: 'X',
      }),
      'VERSION_NOT_DRAFT',
    );
  });

  it('remover devolve o item na posição exata no inverso', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const primeiro = dbSubmetivel(cena.document, ctx, cena.goodlistId);
    const comSegundo = apply(
      primeiro.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: primeiro.changeRequestId,
        componentId: cena.novaRegraId,
        changeType: 'CREATE',
        proposedSummary: 'Regra nova.',
      }),
    ).document;

    const { depois, desfeito } = ida(
      comSegundo,
      ctx,
      removeChangeRequestItem({
        changeRequestId: primeiro.changeRequestId,
        componentId: cena.goodlistId,
      }),
    );
    expect(cr(depois, primeiro.changeRequestId).items.map((item) => item.componentId)).toEqual([
      cena.novaRegraId,
    ]);
    expect(semTrilha(desfeito)).toEqual(semTrilha(comSegundo));

    expectFailure(
      depois,
      ctx,
      removeChangeRequestItem({ changeRequestId: primeiro.changeRequestId, componentId: cena.goodlistId }),
      'NOT_FOUND',
    );
  });

  it('editar item troca os campos pedidos e desfaz byte a byte', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = dbSubmetivel(cena.document, ctx, cena.goodlistId);

    const { depois, desfeito } = ida(
      document,
      ctx,
      updateChangeRequestItem({
        changeRequestId,
        componentId: cena.goodlistId,
        changeType: 'DOC_ONLY',
        baseVersionId: cena.goodlistV1,
        currentSummary: null,
        proposedSummary: 'Outro proposto.',
      }),
    );

    expect(cr(depois, changeRequestId).items[0]).toEqual({
      componentId: cena.goodlistId,
      changeType: 'DOC_ONLY',
      baseVersionId: cena.goodlistV1,
      proposedSummary: 'Outro proposto.',
    });
    expect(semTrilha(desfeito)).toEqual(semTrilha(document));
  });

  it('editar item sem input nenhum preserva tudo, e item inexistente é NOT_FOUND', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = dbSubmetivel(cena.document, ctx, cena.goodlistId);

    const igual = apply(
      document,
      ctx,
      updateChangeRequestItem({ changeRequestId, componentId: cena.goodlistId }),
    );
    expect(cr(igual.document, changeRequestId).items).toEqual(cr(document, changeRequestId).items);

    expectFailure(
      document,
      ctx,
      updateChangeRequestItem({ changeRequestId, componentId: cena.novaRegraId }),
      'NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/** Leva o DB do CT-GOV-01 até `APPROVED`, só por comandos. */
function ateAprovado(
  cena: GovernanceScenario,
  ctx: TestCtx,
): { document: PolicyOpsDocument; changeRequestId: string } {
  const criado = dbSubmetivel(cena.document, ctx, cena.goodlistId);
  let document = apply(
    criado.document,
    ctx,
    transitionChangeRequest({ changeRequestId: criado.changeRequestId, to: 'SUBMITTED' }),
  ).document;
  document = apply(
    document,
    ctx,
    transitionChangeRequest({ changeRequestId: criado.changeRequestId, to: 'IN_REVIEW' }),
  ).document;
  document = apply(
    document,
    ctx,
    approveChangeRequest({ changeRequestId: criado.changeRequestId, comment: 'De acordo.' }),
  ).document;
  return { document, changeRequestId: criado.changeRequestId };
}

function publicarMatriz(
  doc: PolicyOpsDocument,
  ctx: TestCtx,
  cena: GovernanceScenario,
): PolicyOpsDocument {
  // Publicar matriz exige zero combinações pendentes (I6) — `fillAllCells` é o
  // caminho curto que o épico de versões já usa nos próprios testes.
  const preenchida = fillAllCells(doc, ctx, cena.matrixDraftId);
  return apply(
    preenchida,
    ctx,
    publishVersion({ versionId: cena.matrixDraftId, notes: 'Publicação da matriz de corte.' }),
  ).document;
}

// ---------------------------------------------------------------------------

describe('changeRequest/transition (RN-GOV-01)', () => {
  it('CT-GOV-01: DRAFT → SUBMITTED → IN_REVIEW → APPROVED roda por comandos, sem tela', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = ateAprovado(cena, ctx);

    const db = cr(document, changeRequestId);
    expect(db.status).toBe('APPROVED');
    expect(db.events.map((event) => event.type)).toEqual([
      'CR_CREATED',
      'CR_ITEM_CHANGED',
      'CR_TRANSITIONED',
      'CR_TRANSITIONED',
      'CR_DECIDED',
    ]);
    expect(validateDocument(document).ok).toBe(true);
  });

  it('grava a transição na trilha com autor, data, origem e destino', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = dbSubmetivel(cena.document, ctx, cena.goodlistId);
    ctx.setNow('2026-02-01T10:00:00.000Z');

    const submetido = apply(
      document,
      ctx,
      transitionChangeRequest({ changeRequestId, to: 'SUBMITTED', note: 'Vai na release de setembro.' }),
    );
    const evento = cr(submetido.document, changeRequestId).events.at(-1)!;

    expect(evento).toMatchObject({
      type: 'CR_TRANSITIONED',
      actor: 'Arthur',
      at: '2026-02-01T10:00:00.000Z',
      payload: { from: 'DRAFT', to: 'SUBMITTED', note: 'Vai na release de setembro.' },
    });
    expect(evento.summary).toContain('de DRAFT para SUBMITTED');
    expect(submetido.data).toEqual({ from: 'DRAFT', to: 'SUBMITTED' });
  });

  it('RN-GOV-03: submeter sem motivador, sem item ou sem vigência é E-GOV-03', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);

    const semItem = criarDb(cena.document, ctx);
    expectFailure(
      semItem.document,
      ctx,
      transitionChangeRequest({ changeRequestId: semItem.changeRequestId, to: 'SUBMITTED' }),
      'CR_INCOMPLETE',
    );

    const semMotivador = dbSubmetivel(cena.document, ctx, cena.goodlistId, { motivators: [] });
    expectFailure(
      semMotivador.document,
      ctx,
      transitionChangeRequest({ changeRequestId: semMotivador.changeRequestId, to: 'SUBMITTED' }),
      'CR_INCOMPLETE',
    );

    const semVigencia = dbSubmetivel(cena.document, ctx, cena.goodlistId, {
      proposedEffectiveDate: undefined,
    });
    expectFailure(
      semVigencia.document,
      ctx,
      transitionChangeRequest({ changeRequestId: semVigencia.changeRequestId, to: 'SUBMITTED' }),
      'CR_INCOMPLETE',
    );
  });

  it('recusa transição fora do grafo e a marcação manual de PUBLISHED', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = dbSubmetivel(cena.document, ctx, cena.goodlistId);

    expectFailure(
      document,
      ctx,
      transitionChangeRequest({ changeRequestId, to: 'IN_REVIEW' }),
      'CR_TRANSITION_INVALID',
    );
    expectFailure(
      document,
      ctx,
      transitionChangeRequest({ changeRequestId, to: 'PUBLISHED' }),
      'CR_TRANSITION_INVALID',
    );

    // Nem no fim da esteira: SCHEDULED → PUBLISHED é da publicação (S36).
    const agendado = ateAgendado(cena, ctx);
    expectFailure(
      agendado.document,
      ctx,
      transitionChangeRequest({ changeRequestId: agendado.changeRequestId, to: 'PUBLISHED' }),
      'CR_TRANSITION_INVALID',
    );
    expect(agendado.document.changeRequests[0]!.status).toBe('SCHEDULED');
  });

  it('o inverso devolve o status anterior sem rebobinar a trilha', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = dbSubmetivel(cena.document, ctx, cena.goodlistId);

    const { depois, desfeito } = ida(
      document,
      ctx,
      transitionChangeRequest({ changeRequestId, to: 'SUBMITTED' }),
    );
    expect(cr(depois, changeRequestId).status).toBe('SUBMITTED');
    expect(cr(desfeito, changeRequestId).status).toBe('DRAFT');
    expect(semTrilha(desfeito)).toEqual(semTrilha(document));
    // A trilha é append-only: o evento da transição desfeita continua lá.
    expect(cr(desfeito, changeRequestId).events.map((e) => e.type)).toEqual([
      'CR_CREATED',
      'CR_ITEM_CHANGED',
      'CR_TRANSITIONED',
    ]);
  });

  it('o inverso do inverso refaz a transição, sem duplicar evento', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = dbSubmetivel(cena.document, ctx, cena.goodlistId);
    const aplicado = apply(document, ctx, transitionChangeRequest({ changeRequestId, to: 'SUBMITTED' }));
    const desfeito = aplicado.result.inverse.run(aplicado.document, ctx);
    expect(desfeito.ok).toBe(true);
    if (!desfeito.ok) return;
    const refeito = desfeito.inverse.run(desfeito.document, ctx);
    expect(refeito.ok).toBe(true);
    if (!refeito.ok) return;
    expect(cr(refeito.document, changeRequestId).status).toBe('SUBMITTED');
    expect(cr(refeito.document, changeRequestId).events).toHaveLength(3);
  });
});

/** Leva o DB até `SCHEDULED` — o último degrau antes da publicação da S36. */
function ateAgendado(
  cena: GovernanceScenario,
  ctx: TestCtx,
): { document: PolicyOpsDocument; changeRequestId: string } {
  const aprovado = ateAprovado(cena, ctx);
  let document = aprovado.document;
  for (const to of ['IN_DEVELOPMENT', 'IN_VALIDATION', 'READY_FOR_RELEASE', 'SCHEDULED'] as const) {
    document = apply(
      document,
      ctx,
      transitionChangeRequest({ changeRequestId: aprovado.changeRequestId, to }),
    ).document;
  }
  return { document, changeRequestId: aprovado.changeRequestId };
}

describe('changeRequest/cancel', () => {
  it('cancela de qualquer estado não terminal, com motivo na trilha', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = dbSubmetivel(cena.document, ctx, cena.goodlistId);

    const { depois, desfeito } = ida(
      document,
      ctx,
      cancelChangeRequest({ changeRequestId, reason: 'A área desistiu.' }),
    );
    expect(cr(depois, changeRequestId).status).toBe('CANCELLED');
    expect(cr(depois, changeRequestId).events.at(-1)!.summary).toContain('A área desistiu.');
    expect(cr(desfeito, changeRequestId).status).toBe('DRAFT');
    expect(semTrilha(desfeito)).toEqual(semTrilha(document));
  });

  it('cancela sem motivo, e recusa cancelar o que já está cancelado', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = dbSubmetivel(cena.document, ctx, cena.goodlistId);
    const cancelado = apply(document, ctx, cancelChangeRequest({ changeRequestId })).document;

    expect(cr(cancelado, changeRequestId).events.at(-1)!.summary).not.toContain(':');
    expectFailure(cancelado, ctx, cancelChangeRequest({ changeRequestId }), 'CR_TRANSITION_INVALID');
    expectFailure(
      cancelado,
      ctx,
      cancelChangeRequest({ changeRequestId, reason: '  ' }),
      'CR_TRANSITION_INVALID',
    );
  });

  it('recusa motivo em branco quando o cancelamento é possível', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const { document, changeRequestId } = dbSubmetivel(cena.document, ctx, cena.goodlistId);
    expectFailure(document, ctx, cancelChangeRequest({ changeRequestId, reason: ' ' }), 'INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// Decisões (US-GOV-04, RN-GOV-04)
// ---------------------------------------------------------------------------

describe('changeRequest/approve · return · reject', () => {
  it('CT-GOV-02: aprovar não publica — nenhuma versão muda de estado', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const criado = dbSubmetivel(cena.document, ctx, cena.goodlistId);
    const comRascunho = apply(
      criado.document,
      ctx,
      createComponentDraft({
        componentId: cena.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Aprova só se o valor for menor que o limite.' },
        changeRequestId: criado.changeRequestId,
      }),
    );
    const vinculado = apply(
      comRascunho.document,
      ctx,
      updateChangeRequestItem({
        changeRequestId: criado.changeRequestId,
        componentId: cena.goodlistId,
        baseVersionId: cena.goodlistV1,
        draftVersionId: comRascunho.data.versionId,
      }),
    ).document;

    const antes = vinculado.components.find((component) => component.id === cena.goodlistId)!;
    let document = apply(
      vinculado,
      ctx,
      transitionChangeRequest({ changeRequestId: criado.changeRequestId, to: 'SUBMITTED' }),
    ).document;
    document = apply(
      document,
      ctx,
      transitionChangeRequest({ changeRequestId: criado.changeRequestId, to: 'IN_REVIEW' }),
    ).document;
    ctx.setNow('2026-03-02T09:00:00.000Z');
    const aprovado = apply(
      document,
      ctx,
      approveChangeRequest({ changeRequestId: criado.changeRequestId, comment: 'De acordo.' }),
    );

    const depois = aprovado.document.components.find((component) => component.id === cena.goodlistId)!;
    expect(cr(aprovado.document, criado.changeRequestId).status).toBe('APPROVED');
    expect(depois.versions).toEqual(antes.versions);
    expect(depois.versions.map((version) => version.state)).toEqual(['PUBLISHED', 'DRAFT']);
    expect(cr(aprovado.document, criado.changeRequestId).approvals).toEqual([
      { by: 'Arthur', at: '2026-03-02T09:00:00.000Z', decision: 'APPROVED', comment: 'De acordo.' },
    ]);
    expect(aprovado.data).toEqual({ status: 'APPROVED' });
  });

  it('CT-GOV-04: item congelado em APPROVED, e a devolução reabre a edição sem perder o histórico', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const criado = dbSubmetivel(cena.document, ctx, cena.goodlistId);

    // Primeira volta: submete, entra em revisão e é devolvido com comentário.
    let document = apply(
      criado.document,
      ctx,
      transitionChangeRequest({ changeRequestId: criado.changeRequestId, to: 'SUBMITTED' }),
    ).document;
    document = apply(
      document,
      ctx,
      transitionChangeRequest({ changeRequestId: criado.changeRequestId, to: 'IN_REVIEW' }),
    ).document;
    document = apply(
      document,
      ctx,
      returnChangeRequest({
        changeRequestId: criado.changeRequestId,
        comment: 'Falta o critério de aceite do canal digital.',
      }),
    ).document;

    // Devolvido: o escopo volta a ser editável e o histórico de decisão fica.
    expect(cr(document, criado.changeRequestId).status).toBe('CHANGES_REQUESTED');
    expect(cr(document, criado.changeRequestId).approvals).toHaveLength(1);
    const editado = apply(
      document,
      ctx,
      updateChangeRequestItem({
        changeRequestId: criado.changeRequestId,
        componentId: cena.goodlistId,
        proposedSummary: 'Aprova se o valor do pedido for menor ou igual ao limite em lista.',
      }),
    ).document;

    // Segunda volta: DRAFT de novo, submete, revisa e aprova.
    let aprovado = apply(
      editado,
      ctx,
      transitionChangeRequest({ changeRequestId: criado.changeRequestId, to: 'DRAFT' }),
    ).document;
    for (const to of ['SUBMITTED', 'IN_REVIEW'] as const) {
      aprovado = apply(
        aprovado,
        ctx,
        transitionChangeRequest({ changeRequestId: criado.changeRequestId, to }),
      ).document;
    }
    aprovado = apply(
      aprovado,
      ctx,
      approveChangeRequest({ changeRequestId: criado.changeRequestId }),
    ).document;

    expect(cr(aprovado, criado.changeRequestId).approvals.map((a) => a.decision)).toEqual([
      'RETURNED',
      'APPROVED',
    ]);

    // Congelado: I30 recusa qualquer mexida no escopo com E-GOV-01.
    const erroEdicao = expectFailure(
      aprovado,
      ctx,
      updateChangeRequestItem({
        changeRequestId: criado.changeRequestId,
        componentId: cena.goodlistId,
        proposedSummary: 'Mais uma ideia.',
      }),
      'CR_TRANSITION_INVALID',
    );
    expect(erroEdicao.message).toContain('congelados');
    expectFailure(
      aprovado,
      ctx,
      addChangeRequestItem({
        changeRequestId: criado.changeRequestId,
        componentId: cena.novaRegraId,
        changeType: 'CREATE',
        proposedSummary: 'Outro componente.',
      }),
      'CR_TRANSITION_INVALID',
    );
    expectFailure(
      aprovado,
      ctx,
      removeChangeRequestItem({
        changeRequestId: criado.changeRequestId,
        componentId: cena.goodlistId,
      }),
      'CR_TRANSITION_INVALID',
    );
  });

  it('devolver exige comentário', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const emRevisao = ateEmRevisao(cena, ctx);

    expectFailure(
      emRevisao.document,
      ctx,
      returnChangeRequest({ changeRequestId: emRevisao.changeRequestId }),
      'INVALID_INPUT',
    );
    expectFailure(
      emRevisao.document,
      ctx,
      returnChangeRequest({ changeRequestId: emRevisao.changeRequestId, comment: '   ' }),
      'INVALID_INPUT',
    );
  });

  it('rejeitar fecha o DB, com comentário opcional', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const emRevisao = ateEmRevisao(cena, ctx);

    const rejeitado = apply(
      emRevisao.document,
      ctx,
      rejectChangeRequest({ changeRequestId: emRevisao.changeRequestId }),
    );
    const db = cr(rejeitado.document, emRevisao.changeRequestId);
    expect(db.status).toBe('REJECTED');
    expect(db.approvals[0]).toMatchObject({ decision: 'REJECTED' });
    expect(db.approvals[0]!.comment).toBeUndefined();
    expect(db.events.at(-1)!.type).toBe('CR_DECIDED');
  });

  it('só decide quem está em revisão — e o inverso devolve status e aprovações', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const emDraft = dbSubmetivel(cena.document, ctx, cena.goodlistId);
    expectFailure(
      emDraft.document,
      ctx,
      approveChangeRequest({ changeRequestId: emDraft.changeRequestId }),
      'CR_TRANSITION_INVALID',
    );

    const emRevisao = ateEmRevisao(cena, ctx);
    const { depois, desfeito } = ida(
      emRevisao.document,
      ctx,
      approveChangeRequest({ changeRequestId: emRevisao.changeRequestId, comment: 'Ok.' }),
    );
    expect(cr(depois, emRevisao.changeRequestId).approvals).toHaveLength(1);
    expect(cr(desfeito, emRevisao.changeRequestId).approvals).toEqual([]);
    expect(cr(desfeito, emRevisao.changeRequestId).status).toBe('IN_REVIEW');
    expect(semTrilha(desfeito)).toEqual(semTrilha(emRevisao.document));

    // Refazer o desfeito recoloca a decisão exatamente como estava.
    const aplicado = apply(
      emRevisao.document,
      ctx,
      approveChangeRequest({ changeRequestId: emRevisao.changeRequestId, comment: 'Ok.' }),
    );
    const undo = aplicado.result.inverse.run(aplicado.document, ctx);
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    const redo = undo.inverse.run(undo.document, ctx);
    expect(redo.ok).toBe(true);
    if (redo.ok) {
      expect(cr(redo.document, emRevisao.changeRequestId).approvals).toEqual(
        cr(aplicado.document, emRevisao.changeRequestId).approvals,
      );
    }
  });

  it('recusa comentário em branco na aprovação', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const emRevisao = ateEmRevisao(cena, ctx);
    expectFailure(
      emRevisao.document,
      ctx,
      approveChangeRequest({ changeRequestId: emRevisao.changeRequestId, comment: ' ' }),
      'INVALID_INPUT',
    );
  });
});

function ateEmRevisao(
  cena: GovernanceScenario,
  ctx: TestCtx,
): { document: PolicyOpsDocument; changeRequestId: string } {
  const criado = dbSubmetivel(cena.document, ctx, cena.goodlistId);
  let document = apply(
    criado.document,
    ctx,
    transitionChangeRequest({ changeRequestId: criado.changeRequestId, to: 'SUBMITTED' }),
  ).document;
  document = apply(
    document,
    ctx,
    transitionChangeRequest({ changeRequestId: criado.changeRequestId, to: 'IN_REVIEW' }),
  ).document;
  return { document, changeRequestId: criado.changeRequestId };
}

// ---------------------------------------------------------------------------
// changeRequest/setRelease
// ---------------------------------------------------------------------------

describe('changeRequest/setRelease', () => {
  it('vincula e desvincula, com evento na trilha e inverso exato', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const aprovado = ateAprovado(cena, ctx);
    const comRelease = apply(aprovado.document, ctx, createRelease({ code: '2026.09.01' }));

    const { depois, desfeito } = ida(
      comRelease.document,
      ctx,
      setChangeRequestRelease({
        changeRequestId: aprovado.changeRequestId,
        releaseId: comRelease.data.releaseId,
      }),
    );
    expect(cr(depois, aprovado.changeRequestId).releaseId).toBe(comRelease.data.releaseId);
    expect(cr(depois, aprovado.changeRequestId).events.at(-1)!.summary).toContain('2026.09.01');
    expect(cr(desfeito, aprovado.changeRequestId).releaseId).toBeUndefined();
    expect(semTrilha(desfeito)).toEqual(semTrilha(comRelease.document));

    const desvinculado = apply(
      depois,
      ctx,
      setChangeRequestRelease({ changeRequestId: aprovado.changeRequestId, releaseId: null }),
    );
    expect(cr(desvinculado.document, aprovado.changeRequestId).releaseId).toBeUndefined();
    expect(desvinculado.document.changeRequests[0]!.events.at(-1)!.summary).toContain('tirou');
  });

  it('vincular ao que já está vinculado não gera evento nem escrita', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const aprovado = ateAprovado(cena, ctx);
    const semRelease = apply(
      aprovado.document,
      ctx,
      setChangeRequestRelease({ changeRequestId: aprovado.changeRequestId, releaseId: null }),
    );
    expect(semRelease.document).toBe(aprovado.document);
    expect(semRelease.result.events).toEqual([]);
  });

  it('recusa release inexistente, release fechada e DB fechado', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const aprovado = ateAprovado(cena, ctx);
    const comRelease = apply(aprovado.document, ctx, createRelease({ code: '2026.09.01' }));

    expectFailure(
      comRelease.document,
      ctx,
      setChangeRequestRelease({ changeRequestId: aprovado.changeRequestId, releaseId: 'naoexiste12' }),
      'NOT_FOUND',
    );

    const cancelada = apply(
      comRelease.document,
      ctx,
      cancelRelease({ releaseId: comRelease.data.releaseId }),
    ).document;
    expectFailure(
      cancelada,
      ctx,
      setChangeRequestRelease({
        changeRequestId: aprovado.changeRequestId,
        releaseId: comRelease.data.releaseId,
      }),
      'CR_TRANSITION_INVALID',
    );

    const dbCancelado = apply(
      comRelease.document,
      ctx,
      cancelChangeRequest({ changeRequestId: aprovado.changeRequestId }),
    ).document;
    expectFailure(
      dbCancelado,
      ctx,
      setChangeRequestRelease({
        changeRequestId: aprovado.changeRequestId,
        releaseId: comRelease.data.releaseId,
      }),
      'CR_TRANSITION_INVALID',
    );
  });
});

// ---------------------------------------------------------------------------
// Consultas — lista, numeração sugerida e pendências (S35)
// ---------------------------------------------------------------------------

describe('suggestNextChangeRequestCode (I26)', () => {
  it('sugere DB_1 quando não há nenhum DB no documento', () => {
    expect(suggestNextChangeRequestCode(baseDocument())).toBe('DB_1');
  });

  it('sugere o maior número + 1, ignorando código fora do padrão DB_<n>', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    let document = criarDb(cena.document, ctx, { code: 'DB_515' }).document;
    document = criarDb(document, ctx, { code: 'DB_519' }).document;
    document = criarDb(document, ctx, { code: 'ALTERACAO_FORA_DO_PADRAO' }).document;

    expect(suggestNextChangeRequestCode(document)).toBe('DB_520');
  });
});

describe('listChangeRequests', () => {
  it('filtra por projeto derivado do componente do item, status, prioridade, componente e busca', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const db515 = dbSubmetivel(cena.document, ctx, cena.goodlistId, {
      code: 'DB_515',
      title: 'Goodlist olha o valor do pedido',
      priority: 'HIGH',
    });
    const db999 = criarDb(db515.document, ctx, { code: 'DB_999', title: 'Sem item ainda' });

    const porProjeto = listChangeRequests(db999.document, { projectId: IDS.projectA });
    expect(porProjeto.map((cr) => cr.code)).toEqual(['DB_515']);

    expect(listChangeRequests(db999.document, { projectId: IDS.projectB })).toEqual([]);

    expect(
      listChangeRequests(db999.document, { status: ['DRAFT'] }).map((cr) => cr.code).sort(),
    ).toEqual(['DB_515', 'DB_999']);
    expect(listChangeRequests(db999.document, { priority: 'HIGH' }).map((cr) => cr.code)).toEqual(['DB_515']);
    expect(
      listChangeRequests(db999.document, { componentId: cena.goodlistId }).map((cr) => cr.code),
    ).toEqual(['DB_515']);
    // Componente que nenhum DB toca: o filtro exclui os dois, inclusive o que
    // não tem item nenhum.
    expect(listChangeRequests(db999.document, { componentId: cena.novaRegraId })).toEqual([]);
    expect(listChangeRequests(db999.document, { search: 'valor do pedido' }).map((cr) => cr.code)).toEqual([
      'DB_515',
    ]);
    expect(listChangeRequests(db999.document, { search: 'db_999' }).map((cr) => cr.code)).toEqual(['DB_999']);
  });

  it('sem filtro, devolve todos, mais recente primeiro', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const primeiro = criarDb(cena.document, ctx, { code: 'DB_1' });
    ctx.advance(1000);
    const segundo = criarDb(primeiro.document, ctx, { code: 'DB_2' });

    expect(listChangeRequests(segundo.document).map((cr) => cr.code)).toEqual(['DB_2', 'DB_1']);
  });
});

describe('getChangeRequestPendingSummary (US-GOV-10)', () => {
  it('separa aguardando revisão, devolvidos e aprovados sem release', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);

    // DB_1: submetido, aguardando início de revisão.
    const db1 = dbSubmetivel(cena.document, ctx, cena.goodlistId, { code: 'DB_1' });
    let document = apply(
      db1.document,
      ctx,
      transitionChangeRequest({ changeRequestId: db1.changeRequestId, to: 'SUBMITTED' }),
    ).document;

    // DB_2: submetido, em revisão, devolvido.
    const db2 = criarDb(document, ctx, { code: 'DB_2' });
    document = apply(
      db2.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db2.changeRequestId,
        componentId: cena.novaRegraId,
        changeType: 'CREATE',
        proposedSummary: 'Cria a regra nova.',
      }),
    ).document;
    document = apply(
      document,
      ctx,
      transitionChangeRequest({ changeRequestId: db2.changeRequestId, to: 'SUBMITTED' }),
    ).document;
    document = apply(
      document,
      ctx,
      transitionChangeRequest({ changeRequestId: db2.changeRequestId, to: 'IN_REVIEW' }),
    ).document;
    document = apply(
      document,
      ctx,
      returnChangeRequest({ changeRequestId: db2.changeRequestId, comment: 'Falta critério de aceite.' }),
    ).document;

    // DB_3: submetido, em revisão, aprovado — sem release ainda.
    const db3 = dbSubmetivel(document, ctx, cena.espelhoId, {
      code: 'DB_3',
      motivators: ['RISCO'],
      proposedEffectiveDate: VIGENCIA_PROPOSTA,
    });
    document = apply(
      db3.document,
      ctx,
      transitionChangeRequest({ changeRequestId: db3.changeRequestId, to: 'SUBMITTED' }),
    ).document;
    document = apply(
      document,
      ctx,
      transitionChangeRequest({ changeRequestId: db3.changeRequestId, to: 'IN_REVIEW' }),
    ).document;
    document = apply(
      document,
      ctx,
      approveChangeRequest({ changeRequestId: db3.changeRequestId }),
    ).document;

    const summary = getChangeRequestPendingSummary(document);
    expect(summary.awaitingReview.map((cr) => cr.code)).toEqual(['DB_1']);
    expect(summary.returned.map((cr) => cr.code)).toEqual(['DB_2']);
    expect(summary.approvedWithoutRelease.map((cr) => cr.code)).toEqual(['DB_3']);

    // Escopado por projeto, o painel mostra as mesmas três filas: os itens
    // dos três DBs são do mesmo projeto (docs/14 §19.4).
    const doProjeto = getChangeRequestPendingSummary(document, IDS.projectA);
    expect(doProjeto.awaitingReview.map((cr) => cr.code)).toEqual(['DB_1']);
    expect(getChangeRequestPendingSummary(document, IDS.projectB).awaitingReview).toEqual([]);
  });

  it('aprovado com release vinculada some da lista de "sem release"', () => {
    const ctx = testCtx();
    const cena = cenario(ctx);
    const aprovado = ateAprovado(cena, ctx);
    const comRelease = apply(aprovado.document, ctx, createRelease({ code: '2026.09.01' }));
    const vinculado = apply(
      comRelease.document,
      ctx,
      setChangeRequestRelease({ changeRequestId: aprovado.changeRequestId, releaseId: comRelease.data.releaseId }),
    ).document;

    expect(getChangeRequestPendingSummary(vinculado).approvedWithoutRelease).toEqual([]);
  });
});
