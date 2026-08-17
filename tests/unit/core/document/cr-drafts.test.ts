import { describe, expect, it } from 'vitest';
import {
  addChangeRequestItem,
  approveChangeRequest,
  createChangeRequest,
  returnChangeRequest,
  transitionChangeRequest,
} from '@/core/document/change-requests';
import {
  createChangeRequestComponentItem,
  linkChangeRequestDraft,
  unlinkChangeRequestDraft,
} from '@/core/document/cr-drafts';
import { createComponent } from '@/core/document/components';
import { validateDocument } from '@/core/document/validate';
import { applyCellPatch } from '@/core/versioning/cells';
import {
  createComponentDraft,
  discardComponentDraft,
  updateComponentVersion,
} from '@/core/versioning/component-lifecycle';
import { discardDraft, publishVersion } from '@/core/versioning/lifecycle';
import { applyRichDocOp } from '@/core/richdoc/commands';
import { apply, coordsOf, expectFailure, testCtx } from '../versioning/fixtures';
import { criarDb, dbSubmetivel, politica } from './governance-fixtures';

/**
 * S36 — o vínculo entre item de DB e rascunho (docs/14 §3.3, I25) e o
 * congelamento de ponta a ponta (`E-GOV-01`, CT-GOV-04).
 */

describe('changeRequest/linkDraft', () => {
  it('cria o rascunho do componente com o changeRequestId do DB e o aponta no item', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);

    const vinculado = apply(
      db.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Aprova só até o limite em lista.' },
      }),
    );

    expect(vinculado.data).toMatchObject({ kind: 'COMPONENT', created: true });

    const goodlist = vinculado.document.components.find((c) => c.id === cenario.goodlistId)!;
    const rascunho = goodlist.versions.find((v) => v.id === vinculado.data.draftVersionId)!;
    expect(rascunho).toMatchObject({ number: 2, state: 'DRAFT', changeRequestId: db.changeRequestId });
    expect(rascunho.payload).toMatchObject({ businessDescription: 'Aprova só até o limite em lista.' });

    const item = vinculado.document.changeRequests[0]!.items[0]!;
    expect(item.draftVersionId).toBe(vinculado.data.draftVersionId);
    // A base é a vigente no momento do vínculo — é ela que RN-GOV-02 compara.
    expect(item.baseVersionId).toBe(cenario.goodlistV1);
    expect(validateDocument(vinculado.document).ok).toBe(true);
  });

  it('adota um rascunho solto que o analista já tinha começado, sem criar outro', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const comRascunho = apply(
      cenario.document,
      ctx,
      createComponentDraft({ componentId: cenario.goodlistId }),
    );
    const db = dbSubmetivel(comRascunho.document, ctx, cenario.goodlistId);

    const vinculado = apply(
      db.document,
      ctx,
      linkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.goodlistId }),
    );

    expect(vinculado.data).toMatchObject({ created: false });
    expect(vinculado.data.draftVersionId).toBe(comRascunho.data.versionId);
    const goodlist = vinculado.document.components.find((c) => c.id === cenario.goodlistId)!;
    expect(goodlist.versions).toHaveLength(2);
    expect(goodlist.versions[1]!.changeRequestId).toBe(db.changeRequestId);
  });

  it('recusa o rascunho que já pertence a outro DB (um rascunho, no máximo um DB)', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const primeiro = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);
    const vinculado = apply(
      primeiro.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: primeiro.changeRequestId,
        componentId: cenario.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Proposta do primeiro DB.' },
      }),
    );

    const segundo = criarDb(vinculado.document, ctx, { code: 'DB_516' });
    const comItem = apply(
      segundo.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: segundo.changeRequestId,
        componentId: cenario.goodlistId,
        changeType: 'UPDATE',
        proposedSummary: 'Outra proposta para a mesma regra.',
      }),
    );

    const erro = expectFailure(
      comItem.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: segundo.changeRequestId,
        componentId: cenario.goodlistId,
      }),
      'INVALID_INPUT',
    );
    expect(erro.message).toContain('DB_515');
  });

  it('vincula o rascunho da matriz no item de espelho, sem criar versão de componente', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = criarDb(cenario.document, ctx);
    const comItem = apply(
      db.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db.changeRequestId,
        componentId: cenario.espelhoId,
        changeType: 'UPDATE',
        proposedSummary: 'Corte do cineminha sobe para 700.',
      }),
    );

    const vinculado = apply(
      comItem.document,
      ctx,
      linkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.espelhoId }),
    );

    expect(vinculado.data).toMatchObject({ kind: 'MATRIX', created: false });
    expect(vinculado.data.draftVersionId).toBe(cenario.matrixDraftId);
    const espelho = vinculado.document.components.find((c) => c.id === cenario.espelhoId)!;
    expect(espelho.versions).toEqual([]);
    expect(validateDocument(vinculado.document).ok).toBe(true);
  });

  it('recusa vincular por cima de um vínculo existente', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);
    const vinculado = apply(
      db.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Proposta.' },
      }),
    );

    expectFailure(
      vinculado.document,
      ctx,
      linkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.goodlistId }),
      'INVALID_INPUT',
    );
  });

  it('recusa vincular depois de APPROVED (I25, E-GOV-01)', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);
    let document = apply(db.document, ctx, transitionChangeRequest({ changeRequestId: db.changeRequestId, to: 'SUBMITTED' })).document;
    document = apply(document, ctx, transitionChangeRequest({ changeRequestId: db.changeRequestId, to: 'IN_REVIEW' })).document;
    document = apply(document, ctx, approveChangeRequest({ changeRequestId: db.changeRequestId })).document;

    expectFailure(
      document,
      ctx,
      linkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.goodlistId }),
      'CR_TRANSITION_INVALID',
    );
  });

  it('desfazer o vínculo apaga o rascunho que ele criou', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);
    const vinculado = apply(
      db.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Proposta.' },
      }),
    );

    const desfeito = apply(vinculado.document, ctx, vinculado.result.inverse);
    const goodlist = desfeito.document.components.find((c) => c.id === cenario.goodlistId)!;
    expect(goodlist.versions).toHaveLength(1);
    expect(desfeito.document.changeRequests[0]!.items[0]!.draftVersionId).toBeUndefined();
    expect(validateDocument(desfeito.document).ok).toBe(true);
  });
});

