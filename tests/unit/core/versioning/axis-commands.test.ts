import { describe, expect, it } from 'vitest';
import { listPending } from '@/core/axes/combinations';
import type { Cell, PolicyOpsDocument } from '@/core/document/schema';
import { applyCellPatch } from '@/core/versioning/cells';
import {
  addLevelCommand,
  previewAddLevelOn,
  previewRemoveLevelOn,
  previewReorderLevelsOn,
  removeLevelCommand,
  reorderLevelsCommand,
  restoreTuplesCommand,
  suppressTuplesCommand,
} from '@/core/versioning/axis-commands';
import { createMatrix, locateVersion, publishVersion } from '@/core/versioning/lifecycle';
import {
  apply,
  baseDocument,
  createTestMatrix,
  documentWithAllStates,
  expectFailure,
  fillAllCells,
  IDS,
  testCtx,
  withoutEvents,
  type TestCtx,
} from './fixtures';

/**
 * Comandos de eixo — docs/04-eixos-aninhados.md §5 e docs/08 §3.
 *
 * O teste que sustenta a sessão inteira é o do inverso: **desfazer devolve o
 * documento deep-equal ao original**, inclusive depois de remover um nível.
 */

function versionOf(doc: PolicyOpsDocument, versionId: string) {
  return locateVersion(doc, versionId).version;
}

function cellsOf(doc: PolicyOpsDocument, versionId: string): Record<string, Cell> {
  return versionOf(doc, versionId).cells;
}

function tuplesOf(doc: PolicyOpsDocument, versionId: string, role: 'X' | 'Y'): string[] {
  const version = versionOf(doc, versionId);
  return role === 'X' ? version.axes.x.tuples : version.axes.y.tuples;
}

/** Matriz X = SCORE (3) × Y = SEGMENTO (3) = 9 combinações. */
function createSegmentoMatrix(doc: PolicyOpsDocument, ctx: TestCtx) {
  return apply(
    doc,
    ctx,
    createMatrix({
      projectId: IDS.projectA,
      code: 'MTZ_SEG',
      name: 'Matriz por segmento',
      x: { levels: [{ variableId: IDS.score }] },
      y: { levels: [{ variableId: IDS.segmento }] },
    }),
  );
}

