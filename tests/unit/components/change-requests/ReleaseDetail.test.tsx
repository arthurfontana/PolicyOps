// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReleasesScreen } from '@/components/change-requests/ReleasesScreen';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Command } from '@/core/command';
import {
  addChangeRequestItem,
  createChangeRequest,
  transitionChangeRequest,
  updateChangeRequest,
} from '@/core/document/change-requests';
import { linkChangeRequestDraft } from '@/core/document/cr-drafts';
import { createComponent } from '@/core/document/components';
import { createRelease } from '@/core/document/releases';
import { createSampleDocument } from '@/core/document/create';
import { createCatalogItem } from '@/core/library/catalog';
import { createComponentDraft, publishComponentVersion } from '@/core/versioning/component-lifecycle';
import type { CrStatus } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/**
 * Release CRUD, publicação e leitura na timeline (S37, docs/07 §19.6/§19.7,
 * docs/14 §3.4). O workflow do DB e a publicação individual já são 100%
 * testados em `cr-workflow.test.ts`/`cr-publish.test.ts`/`ChangeRequestDetail.test.tsx`
 * — aqui é só a integração release → tela.
 */

function dispatch<O>(command: Command<unknown, O>): O {
  const result = useDocumentStore.getState().dispatch(command);
  if (!result.ok) throw new Error(`Comando falhou: ${result.error.code} — ${result.error.message}`);
  return result.data;
}

function setupProject(): { projectId: string } {
  const doc = createSampleDocument();
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Gestor de Teste');
  const projectId = doc.projects.find((p) => p.code === 'POLITICA_PF')!.id;
  return { projectId };
}

function criarRegraPublicada(projectId: string, code: string, name: string): string {
  const componentId = dispatch(createComponent({ projectId, code, name, type: 'RULE' })).componentId;
  const versionId = dispatch(
    createComponentDraft({ componentId, payload: { kind: 'RULE', businessDescription: `${name} — v1.` } }),
  ).versionId;
  dispatch(publishComponentVersion({ versionId, effectiveFrom: '2026-01-01T00:00:00.000Z' }));
  return componentId;
}

const CAMINHO_ATE_READY: readonly CrStatus[] = [
  'SUBMITTED',
  'IN_REVIEW',
  'APPROVED',
  'IN_DEVELOPMENT',
  'IN_VALIDATION',
  'READY_FOR_RELEASE',
];

/** DB pronto para publicar, com rascunho vinculado, avançado até READY_FOR_RELEASE. */
function dbPronto(
  projectId: string,
  componentId: string,
  code: string,
  proposedEffectiveDate: string,
): string {
  const changeRequestId = dispatch(
    createChangeRequest({ code, title: `Ajuste em ${code}`, proposedEffectiveDate }),
  ).changeRequestId;
  dispatch(updateChangeRequest({ changeRequestId, motivators: ['RISCO'] }));
  dispatch(addChangeRequestItem({ changeRequestId, componentId, changeType: 'UPDATE', proposedSummary: 'Proposta.' }));
  dispatch(linkChangeRequestDraft({ changeRequestId, componentId, payload: { kind: 'RULE', businessDescription: 'Proposta.' } }));
  for (const to of CAMINHO_ATE_READY) dispatch(transitionChangeRequest({ changeRequestId, to }));
  return changeRequestId;
}

function renderReleases() {
  return render(
    <TooltipProvider>
      <ReleasesScreen />
      <Toaster />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useEditorStore.getState().reset();
  useUiStore.getState().setView('releases');
});

