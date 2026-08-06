// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { AxisEditor } from '@/components/editor/AxisEditor';
import { Toaster } from '@/components/ui/toaster';
import { createSampleDocument } from '@/core/document/create';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { getEditorView } from '@/core/queries';
import { addLevelCommand } from '@/core/versioning/axis-commands';
import { applyCellPatch } from '@/core/versioning/cells';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

/**
 * O construtor de eixos editável do inspector — docs/07 §7. O que precisa
 * valer no navegador: nada é aplicado sem o diálogo de preview, e o preview
 * conta a verdade em português.
 */

function draftVersionId(doc: PolicyOpsDocument, matrixCode: string): string {
  const matrix = doc.matrices.find((candidate) => candidate.code === matrixCode)!;
  return matrix.versions.find((version) => version.state === 'DRAFT')!.id;
}

function openDocument(): { doc: PolicyOpsDocument; versionId: string } {
  const doc = createSampleDocument();
  // A v2 de MTZ_LIMITE_PF é rascunho: 6 tuplas de Score × 4 de Restritivo.
  const versionId = draftVersionId(doc, 'MTZ_LIMITE_PF');
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  useEditorStore.getState().openMatrix(
    doc.matrices.find((candidate) => candidate.code === 'MTZ_LIMITE_PF')!.id,
    versionId,
  );
  return { doc, versionId };
}

function renderEditor(versionId: string) {
  const doc = useDocumentStore.getState().document!;
  return render(
    <>
      <AxisEditor role="X" view={getEditorView(doc, versionId)} stale={false} />
      <Toaster />
    </>,
  );
}

describe('AxisEditor', () => {
  beforeEach(() => {
    useDocumentStore.getState().closeDocument();
  });

  it('lista os níveis do eixo e oferece adicionar', () => {
    const { versionId } = openDocument();
    renderEditor(versionId);

    expect(screen.getByText('Score HVI3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Adicionar nível/ })).toBeEnabled();
    // Eixo de um nível só: remover deixaria a matriz sem eixo.
    expect(screen.getByRole('button', { name: /Remover o nível "Score HVI3"/ })).toBeDisabled();
  });

  it('adicionar nível só aplica depois do preview, e o preview conta o impacto', async () => {
    const user = userEvent.setup();
    const { versionId } = openDocument();
    renderEditor(versionId);

    await user.click(screen.getByRole('button', { name: /Adicionar nível/ }));

    const dialog = screen.getByRole('dialog');
    // Antes de escolher a variável não há preview nem como aplicar.
    expect(within(dialog).queryByTestId('add-level-preview')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Adicionar nível' })).toBeDisabled();

    await user.click(within(dialog).getAllByRole('combobox')[0]!);
    await user.click(await screen.findByRole('option', { name: /Tempo de Empresa/ }));

    const preview = await within(dialog).findByTestId('add-level-preview');
    // 6 × 4 = 24 combinações; com Tempo de Empresa (4 domínios) viram 96.
    expect(preview).toHaveTextContent('24 combinações viram 96');
    expect(within(dialog).getByTestId('grid-miniature')).toBeInTheDocument();

    // Nada foi aplicado ainda: o documento continua com 6 tuplas em X.
    expect(useDocumentStore.getState().document!.matrices[0]!.versions[1]!.axes.x.tuples).toHaveLength(6);

    await user.click(within(dialog).getByRole('button', { name: 'Adicionar nível' }));

    const axis = useDocumentStore.getState().document!.matrices[0]!.versions[1]!.axes.x;
    expect(axis.tuples).toHaveLength(24);
    expect(axis.levels.map((level) => level.label)).toEqual(['Score HVI3', 'Tempo de Empresa']);
    // REPLICATE é o padrão: nada ficou pendente.
    expect(await screen.findByText(/Nenhuma combinação ficou pendente/)).toBeInTheDocument();
    // E as combinações novas ficam selecionadas.
    expect(useEditorStore.getState().selection.size).toBe(96);
  });

  it('remover nível exige digitar o nome do nível quando há descarte', async () => {
    const user = userEvent.setup();
    const { versionId } = openDocument();

    // O nível já entra pelo comando: o que este teste verifica é a remoção.
    const tempoEmpresa = useDocumentStore
      .getState()
      .document!.variables.find((variable) => variable.code === 'TEMPO_EMPRESA')!;
    useDocumentStore
      .getState()
      .dispatch(addLevelCommand({ versionId, role: 'X', variableId: tempoEmpresa.id, position: 1 }));
    // Uma célula divergente dentro do grupo: sem unanimidade, há descarte.
    useDocumentStore.getState().dispatch(
      applyCellPatch({
        versionId,
        patch: { coords: [{ xPath: 'R1|ATE_6M', yPath: 'SEM' }], set: { decision: 'REPROVADO' } },
      }),
    );

    renderEditor(versionId);
    await user.click(screen.getByRole('button', { name: /Remover o nível "Tempo de Empresa"/ }));

    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByTestId('remove-level-preview')).toHaveTextContent(
      '96 combinações viram 24',
    );
    const confirmar = within(dialog).getByRole('button', { name: 'Remover nível' });
    expect(confirmar).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/digite o nome do nível/i), 'Tempo de Empresa');
    expect(confirmar).toBeEnabled();
  });
});
