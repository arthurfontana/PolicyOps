import { describe, expect, it } from 'vitest';
import type { Cell, MatrixVersion, PolicyOpsDocument } from '@/core/document/schema';
import { previewResnapshot } from '@/core/reconcile/resnapshot';
import { getStaleAxes } from '@/core/reconcile/stale';
import { applyCellPatch } from '@/core/versioning/cells';
import { resnapshotAxisCommand } from '@/core/versioning/axis-commands';
import {
  createMatrix,
  locateVersion,
  publishVersion,
  pendingCoords,
} from '@/core/versioning/lifecycle';
import {
  apply,
  coordsOf,
  documentWithAllStates,
  expectFailure,
  fillAllCells,
  IDS,
  testCtx,
  withoutEvents,
  type TestCtx,
} from '../versioning/fixtures';
import {
  domainsOf,
  nestedScenario,
  publishCompatibilityWith,
  publishVariableWith,
  SEG_X_FAT_ALLOW,
  simpleScenario,
} from './fixtures';

/**
 * Reconciliação — docs/05-regras-de-negocio.md §5.3 e §5.4.
 */

// ---------------------------------------------------------------------------
// Utilitários dos testes
// ---------------------------------------------------------------------------

/** Todas as versões de matriz do documento, menos uma — o que precisa ficar intacto. */
function versionsExcept(doc: PolicyOpsDocument, versionId: string): MatrixVersion[] {
  return doc.matrices.flatMap((matrix) =>
    matrix.versions.filter((version) => version.id !== versionId),
  );
}

function axisOf(version: MatrixVersion, role: 'X' | 'Y') {
  return role === 'X' ? version.axes.x : version.axes.y;
}

function versionOf(doc: PolicyOpsDocument, versionId: string): MatrixVersion {
  return locateVersion(doc, versionId).version;
}

/** Uma célula com **todos** os campos preenchidos — o que a auditoria precisa devolver íntegro. */
const RICO: Cell = {
  decision: 'APROVADO',
  offer: 'OFERTA_A',
  limit: 'LIM_1000',
  limitOverride: '2500.00',
  color: '#123456',
  note: 'Exceção acordada com risco.',
  attrs: { revisar: true, prioridade: 3, dono: 'Crédito PJ' },
};

function setRichCell(
  doc: PolicyOpsDocument,
  ctx: TestCtx,
  versionId: string,
  coord: { xPath: string; yPath: string },
): PolicyOpsDocument {
  return apply(doc, ctx, applyCellPatch({ versionId, patch: { coords: [coord], set: RICO } }))
    .document;
}

// ---------------------------------------------------------------------------
// O princípio — o teste que existe antes da funcionalidade
// ---------------------------------------------------------------------------

/**
 * ## Por que estes dois testes existem
 *
 * Todo o produto se apoia numa promessa: **uma versão publicada nunca muda
 * retroativamente** (docs/01-visao-e-escopo.md §5). É ela que dá lastro à
 * pergunta "o que valia em março?", e é ela que permite a ferramenta escalar de
 * 10 para 500 matrizes sem virar um arquivo de Excel com data no nome.
 *
 * A reconciliação é a única funcionalidade do sistema que lê a biblioteca
 * **depois** que uma matriz já congelou o snapshot dela. Se algum caminho deste
 * código escrevesse na versão errada — por um índice trocado, por um
 * `structuredClone` esquecido, por uma mutação do Immer que escapou —, o
 * estrago seria silencioso: nenhum erro, nenhum aviso, e o histórico de todas
 * as matrizes deixaria de ser confiável sem que ninguém percebesse.
 *
 * Por isso a comparação aqui é de **objetos inteiros**, e não de contagens: uma
 * contagem igual esconderia um rótulo trocado ou um pin reescrito. E por isso
 * os dois gatilhos são cobertos separadamente — versão nova de variável e
 * versão nova de regra de compatibilidade —, porque são dois caminhos
 * diferentes dentro do cálculo.
 */
