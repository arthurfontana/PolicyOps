// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MatrixTagsEditor } from '@/components/inspector/MatrixTagsEditor';
import { Toaster } from '@/components/ui/toaster';
import { createSampleDocument } from '@/core/document/create';
import { useDocumentStore } from '@/store/document-store';

/**
 * Inspector da matriz — docs/07-ux-e-editor.md §15: criação inline de tag
 * pelo campo de tags, com seletor de grupo.
 */

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useDocumentStore.getState().openDocument(createSampleDocument());
  useDocumentStore.getState().setActor('Teste');
});

/** Espelha `VersionInspector`: lê a matriz do store a cada render, em vez de receber um snapshot estático. */
function ReactiveEditor() {
  const matrix = useDocumentStore((s) => s.document!.matrices[0]!);
  return <MatrixTagsEditor matrix={matrix} />;
}

function renderEditor() {
  return render(
    <>
      <ReactiveEditor />
      <Toaster />
    </>,
  );
}

describe('MatrixTagsEditor — criação inline', () => {
  it('cria uma tag nova pelo campo de busca e marca a matriz, criando o CatalogItem', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: /Tag/ }));
    const input = screen.getByPlaceholderText('Buscar ou criar tag…');
    await user.type(input, 'Prioritária');

    expect(screen.getByText('Criar tag «Prioritária»')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Criar e marcar/ }));

    const doc = useDocumentStore.getState().document!;
    const created = doc.catalog.find((item) => item.kind === 'TAG' && item.label === 'Prioritária');
    expect(created).toBeDefined();
    expect(doc.matrices[0]!.tags).toContain(created!.code);
    expect(screen.getByText('Prioritária')).toBeInTheDocument();
  });

  it('criar com grupo grava o group no CatalogItem', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: /Tag/ }));
    await user.type(screen.getByPlaceholderText('Buscar ou criar tag…'), 'Digital');
    await user.type(screen.getByLabelText('Grupo (opcional)'), 'Canal');
    await user.click(screen.getByRole('button', { name: /Criar e marcar/ }));

    const doc = useDocumentStore.getState().document!;
    const created = doc.catalog.find((item) => item.kind === 'TAG' && item.label === 'Digital');
    expect(created?.group).toBe('Canal');
  });

  it('remover o chip da matriz não apaga o CatalogItem', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: /Tag/ }));
    await user.type(screen.getByPlaceholderText('Buscar ou criar tag…'), 'Sazonal');
    await user.click(screen.getByRole('button', { name: /Criar e marcar/ }));

    let doc = useDocumentStore.getState().document!;
    const created = doc.catalog.find((item) => item.kind === 'TAG' && item.label === 'Sazonal')!;

    await user.click(screen.getByRole('button', { name: `Remover a tag ${created.label}` }));

    doc = useDocumentStore.getState().document!;
    expect(doc.matrices[0]!.tags ?? []).not.toContain(created.code);
    expect(doc.catalog.some((item) => item.id === created.id)).toBe(true);
  });
});
