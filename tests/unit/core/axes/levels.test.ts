import { describe, expect, it } from 'vitest';
import { countPending } from '@/core/axes/combinations';
import {
  addLevel,
  previewAddLevel,
  previewRemoveLevel,
  previewReorderLevels,
  removeLevel,
  reorderLevels,
} from '@/core/axes/levels';
import { generateTuples } from '@/core/axes/tuples';
import type { Cell, MatrixVersion } from '@/core/document/schema';
import { DomainError } from '@/core/errors';
import {
  FAT_DOMAINS,
  SEGMENTO_DOMAINS,
  SEG_X_FAT_ALLOW,
  SEG_X_FAT_TUPLES,
  axis,
  compat,
  domains,
  fillCells,
  level,
  makeVersion,
  manyDomains,
  segXFat,
} from './fixtures';

function expectDomainError(run: () => unknown, code: string): DomainError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return error as DomainError;
  }
  throw new Error(`Esperava DomainError "${code}", mas nada foi lançado.`);
}

const scoreLevel = level('SCORE', domains('R1', 'R2'));
const segmentoLevel = level('SEGMENTO', SEGMENTO_DOMAINS);
const fatLevel = level('FAT', FAT_DOMAINS);

const xAxis = axis('X', [scoreLevel], ['R1', 'R2']);

/** Eixo Y de um nível (SEGMENTO), grid inteiro preenchido. */
function flatVersion(overrides: Partial<MatrixVersion> = {}): MatrixVersion {
  const yAxis = axis('Y', [segmentoLevel], ['VAREJO', 'ATACADO', 'CORPORATE']);
  return makeVersion({
    x: xAxis,
    y: yAxis,
    cells: fillCells(xAxis, yAxis, (xPath, yPath) => ({
      decision: 'APROVADO',
      note: `${xPath} ${yPath}`,
    })),
    ...overrides,
  });
}

/** Eixo Y aninhado (SEGMENTO › FAT) com as 8 tuplas do exemplo. */
function nestedVersion(cells?: Record<string, Cell>): MatrixVersion {
  const yAxis = axis('Y', [segmentoLevel, fatLevel], SEG_X_FAT_TUPLES);
  return makeVersion({
    x: xAxis,
    y: yAxis,
    cells: cells ?? fillCells(xAxis, yAxis, (xPath, yPath) => ({ note: `${xPath} ${yPath}` })),
  });
}

// ---------------------------------------------------------------------------
// §5.1 addLevel
// ---------------------------------------------------------------------------

