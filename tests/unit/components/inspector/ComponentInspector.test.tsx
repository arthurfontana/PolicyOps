// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ComponentInspector } from '@/components/inspector/ComponentInspector';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Command } from '@/core/command';
import { createComponent } from '@/core/document/components';
import { createSampleDocument } from '@/core/document/create';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

/**
 * Ciclo de vida do componente no inspector — docs/07 §17.5, US-GOV-02: criar
 * rascunho, editar o payload por tipo, publicar (mesmo padrão da matriz),
 * timeline, e a ação "Documentar esta seção" (I27).
 */

function dispatch<O>(command: Command<unknown, O>): O {
  const result = useDocumentStore.getState().dispatch(command);
  if (!result.ok) throw new Error(`Comando falhou: ${result.error.code} — ${result.error.message}`);
  return result.data;
}

function setupProject(): { projectId: string } {
  const doc = createSampleDocument();
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  const projectId = doc.projects.find((p) => p.code === 'POLITICA_PF')!.id;
  return { projectId };
}

function renderInspector(componentId: string) {
  return render(
    <TooltipProvider>
      <ComponentInspector componentId={componentId} />
      <Toaster />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useEditorStore.getState().reset();
});

describe('ComponentInspector — RULE (US-GOV-02)', () => {
  it('cria rascunho, edita o payload e publica; a versão vira PUBLISHED com a vigência informada', async () => {
    const user = userEvent.setup();
    const { projectId } = setupProject();
    const componentId = dispatch(
      createComponent({ projectId, code: 'REGRA_DIVIDA_5000', name: 'Dívida acima de R$ 5.000', type: 'RULE' }),
    ).componentId;
    renderInspector(componentId);

    await user.click(screen.getByRole('button', { name: 'Criar rascunho' }));

    // O rótulo do campo obrigatório concatena o "*" no nome acessível.
    const businessDescription = await screen.findByLabelText(/Descrição de negócio/);
    await user.clear(businessDescription);
    await user.type(businessDescription, 'Bloqueia dívida acima de R$ 5.000.');
    await user.tab();

    await user.type(screen.getByLabelText('Definição técnica'), 'Aging > 0 e Valor >= 5000');
    await user.tab();
    await user.type(screen.getByLabelText('Reason codes (separados por vírgula)'), 'DV01');
    await user.tab();

    let component = useDocumentStore.getState().document!.components.find((c) => c.id === componentId)!;
    expect(component.versions).toHaveLength(1);
    expect(component.versions[0]!.state).toBe('DRAFT');
    expect(component.versions[0]!.payload).toMatchObject({
      businessDescription: 'Bloqueia dívida acima de R$ 5.000.',
      technicalDefinition: 'Aging > 0 e Valor >= 5000',
      reasonCodes: ['DV01'],
    });

    await user.click(screen.getByRole('button', { name: 'Publicar' }));
    const dateInput = await screen.findByLabelText('Vigência (obrigatória)');
    fireEvent.change(dateInput, { target: { value: '2026-02-01' } });
    await user.click(screen.getByRole('button', { name: 'Publicar versão 1' }));

    component = useDocumentStore.getState().document!.components.find((c) => c.id === componentId)!;
    expect(component.versions[0]!.state).toBe('PUBLISHED');
    expect(component.versions[0]!.effectiveFrom).toBe('2026-02-01T00:00:00.000Z');
    expect(screen.getByTestId('matrix-timeline')).toBeInTheDocument();
  });

  it('o rascunho seguinte publica com uma vigência posterior, e a timeline acumula os dois segmentos', async () => {
    const user = userEvent.setup();
    const { projectId } = setupProject();
    const componentId = dispatch(
      createComponent({ projectId, code: 'REGRA_X', name: 'Regra X', type: 'RULE' }),
    ).componentId;
    renderInspector(componentId);

    await user.click(screen.getByRole('button', { name: 'Criar rascunho' }));
    await user.click(screen.getByRole('button', { name: 'Publicar' }));
    fireEvent.change(await screen.findByLabelText('Vigência (obrigatória)'), { target: { value: '2026-02-01' } });
    await user.click(screen.getByRole('button', { name: 'Publicar versão 1' }));

    await user.click(screen.getByRole('button', { name: 'Criar rascunho a partir desta versão' }));
    await user.click(screen.getByRole('button', { name: 'Publicar' }));
    fireEvent.change(await screen.findByLabelText('Vigência (obrigatória)'), { target: { value: '2026-03-01' } });
    await user.click(screen.getByRole('button', { name: 'Publicar versão 2' }));

    const component = useDocumentStore.getState().document!.components.find((c) => c.id === componentId)!;
    expect(component.versions.map((v) => [v.number, v.state])).toEqual([
      [1, 'SUPERSEDED'],
      [2, 'PUBLISHED'],
    ]);
    expect(screen.getByTestId('timeline-segment-v1')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-segment-v2')).toBeInTheDocument();
  });
});

describe('ComponentInspector — SECTION documentável (I27)', () => {
  it('sem versões, é pasta pura; "Documentar esta seção" cria a v1 e a seção passa a ter texto e vigência', async () => {
    const user = userEvent.setup();
    const { projectId } = setupProject();
    const componentId = dispatch(
      createComponent({ projectId, code: 'CAP_REGRAS_DURAS', name: '4.2 Regras Duras', type: 'SECTION' }),
    ).componentId;
    renderInspector(componentId);

    expect(screen.getByText(/pasta pura/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Documentar esta seção' }));

    const component = useDocumentStore.getState().document!.components.find((c) => c.id === componentId)!;
    expect(component.versions).toHaveLength(1);
    expect(component.versions[0]!.payload.kind).toBe('OTHER');
    expect(component.versions[0]!.state).toBe('DRAFT');
    expect(screen.queryByText(/pasta pura/)).not.toBeInTheDocument();
  });
});
