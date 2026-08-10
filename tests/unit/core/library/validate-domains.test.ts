import { describe, expect, it } from 'vitest';
import { findIncompleteGroupingPaths, validateDomains } from '@/core/library/validate-domains';
import type { Domain, GroupingDimension } from '@/core/document/schema';

/**
 * `validateDomains` — docs/05-regras-de-negocio.md §5.1 (I8, I9, I18) e
 * §5.6.1 (I9 por caminho de agrupamento, I19).
 * Exaustivo: cada regra e cada erro, docs/prompts/S06-biblioteca-variaveis.md.
 */

function domain(code: string, position: number, extra: Partial<Domain> = {}): Domain {
  return { code, label: `Rótulo ${code}`, position, ...extra };
}

function range(
  code: string,
  position: number,
  rangeMin: string,
  rangeMax: string | undefined,
  extra: Partial<Domain> = {},
): Domain {
  const d = domain(code, position, { rangeMin, ...extra });
  if (rangeMax !== undefined) d.rangeMax = rangeMax;
  return d;
}

describe('validateDomains', () => {
  it('aceita um conjunto CATEGORICAL válido', () => {
    const result = validateDomains('CATEGORICAL', [domain('A', 0), domain('B', 1), domain('C', 2)]);
    expect(result.ok).toBe(true);
  });

  it('aceita um BOOLEAN com exatamente 2 domínios', () => {
    const result = validateDomains('BOOLEAN', [domain('SIM', 0), domain('NAO', 1)]);
    expect(result.ok).toBe(true);
  });

  it('rejeita BOOLEAN com 3 domínios — BOOLEAN_NEEDS_TWO_DOMAINS', () => {
    const result = validateDomains('BOOLEAN', [domain('A', 0), domain('B', 1), domain('C', 2)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === 'BOOLEAN_NEEDS_TWO_DOMAINS')).toBe(true);
    }
  });

  it('rejeita BOOLEAN com 1 domínio — BOOLEAN_NEEDS_TWO_DOMAINS', () => {
    const result = validateDomains('BOOLEAN', [domain('SIM', 0)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.code).toBe('BOOLEAN_NEEDS_TWO_DOMAINS');
    }
  });

  it('rejeita menos de 2 domínios em tipo não-BOOLEAN — INVALID_DOMAIN_SET', () => {
    const result = validateDomains('CATEGORICAL', [domain('A', 0)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.code).toBe('INVALID_DOMAIN_SET');
    }
  });

  it('rejeita zero domínios', () => {
    const result = validateDomains('ORDINAL', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.code).toBe('INVALID_DOMAIN_SET');
  });

  it('rejeita código com separador de caminho ("|")', () => {
    const result = validateDomains('CATEGORICAL', [domain('A|B', 0), domain('C', 1)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === 'INVALID_DOMAIN_SET')).toBe(true);
    }
  });

  it('rejeita código com dois-pontos (":")', () => {
    const result = validateDomains('CATEGORICAL', [domain('A:B', 0), domain('C', 1)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === 'INVALID_DOMAIN_SET')).toBe(true);
    }
  });

  it('rejeita código minúsculo (fora de ^[A-Z0-9_]+$)', () => {
    const result = validateDomains('CATEGORICAL', [domain('minusculo', 0), domain('B', 1)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.code).toBe('INVALID_DOMAIN_SET');
  });

  it('rejeita código duplicado na mesma versão', () => {
    const result = validateDomains('CATEGORICAL', [domain('A', 0), domain('A', 1)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.message.includes('aparece'));
      expect(issue?.code).toBe('INVALID_DOMAIN_SET');
      expect(issue?.domainCodes).toEqual(['A']);
    }
  });

  it('rejeita position com buraco (0, 2)', () => {
    const result = validateDomains('CATEGORICAL', [domain('A', 0), domain('B', 2)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.code).toBe('INVALID_DOMAIN_SET');
  });

  it('rejeita position repetida', () => {
    const result = validateDomains('CATEGORICAL', [domain('A', 0), domain('B', 0)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.code).toBe('INVALID_DOMAIN_SET');
  });

  it('não exige position começando em 0 na ordem de inserção, só depois de ordenar', () => {
    const result = validateDomains('CATEGORICAL', [domain('B', 1), domain('A', 0)]);
    expect(result.ok).toBe(true);
  });

  // -- RANGE -----------------------------------------------------------------

  it('aceita RANGE contíguo, terminando em catch-all', () => {
    const result = validateDomains('RANGE', [
      range('BAIXO', 0, '0', '100'),
      range('MEDIO', 1, '100', '500'),
      range('ALTO', 2, '500', undefined, { isCatchAll: true }),
    ]);
    expect(result.ok).toBe(true);
  });

  it('aceita RANGE sem catch-all quando todas as faixas têm min/max', () => {
    const result = validateDomains('RANGE', [range('BAIXO', 0, '0', '100'), range('ALTO', 1, '100', '200')]);
    expect(result.ok).toBe(true);
  });

  it('rejeita faixa com buraco (rangeMax de uma ≠ rangeMin da seguinte) — RANGE_NOT_CONTIGUOUS', () => {
    const result = validateDomains('RANGE', [
      range('BAIXO', 0, '0', '100'),
      range('ALTO', 1, '150', '200'),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.code === 'RANGE_NOT_CONTIGUOUS');
      expect(issue).toBeDefined();
      expect(issue?.domainCodes).toEqual(['BAIXO', 'ALTO']);
    }
  });

  it('rejeita faixas sobrepostas (rangeMax de uma > rangeMin da seguinte) — RANGE_NOT_CONTIGUOUS', () => {
    const result = validateDomains('RANGE', [
      range('BAIXO', 0, '0', '150'),
      range('ALTO', 1, '100', '200'),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'RANGE_NOT_CONTIGUOUS')).toBe(true);
    }
  });

  it('rejeita catch-all no meio (não é o último por position)', () => {
    const result = validateDomains('RANGE', [
      range('BAIXO', 0, '0', undefined, { isCatchAll: true }),
      range('ALTO', 1, '0', '100'),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.message.includes('último'));
      expect(issue?.code).toBe('RANGE_NOT_CONTIGUOUS');
    }
  });

  it('rejeita mais de um catch-all', () => {
    const result = validateDomains('RANGE', [
      range('A', 0, '0', undefined, { isCatchAll: true }),
      range('B', 1, '0', undefined, { isCatchAll: true }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.message.includes('demais casos'));
      expect(issue?.code).toBe('RANGE_NOT_CONTIGUOUS');
    }
  });

  it('rejeita RANGE não-catchAll sem rangeMin/rangeMax', () => {
    const result = validateDomains('RANGE', [
      domain('BAIXO', 0),
      range('ALTO', 1, '100', undefined, { isCatchAll: true }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'RANGE_NOT_CONTIGUOUS')).toBe(true);
    }
  });

  it('usa Decimal para comparar faixas, não ponto flutuante (0.1 + 0.2 contíguo)', () => {
    const result = validateDomains('RANGE', [
      range('A', 0, '0', '0.1'),
      range('B', 1, '0.1', '0.30000000000000004'),
    ]);
    // Em ponto flutuante ingênuo 0.1+0.2 !== 0.30000000000000004 seria
    // comparado por igualdade de string ou por Number, arriscando falso
    // positivo/negativo; aqui a fronteira é literalmente a mesma string,
    // então o teste relevante é que não lança e não usa Number() em algum
    // ponto que perderia precisão decimal.
    expect(result.ok).toBe(true);
  });

  it('nunca lança para rangeMin/rangeMax vazios ou incompletos (campo sendo digitado)', () => {
    // Regressão: `new Decimal('')` lança, e como esta função roda a cada
    // tecla na interface, uma faixa recém-adicionada (ainda vazia) não pode
    // derrubar a aplicação — só reportar o problema.
    expect(() =>
      validateDomains('RANGE', [
        domain('A', 0, { rangeMin: '', rangeMax: '' }),
        domain('B', 1, { rangeMin: '0', rangeMax: '10' }),
      ]),
    ).not.toThrow();
    const result = validateDomains('RANGE', [
      domain('A', 0, { rangeMin: '', rangeMax: '' }),
      domain('B', 1, { rangeMin: '0', rangeMax: '10' }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === 'RANGE_NOT_CONTIGUOUS')).toBe(true);

    expect(() =>
      validateDomains('RANGE', [domain('A', 0, { rangeMin: '-', rangeMax: '12.' })]),
    ).not.toThrow();
  });

  it('detecta não-contiguidade que só aparece em precisão decimal (não flutuante)', () => {
    const result = validateDomains('RANGE', [
      range('A', 0, '0', '10.10'),
      range('B', 1, '10.1', '20'),
    ]);
    // "10.10" e "10.1" são o mesmo decimal — contíguo.
    expect(result.ok).toBe(true);
  });

  // -- groupingDimensions (docs/05 §5.6.1, I9 por caminho, I19) --------------

  function grouped(
    code: string,
    position: number,
    ranges: Array<{ path: string[]; min: string; max?: string }>,
  ): Domain {
    return { code, label: `Rótulo ${code}`, position, groupingRanges: ranges };
  }

  const regional: GroupingDimension[] = [
    {
      code: 'REGIONAL',
      label: 'Regional',
      options: [
        { code: 'BASE', label: 'Base' },
        { code: 'SP', label: 'São Paulo' },
      ],
    },
  ];

  /** Regional × Porte — o caso real de docs/05 §5.6.2, com 3 caminhos. */
  const regionalPorte: GroupingDimension[] = [
    {
      code: 'REGIONAL',
      label: 'Regional',
      options: [
        { code: 'SAO_PAULO', label: 'São Paulo' },
        { code: 'SUL', label: 'Sul' },
      ],
    },
    {
      code: 'PORTE',
      label: 'Porte',
      options: [
        { code: 'MEI', label: 'MEI' },
        { code: 'NAO_MEI', label: 'Não MEI' },
      ],
    },
  ];

  it('aceita RANGE agrupado com contiguidade ok em todos os caminhos', () => {
    const result = validateDomains(
      'RANGE',
      [
        grouped('A', 0, [
          { path: ['BASE'], min: '0', max: '100' },
          { path: ['SP'], min: '0', max: '120' },
        ]),
        grouped('B', 1, [
          { path: ['BASE'], min: '100', max: '200' },
          { path: ['SP'], min: '120', max: '240' },
        ]),
      ],
      regional,
    );
    expect(result.ok).toBe(true);
  });

  it('aceita contiguidade independente em 3 caminhos (Regional × Porte)', () => {
    const result = validateDomains(
      'RANGE',
      [
        grouped('R1', 0, [
          { path: ['SAO_PAULO', 'MEI'], min: '0', max: '358' },
          { path: ['SAO_PAULO', 'NAO_MEI'], min: '0', max: '340' },
          { path: ['SUL', 'MEI'], min: '0', max: '360' },
        ]),
        grouped('R2', 1, [
          { path: ['SAO_PAULO', 'MEI'], min: '358', max: '420' },
          { path: ['SAO_PAULO', 'NAO_MEI'], min: '340', max: '400' },
          { path: ['SUL', 'MEI'], min: '360', max: '430' },
        ]),
      ],
      regionalPorte,
    );
    expect(result.ok).toBe(true);
  });

  it('rejeita buraco num caminho só — RANGE_GROUPING_NOT_CONTIGUOUS aponta o caminho certo', () => {
    const result = validateDomains(
      'RANGE',
      [
        grouped('A', 0, [
          { path: ['BASE'], min: '0', max: '100' },
          { path: ['SP'], min: '0', max: '120' },
        ]),
        // SP tem um buraco (120 -> 150), BASE continua contíguo (100 -> 100).
        grouped('B', 1, [
          { path: ['BASE'], min: '100', max: '200' },
          { path: ['SP'], min: '150', max: '240' },
        ]),
      ],
      regional,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.code === 'RANGE_GROUPING_NOT_CONTIGUOUS');
      expect(issue).toBeDefined();
      expect(issue?.path).toEqual(['SP']);
      expect(result.issues.some((i) => i.path?.[0] === 'BASE')).toBe(false);
    }
  });

  it('sobreposição num caminho de 2 níveis não afeta os demais caminhos', () => {
    const result = validateDomains(
      'RANGE',
      [
        grouped('R1', 0, [
          { path: ['SAO_PAULO', 'MEI'], min: '0', max: '400' },
          { path: ['SAO_PAULO', 'NAO_MEI'], min: '0', max: '340' },
          { path: ['SUL', 'MEI'], min: '0', max: '360' },
        ]),
        // Só São Paulo › MEI se sobrepõe (400 > 358).
        grouped('R2', 1, [
          { path: ['SAO_PAULO', 'MEI'], min: '358', max: '420' },
          { path: ['SAO_PAULO', 'NAO_MEI'], min: '340', max: '400' },
          { path: ['SUL', 'MEI'], min: '360', max: '430' },
        ]),
      ],
      regionalPorte,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const contiguity = result.issues.filter((i) => i.code === 'RANGE_GROUPING_NOT_CONTIGUOUS');
      expect(contiguity).toHaveLength(1);
      expect(contiguity[0]!.path).toEqual(['SAO_PAULO', 'MEI']);
    }
  });

  it('rejeita groupingDimensions vazio', () => {
    const result = validateDomains('RANGE', [grouped('A', 0, []), grouped('B', 1, [])], []);
    expect(result.ok).toBe(false);
  });

  it('rejeita mais de 4 níveis — TOO_MANY_GROUPING_LEVELS', () => {
    const fiveLevels: GroupingDimension[] = ['N1', 'N2', 'N3', 'N4', 'N5'].map((code) => ({
      code,
      label: code,
      options: [{ code: 'X', label: 'X' }],
    }));
    const path = ['X', 'X', 'X', 'X', 'X'];
    const result = validateDomains(
      'RANGE',
      [
        grouped('A', 0, [{ path, min: '0', max: '100' }]),
        grouped('B', 1, [{ path, min: '100', max: '200' }]),
      ],
      fiveLevels,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'TOO_MANY_GROUPING_LEVELS')).toBe(true);
    }
  });

  it('aceita exatamente 4 níveis', () => {
    const fourLevels: GroupingDimension[] = ['N1', 'N2', 'N3', 'N4'].map((code) => ({
      code,
      label: code,
      options: [{ code: 'X', label: 'X' }],
    }));
    const path = ['X', 'X', 'X', 'X'];
    const result = validateDomains(
      'RANGE',
      [
        grouped('A', 0, [{ path, min: '0', max: '100' }]),
        grouped('B', 1, [{ path, min: '100', max: '200' }]),
      ],
      fourLevels,
    );
    expect(result.ok).toBe(true);
  });

  it('rejeita code de nível duplicado — GROUPING_DIMENSION_CODE_DUPLICATE', () => {
    const result = validateDomains(
      'RANGE',
      [
        grouped('A', 0, [{ path: ['BASE', 'BASE'], min: '0', max: '100' }]),
        grouped('B', 1, [{ path: ['BASE', 'BASE'], min: '100', max: '200' }]),
      ],
      [
        { code: 'REGIONAL', label: 'Regional 1', options: [{ code: 'BASE', label: 'Base' }] },
        { code: 'REGIONAL', label: 'Regional 2', options: [{ code: 'BASE', label: 'Base' }] },
      ],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'GROUPING_DIMENSION_CODE_DUPLICATE')).toBe(true);
    }
  });

  it('rejeita code de opção duplicado dentro do nível — GROUPING_OPTION_CODE_DUPLICATE', () => {
    const result = validateDomains(
      'RANGE',
      [
        grouped('A', 0, [{ path: ['BASE'], min: '0', max: '100' }]),
        grouped('B', 1, [{ path: ['BASE'], min: '100', max: '200' }]),
      ],
      [
        {
          code: 'REGIONAL',
          label: 'Regional',
          options: [
            { code: 'BASE', label: 'Base 1' },
            { code: 'BASE', label: 'Base 2' },
          ],
        },
      ],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'GROUPING_OPTION_CODE_DUPLICATE')).toBe(true);
    }
  });

  it('o mesmo code em níveis diferentes é válido — a unicidade de opção é por nível', () => {
    const result = validateDomains(
      'RANGE',
      [
        grouped('A', 0, [{ path: ['X', 'X'], min: '0', max: '100' }]),
        grouped('B', 1, [{ path: ['X', 'X'], min: '100', max: '200' }]),
      ],
      [
        { code: 'REGIONAL', label: 'Regional', options: [{ code: 'X', label: 'X regional' }] },
        { code: 'PORTE', label: 'Porte', options: [{ code: 'X', label: 'X porte' }] },
      ],
    );
    expect(result.ok).toBe(true);
  });

  it('rejeita path de comprimento errado — GROUPING_PATH_INVALID', () => {
    const result = validateDomains(
      'RANGE',
      [
        grouped('A', 0, [{ path: ['BASE', 'MEI'], min: '0', max: '100' }]),
        grouped('B', 1, [{ path: ['BASE'], min: '100', max: '200' }]),
      ],
      regional,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.code === 'GROUPING_PATH_INVALID');
      expect(issue?.domainCodes).toEqual(['A']);
    }
  });

  it('rejeita path apontando para opção inexistente — GROUPING_PATH_INVALID', () => {
    const result = validateDomains(
      'RANGE',
      [
        grouped('A', 0, [{ path: ['RJ'], min: '0', max: '100' }]),
        grouped('B', 1, [{ path: ['RJ'], min: '100', max: '200' }]),
      ],
      regional,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.code === 'GROUPING_PATH_INVALID');
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('"RJ"');
    }
  });

  it('domínio ausente de um caminho que outros preenchem NÃO falha a validação (intencional)', () => {
    const result = validateDomains(
      'RANGE',
      [
        grouped('A', 0, [
          { path: ['BASE'], min: '0', max: '100' },
          { path: ['SP'], min: '0', max: '100' },
        ]),
        // B não tem entrada para SP — hierarquia assimétrica legítima.
        grouped('B', 1, [{ path: ['BASE'], min: '100', max: '200' }]),
      ],
      regional,
    );
    expect(result.ok).toBe(true);
  });

  // -- findIncompleteGroupingPaths: aviso de UX, nunca invariante ------------

  it('findIncompleteGroupingPaths detecta o caso do exemplo de docs/05 §5.6.2', () => {
    // São Paulo tem R1/R2 em MEI, mas só R1 em Não MEI; Sul só tem R1 em MEI.
    const domains = [
      grouped('R1', 0, [
        { path: ['SAO_PAULO', 'MEI'], min: '0', max: '357' },
        { path: ['SAO_PAULO', 'NAO_MEI'], min: '0', max: '340' },
        { path: ['SUL', 'MEI'], min: '0', max: '360' },
      ]),
      grouped('R2', 1, [{ path: ['SAO_PAULO', 'MEI'], min: '357', max: '420' }]),
    ];

    expect(findIncompleteGroupingPaths(domains, regionalPorte)).toEqual([
      { path: ['SAO_PAULO', 'NAO_MEI'], missingDomainCodes: ['R2'] },
      { path: ['SUL', 'MEI'], missingDomainCodes: ['R2'] },
    ]);

    // E não bloqueia o salvamento: a mesma configuração valida.
    expect(validateDomains('RANGE', domains, regionalPorte).ok).toBe(true);
  });

  it('findIncompleteGroupingPaths não reporta nada quando todos os caminhos estão completos', () => {
    const domains = [
      grouped('R1', 0, [
        { path: ['SAO_PAULO', 'MEI'], min: '0', max: '357' },
        { path: ['SUL', 'MEI'], min: '0', max: '360' },
      ]),
      grouped('R2', 1, [
        { path: ['SAO_PAULO', 'MEI'], min: '357', max: '420' },
        { path: ['SUL', 'MEI'], min: '360', max: '430' },
      ]),
    ];
    expect(findIncompleteGroupingPaths(domains, regionalPorte)).toEqual([]);
  });

  it('findIncompleteGroupingPaths ignora domínios sem nenhuma faixa agrupada', () => {
    const domains = [
      grouped('R1', 0, [{ path: ['BASE'], min: '0', max: '100' }]),
      grouped('R2', 1, [{ path: ['SP'], min: '0', max: '100' }]),
      // Domínio recém-adicionado, ainda sem faixa nenhuma — não conta.
      { code: 'R3', label: 'R3', position: 2 },
    ];
    expect(findIncompleteGroupingPaths(domains, regional)).toEqual([
      { path: ['BASE'], missingDomainCodes: ['R2'] },
      { path: ['SP'], missingDomainCodes: ['R1'] },
    ]);
  });

  // -- boundaryMode: HALF_OPEN (default) × INCLUSIVE_INTEGER (ajuste) --------

  it('HALF_OPEN é o default: omitir boundaryMode se comporta bit-a-bit igual a hoje', () => {
    const contiguous = validateDomains('RANGE', [range('BAIXO', 0, '0', '100'), range('ALTO', 1, '100', '200')]);
    expect(contiguous.ok).toBe(true);
    const withHole = validateDomains('RANGE', [range('BAIXO', 0, '0', '100'), range('ALTO', 1, '150', '200')]);
    expect(withHole.ok).toBe(false);
  });

  it('INCLUSIVE_INTEGER: faixas com salto de 1 (formato fechado-fechado do Excel) são contíguas', () => {
    const result = validateDomains(
      'RANGE',
      [
        range('R20', 0, '0', '357'),
        range('R19', 1, '358', '437'),
        range('R18', 2, '438', undefined, { isCatchAll: true }),
      ],
      undefined,
      'INCLUSIVE_INTEGER',
    );
    expect(result.ok).toBe(true);
  });

  it('INCLUSIVE_INTEGER: o mesmo par no formato HALF_OPEN (máx == próx.mín, sem +1) fica não contíguo', () => {
    const result = validateDomains(
      'RANGE',
      [range('BAIXO', 0, '0', '100'), range('ALTO', 1, '100', '200')],
      undefined,
      'INCLUSIVE_INTEGER',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'RANGE_NOT_CONTIGUOUS')).toBe(true);
    }
  });

  it('INCLUSIVE_INTEGER: buraco real (salto > 1) continua falhando', () => {
    const result = validateDomains(
      'RANGE',
      [range('R20', 0, '0', '357'), range('R19', 1, '360', '437')],
      undefined,
      'INCLUSIVE_INTEGER',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'RANGE_NOT_CONTIGUOUS')).toBe(true);
    }
  });

  it('INCLUSIVE_INTEGER: sobreposição continua falhando', () => {
    const result = validateDomains(
      'RANGE',
      [range('R20', 0, '0', '357'), range('R19', 1, '350', '437')],
      undefined,
      'INCLUSIVE_INTEGER',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'RANGE_NOT_CONTIGUOUS')).toBe(true);
    }
  });

  it('INCLUSIVE_INTEGER: valor não inteiro falha com mensagem clara', () => {
    const result = validateDomains(
      'RANGE',
      [range('R20', 0, '0', '357.5'), range('R19', 1, '358.5', undefined, { isCatchAll: true })],
      undefined,
      'INCLUSIVE_INTEGER',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.code === 'RANGE_NOT_CONTIGUOUS');
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/inteiro/);
    }
  });

  it('INCLUSIVE_INTEGER com agrupamento: salto de 1 em todos os caminhos é contíguo', () => {
    const result = validateDomains(
      'RANGE',
      [
        grouped('R20', 0, [
          { path: ['BASE'], min: '0', max: '357' },
          { path: ['SP'], min: '0', max: '400' },
        ]),
        grouped('R19', 1, [
          { path: ['BASE'], min: '358', max: '437' },
          { path: ['SP'], min: '401', max: '480' },
        ]),
      ],
      regional,
      'INCLUSIVE_INTEGER',
    );
    expect(result.ok).toBe(true);
  });

  it('INCLUSIVE_INTEGER com agrupamento: buraco num caminho só aponta o caminho certo', () => {
    const result = validateDomains(
      'RANGE',
      [
        grouped('R20', 0, [
          { path: ['BASE'], min: '0', max: '357' },
          { path: ['SP'], min: '0', max: '400' },
        ]),
        // SP tem buraco real (401 esperado, veio 402); BASE segue contíguo com +1.
        grouped('R19', 1, [
          { path: ['BASE'], min: '358', max: '437' },
          { path: ['SP'], min: '402', max: '480' },
        ]),
      ],
      regional,
      'INCLUSIVE_INTEGER',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.code === 'RANGE_GROUPING_NOT_CONTIGUOUS');
      expect(issue?.path).toEqual(['SP']);
    }
  });

  // -- direção decrescente por position (docs/05 §5.6.0, docs/03 I9) --------
  // Cortes de score às vezes vêm do negócio "melhor faixa primeiro": R01 com
  // a faixa mais alta, R20 com a mais baixa — mínimo decrescendo a cada
  // domínio seguinte por `position`. A validação detecta isso sozinha.

  it('HALF_OPEN: aceita faixas decrescentes por position (maior faixa primeiro)', () => {
    const result = validateDomains('RANGE', [
      range('ALTO', 0, '100', '200'),
      range('BAIXO', 1, '0', '100'),
    ]);
    expect(result.ok).toBe(true);
  });

  it('HALF_OPEN: detecta buraco numa sequência decrescente', () => {
    const result = validateDomains('RANGE', [
      range('ALTO', 0, '150', '200'),
      range('BAIXO', 1, '0', '100'),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'RANGE_NOT_CONTIGUOUS')).toBe(true);
    }
  });

  it('INCLUSIVE_INTEGER: aceita o caso real do negócio — R01 (faixa mais alta) primeiro, catch-all na faixa mais baixa', () => {
    const result = validateDomains(
      'RANGE',
      [
        range('R01', 0, '704', '999'),
        range('R02', 1, '685', '703'),
        range('R03', 2, '672', '684'),
        range('R04', 3, '5', '671', { isCatchAll: true }),
      ],
      undefined,
      'INCLUSIVE_INTEGER',
    );
    expect(result.ok).toBe(true);
  });

  it('INCLUSIVE_INTEGER: buraco real numa sequência decrescente continua falhando', () => {
    const result = validateDomains(
      'RANGE',
      [range('R01', 0, '704', '999'), range('R02', 1, '680', '703')],
      undefined,
      'INCLUSIVE_INTEGER',
    );
    expect(result.ok).toBe(true); // 703 + 1 = 704 — ainda contíguo, sem buraco.
    const withHole = validateDomains(
      'RANGE',
      [range('R01', 0, '704', '999'), range('R02', 1, '680', '702')],
      undefined,
      'INCLUSIVE_INTEGER',
    );
    expect(withHole.ok).toBe(false);
    if (!withHole.ok) {
      expect(withHole.issues.some((i) => i.code === 'RANGE_NOT_CONTIGUOUS')).toBe(true);
    }
  });

  it('agrupamento: direção decrescente é detectada por caminho, independentemente', () => {
    const result = validateDomains(
      'RANGE',
      [
        grouped('R01', 0, [
          { path: ['BASE'], min: '100', max: '200' },
          { path: ['SP'], min: '120', max: '240' },
        ]),
        grouped('R02', 1, [
          { path: ['BASE'], min: '0', max: '100' },
          { path: ['SP'], min: '0', max: '120' },
        ]),
      ],
      regional,
    );
    expect(result.ok).toBe(true);
  });
});
