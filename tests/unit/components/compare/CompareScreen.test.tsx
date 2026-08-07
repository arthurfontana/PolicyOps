// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CompareScreen } from '@/components/compare/CompareScreen';
import { CompareInspector } from '@/components/inspector/CompareInspector';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createSampleDocument } from '@/core/document/create';
import type { Matrix, PolicyOpsDocument } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

/**
 * A tela de comparação — docs/07-ux-e-editor.md §9.
 *
 * O exemplo tem `MTZ_LIMITE_PF` com v1 vigente e v2 em rascunho, e o rascunho
 * altera exatamente 3 células (docs/03 §11): é o cenário do critério de aceite
 * da S14 nos três modos.
 */

function matrixByCode(doc: PolicyOpsDocument, code: string): Matrix {
  const matrix = doc.matrices.find((candidate) => candidate.code === code);
  if (matrix === undefined) throw new Error(`Matriz ${code} não existe no exemplo.`);
  return matrix;
}

function renderCompare(doc: PolicyOpsDocument, aId?: string, bId?: string) {
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  if (aId !== undefined && bId !== undefined) {
    useEditorStore.getState().setCompareVersions(aId, bId);
  }
  return render(
    <TooltipProvider>
      <CompareScreen />
      <CompareInspector />
    </TooltipProvider>,
  );
}

function pfVersions(doc: PolicyOpsDocument) {
  const matrix = matrixByCode(doc, 'MTZ_LIMITE_PF');
  return {
    matrix,
    v1: matrix.versions.find((version) => version.state === 'PUBLISHED')!,
    v2: matrix.versions.find((version) => version.state === 'DRAFT')!,
  };
}

