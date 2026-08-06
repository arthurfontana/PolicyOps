import { describe, expect, it } from 'vitest';
import type { CatalogItem, Cell } from '@/core/document/schema';
import type { EditorCatalog } from '@/core/queries';
import {
  CONTRAST_THRESHOLD,
  NEUTRAL_CELL_COLOR,
  PENDING_CELL_COLOR,
  contrastText,
  relativeLuminance,
  resolveCellColor,
} from '@/lib/colors';

function catalogItem(kind: CatalogItem['kind'], code: string, color?: string): CatalogItem {
  const item: CatalogItem = { id: code, kind, code, label: code, position: 0, createdAt: 't0' };
  if (color !== undefined) item.color = color;
  return item;
}

function buildCatalog(items: CatalogItem[]): EditorCatalog {
  const byCode: EditorCatalog['byCode'] = { DECISION: {}, OFFER: {}, LIMIT: {}, TAG: {} };
  for (const item of items) byCode[item.kind][item.code] = item;
  return {
    decisions: items.filter((i) => i.kind === 'DECISION'),
    offers: items.filter((i) => i.kind === 'OFFER'),
    limits: items.filter((i) => i.kind === 'LIMIT'),
    tags: items.filter((i) => i.kind === 'TAG'),
    byCode,
  };
}

describe('resolveCellColor — prioridade de docs/05-regras-de-negocio.md §3', () => {
  const catalog = buildCatalog([
    catalogItem('DECISION', 'APROVADO', '#16A34A'),
    catalogItem('DECISION', 'SEM_COR'),
    catalogItem('OFFER', 'OFERTA_1', '#2563EB'),
  ]);

  it('1. cell.color vence qualquer outra fonte', () => {
    const cell: Cell = { decision: 'APROVADO', offer: 'OFERTA_1', color: '#FACC15' };
    expect(resolveCellColor(cell, catalog)).toBe('#FACC15');
  });

  it('2. cor do item de catálogo da decisão, sem cell.color', () => {
    const cell: Cell = { decision: 'APROVADO', offer: 'OFERTA_1' };
    expect(resolveCellColor(cell, catalog)).toBe('#16A34A');
  });

  it('3. cor do item de catálogo da oferta, quando a decisão não tem cor própria', () => {
    const cell: Cell = { decision: 'SEM_COR', offer: 'OFERTA_1' };
    expect(resolveCellColor(cell, catalog)).toBe('#2563EB');
  });

  it('4. cinza neutro quando preenchida sem nenhuma cor disponível', () => {
    const cell: Cell = { decision: 'SEM_COR' };
    expect(resolveCellColor(cell, catalog)).toBe(NEUTRAL_CELL_COLOR);
  });

  it('5. cinza de pendência quando a célula não tem decisão', () => {
    expect(resolveCellColor(undefined, catalog)).toBe(PENDING_CELL_COLOR);
    expect(resolveCellColor({ note: 'sem decisão ainda' }, catalog)).toBe(PENDING_CELL_COLOR);
  });
});

describe('contrastText — docs/05 §3, limiar de luminância 0,55', () => {
  it('preto sobre fundo claro', () => {
    expect(contrastText('#FFFFFF')).toBe('#000000');
  });

  it('branco sobre fundo escuro', () => {
    expect(contrastText('#000000')).toBe('#FFFFFF');
  });

  it('no limiar: acima de 0,55 é preto, abaixo é branco', () => {
    const above = '#C8C8C8';
    const below = '#BEBEBE';
    expect(relativeLuminance(above)).toBeGreaterThan(CONTRAST_THRESHOLD);
    expect(relativeLuminance(below)).toBeLessThan(CONTRAST_THRESHOLD);
    expect(contrastText(above)).toBe('#000000');
    expect(contrastText(below)).toBe('#FFFFFF');
  });
});
