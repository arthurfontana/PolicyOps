import { describe, expect, it } from 'vitest';
import {
  addChangeRequestItem,
  transitionChangeRequest,
  updateChangeRequest,
} from '@/core/document/change-requests';
import { linkChangeRequestDraft, unlinkChangeRequestDraft } from '@/core/document/cr-drafts';
import {
  changeRequestPublishedAt,
  isChangeRequestPublished,
  planChangeRequestPublish,
  preflightChangeRequestPublish,
  publishChangeRequest,
} from '@/core/document/cr-publish';
import { validateDocument } from '@/core/document/validate';
import { getComponentEffectiveVersion, getEffectiveVersion } from '@/core/queries';
import { publishComponentVersion } from '@/core/versioning/component-lifecycle';
import { apply, expectFailure, testCtx } from '../versioning/fixtures';
import {
  avancarAte,
  criarDb,
  dbPublicavel,
  dbSubmetivel,
  politica,
  VIGENCIA_PROPOSTA,
  VIGENCIA_V1,
} from './governance-fixtures';

/**
 * S36 — a publicação do DB (docs/14 §3.3, RN-GOV-05, CT-GOV-01/03/04/06).
 *
 * O que estes testes protegem, em ordem de importância: publicação parcial é
 * impossível (o teste que injeta falha no meio do lote), a base desatualizada
 * nunca passa em silêncio (`E-GOV-02`), e o que foi aprovado é exatamente o que
 * entra em vigor (`changeRequestId` na versão publicada, dos dois lados).
 */

const ANTES_DA_VIGENCIA = new Date('2026-08-15T00:00:00.000Z');
const DEPOIS_DA_VIGENCIA = new Date('2026-09-02T00:00:00.000Z');

describe('changeRequest/publish — CT-GOV-01 ponta a ponta', () => {
  it('publica a v2 da Goodlist com a vigência do DB, supersede a v1 e responde a consulta por data', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbPublicavel(cenario.document, ctx, cenario.goodlistId);

    const publicado = apply(db.document, ctx, publishChangeRequest({ changeRequestId: db.changeRequestId }));

    expect(publicado.data.effectiveFrom).toBe(VIGENCIA_PROPOSTA);
    expect(publicado.data.published).toHaveLength(1);
    expect(publicado.data.published[0]).toMatchObject({
      componentCode: 'REGRA_GOODLIST',
      kind: 'COMPONENT',
      versionId: db.draftVersionId,
      supersededVersionId: cenario.goodlistV1,
    });

    const goodlist = publicado.document.components.find((c) => c.id === cenario.goodlistId)!;
    const v2 = goodlist.versions.find((v) => v.id === db.draftVersionId)!;
    expect(v2).toMatchObject({
      number: 2,
      state: 'PUBLISHED',
      effectiveFrom: VIGENCIA_PROPOSTA,
      changeRequestId: db.changeRequestId,
    });
    const v1 = goodlist.versions.find((v) => v.id === cenario.goodlistV1)!;
    expect(v1).toMatchObject({ state: 'SUPERSEDED', effectiveTo: VIGENCIA_PROPOSTA });

    // O DB fecha em PUBLISHED, com a transição na trilha própria.
    const cr = publicado.document.changeRequests[0]!;
    expect(cr.status).toBe('PUBLISHED');
    expect(isChangeRequestPublished(cr)).toBe(true);
    expect(changeRequestPublishedAt(cr)).not.toBeNull();
    expect(cr.events.at(-1)).toMatchObject({ type: 'CR_TRANSITIONED' });
    expect(cr.events.at(-1)!.payload).toMatchObject({ to: 'PUBLISHED', effectiveFrom: VIGENCIA_PROPOSTA });

    // A consulta por data: v1 antes da vigência, v2 depois.
    expect(getComponentEffectiveVersion(goodlist, ANTES_DA_VIGENCIA)!.id).toBe(cenario.goodlistV1);
    expect(getComponentEffectiveVersion(goodlist, DEPOIS_DA_VIGENCIA)!.id).toBe(db.draftVersionId);

    // O item continua apontando a versão que entrou em vigor — é o lastro
    // entre o aprovado e o vigente (I30 depois de publicar).
    expect(cr.items[0]!.draftVersionId).toBe(db.draftVersionId);
    expect(validateDocument(publicado.document).ok).toBe(true);
  });

  it('publicar é irreversível e PUBLISHED é terminal', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbPublicavel(cenario.document, ctx, cenario.goodlistId);
    const publicado = apply(db.document, ctx, publishChangeRequest({ changeRequestId: db.changeRequestId }));

    expect(publicado.result.ok && publicado.result.inverse.type).toBe('command/irreversible');
    expectFailure(
      publicado.document,
      ctx,
      publishChangeRequest({ changeRequestId: db.changeRequestId }),
      'RELEASE_PUBLISH_BLOCKED',
    );
    expectFailure(
      publicado.document,
      ctx,
      transitionChangeRequest({ changeRequestId: db.changeRequestId, to: 'CANCELLED' }),
      'CR_TRANSITION_INVALID',
    );
  });
});

