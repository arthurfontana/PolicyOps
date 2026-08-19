// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { TimelineScreen } from '@/components/timeline/TimelineScreen';
import { ToolbarHost, ToolbarSlot } from '@/components/shell/Toolbar';
import { Toaster } from '@/components/ui/toaster';
import type { Command } from '@/core/command';
import { archiveComponent, createComponent } from '@/core/document/components';
import { createSampleDocument } from '@/core/document/create';
import {
  createComponentDraft,
  publishComponentVersion,
} from '@/core/versioning/component-lifecycle';
import { formatDateInputBR, toDateInputValue } from '@/lib/timeline-dates';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/**
 * Aba **Estrutura** da tela de Vigência (docs/07-ux-e-editor.md §10,
 * DEC-UX-004): a política inteira na data escolhida — regras, listas e
 * matrizes juntas —, em somente leitura, sem congelar a árvore da barra
 * lateral. Migra as leituras que a S39 exercitava no modo fotografia da
 * árvore (`PolicyTreeSnapshot.test.tsx`), que deixou de existir.
 *
 * As vigências são relativas a hoje de propósito: o documento de exemplo
 * publica a matriz PF há 90 dias, e uma data fixa no calendário deixaria de
 * cair na janela dela conforme o tempo passa.
 */

function dispatch<O>(command: Command<unknown, O>): O {
  const result = useDocumentStore.getState().dispatch(command);
  if (!result.ok) throw new Error(`Comando falhou: ${result.error.code} — ${result.error.message}`);
  return result.data;
}

function diasAtras(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

/** A data da consulta: 60 dias atrás — depois da matriz PF (90) e antes da v2 (20). */
const DATA_CONSULTA = toDateInputValue(diasAtras(60));

function setup(): { projectId: string; goodlistId: string; arquivadaId: string } {
  const doc = createSampleDocument();
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  const projectId = doc.projects.find((p) => p.code === 'POLITICA_PF')!.id;
  useEditorStore.getState().setSelectedProject(projectId);

  // 1) Conteúdo com versão vigente na data — v1 desde 200 dias, v2 desde 20.
  const goodlistId = dispatch(
    createComponent({ projectId, code: 'REGRA_GOODLIST', name: 'Goodlist', type: 'RULE' }),
  ).componentId;
  const v1 = dispatch(
    createComponentDraft({
      componentId: goodlistId,
      payload: { kind: 'RULE', businessDescription: 'Aprova quem está na lista.' },
    }),
  ).versionId;
  dispatch(publishComponentVersion({ versionId: v1, effectiveFrom: diasAtras(200).toISOString() }));
  const v2 = dispatch(
    createComponentDraft({
      componentId: goodlistId,
      payload: { kind: 'RULE', businessDescription: 'Aprova só até o limite em lista.' },
    }),
  ).versionId;
  dispatch(publishComponentVersion({ versionId: v2, effectiveFrom: diasAtras(20).toISOString() }));

  // 2) Conteúdo sem versão nenhuma: "sem política vigente", não erro (§6).
  dispatch(createComponent({ projectId, code: 'REGRA_SEM_VERSAO', name: 'Regra sem versão', type: 'RULE' }));

  // 3) Seção pura: estrutura (I29), nunca regra que caducou.
  dispatch(createComponent({ projectId, code: 'CAP_LISTAS', name: 'Listas', type: 'SECTION' }));

  // 4) Arquivada agora: presente nas fotografias anteriores, ausente nas de hoje.
  const arquivadaId = dispatch(
    createComponent({ projectId, code: 'REGRA_ARQUIVADA', name: 'Regra arquivada', type: 'RULE' }),
  ).componentId;
  const arquivadaV1 = dispatch(
    createComponentDraft({
      componentId: arquivadaId,
      payload: { kind: 'RULE', businessDescription: 'Valia até ser arquivada.' },
    }),
  ).versionId;
  dispatch(publishComponentVersion({ versionId: arquivadaV1, effectiveFrom: diasAtras(200).toISOString() }));
  dispatch(archiveComponent({ componentId: arquivadaId }));

  // 5) A matriz do documento de exemplo não tem espelho na árvore (DEC-GOV-039).
  return { projectId, goodlistId, arquivadaId };
}

function renderScreen(date: string = DATA_CONSULTA) {
  window.innerWidth = 1400;
  useUiStore.setState({ view: 'timeline', policyAtDate: date });
  return render(
    <ToolbarHost>
      <ToolbarSlot />
      <TimelineScreen />
      <Toaster />
    </ToolbarHost>,
  );
}

const node = (code: string) => screen.getByTestId(`policy-at-node-${code}`);

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useEditorStore.getState().reset();
  useUiStore.setState({ view: 'timeline', policyAtDate: null });
  window.location.hash = '';
});

