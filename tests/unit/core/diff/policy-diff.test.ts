import { describe, expect, it } from 'vitest';
import { setChangeRequestRelease } from '@/core/document/change-requests';
import { archiveComponent, createComponent } from '@/core/document/components';
import { publishChangeRequest } from '@/core/document/cr-publish';
import { createRelease } from '@/core/document/releases';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { ROOT_SECTION_LABEL, diffPolicyAt, orderPolicyDates, type PolicyDiff } from '@/core/diff';
import { getPolicyAt, getReleaseSnapshotWindow, orphanMatrixKey } from '@/core/timeline/policy-at';
import { diffPolicySnapshots } from '@/core/diff/policy-diff';
import { createComponentDraft, publishComponentVersion } from '@/core/versioning/component-lifecycle';
import { createDraft, publishVersion } from '@/core/versioning/lifecycle';
import { applyCellPatch } from '@/core/versioning/cells';
import { allCombinations } from '@/core/axes/combinations';
import { paragraphFromText } from '@/core/richdoc/model';
import { createMatrix, locateVersion } from '@/core/versioning/lifecycle';
import {
  MUDANCAS,
  dbPublicavel,
  politica,
  politicaComTresMudancas,
  VIGENCIA_V1,
} from '../document/governance-fixtures';
import { IDS, apply, baseDocument, testCtx } from '../versioning/fixtures';

/**
 * Comparação da política inteira entre duas datas — docs/14 §4 (US-GOV-08).
 *
 * As datas do cenário são as de `MUDANCAS` (fixture do épico): três alterações
 * conhecidas e nada fora delas, que é o que deixa "lista **exatamente** o que
 * mudou" verificável em vez de aproximado.
 */

const at = (iso: string) => new Date(iso);
const FEVEREIRO = at('2026-02-01T00:00:00.000Z');
const ABRIL = at('2026-04-01T00:00:00.000Z');
const JULHO = at('2026-07-01T00:00:00.000Z');
const SETEMBRO = at('2026-09-01T00:00:00.000Z');

function keys(diff: PolicyDiff): string[] {
  return diff.changes.map((change) => change.component?.code ?? change.key);
}

