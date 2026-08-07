// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MatrixScreen } from '@/components/matrix/MatrixScreen';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createSampleDocument } from '@/core/document/create';
import type { Matrix, MatrixVersion, PolicyOpsDocument } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

/**
 * Critério de aceite da S13 (docs/prompts/S13-ciclo-de-vida.md): os botões
 * corretos aparecem na barra superior para cada um dos quatro estados de
 * versão (item 1 do escopo).
 */

function matrixByCode(doc: PolicyOpsDocument, code: string): Matrix {
  const matrix = doc.matrices.find((candidate) => candidate.code === code);
  if (matrix === undefined) throw new Error(`Matriz ${code} não existe no exemplo.`);
  return matrix;
}

function renderMatrixScreen(doc: PolicyOpsDocument, matrixId: string, versionId: string) {
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  useEditorStore.getState().openMatrix(matrixId, versionId);
  return render(
    <TooltipProvider>
      <MatrixScreen />
      <Toaster />
    </TooltipProvider>,
  );
}

/** Clona o exemplo e força o estado de `MTZ_LIMITE_PJ` v1 para o cenário pedido. */
function pjWithState(mutate: (version: MatrixVersion) => void): { doc: PolicyOpsDocument; matrixId: string; versionId: string } {
  const doc = createSampleDocument();
  const matrix = matrixByCode(doc, 'MTZ_LIMITE_PJ');
  const version = matrix.versions[0]!;
  mutate(version);
  return { doc, matrixId: matrix.id, versionId: version.id };
}

describe('MatrixScreen — ações de ciclo de vida por estado', () => {
  beforeEach(() => {
    useDocumentStore.getState().closeDocument();
  });

  it('DRAFT: Publicar, Descartar rascunho e Comparar com a vigente', () => {
    const doc = createSampleDocument();
    const matrix = matrixByCode(doc, 'MTZ_LIMITE_PF');
    const draft = matrix.versions.find((version) => version.state === 'DRAFT')!;
    renderMatrixScreen(doc, matrix.id, draft.id);

    expect(screen.getByRole('button', { name: /^Publicar$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Descartar rascunho/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Comparar com a vigente/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Criar rascunho$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Abrir rascunho$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Restaurar como rascunho/ })).not.toBeInTheDocument();
    // Presentes em qualquer estado (item 4 e 6 do escopo).
    expect(screen.getByRole('button', { name: /Histórico/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Adicionar nota/ })).toBeInTheDocument();
  });

  it('PUBLISHED vigente: Criar rascunho, Comparar e Exportar', () => {
    const doc = createSampleDocument();
    const matrix = matrixByCode(doc, 'MTZ_LIMITE_PJ');
    const published = matrix.versions.find((version) => version.state === 'PUBLISHED')!;
    renderMatrixScreen(doc, matrix.id, published.id);

    expect(screen.getByRole('button', { name: /^Criar rascunho$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Comparar$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportar/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Publicar$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Descartar rascunho/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Restaurar como rascunho/ })).not.toBeInTheDocument();
  });

  it('PUBLISHED vigente com rascunho já aberto: o botão vira "Abrir rascunho"', () => {
    const doc = createSampleDocument();
    const matrix = matrixByCode(doc, 'MTZ_LIMITE_PF');
    const published = matrix.versions.find((version) => version.state === 'PUBLISHED')!;
    renderMatrixScreen(doc, matrix.id, published.id);

    expect(screen.getByRole('button', { name: /^Abrir rascunho$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Criar rascunho$/ })).not.toBeInTheDocument();
  });

  it('PUBLISHED agendada: idem vigente, com o badge de agendamento', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    const { doc, matrixId, versionId } = pjWithState((version) => {
      version.effectiveFrom = future;
    });
    renderMatrixScreen(doc, matrixId, versionId);

    expect(screen.getByText(/^Agendado ·/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Criar rascunho$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Comparar$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportar/ })).toBeInTheDocument();
  });

  it('SUPERSEDED: Comparar, Exportar e Restaurar como rascunho', () => {
    const { doc, matrixId, versionId } = pjWithState((version) => {
      version.state = 'SUPERSEDED';
      version.effectiveTo = new Date().toISOString();
    });
    renderMatrixScreen(doc, matrixId, versionId);

    expect(screen.getByRole('button', { name: /^Comparar$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restaurar como rascunho/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Criar rascunho$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Publicar$/ })).not.toBeInTheDocument();
  });

  it('SUPERSEDED: banner de versão histórica com "Ir para a vigente", e marca d\'água no grid (S15)', async () => {
    const user = userEvent.setup();
    const doc = createSampleDocument();
    const matrix = matrixByCode(doc, 'MTZ_LIMITE_PJ');
    const published = matrix.versions.find((version) => version.state === 'PUBLISHED')!;
    // Torna a v1 histórica e injeta uma v2 vigente, para exercitar "Ir para a vigente".
    published.state = 'SUPERSEDED';
    published.effectiveTo = new Date().toISOString();
    const v2: MatrixVersion = {
      ...published,
      id: 'v2-vigente-hoje',
      number: 2,
      state: 'PUBLISHED',
      effectiveFrom: published.effectiveTo,
    };
    delete v2.effectiveTo;
    matrix.versions.push(v2);

    renderMatrixScreen(doc, matrix.id, published.id);

    const banner = screen.getByTestId('historical-banner');
    expect(banner).toHaveTextContent(/versão histórica/);
    expect(banner).toHaveTextContent(`versão ${published.number}`);
    expect(screen.getByTestId('historical-watermark')).toHaveTextContent('HISTÓRICO');

    await user.click(within(banner).getByRole('button', { name: 'Ir para a vigente' }));
    expect(screen.getByLabelText('Selecionar versão')).toHaveTextContent('v2');
    expect(screen.queryByTestId('historical-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('historical-watermark')).not.toBeInTheDocument();
  });
});
