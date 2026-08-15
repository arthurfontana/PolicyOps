// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AddMatrixNodeDialog } from '@/components/tree/AddMatrixNodeDialog';
import { Toaster } from '@/components/ui/toaster';
import type { Command } from '@/core/command';
import { createComponent } from '@/core/document/components';
import { createSampleDocument } from '@/core/document/create';
import { createMatrix } from '@/core/versioning/lifecycle';
import { useDocumentStore } from '@/store/document-store';

/**
 * Seletor de matriz para o nó `MATRIX` (docs/07-ux-e-editor.md §17.2, I27):
 * só oferece matrizes do projeto ainda não referenciadas na árvore.
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

  const livre = dispatch(
    createMatrix({
      projectId,
      code: 'MTZ_LIVRE',
      name: 'Matriz Livre',
      x: { levels: [{ variableId: doc.variables.find((v) => v.code === 'SCORE_HVI3')!.id }] },
      y: { levels: [{ variableId: doc.variables.find((v) => v.code === 'RESTRITIVO')!.id }] },
    }),
  );
  const pendurada = dispatch(
    createMatrix({
      projectId,
      code: 'MTZ_PENDURADA',
      name: 'Matriz Pendurada',
      x: { levels: [{ variableId: doc.variables.find((v) => v.code === 'SCORE_HVI3')!.id }] },
      y: { levels: [{ variableId: doc.variables.find((v) => v.code === 'RESTRITIVO')!.id }] },
    }),
  );
  dispatch(
    createComponent({
      projectId,
      code: 'NODE_PENDURADA',
      name: 'Matriz Pendurada',
      type: 'MATRIX',
      matrixId: pendurada.matrixId,
    }),
  );

  return { projectId, livreMatrixId: livre.matrixId, penduradaMatrixId: pendurada.matrixId };
}

describe('AddMatrixNodeDialog', () => {
  it('lista só a matriz ainda não referenciada na árvore', () => {
    const { projectId } = setup();
    render(
      <>
        <AddMatrixNodeDialog
          open
          onOpenChange={() => {}}
          projectId={projectId}
          parentId={undefined}
          onCreated={() => {}}
        />
        <Toaster />
      </>,
    );

    expect(screen.getByRole('option', { name: /Matriz Livre/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /MTZ_PENDURADA/ })).not.toBeInTheDocument();
  });
});
