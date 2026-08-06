import { describe, expect, it } from 'vitest';
import {
  LARGE_GRID_THRESHOLD,
  MAX_COMBINATIONS,
  assertVariablesNotOnBothAxes,
  collectPublishedCompatibility,
  generateTuples,
} from '@/core/axes/tuples';
import type { CompatibilityRule } from '@/core/document/schema';
import { DomainError } from '@/core/errors';
import {
  FAT_DOMAINS,
  SEGMENTO_DOMAINS,
  SEG_X_FAT_ALLOW,
  SEG_X_FAT_TUPLES,
  compat,
  compatVersion,
  domains,
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

const segmentoLevel = { variableId: 'SEGMENTO', domains: SEGMENTO_DOMAINS };
const fatLevel = { variableId: 'FAT', domains: FAT_DOMAINS };

describe('generateTuples — um nível', () => {
  it('devolve os domínios na ordem de `position`, não na ordem do array', () => {
    const unordered = [
      { code: 'R3', label: 'R3', position: 2 },
      { code: 'R1', label: 'R1', position: 0 },
      { code: 'R2', label: 'R2', position: 1 },
    ];
    const result = generateTuples({
      levels: [{ variableId: 'SCORE', domains: unordered }],
      compatibility: [],
    });
    expect(result.tuples).toEqual(['R1', 'R2', 'R3']);
    expect(result.warnings).toEqual([]);
    expect(result.usedRuleIds).toEqual([]);
  });
});

describe('generateTuples — dois níveis', () => {
  it('sem regra para o par, usa o produto cartesiano completo e avisa', () => {
    const result = generateTuples({ levels: [segmentoLevel, fatLevel], compatibility: [] });
    expect(result.tuples).toHaveLength(15);
    expect(result.tuples.slice(0, 6)).toEqual([
      'VAREJO|ATE_100K',
      'VAREJO|100K_500K',
      'VAREJO|500K_1M',
      'VAREJO|1M_10M',
      'VAREJO|ACIMA_10M',
      'ATACADO|ATE_100K',
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'NO_RULE_FOR_PAIR', levelIndex: 1 }),
    ]);
    expect(result.usedRuleIds).toEqual([]);
  });

  it('com o mapa do exemplo, produz exatamente as 8 tuplas esperadas na ordem esperada', () => {
    const rule = segXFat();
    const result = generateTuples({
      levels: [segmentoLevel, fatLevel],
      compatibility: [rule],
    });
    expect(result.tuples).toEqual(SEG_X_FAT_TUPLES);
    expect(result.usedRuleIds).toEqual([rule.version.id]);
    expect(result.warnings).toEqual([]);
  });

  it('ignora regras de outros pares de variáveis', () => {
    const outra = compat({
      parentVariableId: 'OUTRA',
      childVariableId: 'FAT',
      allow: { X: ['ATE_100K'] },
    });
    const result = generateTuples({
      levels: [segmentoLevel, fatLevel],
      compatibility: [outra, segXFat()],
    });
    expect(result.tuples).toEqual(SEG_X_FAT_TUPLES);
  });
});

describe('generateTuples — defaultForUnlisted', () => {
  const allowSemCorporate: Record<string, string[]> = {
    VAREJO: ['ATE_100K', '100K_500K'],
    ATACADO: ['1M_10M'],
  };

  it("'NONE': o pai ausente do mapa some do grid, com aviso PARENT_HAS_NO_CHILDREN", () => {
    const result = generateTuples({
      levels: [segmentoLevel, fatLevel],
      compatibility: [
        compat({
          parentVariableId: 'SEGMENTO',
          childVariableId: 'FAT',
          allow: allowSemCorporate,
          defaultForUnlisted: 'NONE',
        }),
      ],
    });
    expect(result.tuples).toEqual([
      'VAREJO|ATE_100K',
      'VAREJO|100K_500K',
      'ATACADO|1M_10M',
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'PARENT_HAS_NO_CHILDREN',
        path: 'CORPORATE',
        levelIndex: 1,
      }),
    ]);
  });

  it("'ALL': o pai ausente do mapa fica com todos os filhos", () => {
    const result = generateTuples({
      levels: [segmentoLevel, fatLevel],
      compatibility: [
        compat({
          parentVariableId: 'SEGMENTO',
          childVariableId: 'FAT',
          allow: allowSemCorporate,
          defaultForUnlisted: 'ALL',
        }),
      ],
    });
    expect(result.tuples).toEqual([
      'VAREJO|ATE_100K',
      'VAREJO|100K_500K',
      'ATACADO|1M_10M',
      'CORPORATE|ATE_100K',
      'CORPORATE|100K_500K',
      'CORPORATE|500K_1M',
      'CORPORATE|1M_10M',
      'CORPORATE|ACIMA_10M',
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe('generateTuples — regra citando domínio inexistente', () => {
  it('avisa e segue, sem quebrar a geração', () => {
    const result = generateTuples({
      levels: [segmentoLevel, fatLevel],
      compatibility: [
        compat({
          parentVariableId: 'SEGMENTO',
          childVariableId: 'FAT',
          allow: {
            ...SEG_X_FAT_ALLOW,
            // pai que não existe mais na versão pinada
            PRIVATE: ['1M_10M'],
            // filho que não existe mais na versão pinada
            CORPORATE: ['1M_10M', 'ACIMA_10M', 'ACIMA_100M'],
          },
          ruleCode: 'SEG_X_FATURAMENTO',
        }),
      ],
    });
    expect(result.tuples).toEqual(SEG_X_FAT_TUPLES);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'RULE_REFERENCES_UNKNOWN_DOMAIN',
        levelIndex: 1,
        // ordem de `Object.entries(allow)`: CORPORATE mantém a posição do
        // espalhamento, PRIVATE entra no fim.
        codes: ['ACIMA_100M', 'PRIVATE'],
      }),
    ]);
  });
});

