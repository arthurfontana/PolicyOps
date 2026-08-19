// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ComponentPage } from '@/components/tree/ComponentPage';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Command } from '@/core/command';
import { createComponent } from '@/core/document/components';
import {
  createComponentDraft,
  publishComponentVersion,
} from '@/core/versioning/component-lifecycle';
import { createSampleDocument } from '@/core/document/create';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/**
 * Página do componente (docs/07 §17.5, DEC-UX-002) — migra a cobertura de
 * `ComponentInspector.test.tsx` (S33b/S39) para a página no centro: ciclo de
 * vida, "Documentar esta seção" e o salto para a consulta histórica continuam
 * cobertos, com o acréscimo de chips, navegação entre irmãos e somente leitura
 * sem rascunho (S42). A página é **sempre hoje** desde a S43 (DEC-UX-004): o
 * passado é a tela de Vigência, e o que se verifica aqui é o salto até ela.
 */

function dispatch<O>(command: Command<unknown, O>): O {
  const result = useDocumentStore.getState().dispatch(command);
  if (!result.ok) throw new Error(`Comando falhou: ${result.error.code} — ${result.error.message}`);
  return result.data;
}

function setupProject(): { projectId: string; projectName: string } {
  const doc = createSampleDocument();
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  const project = doc.projects.find((p) => p.code === 'POLITICA_PF')!;
  return { projectId: project.id, projectName: project.name };
}

function renderPage(projectId: string, projectName: string, componentId: string) {
  return render(
    <TooltipProvider>
      <ComponentPage projectId={projectId} projectName={projectName} componentId={componentId} />
      <Toaster />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useEditorStore.getState().reset();
  useUiStore.setState((s) => ({
    componentTree: { ...s.componentTree, projectId: null },
    policyAtDate: null,
    view: 'projects',
  }));
});

