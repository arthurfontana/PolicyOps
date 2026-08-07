import { describe, expect, it } from 'vitest';
import { matchesPathMatcher } from '@/core/templates/matcher';

describe('matchesPathMatcher (docs/05 §8)', () => {
  it('undefined casa qualquer caminho — when vazio atinge tudo', () => {
    expect(matchesPathMatcher(undefined, 'VAREJO|ATE_100K')).toBe(true);
    expect(matchesPathMatcher(undefined, 'R1')).toBe(true);
  });

  it('null em cada posição casa qualquer código naquela posição', () => {
    expect(matchesPathMatcher([null], 'R1')).toBe(true);
    expect(matchesPathMatcher([null], 'R6')).toBe(true);
    expect(matchesPathMatcher(['VAREJO', null], 'VAREJO|ATE_100K')).toBe(true);
    expect(matchesPathMatcher(['VAREJO', null], 'VAREJO|500K_1M')).toBe(true);
    expect(matchesPathMatcher([null, 'ATE_100K'], 'VAREJO|ATE_100K')).toBe(true);
    expect(matchesPathMatcher([null, 'ATE_100K'], 'ATACADO|ATE_100K')).toBe(true);
    expect(matchesPathMatcher([null, 'ATE_100K'], 'VAREJO|500K_1M')).toBe(false);
  });

  it('matcher mais curto que o caminho casa por prefixo, em eixo de 2 níveis', () => {
    expect(matchesPathMatcher(['VAREJO'], 'VAREJO|ATE_100K')).toBe(true);
    expect(matchesPathMatcher(['VAREJO'], 'VAREJO|500K_1M')).toBe(true);
    expect(matchesPathMatcher(['VAREJO'], 'ATACADO|500K_1M')).toBe(false);
  });

  it('rejeita quando um código explícito não bate', () => {
    expect(matchesPathMatcher(['ATACADO', 'ACIMA_10M'], 'VAREJO|ATE_100K')).toBe(false);
    expect(matchesPathMatcher(['ATACADO', 'ACIMA_10M'], 'ATACADO|1M_10M')).toBe(false);
    expect(matchesPathMatcher(['ATACADO', 'ACIMA_10M'], 'ATACADO|ACIMA_10M')).toBe(true);
  });

  it('exige todos os códigos explícitos quando o matcher tem a profundidade inteira', () => {
    expect(matchesPathMatcher(['R3'], 'R3')).toBe(true);
    expect(matchesPathMatcher(['R3'], 'R4')).toBe(false);
  });
});
