import { describe, expect, it } from 'vitest';
import { parseRegionalRangeTable } from '@/core/library/regional-import';

/**
 * `parseRegionalRangeTable` — docs/05-regras-de-negocio.md §5.6.2.
 */

function tsv(rows: string[][]): string {
  return rows.map((row) => row.join('\t')).join('\n');
}

describe('parseRegionalRangeTable', () => {
  it('interpreta uma tabela bem formada (2 regionais × 3 faixas)', () => {
    const text = tsv([
      ['', 'BASE', '', 'SP', ''],
      ['', 'MIN', 'MAX', 'MIN', 'MAX'],
      ['R1 - Risco baixo', '0', '100', '0', '120'],
      ['R2 - Risco médio', '100', '200', '120', '240'],
      ['R3 - Risco alto', '200', '999', '240', '999'],
    ]);
    const result = parseRegionalRangeTable(text);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.regions).toEqual([
      { code: 'BASE', label: 'BASE' },
      { code: 'SP', label: 'SP' },
    ]);
    expect(result.domains).toHaveLength(3);
    expect(result.domains[0]).toEqual({
      code: 'R1',
      label: 'R1 - Risco baixo',
      position: 0,
      regionalRanges: {
        BASE: { min: '0', max: '100' },
        SP: { min: '0', max: '120' },
      },
    });
    expect(result.domains[2]!.position).toBe(2);
  });

  it('a tabela real de 20 faixas × 9 regionais gera 20 domínios e 9 regionais', () => {
    const regionCodes = ['BASE', 'SP', 'RJ', 'MG', 'RS', 'PR', 'SC', 'BA', 'PE'];
    const header1: string[] = [''];
    const header2: string[] = [''];
    for (const code of regionCodes) {
      header1.push(code, '');
      header2.push('MIN', 'MAX');
    }
    const rows: string[][] = [header1, header2];
    for (let i = 1; i <= 20; i++) {
      const row = [`R${String(i).padStart(2, '0')} - Faixa ${i}`];
      for (let r = 0; r < regionCodes.length; r++) {
        row.push(String((i - 1) * 10 + r), String(i * 10 + r));
      }
      rows.push(row);
    }
    const result = parseRegionalRangeTable(tsv(rows));
    expect(result.errors).toEqual([]);
    expect(result.regions).toHaveLength(9);
    expect(result.domains).toHaveLength(20);
    expect(result.domains[19]!.code).toBe('R20');
    expect(Object.keys(result.domains[0]!.regionalRanges!)).toHaveLength(9);
  });

  it('faz carry-forward da célula mesclada de cabeçalho', () => {
    const text = tsv([
      ['', 'BASE', ''], // célula mesclada: só a primeira coluna do bloco vem preenchida
      ['', 'MIN', 'MAX'],
      ['R1 - Baixo', '0', '10'],
    ]);
    const result = parseRegionalRangeTable(text);
    expect(result.errors).toEqual([]);
    expect(result.regions).toEqual([{ code: 'BASE', label: 'BASE' }]);
  });

  it('célula de dado vazia vira aviso, e o domínio incompleto some da lista', () => {
    const text = tsv([
      ['', 'BASE', '', 'SP', ''],
      ['', 'MIN', 'MAX', 'MIN', 'MAX'],
      ['R1 - Baixo', '0', '100', '0', '100'],
      ['R2 - Médio', '100', '200', '', '200'], // SP.min vazio
    ]);
    const result = parseRegionalRangeTable(text);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('R2');
    expect(result.warnings[0]).toContain('SP');
    expect(result.domains).toHaveLength(1);
    expect(result.domains[0]!.code).toBe('R1');
  });

  it('cabeçalho incompleto (linha 2 sem MIN/MAX) vira REGIONAL_IMPORT_PARSE_ERROR', () => {
    const text = tsv([
      ['', 'BASE', ''],
      ['', 'MINIMO', 'MAXIMO'],
      ['R1 - Baixo', '0', '10'],
    ]);
    const result = parseRegionalRangeTable(text);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.domains).toEqual([]);
  });

  it('número de colunas inconsistente numa linha de dado vira erro', () => {
    const text = tsv([
      ['', 'BASE', '', 'SP', ''],
      ['', 'MIN', 'MAX', 'MIN', 'MAX'],
      ['R1 - Baixo', '0', '100', '0'], // falta uma coluna
    ]);
    const result = parseRegionalRangeTable(text);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.domains).toEqual([]);
  });

  it('menos de duas linhas de cabeçalho vira erro', () => {
    const result = parseRegionalRangeTable('só uma linha');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('código de domínio inválido (sem casar ^[A-Z0-9_]+$) vira erro', () => {
    const text = tsv([
      ['', 'BASE', ''],
      ['', 'MIN', 'MAX'],
      ['r1|x - Baixo', '0', '10'],
    ]);
    const result = parseRegionalRangeTable(text);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('aceita marca de MIN/MAX acentuada e minúscula', () => {
    const text = tsv([
      ['', 'BASE', ''],
      ['', 'mín', 'MÁX'],
      ['R1 - Baixo', '0', '10'],
    ]);
    const result = parseRegionalRangeTable(text);
    expect(result.errors).toEqual([]);
    expect(result.domains).toHaveLength(1);
  });
});