describe('addLevel — REPLICATE', () => {
  it('copia cada célula para todas as suas descendentes', () => {
    const version = flatVersion();
    const result = addLevel(version, 'Y', {
      level: fatLevel,
      position: 1,
      compatibility: [segXFat()],
    });

    expect(result.version.axes.y.tuples).toEqual(SEG_X_FAT_TUPLES);
    expect(result.version.axes.y.levels.map((l) => l.variableId)).toEqual(['SEGMENTO', 'FAT']);

    const expected: Record<string, Cell> = {};
    for (const tuple of SEG_X_FAT_TUPLES) {
      const parent = tuple.split('|')[0]!;
      for (const xPath of ['R1', 'R2']) {
        expected[`${xPath}::${tuple}`] = version.cells[`${xPath}::${parent}`]!;
      }
    }
    expect(result.version.cells).toEqual(expected);
    expect(countPending(result.version)).toBe(0);

    expect(result.preview.before).toEqual({ tuples: 3, combinations: 6, filledCells: 6 });
    expect(result.preview.after).toEqual({ tuples: 8, combinations: 16, filledCells: 16 });
    expect(result.preview.combinationsWithoutCell).toBe(0);
    expect(result.preview.droppedCells).toEqual([]);
    expect(result.preview.mode).toBe('REPLICATE');
  });

  it('é o padrão quando `onExisting` não é informado', () => {
    const version = flatVersion();
    const semModo = previewAddLevel(version, 'Y', {
      level: fatLevel,
      position: 1,
      compatibility: [segXFat()],
    });
    expect(semModo.mode).toBe('REPLICATE');
    expect(semModo.after.filledCells).toBe(16);
  });

  it('registra o pin da regra usada em `derivedFrom`', () => {
    const rule = segXFat();
    const result = addLevel(flatVersion(), 'Y', {
      level: fatLevel,
      position: 1,
      compatibility: [rule],
    });
    expect(result.version.axes.y.derivedFrom.compatibilityVersionIds).toEqual([rule.version.id]);
  });

  it('descarta as células do pai que a regra elimina do grid', () => {
    const version = flatVersion();
    const semCorporate = compat({
      parentVariableId: 'SEGMENTO',
      childVariableId: 'FAT',
      allow: { VAREJO: ['ATE_100K'], ATACADO: ['1M_10M'] },
      defaultForUnlisted: 'NONE',
    });
    const result = addLevel(version, 'Y', {
      level: fatLevel,
      position: 1,
      compatibility: [semCorporate],
    });

    expect(result.version.axes.y.tuples).toEqual(['VAREJO|ATE_100K', 'ATACADO|1M_10M']);
    expect(result.preview.droppedCells).toEqual([
      { key: 'R1::CORPORATE', cell: version.cells['R1::CORPORATE'] },
      { key: 'R2::CORPORATE', cell: version.cells['R2::CORPORATE'] },
    ]);
    expect(result.preview.warnings).toEqual([
      expect.objectContaining({ code: 'PARENT_HAS_NO_CHILDREN', path: 'CORPORATE' }),
    ]);
  });

  it('mantém as lacunas: combinação sem célula não vira célula nas descendentes', () => {
    const version = flatVersion();
    delete version.cells['R1::VAREJO'];
    const result = addLevel(version, 'Y', {
      level: fatLevel,
      position: 1,
      compatibility: [segXFat()],
    });
    expect(Object.keys(result.version.cells)).toHaveLength(13);
    for (const tuple of SEG_X_FAT_TUPLES.filter((t) => t.startsWith('VAREJO'))) {
      expect(result.version.cells[`R1::${tuple}`]).toBeUndefined();
      expect(result.version.cells[`R2::${tuple}`]).toEqual({
        decision: 'APROVADO',
        note: 'R2 VAREJO',
      });
    }
    expect(result.preview.combinationsWithoutCell).toBe(3);
  });

  it('não replica para tuplas cujo ancestral não existia', () => {
    // Snapshot com CORPORATE fora das tuplas: as descendentes dele nascem vazias.
    const yAxis = axis('Y', [segmentoLevel], ['VAREJO', 'ATACADO']);
    const version = makeVersion({
      x: xAxis,
      y: yAxis,
      cells: fillCells(xAxis, yAxis, (xPath, yPath) => ({ note: `${xPath} ${yPath}` })),
    });
    const result = addLevel(version, 'Y', {
      level: fatLevel,
      position: 1,
      compatibility: [segXFat()],
    });
    expect(result.version.axes.y.tuples).toEqual(SEG_X_FAT_TUPLES);
    expect(Object.keys(result.version.cells)).toHaveLength(12);
    expect(result.version.cells['R1::CORPORATE|1M_10M']).toBeUndefined();
    expect(result.preview.combinationsWithoutCell).toBe(4);
  });
});

describe('addLevel — CLEAR', () => {
  it('esvazia o grid e deixa todas as combinações pendentes', () => {
    const version = flatVersion();
    const result = addLevel(version, 'Y', {
      level: fatLevel,
      position: 1,
      onExisting: 'CLEAR',
      compatibility: [segXFat()],
    });

    expect(result.version.cells).toEqual({});
    // I6 bloqueia a publicação enquanto houver pendência.
    expect(countPending(result.version)).toBe(16);
    expect(result.preview.combinationsWithoutCell).toBe(16);
    expect(result.preview.droppedCells).toHaveLength(6);
    expect(result.eventPayload.droppedCells).toEqual(
      Object.entries(version.cells).map(([key, cell]) => ({ key, cell })),
    );
  });
});

