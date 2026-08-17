// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChangeRequestDetail } from '@/components/change-requests/ChangeRequestDetail';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Command } from '@/core/command';
import {
  addChangeRequestItem,
  createChangeRequest,
  updateChangeRequest,
} from '@/core/document/change-requests';
import { createComponent } from '@/core/document/components';
import { createSampleDocument } from '@/core/document/create';
import { createCatalogItem } from '@/core/library/catalog';
import { createComponentDraft, publishComponentVersion } from '@/core/versioning/component-lifecycle';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

/**
 * Tela do DB (US-GOV-03/04, docs/14 §5): submissão bloqueada sem motivador,
 * item ou vigência (RN-GOV-03); ações visíveis conforme o estado; devolução
 * exige comentário (US-GOV-04). O grafo e os comandos já são 100% testados
 * em `tests/unit/core/document/{change-requests,cr-workflow}.test.ts` — aqui
 * é só a integração tela → comando → erro.
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

/** Componente `RULE` "Goodlist" com v1 publicada — o caso real do CT-GOV-01. */
function criarGoodlistPublicada(projectId: string): string {
  const componentId = dispatch(
    createComponent({ projectId, code: 'REGRA_GOODLIST', name: 'Goodlist', type: 'RULE' }),
  ).componentId;
  const versionId = dispatch(
    createComponentDraft({
      componentId,
      payload: { kind: 'RULE', businessDescription: 'Aprova sempre que o cliente estiver na lista.' },
    }),
  ).versionId;
  dispatch(publishComponentVersion({ versionId, effectiveFrom: '2026-01-01T00:00:00.000Z' }));
  return componentId;
}

function renderDetail(changeRequestId: string) {
  return render(
    <TooltipProvider>
      <ChangeRequestDetail changeRequestId={changeRequestId} />
      <Toaster />
    </TooltipProvider>,
  );
}

function currentCr(changeRequestId: string) {
  return useDocumentStore.getState().document!.changeRequests.find((cr) => cr.id === changeRequestId)!;
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useEditorStore.getState().reset();
});

