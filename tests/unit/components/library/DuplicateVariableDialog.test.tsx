// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DuplicateVariableDialog } from '@/components/library/DuplicateVariableDialog';
import { createSampleDocument } from '@/core/document/create';
import { useDocumentStore } from '@/store/document-store';

/**
 * "Criar a partir de existente" — docs/07-ux-e-editor.md §11, docs/05 §5.6.3.
 */
function setup() {
  const doc = createSampleDocument();
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  return doc;
}

describe('DuplicateVariableDialog', () => {
  beforeEach(() => {
    useDocumentStore.getState().closeDocument();
  });

  it('duplica uma variável RANGE existente com os mesmos domínios, em DRAFT', async () => {
    const user = userEvent.setup();
    const doc = setup();
    const source = doc.variables.find((v) => v.code === 'FAT')!;
    const onCreated = vi.fn();

    render(<DuplicateVariableDialog open onOpenChange={() => {}} onCreated={onCreated} />);

    await user.click(screen.getByRole('combobox', { name: /Variável de origem/ }));
    await user.click(await screen.findByRole('option', { name: new RegExp(source.code) }));

    // Versão já vem pré-selecionada (a mais recente) — só preenche o resto.
    await user.type(screen.getByLabelText('Código da nova variável'), 'FAT2');
    await user.type(screen.getByLabelText('Nome'), 'Faturamento 2');
    await user.click(screen.getByRole('button', { name: 'Criar variável' }));

    expect(onCreated).toHaveBeenCalledTimes(1);
    const newVariableId = onCreated.mock.calls[0]![0] as string;
    const created = useDocumentStore.getState().document!.variables.find((v) => v.id === newVariableId)!;
    expect(created.code).toBe('FAT2');
    expect(created.type).toBe('RANGE');
    expect(created.versions[0]!.state).toBe('DRAFT');
    expect(created.versions[0]!.domains).toEqual(source.versions.find((v) => v.state === 'PUBLISHED')!.domains);

    // A origem não foi tocada.
    const untouchedSource = useDocumentStore.getState().document!.variables.find((v) => v.id === source.id)!;
    expect(untouchedSource).toEqual(source);
  });

  it('mostra erro de código duplicado sem fechar o diálogo', async () => {
    const user = userEvent.setup();
    const doc = setup();
    const source = doc.variables.find((v) => v.code === 'FAT')!;
    const onCreated = vi.fn();

    render(<DuplicateVariableDialog open onOpenChange={() => {}} onCreated={onCreated} />);

    await user.click(screen.getByRole('combobox', { name: /Variável de origem/ }));
    await user.click(await screen.findByRole('option', { name: new RegExp(source.code) }));
    await user.type(screen.getByLabelText('Código da nova variável'), 'SCORE_HVI3');
    await user.type(screen.getByLabelText('Nome'), 'Duplicada');
    await user.click(screen.getByRole('button', { name: 'Criar variável' }));

    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Código da nova variável')).toBeInTheDocument();
  });
});
