import { describe, expect, it } from 'vitest';
import { addChangeRequestItem, setChangeRequestRelease } from '@/core/document/change-requests';
import { linkChangeRequestDraft } from '@/core/document/cr-drafts';
import { preflightReleasePublish, publishRelease } from '@/core/document/release-publish';
import { cancelRelease, createRelease, deriveReleaseJointStatus, locateRelease } from '@/core/document/releases';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { validateDocument } from '@/core/document/validate';
import { getComponentEffectiveVersion } from '@/core/queries';
import { apply, expectFailure, testCtx, type TestCtx } from '../versioning/fixtures';
import { avancarAte, criarDb, dbPublicavel, politica, VIGENCIA_PROPOSTA } from './governance-fixtures';

/**
 * S37 — publicação de release (docs/14 §3.4, §4 US-GOV-05, §6 RN-GOV-05,
 * §10 CT-GOV-03; DEC-GOV-008). `release/publish` roda `changeRequest/publish`
 * (S36) por DB pronto, numa transação só sobre o documento inteiro.
 */

const VIGENCIA_DO_SEGUNDO = '2026-10-01T00:00:00.000Z';

/** DB pronto para publicar, com código e vigência escolhidos, sobre `componentId`. */
function dbPublicavelComCodigo(
  doc: PolicyOpsDocument,
  ctx: TestCtx,
  componentId: string,
  code: string,
  proposedEffectiveDate: string,
): { document: PolicyOpsDocument; changeRequestId: string; draftVersionId: string } {
  const criado = criarDb(doc, ctx, { code, proposedEffectiveDate });
  const comItem = apply(
    criado.document,
    ctx,
    addChangeRequestItem({
      changeRequestId: criado.changeRequestId,
      componentId,
      changeType: 'UPDATE',
      proposedSummary: `Proposta de ${code}.`,
    }),
  ).document;
  const vinculado = apply(
    comItem,
    ctx,
    linkChangeRequestDraft({
      changeRequestId: criado.changeRequestId,
      componentId,
      payload: { kind: 'RULE', businessDescription: `Proposta de ${code}.` },
    }),
  );
  return {
    document: avancarAte(vinculado.document, ctx, criado.changeRequestId, 'READY_FOR_RELEASE'),
    changeRequestId: criado.changeRequestId,
    draftVersionId: vinculado.data.draftVersionId,
  };
}

describe('release/publish — CT-GOV-03: publicação atômica de release', () => {
  it('DB com item sem rascunho bloqueia tudo com E-GOV-04, apontando a pendência, e nada publica', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const comRelease = apply(cenario.document, ctx, createRelease({ code: '2026.09.01' }));
    const releaseId = comRelease.data.releaseId;

    // DB-515 pronto sobre a Goodlist.
    const pronto = dbPublicavel(comRelease.document, ctx, cenario.goodlistId);

    // DB-519 aprovado, mas o item sobre a regra nova não tem rascunho vinculado.
    const criadoAtrasado = criarDb(pronto.document, ctx, { code: 'DB_519' });
    let atrasadoDoc = apply(
      criadoAtrasado.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: criadoAtrasado.changeRequestId,
        componentId: cenario.novaRegraId,
        changeType: 'CREATE',
        proposedSummary: 'Regra nova — sem rascunho vinculado.',
      }),
    ).document;
    atrasadoDoc = avancarAte(atrasadoDoc, ctx, criadoAtrasado.changeRequestId, 'APPROVED');

    let document = apply(
      atrasadoDoc,
      ctx,
      setChangeRequestRelease({ changeRequestId: pronto.changeRequestId, releaseId }),
    ).document;
    document = apply(
      document,
      ctx,
      setChangeRequestRelease({ changeRequestId: criadoAtrasado.changeRequestId, releaseId }),
    ).document;

    const preflight = preflightReleasePublish(document, releaseId);
    expect(preflight.blockers.map((b) => b.kind)).toEqual(['CR_NOT_READY', 'ITEM_WITHOUT_DRAFT']);
    expect(preflight.blockers.every((b) => b.changeRequestCode === 'DB_519')).toBe(true);

    const erro = expectFailure(document, ctx, publishRelease({ releaseId }), 'RELEASE_PUBLISH_BLOCKED');
    expect(erro.message).toContain('DB_519');

    // Nada publicado: a Goodlist, que tinha rascunho pronto, continua na v1.
    const goodlist = document.components.find((c) => c.id === cenario.goodlistId)!;
    expect(goodlist.versions.filter((v) => v.state === 'PUBLISHED')).toHaveLength(1);
    expect(goodlist.versions.find((v) => v.state === 'PUBLISHED')!.id).toBe(cenario.goodlistV1);
    expect(locateRelease(document, releaseId).release.status).toBe('PLANNED');
  });

  it('release vazia recusa publicar com E-GOV-04', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const comRelease = apply(cenario.document, ctx, createRelease({ code: '2026.09.01' }));

    expectFailure(
      comRelease.document,
      ctx,
      publishRelease({ releaseId: comRelease.data.releaseId }),
      'RELEASE_PUBLISH_BLOCKED',
    );
  });
});