describe('ComponentPage — RULE (US-GOV-02)', () => {
  it('cria rascunho, edita o payload (incl. chips) e publica; a versão vira PUBLISHED com a vigência informada', async () => {
    const user = userEvent.setup();
    const { projectId, projectName } = setupProject();
    const componentId = dispatch(
      createComponent({ projectId, code: 'REGRA_DIVIDA_5000', name: 'Dívida acima de R$ 5.000', type: 'RULE' }),
    ).componentId;
    renderPage(projectId, projectName, componentId);

    await user.click(screen.getByRole('button', { name: 'Criar rascunho' }));

    const businessDescription = await screen.findByLabelText(/Descrição de negócio/);
    await user.clear(businessDescription);
    await user.type(businessDescription, 'Bloqueia dívida acima de R$ 5.000.');
    await user.tab();

    await user.type(screen.getByLabelText('Definição técnica'), 'Aging > 0 e Valor >= 5000');
    await user.tab();

    await user.type(screen.getByLabelText('Reason codes'), 'DV01');
    await user.keyboard('{Enter}');

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
    const { projectId, projectName } = setupProject();
    const componentId = dispatch(createComponent({ projectId, code: 'REGRA_X', name: 'Regra X', type: 'RULE' })).componentId;
    renderPage(projectId, projectName, componentId);

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

  it('sem rascunho aberto, os campos ficam somente leitura e o botão cria um rascunho a partir da versão vigente', async () => {
    const user = userEvent.setup();
    const { projectId, projectName } = setupProject();
    const componentId = dispatch(createComponent({ projectId, code: 'REGRA_RO', name: 'Regra RO', type: 'RULE' })).componentId;
    const v1 = dispatch(
      createComponentDraft({ componentId, payload: { kind: 'RULE', businessDescription: 'Descrição publicada.' } }),
    ).versionId;
    dispatch(publishComponentVersion({ versionId: v1, effectiveFrom: '2026-01-01T00:00:00.000Z' }));

    renderPage(projectId, projectName, componentId);

    expect(screen.getByText(/crie um rascunho para editar/)).toBeInTheDocument();
    const businessDescription = await screen.findByLabelText(/Descrição de negócio/);
    expect(businessDescription).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Criar rascunho a partir desta versão' }));

    const component = useDocumentStore.getState().document!.components.find((c) => c.id === componentId)!;
    expect(component.versions).toHaveLength(2);
    expect(component.versions[1]!.state).toBe('DRAFT');
  });
});

describe('ComponentPage — chips (inputs/reasonCodes/dependencies, S42)', () => {
  it('colar texto com vírgulas vira N chips; Backspace no campo vazio remove o último; o valor final é a mesma lista de sempre', async () => {
    const user = userEvent.setup();
    const { projectId, projectName } = setupProject();
    const componentId = dispatch(
      createComponent({ projectId, code: 'REGRA_CHIPS', name: 'Regra Chips', type: 'RULE' }),
    ).componentId;
    renderPage(projectId, projectName, componentId);

    await user.click(screen.getByRole('button', { name: 'Criar rascunho' }));
    await screen.findByLabelText(/Descrição de negócio/);

    const inputsField = screen.getByLabelText('Entradas');
    await user.click(inputsField);
    await user.paste('Renda, Score, Idade');

    expect(screen.getByText('Renda')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(screen.getByText('Idade')).toBeInTheDocument();

    let component = useDocumentStore.getState().document!.components.find((c) => c.id === componentId)!;
    expect(component.versions[0]!.payload).toMatchObject({ inputs: ['Renda', 'Score', 'Idade'] });

    await user.keyboard('{Backspace}');

    component = useDocumentStore.getState().document!.components.find((c) => c.id === componentId)!;
    expect(component.versions[0]!.payload).toMatchObject({ inputs: ['Renda', 'Score'] });
    expect(screen.queryByText('Idade')).not.toBeInTheDocument();
  });

  it('Enter e vírgula, um de cada vez, também adicionam chip', async () => {
    const user = userEvent.setup();
    const { projectId, projectName } = setupProject();
    const componentId = dispatch(
      createComponent({ projectId, code: 'REGRA_CHIPS_2', name: 'Regra Chips 2', type: 'RULE' }),
    ).componentId;
    renderPage(projectId, projectName, componentId);

    await user.click(screen.getByRole('button', { name: 'Criar rascunho' }));
    await screen.findByLabelText(/Descrição de negócio/);

    const reasonCodesField = screen.getByLabelText('Reason codes');
    await user.click(reasonCodesField);
    await user.type(reasonCodesField, 'DV01,DV02{Enter}');

    const component = useDocumentStore.getState().document!.components.find((c) => c.id === componentId)!;
    expect(component.versions[0]!.payload).toMatchObject({ reasonCodes: ['DV01', 'DV02'] });
  });
});

describe('ComponentPage — navegação entre irmãos (§17.5)', () => {
  it('‹ anterior / próximo › desabilitam nas bordas da seção', () => {
    const { projectId, projectName } = setupProject();
    const first = dispatch(createComponent({ projectId, code: 'IRMA_1', name: 'Irmã 1', type: 'RULE' })).componentId;
    dispatch(createComponent({ projectId, code: 'IRMA_2', name: 'Irmã 2', type: 'RULE' }));
    const third = dispatch(createComponent({ projectId, code: 'IRMA_3', name: 'Irmã 3', type: 'RULE' })).componentId;

    const firstRender = renderPage(projectId, projectName, first);
    expect(screen.getByRole('button', { name: 'Componente anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próximo componente' })).toBeEnabled();
    firstRender.unmount();

    renderPage(projectId, projectName, third);
    expect(screen.getByRole('button', { name: 'Componente anterior' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Próximo componente' })).toBeDisabled();
  });
});

describe('ComponentPage — SECTION documentável (I27)', () => {
  it('sem versões, é pasta pura; "Documentar esta seção" cria a v1 e a seção passa a ter texto e vigência', async () => {
    const user = userEvent.setup();
    const { projectId, projectName } = setupProject();
    const componentId = dispatch(
      createComponent({ projectId, code: 'CAP_REGRAS_DURAS', name: '4.2 Regras Duras', type: 'SECTION' }),
    ).componentId;
    renderPage(projectId, projectName, componentId);

    expect(screen.getByText(/pasta pura/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Documentar esta seção' }));

    const component = useDocumentStore.getState().document!.components.find((c) => c.id === componentId)!;
    expect(component.versions).toHaveLength(1);
    expect(component.versions[0]!.payload.kind).toBe('OTHER');
    expect(component.versions[0]!.state).toBe('DRAFT');
    expect(screen.queryByText(/pasta pura/)).not.toBeInTheDocument();
  });
});

describe('ComponentPage — salto para a consulta histórica (§20.2)', () => {
  function comDuasVersoes(): { projectId: string; projectName: string; componentId: string } {
    const { projectId, projectName } = setupProject();
    const componentId = dispatch(
      createComponent({ projectId, code: 'REGRA_GOODLIST', name: 'Goodlist', type: 'RULE' }),
    ).componentId;
    const v1 = dispatch(
      createComponentDraft({
        componentId,
        payload: { kind: 'RULE', businessDescription: 'Aprova quem está na lista.' },
      }),
    ).versionId;
    dispatch(publishComponentVersion({ versionId: v1, effectiveFrom: '2026-01-01T00:00:00.000Z' }));
    const v2 = dispatch(
      createComponentDraft({
        componentId,
        payload: { kind: 'RULE', businessDescription: 'Aprova só até o limite em lista.' },
      }),
    ).versionId;
    dispatch(publishComponentVersion({ versionId: v2, effectiveFrom: '2026-06-01T00:00:00.000Z' }));
    return { projectId, projectName, componentId };
  }

  it('"Ver a política inteira nesta data" abre a tela de Vigência na vigência da versão mostrada', async () => {
    const user = userEvent.setup();
    const { projectId, projectName, componentId } = comDuasVersoes();
    renderPage(projectId, projectName, componentId);

    await user.click(screen.getByRole('button', { name: /Ver a política inteira nesta data/ }));

    // A versão mostrada é a publicada vigente (v2, junho) — e o salto é de tela.
    expect(useUiStore.getState().policyAtDate).toBe('2026-06-01');
    expect(useUiStore.getState().view).toBe('timeline');
  });

  it('a página continua editável com a consulta aberta em outra data (DEC-UX-004)', () => {
    const { projectId, projectName, componentId } = comDuasVersoes();
    useUiStore.setState({ policyAtDate: '2026-03-01' });
    renderPage(projectId, projectName, componentId);

    // Nada de fotografia aqui: a versão é a de hoje e todas as portas seguem abertas.
    expect(screen.getByText(/Versão 2 vigente desde/)).toBeTruthy();
    expect(screen.queryByText(/Fotografia de/)).toBeNull();
    expect(screen.getByRole('button', { name: /Criar rascunho a partir desta versão/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mais ações para/ })).toBeTruthy();
    expect(screen.getByTestId('component-name-button')).not.toBeDisabled();
    expect(screen.getByLabelText(/Descrição de negócio/)).toBeDisabled();
  });
});
