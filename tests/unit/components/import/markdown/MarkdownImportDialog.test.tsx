// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MarkdownImportDialog } from '@/components/import/markdown/MarkdownImportDialog';
import { Toaster } from '@/components/ui/toaster';
import { createComponent } from '@/core/document/components';
import { createSampleDocument } from '@/core/document/create';
import { useDocumentStore } from '@/store/document-store';

/**
 * Assistente de carga por recorte (S40, docs/14 §9) — cobertura de UI: colar
 * texto → revisar → confirmar cria os componentes; excluir uma linha na
 * revisão a mantém fora da carga.
 */

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
});

function setup() {
  const doc = createSampleDocument();
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  const projectId = doc.projects.find((p) => p.code === 'POLITICA_PF')!.id;
  return { projectId };
}

const MARKDOWN = ['# Bloqueios por Dívida', 'Texto de negócio.', '> Tipo: SECTION', '## Dívida Alta', 'Bloqueia acima de 5 mil.'].join('\n');

describe('MarkdownImportDialog', () => {
  it('colar → revisar → confirmar cria a hierarquia inteira, publicada e PENDING_REVIEW', async () => {
    const { projectId } = setup();
    const user = userEvent.setup();
    render(
      <>
        <MarkdownImportDialog open onOpenChange={() => {}} projectId={projectId} onImported={() => {}} />
        <Toaster />
      </>,
    );

    await user.type(screen.getByLabelText('Texto em Markdown'), MARKDOWN);
    await user.click(screen.getByRole('button', { name: 'Avançar' }));

    expect(await screen.findByText(/2 de 2 linha\(s\) selecionada\(s\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Avançar' }));

    await user.click(screen.getByRole('button', { name: 'Confirmar carga' }));

    expect(await screen.findByText(/2 componente\(s\) carregado\(s\) e publicado\(s\)\./)).toBeInTheDocument();

    const doc = useDocumentStore.getState().document!;
    const created = doc.components.filter((c) => c.projectId === projectId);
    expect(created).toHaveLength(2);
    expect(created.every((c) => c.reviewStatus === 'PENDING_REVIEW')).toBe(true);
    expect(created.every((c) => c.versions[0]?.state === 'PUBLISHED')).toBe(true);
  });

  it('excluir uma linha na revisão a mantém fora da carga', async () => {
    const { projectId } = setup();
    const user = userEvent.setup();
    render(
      <>
        <MarkdownImportDialog open onOpenChange={() => {}} projectId={projectId} onImported={() => {}} />
        <Toaster />
      </>,
    );

    await user.type(screen.getByLabelText('Texto em Markdown'), MARKDOWN);
    await user.click(screen.getByRole('button', { name: 'Avançar' }));

    const checkbox = await screen.findByRole('checkbox', { name: 'Incluir "Dívida Alta" na carga' });
    await user.click(checkbox);
    expect(screen.getByText(/1 de 2 linha\(s\) selecionada\(s\)/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar carga' }));

    expect(await screen.findByText(/1 componente\(s\) carregado\(s\) e publicado\(s\)\./)).toBeInTheDocument();
    const doc = useDocumentStore.getState().document!;
    expect(doc.components.filter((c) => c.projectId === projectId)).toHaveLength(1);
  });

  it('destino pré-selecionado por "Carregar Markdown aqui…" entra sob o nó escolhido', async () => {
    const { projectId } = setup();
    const created = useDocumentStore
      .getState()
      .dispatch(createComponent({ projectId, code: 'SECAO_MAO', name: 'Seção à Mão', type: 'SECTION' }));
    expect(created.ok).toBe(true);
    const parentId = created.ok ? created.data.componentId : '';

    const user = userEvent.setup();
    render(
      <>
        <MarkdownImportDialog
          open
          onOpenChange={() => {}}
          projectId={projectId}
          initialParentId={parentId}
          onImported={() => {}}
        />
        <Toaster />
      </>,
    );

    await user.type(screen.getByLabelText('Texto em Markdown'), '# Regra\nTexto.');
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar carga' }));

    await screen.findByText(/1 componente\(s\) carregado\(s\) e publicado\(s\)\./);
    const doc = useDocumentStore.getState().document!;
    const regra = doc.components.find((c) => c.code === 'REGRA')!;
    expect(regra.parentId).toBe(parentId);
  });
});