describe('Tela de Vigência — aba Estrutura (§10)', () => {
  it('mostra as quatro leituras da mesma data: vigente, sem vigente, estrutura e matriz sem espelho', () => {
    setup();
    renderScreen();

    // Versão vigente na data: a v1, não a v2 que só entra 20 dias atrás.
    expect(node('REGRA_GOODLIST').textContent).toContain('v1');

    // Conteúdo sem versão vigente — a frase, não um erro.
    expect(node('REGRA_SEM_VERSAO').textContent).toContain(
      `sem política vigente em ${formatDateInputBR(DATA_CONSULTA)}`,
    );

    // Seção pura é estrutura (I29).
    expect(node('CAP_LISTAS').textContent).toContain('estrutura');
    expect(node('CAP_LISTAS').textContent).not.toContain('sem política vigente');

    // Matriz sem componente espelho entra na árvore assim mesmo (DEC-GOV-039).
    expect(node('MTZ_LIMITE_PF').textContent).toContain('v1');
  });

  it('arquivado depois da data continua na árvore daquela data', () => {
    setup();
    renderScreen();

    expect(node('REGRA_ARQUIVADA')).toBeTruthy();
  });

  it('o que não existia na data some da árvore', () => {
    setup();
    renderScreen(toDateInputValue(new Date()));

    // Arquivado hoje: some das fotografias a partir de agora.
    expect(screen.queryByTestId('policy-at-node-REGRA_ARQUIVADA')).toBeNull();
    expect(screen.getByTestId('policy-at-node-REGRA_GOODLIST')).toBeTruthy();
  });

  it('trocar a data troca a versão mostrada, sem tocar em nada do presente', async () => {
    const user = userEvent.setup();
    setup();
    renderScreen();

    expect(node('REGRA_GOODLIST').textContent).toContain('v1');

    const dateInput = screen.getByLabelText('Data');
    await user.clear(dateInput);
    await user.type(dateInput, toDateInputValue(diasAtras(10)));

    expect(node('REGRA_GOODLIST').textContent).toContain('v2');
  });

  it('selecionar um nó abre o conteúdo daquela versão, em somente leitura e com banner histórico', async () => {
    const user = userEvent.setup();
    setup();
    renderScreen();

    await user.click(node('REGRA_GOODLIST'));

    const detail = screen.getByTestId('policy-at-detail');
    expect(detail.textContent).toContain('Aprova quem está na lista.');
    expect(detail.textContent).not.toContain('Aprova só até o limite em lista.');
    expect(screen.getByTestId('policy-at-banner').textContent).toContain('Esta é uma versão histórica.');
    expect(screen.getByTestId('policy-at-watermark')).toBeTruthy();
    expect(screen.getByLabelText(/Descrição de negócio/)).toBeDisabled();
  });

  it('nó sem versão vigente e seção pura dizem o que são, em vez de mostrar conteúdo', async () => {
    const user = userEvent.setup();
    setup();
    renderScreen();

    await user.click(node('REGRA_SEM_VERSAO'));
    expect(screen.getByTestId('policy-at-detail').textContent).toContain(
      `Sem política vigente em ${formatDateInputBR(DATA_CONSULTA)}`,
    );

    await user.click(node('CAP_LISTAS'));
    expect(screen.getByTestId('policy-at-detail').textContent).toContain(
      'Seção sem texto próprio — estrutura, não conteúdo.',
    );
  });

  it('"Abrir no editor (hoje)" sai da consulta e abre o componente na tela da política', async () => {
    const user = userEvent.setup();
    const { goodlistId } = setup();
    renderScreen();

    await user.click(node('REGRA_GOODLIST'));
    await user.click(screen.getByRole('button', { name: /Abrir no editor \(hoje\)/ }));

    expect(useUiStore.getState().view).toBe('projects');
    expect(useEditorStore.getState().selectedComponentId).toBe(goodlistId);
  });

  it('a busca da barra de ferramentas filtra a árvore da data', async () => {
    const user = userEvent.setup();
    setup();
    renderScreen();

    await user.type(screen.getByLabelText('Buscar na estrutura'), 'Goodlist');

    expect(screen.getByTestId('policy-at-node-REGRA_GOODLIST')).toBeTruthy();
    expect(screen.queryByTestId('policy-at-node-CAP_LISTAS')).toBeNull();
    // Matriz sem espelho não passa numa busca por outro nome.
    expect(screen.queryByTestId('policy-at-node-MTZ_LIMITE_PF')).toBeNull();
  });

  it('"Comparar com outra data" abre a tela de comparação', async () => {
    const user = userEvent.setup();
    setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: /Comparar com outra data/ }));

    expect(useUiStore.getState().view).toBe('policy-compare');
  });
});
