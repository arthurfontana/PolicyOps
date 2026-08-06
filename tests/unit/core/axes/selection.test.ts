import { describe, expect, it } from 'vitest';
import type { Axis } from '@/core/document/schema';
import {
  allCoords,
  coordAt,
  coordIndex,
  coordsUnderHeader,
  expandFrom,
  fromKey,
  headerPathsAtLevel,
  headerRangeCoords,
  isHeaderFullySelected,
  rectBetween,
  stepCoord,
  toKey,
  type Coord,
  type SelectionView,
} from '@/core/axes/selection';
import { generateTuples } from '@/core/axes/tuples';
import {
  FAT_DOMAINS,
  SCORE_DOMAINS,
  SEGMENTO_DOMAINS,
  SEG_X_FAT_TUPLES,
  axis,
  domains,
  level,
  segXFat,
} from './fixtures';

/**
 * Engine de seleção — docs/07-ux-e-editor.md §5.
 *
 * Todo retângulo se prova sobre os **índices nos arrays `tuples`**: os testes
 * usam de propósito eixos cuja ordem de `position` contradiz a ordem alfabética
 * dos códigos, porque é aí que uma implementação que ordena por código passa a
 * dar respostas erradas em silêncio.
 */

function view(x: Axis, y: Axis): SelectionView {
  return { x: { axis: x }, y: { axis: y } };
}

function keys(coords: Coord[]): string[] {
  return coords.map(toKey);
}

// --- Eixos usados nos testes ------------------------------------------------

/** X de 1 nível: R1, R2, R3. */
const scoreAxis = axis('X', [level('SCORE', SCORE_DOMAINS)], ['R1', 'R2', 'R3']);

/** Y de 2 níveis com supressão assimétrica: Varejo 3, Atacado 3, Corporate 2. */
const segFatAxis = axis(
  'Y',
  [level('SEGMENTO', SEGMENTO_DOMAINS), level('FAT', FAT_DOMAINS)],
  SEG_X_FAT_TUPLES,
);

/**
 * Y de 1 nível cuja ordem de `position` é o contrário da ordem alfabética:
 * `position` manda, sempre.
 */
const reversedDomains = domains('ZULU', 'MIKE', 'ALFA');
const reversedAxis = axis('Y', [level('LETRA', reversedDomains)], ['ZULU', 'MIKE', 'ALFA']);

/** X de 3 níveis: SEGMENTO › PORTE › FAT, produto cartesiano sem regra. */
const threeLevelAxis = (() => {
  const levels = [
    level('SEGMENTO', domains('VAREJO', 'ATACADO')),
    level('PORTE', domains('PEQ', 'MED')),
    level('FAT', domains('BAIXO', 'ALTO')),
  ];
  const { tuples } = generateTuples({ levels, compatibility: [] });
  return axis('X', levels, tuples);
})();

describe('toKey / fromKey', () => {
  it('faz round-trip com caminhos aninhados', () => {
    const coord: Coord = { xPath: 'R1', yPath: 'VAREJO|100K_500K' };
    expect(toKey(coord)).toBe('R1::VAREJO|100K_500K');
    expect(fromKey(toKey(coord))).toEqual(coord);
  });
});

describe('coordIndex / coordAt', () => {
  const v = view(scoreAxis, segFatAxis);

  it('devolve a posição visual da coordenada', () => {
    expect(coordIndex(v, { xPath: 'R2', yPath: 'ATACADO|1M_10M' })).toEqual({
      xIndex: 1,
      yIndex: 4,
    });
  });

  it('devolve `null` para coordenada que não existe no grid', () => {
    expect(coordIndex(v, { xPath: 'R9', yPath: 'VAREJO|ATE_100K' })).toBeNull();
    expect(coordIndex(v, { xPath: 'R1', yPath: 'CORPORATE|ATE_100K' })).toBeNull();
  });

  it('coordAt devolve `null` fora dos limites', () => {
    expect(coordAt(v, { xIndex: 0, yIndex: 0 })).toEqual({ xPath: 'R1', yPath: 'VAREJO|ATE_100K' });
    expect(coordAt(v, { xIndex: 99, yIndex: 0 })).toBeNull();
    expect(coordAt(v, { xIndex: 0, yIndex: 99 })).toBeNull();
  });
});