describe('CompareScreen', () => {
  beforeEach(() => {
    useDocumentStore.getState().closeDocument();
    useEditorStore.getState().reset();
  });

  it('mostra o resumo semântico em linguagem de negócio', () => {
    const doc = createSampleDocument();
    const { v1, v2 } = pfVersions(doc);
    renderCompare(doc, v1.id, v2.id);

    // As 3 células alteradas do exemplo: uma vai a REPROVADO, duas a análise
    // manual, e as três perdem o limite que tinham enquanto APROVADO.
    const cards = screen.getByTestId('diff-summary-cards');
    expect(within(cards).getByText('célula fechada')).toBeInTheDocument();
    expect(within(cards).getByText('células enviadas para análise manual')).toBeInTheDocument();
    expect(within(cards).getByText('limites reduzidos')).toBeInTheDocument();
    expect(within(cards).queryByText(/célula[s]? aberta/)).not.toBeInTheDocument();
  });

  it('sobrepõe as 3 células alteradas no grid, e só elas', () => {
    const doc = createSampleDocument();
    const { v1, v2 } = pfVersions(doc);
    const { container } = renderCompare(doc, v1.id, v2.id);

    expect(screen.getByTestId('compare-overlay')).toBeInTheDocument();
    const marked = container.querySelectorAll('[role="gridcell"][data-diff]');
    expect(marked).toHaveLength(3);
    expect([...marked].map((cell) => cell.getAttribute('data-cell-key')).sort()).toEqual([
      'R1::BAIXO',
      'R1::SEM',
      'R2::SEM',
    ]);
    for (const cell of marked) expect(cell.getAttribute('data-diff')).toBe('MODIFIED');
  });

  it('clicar numa célula alterada mostra antes → depois no inspector', async () => {
    const user = userEvent.setup();
    const doc = createSampleDocument();
    const { v1, v2 } = pfVersions(doc);
    const { container } = renderCompare(doc, v1.id, v2.id);

    await user.click(container.querySelector('[data-cell-key="R1::BAIXO"]')!);

    const detail = screen.getByTestId('diff-cell-detail');
    expect(within(detail).getByText(/R1 — Risco muito baixo/)).toBeInTheDocument();
    expect(within(detail).getByText('Aprovado')).toBeInTheDocument();
    expect(within(detail).getByText('Reprovado')).toBeInTheDocument();
  });

  it('modo lista traz uma linha por mudança, filtrável por tipo', async () => {
    const user = userEvent.setup();
    const doc = createSampleDocument();
    const { v1, v2 } = pfVersions(doc);
    renderCompare(doc, v1.id, v2.id);

    await user.click(screen.getByRole('tab', { name: 'Lista' }));
    expect(screen.getAllByTestId('diff-list-row')).toHaveLength(3);
    expect(screen.getByTestId('diff-list-count')).toHaveTextContent('3 de 3');
    // Caminho legível completo: rótulos dos domínios, não códigos.
    expect(screen.getByText('Restritivo baixo × R1 — Risco muito baixo')).toBeInTheDocument();

    // Nenhuma das 3 é adicionada: filtrar por "Adicionadas" esvazia a tabela.
    await user.click(screen.getByLabelText('Filtrar por tipo de mudança'));
    await user.click(screen.getByRole('option', { name: 'Adicionadas' }));
    expect(screen.queryAllByTestId('diff-list-row')).toHaveLength(0);
    expect(screen.getByText('Nenhuma mudança corresponde ao filtro.')).toBeInTheDocument();
  });

  it('modo lado a lado desenha dois grids', async () => {
    const user = userEvent.setup();
    const doc = createSampleDocument();
    const { v1, v2 } = pfVersions(doc);
    renderCompare(doc, v1.id, v2.id);

    await user.click(screen.getByRole('tab', { name: 'Lado a lado' }));
    const panes = screen.getByTestId('compare-side-by-side');
    expect(within(panes).getAllByRole('grid')).toHaveLength(2);
  });

  it('"mostrar apenas alteradas" esvazia o conteúdo das inalteradas', async () => {
    const user = userEvent.setup();
    const doc = createSampleDocument();
    const { v1, v2 } = pfVersions(doc);
    const { container } = renderCompare(doc, v1.id, v2.id);

    const unchanged = () => container.querySelector('[data-cell-key="R6::ALTO"]')!;
    expect(unchanged().textContent).not.toBe('');

    await user.click(screen.getByLabelText('Mostrar apenas alteradas'));
    expect(unchanged().textContent).toBe('');
    // A alterada continua mostrando o conteúdo e o badge.
    expect(container.querySelector('[data-cell-key="R1::SEM"]')!.textContent).toContain('Análise');
  });

  it('versões incomparáveis mostram o banner e forçam o lado a lado', () => {
    const doc = createSampleDocument();
    const pf = pfVersions(doc);
    const pj = matrixByCode(doc, 'MTZ_LIMITE_PJ').versions[0]!;
    // O eixo Y de PJ é SEGMENTO › FAT; o de PF é RESTRITIVO. Pilhas diferentes.
    renderCompare(doc, pf.v1.id, pj.id);

    expect(screen.getByTestId('incomparable-banner')).toBeInTheDocument();
    expect(screen.getByTestId('compare-side-by-side')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sobreposto' })).toBeDisabled();
    expect(screen.queryByTestId('diff-summary-cards')).not.toBeInTheDocument();
  });

  it('escolher a versão mais nova na esquerda reordena: a base fica sempre à esquerda', async () => {
    const user = userEvent.setup();
    const doc = createSampleDocument();
    const { v1, v2 } = pfVersions(doc);
    renderCompare(doc, v1.id, v2.id);

    await user.click(screen.getByLabelText('Versão comparada'));
    await user.click(screen.getByRole('option', { name: /MTZ_LIMITE_PF v1/ }));

    // Escolher a v1 como comparada faria a base ser a v2 — que é mais nova.
    // A tela reordena e o par volta a ser (v1, v2).
    expect(useEditorStore.getState().compareVersionIds).toEqual({ aId: v1.id, bId: v2.id });
  });

  it('sem duas versões no documento, oferece voltar aos projetos', () => {
    const doc = createSampleDocument();
    // Deixa cada matriz com uma versão só.
    for (const matrix of doc.matrices) matrix.versions = [matrix.versions[0]!];
    renderCompare(doc);

    expect(
      screen.getByText('Não há duas versões de matriz para comparar neste documento.'),
    ).toBeInTheDocument();
  });
});