describe('o princípio: uma versão publicada jamais é tocada', () => {
  it('publicar v2 de SCORE com R4 e reconciliar o rascunho não altera nada da versão publicada', () => {
    const ctx = testCtx();
    const { document, draft, published } = simpleScenario(ctx);
    const antes = structuredClone(versionOf(document, published));

    const comR4 = publishVariableWith(document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));
    const depois = apply(comR4, ctx, resnapshotAxisCommand({ versionId: draft, role: 'X' }));

    // O objeto inteiro, campo a campo — não contagens.
    const publicada = versionOf(depois.document, published);
    expect(publicada).toEqual(antes);
    expect(publicada.axes.x.levels[0]!.domains).toEqual(antes.axes.x.levels[0]!.domains);
    expect(publicada.axes.x.levels[0]!.variableVersionId).toBe(IDS.scoreV1);
    expect(publicada.axes.x.tuples).toEqual(['R1', 'R2', 'R3']);
    expect(publicada.cells).toEqual(antes.cells);

    // E **nenhuma** outra versão de matriz do documento mudou.
    expect(versionsExcept(depois.document, draft)).toEqual(versionsExcept(document, draft));

    // O rascunho, esse sim, adotou a novidade.
    const rascunho = versionOf(depois.document, draft);
    expect(rascunho.axes.x.tuples).toEqual(['R1', 'R2', 'R3', 'R4']);
    expect(rascunho.axes.x.levels[0]!.variableVersionId).not.toBe(IDS.scoreV1);
  });

  it('publicar v2 de SEG_X_FATURAMENTO e reconciliar o rascunho não altera nada da versão publicada', () => {
    const ctx = testCtx();
    const { document, draft, published } = nestedScenario(ctx);
    const antes = structuredClone(versionOf(document, published));

    const comRegraNova = publishCompatibilityWith(document, ctx, IDS.compatRule, {
      ...SEG_X_FAT_ALLOW,
      VAREJO: ['ATE_100K', '100K_500K', '500K_1M', '1M_10M'],
    });
    const depois = apply(comRegraNova, ctx, resnapshotAxisCommand({ versionId: draft, role: 'Y' }));

    const publicada = versionOf(depois.document, published);
    expect(publicada).toEqual(antes);
    expect(publicada.axes.y.tuples).toEqual(antes.axes.y.tuples);
    expect(publicada.axes.y.tuples).toHaveLength(8);
    expect(publicada.axes.y.derivedFrom.compatibilityVersionIds).toEqual([IDS.compatV1]);
    expect(publicada.cells).toEqual(antes.cells);
    expect(versionsExcept(depois.document, draft)).toEqual(versionsExcept(document, draft));

    const rascunho = versionOf(depois.document, draft);
    expect(rascunho.axes.y.tuples).toHaveLength(9);
    expect(rascunho.axes.y.derivedFrom.compatibilityVersionIds).not.toEqual([IDS.compatV1]);
  });

  it('recusa com VERSION_IMMUTABLE em PUBLISHED, SUPERSEDED e ARCHIVED — antes de qualquer cálculo', () => {
    const ctx = testCtx();
    const states = documentWithAllStates(ctx);
    // A biblioteca evoluiu: há de fato o que adotar, e mesmo assim as três
    // versões imutáveis recusam — `assertEditable` roda **primeiro**.
    const evoluido = publishVariableWith(
      states.document,
      ctx,
      IDS.score,
      domainsOf('R1', 'R2', 'R3', 'R4'),
    );

    for (const versionId of [states.published, states.superseded, states.archived]) {
      expectFailure(
        evoluido,
        ctx,
        resnapshotAxisCommand({ versionId, role: 'X' }),
        'VERSION_IMMUTABLE',
      );
    }
    // O rascunho da mesma matriz aceita.
    expect(
      resnapshotAxisCommand({ versionId: states.draft, role: 'X' }).run(evoluido, ctx).ok,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5.3 — o preview
// ---------------------------------------------------------------------------

describe('previewResnapshot (§5.3)', () => {
  it('não grava nada: o documento antes e depois é deep-equal', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const comR4 = publishVariableWith(document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));
    const copia = structuredClone(comR4);

    const plano = previewResnapshot(comR4, draft, 'X');

    expect(comR4).toEqual(copia);
    // E a versão calculada é outra: nem o objeto original foi reaproveitado.
    expect(plano.version).not.toBe(versionOf(comR4, draft));
    expect(versionOf(comR4, draft).axes.x.tuples).toEqual(['R1', 'R2', 'R3']);
    expect(plano.version.axes.x.tuples).toEqual(['R1', 'R2', 'R3', 'R4']);
  });

  it('recusa com AXIS_NOT_STALE quando não há nada a adotar', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    expect(() => previewResnapshot(document, draft, 'X')).toThrowError(
      expect.objectContaining({ code: 'AXIS_NOT_STALE' }),
    );
    expectFailure(document, ctx, resnapshotAxisCommand({ versionId: draft, role: 'X' }), 'AXIS_NOT_STALE');
  });

  it('devolve o plano completo: níveis, compatibilidade, tuplas, contagens e células descartadas', () => {
    const ctx = testCtx();
    const { document, draft } = nestedScenario(ctx);
    const comRegraNova = publishCompatibilityWith(document, ctx, IDS.compatRule, {
      ...SEG_X_FAT_ALLOW,
      VAREJO: ['ATE_100K', '100K_500K'],
    });

    const { plan } = previewResnapshot(comRegraNova, draft, 'Y');
    expect(plan.role).toBe('Y');
    expect(plan.levels.map((level) => level.variableCode)).toEqual(['SEGMENTO', 'FAT']);
    expect(plan.compatibility).toEqual([
      {
        ruleId: IDS.compatRule,
        ruleCode: 'SEG_X_FATURAMENTO',
        ruleName: 'Segmento × Faturamento',
        from: 1,
        to: 2,
      },
    ]);
    expect(plan.addedTuples).toEqual([]);
    expect(plan.removedTuples).toEqual(['VAREJO|500K_1M']);
    expect(plan.newCombinations).toBe(0);
    // 3 tuplas em X × 1 tupla que sai em Y.
    expect(plan.droppedCombinations).toBe(3);
    expect(plan.droppedCells).toHaveLength(3);
    expect(plan.droppedCells.map((dropped) => dropped.key).sort()).toEqual([
      'R1::VAREJO|500K_1M',
      'R2::VAREJO|500K_1M',
      'R3::VAREJO|500K_1M',
    ]);
  });
});

// ---------------------------------------------------------------------------
// §5.4 — casos de borda, um a um
// ---------------------------------------------------------------------------

describe('§5.4 — domínios', () => {
  it('domínio adicionado gera exatamente |tuplas do outro eixo| combinações novas, todas pendentes', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const outroEixo = versionOf(document, draft).axes.y.tuples;
    expect(outroEixo).toHaveLength(2);
    expect(pendingCoords(versionOf(document, draft))).toHaveLength(0);

    const comR4 = publishVariableWith(document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));
    const aplicado = apply(comR4, ctx, resnapshotAxisCommand({ versionId: draft, role: 'X' }));

    expect(aplicado.data.preview.addedTuples).toEqual(['R4']);
    expect(aplicado.data.preview.newCombinations).toBe(outroEixo.length);
    expect(aplicado.data.newTuples).toEqual(['R4']);
    expect(aplicado.data.pendingCells).toBe(outroEixo.length);

    const rascunho = versionOf(aplicado.document, draft);
    // As combinações novas ficam **ausentes** de `cells` (§5.4 item 6).
    expect(rascunho.cells['R4::SEM']).toBeUndefined();
    expect(rascunho.cells['R4::ALTO']).toBeUndefined();
    expect(pendingCoords(rascunho)).toEqual([
      { xPath: 'R4', yPath: 'SEM' },
      { xPath: 'R4', yPath: 'ALTO' },
    ]);
    // E as antigas seguem intactas.
    expect(Object.keys(rascunho.cells)).toHaveLength(6);
  });

  it('domínio removido descarta exatamente as combinações certas, com o conteúdo íntegro no evento', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const comConteudo = setRichCell(document, ctx, draft, { xPath: 'R3', yPath: 'ALTO' });

    const semR3 = publishVariableWith(comConteudo, ctx, IDS.score, domainsOf('R1', 'R2'));
    const aplicado = apply(semR3, ctx, resnapshotAxisCommand({ versionId: draft, role: 'X' }));

    expect(aplicado.data.preview.removedTuples).toEqual(['R3']);
    expect(aplicado.data.preview.addedTuples).toEqual([]);
    expect(aplicado.data.preview.droppedCombinations).toBe(2);

    const rascunho = versionOf(aplicado.document, draft);
    expect(rascunho.axes.x.tuples).toEqual(['R1', 'R2']);
    expect(Object.keys(rascunho.cells).sort()).toEqual([
      'R1::ALTO',
      'R1::SEM',
      'R2::ALTO',
      'R2::SEM',
    ]);

    // O payload do evento traz **todos** os campos de cada célula descartada:
    // o conteúdo precisa ser recuperável a partir da auditoria.
    const evento = aplicado.result.events.find((event) => event.type === 'AXIS_RESNAPSHOTTED')!;
    const droppedCells = evento.payload!.droppedCells as Array<{ key: string; cell: Cell }>;
    expect(droppedCells.map((dropped) => dropped.key).sort()).toEqual(['R3::ALTO', 'R3::SEM']);
    expect(droppedCells.find((dropped) => dropped.key === 'R3::ALTO')!.cell).toEqual(RICO);
    expect(droppedCells.find((dropped) => dropped.key === 'R3::SEM')!.cell).toEqual({
      decision: 'APROVADO',
    });
  });

  it('domínio renomeado (mesmo code) preserva a célula na íntegra e atualiza o rótulo', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const comConteudo = setRichCell(document, ctx, draft, { xPath: 'R2', yPath: 'SEM' });
    const celulasAntes = structuredClone(versionOf(comConteudo, draft).cells);

    const renomeado = publishVariableWith(comConteudo, ctx, IDS.score, [
      { code: 'R1', label: 'Rótulo R1', position: 0 },
      { code: 'R2', label: 'R2 — Risco baixo (revisado)', position: 1 },
      { code: 'R3', label: 'Rótulo R3', position: 2 },
    ]);
    const aplicado = apply(renomeado, ctx, resnapshotAxisCommand({ versionId: draft, role: 'X' }));

    const plano = aplicado.data.preview;
    expect(plano.levels[0]!.relabeled).toEqual([
      { code: 'R2', from: 'Rótulo R2', to: 'R2 — Risco baixo (revisado)' },
    ]);
    expect(plano.addedTuples).toEqual([]);
    expect(plano.removedTuples).toEqual([]);
    expect(plano.droppedCells).toEqual([]);

    const rascunho = versionOf(aplicado.document, draft);
    // Renomear não é mudança de conteúdo: as células ficam idênticas…
    expect(rascunho.cells).toEqual(celulasAntes);
    // …e o rótulo exibido passa a ser o novo.
    expect(rascunho.axes.x.levels[0]!.domains[1]!.label).toBe('R2 — Risco baixo (revisado)');
    expect(pendingCoords(rascunho)).toHaveLength(0);
  });

  it('reordenar domínios preserva o conteúdo e muda a ordem das tuplas', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const comConteudo = setRichCell(document, ctx, draft, { xPath: 'R3', yPath: 'ALTO' });
    const celulasAntes = structuredClone(versionOf(comConteudo, draft).cells);

    const invertido = publishVariableWith(comConteudo, ctx, IDS.score, [
      { code: 'R3', label: 'Rótulo R3', position: 0 },
      { code: 'R2', label: 'Rótulo R2', position: 1 },
      { code: 'R1', label: 'Rótulo R1', position: 2 },
    ]);
    const aplicado = apply(invertido, ctx, resnapshotAxisCommand({ versionId: draft, role: 'X' }));

    const plano = aplicado.data.preview;
    expect(plano.levels[0]!.reordered).toBe(true);
    expect(plano.addedTuples).toEqual([]);
    expect(plano.removedTuples).toEqual([]);
    expect(plano.droppedCells).toEqual([]);

    const rascunho = versionOf(aplicado.document, draft);
    expect(rascunho.axes.x.tuples).toEqual(['R3', 'R2', 'R1']);
    expect(rascunho.cells).toEqual(celulasAntes);
    expect(pendingCoords(rascunho)).toHaveLength(0);
  });

  it('code removido e recriado é substituição: a célula nasce vazia, não herda', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const comConteudo = setRichCell(document, ctx, draft, { xPath: 'R2', yPath: 'SEM' });

    // v2 sem R2; v3 com um R2 novo, que por acaso tem o mesmo código.
    const semR2 = publishVariableWith(comConteudo, ctx, IDS.score, domainsOf('R1', 'R3'));
    const comR2Novo = publishVariableWith(semR2, ctx, IDS.score, [
      { code: 'R1', label: 'Rótulo R1', position: 0 },
      { code: 'R2', label: 'R2 — outra coisa', position: 1 },
      { code: 'R3', label: 'Rótulo R3', position: 2 },
    ]);

    const aplicado = apply(comR2Novo, ctx, resnapshotAxisCommand({ versionId: draft, role: 'X' }));
    const plano = aplicado.data.preview;
    expect(plano.levels[0]!.replacedDomains).toEqual(['R2']);
    // A combinação some e volta: entra como nova e sai como descartada.
    expect(plano.addedTuples).toEqual(['R2']);
    expect(plano.removedTuples).toEqual(['R2']);

    const rascunho = versionOf(aplicado.document, draft);
    expect(rascunho.axes.x.tuples).toEqual(['R1', 'R2', 'R3']);
    // Nada herdado: as duas células de R2 nascem vazias e viram pendência.
    expect(rascunho.cells['R2::SEM']).toBeUndefined();
    expect(rascunho.cells['R2::ALTO']).toBeUndefined();
    expect(pendingCoords(rascunho)).toEqual([
      { xPath: 'R2', yPath: 'SEM' },
      { xPath: 'R2', yPath: 'ALTO' },
    ]);
    // E o conteúdo rico não se perdeu em silêncio: está na auditoria.
    const evento = aplicado.result.events.find((event) => event.type === 'AXIS_RESNAPSHOTTED')!;
    const droppedCells = evento.payload!.droppedCells as Array<{ key: string; cell: Cell }>;
    expect(droppedCells.find((dropped) => dropped.key === 'R2::SEM')!.cell).toEqual(RICO);
  });

  it('domínio simplesmente renomeado numa cadeia longa não é confundido com substituição', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    // Duas publicações seguidas, R2 presente em todas: permanência, não troca.
    const v2 = publishVariableWith(document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));
    const v3 = publishVariableWith(v2, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4', 'R5'));

    const aplicado = apply(v3, ctx, resnapshotAxisCommand({ versionId: draft, role: 'X' }));
    expect(aplicado.data.preview.levels[0]!.replacedDomains).toEqual([]);
    expect(aplicado.data.preview.addedTuples).toEqual(['R4', 'R5']);
    expect(aplicado.data.preview.removedTuples).toEqual([]);
    expect(Object.keys(versionOf(aplicado.document, draft).cells)).toHaveLength(6);
  });

  it('variável arquivada desde o snapshot é sinalizada no plano, sem travar a adoção', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const comR4 = publishVariableWith(document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));
    const arquivada: PolicyOpsDocument = structuredClone(comR4);
    arquivada.variables.find((variable) => variable.id === IDS.score)!.archivedAt =
      '2026-02-01T00:00:00.000Z';

    const { plan } = previewResnapshot(arquivada, draft, 'X');
    expect(plan.levels[0]!.variableArchived).toBe(true);
    expect(plan.addedTuples).toEqual(['R4']);
    expect(
      resnapshotAxisCommand({ versionId: draft, role: 'X' }).run(arquivada, ctx).ok,
    ).toBe(true);
  });

  it('recusa quando a variável do nível não tem mais nenhuma versão publicada', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const semPublicada: PolicyOpsDocument = structuredClone(document);
    semPublicada.variables.find((variable) => variable.id === IDS.score)!.versions[0]!.state =
      'SUPERSEDED';

    expectFailure(
      semPublicada,
      ctx,
      resnapshotAxisCommand({ versionId: draft, role: 'X' }),
      'VARIABLE_HAS_NO_PUBLISHED_VERSION',
    );
  });
});