describe('addLevel — posição', () => {
  it('insere no fim (mais interno)', () => {
    const result = addLevel(flatVersion(), 'Y', {
      level: fatLevel,
      position: 1,
      compatibility: [segXFat()],
    });
    expect(result.version.axes.y.levels.map((l) => l.variableId)).toEqual(['SEGMENTO', 'FAT']);
    expect(result.version.axes.y.tuples[0]).toBe('VAREJO|ATE_100K');
  });

  it('insere na posição 0 (mais externo) e herda pelo ancestral correto', () => {
    const yAxis = axis('Y', [fatLevel], FAT_DOMAINS.map((d) => d.code));
    const version = makeVersion({
      x: xAxis,
      y: yAxis,
      cells: fillCells(xAxis, yAxis, (xPath, yPath) => ({ note: `${xPath} ${yPath}` })),
    });
    const result = addLevel(version, 'Y', {
      level: segmentoLevel,
      position: 0,
      compatibility: [segXFat()],
    });

    expect(result.version.axes.y.levels.map((l) => l.variableId)).toEqual(['SEGMENTO', 'FAT']);
    expect(result.version.axes.y.tuples).toEqual(SEG_X_FAT_TUPLES);
    expect(result.version.cells['R1::VAREJO|500K_1M']).toEqual({ note: 'R1 500K_1M' });
    expect(result.version.cells['R1::ATACADO|500K_1M']).toEqual({ note: 'R1 500K_1M' });
  });

  it('opera no eixo X do mesmo jeito', () => {
    const yAxis = axis('Y', [scoreLevel], ['R1', 'R2']);
    const xFlat = axis('X', [segmentoLevel], ['VAREJO', 'ATACADO', 'CORPORATE']);
    const version = makeVersion({
      x: xFlat,
      y: yAxis,
      cells: fillCells(xFlat, yAxis, (xPath, yPath) => ({ note: `${xPath} ${yPath}` })),
    });
    const result = addLevel(version, 'X', {
      level: fatLevel,
      position: 1,
      compatibility: [segXFat()],
    });
    expect(result.version.axes.x.tuples).toEqual(SEG_X_FAT_TUPLES);
    expect(result.version.cells['VAREJO|500K_1M::R2']).toEqual({ note: 'VAREJO R2' });
    expect(Object.keys(result.version.cells)).toHaveLength(16);
  });
});

describe('addLevel — supressões manuais', () => {
  it('expande cada supressão para todas as suas descendentes', () => {
    const yAxis = axis('Y', [segmentoLevel], ['VAREJO', 'CORPORATE'], ['ATACADO']);
    const version = makeVersion({
      x: xAxis,
      y: yAxis,
      cells: fillCells(xAxis, yAxis, (xPath, yPath) => ({ note: `${xPath} ${yPath}` })),
    });
    const result = addLevel(version, 'Y', {
      level: fatLevel,
      position: 1,
      compatibility: [segXFat()],
    });

    expect(result.version.axes.y.manualSuppressions).toEqual([
      'ATACADO|500K_1M',
      'ATACADO|1M_10M',
      'ATACADO|ACIMA_10M',
    ]);
    expect(result.version.axes.y.tuples).toEqual(
      SEG_X_FAT_TUPLES.filter((tuple) => !tuple.startsWith('ATACADO')),
    );
  });

  it('sem supressões, o eixo novo não ganha o campo', () => {
    const result = addLevel(flatVersion(), 'Y', {
      level: fatLevel,
      position: 1,
      compatibility: [segXFat()],
    });
    expect(result.version.axes.y.manualSuppressions).toBeUndefined();
  });
});

