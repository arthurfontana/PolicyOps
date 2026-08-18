import { describe, expect, it } from 'vitest';
import {
  addChangeRequestItem,
  approveChangeRequest,
  setChangeRequestRelease,
  transitionChangeRequest,
  updateChangeRequestItem,
} from '@/core/document/change-requests';
import {
  assessChangeRequestReadiness,
  assessReleaseComposition,
  cancelRelease,
  createRelease,
  listChangeRequestsAvailableForRelease,
  listReleaseChangeRequests,
  locateRelease,
  updateRelease,
} from '@/core/document/releases';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { validateDocument } from '@/core/document/validate';
import { createComponentDraft } from '@/core/versioning/component-lifecycle';
import { apply, expectFailure, testCtx, type TestCtx } from '../versioning/fixtures';
import {
  dbSubmetivel,
  politica,
  VIGENCIA_PROPOSTA,
  type GovernanceScenario,
} from './governance-fixtures';

/**
 * Releases — docs/14 §3.4, docs/08 §3.
 *
 * A publicação em lote é da S36/S37: o que esta sessão entrega é o CRUD com
 * inverso e a **avaliação estática** de composição, que é a lista de pendências
 * que a publicação vai transformar em `E-GOV-04` (RN-GOV-05, CT-GOV-03) quando
 * existir.
 */

function semTrilha(doc: PolicyOpsDocument): unknown {
  return {
    ...doc,
    events: [],
    changeRequests: doc.changeRequests.map((cr) => ({ ...cr, events: [] })),
  };
}

/** Um DB pronto para release: item com rascunho vinculado e status SCHEDULED. */
function dbPronto(
  cena: GovernanceScenario,
  ctx: TestCtx,
  code = 'DB_515',
): { document: PolicyOpsDocument; changeRequestId: string; draftVersionId: string } {
  const criado = dbSubmetivel(cena.document, ctx, cena.goodlistId, { code });
  const rascunho = apply(
    criado.document,
    ctx,
    createComponentDraft({
      componentId: cena.goodlistId,
      payload: { kind: 'RULE', businessDescription: 'Aprova só se o valor for menor que o limite.' },
      changeRequestId: criado.changeRequestId,
    }),
  );
  let document = apply(
    rascunho.document,
    ctx,
    updateChangeRequestItem({
      changeRequestId: criado.changeRequestId,
      componentId: cena.goodlistId,
      baseVersionId: cena.goodlistV1,
      draftVersionId: rascunho.data.versionId,
    }),
  ).document;

  for (const to of ['SUBMITTED', 'IN_REVIEW'] as const) {
    document = apply(
      document,
      ctx,
      transitionChangeRequest({ changeRequestId: criado.changeRequestId, to }),
    ).document;
  }
  document = apply(
    document,
    ctx,
    approveChangeRequest({ changeRequestId: criado.changeRequestId }),
  ).document;
  for (const to of ['IN_DEVELOPMENT', 'IN_VALIDATION', 'READY_FOR_RELEASE', 'SCHEDULED'] as const) {
    document = apply(
      document,
      ctx,
      transitionChangeRequest({ changeRequestId: criado.changeRequestId, to }),
    ).document;
  }

  return { document, changeRequestId: criado.changeRequestId, draftVersionId: rascunho.data.versionId };
}

