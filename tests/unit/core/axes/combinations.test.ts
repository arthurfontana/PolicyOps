import { describe, expect, it } from 'vitest';
import {
  allCombinations,
  coordsForHeader,
  countPending,
  listPending,
  tuplesUnder,
} from '@/core/axes/combinations';
import { generateTuples } from '@/core/axes/tuples';
import {
  FAT_DOMAINS,
  SEGMENTO_DOMAINS,
  SEG_X_FAT_TUPLES,
  axis,
  domains,
  level,
  makeVersion,
  segXFat,
} from './fixtures';

const scoreLevels = [level('SCORE', domains('R1', 'R2'))];
const nestedLevels = [level('SEGMENTO', SEGMENTO_DOMAINS), level('FAT', FAT_DOMAINS)];

function nestedVersion(cells: Record<string, { decision?: string }> = {}) {
  const { tuples } = generateTuples({ levels: nestedLevels, compatibility: [segXFat()] });
  return makeVersion({
    x: axis('X', scoreLevels, ['R1', 'R2']),
    y: axis('Y', nestedLevels, tuples),
    cells,
  });
}

describe('allCombinations', () => {
  it('percorre o grid em ordem de leitura: uma linha de Y por vez', () => {
    const version = nestedVersion();
    const combinations = allCombinations(version);
    expect(combinations).toHaveLength(16);
    expect(combinations.slice(0, 4)).toEqual([
      { xPath: 'R1', yPath: 'VAREJO|ATE_100K', key: 'R1::VAREJO|ATE_100K' },
      { xPath: 'R2', yPath: 'VAREJO|ATE_100K', key: 'R2::VAREJO|ATE_100K' },
      { xPath: 'R1', yPath: 'VAREJO|100K_500K', key: 'R1::VAREJO|100K_500K' },
      { xPath: 'R2', yPath: 'VAREJO|100K_500K', key: 'R2::VAREJO|100K_500K' },
    ]);
  });

  it('não materializa as combinações suprimidas', () => {
    const { tuples } = generateTuples({
      levels: nestedLevels,
      compatibility: [segXFat()],
      manualSuppressions: ['ATACADO|500K_1M'],
    });
    const version = makeVersion({
      x: axis('X', scoreLevels, ['R1', 'R2']),
      y: axis('Y', nestedLevels, tuples, ['ATACADO|500K_1M']),
    });
    expect(allCombinations(version)).toHaveLength(14);
    expect(allCombinations(version).some((c) => c.yPath === 'ATACADO|500K_1M')).toBe(false);
    // Suprimida não é pendente — foi por isso que a supressão existe (§6).
    expect(countPending(version)).toBe(14);
  });
});

describe('countPending / listPending', () => {
  it('conta como pendente toda combinação sem `decision`', () => {
    const version = nestedVersion({
      'R1::VAREJO|ATE_100K': { decision: 'APROVADO' },
      // célula existente, mas sem decisão: continua pendente
      'R2::VAREJO|ATE_100K': { note: 'em estudo' },
    });
    expect(countPending(version)).toBe(15);
  });

  it('lista as pendências em ordem de leitura e respeita o limite', () => {
    const version = nestedVersion({ 'R1::VAREJO|ATE_100K': { decision: 'APROVADO' } });
    const all = listPending(version);
    expect(all).toHaveLength(15);
    expect(all[0]).toEqual({
      xPath: 'R2',
      yPath: 'VAREJO|ATE_100K',
      key: 'R2::VAREJO|ATE_100K',
    });
    expect(listPending(version, 3)).toEqual(all.slice(0, 3));
    expect(listPending(version, 0)).toEqual([]);
  });
});

describe('tuplesUnder', () => {
  const nested = axis('Y', nestedLevels, SEG_X_FAT_TUPLES);

  it('clicar em "Varejo" pega as 3 linhas do Varejo', () => {
    expect(tuplesUnder(nested, 'VAREJO')).toEqual([
      'VAREJO|ATE_100K',
      'VAREJO|100K_500K',
      'VAREJO|500K_1M',
    ]);
    expect(tuplesUnder(nested, 'CORPORATE')).toHaveLength(2);
  });

  it('clicar num cabeçalho de último nível pega 1 linha', () => {
    expect(tuplesUnder(nested, 'VAREJO|100K_500K')).toEqual(['VAREJO|100K_500K']);
  });

  it('prefixo sem tuplas devolve lista vazia', () => {
    expect(tuplesUnder(nested, 'PRIVATE')).toEqual([]);
  });
});

describe('coordsForHeader', () => {
  it('cabeçalho do eixo Y devolve as células das linhas cobertas', () => {
    const version = nestedVersion();
    expect(coordsForHeader(version, 'Y', 'VAREJO')).toEqual([
      { xPath: 'R1', yPath: 'VAREJO|ATE_100K' },
      { xPath: 'R2', yPath: 'VAREJO|ATE_100K' },
      { xPath: 'R1', yPath: 'VAREJO|100K_500K' },
      { xPath: 'R2', yPath: 'VAREJO|100K_500K' },
      { xPath: 'R1', yPath: 'VAREJO|500K_1M' },
      { xPath: 'R2', yPath: 'VAREJO|500K_1M' },
    ]);
  });

  it('cabeçalho do eixo X devolve as células da coluna', () => {
    const version = nestedVersion();
    const coords = coordsForHeader(version, 'X', 'R2');
    expect(coords).toHaveLength(8);
    expect(coords.every((coord) => coord.xPath === 'R2')).toBe(true);
    expect(coords.map((coord) => coord.yPath)).toEqual(SEG_X_FAT_TUPLES);
  });
});