describe('changeRequest/unlinkDraft', () => {
  it('solta o vínculo e devolve o rascunho ao componente, sem descartar', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);
    const vinculado = apply(
      db.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Proposta.' },
      }),
    );

    const solto = apply(
      vinculado.document,
      ctx,
      unlinkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.goodlistId }),
    );

    expect(solto.data).toEqual({ discarded: false });
    const goodlist = solto.document.components.find((c) => c.id === cenario.goodlistId)!;
    expect(goodlist.versions).toHaveLength(2);
    expect(goodlist.versions[1]!.changeRequestId).toBeUndefined();
    expect(solto.document.changeRequests[0]!.items[0]!.draftVersionId).toBeUndefined();
    expect(validateDocument(solto.document).ok).toBe(true);
  });

  it('descarta o rascunho quando o descarte é pedido explicitamente', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);
    const vinculado = apply(
      db.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Proposta.' },
      }),
    );

    const descartado = apply(
      vinculado.document,
      ctx,
      unlinkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        discardDraft: true,
      }),
    );

    expect(descartado.data).toEqual({ discarded: true });
    const goodlist = descartado.document.components.find((c) => c.id === cenario.goodlistId)!;
    expect(goodlist.versions).toHaveLength(1);
  });

  it('desfazer devolve o vínculo e o rascunho descartado', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);
    const vinculado = apply(
      db.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Proposta.' },
      }),
    );
    const descartado = apply(
      vinculado.document,
      ctx,
      unlinkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        discardDraft: true,
      }),
    );

    const refeito = apply(descartado.document, ctx, descartado.result.inverse);
    const goodlist = refeito.document.components.find((c) => c.id === cenario.goodlistId)!;
    expect(goodlist.versions).toHaveLength(2);
    expect(refeito.document.changeRequests[0]!.items[0]!.draftVersionId).toBe(vinculado.data.draftVersionId);
    expect(validateDocument(refeito.document).ok).toBe(true);
  });

  it('recusa desvincular item sem rascunho e DB congelado', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);

    expectFailure(
      db.document,
      ctx,
      unlinkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.goodlistId }),
      'INVALID_INPUT',
    );
  });
});