describe('changeRequest/publish — CT-GOV-06: regra e matriz publicam juntas', () => {
  function dbMisto() {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);

    let document = apply(
      db.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Aprova só até o limite em lista.' },
      }),
    ).document;
    document = apply(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db.changeRequestId,
        componentId: cenario.espelhoId,
        changeType: 'UPDATE',
        proposedSummary: 'Corte do cineminha sobe.',
      }),
    ).document;
    document = apply(
      document,
      ctx,
      linkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.espelhoId }),
    ).document;

    return {
      ctx,
      cenario,
      changeRequestId: db.changeRequestId,
      document: avancarAte(document, ctx, db.changeRequestId, 'READY_FOR_RELEASE'),
    };
  }

  it('as duas versões entram em vigor na mesma data, e a timeline da matriz aponta o DB', () => {
    const { ctx, cenario, changeRequestId, document } = dbMisto();

    const publicado = apply(document, ctx, publishChangeRequest({ changeRequestId }));

    expect(publicado.data.published).toHaveLength(2);
    expect(publicado.data.published.map((entry) => entry.kind)).toEqual(['COMPONENT', 'MATRIX']);

    const matriz = publicado.document.matrices.find((m) => m.id === cenario.matrixId)!;
    const versao = matriz.versions.find((v) => v.id === cenario.matrixDraftId)!;
    expect(versao).toMatchObject({ state: 'PUBLISHED', effectiveFrom: VIGENCIA_PROPOSTA });
    expect(versao.notes).toContain('DB_515');

    const goodlist = publicado.document.components.find((c) => c.id === cenario.goodlistId)!;
    expect(goodlist.versions.find((v) => v.state === 'PUBLISHED')!.effectiveFrom).toBe(VIGENCIA_PROPOSTA);

    // `MatrixVersion` não tem `changeRequestId` (DEC-GOV-002): quem liga a
    // versão da matriz ao DB é o carimbo no evento de publicação.
    const evento = publicado.document.events.find(
      (event) => event.type === 'VERSION_PUBLISHED' && event.scope.versionId === cenario.matrixDraftId,
    )!;
    expect(evento.payload).toMatchObject({ changeRequestId, changeRequestCode: 'DB_515' });

    expect(getEffectiveVersion(publicado.document, cenario.matrixId, DEPOIS_DA_VIGENCIA)!.id).toBe(
      cenario.matrixDraftId,
    );
    expect(getEffectiveVersion(publicado.document, cenario.matrixId, ANTES_DA_VIGENCIA)).toBeNull();
    expect(validateDocument(publicado.document).ok).toBe(true);
  });

  it('CT-GOV-03 no individual: item sem rascunho aborta tudo com E-GOV-04 e nada é publicado', () => {
    // O mesmo DB misto, mas com o item de matriz **sem** rascunho vinculado —
    // a pendência do CT-GOV-03, aqui na publicação individual.
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);
    let document = apply(
      db.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Proposta.' },
      }),
    ).document;
    document = apply(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db.changeRequestId,
        componentId: cenario.espelhoId,
        changeType: 'UPDATE',
        proposedSummary: 'Corte sobe — sem rascunho vinculado.',
      }),
    ).document;
    document = avancarAte(document, ctx, db.changeRequestId, 'READY_FOR_RELEASE');

    const erro = expectFailure(
      document,
      ctx,
      publishChangeRequest({ changeRequestId: db.changeRequestId }),
      'RELEASE_PUBLISH_BLOCKED',
    );
    expect(erro.message).toContain('ESPELHO_CORTE');

    // Nada publicado: a Goodlist, que tinha rascunho pronto, continua na v1.
    const goodlist = document.components.find((c) => c.id === cenario.goodlistId)!;
    expect(goodlist.versions.filter((v) => v.state === 'PUBLISHED')).toHaveLength(1);
    expect(goodlist.versions.find((v) => v.state === 'PUBLISHED')!.id).toBe(cenario.goodlistV1);
  });
});

