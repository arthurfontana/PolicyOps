// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectDetail } from '@/components/projects/ProjectDetail';
import { Toaster } from '@/components/ui/toaster';
import type { Command } from '@/core/command';
import { createSampleDocument } from '@/core/document/create';
import { setMatrixTags } from '@/core/document/commands';
import { createCatalogItem } from '@/core/library/catalog';
import { createMatrix } from '@/core/versioning/lifecycle';
import { useDocumentStore } from '@/store/document-store';
import { useUiStore } from '@/store/ui-store';

/**
 * Lista de matrizes com filtro por facetas — docs/07-ux-e-editor.md §15.
 * Monta um projeto com 3 matrizes marcadas com combinações diferentes de
 * Canal × Cluster, além de uma sem tag nenhuma.
 */

function dispatch<O>(command: Command<unknown, O>): O {
  const result = useDocumentStore.getState().dispatch(command);
  if (!result.ok) throw new Error(`Comando falhou: ${result.error.code} — ${result.error.message}`);
  return result.data;
}

function setupTaggedProject(): { projectId: string } {
  const doc = createSampleDocument();
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');

  const projectId = doc.projects.find((p) => p.code === 'POLITICA_PF')!.id;
  const scoreId = doc.variables.find((v) => v.code === 'SCORE_HVI3')!.id;
  const restritivoId = doc.variables.find((v) => v.code === 'RESTRITIVO')!.id;

  for (const [code, group] of [
    ['CANAL_DIGITAL', 'Canal'],
    ['CANAL_URA', 'Canal'],
    ['CLUSTER_G4', 'Cluster'],
    ['CLUSTER_G1', 'Cluster'],
  ] as const) {
    dispatch(createCatalogItem({ kind: 'TAG', code, label: code, group }));
  }

  function makeMatrix(code: string, tags: string[]): void {
    const { matrixId } = dispatch<{ matrixId: string }>(
      createMatrix({
        projectId,
        code,
        name: code,
        x: { levels: [{ variableId: scoreId }] },
        y: { levels: [{ variableId: restritivoId }] },
      }),
    );
    if (tags.length > 0) dispatch(setMatrixTags({ matrixId, add: tags }));
  }

  makeMatrix('MTZ_DIGITAL_G4', ['CANAL_DIGITAL', 'CLUSTER_G4']);
  makeMatrix('MTZ_URA_G4', ['CANAL_URA', 'CLUSTER_G4']);
  makeMatrix('MTZ_DIGITAL_G1', ['CANAL_DIGITAL', 'CLUSTER_G1']);

  return { projectId };
}

function renderProject(projectId: string) {
  return render(
    <>
      <ProjectDetail projectId={projectId} />
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useUiStore.setState({ matrixFilter: { projectId: null, tags: [], search: '' } });
});

describe('ProjectDetail — filtro por facetas de tag', () => {
  it('filtrar por duas facetas (Canal e Cluster) deixa só quem tem as duas', async () => {
    const user = userEvent.setup();
    const { projectId } = setupTaggedProject();
    renderProject(projectId);

    // As 4 matrizes do projeto aparecem inicialmente (a original de exemplo + as 3 novas).
    expect(screen.getByRole('button', { name: /MTZ_DIGITAL_G4/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /MTZ_URA_G4/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /MTZ_DIGITAL_G1/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /CANAL_DIGITAL/ }));
    await user.click(screen.getByRole('button', { name: /CLUSTER_G4/ }));

    expect(screen.getByRole('button', { name: /MTZ_DIGITAL_G4/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MTZ_URA_G4/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MTZ_DIGITAL_G1/ })).not.toBeInTheDocument();
  });

  it('limpar tudo devolve a lista completa', async () => {
    const user = userEvent.setup();
    const { projectId } = setupTaggedProject();
    renderProject(projectId);

    await user.click(screen.getByRole('button', { name: /CANAL_DIGITAL/ }));
    expect(screen.queryByRole('button', { name: /MTZ_URA_G4/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpar tudo' }));

    expect(screen.getByRole('button', { name: /MTZ_DIGITAL_G4/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /MTZ_URA_G4/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /MTZ_DIGITAL_G1/ })).toBeInTheDocument();
  });
});