describe('ChangeRequestDetail — submissão (RN-GOV-03)', () => {
  it('lista o que falta e recusa submeter um DB vazio', async () => {
    const user = userEvent.setup();
    const { projectId } = setupProject();
    const changeRequestId = dispatch(createChangeRequest({ code: 'DB_1', title: 'DB vazio' })).changeRequestId;
    void projectId;

    renderDetail(changeRequestId);

    expect(
      screen.getByText(/Falta para submeter: ao menos um motivador, ao menos um item com o texto do proposto, a vigência pretendida\./),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submeter' }));

    expect(await screen.findByText(/ainda não pode ser submetida/)).toBeInTheDocument();
    expect(currentCr(changeRequestId).status).toBe('DRAFT');
  });

  it('com motivador, item e vigência, submeter avança para SUBMITTED e o aviso some', async () => {
    const user = userEvent.setup();
    const { projectId } = setupProject();
    const componentId = criarGoodlistPublicada(projectId);
    dispatch(createCatalogItem({ kind: 'MOTIVATOR', code: 'RISCO', label: 'Risco' }));
    const changeRequestId = dispatch(
      createChangeRequest({ code: 'DB_515', title: 'Goodlist passa a olhar o valor do pedido' }),
    ).changeRequestId;
    dispatch(updateChangeRequest({ changeRequestId, motivators: ['RISCO'], proposedEffectiveDate: '2026-09-01T00:00:00.000Z' }));
    dispatch(
      addChangeRequestItem({
        changeRequestId,
        componentId,
        changeType: 'UPDATE',
        currentSummary: 'Aprova sempre que o cliente estiver na lista.',
        proposedSummary: 'Aprova só se o valor do pedido for menor ou igual ao limite em lista.',
      }),
    );

    renderDetail(changeRequestId);
    expect(screen.queryByText(/Falta para submeter/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submeter' }));

    expect(currentCr(changeRequestId).status).toBe('SUBMITTED');
    expect(await screen.findByText('Submetido')).toBeInTheDocument();
  });
});

describe('ChangeRequestDetail — ações visíveis por estado (docs/14 §5)', () => {
  it('DRAFT mostra Submeter; SUBMITTED mostra "mover para em revisão"; IN_REVIEW mostra as três decisões', async () => {
    const user = userEvent.setup();
    const { projectId } = setupProject();
    const componentId = criarGoodlistPublicada(projectId);
    dispatch(createCatalogItem({ kind: 'MOTIVATOR', code: 'RISCO', label: 'Risco' }));
    const changeRequestId = dispatch(createChangeRequest({ code: 'DB_1', title: 'Teste de workflow' })).changeRequestId;
    dispatch(updateChangeRequest({ changeRequestId, motivators: ['RISCO'], proposedEffectiveDate: '2026-09-01T00:00:00.000Z' }));
    dispatch(
      addChangeRequestItem({
        changeRequestId,
        componentId,
        changeType: 'UPDATE',
        proposedSummary: 'Proposto.',
      }),
    );

    renderDetail(changeRequestId);

    // DRAFT: Submeter presente, sem botões de decisão.
    expect(screen.getByRole('button', { name: 'Submeter' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submeter' }));
    expect(await screen.findByText('Submetido')).toBeInTheDocument();

    // SUBMITTED: transição genérica para revisão; ainda sem decisões.
    const toReview = screen.getByRole('button', { name: /Mover para Em revisão/ });
    expect(toReview).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();
    await user.click(toReview);
    expect(await screen.findByText('Em revisão')).toBeInTheDocument();

    // IN_REVIEW: as três decisões aparecem, a transição genérica não.
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Devolver' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rejeitar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mover para/ })).not.toBeInTheDocument();
  });

  it('APPROVED mostra o aviso de RN-GOV-04 e um "Publicar" desabilitado com tooltip (fora do escopo — S36)', async () => {
    const user = userEvent.setup();
    const { projectId } = setupProject();
    const componentId = criarGoodlistPublicada(projectId);
    dispatch(createCatalogItem({ kind: 'MOTIVATOR', code: 'RISCO', label: 'Risco' }));
    const changeRequestId = dispatch(createChangeRequest({ code: 'DB_1', title: 'Teste de aprovação' })).changeRequestId;
    dispatch(updateChangeRequest({ changeRequestId, motivators: ['RISCO'], proposedEffectiveDate: '2026-09-01T00:00:00.000Z' }));
    dispatch(addChangeRequestItem({ changeRequestId, componentId, changeType: 'UPDATE', proposedSummary: 'Proposto.' }));

    renderDetail(changeRequestId);
    await user.click(screen.getByRole('button', { name: 'Submeter' }));
    await user.click(await screen.findByRole('button', { name: /Mover para Em revisão/ }));
    await user.click(await screen.findByRole('button', { name: 'Aprovar' }));

    const dialog = await screen.findByRole('dialog', { name: 'Aprovar a solicitação' });
    await user.click(within(dialog).getByRole('button', { name: 'Aprovar' }));

    expect(await screen.findByText('Aprovado')).toBeInTheDocument();
    expect(screen.getByText(/Aprovar não publica nada \(RN-GOV-04\)/)).toBeInTheDocument();
    expect(currentCr(changeRequestId).status).toBe('APPROVED');

    const publishButton = screen.getByRole('button', { name: 'Publicar' });
    expect(publishButton).toBeDisabled();
  });
});

describe('ChangeRequestDetail — devolução exige comentário (US-GOV-04)', () => {
  it('o botão de confirmar fica desabilitado até digitar o comentário', async () => {
    const user = userEvent.setup();
    const { projectId } = setupProject();
    const componentId = criarGoodlistPublicada(projectId);
    dispatch(createCatalogItem({ kind: 'MOTIVATOR', code: 'RISCO', label: 'Risco' }));
    const changeRequestId = dispatch(createChangeRequest({ code: 'DB_1', title: 'Teste de devolução' })).changeRequestId;
    dispatch(updateChangeRequest({ changeRequestId, motivators: ['RISCO'], proposedEffectiveDate: '2026-09-01T00:00:00.000Z' }));
    dispatch(addChangeRequestItem({ changeRequestId, componentId, changeType: 'UPDATE', proposedSummary: 'Proposto.' }));

    renderDetail(changeRequestId);
    await user.click(screen.getByRole('button', { name: 'Submeter' }));
    await user.click(await screen.findByRole('button', { name: /Mover para Em revisão/ }));
    await user.click(await screen.findByRole('button', { name: 'Devolver' }));

    const dialog = await screen.findByRole('dialog', { name: 'Devolver a solicitação' });
    const confirmButton = within(dialog).getByRole('button', { name: 'Devolver' });
    expect(confirmButton).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Comentário/), 'Falta o critério de aceite.');
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);

    expect(await screen.findByText('Devolvido')).toBeInTheDocument();
    const cr = currentCr(changeRequestId);
    expect(cr.status).toBe('CHANGES_REQUESTED');
    expect(cr.approvals.at(-1)).toMatchObject({ decision: 'RETURNED', comment: 'Falta o critério de aceite.' });

    // Devolvido reabre a edição do escopo — item continua editável (não congelado).
    expect(screen.getByRole('button', { name: 'Adicionar item' })).toBeInTheDocument();
  });
});
