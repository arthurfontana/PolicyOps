// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CellInspector } from '@/components/inspector/CellInspector';
import { createSampleDocument } from '@/core/document/create';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

/**
 * Inspector de célula — limite em faixa (S45, docs/07 seção do componente de
 * Limite): alternância "Valor único" / "Faixa (mín/máx)" sem perder dado
 * entre trocas, antes de salvar.
 */

const CELL_KEY = 'R1::SEM';

function findDraftVersionId(): string {
  const doc = useDocumentStore.getState().document!;
  const matrix = doc.matrices.find((m) => m.code === 'MTZ_LIMITE_PF')!;
  return matrix.versions.find((v) => v.state === 'DRAFT')!.id;
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useDocumentStore.getState().openDocument(createSampleDocument());
  useDocumentStore.getState().setActor('Teste');
  useEditorStore.getState().reset();
  useEditorStore.getState().setVersion(findDraftVersionId());
  useEditorStore.getState().setEditable(true);
});

function renderInspector() {
  return render(<CellInspector selection={new Set([CELL_KEY])} />);
}

describe('CellInspector — limite em faixa (mín/máx)', () => {
  it('alterna entre Valor único e Faixa sem perder o que foi digitado em cada modo', async () => {
    const user = userEvent.setup();
    renderInspector();

    await user.click(screen.getByRole('combobox', { name: 'Modo de limite' }));
    await user.click(screen.getByRole('option', { name: 'Faixa (mín/máx)' }));

    await user.type(screen.getByLabelText('Limite mínimo'), '500');
    await user.type(screen.getByLabelText('Limite máximo'), '5000');

    await user.click(screen.getByRole('combobox', { name: 'Modo de limite' }));
    await user.click(screen.getByRole('option', { name: 'Valor único' }));
    expect(screen.getByPlaceholderText('Valor específico (BRL)')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Modo de limite' }));
    await user.click(screen.getByRole('option', { name: 'Faixa (mín/máx)' }));

    expect(screen.getByLabelText('Limite mínimo')).toHaveValue('500');
    expect(screen.getByLabelText('Limite máximo')).toHaveValue('5000');
  });

  it('grava limitMin/limitMax na célula ao aplicar', async () => {
    const user = userEvent.setup();
    renderInspector();

    await user.click(screen.getByRole('combobox', { name: 'Modo de limite' }));
    await user.click(screen.getByRole('option', { name: 'Faixa (mín/máx)' }));
    await user.type(screen.getByLabelText('Limite mínimo'), '500');
    await user.type(screen.getByLabelText('Limite máximo'), '5000');

    await user.click(screen.getByRole('button', { name: /Aplicar a 1 célula/ }));

    const versionId = findDraftVersionId();
    const doc = useDocumentStore.getState().document!;
    const matrix = doc.matrices.find((m) => m.code === 'MTZ_LIMITE_PF')!;
    const version = matrix.versions.find((v) => v.id === versionId)!;
    expect(version.cells[CELL_KEY]).toMatchObject({ limitMin: '500', limitMax: '5000' });
  });
});