describe('generateTuples — três níveis', () => {
  const porteDomains = domains('PEQUENO', 'MEDIO', 'GRANDE');

  it('encadeia duas regras entre níveis adjacentes', () => {
    const segXPorte = compat({
      parentVariableId: 'SEGMENTO',
      childVariableId: 'PORTE',
      allow: { VAREJO: ['PEQUENO', 'MEDIO'], ATACADO: ['GRANDE'], CORPORATE: ['GRANDE'] },
    });
    const porteXFat = compat({
      parentVariableId: 'PORTE',
      childVariableId: 'FAT',
      allow: {
        PEQUENO: ['ATE_100K'],
        MEDIO: ['100K_500K', '500K_1M'],
        GRANDE: ['1M_10M', 'ACIMA_10M'],
      },
    });
    const result = generateTuples({
      levels: [segmentoLevel, { variableId: 'PORTE', domains: porteDomains }, fatLevel],
      compatibility: [segXPorte, porteXFat],
    });
    expect(result.tuples).toEqual([
      'VAREJO|PEQUENO|ATE_100K',
      'VAREJO|MEDIO|100K_500K',
      'VAREJO|MEDIO|500K_1M',
      'ATACADO|GRANDE|1M_10M',
      'ATACADO|GRANDE|ACIMA_10M',
      'CORPORATE|GRANDE|1M_10M',
      'CORPORATE|GRANDE|ACIMA_10M',
    ]);
    expect(result.usedRuleIds).toEqual([segXPorte.version.id, porteXFat.version.id]);
  });

  it('não aplica regra entre níveis não adjacentes (limitação consciente de §5.4)', () => {
    const segXFatRule = segXFat();
    const result = generateTuples({
      levels: [segmentoLevel, { variableId: 'PORTE', domains: porteDomains }, fatLevel],
      compatibility: [segXFatRule],
    });
    // 3 segmentos × 3 portes × 5 faixas: a regra SEGMENTO→FAT nunca é consultada.
    expect(result.tuples).toHaveLength(45);
    expect(result.usedRuleIds).toEqual([]);
    expect(result.warnings.filter((w) => w.code === 'NO_RULE_FOR_PAIR')).toHaveLength(2);
  });
});

describe('generateTuples — supressão manual', () => {
  it('remove a tupla existente e avisa sobre a que não existe', () => {
    const result = generateTuples({
      levels: [segmentoLevel, fatLevel],
      compatibility: [segXFat()],
      manualSuppressions: ['ATACADO|500K_1M', 'VAREJO|ACIMA_10M'],
    });
    expect(result.tuples).toEqual(SEG_X_FAT_TUPLES.filter((t) => t !== 'ATACADO|500K_1M'));
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'SUPPRESSION_NOT_APPLICABLE', path: 'VAREJO|ACIMA_10M' }),
    ]);
  });
});