describe('changeRequest/createComponentItem — item CREATE cria componente e rascunho juntos', () => {
  it('cria componente, item e rascunho numa transação só', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = criarDb(cenario.document, ctx);

    const criado = apply(
      db.document,
      ctx,
      createChangeRequestComponentItem({
        changeRequestId: db.changeRequestId,
        projectId: cenario.document.projects[0]!.id,
        code: 'REGRA_CINEMINHA',
        name: 'Cineminha do G7',
        type: 'RULE',
        payload: { kind: 'RULE', businessDescription: 'Corte de score 700 para o cluster G7.' },
        proposedSummary: 'Nova regra de corte do cineminha.',
      }),
    );

    const componente = criado.document.components.find((c) => c.id === criado.data.componentId)!;
    expect(componente.code).toBe('REGRA_CINEMINHA');
    expect(componente.versions).toHaveLength(1);
    expect(componente.versions[0]).toMatchObject({ state: 'DRAFT', changeRequestId: db.changeRequestId });

    const item = criado.document.changeRequests[0]!.items[0]!;
    expect(item).toMatchObject({ changeType: 'CREATE', draftVersionId: criado.data.draftVersionId });
    expect(item.baseVersionId).toBeUndefined();
    expect(validateDocument(criado.document).ok).toBe(true);
  });

  it('desfazer remove os três de uma vez, sem deixar item apontando componente inexistente', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = criarDb(cenario.document, ctx);
    const criado = apply(
      db.document,
      ctx,
      createChangeRequestComponentItem({
        changeRequestId: db.changeRequestId,
        projectId: cenario.document.projects[0]!.id,
        code: 'REGRA_CINEMINHA',
        name: 'Cineminha do G7',
        type: 'RULE',
        payload: { kind: 'RULE', businessDescription: 'Corte de score 700.' },
        proposedSummary: 'Nova regra.',
      }),
    );

    const desfeito = apply(criado.document, ctx, criado.result.inverse);
    expect(desfeito.document.components.some((c) => c.code === 'REGRA_CINEMINHA')).toBe(false);
    expect(desfeito.document.changeRequests[0]!.items).toEqual([]);
    expect(validateDocument(desfeito.document).ok).toBe(true);
  });
});