describe('addLevel — erros', () => {
  it('VERSION_IMMUTABLE fora de DRAFT', () => {
    const version = flatVersion({ state: 'PUBLISHED' });
    expectDomainError(
      () => addLevel(version, 'Y', { level: fatLevel, position: 1, compatibility: [] }),
      'VERSION_IMMUTABLE',
    );
  });

  it('INVALID_INPUT com posição fora do intervalo', () => {
    const version = flatVersion();
    expectDomainError(
      () => addLevel(version, 'Y', { level: fatLevel, position: -1, compatibility: [] }),
      'INVALID_INPUT',
    );
    expectDomainError(
      () => addLevel(version, 'Y', { level: fatLevel, position: 2, compatibility: [] }),
      'INVALID_INPUT',
    );
  });

  it('VARIABLE_ON_BOTH_AXES quando a variável já está no outro eixo', () => {
    expectDomainError(
      () => addLevel(flatVersion(), 'Y', { level: scoreLevel, position: 1, compatibility: [] }),
      'VARIABLE_ON_BOTH_AXES',
    );
  });

  it('DUPLICATE_VARIABLE_IN_AXIS quando a variável já está neste eixo', () => {
    expectDomainError(
      () =>
        addLevel(flatVersion(), 'Y', {
          level: level('SEGMENTO', SEGMENTO_DOMAINS, '-bis'),
          position: 1,
          compatibility: [],
        }),
      'DUPLICATE_VARIABLE_IN_AXIS',
    );
  });

  it('GRID_TOO_LARGE quando o produto dos dois eixos estoura', () => {
    const wideX = axis('X', [level('SCORE', manyDomains(500))], manyDomains(500).map((d) => d.code));
    const yAxis = axis('Y', [segmentoLevel], ['VAREJO', 'ATACADO', 'CORPORATE']);
    const version = makeVersion({ x: wideX, y: yAxis });
    expectDomainError(
      () => addLevel(version, 'Y', { level: fatLevel, position: 1, compatibility: [] }),
      'GRID_TOO_LARGE',
    );
  });
});

// ---------------------------------------------------------------------------
// §5.2 removeLevel
// ---------------------------------------------------------------------------

/** Varejo unânime, Atacado divergente, Corporate unânime. */
function collapseVersion(): MatrixVersion {
  const yAxis = axis('Y', [segmentoLevel, fatLevel], SEG_X_FAT_TUPLES);
  const cells = fillCells(xAxis, yAxis, (xPath, yPath) => {
    const [segmento, faixa] = yPath.split('|') as [string, string];
    if (segmento === 'ATACADO') return { decision: faixa === '500K_1M' ? 'APROVADO' : 'REPROVADO' };
    return { decision: 'APROVADO', note: `${xPath} ${segmento}` };
  });
  return makeVersion({ x: xAxis, y: yAxis, cells });
}

describe('removeLevel — KEEP_IF_UNANIMOUS', () => {
  it('é o padrão: grupo unânime preserva, grupo divergente esvazia', () => {
    const version = collapseVersion();
    const result = removeLevel(version, 'Y', { levelIndex: 1, compatibility: [] });

    expect(result.preview.mode).toBe('KEEP_IF_UNANIMOUS');
    expect(result.version.axes.y.tuples).toEqual(['VAREJO', 'ATACADO', 'CORPORATE']);
    expect(result.version.cells).toEqual({
      'R1::VAREJO': { decision: 'APROVADO', note: 'R1 VAREJO' },
      'R2::VAREJO': { decision: 'APROVADO', note: 'R2 VAREJO' },
      'R1::CORPORATE': { decision: 'APROVADO', note: 'R1 CORPORATE' },
      'R2::CORPORATE': { decision: 'APROVADO', note: 'R2 CORPORATE' },
    });
    expect(result.preview.collapsedGroups).toBe(3);
    expect(result.preview.divergentCells).toBe(2);
    expect(result.preview.combinationsWithoutCell).toBe(2);
    expect(result.preview.addedTuples).toEqual([]);
    expect(result.preview.removedTuples).toEqual([]);
  });

  it('leva o conteúdo descartado íntegro para o payload do evento', () => {
    const version = collapseVersion();
    const result = removeLevel(version, 'Y', { levelIndex: 1, compatibility: [] });

    const dropped = Object.fromEntries(
      result.eventPayload.droppedCells.map(({ key, cell }) => [key, cell]),
    );
    // As 6 células do Atacado (grupo divergente) somem por inteiro…
    for (const tuple of SEG_X_FAT_TUPLES.filter((t) => t.startsWith('ATACADO'))) {
      for (const xPath of ['R1', 'R2']) {
        expect(dropped[`${xPath}::${tuple}`]).toEqual(version.cells[`${xPath}::${tuple}`]);
      }
    }
    // …e nada do Varejo/Corporate, que foram preservados com o mesmo conteúdo.
    expect(result.eventPayload.droppedCells).toHaveLength(6);
    expect(result.eventPayload.variableId).toBe('FAT');
    expect(result.eventPayload.levelIndex).toBe(1);
  });
});