describe('allCoords', () => {
  it('devolve todas as combinações em ordem de leitura (linha por linha)', () => {
    const coords = allCoords(view(scoreAxis, segFatAxis));
    expect(coords).toHaveLength(3 * 8);
    expect(coords.slice(0, 4)).toEqual([
      { xPath: 'R1', yPath: 'VAREJO|ATE_100K' },
      { xPath: 'R2', yPath: 'VAREJO|ATE_100K' },
      { xPath: 'R3', yPath: 'VAREJO|ATE_100K' },
      { xPath: 'R1', yPath: 'VAREJO|100K_500K' },
    ]);
  });
});

describe('rectBetween', () => {
  const v = view(scoreAxis, segFatAxis);

  it('retângulo normal, da âncora para frente', () => {
    const coords = rectBetween(
      v,
      { xPath: 'R1', yPath: 'VAREJO|ATE_100K' },
      { xPath: 'R2', yPath: 'VAREJO|100K_500K' },
    );
    expect(keys(coords)).toEqual([
      'R1::VAREJO|ATE_100K',
      'R2::VAREJO|ATE_100K',
      'R1::VAREJO|100K_500K',
      'R2::VAREJO|100K_500K',
    ]);
  });

  it('retângulo invertido nos dois eixos devolve exatamente o mesmo conjunto, em ordem de leitura', () => {
    const a: Coord = { xPath: 'R1', yPath: 'VAREJO|ATE_100K' };
    const b: Coord = { xPath: 'R3', yPath: 'ATACADO|500K_1M' };
    const forward = rectBetween(v, a, b);
    const backward = rectBetween(v, b, a);
    expect(keys(backward)).toEqual(keys(forward));
    // 3 colunas × 4 linhas (índices de Y 0 a 3).
    expect(forward).toHaveLength(12);
    expect(keys(forward)[0]).toBe('R1::VAREJO|ATE_100K');
  });

  it('invertido em um eixo só (X invertido, Y para frente)', () => {
    const coords = rectBetween(
      v,
      { xPath: 'R3', yPath: 'VAREJO|ATE_100K' },
      { xPath: 'R2', yPath: 'VAREJO|100K_500K' },
    );
    expect(keys(coords)).toEqual([
      'R2::VAREJO|ATE_100K',
      'R3::VAREJO|ATE_100K',
      'R2::VAREJO|100K_500K',
      'R3::VAREJO|100K_500K',
    ]);
  });

  it('é calculado sobre os índices das tuplas, não sobre a ordem alfabética dos códigos', () => {
    const v2 = view(scoreAxis, reversedAxis);
    // ZULU (índice 0) a MIKE (índice 1): alfabeticamente ALFA estaria entre os
    // dois, e uma implementação que ordena por código o incluiria.
    const coords = rectBetween(v2, { xPath: 'R1', yPath: 'ZULU' }, { xPath: 'R1', yPath: 'MIKE' });
    expect(keys(coords)).toEqual(['R1::ZULU', 'R1::MIKE']);
    expect(keys(coords)).not.toContain('R1::ALFA');
  });

  it('devolve vazio quando uma das pontas não existe no grid', () => {
    expect(rectBetween(v, { xPath: 'R9', yPath: 'VAREJO|ATE_100K' }, { xPath: 'R1', yPath: 'VAREJO|ATE_100K' })).toEqual([]);
    expect(rectBetween(v, { xPath: 'R1', yPath: 'VAREJO|ATE_100K' }, { xPath: 'R1', yPath: 'X|Y' })).toEqual([]);
  });
});