describe('congelamento do rascunho vinculado (I25, CT-GOV-04)', () => {
  function aprovado() {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);
    const vinculado = apply(
      db.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Proposta aprovada.' },
      }),
    );
    let document = apply(vinculado.document, ctx, transitionChangeRequest({ changeRequestId: db.changeRequestId, to: 'SUBMITTED' })).document;
    document = apply(document, ctx, transitionChangeRequest({ changeRequestId: db.changeRequestId, to: 'IN_REVIEW' })).document;
    document = apply(document, ctx, approveChangeRequest({ changeRequestId: db.changeRequestId })).document;
    return { ctx, cenario, document, changeRequestId: db.changeRequestId, draftVersionId: vinculado.data.draftVersionId };
  }

  it('recusa editar o payload do rascunho vinculado', () => {
    const { ctx, document, draftVersionId } = aprovado();
    const erro = expectFailure(
      document,
      ctx,
      updateComponentVersion({
        versionId: draftVersionId,
        payload: { kind: 'RULE', businessDescription: 'Editado por fora do DB.' },
      }),
      'CR_TRANSITION_INVALID',
    );
    expect(erro.message).toContain('DB_515');
  });

  it('recusa descartar o rascunho vinculado', () => {
    const { ctx, document, draftVersionId } = aprovado();
    expectFailure(document, ctx, discardComponentDraft({ versionId: draftVersionId }), 'CR_TRANSITION_INVALID');
  });

  it('recusa editar a especificação rica do rascunho vinculado', () => {
    const { ctx, document, draftVersionId } = aprovado();
    expectFailure(
      document,
      ctx,
      applyRichDocOp({
        target: { kind: 'COMPONENT_VERSION_SPEC', versionId: draftVersionId },
        op: {
          kind: 'insertBlock',
          index: 0,
          block: { id: 'blk_novo____', type: 'paragraph', text: [{ text: 'Novo' }] },
        },
      }),
      'CR_TRANSITION_INVALID',
    );
  });

  it('recusa editar células e descartar o rascunho de matriz vinculado', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = criarDb(cenario.document, ctx);
    const comItem = apply(
      db.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db.changeRequestId,
        componentId: cenario.espelhoId,
        changeType: 'UPDATE',
        proposedSummary: 'Corte sobe.',
      }),
    );
    const vinculado = apply(
      comItem.document,
      ctx,
      linkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.espelhoId }),
    );
    let document = apply(vinculado.document, ctx, transitionChangeRequest({ changeRequestId: db.changeRequestId, to: 'SUBMITTED' })).document;
    document = apply(document, ctx, transitionChangeRequest({ changeRequestId: db.changeRequestId, to: 'IN_REVIEW' })).document;
    document = apply(document, ctx, approveChangeRequest({ changeRequestId: db.changeRequestId })).document;

    const coords = coordsOf(document, cenario.matrixDraftId).slice(0, 1);
    expectFailure(
      document,
      ctx,
      applyCellPatch({ versionId: cenario.matrixDraftId, patch: { coords, set: { decision: 'REPROVADO' } } }),
      'CR_TRANSITION_INVALID',
    );
    expectFailure(document, ctx, discardDraft({ versionId: cenario.matrixDraftId }), 'CR_TRANSITION_INVALID');
  });

  it('CHANGES_REQUESTED reabre a edição do rascunho preservando o histórico de aprovação', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);
    const vinculado = apply(
      db.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Proposta.' },
      }),
    );
    let aprovado = apply(vinculado.document, ctx, transitionChangeRequest({ changeRequestId: db.changeRequestId, to: 'SUBMITTED' })).document;
    aprovado = apply(aprovado, ctx, transitionChangeRequest({ changeRequestId: db.changeRequestId, to: 'IN_REVIEW' })).document;
    aprovado = apply(aprovado, ctx, approveChangeRequest({ changeRequestId: db.changeRequestId })).document;
    // Aprovado, o rascunho está congelado…
    expectFailure(
      aprovado,
      ctx,
      updateComponentVersion({
        versionId: vinculado.data.draftVersionId,
        payload: { kind: 'RULE', businessDescription: 'Tentativa de edição.' },
      }),
      'CR_TRANSITION_INVALID',
    );

    // …e devolver reabre. Devolver **de** APPROVED não existe no grafo
    // (DEC-GOV-020): o caminho é a devolução a partir de IN_REVIEW, que é o
    // que o CT-GOV-04 descreve.
    let devolvido = apply(vinculado.document, ctx, transitionChangeRequest({ changeRequestId: db.changeRequestId, to: 'SUBMITTED' })).document;
    devolvido = apply(devolvido, ctx, transitionChangeRequest({ changeRequestId: db.changeRequestId, to: 'IN_REVIEW' })).document;
    devolvido = apply(devolvido, ctx, returnChangeRequest({ changeRequestId: db.changeRequestId, comment: 'Faltou o cenário de teste.' })).document;

    const editado = apply(
      devolvido,
      ctx,
      updateComponentVersion({
        versionId: vinculado.data.draftVersionId,
        payload: { kind: 'RULE', businessDescription: 'Proposta corrigida.' },
      }),
    );
    const goodlist = editado.document.components.find((c) => c.id === cenario.goodlistId)!;
    expect(goodlist.versions[1]!.payload).toMatchObject({ businessDescription: 'Proposta corrigida.' });
    expect(editado.document.changeRequests[0]!.approvals).toHaveLength(1);
  });

  it('rascunho sem DB nenhum continua editável — o congelamento é do vínculo, não do rascunho', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const solto = apply(cenario.document, ctx, createComponentDraft({ componentId: cenario.goodlistId }));
    const editado = apply(
      solto.document,
      ctx,
      updateComponentVersion({
        versionId: solto.data.versionId,
        payload: { kind: 'RULE', businessDescription: 'Publicação direta, RN-GOV-07.' },
      }),
    );
    expect(editado.result.ok).toBe(true);
  });
});