describe('removeLevel — KEEP_FIRST', () => {
  it('vence o conteúdo da primeira tupla do grupo na ordem do grid', () => {
    const version = collapseVersion();
    const result = removeLevel(version, 'Y', {
      levelIndex: 1,
      onCollapse: 'KEEP_FIRST',
      compatibility: [],
    });

    // A primeira tupla do Atacado é ATACADO|500K_1M, que estava APROVADO.
    expect(result.version.cells['R1::ATACADO']).toEqual({ decision: 'APROVADO' });
    expect(result.version.cells['R2::ATACADO']).toEqual({ decision: 'APROVADO' });
    expect(result.preview.divergentCells).toBe(2);
    expect(result.preview.combinationsWithoutCell).toBe(0);
    expect(result.preview.droppedCells).toHaveLength(4);
  });

  it('grupo inteiro sem células não gera célula nenhuma', () => {
    const yAxis = axis('Y', [segmentoLevel, fatLevel], SEG_X_FAT_TUPLES);
    const version = makeVersion({ x: xAxis, y: yAxis, cells: {} });
    const result = removeLevel(version, 'Y', {
      levelIndex: 1,
      onCollapse: 'KEEP_FIRST',
      compatibility: [],
    });
    expect(result.version.cells).toEqual({});
    expect(result.preview.divergentCells).toBe(0);
    expect(result.preview.droppedCells).toEqual([]);
  });
});

describe('removeLevel — mudança do conjunto de tuplas', () => {
  it('remover o nível externo colapsa por faixa e reporta tupla nova', () => {
    // 100K_500K não aparece em nenhuma tupla: ao remover SEGMENTO, ela entra.
    const allow = {
      VAREJO: ['ATE_100K', '500K_1M'],
      ATACADO: ['500K_1M', '1M_10M'],
      CORPORATE: ['1M_10M', 'ACIMA_10M'],
    };
    const { tuples } = generateTuples({
      levels: [segmentoLevel, fatLevel],
      compatibility: [
        compat({ parentVariableId: 'SEGMENTO', childVariableId: 'FAT', allow }),
      ],
    });
    const yAxis = axis('Y', [segmentoLevel, fatLevel], tuples);
    const version = makeVersion({
      x: xAxis,
      y: yAxis,
      cells: fillCells(xAxis, yAxis, (xPath, yPath) => ({ note: `${xPath} ${yPath}` })),
    });

    const result = removeLevel(version, 'Y', { levelIndex: 0, compatibility: [] });
    expect(result.version.axes.y.tuples).toEqual(FAT_DOMAINS.map((d) => d.code));
    expect(result.preview.addedTuples).toEqual(['100K_500K']);
    expect(result.preview.removedTuples).toEqual([]);
    expect(result.version.cells['R1::100K_500K']).toBeUndefined();
    // 500K_1M vinha de Varejo e Atacado com conteúdos diferentes: esvazia.
    expect(result.version.cells['R1::500K_1M']).toBeUndefined();
    expect(result.version.cells['R1::ATE_100K']).toEqual({ note: 'R1 VAREJO|ATE_100K' });
  });

  it('remover o nível do meio troca a regra aplicável e reporta tupla removida', () => {
    const segmento = level('SEGMENTO', domains('VAREJO', 'ATACADO'));
    const porte = level('PORTE', domains('PEQUENO', 'GRANDE'));
    const fat = level('FAT', domains('F1', 'F2', 'F3'));
    const segXPorte = compat({
      parentVariableId: 'SEGMENTO',
      childVariableId: 'PORTE',
      allow: { VAREJO: ['PEQUENO'], ATACADO: ['GRANDE'] },
    });
    const porteXFat = compat({
      parentVariableId: 'PORTE',
      childVariableId: 'FAT',
      allow: { PEQUENO: ['F1', 'F2'], GRANDE: ['F2', 'F3'] },
    });
    const segXFatDireto = compat({
      parentVariableId: 'SEGMENTO',
      childVariableId: 'FAT',
      allow: { VAREJO: ['F1'], ATACADO: ['F2', 'F3'] },
    });
    const compatibility = [segXPorte, porteXFat, segXFatDireto];

    const { tuples } = generateTuples({ levels: [segmento, porte, fat], compatibility });
    expect(tuples).toEqual([
      'VAREJO|PEQUENO|F1',
      'VAREJO|PEQUENO|F2',
      'ATACADO|GRANDE|F2',
      'ATACADO|GRANDE|F3',
    ]);
    const yAxis = axis('Y', [segmento, porte, fat], tuples);
    const version = makeVersion({
      x: xAxis,
      y: yAxis,
      cells: fillCells(xAxis, yAxis, (xPath, yPath) => ({ note: `${xPath} ${yPath}` })),
    });

    const result = removeLevel(version, 'Y', { levelIndex: 1, compatibility });
    expect(result.version.axes.y.tuples).toEqual(['VAREJO|F1', 'ATACADO|F2', 'ATACADO|F3']);
    expect(result.preview.removedTuples).toEqual(['VAREJO|F2']);
    expect(result.preview.addedTuples).toEqual([]);
    expect(result.preview.droppedCells.map((d) => d.key)).toEqual([
      'R1::VAREJO|PEQUENO|F2',
      'R2::VAREJO|PEQUENO|F2',
    ]);
  });

  it('reporta as supressões manuais que deixam de valer', () => {
    const yAxis = axis(
      'Y',
      [segmentoLevel, fatLevel],
      SEG_X_FAT_TUPLES.filter((t) => t !== 'ATACADO|500K_1M'),
      ['ATACADO|500K_1M'],
    );
    const version = makeVersion({ x: xAxis, y: yAxis, cells: {} });
    const result = removeLevel(version, 'Y', { levelIndex: 1, compatibility: [] });
    expect(result.preview.droppedSuppressions).toEqual(['ATACADO|500K_1M']);
    expect(result.version.axes.y.manualSuppressions).toBeUndefined();
  });
});