describe('release/publish — atomicidade (RN-GOV-05)', () => {
  it('item quebrado no meio do lote deixa o documento intacto, sem publicação parcial', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const comRelease = apply(cenario.document, ctx, createRelease({ code: '2026.09.01' }));
    const releaseId = comRelease.data.releaseId;

    // DB-515 sobre a Goodlist (publica sem problema).
    const primeiro = dbPublicavel(comRelease.document, ctx, cenario.goodlistId);

    // DB-519 sobre o espelho da matriz — o rascunho existe e está pronto
    // (`politica()` já preencheu todas as células), mas vai perder uma
    // decisão de célula depois de tudo pronto, quebrando I6 só na hora de
    // publicar — o segundo item do lote.
    const criadoMatriz = criarDb(primeiro.document, ctx, { code: 'DB_519' });
    let matrizDoc = apply(
      criadoMatriz.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: criadoMatriz.changeRequestId,
        componentId: cenario.espelhoId,
        changeType: 'UPDATE',
        proposedSummary: 'Corte sobe.',
      }),
    ).document;
    matrizDoc = apply(
      matrizDoc,
      ctx,
      linkChangeRequestDraft({ changeRequestId: criadoMatriz.changeRequestId, componentId: cenario.espelhoId }),
    ).document;
    matrizDoc = avancarAte(matrizDoc, ctx, criadoMatriz.changeRequestId, 'READY_FOR_RELEASE');

    let document = apply(
      matrizDoc,
      ctx,
      setChangeRequestRelease({ changeRequestId: primeiro.changeRequestId, releaseId }),
    ).document;
    document = apply(
      document,
      ctx,
      setChangeRequestRelease({ changeRequestId: criadoMatriz.changeRequestId, releaseId }),
    ).document;

    const quebrado = quebrarMatriz(document, cenario.matrixDraftId);
    const antes = JSON.stringify(quebrado);

    const resultado = publishRelease({ releaseId }).run(quebrado, ctx);
    expect(resultado.ok).toBe(false);

    expect(JSON.stringify(quebrado)).toBe(antes);
    const goodlist = quebrado.components.find((c) => c.id === cenario.goodlistId)!;
    expect(goodlist.versions.filter((v) => v.state === 'PUBLISHED')).toHaveLength(1);
    expect(goodlist.versions.find((v) => v.state === 'PUBLISHED')!.number).toBe(1);
    expect(quebrado.changeRequests.find((cr) => cr.code === 'DB_515')!.status).toBe('READY_FOR_RELEASE');
    expect(quebrado.changeRequests.find((cr) => cr.code === 'DB_519')!.status).toBe('READY_FOR_RELEASE');
    expect(locateRelease(quebrado, releaseId).release.status).toBe('PLANNED');
  });
});