describe('stepCoord', () => {
  const v = view(scoreAxis, segFatAxis);

  it('anda na ordem visual das tuplas', () => {
    expect(stepCoord(v, { xPath: 'R1', yPath: 'VAREJO|500K_1M' }, 'DOWN')).toEqual({
      xPath: 'R1',
      yPath: 'ATACADO|500K_1M',
    });
    expect(stepCoord(v, { xPath: 'R1', yPath: 'ATACADO|500K_1M' }, 'UP')).toEqual({
      xPath: 'R1',
      yPath: 'VAREJO|500K_1M',
    });
    expect(stepCoord(v, { xPath: 'R1', yPath: 'VAREJO|ATE_100K' }, 'RIGHT')).toEqual({
      xPath: 'R2',
      yPath: 'VAREJO|ATE_100K',
    });
    expect(stepCoord(v, { xPath: 'R2', yPath: 'VAREJO|ATE_100K' }, 'LEFT')).toEqual({
      xPath: 'R1',
      yPath: 'VAREJO|ATE_100K',
    });
  });

  it('gruda nos limites do grid em vez de sair', () => {
    const topLeft: Coord = { xPath: 'R1', yPath: 'VAREJO|ATE_100K' };
    expect(stepCoord(v, topLeft, 'UP')).toEqual(topLeft);
    expect(stepCoord(v, topLeft, 'LEFT')).toEqual(topLeft);
    const bottomRight: Coord = { xPath: 'R3', yPath: 'CORPORATE|ACIMA_10M' };
    expect(stepCoord(v, bottomRight, 'DOWN')).toEqual(bottomRight);
    expect(stepCoord(v, bottomRight, 'RIGHT')).toEqual(bottomRight);
  });

  it('coordenada fora do grid volta inalterada', () => {
    const ghost: Coord = { xPath: 'R9', yPath: 'VAREJO|ATE_100K' };
    expect(stepCoord(v, ghost, 'DOWN')).toEqual(ghost);
  });

  it('eixo sem nenhuma tupla não anda (defesa: grid vazio não tem para onde ir)', () => {
    const empty: SelectionView = { x: { axis: { tuples: [] } }, y: { axis: { tuples: [] } } };
    const coord: Coord = { xPath: 'R1', yPath: 'VAREJO' };
    expect(stepCoord(empty, coord, 'DOWN')).toEqual(coord);
    expect(allCoords(empty)).toEqual([]);
  });
});

describe('expandFrom — Shift + setas', () => {
  const v = view(scoreAxis, segFatAxis);
  const anchor: Coord = { xPath: 'R2', yPath: 'VAREJO|100K_500K' };

  it('expande a partir da âncora', () => {
    const down = expandFrom(v, anchor, 'DOWN', anchor);
    expect(keys(down)).toEqual(['R2::VAREJO|100K_500K', 'R2::VAREJO|500K_1M']);
  });

  it('encolhe ao inverter a direção — não acumula', () => {
    // Duas expansões para baixo: âncora + 2 linhas.
    const step1 = expandFrom(v, anchor, 'DOWN', anchor);
    const cursor1: Coord = { xPath: 'R2', yPath: 'VAREJO|500K_1M' };
    const step2 = expandFrom(v, anchor, 'DOWN', cursor1);
    expect(step1).toHaveLength(2);
    expect(step2).toHaveLength(3);

    // Uma inversão volta ao retângulo de 2 — e não a 4.
    const cursor2: Coord = { xPath: 'R2', yPath: 'ATACADO|500K_1M' };
    const shrunk = expandFrom(v, anchor, 'UP', cursor2);
    expect(keys(shrunk)).toEqual(['R2::VAREJO|100K_500K', 'R2::VAREJO|500K_1M']);
  });

  it('atravessa a âncora e o retângulo se inverte, sem crescer para os dois lados', () => {
    const cursor: Coord = { xPath: 'R2', yPath: 'VAREJO|100K_500K' };
    const up = expandFrom(v, anchor, 'UP', cursor);
    expect(keys(up)).toEqual(['R2::VAREJO|ATE_100K', 'R2::VAREJO|100K_500K']);
  });

  it('expande na horizontal a partir da âncora', () => {
    const right = expandFrom(v, anchor, 'RIGHT', anchor);
    expect(keys(right)).toEqual(['R2::VAREJO|100K_500K', 'R3::VAREJO|100K_500K']);
  });
});

