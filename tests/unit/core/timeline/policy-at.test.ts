import { describe, expect, it } from 'vitest';
import { archiveComponent, createComponent } from '@/core/document/components';
import { archiveMatrix } from '@/core/document/commands';
import { publishChangeRequest } from '@/core/document/cr-publish';
import { setChangeRequestRelease } from '@/core/document/change-requests';
import { createRelease } from '@/core/document/releases';
import type { PolicyOpsDocument } from '@/core/document/schema';
import {
  getPolicyAt,
  getPolicyPeriodCounters,
  getReleaseSnapshotWindow,
  orphanMatrixKey,
  snapshotNodeIndex,
  type PolicySnapshot,
} from '@/core/timeline/policy-at';
import {
  createComponentDraft,
  publishComponentVersion,
} from '@/core/versioning/component-lifecycle';
import {
  dbPublicavel,
  politica,
  politicaComTresMudancas,
  MUDANCAS,
  VIGENCIA_PROPOSTA,
  VIGENCIA_V1,
} from '../document/governance-fixtures';
import { apply, IDS, testCtx } from '../versioning/fixtures';

/**
 * Fotografia da política numa data — docs/14 §4 (US-GOV-07), docs/05 §6.2.
 *
 * O cenário é sempre montado por comandos (`governance-fixtures.ts`): uma
 * fotografia conferida contra um documento escrito à mão provaria só que o
 * literal casa com o `expect`.
 */

const at = (iso: string) => new Date(iso);

function node(snapshot: PolicySnapshot, key: string) {
  const found = snapshotNodeIndex(snapshot).get(key);
  expect(found, `Esperava o nó "${key}" na fotografia de ${snapshot.at}.`).toBeDefined();
  return found!;
}

