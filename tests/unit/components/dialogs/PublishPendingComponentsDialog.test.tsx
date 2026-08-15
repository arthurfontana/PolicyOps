// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { PublishPendingComponentsDialog } from '@/components/dialogs/PublishPendingComponentsDialog';
import { Toaster } from '@/components/ui/toaster';
import type { Command } from '@/core/command';
import { createComponent } from '@/core/document/components';
import { createSampleDocument } from '@/core/document/create';
import { createComponentDraft } from '@/core/versioning/component-lifecycle';
import { useDocumentStore } from '@/store/document-store';

/**
 * "Publicar pendentes" — docs/07 §17.4, RN-GOV-09/RN-GOV-05: publicar em
 * lote, desmarcação item a item, aviso da RN-GOV-07 uma vez só (não por
 * item).
 */

function dispatch<O>(command: Command<unknown, O>): O {
  const result = useDocumentStore.getState().dispatch(command);
  if (!result.ok) throw new Error(`Comando falhou: ${result.error.code} — ${result.error.message}`);
  return result.data;
}

function setup(): { projectId: string; ruleA: string; ruleB: string } {
  const doc = createSampleDocument();
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  const projectId = doc.projects.find((p) => p.code === 'POLITICA_PF')!.id;

  const ruleA = dispatch(createComponent({ projectId, code: 'REGRA_A', name: 'Regra A', type: 'RULE' })).componentId;
  const ruleB = dispatch(createComponent({ projectId, code: 'REGRA_B', name: 'Regra B', type: 'RULE' })).componentId;
  dispatch(createComponentDraft({ componentId: ruleA, payload: { kind: 'RULE', businessDescription: 'A' } }));
  dispatch(createComponentDraft({ componentId: ruleB, payload: { kind: 'RULE', businessDescription: 'B' } }));

  return { projectId, ruleA, ruleB };
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
});

describe('PublishPendingComponentsDialog', () => {
  it('lista os pendentes, aviso da RN-GOV-07 uma vez só, e publica tudo marcado com uma vigência', async () => {
    const user = userEvent.setup();
    const { projectId, ruleA, ruleB } = setup();

    render(
      <>
        <PublishPendingComponentsDialog
          open
          onOpenChange={() => {}}
          projectId={projectId}
          onPublished={() => {}}
        />
        <Toaster />
      </>,
    );

    expect(screen.getByText('Regra A')).toBeInTheDocument();
    expect(screen.getByText('Regra B')).toBeInTheDocument();
    // Um aviso da RN-GOV-07 só, não um por linha.
    expect(screen.getAllByText(/Publicação direta \(RN-GOV-07\)/)).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Vigência do lote (obrigatória)'), { target: { value: '2026-02-01' } });
    await user.click(screen.getByRole('button', { name: /Publicar 2 componente/ }));

    const doc = useDocumentStore.getState().document!;
    expect(doc.components.find((c) => c.id === ruleA)!.versions[0]!.state).toBe('PUBLISHED');
    expect(doc.components.find((c) => c.id === ruleB)!.versions[0]!.state).toBe('PUBLISHED');
  });

  it('desmarcar um item publica só o restante do lote', async () => {
    const user = userEvent.setup();
    const { projectId, ruleA, ruleB } = setup();

    render(
      <PublishPendingComponentsDialog open onOpenChange={() => {}} projectId={projectId} onPublished={() => {}} />,
    );

    await user.click(screen.getByLabelText('Incluir Regra B no lote'));
    fireEvent.change(screen.getByLabelText('Vigência do lote (obrigatória)'), { target: { value: '2026-02-01' } });
    await user.click(screen.getByRole('button', { name: /Publicar 1 componente/ }));

    const doc = useDocumentStore.getState().document!;
    expect(doc.components.find((c) => c.id === ruleA)!.versions[0]!.state).toBe('PUBLISHED');
    expect(doc.components.find((c) => c.id === ruleB)!.versions[0]!.state).toBe('DRAFT');
  });
});