describe('coordsUnderHeader — eixo de 1 nível', () => {
  const v = view(scoreAxis, reversedAxis);

  it('cabeçalho de X pega a coluna inteira', () => {
    expect(keys(coordsUnderHeader(v, 'X', 'R2'))).toEqual(['R2::ZULU', 'R2::MIKE', 'R2::ALFA']);
  });

  it('cabeçalho de Y pega a linha inteira', () => {
    expect(keys(coordsUnderHeader(v, 'Y', 'MIKE'))).toEqual(['R1::MIKE', 'R2::MIKE', 'R3::MIKE']);
  });

  it('prefixo inexistente devolve vazio', () => {
    expect(coordsUnderHeader(v, 'X', 'R9')).toEqual([]);
  });
});

describe('coordsUnderHeader — eixo de 2 níveis com supressão assimétrica', () => {
  const v = view(scoreAxis, segFatAxis);

  it('"Varejo" (nível 0) devolve as 3 linhas inteiras — 18 células em 6 colunas', () => {
    const coords = coordsUnderHeader(v, 'Y', 'VAREJO');
    const rows = new Set(coords.map((coord) => coord.yPath));
    expect(rows.size).toBe(3);
    expect(coords).toHaveLength(3 * 3);
  });

  it('"Corporate" devolve 2 linhas — a supressão assimétrica sai de graça', () => {
    const coords = coordsUnderHeader(v, 'Y', 'CORPORATE');
    expect(new Set(coords.map((coord) => coord.yPath)).size).toBe(2);
    expect(coords).toHaveLength(2 * 3);
  });

  it('"Varejo › 100k–500k" (nível 1) devolve 1 linha só', () => {
    const coords = coordsUnderHeader(v, 'Y', 'VAREJO|100K_500K');
    expect(keys(coords)).toEqual([
      'R1::VAREJO|100K_500K',
      'R2::VAREJO|100K_500K',
      'R3::VAREJO|100K_500K',
    ]);
  });

  it('devolve em ordem de leitura, não na ordem em que os cabeçalhos foram varridos', () => {
    const coords = coordsUnderHeader(v, 'Y', 'ATACADO');
    expect(coords.map((coord) => coord.yPath)).toEqual([
      'ATACADO|500K_1M',
      'ATACADO|500K_1M',
      'ATACADO|500K_1M',
      'ATACADO|1M_10M',
      'ATACADO|1M_10M',
      'ATACADO|1M_10M',
      'ATACADO|ACIMA_10M',
      'ATACADO|ACIMA_10M',
      'ATACADO|ACIMA_10M',
    ]);
  });
});

describe('coordsUnderHeader — eixo de 3 níveis, um teste por nível', () => {
  const v = view(threeLevelAxis, reversedAxis);

  it('nível 0 pega tudo sob 1 código', () => {
    const coords = coordsUnderHeader(v, 'X', 'VAREJO');
    // 4 tuplas de X sob VAREJO × 3 tuplas de Y.
    expect(new Set(coords.map((coord) => coord.xPath)).size).toBe(4);
    expect(coords).toHaveLength(12);
  });

  it('nível 1 pega tudo sob o prefixo de 2 códigos', () => {
    const coords = coordsUnderHeader(v, 'X', 'VAREJO|MED');
    expect([...new Set(coords.map((coord) => coord.xPath))]).toEqual([
      'VAREJO|MED|BAIXO',
      'VAREJO|MED|ALTO',
    ]);
    expect(coords).toHaveLength(6);
  });

  it('nível 2 (último) pega exatamente uma tupla', () => {
    const coords = coordsUnderHeader(v, 'X', 'ATACADO|PEQ|ALTO');
    expect(new Set(coords.map((coord) => coord.xPath)).size).toBe(1);
    expect(coords).toHaveLength(3);
  });
});

describe('headerPathsAtLevel', () => {
  const v = view(scoreAxis, segFatAxis);

  it('nível 0 de Y: um caminho por segmento, na ordem visual', () => {
    expect(headerPathsAtLevel(v, 'Y', 0)).toEqual(['VAREJO', 'ATACADO', 'CORPORATE']);
  });

  it('nível 1 de Y: as 8 tuplas', () => {
    expect(headerPathsAtLevel(v, 'Y', 1)).toEqual(SEG_X_FAT_TUPLES);
  });

  it('eixo de 1 nível: os próprios códigos', () => {
    expect(headerPathsAtLevel(v, 'X', 0)).toEqual(['R1', 'R2', 'R3']);
  });
});