describe('removeLevel — erros', () => {
  it('AXIS_NEEDS_ONE_LEVEL ao remover o único nível', () => {
    expectDomainError(
      () => removeLevel(flatVersion(), 'Y', { levelIndex: 0, compatibility: [] }),
      'AXIS_NEEDS_ONE_LEVEL',
    );
  });

  it('VERSION_IMMUTABLE fora de DRAFT', () => {
    const version = makeVersion({
      x: xAxis,
      y: axis('Y', [segmentoLevel, fatLevel], SEG_X_FAT_TUPLES),
      state: 'SUPERSEDED',
    });
    expectDomainError(
      () => removeLevel(version, 'Y', { levelIndex: 1, compatibility: [] }),
      'VERSION_IMMUTABLE',
    );
  });

  it('INVALID_INPUT com índice de nível fora do intervalo', () => {
    const version = nestedVersion();
    expectDomainError(
      () => removeLevel(version, 'Y', { levelIndex: -1, compatibility: [] }),
      'INVALID_INPUT',
    );
    expectDomainError(
      () => removeLevel(version, 'Y', { levelIndex: 2, compatibility: [] }),
      'INVALID_INPUT',
    );
  });

  it('GRID_TOO_LARGE quando o colapso desfaz a restrição e o grid estoura', () => {
    const a = level('A', manyDomains(50));
    const b = level('B', manyDomains(3), '-b');
    const c = level('C', manyDomains(50), '-c');
    const aXb = compat({
      parentVariableId: 'A',
      childVariableId: 'B',
      allow: Object.fromEntries(a.domains.map((d) => [d.code, ['D0']])),
    });
    const bXc = compat({
      parentVariableId: 'B',
      childVariableId: 'C',
      allow: { D0: ['D0'] },
      defaultForUnlisted: 'NONE',
    });
    const compatibility = [aXb, bXc];
    const { tuples } = generateTuples({ levels: [a, b, c], compatibility });
    expect(tuples).toHaveLength(50);

    const wideX = axis('X', [scoreLevel], manyDomains(100).map((d) => d.code));
    const version = makeVersion({
      x: wideX,
      y: axis('Y', [a, b, c], tuples),
      cells: {},
    });
    expectDomainError(
      () => removeLevel(version, 'Y', { levelIndex: 1, compatibility }),
      'GRID_TOO_LARGE',
    );
  });
});