describe('diffPolicyAt — comparações par a par da fixture do épico', () => {
  const ctx = testCtx();
  const cenario = politicaComTresMudancas(ctx);
  const doc = cenario.document;

  it('fevereiro × abril: só a Goodlist mudou', () => {
    const diff = diffPolicyAt(doc, IDS.projectA, FEVEREIRO, ABRIL);
    expect(keys(diff)).toEqual(['REGRA_GOODLIST']);
    expect(diff.totals).toEqual({ added: 0, removed: 0, changed: 1, total: 1 });

    const change = diff.changes[0]!;
    expect(change.kind).toBe('CHANGED');
    expect(change.before?.id).toBe(cenario.goodlistV1);
    expect(change.after?.id).toBe(cenario.goodlistV2);
    expect(change.payload?.hasChanges).toBe(true);
    expect(
      change.payload?.changes.find((field) => field.field === 'businessDescription')?.kind,
    ).toBe('CHANGED');
    // `outcome` só existe do lado novo — o payload nomeia o campo que nasceu.
    expect(change.payload?.changes.find((field) => field.field === 'outcome')?.kind).toBe('ADDED');
  });

  it('abril × julho: só a regra que passou a existir', () => {
    const diff = diffPolicyAt(doc, IDS.projectA, ABRIL, JULHO);
    expect(keys(diff)).toEqual(['REGRA_NOVA']);
    expect(diff.totals).toEqual({ added: 1, removed: 0, changed: 0, total: 1 });
    expect(diff.changes[0]!.before).toBeNull();
    expect(diff.changes[0]!.after?.id).toBe(cenario.regraNovaV1);
    // Item `CREATE`: tudo o que o payload tem aparece como nascido.
    expect(diff.changes[0]!.payload?.changes.every((field) => field.kind === 'ADDED')).toBe(true);
  });

  it('julho × setembro: só a matriz, com o resumo semântico do diff existente', () => {
    const diff = diffPolicyAt(doc, IDS.projectA, JULHO, SETEMBRO);
    expect(keys(diff)).toEqual(['ESPELHO_CORTE']);
    expect(diff.totals).toEqual({ added: 0, removed: 0, changed: 1, total: 1 });

    const change = diff.changes[0]!;
    expect(change.nodeKind).toBe('MATRIX');
    expect(change.beforeMatrixVersion?.id).toBe(cenario.matrixV1);
    expect(change.afterMatrixVersion?.id).toBe(cenario.matrixV2);
    expect(change.matrixDiff?.comparable).toBe(true);
    // As 6 combinações passaram de APROVADO para REPROVADO.
    expect(change.matrixDiff?.summary.cellsClosed).toBe(6);
    expect(change.matrixDiff?.cellsChanged).toBe(6);
    expect(change.matrixDiff?.summaryText.length).toBeGreaterThan(0);
    expect(change.payload).toBeNull();
  });

  it('março × agosto: as três mudanças do intervalo, e nada mais', () => {
    const diff = diffPolicyAt(doc, IDS.projectA, at('2026-02-15T00:00:00.000Z'), SETEMBRO);
    expect(keys(diff).sort()).toEqual(['ESPELHO_CORTE', 'REGRA_GOODLIST', 'REGRA_NOVA']);
    expect(diff.totals).toEqual({ added: 1, removed: 0, changed: 2, total: 3 });
    expect(diff.hasChanges).toBe(true);
  });

  it('intervalo sem nenhuma publicação não inventa mudança', () => {
    const diff = diffPolicyAt(doc, IDS.projectA, at('2026-03-10T00:00:00.000Z'), at('2026-05-31T00:00:00.000Z'));
    expect(diff.changes).toEqual([]);
    expect(diff.hasChanges).toBe(false);
    expect(diff.totals.total).toBe(0);
  });

  it('comparar uma data com ela mesma devolve diff vazio', () => {
    const diff = diffPolicyAt(doc, IDS.projectA, SETEMBRO, SETEMBRO);
    expect(diff.hasChanges).toBe(false);
  });

  it('a data exata da vigência já conta como depois (intervalo semiaberto)', () => {
    const antes = diffPolicyAt(doc, IDS.projectA, FEVEREIRO, at('2026-02-28T23:59:59.999Z'));
    expect(antes.hasChanges).toBe(false);
    const naData = diffPolicyAt(doc, IDS.projectA, FEVEREIRO, at(MUDANCAS.goodlist));
    expect(keys(naData)).toEqual(['REGRA_GOODLIST']);
  });

  it('`orderPolicyDates` põe a mais antiga na base, venha na ordem que vier', () => {
    const ordenado = orderPolicyDates(SETEMBRO, FEVEREIRO);
    expect(ordenado.a).toBe(FEVEREIRO);
    expect(ordenado.b).toBe(SETEMBRO);
    expect(orderPolicyDates(FEVEREIRO, SETEMBRO)).toEqual({ a: FEVEREIRO, b: SETEMBRO });
    const diff = diffPolicyAt(doc, IDS.projectA, ordenado.a, ordenado.b);
    expect(diff.a < diff.b).toBe(true);
  });

  it('invertendo as pontas, "adicionado" vira "removido"', () => {
    const diff = diffPolicyAt(doc, IDS.projectA, JULHO, ABRIL);
    expect(keys(diff)).toEqual(['REGRA_NOVA']);
    expect(diff.changes[0]!.kind).toBe('REMOVED');
    expect(diff.changes[0]!.before?.id).toBe(cenario.regraNovaV1);
    expect(diff.changes[0]!.after).toBeNull();
  });
});

