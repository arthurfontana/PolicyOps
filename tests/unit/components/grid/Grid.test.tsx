// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Grid } from '@/components/grid/Grid';
import { createSampleDocument } from '@/core/document/create';
import { getEditorView } from '@/core/queries';
import { resolveOpenVersion } from '@/core/queries';
import type { PolicyOpsDocument } from '@/core/document/schema';

/**
 * `MTZ_LIMITE_PJ` (eixo Y aninhado SEGMENTO › FAT) e `MTZ_LIMITE_PF` (eixos
 * de 1 nível) do documento de exemplo — critérios de aceite da S09
 * (docs/prompts/S09-grid-e-matrizes.md).
 */

function openVersionId(doc: PolicyOpsDocument, matrixCode: string): string {
  const matrix = doc.matrices.find((candidate) => candidate.code === matrixCode);
  if (matrix === undefined) throw new Error(`Matriz ${matrixCode} não existe no exemplo.`);
  const version = resolveOpenVersion(matrix);
  if (version === null) throw new Error(`Matriz ${matrixCode} não tem versão aberta.`);
  return version.id;
}

describe('Grid — MTZ_LIMITE_PJ (eixo aninhado)', () => {
  const doc = createSampleDocument();
  const view = getEditorView(doc, openVersionId(doc, 'MTZ_LIMITE_PJ'));

  it('produz 8 linhas (não 15) e spans 3, 3, 2 no nível 0 de Y', () => {
    expect(view.y.axis.tuples).toHaveLength(8);
    const level0 = view.y.headerRows[0]!.cells;
    expect(level0.map((cell) => cell.span)).toEqual([3, 3, 2]);
  });

  it('renderiza 48 células de dados (6 colunas de Score × 8 linhas)', () => {
    render(<Grid view={view} zoom={1} />);
    expect(screen.getAllByRole('gridcell')).toHaveLength(48);
  });

  it('cabeçalhos de nível 0 aparecem na ordem de `position` (Varejo, Atacado, Corporate), não alfabética', () => {
    render(<Grid view={view} zoom={1} />);
    const headers = screen.getAllByRole('rowheader');
    const level0Labels = headers.filter((el) => el.textContent === 'Varejo' || el.textContent === 'Atacado' || el.textContent === 'Corporate');
    expect(level0Labels.map((el) => el.textContent)).toEqual(['Varejo', 'Atacado', 'Corporate']);
  });

  it('mostra o contador de combinações no rodapé', () => {
    render(<Grid view={view} zoom={1} />);
    const counters = screen.getByTestId('grid-counters');
    expect(within(counters).getByText(/48 combinações/)).toBeInTheDocument();
  });
});

describe('Grid — MTZ_LIMITE_PF (grid simples de 1 nível)', () => {
  const doc = createSampleDocument();
  const view = getEditorView(doc, openVersionId(doc, 'MTZ_LIMITE_PF'));

  it('tem 1 nível em cada eixo', () => {
    expect(view.x.levelCount).toBe(1);
    expect(view.y.levelCount).toBe(1);
  });

  it('renderiza uma célula por combinação, sem cabeçalhos aninhados extras', () => {
    render(<Grid view={view} zoom={1} />);
    expect(screen.getAllByRole('gridcell')).toHaveLength(view.x.axis.tuples.length * view.y.axis.tuples.length);
    expect(screen.getAllByRole('columnheader')).toHaveLength(view.x.axis.tuples.length);
    expect(screen.getAllByRole('rowheader')).toHaveLength(view.y.axis.tuples.length);
  });
});

/**
 * `variant="thumbnail"` — docs/prompts/S15-vigencia-por-data.md, item 3: a
 * miniatura de portfólio reaproveita o grid da S09, célula de 12px só cor,
 * sem texto, mas com os separadores de nível preservados.
 */
describe('Grid — variant="thumbnail" (miniatura de portfólio, S15)', () => {
  const doc = createSampleDocument();
  const view = getEditorView(doc, openVersionId(doc, 'MTZ_LIMITE_PJ'));

  it('não tem cabeçalhos nem rodapé, e vira `role="img"`', () => {
    render(<Grid view={view} zoom={1} variant="thumbnail" />);
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
    expect(screen.queryByRole('rowheader')).not.toBeInTheDocument();
    expect(screen.queryByTestId('grid-counters')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Miniatura da matriz/ })).toBeInTheDocument();
  });

  it('as células não têm papel de gridcell nem texto — só cor', () => {
    render(<Grid view={view} zoom={1} variant="thumbnail" />);
    expect(screen.queryAllByRole('gridcell')).toHaveLength(0);
    const img = screen.getByRole('img');
    expect(img.textContent).toBe('');
  });

  it('preserva os separadores de nível de um eixo aninhado (Segmento › Faturamento)', () => {
    const { container } = render(<Grid view={view} zoom={1} variant="thumbnail" />);
    // `isYBoundary` continua marcando os limites de "Varejo"/"Atacado"/"Corporate" mesmo sem cabeçalho de texto.
    expect(container.querySelectorAll('.border-b-2').length).toBeGreaterThan(0);
  });
});