describe('generateTuples — erros', () => {
  it('NO_VALID_TUPLES quando o mapa zera todos os pais', () => {
    expectDomainError(
      () =>
        generateTuples({
          levels: [segmentoLevel, fatLevel],
          compatibility: [
            compat({
              parentVariableId: 'SEGMENTO',
              childVariableId: 'FAT',
              allow: {},
              defaultForUnlisted: 'NONE',
            }),
          ],
        }),
      'NO_VALID_TUPLES',
    );
  });

  it('NO_VALID_TUPLES quando a supressão manual remove tudo', () => {
    expectDomainError(
      () =>
        generateTuples({
          levels: [{ variableId: 'SCORE', domains: domains('R1', 'R2') }],
          compatibility: [],
          manualSuppressions: ['R1', 'R2'],
        }),
      'NO_VALID_TUPLES',
    );
  });

  it('AXIS_NEEDS_ONE_LEVEL sem nenhum nível', () => {
    expectDomainError(() => generateTuples({ levels: [], compatibility: [] }), 'AXIS_NEEDS_ONE_LEVEL');
  });

  it('TOO_MANY_LEVELS acima de 3 níveis', () => {
    expectDomainError(
      () =>
        generateTuples({
          levels: [
            { variableId: 'A', domains: domains('A1') },
            { variableId: 'B', domains: domains('B1') },
            { variableId: 'C', domains: domains('C1') },
            { variableId: 'D', domains: domains('D1') },
          ],
          compatibility: [],
        }),
      'TOO_MANY_LEVELS',
    );
  });

  it('DUPLICATE_VARIABLE_IN_AXIS com a mesma variável em dois níveis', () => {
    expectDomainError(
      () =>
        generateTuples({
          levels: [segmentoLevel, { variableId: 'SEGMENTO', domains: SEGMENTO_DOMAINS }],
          compatibility: [],
        }),
      'DUPLICATE_VARIABLE_IN_AXIS',
    );
  });

  it('INVALID_INPUT com nível sem domínios', () => {
    expectDomainError(
      () => generateTuples({ levels: [{ variableId: 'VAZIA', domains: [] }], compatibility: [] }),
      'INVALID_INPUT',
    );
  });

  it('VARIABLE_ON_BOTH_AXES quando a mesma variável está em X e em Y', () => {
    expect(() => assertVariablesNotOnBothAxes([segmentoLevel], [fatLevel])).not.toThrow();
    expectDomainError(
      () => assertVariablesNotOnBothAxes([segmentoLevel, fatLevel], [fatLevel]),
      'VARIABLE_ON_BOTH_AXES',
    );
  });
});

describe('generateTuples — teto de combinações', () => {
  it(`aceita exatamente ${MAX_COMBINATIONS} combinações num nível`, () => {
    const result = generateTuples({
      levels: [{ variableId: 'GRANDE', domains: manyDomains(MAX_COMBINATIONS) }],
      compatibility: [],
    });
    expect(result.tuples).toHaveLength(MAX_COMBINATIONS);
  });

  it(`GRID_TOO_LARGE em ${MAX_COMBINATIONS + 1} combinações num nível`, () => {
    const error = expectDomainError(
      () =>
        generateTuples({
          levels: [{ variableId: 'GRANDE', domains: manyDomains(MAX_COMBINATIONS + 1) }],
          compatibility: [],
        }),
      'GRID_TOO_LARGE',
    );
    expect(error.details).toEqual({ combinations: MAX_COMBINATIONS + 1, max: MAX_COMBINATIONS });
  });

  it('GRID_TOO_LARGE quando o estouro acontece ao expandir o segundo nível', () => {
    expectDomainError(
      () =>
        generateTuples({
          levels: [
            { variableId: 'A', domains: manyDomains(3) },
            { variableId: 'B', domains: manyDomains(2001) },
          ],
          compatibility: [],
        }),
      'GRID_TOO_LARGE',
    );
  });

  it(`avisa LARGE_GRID acima de ${LARGE_GRID_THRESHOLD} e não avisa no limite`, () => {
    const noWarning = generateTuples({
      levels: [{ variableId: 'A', domains: manyDomains(LARGE_GRID_THRESHOLD) }],
      compatibility: [],
    });
    expect(noWarning.warnings).toEqual([]);

    const warned = generateTuples({
      levels: [{ variableId: 'A', domains: manyDomains(LARGE_GRID_THRESHOLD + 1) }],
      compatibility: [],
    });
    expect(warned.warnings).toEqual([
      expect.objectContaining({ code: 'LARGE_GRID', count: LARGE_GRID_THRESHOLD + 1 }),
    ]);
  });
});

describe('collectPublishedCompatibility', () => {
  const baseRule = (overrides: Partial<CompatibilityRule>): CompatibilityRule => ({
    id: 'rule-1',
    code: 'SEG_X_FATURAMENTO',
    name: 'Segmento × Faturamento',
    parentVariableId: 'SEGMENTO',
    childVariableId: 'FAT',
    createdAt: '2026-01-01T00:00:00.000Z',
    versions: [compatVersion(SEG_X_FAT_ALLOW)],
    ...overrides,
  });

  it('devolve a versão publicada de cada regra não arquivada', () => {
    const rule = baseRule({});
    expect(collectPublishedCompatibility([rule])).toEqual([
      {
        ruleId: 'rule-1',
        ruleCode: 'SEG_X_FATURAMENTO',
        parentVariableId: 'SEGMENTO',
        childVariableId: 'FAT',
        version: rule.versions[0],
      },
    ]);
  });

  it('ignora regra arquivada e regra sem versão publicada', () => {
    const arquivada = baseRule({ archivedAt: '2026-02-01T00:00:00.000Z' });
    const semPublicada = baseRule({
      versions: [{ ...compatVersion(SEG_X_FAT_ALLOW), state: 'DRAFT' }],
    });
    expect(collectPublishedCompatibility([arquivada, semPublicada])).toEqual([]);
  });
});