/** Decide cada célula com um valor distinto por coordenada — divergência garantida. */
function fillDistinct(doc: PolicyOpsDocument, ctx: TestCtx, versionId: string): PolicyOpsDocument {
  const version = versionOf(doc, versionId);
  let current = doc;
  let index = 0;
  const notes = ['nota A', 'nota B', 'nota C', 'nota D', 'nota E', 'nota F', 'nota G', 'nota H', 'nota I'];
  for (const yPath of version.axes.y.tuples) {
    for (const xPath of version.axes.x.tuples) {
      current = apply(
        current,
        ctx,
        applyCellPatch({
          versionId,
          patch: { coords: [{ xPath, yPath }], set: { decision: 'APROVADO', note: notes[index % notes.length]! } },
        }),
      ).document;
      index += 1;
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// §5.1 addLevel
// ---------------------------------------------------------------------------

describe('axis/addLevel', () => {
  it('REPLICATE copia o conteúdo para todas as descendentes — mapa de células inteiro', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;
    const before = fillDistinct(created.document, ctx, versionId);
    const beforeCells = cellsOf(before, versionId);

    const applied = apply(
      before,
      ctx,
      addLevelCommand({ versionId, role: 'Y', variableId: IDS.segmento, position: 1 }),
    );

    // Y era RESTRITIVO (2 tuplas); vira RESTRITIVO › SEGMENTO (2 × 3 = 6).
    expect(tuplesOf(applied.document, versionId, 'Y')).toEqual([
      'SEM|VAREJO', 'SEM|ATACADO', 'SEM|CORPORATE',
      'ALTO|VAREJO', 'ALTO|ATACADO', 'ALTO|CORPORATE',
    ]);

    const expected: Record<string, Cell> = {};
    for (const [key, cell] of Object.entries(beforeCells)) {
      const [xPath, yPath] = key.split('::') as [string, string];
      for (const segmento of ['VAREJO', 'ATACADO', 'CORPORATE']) {
        expected[`${xPath}::${yPath}|${segmento}`] = cell;
      }
    }
    expect(cellsOf(applied.document, versionId)).toEqual(expected);
    expect(applied.data.pendingCells).toBe(0);
    expect(applied.data.preview.before.combinations).toBe(6);
    expect(applied.data.preview.after.combinations).toBe(18);
  });

  it('CLEAR deixa as novas pendentes e a publicação passa a falhar com UNSET_CELLS_REMAIN', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;
    const filled = fillAllCells(created.document, ctx, versionId);

    const applied = apply(
      filled,
      ctx,
      addLevelCommand({ versionId, role: 'Y', variableId: IDS.segmento, position: 1, onExisting: 'CLEAR' }),
    );

    expect(cellsOf(applied.document, versionId)).toEqual({});
    expect(applied.data.pendingCells).toBe(18);
    expectFailure(
      applied.document,
      ctx,
      publishVersion({ versionId, notes: 'Tentativa de publicar com pendências.' }),
      'UNSET_CELLS_REMAIN',
    );
  });

  it('position 0 (mais externo) e última — ordem de tuplas correta nos dois casos', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;

    const externo = apply(
      created.document,
      ctx,
      addLevelCommand({ versionId, role: 'Y', variableId: IDS.segmento, position: 0 }),
    );
    expect(tuplesOf(externo.document, versionId, 'Y')).toEqual([
      'VAREJO|SEM', 'VAREJO|ALTO',
      'ATACADO|SEM', 'ATACADO|ALTO',
      'CORPORATE|SEM', 'CORPORATE|ALTO',
    ]);

    const interno = apply(
      created.document,
      ctx,
      addLevelCommand({ versionId, role: 'Y', variableId: IDS.segmento, position: 1 }),
    );
    expect(tuplesOf(interno.document, versionId, 'Y')).toEqual([
      'SEM|VAREJO', 'SEM|ATACADO', 'SEM|CORPORATE',
      'ALTO|VAREJO', 'ALTO|ATACADO', 'ALTO|CORPORATE',
    ]);
  });

  it('com regra de compatibilidade ativa gera 8 tuplas em vez das 15 do cartesiano', () => {
    const ctx = testCtx();
    const created = createSegmentoMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;

    const applied = apply(
      created.document,
      ctx,
      addLevelCommand({ versionId, role: 'Y', variableId: IDS.fat, position: 1 }),
    );

    const tuples = tuplesOf(applied.document, versionId, 'Y');
    expect(tuples).toHaveLength(8);
    expect(tuples).not.toHaveLength(3 * 5);
    expect(tuples).toEqual([
      'VAREJO|ATE_100K', 'VAREJO|100K_500K', 'VAREJO|500K_1M',
      'ATACADO|500K_1M', 'ATACADO|1M_10M', 'ATACADO|ACIMA_10M',
      'CORPORATE|1M_10M', 'CORPORATE|ACIMA_10M',
    ]);
    // 3 tuplas de X × 8 de Y.
    expect(applied.data.preview.after.combinations).toBe(24);
  });

  it('o preview calcula o mesmo impacto sem tocar no documento', () => {
    const ctx = testCtx();
    const created = createSegmentoMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;

    const antes = structuredClone(withoutEvents(created.document));
    const { preview, tuplesBefore, tuplesAfter } = previewAddLevelOn(created.document, {
      versionId,
      role: 'Y',
      variableId: IDS.fat,
      position: 1,
    });
    expect(preview.before.combinations).toBe(9);
    expect(preview.after.combinations).toBe(24);
    expect(tuplesBefore).toEqual(['VAREJO', 'ATACADO', 'CORPORATE']);
    expect(tuplesAfter).toHaveLength(8);
    expect(withoutEvents(created.document)).toEqual(antes);
  });
});

// ---------------------------------------------------------------------------
// §5.2 removeLevel
// ---------------------------------------------------------------------------