describe('Release — criar, vincular DB ≥ APPROVED e publicar em lote (CT-GOV-03)', () => {
  it('"Release 2026.09.01 — DB-515, DB-519" nasce, publica os dois DBs com vigências distintas', async () => {
    const user = userEvent.setup();
    const { projectId } = setupProject();
    dispatch(createCatalogItem({ kind: 'MOTIVATOR', code: 'RISCO', label: 'Risco' }));

    const goodlistId = criarRegraPublicada(projectId, 'REGRA_GOODLIST', 'Goodlist');
    const outraId = criarRegraPublicada(projectId, 'REGRA_OUTRA', 'Outra regra');

    const db515 = dbPronto(projectId, goodlistId, 'DB_515', '2026-09-01T00:00:00.000Z');
    const db519 = dbPronto(projectId, outraId, 'DB_519', '2026-10-01T00:00:00.000Z');

    renderReleases();

    await user.click(screen.getAllByRole('button', { name: /Nova release/ })[0]!);
    const createDialog = await screen.findByRole('dialog', { name: 'Nova release' });
    await user.type(within(createDialog).getByLabelText('Código'), '2026.09.01');
    await user.click(within(createDialog).getByRole('button', { name: 'Criar release' }));

    // Cai direto no detalhe, ainda EMPTY.
    expect(await screen.findByText('2026.09.01')).toBeInTheDocument();
    expect(screen.getByText('Sem DB vinculado')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Adicionar DB/ }));
    const addDialog = await screen.findByRole('dialog', { name: 'Adicionar DB à release' });
    await user.click(within(addDialog).getByText('DB_515'));
    await user.click(screen.getByRole('button', { name: /Adicionar DB/ }));
    const addDialog2 = await screen.findByRole('dialog', { name: 'Adicionar DB à release' });
    await user.click(within(addDialog2).getByText('DB_519'));

    expect(await screen.findByText('Pronta para publicar')).toBeInTheDocument();
    expect(screen.getByText('DB_515')).toBeInTheDocument();
    expect(screen.getByText('DB_519')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Publicar release/ }));
    const publishDialog = await screen.findByRole('dialog', { name: /Publicar a release "2026\.09\.01"/ });
    expect(within(publishDialog).getByText(/Tudo pronto: 2 DB\(s\)/)).toBeInTheDocument();
    await user.click(within(publishDialog).getByRole('button', { name: /Publicar a release \(2\)/ }));

    expect(await screen.findAllByText('Publicada')).toHaveLength(2);
    const doc = useDocumentStore.getState().document!;
    expect(doc.releases[0]!.status).toBe('PUBLISHED');
    expect(doc.changeRequests.find((cr) => cr.id === db515)!.status).toBe('PUBLISHED');
    expect(doc.changeRequests.find((cr) => cr.id === db519)!.status).toBe('PUBLISHED');

    const goodlist = doc.components.find((c) => c.id === goodlistId)!;
    expect(goodlist.versions.find((v) => v.state === 'PUBLISHED')!.effectiveFrom).toBe('2026-09-01T00:00:00.000Z');
    const outra = doc.components.find((c) => c.id === outraId)!;
    expect(outra.versions.find((v) => v.state === 'PUBLISHED')!.effectiveFrom).toBe('2026-10-01T00:00:00.000Z');
  });

  it('DB ainda em DRAFT não aparece no seletor "Adicionar DB à release"', async () => {
    const user = userEvent.setup();
    const { projectId } = setupProject();
    dispatch(createCatalogItem({ kind: 'MOTIVATOR', code: 'RISCO', label: 'Risco' }));
    const componentId = criarRegraPublicada(projectId, 'REGRA_X', 'Regra X');
    dispatch(createChangeRequest({ code: 'DB_1', title: 'Ainda em rascunho' }));
    void componentId;

    const criada = dispatch(createRelease({ code: '2026.09.01' }));

    useEditorStore.getState().setSelectedRelease(criada.releaseId);
    renderReleases();

    await user.click(await screen.findByRole('button', { name: /Adicionar DB/ }));
    const addDialog = await screen.findByRole('dialog', { name: 'Adicionar DB à release' });
    expect(within(addDialog).getByText(/Nenhum DB aprovado/)).toBeInTheDocument();
  });
});