describe('§5.4 — compatibilidade', () => {
  it('regra que passa a incluir combinações gera addedTuples pendentes', () => {
    const ctx = testCtx();
    const { document, draft } = nestedScenario(ctx);
    const comRegraNova = publishCompatibilityWith(document, ctx, IDS.compatRule, {
      ...SEG_X_FAT_ALLOW,
      VAREJO: ['ATE_100K', '100K_500K', '500K_1M', '1M_10M'],
    });

    const aplicado = apply(comRegraNova, ctx, resnapshotAxisCommand({ versionId: draft, role: 'Y' }));
    const plano = aplicado.data.preview;
    expect(plano.addedTuples).toEqual(['VAREJO|1M_10M']);
    expect(plano.removedTuples).toEqual([]);
    // 3 tuplas em X × 1 tupla nova em Y.
    expect(plano.newCombinations).toBe(3);
    expect(plano.droppedCells).toEqual([]);

    const rascunho = versionOf(aplicado.document, draft);
    expect(rascunho.axes.y.tuples).toEqual([
      'VAREJO|ATE_100K',
      'VAREJO|100K_500K',
      'VAREJO|500K_1M',
      'VAREJO|1M_10M',
      'ATACADO|500K_1M',
      'ATACADO|1M_10M',
      'ATACADO|ACIMA_10M',
      'CORPORATE|1M_10M',
      'CORPORATE|ACIMA_10M',
    ]);
    expect(pendingCoords(rascunho)).toHaveLength(3);
  });

  it('regra que passa a excluir combinações gera removedTuples e descarta as células', () => {
    const ctx = testCtx();
    const { document, draft } = nestedScenario(ctx);
    const maisRestrita = publishCompatibilityWith(document, ctx, IDS.compatRule, {
      ...SEG_X_FAT_ALLOW,
      CORPORATE: ['ACIMA_10M'],
    });

    const aplicado = apply(maisRestrita, ctx, resnapshotAxisCommand({ versionId: draft, role: 'Y' }));
    const plano = aplicado.data.preview;
    expect(plano.removedTuples).toEqual(['CORPORATE|1M_10M']);
    expect(plano.droppedCells).toHaveLength(3);
    expect(versionOf(aplicado.document, draft).axes.y.tuples).toHaveLength(7);
    // Nada pendente: só saiu combinação, nenhuma entrou.
    expect(aplicado.data.pendingCells).toBe(0);
  });

  it('regra que passa a existir onde não havia reduz as tuplas e atualiza derivedFrom', () => {
    const ctx = testCtx();
    const { document, draft } = nestedScenario(ctx);

    // Um eixo Y que foi gerado **sem** regra nenhuma: o produto cartesiano
    // inteiro, 15 tuplas. É o estado de quem montou a matriz antes de a
    // biblioteca ganhar a regra.
    const semRegra: PolicyOpsDocument = structuredClone(document);
    semRegra.compatibility = [];
    const semRegraDraft = versionOf(semRegra, draft);
    semRegraDraft.axes.y.tuples = SEGMENTO_X_FAT_COMPLETO;
    semRegraDraft.axes.y.derivedFrom.compatibilityVersionIds = [];
    semRegraDraft.cells = {};
    // Devolve a regra à biblioteca — agora ela "passou a existir".
    semRegra.compatibility = structuredClone(document.compatibility);

    const staleAntes = previewResnapshot(semRegra, draft, 'Y');
    expect(staleAntes.plan.compatibility).toEqual([
      {
        ruleId: IDS.compatRule,
        ruleCode: 'SEG_X_FATURAMENTO',
        ruleName: 'Segmento × Faturamento',
        from: null,
        to: 1,
      },
    ]);
    expect(staleAntes.plan.removedTuples).toHaveLength(7);
    expect(staleAntes.plan.addedTuples).toEqual([]);
    expect(staleAntes.version.axes.y.tuples).toHaveLength(8);
    expect(staleAntes.version.axes.y.derivedFrom.compatibilityVersionIds).toEqual([IDS.compatV1]);
  });

  it('preserva as supressões manuais ainda aplicáveis e descarta as que deixaram de existir', () => {
    const ctx = testCtx();
    const { document, draft } = nestedScenario(ctx);
    const comSupressao: PolicyOpsDocument = structuredClone(document);
    const alvo = versionOf(comSupressao, draft);
    alvo.axes.y.manualSuppressions = ['CORPORATE|1M_10M'];
    alvo.axes.y.tuples = alvo.axes.y.tuples.filter((tuple) => tuple !== 'CORPORATE|1M_10M');

    // A regra nova mantém CORPORATE|1M_10M válida e acrescenta VAREJO|1M_10M.
    const aplicavel = publishCompatibilityWith(comSupressao, ctx, IDS.compatRule, {
      ...SEG_X_FAT_ALLOW,
      VAREJO: ['ATE_100K', '100K_500K', '500K_1M', '1M_10M'],
    });
    const mantida = apply(aplicavel, ctx, resnapshotAxisCommand({ versionId: draft, role: 'Y' }));
    expect(versionOf(mantida.document, draft).axes.y.manualSuppressions).toEqual([
      'CORPORATE|1M_10M',
    ]);
    expect(mantida.data.preview.droppedSuppressions).toEqual([]);
    expect(versionOf(mantida.document, draft).axes.y.tuples).not.toContain('CORPORATE|1M_10M');

    // Já a regra que exclui CORPORATE|1M_10M torna a supressão sem objeto.
    const semObjeto = publishCompatibilityWith(comSupressao, ctx, IDS.compatRule, {
      ...SEG_X_FAT_ALLOW,
      CORPORATE: ['ACIMA_10M'],
    });
    const descartada = apply(semObjeto, ctx, resnapshotAxisCommand({ versionId: draft, role: 'Y' }));
    expect(descartada.data.preview.droppedSuppressions).toEqual(['CORPORATE|1M_10M']);
    expect(versionOf(descartada.document, draft).axes.y.manualSuppressions).toBeUndefined();
    expect(
      descartada.data.preview.warnings.some((warning) => warning.code === 'SUPPRESSION_NOT_APPLICABLE'),
    ).toBe(true);
  });
});