describe('getPolicyAt — a política numa data', () => {
  it('CT-GOV-01: goodlist v1 em 2026-08-15, v2 em 2026-09-02', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    const db = dbPublicavel(base.document, ctx, base.goodlistId);
    const document = apply(
      db.document,
      ctx,
      publishChangeRequest({ changeRequestId: db.changeRequestId }),
    ).document;

    const antes = node(getPolicyAt(document, IDS.projectA, at('2026-08-15T12:00:00.000Z')), base.goodlistId);
    expect(antes.status).toBe('EFFECTIVE');
    expect(antes.version?.number).toBe(1);
    expect(antes.version?.id).toBe(base.goodlistV1);

    const depois = node(getPolicyAt(document, IDS.projectA, at('2026-09-02T12:00:00.000Z')), base.goodlistId);
    expect(depois.status).toBe('EFFECTIVE');
    expect(depois.version?.number).toBe(2);
    expect(depois.version?.id).toBe(db.draftVersionId);
  });

  it('a data exata de `effectiveFrom` já é da versão nova (intervalo semiaberto)', () => {
    const ctx = testCtx();
    const cenario = politicaComTresMudancas(ctx);

    const vespera = node(
      getPolicyAt(cenario.document, IDS.projectA, at('2026-02-28T23:59:59.999Z')),
      cenario.goodlistId,
    );
    expect(vespera.version?.id).toBe(cenario.goodlistV1);

    const naData = node(
      getPolicyAt(cenario.document, IDS.projectA, at(MUDANCAS.goodlist)),
      cenario.goodlistId,
    );
    expect(naData.version?.id).toBe(cenario.goodlistV2);
  });

  it('versão publicada com vigência no futuro não vige — e a anterior segue valendo', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    const agendada = apply(
      base.document,
      ctx,
      createComponentDraft({
        componentId: base.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Vale só a partir de setembro.' },
      }),
    );
    const document = apply(
      agendada.document,
      ctx,
      publishComponentVersion({ versionId: agendada.data.versionId, effectiveFrom: VIGENCIA_PROPOSTA }),
    ).document;

    const hoje = node(getPolicyAt(document, IDS.projectA, at('2026-08-15T00:00:00.000Z')), base.goodlistId);
    expect(hoje.version?.id).toBe(base.goodlistV1);
    expect(hoje.status).toBe('EFFECTIVE');
  });

  it('componente cuja única versão é futura aparece como ausente, não como sumido', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    const futura = apply(
      base.document,
      ctx,
      createComponentDraft({
        componentId: base.novaRegraId,
        payload: { kind: 'RULE', businessDescription: 'Entra em vigor em setembro.' },
      }),
    );
    const document = apply(
      futura.document,
      ctx,
      publishComponentVersion({ versionId: futura.data.versionId, effectiveFrom: VIGENCIA_PROPOSTA }),
    ).document;

    const snapshot = getPolicyAt(document, IDS.projectA, at('2026-08-15T00:00:00.000Z'));
    const nova = node(snapshot, base.novaRegraId);
    expect(nova.status).toBe('ABSENT');
    expect(nova.version).toBeNull();
    expect(snapshot.counts.absent).toBeGreaterThan(0);

    const depois = node(getPolicyAt(document, IDS.projectA, at('2026-09-30T00:00:00.000Z')), base.novaRegraId);
    expect(depois.status).toBe('EFFECTIVE');
  });

  it('componente arquivado no meio do intervalo permanece nas fotografias anteriores', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    ctx.setNow('2026-05-01T00:00:00.000Z');
    const document = apply(base.document, ctx, archiveComponent({ componentId: base.goodlistId })).document;

    const antes = getPolicyAt(document, IDS.projectA, at('2026-04-30T23:59:59.999Z'));
    expect(node(antes, base.goodlistId).status).toBe('EFFECTIVE');

    const depois = getPolicyAt(document, IDS.projectA, at('2026-05-01T00:00:00.000Z'));
    expect(snapshotNodeIndex(depois).has(base.goodlistId)).toBe(false);
  });

  it('seção pura é estrutura, nunca "sem política vigente" (I29)', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    const document = apply(
      base.document,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'CAP_LISTAS', name: 'Listas', type: 'SECTION' }),
    );

    const snapshot = getPolicyAt(document.document, IDS.projectA, at(VIGENCIA_V1));
    const secao = snapshot.nodes.find((candidate) => candidate.component?.code === 'CAP_LISTAS');
    expect(secao?.status).toBe('STRUCTURE');
    expect(secao?.version).toBeNull();
    expect(snapshot.counts.structure).toBe(1);
  });

  it('matriz espelhada entra pelo nó da árvore, com a versão vigente da matriz', () => {
    const ctx = testCtx();
    const cenario = politicaComTresMudancas(ctx);

    const julho = node(getPolicyAt(cenario.document, IDS.projectA, at('2026-07-15T00:00:00.000Z')), cenario.espelhoId);
    expect(julho.kind).toBe('MATRIX');
    expect(julho.version).toBeNull();
    expect(julho.matrixVersion?.id).toBe(cenario.matrixV1);

    const agosto = node(getPolicyAt(cenario.document, IDS.projectA, at(MUDANCAS.matriz)), cenario.espelhoId);
    expect(agosto.matrixVersion?.id).toBe(cenario.matrixV2);
  });

  it('matriz sem componente espelho não some da fotografia (DEC-GOV-039)', () => {
    const ctx = testCtx();
    const cenario = politicaComTresMudancas(ctx);
    // O espelho arquivado deixa de espelhar: a matriz volta pela porta da órfã.
    ctx.setNow('2026-08-10T00:00:00.000Z');
    const document = apply(cenario.document, ctx, archiveComponent({ componentId: cenario.espelhoId })).document;

    const snapshot = getPolicyAt(document, IDS.projectA, at('2026-08-20T00:00:00.000Z'));
    expect(snapshotNodeIndex(snapshot).has(cenario.espelhoId)).toBe(false);

    const orfa = node(snapshot, orphanMatrixKey(cenario.matrixId));
    expect(orfa.kind).toBe('MATRIX');
    expect(orfa.component).toBeNull();
    expect(orfa.depth).toBe(1);
    expect(orfa.matrixVersion?.id).toBe(cenario.matrixV2);
    expect(snapshot.counts.orphanMatrices).toBe(1);
  });

  it('matriz sem espelho e sem versão vigente entra como ausente, não some', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    // A matriz do cenário base só tem rascunho — nunca vigorou.
    const document = apply(base.document, ctx, archiveComponent({ componentId: base.espelhoId })).document;

    const orfa = node(getPolicyAt(document, IDS.projectA, at(VIGENCIA_PROPOSTA)), orphanMatrixKey(base.matrixId));
    expect(orfa.status).toBe('ABSENT');
    expect(orfa.matrixVersion).toBeNull();
  });

  it('matriz arquivada sai das fotografias a partir do arquivamento, com o espelho junto', () => {
    const ctx = testCtx();
    const cenario = politicaComTresMudancas(ctx);
    ctx.setNow('2026-08-10T00:00:00.000Z');
    const document = apply(cenario.document, ctx, archiveMatrix({ matrixId: cenario.matrixId })).document;

    expect(
      snapshotNodeIndex(getPolicyAt(document, IDS.projectA, at('2026-08-05T00:00:00.000Z'))).has(cenario.espelhoId),
    ).toBe(true);

    const depois = getPolicyAt(document, IDS.projectA, at('2026-08-20T00:00:00.000Z'));
    expect(snapshotNodeIndex(depois).has(cenario.espelhoId)).toBe(false);
    expect(snapshotNodeIndex(depois).has(orphanMatrixKey(cenario.matrixId))).toBe(false);
  });

  it('a fotografia sai na ordem de leitura da árvore, com a matriz órfã no fim', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    const filha = apply(
      base.document,
      ctx,
      createComponent({
        projectId: IDS.projectA,
        parentId: base.goodlistId,
        code: 'REGRA_FILHA',
        name: 'Detalhe da goodlist',
        type: 'RULE',
      }),
    );
    const snapshot = getPolicyAt(filha.document, IDS.projectA, at(VIGENCIA_V1));
    const codes = snapshot.nodes.map((candidate) => candidate.component?.code ?? candidate.key);
    expect(codes).toEqual(['REGRA_GOODLIST', 'REGRA_FILHA', 'REGRA_NOVA', 'ESPELHO_CORTE']);
    expect(node(snapshot, filha.data.componentId).depth).toBe(2);
    expect(node(snapshot, filha.data.componentId).ancestors.map((a) => a.id)).toEqual([base.goodlistId]);
  });

  it('a seção que agrupa é o ancestral SECTION mais próximo', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    const capitulo = apply(
      base.document,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'CAP_RISCO', name: 'Risco', type: 'SECTION' }),
    );
    const regra = apply(
      capitulo.document,
      ctx,
      createComponent({
        projectId: IDS.projectA,
        parentId: capitulo.data.componentId,
        code: 'REGRA_DENTRO',
        name: 'Regra dentro do capítulo',
        type: 'RULE',
      }),
    );
    const neta = apply(
      regra.document,
      ctx,
      createComponent({
        projectId: IDS.projectA,
        parentId: regra.data.componentId,
        code: 'REGRA_NETA',
        name: 'Detalhe',
        type: 'RULE',
      }),
    );

    const snapshot = getPolicyAt(neta.document, IDS.projectA, at(VIGENCIA_V1));
    expect(node(snapshot, base.goodlistId).section).toBeNull();
    expect(node(snapshot, regra.data.componentId).section?.code).toBe('CAP_RISCO');
    expect(node(snapshot, neta.data.componentId).section?.code).toBe('CAP_RISCO');
  });

  it('só olha o projeto pedido', () => {
    const ctx = testCtx();
    const cenario = politicaComTresMudancas(ctx);
    const snapshot = getPolicyAt(cenario.document, IDS.projectB, at(MUDANCAS.matriz));
    expect(snapshot.nodes).toEqual([]);
    expect(snapshot.counts.effective).toBe(0);
  });

  it('os contadores separam componente, matriz, ausência e estrutura', () => {
    const ctx = testCtx();
    const cenario = politicaComTresMudancas(ctx);

    const fevereiro = getPolicyAt(cenario.document, IDS.projectA, at('2026-02-01T00:00:00.000Z')).counts;
    // Goodlist v1 + matriz v1 vigentes; a "Regra nova" ainda não existe.
    expect(fevereiro).toMatchObject({
      effectiveComponents: 1,
      effectiveMatrices: 1,
      effective: 2,
      absent: 1,
      structure: 0,
      orphanMatrices: 0,
    });

    const setembro = getPolicyAt(cenario.document, IDS.projectA, at('2026-09-01T00:00:00.000Z')).counts;
    expect(setembro).toMatchObject({ effectiveComponents: 2, effectiveMatrices: 1, absent: 0 });
  });
});

