// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ComparisonBoardScreen } from '@/components/compare/ComparisonBoardScreen';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createSampleDocument } from '@/core/document/create';
import type { Matrix, PolicyOpsDocument } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/**
 * Board de comparação — docs/07-ux-e-editor.md §9b. Diferente do `compare`
 * (S14, duas versões da mesma matriz), aqui é um conjunto arbitrário de
 * matrizes fixadas em `boardItems`, cada uma inteira, lado a lado.
 */

function matrixByCode(doc: PolicyOpsDocument, code: string): Matrix {
  const matrix = doc.matrices.find((candidate) => candidate.code === code);
  if (matrix === undefined) throw new Error(`Matriz ${code} não existe no exemplo.`);
  return matrix;
}

/**
 * Abrir documento dispara o reset do editor-store (id de documento mudou —
 * `src/store/editor-store.ts`, guarda contra ids obsoletos), então os
 * `pinToBoard` só podem vir **depois** do `openDocument`.
 */
function renderBoard(doc: PolicyOpsDocument, pins: { matrixId: string; versionId: string }[] = []) {
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  for (const pin of pins) useEditorStore.getState().pinToBoard(pin.matrixId, pin.versionId);
  return render(
    <TooltipProvider>
      <ComparisonBoardScreen />
    </TooltipProvider>,
  );
}

describe('ComparisonBoardScreen', () => {
  beforeEach(() => {
    useDocumentStore.getState().closeDocument();
    useEditorStore.getState().reset();
    useUiStore.getState().setPresentationMode(false);
  });

  it('sem nada fixado, mostra o estado vazio com atalho para projetos', () => {
    const doc = createSampleDocument();
    renderBoard(doc);

    expect(screen.getByText(/Nada fixado ainda/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir para projetos' })).toBeInTheDocument();
  });

  it('uma coluna por matriz fixada, com grid e cabeçalho', () => {
    const doc = createSampleDocument();
    const pf = matrixByCode(doc, 'MTZ_LIMITE_PF');
    const pj = matrixByCode(doc, 'MTZ_LIMITE_PJ');
    const pfVersion = pf.versions.find((v) => v.state === 'PUBLISHED')!;
    const pjVersion = pj.versions[0]!;

    renderBoard(doc, [
      { matrixId: pf.id, versionId: pfVersion.id },
      { matrixId: pj.id, versionId: pjVersion.id },
    ]);

    expect(screen.getByText('2 de 6 fixadas')).toBeInTheDocument();
    expect(screen.getAllByRole('grid')).toHaveLength(2);
    expect(screen.getByText(pf.name)).toBeInTheDocument();
    expect(screen.getByText(pj.name)).toBeInTheDocument();
  });

  it('remover uma coluna atualiza o board', async () => {
    const user = userEvent.setup();
    const doc = createSampleDocument();
    const pf = matrixByCode(doc, 'MTZ_LIMITE_PF');
    const pj = matrixByCode(doc, 'MTZ_LIMITE_PJ');
    const pjVersion = pj.versions[0]!;

    renderBoard(doc, [
      { matrixId: pf.id, versionId: pf.versions.find((v) => v.state === 'PUBLISHED')!.id },
      { matrixId: pj.id, versionId: pjVersion.id },
    ]);
    await user.click(screen.getByRole('button', { name: `Remover ${pf.name} da comparação` }));

    expect(useEditorStore.getState().boardItems).toEqual([{ matrixId: pj.id, versionId: pjVersion.id }]);
    expect(screen.getAllByRole('grid')).toHaveLength(1);
  });

  it('"Limpar tudo" pede confirmação e esvazia o board sem afetar o documento', async () => {
    const user = userEvent.setup();
    const doc = createSampleDocument();
    const pf = matrixByCode(doc, 'MTZ_LIMITE_PF');

    renderBoard(doc, [{ matrixId: pf.id, versionId: pf.versions.find((v) => v.state === 'PUBLISHED')!.id }]);
    await user.click(screen.getByRole('button', { name: 'Limpar tudo' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Limpar' }));

    expect(useEditorStore.getState().boardItems).toEqual([]);
    expect(useDocumentStore.getState().document?.matrices.find((m) => m.id === pf.id)).toBeDefined();
  });

  it('"Modo apresentação" liga a flag global de UI', async () => {
    const user = userEvent.setup();
    const doc = createSampleDocument();
    const pf = matrixByCode(doc, 'MTZ_LIMITE_PF');

    renderBoard(doc, [{ matrixId: pf.id, versionId: pf.versions.find((v) => v.state === 'PUBLISHED')!.id }]);
    await user.click(screen.getByRole('button', { name: /Modo apresentação/ }));

    expect(useUiStore.getState().presentationMode).toBe(true);
  });

  it('matriz removida do documento vira card removível em vez de quebrar', () => {
    const doc = createSampleDocument();
    const pf = matrixByCode(doc, 'MTZ_LIMITE_PF');

    renderBoard(doc, [{ matrixId: pf.id, versionId: 'versao-que-nao-existe-mais' }]);

    expect(screen.getByText(/não está mais disponível para comparar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover' })).toBeInTheDocument();
  });
});
