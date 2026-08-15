// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MoveComponentDialog } from '@/components/tree/MoveComponentDialog';
import { Toaster } from '@/components/ui/toaster';
import type { Command } from '@/core/command';
import { createComponent } from '@/core/document/components';
import { createSampleDocument } from '@/core/document/create';
import { useDocumentStore } from '@/store/document-store';

/**
 * "Mover para…" (docs/07-ux-e-editor.md §17.3): o destino nunca oferece a
 * própria subárvore — é o que impede o usuário de sequer tentar um ciclo
 * (I28) pela interface, antes do `component/move` precisar recusar.
 */

function dispatch<O>(command: Command<unknown, O>): O {
  const result = useDocumentStore.getState().dispatch(command);
  if (!result.ok) throw new Error(`Comando falhou: ${result.error.code} — ${result.error.message}`);
  return result.data;
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
});

function setup() {
  const doc = createSampleDocument();
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  const projectId = doc.projects.find((p) => p.code === 'POLITICA_PF')!.id;

  const cma = dispatch(createComponent({ projectId, code: 'CMA', name: 'CMA', type: 'SECTION' })).componentId;
  const fraude = dispatch(
    createComponent({ projectId, code: 'FRAUDE', name: 'Fraude', type: 'SECTION', parentId: cma }),
  ).componentId;
  const grupos = dispatch(
    createComponent({ projectId, code: 'GRUPOS', name: 'Grupos', type: 'SECTION' }),
  ).componentId;

  return { projectId, cma, fraude, grupos };
}

describe('MoveComponentDialog', () => {
  it('não oferece o próprio nó nem seus descendentes como destino', async () => {
    const user = userEvent.setup();
    const { cma, fraude, grupos } = setup();

    render(
      <>
        <MoveComponentDialog open onOpenChange={() => {}} componentId={cma} />
        <Toaster />
      </>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Destino' }));

    // "Grupos" (outro ramo) é destino válido; "CMA" e "Fraude" (ele mesmo e
    // seu filho) nunca aparecem — mover CMA para dentro de si mesmo é ciclo.
    expect(screen.getByRole('option', { name: 'Grupos' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'CMA' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'CMA › Fraude' })).not.toBeInTheDocument();
    expect(fraude).toBeTruthy();
    expect(grupos).toBeTruthy();
  });
});