describe('axis/removeLevel', () => {
  /** Matriz com Y = SEGMENTO › FAT (8 tuplas) e X = SCORE (3). */
  function withNestedY(ctx: TestCtx) {
    const created = createSegmentoMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;
    const nested = apply(
      created.document,
      ctx,
      addLevelCommand({ versionId, role: 'Y', variableId: IDS.fat, position: 1 }),
    );
    return { document: nested.document, versionId };
  }

  it('KEEP_IF_UNANIMOUS preserva o grupo unânime e esvazia o divergente', () => {
    const ctx = testCtx();
    const { document, versionId } = withNestedY(ctx);

    // Varejo tem 3 faixas. Deixa as três iguais em R1 (unânime) e diverge em R2.
    let doc = apply(
      document,
      ctx,
      applyCellPatch({
        versionId,
        patch: {
          coords: [
            { xPath: 'R1', yPath: 'VAREJO|ATE_100K' },
            { xPath: 'R1', yPath: 'VAREJO|100K_500K' },
            { xPath: 'R1', yPath: 'VAREJO|500K_1M' },
          ],
          set: { decision: 'APROVADO' },
        },
      }),
    ).document;
    doc = apply(
      doc,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: [{ xPath: 'R2', yPath: 'VAREJO|ATE_100K' }], set: { decision: 'APROVADO' } },
      }),
    ).document;
    doc = apply(
      doc,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: [{ xPath: 'R2', yPath: 'VAREJO|100K_500K' }], set: { decision: 'REPROVADO' } },
      }),
    ).document;

    const applied = apply(
      doc,
      ctx,
      removeLevelCommand({ versionId, role: 'Y', levelIndex: 1 }),
    );

    const cells = cellsOf(applied.document, versionId);
    expect(cells['R1::VAREJO']).toEqual({ decision: 'APROVADO' });
    expect(cells['R2::VAREJO']).toBeUndefined();
    expect(applied.data.preview.divergentCells).toBeGreaterThan(0);
  });

  it('KEEP_FIRST vence a primeira tupla na ordem do grid', () => {
    const ctx = testCtx();
    const { document, versionId } = withNestedY(ctx);

    let doc = apply(
      document,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: [{ xPath: 'R1', yPath: 'VAREJO|ATE_100K' }], set: { decision: 'APROVADO' } },
      }),
    ).document;
    doc = apply(
      doc,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: [{ xPath: 'R1', yPath: 'VAREJO|500K_1M' }], set: { decision: 'REPROVADO' } },
      }),
    ).document;

    const applied = apply(
      doc,
      ctx,
      removeLevelCommand({ versionId, role: 'Y', levelIndex: 1, onCollapse: 'KEEP_FIRST' }),
    );

    expect(cellsOf(applied.document, versionId)['R1::VAREJO']).toEqual({ decision: 'APROVADO' });
  });

  it('o conteúdo descartado aparece íntegro no payload do evento', () => {
    const ctx = testCtx();
    const { document, versionId } = withNestedY(ctx);
    const descartada: Cell = { decision: 'REPROVADO', note: 'motivo do descarte' };

    let doc = apply(
      document,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: [{ xPath: 'R1', yPath: 'VAREJO|ATE_100K' }], set: { decision: 'APROVADO' } },
      }),
    ).document;
    doc = apply(
      doc,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: [{ xPath: 'R1', yPath: 'VAREJO|500K_1M' }], set: descartada },
      }),
    ).document;

    const applied = apply(
      doc,
      ctx,
      removeLevelCommand({ versionId, role: 'Y', levelIndex: 1 }),
    );

    const event = applied.result.events[0]!;
    expect(event.type).toBe('AXIS_LEVEL_REMOVED');
    const dropped = event.payload!.droppedCells as Array<{ key: string; cell: Cell }>;
    expect(dropped).toContainEqual({ key: 'R1::VAREJO|500K_1M', cell: descartada });
    expect(dropped).toContainEqual({ key: 'R1::VAREJO|ATE_100K', cell: { decision: 'APROVADO' } });
    expect(event.payload!.variableCode).toBe('FAT');
  });

  it('remover o único nível de um eixo falha com AXIS_NEEDS_ONE_LEVEL', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    expectFailure(
      created.document,
      ctx,
      removeLevelCommand({ versionId: created.data.versionId, role: 'Y', levelIndex: 0 }),
      'AXIS_NEEDS_ONE_LEVEL',
    );
  });
});

// ---------------------------------------------------------------------------
// §5.3 reorderLevels
// ---------------------------------------------------------------------------

