import { describe, expect, it } from 'vitest';
import { COLOR_PALETTES, suggestPaletteColors } from '@/lib/color-palettes';
import type { Domain } from '@/core/document/schema';

/**
 * Paletas oficiais de cor — docs/05-regras-de-negocio.md §5.6.4.
 */

function domain(code: string, label: string): Domain {
  return { code, label, position: 0 };
}

describe('COLOR_PALETTES', () => {
  it('RISCO_R01_R20 tem 20 entradas, RISCO_SIMPLIFICADO tem 5', () => {
    const scale = COLOR_PALETTES.find((p) => p.id === 'RISCO_R01_R20')!;
    const simplified = COLOR_PALETTES.find((p) => p.id === 'RISCO_SIMPLIFICADO')!;
    expect(scale.entries).toHaveLength(20);
    expect(simplified.entries).toHaveLength(5);
    expect(scale.entries[0]).toEqual({ code: 'R01', label: 'R01', color: '#00FF2A' });
    expect(scale.entries[19]).toEqual({ code: 'R20', label: 'R20', color: '#FF0000' });
  });
});

describe('suggestPaletteColors', () => {
  it('R1 e R01 casam com a mesma entrada da paleta R01-R20', () => {
    const domains = [domain('R1', 'R1'), domain('R01', 'R01')];
    const result = suggestPaletteColors(domains, 'RISCO_R01_R20');
    expect(result[0]!.color).toBe('#00FF2A');
    expect(result[1]!.color).toBe('#00FF2A');
  });

  it('"baixíssimo"/"Baixíssimo" casam com a paleta simplificada, sem diferenciar caixa/acento', () => {
    const domains = [domain('BX', 'baixíssimo'), domain('BAIXISSIMO', 'Qualquer rótulo')];
    const result = suggestPaletteColors(domains, 'RISCO_SIMPLIFICADO');
    expect(result[0]!.color).toBe('#00FF2A');
    expect(result[1]!.color).toBe('#00FF2A');
  });

  it('domínio sem correspondência sai intocado', () => {
    const domains = [{ ...domain('XPTO', 'Sem correspondência'), color: '#123456' }, domain('OUTRO', 'Outro')];
    const result = suggestPaletteColors(domains, 'RISCO_R01_R20');
    expect(result[0]!.color).toBe('#123456');
    expect(result[1]!.color).toBeUndefined();
  });

  it('paleta desconhecida devolve os domínios sem alteração', () => {
    const domains = [domain('R1', 'R1')];
    expect(suggestPaletteColors(domains, 'INEXISTENTE')).toEqual(domains);
  });

  it('sobrescreve cor já existente quando o domínio bate (ação explícita de aplicar paleta)', () => {
    const domains = [{ ...domain('R1', 'R1'), color: '#000000' }];
    const result = suggestPaletteColors(domains, 'RISCO_R01_R20');
    expect(result[0]!.color).toBe('#00FF2A');
  });
});