describe('changeRequest/linkDraft — bordas', () => {
  it('recusa componente que não é item do DB', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);

    expectFailure(
      db.document,
      ctx,
      linkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.novaRegraId }),
      'NOT_FOUND',
    );
  });

  it('recusa rascunho carimbado com outro DB, mesmo sem item apontando para ele', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const outroDb = apply(cenario.document, ctx, createChangeRequest({ code: 'DB_900', title: 'Outro' }));
    // Rascunho carimbado à mão com o DB-900, sem item nenhum: quem pega isso é
    // o vínculo de volta (I30), não a varredura de itens.
    const carimbado = apply(
      outroDb.document,
      ctx,
      createComponentDraft({
        componentId: cenario.goodlistId,
        changeRequestId: outroDb.data.changeRequestId,
      }),
    );
    const db = dbSubmetivel(carimbado.document, ctx, cenario.goodlistId);

    const erro = expectFailure(
      db.document,
      ctx,
      linkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.goodlistId }),
      'INVALID_INPUT',
    );
    expect(erro.message).toContain('outro DB');
  });

  it('atualiza o payload do rascunho adotado quando o vínculo traz conteúdo', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const comRascunho = apply(
      cenario.document,
      ctx,
      createComponentDraft({ componentId: cenario.goodlistId }),
    );
    const db = dbSubmetivel(comRascunho.document, ctx, cenario.goodlistId);

    const vinculado = apply(
      db.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Texto que o vínculo trouxe.' },
        spec: { blocks: [{ id: 'blk_spec____', type: 'paragraph', text: [{ text: 'Detalhe.' }] }] },
      }),
    );

    const goodlist = vinculado.document.components.find((c) => c.id === cenario.goodlistId)!;
    const rascunho = goodlist.versions.find((v) => v.id === vinculado.data.draftVersionId)!;
    expect(rascunho.payload).toMatchObject({ businessDescription: 'Texto que o vínculo trouxe.' });
    expect(rascunho.spec!.blocks).toHaveLength(1);
  });

  it('cria o rascunho da matriz quando ela não tem nenhum aberto', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    // A matriz do cenário nasce com v1 em rascunho; publicá-la deixa a matriz
    // sem rascunho aberto, que é o caso em que o vínculo precisa criar um.
    const publicada = apply(
      cenario.document,
      ctx,
      publishVersion({ versionId: cenario.matrixDraftId, notes: 'Publicação inicial da matriz.' }),
    );
    const db = criarDb(publicada.document, ctx);
    const comItem = apply(
      db.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db.changeRequestId,
        componentId: cenario.espelhoId,
        changeType: 'UPDATE',
        proposedSummary: 'Corte sobe.',
      }),
    );

    const vinculado = apply(
      comItem.document,
      ctx,
      linkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.espelhoId }),
    );

    expect(vinculado.data).toMatchObject({ kind: 'MATRIX', created: true });
    const matriz = vinculado.document.matrices.find((m) => m.id === cenario.matrixId)!;
    expect(matriz.versions).toHaveLength(2);
    expect(matriz.versions[1]).toMatchObject({ number: 2, state: 'DRAFT' });
    // A base do item passa a ser a v1 publicada — é ela que RN-GOV-02 compara.
    expect(vinculado.document.changeRequests[0]!.items[0]!.baseVersionId).toBe(cenario.matrixDraftId);
  });

  it('recusa espelho cuja matriz sumiu do documento', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = criarDb(cenario.document, ctx);
    const comItem = apply(
      db.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db.changeRequestId,
        componentId: cenario.espelhoId,
        changeType: 'UPDATE',
        proposedSummary: 'Corte sobe.',
      }),
    );
    const semMatriz = structuredClone(comItem.document);
    semMatriz.matrices = [];

    expectFailure(
      semMatriz,
      ctx,
      linkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.espelhoId }),
      'NOT_FOUND',
    );
  });

  it('vincula rascunho de matriz derivado de uma base escolhida, e desvincular com descarte o remove', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const publicada = apply(
      cenario.document,
      ctx,
      publishVersion({ versionId: cenario.matrixDraftId, notes: 'Publicação inicial da matriz.' }),
    );
    const db = criarDb(publicada.document, ctx);
    const comItem = apply(
      db.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db.changeRequestId,
        componentId: cenario.espelhoId,
        changeType: 'UPDATE',
        proposedSummary: 'Corte sobe.',
      }),
    );

    // Restaurar uma versão antiga como rascunho é o caso de `baseVersionId`
    // explícito (docs/05 §1.2) — aqui, a própria v1 publicada.
    const vinculado = apply(
      comItem.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.espelhoId,
        baseVersionId: cenario.matrixDraftId,
      }),
    );
    expect(vinculado.data).toMatchObject({ kind: 'MATRIX', created: true });

    const descartado = apply(
      vinculado.document,
      ctx,
      unlinkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.espelhoId,
        discardDraft: true,
      }),
    );
    const matriz = descartado.document.matrices.find((m) => m.id === cenario.matrixId)!;
    // Rascunho de matriz descartado vira ARCHIVED e queima o número (docs/05 §1.4).
    expect(matriz.versions.find((v) => v.id === vinculado.data.draftVersionId)!.state).toBe('ARCHIVED');
    expect(descartado.document.changeRequests[0]!.items[0]!.draftVersionId).toBeUndefined();
  });

  it('createComponentItem pendura o componente novo na seção escolhida', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const secao = apply(
      cenario.document,
      ctx,
      createComponent({
        projectId: cenario.document.projects[0]!.id,
        code: 'CAP_BLOQUEIOS',
        name: 'Bloqueios',
        type: 'SECTION',
      }),
    );
    const db = criarDb(secao.document, ctx);

    const criado = apply(
      db.document,
      ctx,
      createChangeRequestComponentItem({
        changeRequestId: db.changeRequestId,
        projectId: cenario.document.projects[0]!.id,
        parentId: secao.data.componentId,
        code: 'REGRA_FILHA',
        name: 'Regra filha',
        type: 'RULE',
        payload: { kind: 'RULE', businessDescription: 'Descrição.' },
        proposedSummary: 'Nasce dentro de Bloqueios.',
      }),
    );

    const componente = criado.document.components.find((c) => c.id === criado.data.componentId)!;
    expect(componente.parentId).toBe(secao.data.componentId);
  });

  it('createComponentItem aceita especificação rica na primeira versão', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = criarDb(cenario.document, ctx);

    const criado = apply(
      db.document,
      ctx,
      createChangeRequestComponentItem({
        changeRequestId: db.changeRequestId,
        projectId: cenario.document.projects[0]!.id,
        code: 'REGRA_NOVA_SPEC',
        name: 'Regra com especificação',
        type: 'RULE',
        parentId: undefined,
        payload: { kind: 'RULE', businessDescription: 'Descrição.' },
        spec: { blocks: [{ id: 'blk_um_____1', type: 'paragraph', text: [{ text: 'Contexto.' }] }] },
        proposedSummary: 'Nasce com especificação.',
      }),
    );

    const componente = criado.document.components.find((c) => c.id === criado.data.componentId)!;
    expect(componente.versions[0]!.spec!.blocks).toHaveLength(1);
  });
});