// ---------------------------------------------------------------------------
// §5.3 reorderLevels
// ---------------------------------------------------------------------------

/** Inverso de SEG_X_FAT: mesma relação, direção FAT → SEGMENTO. */
function fatXSeg() {
  const allow: Record<string, string[]> = {};
  for (const [segmento, faixas] of Object.entries(SEG_X_FAT_ALLOW)) {
    for (const faixa of faixas) {
      allow[faixa] = [...(allow[faixa] ?? []), segmento];
    }
  }
  return compat({
    parentVariableId: 'FAT',
    childVariableId: 'SEGMENTO',
    allow,
    ruleCode: 'FATURAMENTO_X_SEG',
  });
}

describe('reorderLevels — sem mudança de conjunto', () => {
  it('preserva todas as células, remapeando as chaves', () => {
    const version = nestedVersion();
    const result = reorderLevels(version, 'Y', {
      fromIndex: 0,
      toIndex: 1,
      compatibility: [segXFat(), fatXSeg()],
    });

    expect(result.preview.tuplesChanged).toBe(false);
    expect(result.preview.requiresConfirmation).toBe(false);
    expect(result.version.axes.y.levels.map((l) => l.variableId)).toEqual(['FAT', 'SEGMENTO']);
    expect(result.version.axes.y.tuples).toEqual([
      'ATE_100K|VAREJO',
      '100K_500K|VAREJO',
      '500K_1M|VAREJO',
      '500K_1M|ATACADO',
      '1M_10M|ATACADO',
      '1M_10M|CORPORATE',
      'ACIMA_10M|ATACADO',
      'ACIMA_10M|CORPORATE',
    ]);

    const expected: Record<string, Cell> = {};
    for (const [key, cell] of Object.entries(version.cells)) {
      const [xPath, yPath] = key.split('::') as [string, string];
      const [segmento, faixa] = yPath.split('|') as [string, string];
      expected[`${xPath}::${faixa}|${segmento}`] = cell;
    }
    expect(result.version.cells).toEqual(expected);
    expect(result.preview.droppedCells).toEqual([]);
    expect(result.preview.before.filledCells).toBe(16);
    expect(result.preview.after.filledCells).toBe(16);
  });

  it('permuta também as supressões manuais', () => {
    const kept = SEG_X_FAT_TUPLES.filter((t) => t !== 'ATACADO|500K_1M');
    const yAxis = axis('Y', [segmentoLevel, fatLevel], kept, ['ATACADO|500K_1M']);
    const version = makeVersion({ x: xAxis, y: yAxis, cells: {} });
    const result = reorderLevels(version, 'Y', {
      fromIndex: 1,
      toIndex: 0,
      compatibility: [segXFat(), fatXSeg()],
    });
    expect(result.version.axes.y.manualSuppressions).toEqual(['500K_1M|ATACADO']);
    expect(result.version.axes.y.tuples).not.toContain('500K_1M|ATACADO');
    expect(result.preview.tuplesChanged).toBe(false);
  });
});