/** As 15 tuplas do produto cartesiano `SEGMENTO × FAT`, sem regra nenhuma. */
const SEGMENTO_X_FAT_COMPLETO = [
  'VAREJO|ATE_100K',
  'VAREJO|100K_500K',
  'VAREJO|500K_1M',
  'VAREJO|1M_10M',
  'VAREJO|ACIMA_10M',
  'ATACADO|ATE_100K',
  'ATACADO|100K_500K',
  'ATACADO|500K_1M',
  'ATACADO|1M_10M',
  'ATACADO|ACIMA_10M',
  'CORPORATE|ATE_100K',
  'CORPORATE|100K_500K',
  'CORPORATE|500K_1M',
  'CORPORATE|1M_10M',
  'CORPORATE|ACIMA_10M',
];

// ---------------------------------------------------------------------------
// Sequência, publicação e desfazer
// ---------------------------------------------------------------------------

describe('depois de reconciliar', () => {
  it('I6 bloqueia a publicação até as combinações novas serem preenchidas', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const comR4 = publishVariableWith(document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));
    const aplicado = apply(comR4, ctx, resnapshotAxisCommand({ versionId: draft, role: 'X' }));

    const erro = expectFailure(
      aplicado.document,
      ctx,
      publishVersion({ versionId: draft, notes: 'Adoção da versão 2 do Score.' }),
      'UNSET_CELLS_REMAIN',
    );
    expect((erro.details as { count: number }).count).toBe(2);

    // Preenchidas as novas, publica.
    const preenchido = fillAllCells(aplicado.document, ctx, draft);
    ctx.advance(60_000);
    const publicado = apply(
      preenchido,
      ctx,
      publishVersion({ versionId: draft, notes: 'Adoção da versão 2 do Score.' }),
    );
    expect(versionOf(publicado.document, draft).state).toBe('PUBLISHED');
  });

  it('reconciliar X e depois Y, em sequência e sem recarregar, produz o conjunto correto', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    let doc = publishVariableWith(document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));
    doc = publishVariableWith(doc, ctx, IDS.restritivo, domainsOf('SEM', 'ALTO', 'MEDIO'));

    const emX = apply(doc, ctx, resnapshotAxisCommand({ versionId: draft, role: 'X' }));
    expect(emX.data.preview.addedTuples).toEqual(['R4']);
    // O eixo Y ainda não foi adotado: continua defasado depois do X.
    const emY = apply(emX.document, ctx, resnapshotAxisCommand({ versionId: draft, role: 'Y' }));
    expect(emY.data.preview.addedTuples).toEqual(['MEDIO']);

    const rascunho = versionOf(emY.document, draft);
    expect(rascunho.axes.x.tuples).toEqual(['R1', 'R2', 'R3', 'R4']);
    expect(rascunho.axes.y.tuples).toEqual(['SEM', 'ALTO', 'MEDIO']);
    // 4 × 3 = 12 combinações; as 6 originais preservadas, 6 pendentes.
    expect(Object.keys(rascunho.cells)).toHaveLength(6);
    expect(pendingCoords(rascunho)).toHaveLength(6);
    // Nada a adotar sobrou.
    expectFailure(
      emY.document,
      ctx,
      resnapshotAxisCommand({ versionId: draft, role: 'X' }),
      'AXIS_NOT_STALE',
    );
  });

  it('o inverso restaura o documento deep-equal ao original', () => {
    const ctx = testCtx();
    const { document, draft } = nestedScenario(ctx);
    const comConteudo = setRichCell(document, ctx, draft, {
      xPath: 'R2',
      yPath: 'CORPORATE|1M_10M',
    });
    const maisRestrita = publishCompatibilityWith(comConteudo, ctx, IDS.compatRule, {
      ...SEG_X_FAT_ALLOW,
      CORPORATE: ['ACIMA_10M'],
    });

    const aplicado = apply(maisRestrita, ctx, resnapshotAxisCommand({ versionId: draft, role: 'Y' }));
    expect(aplicado.data.preview.droppedCells).toHaveLength(3);

    const desfeito = apply(aplicado.document, ctx, aplicado.result.inverse);
    // A auditoria é append-only: os eventos crescem, o resto volta idêntico.
    expect(withoutEvents(desfeito.document)).toEqual(withoutEvents(maisRestrita));
    expect(versionOf(desfeito.document, draft).cells['R2::CORPORATE|1M_10M']).toEqual(RICO);

    // E refazer aplica de novo, sem recalcular nada.
    const refeito = apply(desfeito.document, ctx, desfeito.result.inverse);
    expect(withoutEvents(refeito.document)).toEqual(withoutEvents(aplicado.document));
  });

  it('desfazer devolve também as tuplas, o pin e o snapshot de domínios', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const antes = structuredClone(versionOf(document, draft));
    const comR4 = publishVariableWith(document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));

    const aplicado = apply(comR4, ctx, resnapshotAxisCommand({ versionId: draft, role: 'X' }));
    const desfeito = apply(aplicado.document, ctx, aplicado.result.inverse);
    const rascunho = versionOf(desfeito.document, draft);

    expect(rascunho.axes.x).toEqual(antes.axes.x);
    expect(rascunho.axes.x.levels[0]!.variableVersionId).toBe(IDS.scoreV1);
    expect(rascunho.cells).toEqual(antes.cells);
  });

  it('grava o evento AXIS_RESNAPSHOTTED com o plano aplicado e resumo em pt-BR', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const comR4 = publishVariableWith(document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));
    const aplicado = apply(comR4, ctx, resnapshotAxisCommand({ versionId: draft, role: 'X' }));

    const evento = aplicado.result.events.find((event) => event.type === 'AXIS_RESNAPSHOTTED')!;
    expect(evento.scope.versionId).toBe(draft);
    expect(evento.summary).toContain('6 combinações viram 8');
    expect(evento.summary).toContain('2 combinações novas');
    expect((evento.payload as { role: string }).role).toBe('X');
    expect((evento.payload as { plan: { addedTuples: string[] } }).plan.addedTuples).toEqual(['R4']);
  });

  it('o comando não muta o documento recebido', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const comR4 = publishVariableWith(document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));
    const copia = structuredClone(comR4);

    apply(comR4, ctx, resnapshotAxisCommand({ versionId: draft, role: 'X' }));
    expect(comR4).toEqual(copia);
  });

  it('mantém I5: toda chave de células continua decompondo em tuplas válidas', () => {
    const ctx = testCtx();
    const { document, matrixId, draft } = nestedScenario(ctx);
    void matrixId;
    const maisRestrita = publishCompatibilityWith(document, ctx, IDS.compatRule, {
      ...SEG_X_FAT_ALLOW,
      VAREJO: ['ATE_100K'],
    });
    const aplicado = apply(maisRestrita, ctx, resnapshotAxisCommand({ versionId: draft, role: 'Y' }));

    const rascunho = versionOf(aplicado.document, draft);
    const xTuples = new Set(rascunho.axes.x.tuples);
    const yTuples = new Set(rascunho.axes.y.tuples);
    for (const key of Object.keys(rascunho.cells)) {
      const at = key.indexOf('::');
      expect(xTuples.has(key.slice(0, at))).toBe(true);
      expect(yTuples.has(key.slice(at + 2))).toBe(true);
    }
    // E o mesmo vale para as coordenadas que sobraram do grid.
    expect(coordsOf(aplicado.document, draft).length).toBe(
      rascunho.axes.x.tuples.length * rascunho.axes.y.tuples.length,
    );
  });
});