describe('headerRangeCoords — Shift + clique em cabeçalho', () => {
  const v = view(scoreAxis, segFatAxis);

  it('de "Varejo" a "Corporate" inclui o Atacado do meio: as 8 linhas', () => {
    const coords = headerRangeCoords(v, 'Y', 0, 'VAREJO', 'CORPORATE');
    const rows = [...new Set(coords.map((coord) => coord.yPath))];
    expect(rows).toEqual(SEG_X_FAT_TUPLES);
    expect(coords).toHaveLength(24);
  });

  it('a faixa é normalizada: de "Corporate" a "Varejo" dá o mesmo', () => {
    const forward = headerRangeCoords(v, 'Y', 0, 'VAREJO', 'CORPORATE');
    const backward = headerRangeCoords(v, 'Y', 0, 'CORPORATE', 'VAREJO');
    expect(keys(backward)).toEqual(keys(forward));
  });

  it('estende faixa do nível 1 sem pegar o resto do segmento', () => {
    const coords = headerRangeCoords(v, 'Y', 1, 'VAREJO|100K_500K', 'ATACADO|500K_1M');
    expect([...new Set(coords.map((coord) => coord.yPath))]).toEqual([
      'VAREJO|100K_500K',
      'VAREJO|500K_1M',
      'ATACADO|500K_1M',
    ]);
  });

  it('faixa de cabeçalhos de X percorre colunas', () => {
    const coords = headerRangeCoords(v, 'X', 0, 'R1', 'R2');
    expect([...new Set(coords.map((coord) => coord.xPath))]).toEqual(['R1', 'R2']);
    expect(coords).toHaveLength(16);
  });

  it('caminho desconhecido em qualquer das pontas devolve vazio', () => {
    expect(headerRangeCoords(v, 'Y', 0, 'INEXISTENTE', 'CORPORATE')).toEqual([]);
    expect(headerRangeCoords(v, 'Y', 0, 'VAREJO', 'INEXISTENTE')).toEqual([]);
  });
});

describe('isHeaderFullySelected', () => {
  const v = view(scoreAxis, segFatAxis);

  it('acende só quando **todas** as descendentes estão dentro', () => {
    const varejo = coordsUnderHeader(v, 'Y', 'VAREJO');
    const complete = new Set(keys(varejo));
    expect(isHeaderFullySelected(v, 'Y', 'VAREJO', complete)).toBe(true);

    const partial = new Set(keys(varejo).slice(0, varejo.length - 1));
    expect(isHeaderFullySelected(v, 'Y', 'VAREJO', partial)).toBe(false);
  });

  it('nível 1 aceso não acende o nível 0', () => {
    const selection = new Set(keys(coordsUnderHeader(v, 'Y', 'VAREJO|100K_500K')));
    expect(isHeaderFullySelected(v, 'Y', 'VAREJO|100K_500K', selection)).toBe(true);
    expect(isHeaderFullySelected(v, 'Y', 'VAREJO', selection)).toBe(false);
  });

  it('seleção vazia não acende nada', () => {
    expect(isHeaderFullySelected(v, 'Y', 'VAREJO', new Set())).toBe(false);
  });

  it('prefixo que não existe nunca acende, mesmo com o grid todo selecionado', () => {
    const everything = new Set(keys(allCoords(v)));
    expect(isHeaderFullySelected(v, 'Y', 'INEXISTENTE', everything)).toBe(false);
    expect(isHeaderFullySelected(v, 'X', 'R1', everything)).toBe(true);
  });
});

describe('supressão assimétrica gerada pela regra de compatibilidade', () => {
  it('as tuplas do eixo aninhado vêm de `generateTuples`, e a seleção respeita a assimetria', () => {
    const levels = [
      { ...level('SEGMENTO', SEGMENTO_DOMAINS) },
      { ...level('FAT', FAT_DOMAINS) },
    ];
    const { tuples } = generateTuples({ levels, compatibility: [segXFat()] });
    const v = view(scoreAxis, axis('Y', levels, tuples));
    expect(coordsUnderHeader(v, 'Y', 'VAREJO')).toHaveLength(9);
    expect(coordsUnderHeader(v, 'Y', 'CORPORATE')).toHaveLength(6);
  });
});