describe('reorderLevels — com mudança de conjunto', () => {
  it('exige confirmação e reporta o delta', () => {
    const version = nestedVersion();
    const input = { fromIndex: 0, toIndex: 1, compatibility: [segXFat()] };

    const preview = previewReorderLevels(version, 'Y', input);
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.addedTuples).toHaveLength(7); // 15 do produto cartesiano − 8
    expect(preview.removedTuples).toEqual([]);

    const error = expectDomainError(() => reorderLevels(version, 'Y', input), 'INVALID_INPUT');
    expect(error.message).toMatch(/confirme/i);

    const applied = reorderLevels(version, 'Y', { ...input, confirm: true });
    expect(applied.version.axes.y.tuples).toHaveLength(15);
    expect(applied.eventPayload.tuplesChanged).toBe(true);
  });

  it('descarta as células cujas combinações não sobrevivem à inversão', () => {
    const version = nestedVersion();
    const inversaRestritiva = compat({
      parentVariableId: 'FAT',
      childVariableId: 'SEGMENTO',
      allow: { ATE_100K: ['VAREJO'] },
      defaultForUnlisted: 'NONE',
    });
    const result = reorderLevels(version, 'Y', {
      fromIndex: 1,
      toIndex: 0,
      compatibility: [inversaRestritiva],
      confirm: true,
    });

    expect(result.version.axes.y.tuples).toEqual(['ATE_100K|VAREJO']);
    expect(result.preview.removedTuples).toHaveLength(7);
    expect(result.preview.addedTuples).toEqual([]);
    expect(result.preview.droppedCells).toHaveLength(14);
    expect(result.version.cells).toEqual({
      'R1::ATE_100K|VAREJO': { note: 'R1 VAREJO|ATE_100K' },
      'R2::ATE_100K|VAREJO': { note: 'R2 VAREJO|ATE_100K' },
    });
  });
});

describe('reorderLevels — erros', () => {
  it('VERSION_IMMUTABLE fora de DRAFT', () => {
    const version = makeVersion({
      x: xAxis,
      y: axis('Y', [segmentoLevel, fatLevel], SEG_X_FAT_TUPLES),
      state: 'ARCHIVED',
    });
    expectDomainError(
      () => reorderLevels(version, 'Y', { fromIndex: 0, toIndex: 1, compatibility: [] }),
      'VERSION_IMMUTABLE',
    );
  });

  it('INVALID_INPUT com índices fora do intervalo', () => {
    const version = nestedVersion();
    const casos = [
      { fromIndex: -1, toIndex: 0 },
      { fromIndex: 2, toIndex: 0 },
      { fromIndex: 0, toIndex: -1 },
      { fromIndex: 0, toIndex: 2 },
    ];
    for (const caso of casos) {
      expectDomainError(
        () => reorderLevels(version, 'Y', { ...caso, compatibility: [] }),
        'INVALID_INPUT',
      );
    }
  });

  it('GRID_TOO_LARGE quando a nova ordem perde a restrição e o grid estoura', () => {
    const a = level('A', manyDomains(60));
    const b = level('B', manyDomains(60), '-b');
    const aXb = compat({
      parentVariableId: 'A',
      childVariableId: 'B',
      allow: Object.fromEntries(a.domains.map((d) => [d.code, ['D0']])),
    });
    const { tuples } = generateTuples({ levels: [a, b], compatibility: [aXb] });
    const version = makeVersion({
      x: axis('X', [scoreLevel], ['R1', 'R2']),
      y: axis('Y', [a, b], tuples),
      cells: {},
    });
    // Invertido não há regra: 60 × 60 = 3.600 tuplas × 2 colunas = 7.200.
    expectDomainError(
      () => reorderLevels(version, 'Y', { fromIndex: 0, toIndex: 1, compatibility: [aXb] }),
      'GRID_TOO_LARGE',
    );
  });
});

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

describe('previews', () => {
  it('calculam o impacto sem tocar na versão original', () => {
    const version = flatVersion();
    const snapshot = JSON.stringify(version);

    const add = previewAddLevel(version, 'Y', {
      level: fatLevel,
      position: 1,
      compatibility: [segXFat()],
    });
    expect(add.before.combinations).toBe(6);
    expect(add.after.combinations).toBe(16);

    const nested = nestedVersion();
    const nestedSnapshot = JSON.stringify(nested);
    const remove = previewRemoveLevel(nested, 'Y', { levelIndex: 1, compatibility: [] });
    expect(remove.after.tuples).toBe(3);
    expect(remove.collapsedGroups).toBe(3);

    const reorder = previewReorderLevels(nested, 'Y', {
      fromIndex: 0,
      toIndex: 1,
      compatibility: [segXFat(), fatXSeg()],
    });
    expect(reorder.tuplesChanged).toBe(false);

    expect(JSON.stringify(version)).toBe(snapshot);
    expect(JSON.stringify(nested)).toBe(nestedSnapshot);
  });
});
