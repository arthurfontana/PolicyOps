import { describe, expect, it } from 'vitest';
import { mergeImportedDomains, parseDomainTable } from '@/core/library/domain-import';
import type { Domain } from '@/core/document/schema';

/**
 * `parseDomainTable` / `mergeImportedDomains` — docs/05-regras-de-negocio.md
 * §5.6.2/§5.6.3. Restrito nesta sessão a 0 colunas de agrupamento.
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

  it('coluna de agrupamento presente antes de Domínio vira erro', () => {
    const text = tsv([
      ['Regional', 'Domínio', 'Mínimo', 'Máximo'],
      ['São Paulo', 'R1', '0', '100'],
    ]);
    const result = parseDomainTable(text);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('sessão futura');
    expect(result.domains).toEqual([]);
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
});