describe('changeRequest/publish — atomicidade (RN-GOV-05)', () => {
  it('item quebrado no meio do lote deixa o documento intacto, sem publicação parcial', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);

    let document = apply(
      db.document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Proposta boa.' },
      }),
    ).document;
    document = apply(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db.changeRequestId,
        componentId: cenario.espelhoId,
        changeType: 'UPDATE',
        proposedSummary: 'Corte sobe.',
      }),
    ).document;
    document = apply(
      document,
      ctx,
      linkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.espelhoId }),
    ).document;
    document = avancarAte(document, ctx, db.changeRequestId, 'READY_FOR_RELEASE');

    // A falha injetada: a matriz perde uma decisão de célula depois de tudo
    // pronto, então `version/publish` recusa por I6 no **segundo** item do
    // lote — o primeiro já teria "publicado" num mundo sem atomicidade.
    const quebrado = quebrarMatriz(document, cenario.matrixDraftId);
    const antes = JSON.stringify(quebrado);

    const resultado = publishChangeRequest({ changeRequestId: db.changeRequestId }).run(quebrado, ctx);
    expect(resultado.ok).toBe(false);

    expect(JSON.stringify(quebrado)).toBe(antes);
    const goodlist = quebrado.components.find((c) => c.id === cenario.goodlistId)!;
    expect(goodlist.versions.filter((v) => v.state === 'PUBLISHED').map((v) => v.id)).toEqual([
      cenario.goodlistV1,
    ]);
    expect(quebrado.changeRequests[0]!.status).toBe('READY_FOR_RELEASE');
  });
});

/** Apaga a decisão de uma célula da versão — o rascunho volta a ter pendência (I6). */
function quebrarMatriz<T extends { matrices: Array<{ versions: Array<{ id: string; cells: Record<string, unknown> }> }> }>(
  doc: T,
  versionId: string,
): T {
  const clone = structuredClone(doc) as T;
  for (const matrix of clone.matrices) {
    const version = matrix.versions.find((candidate) => candidate.id === versionId);
    if (version === undefined) continue;
    const [first] = Object.keys(version.cells);
    if (first !== undefined) delete version.cells[first];
  }
  return clone;
}

describe('changeRequest/publish — E-GOV-02: base desatualizada exige rebase explícito', () => {
  const VIGENCIA_DO_SEGUNDO = '2026-10-01T00:00:00.000Z';

  /**
   * O cenário exato da RN-GOV-02: dois DBs abertos tocam a Goodlist, e o
   * **segundo** só é publicado depois de o primeiro já ter mudado a vigente.
   * Nada é adulterado à mão — a defasagem nasce da ordem dos fatos.
   */
  function comBaseDefasada() {
    const ctx = testCtx();
    const cenario = politica(ctx);

    // DB-516 nasce primeiro, com o item apontando a v1 como base.
    const segundo = criarDb(cenario.document, ctx, {
      code: 'DB_516',
      title: 'Segunda mudança na Goodlist',
      proposedEffectiveDate: VIGENCIA_DO_SEGUNDO,
    });
    let document = apply(
      segundo.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: segundo.changeRequestId,
        componentId: cenario.goodlistId,
        changeType: 'UPDATE',
        baseVersionId: cenario.goodlistV1,
        proposedSummary: 'Goodlist também passa a olhar o canal.',
      }),
    ).document;

    // DB-515 entra depois e publica antes: a vigente da Goodlist vira a v2.
    const primeiro = dbPublicavel(document, ctx, cenario.goodlistId);
    document = apply(
      primeiro.document,
      ctx,
      publishChangeRequest({ changeRequestId: primeiro.changeRequestId }),
    ).document;

    // Só então o DB-516 vincula o rascunho e caminha até a fila de publicação:
    // o rascunho já deriva da v2, mas `baseVersionId` do item continua a v1.
    document = apply(
      document,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: segundo.changeRequestId,
        componentId: cenario.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Aprova por canal e limite.' },
      }),
    ).document;
    document = avancarAte(document, ctx, segundo.changeRequestId, 'READY_FOR_RELEASE');

    return { ctx, cenario, document, changeRequestId: segundo.changeRequestId };
  }

  it('falha com E-GOV-02 quando a vigente mudou depois do item', () => {
    const { ctx, cenario, document, changeRequestId } = comBaseDefasada();

    const erro = expectFailure(
      document,
      ctx,
      publishChangeRequest({ changeRequestId }),
      'CR_BASE_VERSION_STALE',
    );
    expect(erro.message).toContain('DB_516');

    // Nada mudou: a vigente continua a v2 publicada pelo DB-515.
    const goodlist = document.components.find((c) => c.id === cenario.goodlistId)!;
    expect(goodlist.versions.filter((v) => v.state === 'PUBLISHED')).toHaveLength(1);
    expect(goodlist.versions.find((v) => v.state === 'PUBLISHED')!.number).toBe(2);
  });

  it('publica quando o usuário revê o comparativo e reconfirma o rebase', () => {
    const { ctx, cenario, document, changeRequestId } = comBaseDefasada();

    const publicado = apply(
      document,
      ctx,
      publishChangeRequest({ changeRequestId, rebasedComponentIds: [cenario.goodlistId] }),
    );

    expect(publicado.data.published).toHaveLength(1);
    const goodlist = publicado.document.components.find((c) => c.id === cenario.goodlistId)!;
    const vigente = goodlist.versions.find((v) => v.state === 'PUBLISHED')!;
    expect(vigente).toMatchObject({ number: 3, effectiveFrom: VIGENCIA_DO_SEGUNDO });
    expect(goodlist.versions.find((v) => v.number === 2)).toMatchObject({
      state: 'SUPERSEDED',
      effectiveTo: VIGENCIA_DO_SEGUNDO,
    });
    expect(validateDocument(publicado.document).ok).toBe(true);
  });

  it('a reconfirmação vale só para o componente informado', () => {
    const { ctx, cenario, document, changeRequestId } = comBaseDefasada();

    expectFailure(
      document,
      ctx,
      publishChangeRequest({ changeRequestId, rebasedComponentIds: [cenario.novaRegraId] }),
      'CR_BASE_VERSION_STALE',
    );
  });
});

