// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChangeRequestTimelineScreen } from '@/components/change-requests/ChangeRequestTimelineScreen';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Command } from '@/core/command';
import { addChangeRequestItem, createChangeRequest, transitionChangeRequest, updateChangeRequest } from '@/core/document/change-requests';
import { linkChangeRequestDraft } from '@/core/document/cr-drafts';
import { publishChangeRequest } from '@/core/document/cr-publish';
import { createComponent } from '@/core/document/components';
import { createSampleDocument } from '@/core/document/create';
import { createCatalogItem } from '@/core/library/catalog';
import { createComponentDraft, publishComponentVersion } from '@/core/versioning/component-lifecycle';
import type { CrStatus } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/** Timeline do Diário de Bordo (US-GOV-08 parcial, S37) — só DBs publicados aparecem, mais recente primeiro. */

function dispatch<O>(command: Command<unknown, O>): O {
  const result = useDocumentStore.getState().dispatch(command);
  if (!result.ok) throw new Error(`Comando falhou: ${result.error.code} — ${result.error.message}`);
  return result.data;
}

const CAMINHO_ATE_READY: readonly CrStatus[] = [
  'SUBMITTED',
  'IN_REVIEW',
  'APPROVED',
  'IN_DEVELOPMENT',
  'IN_VALIDATION',
  'READY_FOR_RELEASE',
];

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useEditorStore.getState().reset();
  useUiStore.getState().setView('db-timeline');
});

describe('ChangeRequestTimelineScreen', () => {
  it('mostra só DBs publicados, com componentes afetados e link para abrir', async () => {
    const user = userEvent.setup();
    const doc = createSampleDocument();
    useDocumentStore.getState().openDocument(doc);
    useDocumentStore.getState().setActor('Gestor de Teste');
    const projectId = doc.projects.find((p) => p.code === 'POLITICA_PF')!.id;

    dispatch(createCatalogItem({ kind: 'MOTIVATOR', code: 'RISCO', label: 'Risco' }));
    const componentId = dispatch(
      createComponent({ projectId, code: 'REGRA_GOODLIST', name: 'Goodlist', type: 'RULE' }),
    ).componentId;
    const v1 = dispatch(
      createComponentDraft({ componentId, payload: { kind: 'RULE', businessDescription: 'v1.' } }),
    ).versionId;
    dispatch(publishComponentVersion({ versionId: v1, effectiveFrom: '2026-01-01T00:00:00.000Z' }));

    const changeRequestId = dispatch(
      createChangeRequest({ code: 'DB_515', title: 'Goodlist muda', proposedEffectiveDate: '2026-09-01T00:00:00.000Z' }),
    ).changeRequestId;
    dispatch(updateChangeRequest({ changeRequestId, motivators: ['RISCO'] }));
    dispatch(addChangeRequestItem({ changeRequestId, componentId, changeType: 'UPDATE', proposedSummary: 'Proposta.' }));
    dispatch(linkChangeRequestDraft({ changeRequestId, componentId, payload: { kind: 'RULE', businessDescription: 'Proposta.' } }));
    for (const to of CAMINHO_ATE_READY) dispatch(transitionChangeRequest({ changeRequestId, to }));
    dispatch(publishChangeRequest({ changeRequestId }));

    // Um segundo DB, ainda não publicado — não deve aparecer.
    dispatch(createChangeRequest({ code: 'DB_600', title: 'Ainda em rascunho' }));

    render(
      <TooltipProvider>
        <ChangeRequestTimelineScreen />
        <Toaster />
      </TooltipProvider>,
    );

    expect(await screen.findByText('Goodlist muda')).toBeInTheDocument();
    expect(screen.getByText('DB_515')).toBeInTheDocument();
    expect(screen.getByText('Goodlist')).toBeInTheDocument();
    expect(screen.queryByText('DB_600')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Abrir o DB/ }));
    expect(useEditorStore.getState().selectedChangeRequestId).toBe(changeRequestId);
    expect(useUiStore.getState().view).toBe('change-requests');
  });

  it('sem nenhum DB publicado, mostra o vazio', () => {
    const doc = createSampleDocument();
    useDocumentStore.getState().openDocument(doc);

    render(
      <TooltipProvider>
        <ChangeRequestTimelineScreen />
        <Toaster />
      </TooltipProvider>,
    );

    expect(screen.getByText(/Nenhum DB publicado ainda/)).toBeInTheDocument();
  });
});