describe('diffPolicyAt — bordas de presença', () => {
  it('componente arquivado no intervalo aparece como removido', () => {
    const ctx = testCtx();
    const cenario = politicaComTresMudancas(ctx);
    ctx.setNow('2026-05-01T00:00:00.000Z');
    const document = apply(cenario.document, ctx, archiveComponent({ componentId: cenario.goodlistId })).document;

    const diff = diffPolicyAt(document, IDS.projectA, ABRIL, JULHO);
    const goodlist = diff.changes.find((change) => change.component?.code === 'REGRA_GOODLIST');
    expect(goodlist?.kind).toBe('REMOVED');
    expect(goodlist?.before?.id).toBe(cenario.goodlistV2);
    expect(goodlist?.after).toBeNull();
  });

  it('seção pura não entra na comparação — renomear pasta não é alteração de política', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    const comSecao = apply(
      base.document,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'CAP_NOVO', name: 'Capítulo novo', type: 'SECTION' }),
    );
    const diff = diffPolicyAt(comSecao.document, IDS.projectA, FEVEREIRO, SETEMBRO);
    expect(diff.changes.some((change) => change.component?.code === 'CAP_NOVO')).toBe(false);
  });

  it('documentar uma seção depois (I29) entra como adicionada', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    const secao = apply(
      base.document,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'CAP_VISAO', name: 'Visão geral', type: 'SECTION' }),
    );
    const rascunho = apply(
      secao.document,
      ctx,
      createComponentDraft({
        componentId: secao.data.componentId,
        payload: { kind: 'OTHER', businessDescription: 'O capítulo passa a ter visão geral.' },
      }),
    );
    const document = apply(
      rascunho.document,
      ctx,
      publishComponentVersion({ versionId: rascunho.data.versionId, effectiveFrom: MUDANCAS.regraNova }),
    ).document;

    const diff = diffPolicyAt(document, IDS.projectA, ABRIL, JULHO);
    expect(keys(diff)).toEqual(['CAP_VISAO']);
    expect(diff.changes[0]!.kind).toBe('ADDED');
  });

  it('matriz sem espelho entra na comparação pela chave própria', () => {
    const ctx = testCtx();
    const cenario = politicaComTresMudancas(ctx);
    ctx.setNow('2026-07-15T00:00:00.000Z');
    const document = apply(cenario.document, ctx, archiveComponent({ componentId: cenario.espelhoId })).document;

    const diff = diffPolicyAt(document, IDS.projectA, JULHO, SETEMBRO);
    const orfa = diff.changes.find((change) => change.key === orphanMatrixKey(cenario.matrixId));
    expect(orfa?.kind).toBe('ADDED');
    expect(orfa?.nodeKind).toBe('MATRIX');
    expect(orfa?.matrix?.code).toBe('MTZ_CORTE');
    // O espelho arquivado sai como removido — o nó da árvore deixou de existir.
    expect(diff.changes.find((change) => change.key === cenario.espelhoId)?.kind).toBe('REMOVED');
  });

  it('`spec` só é comparada quando algum dos lados tem uma', () => {
    const ctx = testCtx();
    const cenario = politicaComTresMudancas(ctx);
    const diff = diffPolicyAt(cenario.document, IDS.projectA, FEVEREIRO, ABRIL);
    expect(diff.changes[0]!.spec).toBeNull();
  });

  it('a especificação rica entra bloco a bloco (S34)', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    const comSpec = apply(
      base.document,
      ctx,
      createComponentDraft({
        componentId: base.goodlistId,
        payload: { kind: 'RULE', businessDescription: 'Aprova quem está na lista.' },
        spec: {
          blocks: [
            paragraphFromText('blk-mantido', 'Este parágrafo não muda.'),
            paragraphFromText('blk-alterado', 'Hoje a goodlist aprova sempre.'),
          ],
        },
      }),
    );
    const document = apply(
      comSpec.document,
      ctx,
      publishComponentVersion({ versionId: comSpec.data.versionId, effectiveFrom: MUDANCAS.goodlist }),
    ).document;

    const diff = diffPolicyAt(document, IDS.projectA, FEVEREIRO, ABRIL);
    const spec = diff.changes[0]!.spec;
    expect(spec).not.toBeNull();
    expect(spec!.hasChanges).toBe(true);
    expect(spec!.totals.ADDED).toBe(2);
  });

  it('matriz sem versão vigente em nenhuma das duas datas não entra', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    // A matriz do cenário base tem só um rascunho: nunca vigorou.
    const diff = diffPolicyAt(base.document, IDS.projectA, FEVEREIRO, SETEMBRO);
    expect(diff.changes.some((change) => change.nodeKind === 'MATRIX')).toBe(false);

    const snapshot = getPolicyAt(base.document, IDS.projectA, SETEMBRO);
    expect(snapshot.nodes.find((n) => n.key === base.espelhoId)?.status).toBe('ABSENT');
  });
});