describe('axis/reorderLevels', () => {
  it('sem mudança do conjunto de tuplas preserva todas as células — mapa inteiro', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;
    // Y = RESTRITIVO › SEGMENTO: não há regra em nenhuma das duas direções,
    // então o conjunto é o cartesiano nos dois sentidos.
    const nested = apply(
      created.document,
      ctx,
      addLevelCommand({ versionId, role: 'Y', variableId: IDS.segmento, position: 1 }),
    );
    const doc = fillDistinct(nested.document, ctx, versionId);
    const before = cellsOf(doc, versionId);

    const applied = apply(
      doc,
      ctx,
      reorderLevelsCommand({ versionId, role: 'Y', from: 0, to: 1 }),
    );

    expect(applied.data.preview.tuplesChanged).toBe(false);
    const after = cellsOf(applied.document, versionId);
    expect(Object.keys(after)).toHaveLength(Object.keys(before).length);
    const expected: Record<string, Cell> = {};
    for (const [key, cell] of Object.entries(before)) {
      const [xPath, yPath] = key.split('::') as [string, string];
      const [restritivo, segmento] = yPath.split('|') as [string, string];
      expected[`${xPath}::${segmento}|${restritivo}`] = cell;
    }
    expect(after).toEqual(expected);
  });

  it('com mudança do conjunto reporta o delta e exige confirmação', () => {
    const ctx = testCtx();
    const created = createSegmentoMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;
    const nested = apply(
      created.document,
      ctx,
      addLevelCommand({ versionId, role: 'Y', variableId: IDS.fat, position: 1 }),
    );

    // SEGMENTO › FAT tem regra (8 tuplas); FAT › SEGMENTO não tem (15).
    const recusa = expectFailure(
      nested.document,
      ctx,
      reorderLevelsCommand({ versionId, role: 'Y', from: 0, to: 1 }),
      'INVALID_INPUT',
    );
    const details = recusa.details as { addedTuples: string[]; removedTuples: string[] };
    expect(details.addedTuples.length).toBeGreaterThan(0);

    const confirmado = apply(
      nested.document,
      ctx,
      reorderLevelsCommand({ versionId, role: 'Y', from: 0, to: 1, confirm: true }),
    );
    expect(confirmado.data.preview.tuplesChanged).toBe(true);
    expect(tuplesOf(confirmado.document, versionId, 'Y')).toHaveLength(15);
    expect(confirmado.result.events[0]!.payload!.tuplesChanged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// docs/07 §8 — supressão manual
// ---------------------------------------------------------------------------

describe('axis/suppressTuples e axis/restoreTuples', () => {
  it('suprime combinações: somem do grid e deixam de contar como pendentes', () => {
    const ctx = testCtx();
    const created = createSegmentoMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;

    const antes = listPending(versionOf(created.document, versionId)).length;
    expect(antes).toBe(9);

    const applied = apply(
      created.document,
      ctx,
      suppressTuplesCommand({ versionId, role: 'Y', paths: ['ATACADO'] }),
    );

    expect(tuplesOf(applied.document, versionId, 'Y')).toEqual(['VAREJO', 'CORPORATE']);
    expect(applied.data.pendingCells).toBe(6);
    expect(versionOf(applied.document, versionId).axes.y.manualSuppressions).toEqual(['ATACADO']);
    expect(applied.result.events[0]!.type).toBe('TUPLES_SUPPRESSED');

    const restored = apply(
      applied.document,
      ctx,
      restoreTuplesCommand({ versionId, role: 'Y', paths: ['ATACADO'] }),
    );
    expect(tuplesOf(restored.document, versionId, 'Y')).toEqual(['VAREJO', 'ATACADO', 'CORPORATE']);
    expect(restored.data.pendingCells).toBe(9);
  });

  it('suprimir uma combinação inexistente falha com INVALID_COORD', () => {
    const ctx = testCtx();
    const created = createSegmentoMatrix(baseDocument(), ctx);
    expectFailure(
      created.document,
      ctx,
      suppressTuplesCommand({ versionId: created.data.versionId, role: 'Y', paths: ['NAO_EXISTE'] }),
      'INVALID_COORD',
    );
  });
});

// ---------------------------------------------------------------------------
// Inverso — o critério de aceite que impede perda de trabalho
// ---------------------------------------------------------------------------

describe('inverso das operações de eixo', () => {
  /** Aplica e desfaz, exigindo documento deep-equal (menos os eventos, append-only). */
  function expectRoundTrip(
    doc: PolicyOpsDocument,
    ctx: TestCtx,
    command: Parameters<typeof apply>[2],
  ) {
    const applied = apply(doc, ctx, command);
    const undone = apply(applied.document, ctx, applied.result.inverse);
    expect(withoutEvents(undone.document)).toEqual(withoutEvents(doc));
    // E refazer devolve exatamente o documento aplicado.
    const redone = apply(undone.document, ctx, undone.result.inverse);
    expect(withoutEvents(redone.document)).toEqual(withoutEvents(applied.document));
  }

  it('addLevel', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;
    const doc = fillDistinct(created.document, ctx, versionId);
    expectRoundTrip(doc, ctx, addLevelCommand({ versionId, role: 'Y', variableId: IDS.segmento, position: 1 }));
  });

  it('removeLevel — inclusive o conteúdo divergente que a política esvaziou', () => {
    const ctx = testCtx();
    const created = createSegmentoMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;
    const nested = apply(
      created.document,
      ctx,
      addLevelCommand({ versionId, role: 'Y', variableId: IDS.fat, position: 1 }),
    );
    const doc = fillDistinct(nested.document, ctx, versionId);
    expectRoundTrip(doc, ctx, removeLevelCommand({ versionId, role: 'Y', levelIndex: 1 }));
  });

  it('reorderLevels com perda', () => {
    const ctx = testCtx();
    const created = createSegmentoMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;
    const nested = apply(
      created.document,
      ctx,
      addLevelCommand({ versionId, role: 'Y', variableId: IDS.fat, position: 1 }),
    );
    const doc = fillDistinct(nested.document, ctx, versionId);
    expectRoundTrip(doc, ctx, reorderLevelsCommand({ versionId, role: 'Y', from: 0, to: 1, confirm: true }));
  });

  it('suppressTuples', () => {
    const ctx = testCtx();
    const created = createSegmentoMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;
    const doc = fillDistinct(created.document, ctx, versionId);
    expectRoundTrip(doc, ctx, suppressTuplesCommand({ versionId, role: 'Y', paths: ['ATACADO'] }));
  });
});

// ---------------------------------------------------------------------------
// Previews e entradas de borda
// ---------------------------------------------------------------------------

describe('previews e validações de entrada', () => {
  it('previewRemoveLevelOn e previewReorderLevelsOn devolvem o impacto e as tuplas', () => {
    const ctx = testCtx();
    const created = createSegmentoMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;
    const nested = apply(
      created.document,
      ctx,
      addLevelCommand({ versionId, role: 'Y', variableId: IDS.fat, position: 1 }),
    );

    // Sem `onCollapse`: vale o padrão conservador.
    expect(previewRemoveLevelOn(nested.document, { versionId, role: 'Y', levelIndex: 1 }).preview.mode).toBe(
      'KEEP_IF_UNANIMOUS',
    );
    const remocao = previewRemoveLevelOn(nested.document, {
      versionId,
      role: 'Y',
      levelIndex: 1,
      onCollapse: 'KEEP_FIRST',
    });
    expect(remocao.tuplesBefore).toHaveLength(8);
    expect(remocao.tuplesAfter).toEqual(['VAREJO', 'ATACADO', 'CORPORATE']);

    const reordenacao = previewReorderLevelsOn(nested.document, {
      versionId,
      role: 'Y',
      from: 0,
      to: 1,
    });
    expect(reordenacao.preview.tuplesChanged).toBe(true);
    expect(reordenacao.tuplesAfter).toHaveLength(15);
  });

  it('o rótulo do nível pode ser informado, e o eixo X funciona igual ao Y', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;

    const preview = previewAddLevelOn(created.document, {
      versionId,
      role: 'X',
      variableId: IDS.segmento,
      position: 0,
      label: 'Segmento do cliente',
    });
    expect(preview.preview.after.combinations).toBe(18);

    const applied = apply(
      created.document,
      ctx,
      addLevelCommand({
        versionId,
        role: 'X',
        variableId: IDS.segmento,
        position: 0,
        label: 'Segmento do cliente',
      }),
    );
    expect(versionOf(applied.document, versionId).axes.x.levels[0]!.label).toBe('Segmento do cliente');

    // Supressão no eixo X segue o mesmo caminho, inclusive descartando células.
    const preenchido = fillAllCells(applied.document, ctx, versionId);
    const suprimido = apply(
      preenchido,
      ctx,
      suppressTuplesCommand({ versionId, role: 'X', paths: ['VAREJO|R1'] }),
    );
    expect(tuplesOf(suprimido.document, versionId, 'X')).not.toContain('VAREJO|R1');
    expect(suprimido.data.preview.droppedCells.length).toBeGreaterThan(0);
  });

  it('supressão e restauração sem caminhos falham com INVALID_INPUT', () => {
    const ctx = testCtx();
    const created = createSegmentoMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;
    expectFailure(created.document, ctx, suppressTuplesCommand({ versionId, role: 'Y', paths: [] }), 'INVALID_INPUT');
    expectFailure(created.document, ctx, restoreTuplesCommand({ versionId, role: 'Y', paths: [] }), 'INVALID_INPUT');
  });

  it('restaurar uma combinação que não está suprimida falha com INVALID_COORD', () => {
    const ctx = testCtx();
    const created = createSegmentoMatrix(baseDocument(), ctx);
    expectFailure(
      created.document,
      ctx,
      restoreTuplesCommand({ versionId: created.data.versionId, role: 'Y', paths: ['VAREJO'] }),
      'INVALID_COORD',
    );
  });

  it('variável ausente da biblioteca cai no id no payload, em vez de quebrar a auditoria', () => {
    const ctx = testCtx();
    const created = createSegmentoMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;
    const nested = apply(
      created.document,
      ctx,
      addLevelCommand({ versionId, role: 'Y', variableId: IDS.fat, position: 1 }),
    );
    // O nível guarda o snapshot dos domínios; a variável some da biblioteca.
    const semVariavel: PolicyOpsDocument = {
      ...nested.document,
      variables: nested.document.variables.filter((variable) => variable.id !== IDS.fat),
    };

    const applied = apply(semVariavel, ctx, removeLevelCommand({ versionId, role: 'Y', levelIndex: 1 }));
    expect(applied.result.events[0]!.payload!.variableCode).toBe(IDS.fat);
  });
});

// ---------------------------------------------------------------------------
// I3 e I16
// ---------------------------------------------------------------------------

describe('guardas', () => {
  it('toda operação de eixo falha com VERSION_IMMUTABLE em versão publicada', () => {
    const ctx = testCtx();
    const states = documentWithAllStates(ctx);
    for (const versionId of [states.published, states.superseded, states.archived]) {
      expectFailure(
        states.document,
        ctx,
        addLevelCommand({ versionId, role: 'Y', variableId: IDS.segmento, position: 1 }),
        'VERSION_IMMUTABLE',
      );
      expectFailure(
        states.document,
        ctx,
        removeLevelCommand({ versionId, role: 'Y', levelIndex: 0 }),
        'VERSION_IMMUTABLE',
      );
      expectFailure(
        states.document,
        ctx,
        reorderLevelsCommand({ versionId, role: 'Y', from: 0, to: 0 }),
        'VERSION_IMMUTABLE',
      );
      expectFailure(
        states.document,
        ctx,
        suppressTuplesCommand({ versionId, role: 'Y', paths: ['SEM'] }),
        'VERSION_IMMUTABLE',
      );
      expectFailure(
        states.document,
        ctx,
        restoreTuplesCommand({ versionId, role: 'Y', paths: ['SEM'] }),
        'VERSION_IMMUTABLE',
      );
    }
  });

  it('ultrapassar 6.000 combinações falha com GRID_TOO_LARGE e não altera nada', () => {
    const ctx = testCtx();
    // X = BIG_X (30) × Y = BIG_Y (21) = 630 combinações.
    const created = apply(
      baseDocument(),
      ctx,
      createMatrix({
        projectId: IDS.projectA,
        code: 'MTZ_GRANDE',
        name: 'Matriz grande',
        x: { levels: [{ variableId: IDS.bigX }] },
        y: { levels: [{ variableId: IDS.bigY }] },
      }),
    );
    const versionId = created.data.versionId;

    // +SCORE (3) em X: 90 × 21 = 1.890, ainda cabe.
    const cresceu = apply(
      created.document,
      ctx,
      addLevelCommand({ versionId, role: 'X', variableId: IDS.score, position: 1 }),
    );
    // +FAT (5): 450 × 21 = 9.450 — estoura o teto.
    expectFailure(
      cresceu.document,
      ctx,
      addLevelCommand({ versionId, role: 'X', variableId: IDS.fat, position: 2 }),
      'GRID_TOO_LARGE',
    );
    expect(tuplesOf(cresceu.document, versionId, 'X')).toHaveLength(90);
  });
});