describe('changeRequest/publish — vigência (pergunta 4 de docs/14 §12)', () => {
  it('aceita vigência retroativa num DB só de componentes (RN-GOV-09)', () => {
    const ctx = testCtx('Arthur', '2026-06-01T00:00:00.000Z');
    const cenario = politica(ctx);
    const db = dbPublicavel(cenario.document, ctx, cenario.goodlistId);
    // Vigência no passado em relação a "agora" (junho), mas depois da v1 (janeiro).
    const retroativo = apply(
      db.document,
      ctx,
      updateChangeRequest({
        changeRequestId: db.changeRequestId,
        proposedEffectiveDate: '2026-03-01T00:00:00.000Z',
      }),
    );

    const publicado = apply(
      retroativo.document,
      ctx,
      publishChangeRequest({ changeRequestId: db.changeRequestId }),
    );
    expect(publicado.data.effectiveFrom).toBe('2026-03-01T00:00:00.000Z');
  });

  it('recusa vigência retroativa quando há item de matriz no escopo (docs/05 §1.3)', () => {
    const ctx = testCtx('Arthur', '2026-06-01T00:00:00.000Z');
    const cenario = politica(ctx);
    const db = criarDb(cenario.document, ctx, { proposedEffectiveDate: '2026-03-01T00:00:00.000Z' });
    let document = apply(
      db.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db.changeRequestId,
        componentId: cenario.espelhoId,
        changeType: 'UPDATE',
        proposedSummary: 'Corte sobe.',
      }),
    ).document;
    document = apply(
      document,
      ctx,
      linkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.espelhoId }),
    ).document;
    document = avancarAte(document, ctx, db.changeRequestId, 'READY_FOR_RELEASE');

    const erro = expectFailure(
      document,
      ctx,
      publishChangeRequest({ changeRequestId: db.changeRequestId }),
      'RELEASE_PUBLISH_BLOCKED',
    );
    expect(erro.message).toContain('retroativa');
  });

  it('recusa vigência que não começa depois da vigente', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbPublicavel(cenario.document, ctx, cenario.goodlistId);
    const antesDaV1 = apply(
      db.document,
      ctx,
      updateChangeRequest({ changeRequestId: db.changeRequestId, proposedEffectiveDate: VIGENCIA_V1 }),
    );

    const erro = expectFailure(
      antesDaV1.document,
      ctx,
      publishChangeRequest({ changeRequestId: db.changeRequestId }),
      'RELEASE_PUBLISH_BLOCKED',
    );
    expect(erro.message).toContain('não começa depois');
  });
});

