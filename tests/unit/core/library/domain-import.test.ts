import { describe, expect, it } from 'vitest';
import { mergeImportedDomains, parseDomainTable } from '@/core/library/domain-import';
import { validateDomains } from '@/core/library/validate-domains';
import type { Domain } from '@/core/document/schema';

/**
 * `parseDomainTable` / `mergeImportedDomains` — docs/05-regras-de-negocio.md
 * §5.6.2/§5.6.3, de 0 a 4 colunas de agrupamento.
 */

function tsv(rows: string[][]): string {
  return rows.map((row) => row.join('\t')).join('\n');
}

describe('parseDomainTable', () => {
  it('tabela simples completa (Domínio, Mínimo, Máximo)', () => {
    const text = tsv([
      ['Domínio', 'Mínimo', 'Máximo'],
      ['R1 - Risco baixo', '0', '100'],
      ['R2 - Risco médio', '100', '200'],
    ]);
    const result = parseDomainTable(text);
    expect(result.errors).toEqual([]);
    expect(result.columns).toEqual(new Set(['min', 'max']));
    expect(result.domains).toEqual([
      { code: 'R1', label: 'R1 - Risco baixo', position: 0, rangeMin: '0', rangeMax: '100' },
      { code: 'R2', label: 'R2 - Risco médio', position: 1, rangeMin: '100', rangeMax: '200' },
    ]);
  });

  it('só identidade + cor (Domínio, Cor) — o caso do relatório de risco colado', () => {
    const text = tsv([
      ['Domínio', 'RGB'],
      ['R20', '255 0 0'],
      ['R19', '255 32 32'],
    ]);
    const result = parseDomainTable(text);
    expect(result.errors).toEqual([]);
    expect(result.columns).toEqual(new Set(['color']));
    expect(result.domains).toEqual([
      { code: 'R20', label: 'R20', position: 0, color: '#FF0000' },
      { code: 'R19', label: 'R19', position: 1, color: '#FF2020' },
    ]);
  });

  it('sem colunas de agrupamento, groupingDimensions vem vazio', () => {
    const result = parseDomainTable(
      tsv([
        ['Domínio', 'Mínimo', 'Máximo'],
        ['R1', '0', '100'],
        ['R2', '100', '200'],
      ]),
    );
    expect(result.groupingDimensions).toEqual([]);
    expect(result.columns.has('grouping')).toBe(false);
  });

  it('code repetido sem colunas de agrupamento vira erro', () => {
    const text = tsv([
      ['Domínio', 'Cor'],
      ['R1', '#FF0000'],
      ['R1', '#00FF00'],
    ]);
    const result = parseDomainTable(text);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.domains).toEqual([]);
  });

  it('cabeçalho sem Domínio vira erro', () => {
    const text = tsv([
      ['Mínimo', 'Máximo'],
      ['0', '100'],
    ]);
    const result = parseDomainTable(text);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('aceita Código como sinônimo de Domínio, em qualquer caixa/acento', () => {
    const text = tsv([
      ['código', 'cor'],
      ['SIM', '#16A34A'],
    ]);
    const result = parseDomainTable(text);
    expect(result.errors).toEqual([]);
    expect(result.domains[0]!.code).toBe('SIM');
  });

  it('Cor em formato R G B e em #RRGGBB', () => {
    const text = tsv([
      ['Domínio', 'Cor'],
      ['A - Alfa', '255, 0, 0'],
      ['B - Beta', '#00ff00'],
    ]);
    const result = parseDomainTable(text);
    expect(result.errors).toEqual([]);
    expect(result.domains[0]!.color).toBe('#FF0000');
    expect(result.domains[1]!.color).toBe('#00FF00');
  });

  it('cor em formato inválido vira erro', () => {
    const text = tsv([
      ['Domínio', 'Cor'],
      ['A', 'roxo'],
    ]);
    const result = parseDomainTable(text);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('número de colunas inconsistente numa linha de dado vira erro', () => {
    const text = tsv([
      ['Domínio', 'Mínimo', 'Máximo'],
      ['R1', '0'],
    ]);
    const result = parseDomainTable(text);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.domains).toEqual([]);
  });

  it('colunas opcionais em qualquer ordem entre si (Domínio precisa ser a primeira coluna)', () => {
    const text = tsv([
      ['Domínio', 'Cor', 'Máximo', 'Mínimo'],
      ['R1', '#FF0000', '100', '0'],
    ]);
    const result = parseDomainTable(text);
    expect(result.errors).toEqual([]);
    expect(result.domains[0]).toEqual({
      code: 'R1',
      label: 'R1',
      position: 0,
      color: '#FF0000',
      rangeMax: '100',
      rangeMin: '0',
    });
  });
});

/**
 * Colunas de agrupamento — docs/05-regras-de-negocio.md §5.6.2 itens 1, 5 e 8.
 */
describe('parseDomainTable com colunas de agrupamento', () => {
  /** O exemplo literal de docs/05 §5.6.2: 4 linhas, combinações assimétricas. */
  const regionalPorte = tsv([
    ['Regional', 'Porte', 'Domínio', 'Mínimo', 'Máximo'],
    ['São Paulo', 'MEI', 'R1', '0', '357'],
    ['São Paulo', 'MEI', 'R2', '358', '420'],
    ['São Paulo', 'Não MEI', 'R1', '0', '340'],
    ['Sul', 'MEI', 'R1', '0', '360'],
  ]);

  it('o exemplo real de Regional × Porte produz 2 níveis na ordem de aparição', () => {
    const result = parseDomainTable(regionalPorte);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.groupingDimensions).toEqual([
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
    ]);
    expect(result.columns.has('grouping')).toBe(true);
  });

  it('produz groupingRanges só para as combinações que aparecem, sem exigir simetria', () => {
    const result = parseDomainTable(regionalPorte);
    expect(result.domains).toEqual([
      {
        code: 'R1',
        label: 'R1',
        position: 0,
        groupingRanges: [
          { path: ['SAO_PAULO', 'MEI'], min: '0', max: '357' },
          { path: ['SAO_PAULO', 'NAO_MEI'], min: '0', max: '340' },
          { path: ['SUL', 'MEI'], min: '0', max: '360' },
        ],
      },
      {
        code: 'R2',
        label: 'R2',
        position: 1,
        groupingRanges: [{ path: ['SAO_PAULO', 'MEI'], min: '358', max: '420' }],
      },
    ]);
  });

  it('o resultado do exemplo passa por validateDomains sem erro (formato fechado-fechado do Excel)', () => {
    // A tabela do §5.6.2 vem no formato 0–357, 358–420: é `INCLUSIVE_INTEGER`
    // (§5.6.0/§5.6.2 item 9) que a torna contígua, sem ajuste manual.
    const result = parseDomainTable(regionalPorte);
    expect(
      validateDomains('RANGE', result.domains, result.groupingDimensions, 'INCLUSIVE_INTEGER').ok,
    ).toBe(true);
  });

  it('mais de 4 colunas de agrupamento vira erro', () => {
    const result = parseDomainTable(
      tsv([
        ['A', 'B', 'C', 'D', 'E', 'Domínio', 'Mínimo', 'Máximo'],
        ['1', '2', '3', '4', '5', 'R1', '0', '100'],
      ]),
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('máximo é 4');
    expect(result.domains).toEqual([]);
  });

  it('exatamente 4 colunas de agrupamento é aceito', () => {
    const result = parseDomainTable(
      tsv([
        ['A', 'B', 'C', 'D', 'Domínio', 'Mínimo', 'Máximo'],
        ['1', '2', '3', '4', 'R1', '0', '100'],
        ['1', '2', '3', '4', 'R2', '100', '200'],
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.groupingDimensions).toHaveLength(4);
    expect(result.domains[0]!.groupingRanges).toEqual([
      { path: ['1', '2', '3', '4'], min: '0', max: '100' },
    ]);
  });

  it('o código da opção é normalizado: maiúsculo, sem acento, espaço vira _', () => {
    const result = parseDomainTable(
      tsv([
        ['Porte da empresa', 'Domínio', 'Mínimo', 'Máximo'],
        ['Não MEI com 1 sócio', 'R1', '0', '100'],
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.groupingDimensions[0]!.code).toBe('PORTE_DA_EMPRESA');
    expect(result.groupingDimensions[0]!.options).toEqual([
      { code: 'NAO_MEI_COM_1_SOCIO', label: 'Não MEI com 1 sócio' },
    ]);
  });

  it('identidade e cor vêm da primeira linha; cor divergente depois é aviso, não erro', () => {
    const result = parseDomainTable(
      tsv([
        ['Regional', 'Domínio', 'Mínimo', 'Máximo', 'Cor'],
        ['São Paulo', 'R1 - Risco baixo', '0', '100', '#00FF2A'],
        ['Sul', 'R1 - outro rótulo', '0', '120', '#FF0000'],
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.domains[0]!.label).toBe('R1 - Risco baixo');
    expect(result.domains[0]!.color).toBe('#00FF2A');
  });

  it('faixa vazia numa linha com agrupamento é aviso — a combinação não entra', () => {
    const result = parseDomainTable(
      tsv([
        ['Regional', 'Domínio', 'Mínimo', 'Máximo'],
        ['São Paulo', 'R1', '0', '100'],
        ['Sul', 'R1', '', ''],
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.domains[0]!.groupingRanges).toEqual([{ path: ['SAO_PAULO'], min: '0', max: '100' }]);
  });

  it('mesma combinação repetida para o mesmo domínio vira erro', () => {
    const result = parseDomainTable(
      tsv([
        ['Regional', 'Domínio', 'Mínimo', 'Máximo'],
        ['São Paulo', 'R1', '0', '100'],
        ['São Paulo', 'R1', '0', '120'],
      ]),
    );
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('célula de agrupamento vazia vira erro', () => {
    const result = parseDomainTable(
      tsv([
        ['Regional', 'Domínio', 'Mínimo', 'Máximo'],
        ['', 'R1', '0', '100'],
      ]),
    );
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('sem Mínimo/Máximo, as colunas de agrupamento ainda são detectadas e a faixa não é tocada', () => {
    const result = parseDomainTable(
      tsv([
        ['Regional', 'Domínio', 'Cor'],
        ['São Paulo', 'R1', '#FF0000'],
        ['Sul', 'R1', '#FF0000'],
      ]),
    );
    expect(result.errors).toEqual([]);
    expect(result.groupingDimensions).toHaveLength(1);
    expect(result.domains).toHaveLength(1);
    expect(result.domains[0]!.groupingRanges).toBeUndefined();
  });
});

describe('mergeImportedDomains', () => {
  const existing: Domain[] = [
    { code: 'R1', label: 'R1 antigo', position: 0, color: '#123456', rangeMin: '0', rangeMax: '100' },
    { code: 'R2', label: 'R2 antigo', position: 1, color: '#654321', rangeMin: '100', rangeMax: '200' },
  ];

  it('recolar só com Cor preserva rangeMin/rangeMax existentes', () => {
    const parsed = parseDomainTable(
      tsv([
        ['Domínio', 'Cor'],
        ['R1 - Novo rótulo', '#FF0000'],
      ]),
    );
    const merged = mergeImportedDomains(existing, parsed);
    expect(merged).toEqual([
      {
        code: 'R1',
        label: 'R1 - Novo rótulo',
        position: 0,
        color: '#FF0000',
        rangeMin: '0',
        rangeMax: '100',
      },
    ]);
  });

  it('recolar só com Mínimo/Máximo preserva color existente', () => {
    const parsed = parseDomainTable(
      tsv([
        ['Domínio', 'Mínimo', 'Máximo'],
        ['R1 - Novo rótulo', '0', '150'],
      ]),
    );
    const merged = mergeImportedDomains(existing, parsed);
    expect(merged).toEqual([
      {
        code: 'R1',
        label: 'R1 - Novo rótulo',
        position: 0,
        color: '#123456',
        rangeMin: '0',
        rangeMax: '150',
      },
    ]);
  });

  it('domínio novo sem correspondência entra só com os campos colados', () => {
    const parsed = parseDomainTable(
      tsv([
        ['Domínio', 'Cor'],
        ['R3 - Novo', '#00FF00'],
      ]),
    );
    const merged = mergeImportedDomains(existing, parsed);
    expect(merged).toEqual([{ code: 'R3', label: 'R3 - Novo', position: 0, color: '#00FF00' }]);
  });

  it('domínio existente não mencionado na colagem fica fora do resultado', () => {
    const parsed = parseDomainTable(
      tsv([
        ['Domínio', 'Cor'],
        ['R1', '#FF0000'],
      ]),
    );
    const merged = mergeImportedDomains(existing, parsed);
    expect(merged).toHaveLength(1);
    expect(merged.some((domain) => domain.code === 'R2')).toBe(false);
  });

  it('recolar só o caminho ["SP","MEI"] não afeta ["SP","NAO_MEI"] do mesmo domínio', () => {
    const existingGrouped: Domain[] = [
      {
        code: 'R1',
        label: 'R1 antigo',
        position: 0,
        color: '#123456',
        groupingRanges: [
          { path: ['SP', 'MEI'], min: '0', max: '357' },
          { path: ['SP', 'NAO_MEI'], min: '0', max: '340' },
          { path: ['SUL', 'MEI'], min: '0', max: '360' },
        ],
      },
    ];
    const parsed = parseDomainTable(
      tsv([
        ['Regional', 'Porte', 'Domínio', 'Mínimo', 'Máximo'],
        ['SP', 'MEI', 'R1 - novo rótulo', '0', '400'],
      ]),
    );
    const merged = mergeImportedDomains(existingGrouped, parsed);
    expect(merged).toEqual([
      {
        code: 'R1',
        label: 'R1 - novo rótulo',
        position: 0,
        color: '#123456',
        groupingRanges: [
          { path: ['SP', 'MEI'], min: '0', max: '400' },
          { path: ['SP', 'NAO_MEI'], min: '0', max: '340' },
          { path: ['SUL', 'MEI'], min: '0', max: '360' },
        ],
      },
    ]);
  });

  it('recolar só com Cor sobre um domínio agrupado preserva todas as faixas por caminho', () => {
    const existingGrouped: Domain[] = [
      {
        code: 'R1',
        label: 'R1 antigo',
        position: 0,
        color: '#123456',
        groupingRanges: [
          { path: ['SP', 'MEI'], min: '0', max: '357' },
          { path: ['SUL', 'MEI'], min: '0', max: '360' },
        ],
      },
    ];
    const parsed = parseDomainTable(
      tsv([
        ['Domínio', 'Cor'],
        ['R1', '#FF0000'],
      ]),
    );
    const merged = mergeImportedDomains(existingGrouped, parsed);
    expect(merged[0]!.color).toBe('#FF0000');
    expect(merged[0]!.groupingRanges).toEqual(existingGrouped[0]!.groupingRanges);
  });
});