describe('diffPolicySnapshots — agregação por seção da árvore', () => {
  it('agrupa pelo ancestral SECTION mais próximo, com a raiz por último', () => {
    const ctx = testCtx();
    const base = politica(ctx);
    const capitulo = apply(
      base.document,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'CAP_LISTAS', name: 'Listas', type: 'SECTION' }),
    );
    const regra = apply(
      capitulo.document,
      ctx,
      createComponent({
        projectId: IDS.projectA,
        parentId: capitulo.data.componentId,
        code: 'REGRA_DENTRO',
        name: 'Regra do capítulo',
        type: 'RULE',
      }),
    );
    const rascunho = apply(
      regra.document,
      ctx,
      createComponentDraft({
        componentId: regra.data.componentId,
        payload: { kind: 'RULE', businessDescription: 'Nasce em junho.' },
      }),
    );
    const document = apply(
      rascunho.document,
      ctx,
      publishComponentVersion({ versionId: rascunho.data.versionId, effectiveFrom: MUDANCAS.regraNova }),
    ).document;

    // Uma mudança na raiz, no mesmo intervalo, para provar a ordem dos grupos.
    const naRaiz = apply(
      document,
      ctx,
      createComponentDraft({
        componentId: base.novaRegraId,
        payload: { kind: 'RULE', businessDescription: 'Também nasce em junho.' },
      }),
    );
    const final = apply(
      naRaiz.document,
      ctx,
      publishComponentVersion({ versionId: naRaiz.data.versionId, effectiveFrom: MUDANCAS.regraNova }),
    ).document;

    const diff = diffPolicySnapshots(
      final,
      getPolicyAt(final, IDS.projectA, ABRIL),
      getPolicyAt(final, IDS.projectA, JULHO),
    );
    expect(diff.groups.map((group) => group.label)).toEqual(['Listas', ROOT_SECTION_LABEL]);
    expect(diff.groups[0]!.changes.map((change) => change.component?.code)).toEqual(['REGRA_DENTRO']);
    expect(diff.groups[0]!.totals).toEqual({ added: 1, removed: 0, changed: 0, total: 1 });
    expect(diff.groups[1]!.section).toBeNull();
  });
});

describe('diffPolicyAt — release × release', () => {
  it('a janela da release mostra exatamente o que ela publicou', () => {
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

    const window = getReleaseSnapshotWindow(document, release.data.releaseId)!;
    const diff = diffPolicyAt(document, IDS.projectA, window.before, window.after);
    expect(keys(diff)).toEqual(['REGRA_GOODLIST']);
    expect(diff.changes[0]!.kind).toBe('CHANGED');
    expect(diff.changes[0]!.after?.changeRequestId).toBe(db.changeRequestId);
  });
});