describe('changeRequest/publish — pendências de composição (E-GOV-04)', () => {
  it('recusa DB que ainda não chegou em READY_FOR_RELEASE', () => {
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

    const erro = expectFailure(
      vinculado.document,
      ctx,
      publishChangeRequest({ changeRequestId: db.changeRequestId }),
      'RELEASE_PUBLISH_BLOCKED',
    );
    expect(erro.message).toContain('DRAFT');
  });

  it('recusa DB sem vigência proposta', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbPublicavel(cenario.document, ctx, cenario.goodlistId);
    const semVigencia = apply(
      db.document,
      ctx,
      updateChangeRequest({ changeRequestId: db.changeRequestId, proposedEffectiveDate: null }),
    );

    expectFailure(
      semVigencia.document,
      ctx,
      publishChangeRequest({ changeRequestId: db.changeRequestId }),
      'RELEASE_PUBLISH_BLOCKED',
    );
  });

  it('recusa item cujo rascunho foi publicado por fora do DB (publicação direta)', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbPublicavel(cenario.document, ctx, cenario.goodlistId);
    // RN-GOV-07: publicar direto o rascunho vinculado continua possível — e a
    // publicação do DB denuncia a inconsistência em vez de escrever por cima.
    const direta = apply(
      db.document,
      ctx,
      publishComponentVersion({ versionId: db.draftVersionId, effectiveFrom: VIGENCIA_PROPOSTA }),
    );

    const erro = expectFailure(
      direta.document,
      ctx,
      publishChangeRequest({ changeRequestId: db.changeRequestId }),
      'RELEASE_PUBLISH_BLOCKED',
    );
    expect(erro.message).toContain('não está mais em rascunho');
  });
});

describe('changeRequest/publish — itens que não publicam versão', () => {
  it('DEACTIVATE arquiva o componente e REACTIVATE o traz de volta', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = criarDb(cenario.document, ctx);
    let document = apply(
      db.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        changeType: 'DEACTIVATE',
        proposedSummary: 'A Goodlist sai da política.',
      }),
    ).document;
    document = avancarAte(document, ctx, db.changeRequestId, 'READY_FOR_RELEASE');

    const publicado = apply(document, ctx, publishChangeRequest({ changeRequestId: db.changeRequestId }));
    expect(publicado.data.archived).toEqual([cenario.goodlistId]);
    expect(publicado.data.published).toEqual([]);
    expect(publicado.document.components.find((c) => c.id === cenario.goodlistId)!.archivedAt).toBeDefined();

    const volta = criarDb(publicado.document, ctx, { code: 'DB_516' });
    let doc2 = apply(
      volta.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: volta.changeRequestId,
        componentId: cenario.goodlistId,
        changeType: 'REACTIVATE',
        proposedSummary: 'A Goodlist volta.',
      }),
    ).document;
    doc2 = avancarAte(doc2, ctx, volta.changeRequestId, 'READY_FOR_RELEASE');
    const republicado = apply(doc2, ctx, publishChangeRequest({ changeRequestId: volta.changeRequestId }));

    expect(republicado.data.restored).toEqual([cenario.goodlistId]);
    expect(republicado.document.components.find((c) => c.id === cenario.goodlistId)!.archivedAt).toBeUndefined();
  });

  it('MOVE não muda nada no ato de publicar — a árvore já foi movida quando o analista a moveu', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = criarDb(cenario.document, ctx);
    let document = apply(
      db.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        changeType: 'MOVE',
        proposedSummary: 'A Goodlist muda de capítulo.',
      }),
    ).document;
    document = avancarAte(document, ctx, db.changeRequestId, 'READY_FOR_RELEASE');

    const plano = planChangeRequestPublish(document, db.changeRequestId);
    expect(plano).toEqual([
      expect.objectContaining({ componentCode: 'REGRA_GOODLIST', effect: 'NONE', kind: 'COMPONENT' }),
    ]);

    const publicado = apply(document, ctx, publishChangeRequest({ changeRequestId: db.changeRequestId }));
    expect(publicado.data).toMatchObject({ published: [], archived: [], restored: [] });
    expect(publicado.document.changeRequests[0]!.status).toBe('PUBLISHED');
  });
});

