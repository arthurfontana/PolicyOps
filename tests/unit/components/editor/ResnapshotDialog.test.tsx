// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { AxisEditor } from '@/components/editor/AxisEditor';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createSampleDocument } from '@/core/document/create';
import type { Domain, PolicyOpsDocument } from '@/core/document/schema';
import {
  createVariableDraft,
  publishVariable,
  saveVariableDomains,
} from '@/core/library/variables';
import { getEditorView } from '@/core/queries';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

/**
 * Badge de defasagem e diálogo de reconciliação no inspector —
 * docs/05-regras-de-negocio.md §5.2 e §5.3, docs/prompts/S16 item 4.
 *
 * O que precisa valer no navegador: o badge diz **qual** versão está pinada e
 * qual está disponível; nada é gravado antes do preview; e o descarte exige
 * digitar o nome do eixo.
 */

function draftOf(doc: PolicyOpsDocument, matrixCode: string): string {
  const matrix = doc.matrices.find((candidate) => candidate.code === matrixCode)!;
  return matrix.versions.find((version) => version.state === 'DRAFT')!.id;
}

/** Publica uma v2 de `SCORE_HVI3` com os domínios informados. */
function publishScore(domains: Domain[]): void {
  const store = useDocumentStore.getState();
  const score = store.document!.variables.find((variable) => variable.code === 'SCORE_HVI3')!;
  const draft = store.dispatch(createVariableDraft({ variableId: score.id }));
  const versionId = (draft.ok ? draft.data : { versionId: '' }).versionId;
  useDocumentStore.getState().dispatch(
    saveVariableDomains({ variableId: score.id, versionId, domains }),
  );
  useDocumentStore.getState().dispatch(publishVariable({ variableId: score.id, versionId }));
}

function openSample(): string {
  const doc = createSampleDocument();
  const versionId = draftOf(doc, 'MTZ_LIMITE_PF');
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  useEditorStore
    .getState()
    .openMatrix(doc.matrices.find((candidate) => candidate.code === 'MTZ_LIMITE_PF')!.id, versionId);
  return versionId;
}

function renderEditor(versionId: string) {
  const doc = useDocumentStore.getState().document!;
  const view = getEditorView(doc, versionId);
  return render(
    <TooltipProvider>
      <AxisEditor role="X" view={view} staleness={view.staleness?.x ?? null} />
      <Toaster />
    </TooltipProvider>,
  );
}

/** Os 6 domínios do exemplo, mais os que vierem. */
function scoreDomains(...extra: string[]): Domain[] {
  const base = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', ...extra];
  return base.map((code, position) => ({ code, label: `${code} — rótulo`, position }));
}

describe('badge de defasagem e diálogo de reconciliação', () => {
  beforeEach(() => {
    useDocumentStore.getState().closeDocument();
  });

  it('sem defasagem, não há badge nem botão de atualizar', () => {
    const versionId = openSample();
    renderEditor(versionId);
    expect(screen.queryByTestId('stale-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resnapshot-X')).not.toBeInTheDocument();
  });

  it('o badge diz qual versão está pinada e qual está disponível', () => {
    const versionId = openSample();
    publishScore(scoreDomains('R7'));
    renderEditor(versionId);

    const badge = screen.getByTestId('stale-badge');
    expect(badge).toHaveTextContent('Score HVI3 — v1 pinada, v2 disponível');
    expect(screen.getByTestId('resnapshot-X')).toBeEnabled();
  });

  it('o preview abre sem gravar nada e conta as células novas', async () => {
    const user = userEvent.setup();
    const versionId = openSample();
    publishScore(scoreDomains('R7'));
    renderEditor(versionId);

    await user.click(screen.getByTestId('resnapshot-X'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('resnapshot-added')).toHaveTextContent(
      'Gera 4 células novas que você precisará preencher',
    );
    // Nada aplicado: o eixo X do documento continua com 6 tuplas.
    const axis = useDocumentStore.getState().document!.matrices[0]!.versions[1]!.axes.x;
    expect(axis.tuples).toHaveLength(6);

    await user.click(within(dialog).getByRole('button', { name: 'Atualizar eixo' }));

    const depois = useDocumentStore.getState().document!.matrices[0]!.versions[1]!.axes.x;
    expect(depois.tuples).toHaveLength(7);
    // As combinações novas ficam selecionadas (4 tuplas em Y × 1 nova em X).
    expect(useEditorStore.getState().selection.size).toBe(4);
    expect(await screen.findByText(/4 combinações precisam ser preenchidas/)).toBeInTheDocument();
  });

  it('havendo descarte, exige digitar o nome do eixo antes de aplicar', async () => {
    const user = userEvent.setup();
    const versionId = openSample();
    // v2 sem R6: as 4 células de R6 seriam descartadas.
    publishScore(scoreDomains().slice(0, 5));
    renderEditor(versionId);

    await user.click(screen.getByTestId('resnapshot-X'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('resnapshot-removed')).toHaveTextContent(
      '4 células serão descartadas',
    );
    expect(within(dialog).getByTestId('resnapshot-removed')).toHaveTextContent(
      'o conteúdo fica registrado na auditoria',
    );

    const aplicar = within(dialog).getByRole('button', { name: 'Atualizar eixo' });
    expect(aplicar).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/digite o nome do eixo/i), 'Eixo X');
    expect(aplicar).toBeEnabled();
  });
});
