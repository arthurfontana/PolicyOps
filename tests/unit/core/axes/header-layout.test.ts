import { describe, expect, it } from 'vitest';
import { computeHeaderLayout } from '@/core/axes/header-layout';
import { generateTuples } from '@/core/axes/tuples';
import {
  FAT_DOMAINS,
  SEGMENTO_DOMAINS,
  SEG_X_FAT_TUPLES,
  axis,
  domains,
  level,
  richDomains,
  segXFat,
} from './fixtures';

describe('computeHeaderLayout — um nível', () => {
  it('produz uma linha com todos os cabeçalhos de span 1', () => {
    const scoreDomains = richDomains('R1', 'R2', 'R3');
    const rows = computeHeaderLayout(
      axis('X', [level('SCORE', scoreDomains)], ['R1', 'R2', 'R3']),
    );
    expect(rows).toEqual([
      {
        level: 0,
        cells: [
          { code: 'R1', label: 'Rótulo R1', shortLabel: 'R1', color: '#123456', path: 'R1', span: 1, startIndex: 0 },
          { code: 'R2', label: 'Rótulo R2', shortLabel: 'R2', color: '#123456', path: 'R2', span: 1, startIndex: 1 },
          { code: 'R3', label: 'Rótulo R3', shortLabel: 'R3', color: '#123456', path: 'R3', span: 1, startIndex: 2 },
        ],
      },
    ]);
  });

  it('omite `shortLabel` e `color` quando o domínio não os tem', () => {
    const rows = computeHeaderLayout(axis('X', [level('SCORE', domains('R1'))], ['R1']));
    expect(rows[0]!.cells[0]).toEqual({
      code: 'R1',
      label: 'Rótulo R1',
      path: 'R1',
      span: 1,
      startIndex: 0,
    });
  });

  it('eixo com uma tupla só', () => {
    const rows = computeHeaderLayout(axis('Y', [level('SCORE', domains('R1', 'R2'))], ['R2']));
    expect(rows).toEqual([
      {
        level: 0,
        cells: [{ code: 'R2', label: 'Rótulo R2', path: 'R2', span: 1, startIndex: 0 }],
      },
    ]);
  });

  it('usa o próprio código como rótulo quando o domínio sumiu do snapshot', () => {
    const rows = computeHeaderLayout(axis('X', [level('SCORE', domains('R1'))], ['R9']));
    expect(rows[0]!.cells[0]).toEqual({
      code: 'R9',
      label: 'R9',
      path: 'R9',
      span: 1,
      startIndex: 0,
    });
  });
});

describe('computeHeaderLayout — dois níveis', () => {
  it('dois níveis simétricos: spans iguais ao número de filhos', () => {
    const levels = [level('SEGMENTO', SEGMENTO_DOMAINS), level('FAT', FAT_DOMAINS)];
    const { tuples } = generateTuples({ levels, compatibility: [] });
    const rows = computeHeaderLayout(axis('Y', levels, tuples));

    expect(rows).toHaveLength(2);
    expect(rows[0]!.cells.map((cell) => [cell.code, cell.span, cell.startIndex])).toEqual([
      ['VAREJO', 5, 0],
      ['ATACADO', 5, 5],
      ['CORPORATE', 5, 10],
    ]);
    expect(rows[1]!.cells).toHaveLength(15);
    expect(rows[1]!.cells.every((cell) => cell.span === 1)).toBe(true);
  });

  it('supressão assimétrica: Varejo 3, Atacado 3, Corporate 2', () => {
    const levels = [level('SEGMENTO', SEGMENTO_DOMAINS), level('FAT', FAT_DOMAINS)];
    const { tuples } = generateTuples({ levels, compatibility: [segXFat()] });
    expect(tuples).toEqual(SEG_X_FAT_TUPLES);

    const rows = computeHeaderLayout(axis('Y', levels, tuples));
    expect(rows[0]!.cells).toEqual([
      { code: 'VAREJO', label: 'Rótulo VAREJO', path: 'VAREJO', span: 3, startIndex: 0 },
      { code: 'ATACADO', label: 'Rótulo ATACADO', path: 'ATACADO', span: 3, startIndex: 3 },
      { code: 'CORPORATE', label: 'Rótulo CORPORATE', path: 'CORPORATE', span: 2, startIndex: 6 },
    ]);
    expect(rows[1]!.cells.map((cell) => [cell.path, cell.startIndex])).toEqual(
      SEG_X_FAT_TUPLES.map((tuple, index) => [tuple, index]),
    );
    expect(rows[1]!.cells.every((cell) => cell.span === 1)).toBe(true);
  });

  it('agrupa apenas tuplas consecutivas — o mesmo código repetido depois abre outro cabeçalho', () => {
    const levels = [level('SEGMENTO', SEGMENTO_DOMAINS), level('FAT', FAT_DOMAINS)];
    // Snapshot fora da ordem canônica: VAREJO aparece em dois blocos separados.
    const rows = computeHeaderLayout(
      axis('Y', levels, ['VAREJO|ATE_100K', 'ATACADO|1M_10M', 'VAREJO|500K_1M']),
    );
    expect(rows[0]!.cells.map((cell) => [cell.code, cell.span, cell.startIndex])).toEqual([
      ['VAREJO', 1, 0],
      ['ATACADO', 1, 1],
      ['VAREJO', 1, 2],
    ]);
  });
});