describe('preflight e plano — o que a tela lê antes de publicar', () => {
  it('lista as pendências sem escrever nada', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbSubmetivel(cenario.document, ctx, cenario.goodlistId);

    const preflight = preflightChangeRequestPublish(db.document, db.changeRequestId, { at: ctx.now() });
    expect(preflight.effectiveFrom).toBe(VIGENCIA_PROPOSTA);
    expect(preflight.blockers.map((blocker) => blocker.kind)).toContain('CR_NOT_READY');
    expect(preflight.blockers.map((blocker) => blocker.kind)).toContain('ITEM_WITHOUT_DRAFT');
    expect(preflight.staleBases).toEqual([]);
  });

  it('separa a base desatualizada do resto e respeita a reconfirmação', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbPublicavel(cenario.document, ctx, cenario.goodlistId);
    const adulterado = structuredClone(db.document);
    adulterado.changeRequests[0]!.items[0]!.baseVersionId = db.draftVersionId;

    const semRebase = preflightChangeRequestPublish(adulterado, db.changeRequestId, { at: ctx.now() });
    expect(semRebase.blockers).toEqual([]);
    expect(semRebase.staleBases.map((blocker) => blocker.componentId)).toEqual([cenario.goodlistId]);

    const comRebase = preflightChangeRequestPublish(adulterado, db.changeRequestId, {
      at: ctx.now(),
      rebasedComponentIds: [cenario.goodlistId],
    });
    expect(comRebase.staleBases).toEqual([]);
  });

  it('o plano cobre matriz, arquivamento e reativação', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = criarDb(cenario.document, ctx);
    let document = apply(
      db.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db.changeRequestId,
        componentId: cenario.espelhoId,
        changeType: 'UPDATE',
        proposedSummary: 'Corte sobe.',
      }),
    ).document;
    document = apply(
      document,
      ctx,
      linkChangeRequestDraft({ changeRequestId: db.changeRequestId, componentId: cenario.espelhoId }),
    ).document;
    document = apply(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db.changeRequestId,
        componentId: cenario.goodlistId,
        changeType: 'DEACTIVATE',
        proposedSummary: 'Sai da política.',
      }),
    ).document;
    document = apply(
      document,
      ctx,
      addChangeRequestItem({
        changeRequestId: db.changeRequestId,
        componentId: cenario.novaRegraId,
        changeType: 'REACTIVATE',
        proposedSummary: 'Volta à política.',
      }),
    ).document;

    expect(planChangeRequestPublish(document, db.changeRequestId)).toEqual([
      expect.objectContaining({ kind: 'MATRIX', effect: 'PUBLISH_VERSION', versionNumber: 1 }),
      expect.objectContaining({ componentCode: 'REGRA_GOODLIST', effect: 'ARCHIVE', versionNumber: null }),
      expect.objectContaining({ componentCode: 'REGRA_NOVA', effect: 'RESTORE', versionNumber: null }),
    ]);
  });

  it('o plano não quebra com item apontando componente que sumiu', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbPublicavel(cenario.document, ctx, cenario.goodlistId);
    const semComponente = structuredClone(db.document);
    semComponente.components = semComponente.components.filter((c) => c.id !== cenario.goodlistId);

    expect(planChangeRequestPublish(semComponente, db.changeRequestId)).toEqual([
      expect.objectContaining({ effect: 'PUBLISH_VERSION', kind: 'COMPONENT', versionNumber: null }),
    ]);
  });

  it('o plano diz o que acontece com cada item', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbPublicavel(cenario.document, ctx, cenario.goodlistId);

    expect(planChangeRequestPublish(db.document, db.changeRequestId)).toEqual([
      {
        componentId: cenario.goodlistId,
        componentCode: 'REGRA_GOODLIST',
        componentName: 'Goodlist',
        kind: 'COMPONENT',
        effect: 'PUBLISH_VERSION',
        versionNumber: 2,
      },
    ]);
  });

  it('desvincular o rascunho volta a bloquear a publicação', () => {
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

    const preflight = preflightChangeRequestPublish(solto.document, db.changeRequestId, { at: ctx.now() });
    expect(preflight.blockers.map((blocker) => blocker.kind)).toContain('ITEM_WITHOUT_DRAFT');
  });

  it('changeRequestPublishedAt é null enquanto o DB não publica', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbPublicavel(cenario.document, ctx, cenario.goodlistId);
    expect(changeRequestPublishedAt(db.document.changeRequests[0]!)).toBeNull();
    expect(isChangeRequestPublished(db.document.changeRequests[0]!)).toBe(false);
  });
});