describe('release/publish — cada DB mantém a sua própria vigência', () => {
  it('publica 2 DBs de vigências distintas, cada versão com o effectiveFrom do seu DB', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const comRelease = apply(cenario.document, ctx, createRelease({ code: '2026.09.01', name: 'DB-515, DB-519' }));
    const releaseId = comRelease.data.releaseId;

    const db515 = dbPublicavelComCodigo(comRelease.document, ctx, cenario.goodlistId, 'DB_515', VIGENCIA_PROPOSTA);
    const db519 = dbPublicavelComCodigo(db515.document, ctx, cenario.novaRegraId, 'DB_519', VIGENCIA_DO_SEGUNDO);

    let document = apply(
      db519.document,
      ctx,
      setChangeRequestRelease({ changeRequestId: db515.changeRequestId, releaseId }),
    ).document;
    document = apply(
      document,
      ctx,
      setChangeRequestRelease({ changeRequestId: db519.changeRequestId, releaseId }),
    ).document;

    expect(deriveReleaseJointStatus(document, releaseId, { at: ctx.now() })).toBe('READY');

    const publicado = apply(document, ctx, publishRelease({ releaseId }));

    expect(publicado.data.entries).toHaveLength(2);
    expect(publicado.data.entries.find((e) => e.changeRequestCode === 'DB_515')!.effectiveFrom).toBe(
      VIGENCIA_PROPOSTA,
    );
    expect(publicado.data.entries.find((e) => e.changeRequestCode === 'DB_519')!.effectiveFrom).toBe(
      VIGENCIA_DO_SEGUNDO,
    );

    const goodlist = publicado.document.components.find((c) => c.id === cenario.goodlistId)!;
    const goodlistVigente = goodlist.versions.find((v) => v.state === 'PUBLISHED')!;
    expect(goodlistVigente.effectiveFrom).toBe(VIGENCIA_PROPOSTA);

    const novaRegra = publicado.document.components.find((c) => c.id === cenario.novaRegraId)!;
    const novaRegraVigente = novaRegra.versions.find((v) => v.state === 'PUBLISHED')!;
    expect(novaRegraVigente.effectiveFrom).toBe(VIGENCIA_DO_SEGUNDO);

    // Cada DB fecha sozinho em PUBLISHED, e a release também.
    expect(publicado.document.changeRequests.every((cr) => cr.status === 'PUBLISHED')).toBe(true);
    const release = locateRelease(publicado.document, releaseId).release;
    expect(release.status).toBe('PUBLISHED');
    expect(release.publishedAt).toBeDefined();
    expect(release.publishedBy).toBe('Arthur');
    expect(deriveReleaseJointStatus(publicado.document, releaseId)).toBe('PUBLISHED');

    // A consulta por data responde por vigência de cada componente.
    expect(getComponentEffectiveVersion(goodlist, new Date('2026-08-15T00:00:00.000Z'))!.id).toBe(
      cenario.goodlistV1,
    );
    expect(getComponentEffectiveVersion(goodlist, new Date('2026-09-02T00:00:00.000Z'))!.id).toBe(
      goodlistVigente.id,
    );
    expect(validateDocument(publicado.document).ok).toBe(true);

    // Publicar de novo é bloqueado — a release já fechou.
    expectFailure(publicado.document, ctx, publishRelease({ releaseId }), 'CR_TRANSITION_INVALID');
  });
});

describe('deriveReleaseJointStatus — derivação do status conjunto', () => {
  it('EMPTY sem nenhum DB vinculado', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const comRelease = apply(cenario.document, ctx, createRelease({ code: '2026.09.01' }));
    expect(deriveReleaseJointStatus(comRelease.document, comRelease.data.releaseId)).toBe('EMPTY');
  });

  it('IN_PROGRESS com ao menos um DB ainda não pronto', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const comRelease = apply(cenario.document, ctx, createRelease({ code: '2026.09.01' }));
    const criado = criarDb(comRelease.document, ctx, { code: 'DB_515' });
    let document = apply(
      criado.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: criado.changeRequestId,
        componentId: cenario.goodlistId,
        changeType: 'UPDATE',
        proposedSummary: 'Sem rascunho ainda.',
      }),
    ).document;
    document = avancarAte(document, ctx, criado.changeRequestId, 'APPROVED');
    document = apply(
      document,
      ctx,
      setChangeRequestRelease({ changeRequestId: criado.changeRequestId, releaseId: comRelease.data.releaseId }),
    ).document;

    expect(deriveReleaseJointStatus(document, comRelease.data.releaseId)).toBe('IN_PROGRESS');
  });

  it('READY quando todos os DBs vinculados estão prontos para publicar', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const comRelease = apply(cenario.document, ctx, createRelease({ code: '2026.09.01' }));
    const pronto = dbPublicavel(comRelease.document, ctx, cenario.goodlistId);
    const document = apply(
      pronto.document,
      ctx,
      setChangeRequestRelease({ changeRequestId: pronto.changeRequestId, releaseId: comRelease.data.releaseId }),
    ).document;

    expect(deriveReleaseJointStatus(document, comRelease.data.releaseId)).toBe('READY');
  });

  it('CANCELLED vence a composição — release cancelada não volta a READY/IN_PROGRESS', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const comRelease = apply(cenario.document, ctx, createRelease({ code: '2026.09.01' }));
    const pronto = dbPublicavel(comRelease.document, ctx, cenario.goodlistId);
    let document = apply(
      pronto.document,
      ctx,
      setChangeRequestRelease({ changeRequestId: pronto.changeRequestId, releaseId: comRelease.data.releaseId }),
    ).document;
    expect(deriveReleaseJointStatus(document, comRelease.data.releaseId)).toBe('READY');

    document = apply(document, ctx, cancelRelease({ releaseId: comRelease.data.releaseId })).document;

    expect(deriveReleaseJointStatus(document, comRelease.data.releaseId)).toBe('CANCELLED');
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