describe('computeHeaderLayout — três níveis', () => {
  it('cada nível soma exatamente o número de tuplas', () => {
    const porteDomains = domains('PEQUENO', 'GRANDE');
    const levels = [
      level('SEGMENTO', SEGMENTO_DOMAINS),
      level('PORTE', porteDomains),
      level('FAT', FAT_DOMAINS),
    ];
    const { tuples } = generateTuples({
      levels,
      compatibility: [segXFat()],
      manualSuppressions: [],
    });
    const rows = computeHeaderLayout(axis('Y', levels, tuples));

    expect(rows).toHaveLength(3);
    // SEGMENTO→PORTE não tem regra (produto completo); PORTE→FAT também não.
    expect(rows[0]!.cells.map((cell) => [cell.code, cell.span])).toEqual([
      ['VAREJO', 10],
      ['ATACADO', 10],
      ['CORPORATE', 10],
    ]);
    expect(rows[1]!.cells).toHaveLength(6);
    expect(rows[1]!.cells.map((cell) => cell.span)).toEqual([5, 5, 5, 5, 5, 5]);
    expect(rows[1]!.cells[1]).toEqual({
      code: 'GRANDE',
      label: 'Rótulo GRANDE',
      path: 'VAREJO|GRANDE',
      span: 5,
      startIndex: 5,
    });
    expect(rows[2]!.cells).toHaveLength(30);
  });

  it('supressão assimétrica no terceiro nível', () => {
    const levels = [
      level('SEGMENTO', SEGMENTO_DOMAINS),
      level('FAT', FAT_DOMAINS),
      level('RESTRITIVO', domains('SEM', 'ALTO')),
    ];
    const rows = computeHeaderLayout(
      axis('Y', levels, [
        'VAREJO|ATE_100K|SEM',
        'VAREJO|ATE_100K|ALTO',
        'VAREJO|500K_1M|SEM',
        'ATACADO|1M_10M|ALTO',
      ]),
    );
    expect(rows[0]!.cells.map((cell) => [cell.path, cell.span, cell.startIndex])).toEqual([
      ['VAREJO', 3, 0],
      ['ATACADO', 1, 3],
    ]);
    expect(rows[1]!.cells.map((cell) => [cell.path, cell.span, cell.startIndex])).toEqual([
      ['VAREJO|ATE_100K', 2, 0],
      ['VAREJO|500K_1M', 1, 2],
      ['ATACADO|1M_10M', 1, 3],
    ]);
    expect(rows[2]!.cells.every((cell) => cell.span === 1)).toBe(true);
  });
});