describe('getPolicyPeriodCounters — os contadores do período (US-GOV-07)', () => {
  function comDbPublicado(): { document: PolicyOpsDocument; changeRequestId: string } {
    const ctx = testCtx();
    const base = politica(ctx);
    const db = dbPublicavel(base.document, ctx, base.goodlistId);
    return {
      document: apply(db.document, ctx, publishChangeRequest({ changeRequestId: db.changeRequestId })).document,
      changeRequestId: db.changeRequestId,
    };
  }

  it('conta vigentes no fim do período e DBs publicados pela vigência', () => {
    const { document } = comDbPublicado();

    const dentro = getPolicyPeriodCounters(
      document,
      IDS.projectA,
      at('2026-08-01T00:00:00.000Z'),
      at('2026-09-30T00:00:00.000Z'),
    );
    expect(dentro.publishedChangeRequests).toBe(1);
    expect(dentro.inFlightChangeRequests).toBe(0);
    expect(dentro.effectiveComponents).toBe(1);
    expect(dentro.effectiveMatrices).toBe(0);

    const fora = getPolicyPeriodCounters(
      document,
      IDS.projectA,
      at('2026-01-01T00:00:00.000Z'),
      at('2026-08-31T00:00:00.000Z'),
    );
    expect(fora.publishedChangeRequests).toBe(0);
  });

  it('DB ainda vivo conta como "em andamento", DB fechado não conta de nenhum lado', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    const emAndamento = dbPublicavel(base.document, ctx, base.goodlistId);

    const counters = getPolicyPeriodCounters(
      emAndamento.document,
      IDS.projectA,
      at('2026-01-01T00:00:00.000Z'),
      at('2026-12-31T00:00:00.000Z'),
    );
    expect(counters.inFlightChangeRequests).toBe(1);
    expect(counters.publishedChangeRequests).toBe(0);
  });

  it('DB de outro projeto não entra nos contadores', () => {
    const { document } = comDbPublicado();
    const counters = getPolicyPeriodCounters(
      document,
      IDS.projectB,
      at('2026-01-01T00:00:00.000Z'),
      at('2026-12-31T00:00:00.000Z'),
    );
    expect(counters.publishedChangeRequests).toBe(0);
    expect(counters.inFlightChangeRequests).toBe(0);
  });
});

