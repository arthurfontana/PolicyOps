// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GridSkeleton } from '@/components/grid/GridSkeleton';

/** docs/07-ux-e-editor.md §12: skeleton do grid com as dimensões corretas. */
describe('GridSkeleton', () => {
  it('anuncia a contagem real de combinações no aria-label, mesmo saturando a malha visual', () => {
    render(<GridSkeleton xCount={48} yCount={30} />);
    expect(screen.getByRole('status', { name: 'Carregando grid de 48 × 30 combinações' })).toBeInTheDocument();
  });

  it('não estoura para uma matriz de 1 × 1', () => {
    render(<GridSkeleton xCount={1} yCount={1} />);
    expect(screen.getByRole('status', { name: 'Carregando grid de 1 × 1 combinações' })).toBeInTheDocument();
  });
});