describe('desempenho — 300 componentes e 102 matrizes', () => {
  /**
   * O teto de componentes por projeto é 1000 e o alerta começa em 300
   * (docs/14 §3.1); 102 matrizes é a ordem de grandeza de um projeto real de
   * cineminha. A fotografia e a comparação são a resposta de auditoria: se
   * demorarem, a pergunta deixa de ser feita.
   */
  function projetoGrande(): PolicyOpsDocument {
    const ctx = testCtx();
    let document = baseDocument();

    for (let i = 0; i < 102; i++) {
      const criada = apply(
        document,
        ctx,
        createMatrix({
          projectId: IDS.projectA,
          code: `MTZ_${String(i).padStart(3, '0')}`,
          name: `Matriz ${i}`,
          x: { levels: [{ variableId: IDS.score }] },
          y: { levels: [{ variableId: IDS.restritivo }] },
        }),
      );
      document = criada.document;
      const coords = allCombinations(locateVersion(criada.document, criada.data.versionId).version).map(
        ({ xPath, yPath }) => ({ xPath, yPath }),
      );
      document = apply(
        document,
        ctx,
        applyCellPatch({ versionId: criada.data.versionId, patch: { coords, set: { decision: 'APROVADO' } } }),
      ).document;
      document = apply(
        document,
        ctx,
        publishVersion({ versionId: criada.data.versionId, notes: 'Primeira publicação.', effectiveFrom: VIGENCIA_V1 }),
      ).document;

      // Metade das matrizes muda no meio do período — o diff caro só existe aí.
      if (i % 2 === 0) {
        const v2 = apply(document, ctx, createDraft({ matrixId: criada.data.matrixId }));
        document = apply(
          v2.document,
          ctx,
          applyCellPatch({ versionId: v2.data.versionId, patch: { coords, set: { decision: 'REPROVADO' } } }),
        ).document;
        document = apply(
          document,
          ctx,
          publishVersion({ versionId: v2.data.versionId, notes: 'Fecha o corte.', effectiveFrom: MUDANCAS.matriz }),
        ).document;
      }

      const espelho = apply(
        document,
        ctx,
        createComponent({
          projectId: IDS.projectA,
          code: `ESPELHO_${String(i).padStart(3, '0')}`,
          name: `Espelho ${i}`,
          type: 'MATRIX',
          matrixId: criada.data.matrixId,
        }),
      );
      document = espelho.document;
    }

    let secaoId: string | undefined;
    for (let i = 0; i < 300; i++) {
      const criado = apply(
        document,
        ctx,
        createComponent({
          projectId: IDS.projectA,
          ...(i % 20 === 0 || secaoId === undefined ? {} : { parentId: secaoId }),
          code: `REGRA_${String(i).padStart(3, '0')}`,
          name: `Regra ${i}`,
          type: i % 20 === 0 ? 'SECTION' : 'RULE',
        }),
      );
      document = criado.document;
      if (i % 20 === 0) {
        secaoId = criado.data.componentId;
        continue;
      }
      const rascunho = apply(
        document,
        ctx,
        createComponentDraft({
          componentId: criado.data.componentId,
          payload: { kind: 'RULE', businessDescription: `Estado inicial da regra ${i}.` },
        }),
      );
      document = apply(
        rascunho.document,
        ctx,
        publishComponentVersion({ versionId: rascunho.data.versionId, effectiveFrom: VIGENCIA_V1 }),
      ).document;

      if (i % 3 === 0) {
        const v2 = apply(
          document,
          ctx,
          createComponentDraft({
            componentId: criado.data.componentId,
            payload: { kind: 'RULE', businessDescription: `Regra ${i} revista.`, outcome: 'Aprovar' },
          }),
        );
        document = apply(
          v2.document,
          ctx,
          publishComponentVersion({ versionId: v2.data.versionId, effectiveFrom: MUDANCAS.goodlist }),
        ).document;
      }
    }

    return document;
  }

  it('fotografia + comparação de ponta a ponta em menos de 500 ms', () => {
    const document = projetoGrande();
    expect(document.components.filter((c) => c.projectId === IDS.projectA).length).toBe(402);
    expect(document.matrices.length).toBe(102);

    const started = performance.now();
    const antes = getPolicyAt(document, IDS.projectA, FEVEREIRO);
    const depois = getPolicyAt(document, IDS.projectA, SETEMBRO);
    const diff = diffPolicySnapshots(document, antes, depois);
    const elapsed = performance.now() - started;

    expect(antes.nodes.length).toBe(402);
    expect(diff.totals.total).toBeGreaterThan(100);
    expect(elapsed).toBeLessThan(500);
  });
});