describe('reconciliação de um eixo não mexe no outro', () => {
  it('adotar X deixa Y byte a byte como estava', () => {
    const ctx = testCtx();
    const { document, draft } = nestedScenario(ctx);
    const antesY = structuredClone(versionOf(document, draft).axes.y);
    const comR4 = publishVariableWith(document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));

    const aplicado = apply(comR4, ctx, resnapshotAxisCommand({ versionId: draft, role: 'X' }));
    expect(versionOf(aplicado.document, draft).axes.y).toEqual(antesY);
  });

  it('o rascunho de outra matriz sobre a mesma variável não é afetado — nada em lote', () => {
    const ctx = testCtx();
    const primeira = simpleScenario(ctx);
    // Uma segunda matriz que também pina SCORE, com o próprio rascunho aberto.
    const outra = apply(
      primeira.document,
      ctx,
      createMatrix({
        projectId: IDS.projectA,
        code: 'MTZ_VIZINHA',
        name: 'Matriz vizinha',
        x: { levels: [{ variableId: IDS.score }] },
        y: { levels: [{ variableId: IDS.restritivo }] },
      }),
    );
    const vizinha = structuredClone(versionOf(outra.document, outra.data.versionId));

    const comR4 = publishVariableWith(outra.document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));
    // As duas ficam defasadas…
    expect(getStaleAxes(comR4).map((entry) => entry.versionId).sort()).toEqual(
      [primeira.draft, outra.data.versionId].sort(),
    );

    const aplicado = apply(comR4, ctx, resnapshotAxisCommand({ versionId: primeira.draft, role: 'X' }));

    // …e só a escolhida adota. A adoção é matriz a matriz (decisão de produto de §5.4).
    expect(versionOf(aplicado.document, outra.data.versionId)).toEqual(vizinha);
    expect(versionsExcept(aplicado.document, primeira.draft)).toEqual(
      versionsExcept(comR4, primeira.draft),
    );
    expect(getStaleAxes(aplicado.document).map((entry) => entry.versionId)).toEqual([
      outra.data.versionId,
    ]);
  });

  it('o preview de um eixo não enxerga o outro papel', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const comR4 = publishVariableWith(document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));
    expect(() => previewResnapshot(comR4, draft, 'Y')).toThrowError(
      expect.objectContaining({ code: 'AXIS_NOT_STALE' }),
    );
    expect(axisOf(previewResnapshot(comR4, draft, 'X').version, 'X').tuples).toHaveLength(4);
  });
});