describe('release/create', () => {
  it('nasce PLANNED, aceita rótulo de calendário com ponto e valida o documento', () => {
    const ctx = testCtx();
    const criada = apply(
      politica(ctx).document,
      ctx,
      createRelease({
        code: '2026.09.01',
        name: 'Release de setembro',
        plannedDate: VIGENCIA_PROPOSTA,
        notes: 'Janela de sexta.',
      }),
    );

    expect(criada.document.releases[0]).toEqual({
      id: criada.data.releaseId,
      code: '2026.09.01',
      name: 'Release de setembro',
      plannedDate: VIGENCIA_PROPOSTA,
      status: 'PLANNED',
      notes: 'Janela de sexta.',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(criada.document.events.at(-1)).toMatchObject({
      type: 'RELEASE_CREATED',
      scope: { releaseId: criada.data.releaseId },
    });
    expect(validateDocument(criada.document).ok).toBe(true);
  });

  it('omite os opcionais ausentes e recusa código duplicado ou em branco', () => {
    const ctx = testCtx();
    const base = politica(ctx).document;
    const criada = apply(base, ctx, createRelease({ code: '2026.09.01' }));

    expect(criada.document.releases[0]!.name).toBeUndefined();
    expect(criada.document.releases[0]!.plannedDate).toBeUndefined();
    expectFailure(criada.document, ctx, createRelease({ code: '2026.09.01' }), 'DUPLICATE_CODE');
    expectFailure(base, ctx, createRelease({ code: '  ' }), 'INVALID_INPUT');
    expectFailure(base, ctx, createRelease({ code: '2026.10.01', name: ' ' }), 'INVALID_INPUT');
    expectFailure(base, ctx, createRelease({ code: '2026.10.01', notes: ' ' }), 'INVALID_INPUT');
    expectFailure(
      base,
      ctx,
      createRelease({ code: '2026.10.01', plannedDate: '01/09/2026' }),
      'INVALID_INPUT',
    );
  });

  it('tem inverso exato, que recusa remover release que já agrupa DB', () => {
    const ctx = testCtx();
    const cena = politica(ctx);
    const criada = apply(cena.document, ctx, createRelease({ code: '2026.09.01' }));

    const desfeita = criada.result.inverse.run(criada.document, ctx);
    expect(desfeita.ok).toBe(true);
    if (!desfeita.ok) return;
    expect(desfeita.document.releases).toEqual([]);
    const refeita = desfeita.inverse.run(desfeita.document, ctx);
    expect(refeita.ok).toBe(true);
    if (refeita.ok) expect(refeita.document.releases).toEqual(criada.document.releases);

    const pronto = dbPronto({ ...cena, document: criada.document }, ctx);
    const vinculado = apply(
      pronto.document,
      ctx,
      setChangeRequestRelease({
        changeRequestId: pronto.changeRequestId,
        releaseId: criada.data.releaseId,
      }),
    ).document;
    const bloqueada = criada.result.inverse.run(vinculado, ctx);
    expect(bloqueada.ok).toBe(false);
    if (!bloqueada.ok) expect(bloqueada.error.code).toBe('CR_TRANSITION_INVALID');
  });
});

describe('release/update e release/cancel', () => {
  it('edita com três estados nos opcionais e desfaz byte a byte', () => {
    const ctx = testCtx();
    const base = apply(
      politica(ctx).document,
      ctx,
      createRelease({ code: '2026.09.01', name: 'Setembro', notes: 'Janela de sexta.' }),
    );
    const releaseId = base.data.releaseId;

    const editada = apply(
      base.document,
      ctx,
      updateRelease({
        releaseId,
        name: null,
        plannedDate: VIGENCIA_PROPOSTA,
        notes: 'Janela de quinta.',
        status: 'IN_DEVELOPMENT',
      }),
    );
    expect(locateRelease(editada.document, releaseId).release).toMatchObject({
      status: 'IN_DEVELOPMENT',
      plannedDate: VIGENCIA_PROPOSTA,
      notes: 'Janela de quinta.',
    });
    expect(locateRelease(editada.document, releaseId).release.name).toBeUndefined();

    const desfeita = editada.result.inverse.run(editada.document, ctx);
    expect(desfeita.ok).toBe(true);
    if (desfeita.ok) expect(semTrilha(desfeita.document)).toEqual(semTrilha(base.document));
  });

  it('mexe só no que veio: mudar o status preserva nome, data e observação', () => {
    const ctx = testCtx();
    const base = apply(
      politica(ctx).document,
      ctx,
      createRelease({ code: '2026.09.01', name: 'Setembro', plannedDate: VIGENCIA_PROPOSTA, notes: 'Sexta.' }),
    );
    const soStatus = apply(
      base.document,
      ctx,
      updateRelease({ releaseId: base.data.releaseId, status: 'IN_DEVELOPMENT' }),
    );

    expect(locateRelease(soStatus.document, base.data.releaseId).release).toMatchObject({
      name: 'Setembro',
      plannedDate: VIGENCIA_PROPOSTA,
      notes: 'Sexta.',
      status: 'IN_DEVELOPMENT',
    });

    const limpa = apply(
      soStatus.document,
      ctx,
      updateRelease({ releaseId: base.data.releaseId, plannedDate: null, notes: null }),
    );
    const release = locateRelease(limpa.document, base.data.releaseId).release;
    expect(release.plannedDate).toBeUndefined();
    expect(release.notes).toBeUndefined();
    expect(release.name).toBe('Setembro');
  });

  it('recusa entrada inválida e release inexistente', () => {
    const ctx = testCtx();
    const base = apply(politica(ctx).document, ctx, createRelease({ code: '2026.09.01' }));
    const releaseId = base.data.releaseId;

    expectFailure(base.document, ctx, updateRelease({ releaseId, name: ' ' }), 'INVALID_INPUT');
    expectFailure(base.document, ctx, updateRelease({ releaseId, notes: ' ' }), 'INVALID_INPUT');
    expectFailure(base.document, ctx, updateRelease({ releaseId, plannedDate: 'amanhã' }), 'INVALID_INPUT');
    expectFailure(base.document, ctx, updateRelease({ releaseId: 'naoexiste12' }), 'NOT_FOUND');
    expectFailure(base.document, ctx, cancelRelease({ releaseId, reason: ' ' }), 'INVALID_INPUT');
  });

  it('cancelar é reversível, não mexe nos DBs vinculados e não se repete', () => {
    const ctx = testCtx();
    const cena = politica(ctx);
    const comRelease = apply(cena.document, ctx, createRelease({ code: '2026.09.01' }));
    const pronto = dbPronto({ ...cena, document: comRelease.document }, ctx);
    const vinculado = apply(
      pronto.document,
      ctx,
      setChangeRequestRelease({
        changeRequestId: pronto.changeRequestId,
        releaseId: comRelease.data.releaseId,
      }),
    ).document;

    const cancelada = apply(
      vinculado,
      ctx,
      cancelRelease({ releaseId: comRelease.data.releaseId, reason: 'Janela adiada.' }),
    );
    expect(locateRelease(cancelada.document, comRelease.data.releaseId).release.status).toBe('CANCELLED');
    expect(cancelada.data).toEqual({ from: 'PLANNED' });
    expect(cancelada.document.changeRequests[0]!.releaseId).toBe(comRelease.data.releaseId);
    expect(cancelada.document.events.at(-1)!.summary).toContain('Janela adiada.');

    // Fechada: nem editar nem cancelar de novo.
    expectFailure(
      cancelada.document,
      ctx,
      updateRelease({ releaseId: comRelease.data.releaseId, name: 'Outro nome' }),
      'CR_TRANSITION_INVALID',
    );
    expectFailure(
      cancelada.document,
      ctx,
      cancelRelease({ releaseId: comRelease.data.releaseId }),
      'CR_TRANSITION_INVALID',
    );

    const desfeita = cancelada.result.inverse.run(cancelada.document, ctx);
    expect(desfeita.ok).toBe(true);
    if (!desfeita.ok) return;
    expect(locateRelease(desfeita.document, comRelease.data.releaseId).release.status).toBe('PLANNED');
    const refeita = desfeita.inverse.run(desfeita.document, ctx);
    expect(refeita.ok).toBe(true);
    if (refeita.ok) {
      expect(locateRelease(refeita.document, comRelease.data.releaseId).release.status).toBe('CANCELLED');
    }
  });

  it('cancelar sem motivo não inventa frase', () => {
    const ctx = testCtx();
    const base = apply(politica(ctx).document, ctx, createRelease({ code: '2026.09.01' }));
    const cancelada = apply(base.document, ctx, cancelRelease({ releaseId: base.data.releaseId }));
    expect(cancelada.document.events.at(-1)!.summary).toBe('Arthur cancelou a release "2026.09.01".');
  });
});

describe('composição da release (validação estática)', () => {
  it('lista os DBs vinculados e dá release pronta quando todos estão prontos', () => {
    const ctx = testCtx();
    const cena = politica(ctx);
    const comRelease = apply(cena.document, ctx, createRelease({ code: '2026.09.01' }));
    const pronto = dbPronto({ ...cena, document: comRelease.document }, ctx);
    const vinculado = apply(
      pronto.document,
      ctx,
      setChangeRequestRelease({
        changeRequestId: pronto.changeRequestId,
        releaseId: comRelease.data.releaseId,
      }),
    ).document;

    const composicao = assessReleaseComposition(vinculado, comRelease.data.releaseId);
    expect(composicao).toMatchObject({ code: '2026.09.01', status: 'PLANNED', ready: true, blockers: [] });
    expect(composicao.entries).toHaveLength(1);
    expect(composicao.entries[0]).toMatchObject({ code: 'DB_515', status: 'SCHEDULED', ready: true });
    expect(listReleaseChangeRequests(vinculado, comRelease.data.releaseId)).toHaveLength(1);
  });

  it('release vazia não está pronta', () => {
    const ctx = testCtx();
    const criada = apply(politica(ctx).document, ctx, createRelease({ code: '2026.09.01' }));
    expect(assessReleaseComposition(criada.document, criada.data.releaseId)).toMatchObject({
      entries: [],
      ready: false,
      blockers: [],
    });
  });

  it('CT-GOV-03: aponta a pendência de cada DB que não está pronto', () => {
    const ctx = testCtx();
    const cena = politica(ctx);
    const comRelease = apply(cena.document, ctx, createRelease({ code: '2026.09.01' }));
    const releaseId = comRelease.data.releaseId;

    // DB_515 pronto; DB_519 aprovado (entra na release, S37), com item UPDATE
    // sem rascunho — por isso ainda não está pronto para publicar.
    const pronto = dbPronto({ ...cena, document: comRelease.document }, ctx);
    const criadoAtrasado = dbSubmetivel(
      { ...cena, document: pronto.document }.document,
      ctx,
      cena.novaRegraId,
      { code: 'DB_519' },
    );
    let atrasadoDoc = criadoAtrasado.document;
    for (const to of ['SUBMITTED', 'IN_REVIEW', 'APPROVED'] as const) {
      atrasadoDoc = apply(
        atrasadoDoc,
        ctx,
        transitionChangeRequest({ changeRequestId: criadoAtrasado.changeRequestId, to }),
      ).document;
    }
    const atrasado = { document: atrasadoDoc, changeRequestId: criadoAtrasado.changeRequestId };
    let doc = apply(
      atrasado.document,
      ctx,
      setChangeRequestRelease({ changeRequestId: pronto.changeRequestId, releaseId }),
    ).document;
    doc = apply(
      doc,
      ctx,
      setChangeRequestRelease({ changeRequestId: atrasado.changeRequestId, releaseId }),
    ).document;

    const composicao = assessReleaseComposition(doc, releaseId);
    expect(composicao.ready).toBe(false);
    expect(composicao.entries.map((entry) => entry.ready)).toEqual([true, false]);
    expect(composicao.blockers.map((blocker) => blocker.kind)).toEqual([
      'CR_NOT_READY',
      'ITEM_WITHOUT_DRAFT',
    ]);
    expect(composicao.blockers.every((blocker) => blocker.changeRequestCode === 'DB_519')).toBe(true);
    expect(composicao.blockers[1]!.componentId).toBe(cena.novaRegraId);
  });

  it('cobra vigência, escopo e rascunho ainda em rascunho', () => {
    const ctx = testCtx();
    const cena = politica(ctx);
    const pronto = dbPronto(cena, ctx);

    const semVigencia = structuredClone(pronto.document);
    delete semVigencia.changeRequests[0]!.proposedEffectiveDate;
    semVigencia.changeRequests[0]!.items = [];
    expect(
      assessChangeRequestReadiness(semVigencia, semVigencia.changeRequests[0]!).blockers.map((b) => b.kind),
    ).toEqual(['CR_WITHOUT_ITEMS', 'CR_WITHOUT_EFFECTIVE_DATE']);

    // O rascunho vinculado saiu de DRAFT por fora do DB (é o que a publicação
    // da S36 precisa detectar antes de tentar publicar).
    const rascunhoQueimado = structuredClone(pronto.document);
    const versoes = rascunhoQueimado.components.find((c) => c.id === cena.goodlistId)!.versions;
    versoes[versoes.length - 1]!.state = 'SUPERSEDED';
    expect(
      assessChangeRequestReadiness(rascunhoQueimado, rascunhoQueimado.changeRequests[0]!).blockers.map(
        (b) => b.kind,
      ),
    ).toEqual(['ITEM_DRAFT_NOT_DRAFT']);
  });

  it('acusa base defasada — o rebase que a S36 vai pedir (RN-GOV-02)', () => {
    const ctx = testCtx();
    const cena = politica(ctx);
    const pronto = dbPronto(cena, ctx);

    const defasado = structuredClone(pronto.document);
    const item = defasado.changeRequests[0]!.items[0]!;
    // A base do item deixou de ser a versão publicada: outra publicação passou
    // na frente. Aqui isso é simulado apontando a base para o próprio rascunho.
    item.baseVersionId = item.draftVersionId;
    expect(
      assessChangeRequestReadiness(defasado, defasado.changeRequests[0]!).blockers.map((b) => b.kind),
    ).toEqual(['ITEM_BASE_STALE']);
  });

  it('não cobra rascunho de item que não produz versão (DOC_ONLY, MOVE…)', () => {
    const ctx = testCtx();
    const cena = politica(ctx);
    const pronto = dbPronto(cena, ctx);

    const docOnly = structuredClone(pronto.document);
    const item = docOnly.changeRequests[0]!.items[0]!;
    item.changeType = 'DOC_ONLY';
    delete item.draftVersionId;
    delete item.baseVersionId;
    expect(assessChangeRequestReadiness(docOnly, docOnly.changeRequests[0]!).blockers).toEqual([]);
  });

  it('item de espelho de matriz é avaliado contra as versões da matriz', () => {
    const ctx = testCtx();
    const cena = politica(ctx);
    const pronto = dbPronto(cena, ctx);
    const comEspelho = structuredClone(pronto.document);
    comEspelho.changeRequests[0]!.items.push({
      componentId: cena.espelhoId,
      changeType: 'UPDATE',
      draftVersionId: cena.matrixDraftId,
      proposedSummary: 'Corte novo.',
    });
    expect(assessChangeRequestReadiness(comEspelho, comEspelho.changeRequests[0]!).blockers).toEqual([]);

    // Componente que sumiu do documento não trava a avaliação — só o que dá
    // para conferir é conferido (a referência quebrada é problema de I30).
    const semComponente = structuredClone(comEspelho);
    semComponente.components = semComponente.components.filter((c) => c.id !== cena.espelhoId);
    expect(
      assessChangeRequestReadiness(semComponente, semComponente.changeRequests[0]!).blockers,
    ).toEqual([]);

    // Espelho cuja matriz sumiu: o rascunho vinculado deixa de existir, e a
    // composição acusa em vez de estourar.
    const semMatriz = structuredClone(comEspelho);
    semMatriz.matrices = [];
    expect(
      assessChangeRequestReadiness(semMatriz, semMatriz.changeRequests[0]!).blockers.map((b) => b.kind),
    ).toEqual(['ITEM_DRAFT_NOT_DRAFT']);
  });

  it('lista os candidatos a entrar numa release', () => {
    const ctx = testCtx();
    const cena = politica(ctx);
    const comRelease = apply(cena.document, ctx, createRelease({ code: '2026.09.01' }));
    const pronto = dbPronto({ ...cena, document: comRelease.document }, ctx);

    expect(listChangeRequestsAvailableForRelease(pronto.document).map((cr) => cr.code)).toEqual([
      'DB_515',
    ]);

    const vinculado = apply(
      pronto.document,
      ctx,
      setChangeRequestRelease({
        changeRequestId: pronto.changeRequestId,
        releaseId: comRelease.data.releaseId,
      }),
    ).document;
    expect(listChangeRequestsAvailableForRelease(vinculado)).toEqual([]);
  });

  it('release inexistente é NOT_FOUND na composição', () => {
    const ctx = testCtx();
    const doc = politica(ctx).document;
    expect(() => assessReleaseComposition(doc, 'naoexiste12')).toThrowError(/não existe/);
  });
});

describe('changeRequest/addItem em DB de release', () => {
  it('não deixa incluir componente novo depois de agendado (I30)', () => {
    const ctx = testCtx();
    const cena = politica(ctx);
    const pronto = dbPronto(cena, ctx);

    expectFailure(
      pronto.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: pronto.changeRequestId,
        componentId: cena.novaRegraId,
        changeType: 'CREATE',
        proposedSummary: 'Tarde demais.',
      }),
      'CR_TRANSITION_INVALID',
    );
  });
});