describe('getReleaseSnapshotWindow — as duas datas de uma release', () => {
  it('a janela vai de 1 ms antes da primeira vigência até a última', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    const db = dbPublicavel(base.document, ctx, base.goodlistId);
    const release = apply(db.document, ctx, createRelease({ code: '2026.09.01' }));
    const vinculado = apply(
      release.document,
      ctx,
      setChangeRequestRelease({ changeRequestId: db.changeRequestId, releaseId: release.data.releaseId }),
    );
    const document = apply(
      vinculado.document,
      ctx,
      publishChangeRequest({ changeRequestId: db.changeRequestId }),
    ).document;

    const window = getReleaseSnapshotWindow(document, release.data.releaseId);
    expect(window).not.toBeNull();
    expect(window!.before.toISOString()).toBe('2026-08-31T23:59:59.999Z');
    expect(window!.after.toISOString()).toBe(VIGENCIA_PROPOSTA);
    expect(window!.changeRequests.map((cr) => cr.id)).toEqual([db.changeRequestId]);

    const antes = node(getPolicyAt(document, IDS.projectA, window!.before), base.goodlistId);
    const depois = node(getPolicyAt(document, IDS.projectA, window!.after), base.goodlistId);
    expect(antes.version?.number).toBe(1);
    expect(depois.version?.number).toBe(2);
  });

  it('release sem DB publicado — ou inexistente — não tem o que comparar', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    const release = apply(base.document, ctx, createRelease({ code: '2026.10.01' }));
    expect(getReleaseSnapshotWindow(release.document, release.data.releaseId)).toBeNull();
    expect(getReleaseSnapshotWindow(release.document, 'nao-existe--')).toBeNull();
  });
});
