// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderPolicyTree } from './policy-tree-harness';
import type { Command } from '@/core/command';
import { createComponent } from '@/core/document/components';
import { createSampleDocument } from '@/core/document/create';
import {
  createComponentDraft,
  publishComponentVersion,
} from '@/core/versioning/component-lifecycle';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/**
 * Modo fotografia da árvore (docs/07-ux-e-editor.md §20, US-GOV-07): a mesma
 * árvore, na data escolhida, sem nenhuma porta de edição aberta.
 */

function dispatch<O>(command: Command<unknown, O>): O {
  const result = useDocumentStore.getState().dispatch(command);
  if (!result.ok) throw new Error(`Comando falhou: ${result.error.code} — ${result.error.message}`);
  return result.data;
}

function setupPolitica(): { projectId: string } {
  const doc = createSampleDocument();
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  const projectId = doc.projects.find((p) => p.code === 'POLITICA_PF')!.id;

  const regra = dispatch(
    createComponent({ projectId, code: 'REGRA_GOODLIST', name: 'Goodlist', type: 'RULE' }),
  ).componentId;
  const v1 = dispatch(
    createComponentDraft({
      componentId: regra,
      payload: { kind: 'RULE', businessDescription: 'Aprova quem está na lista.' },
    }),
  ).versionId;
  dispatch(publishComponentVersion({ versionId: v1, effectiveFrom: '2026-01-01T00:00:00.000Z' }));

  const v2 = dispatch(
    createComponentDraft({
      componentId: regra,
      payload: { kind: 'RULE', businessDescription: 'Aprova só até o limite em lista.' },
    }),
  ).versionId;
  dispatch(publishComponentVersion({ versionId: v2, effectiveFrom: '2026-06-01T00:00:00.000Z' }));

  // Seção pura: estrutura, e é assim que precisa aparecer na fotografia (I29).
  dispatch(createComponent({ projectId, code: 'CAP_LISTAS', name: 'Listas', type: 'SECTION' }));

  return { projectId };
}

const renderTree = (projectId: string) => renderPolicyTree(projectId);

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useEditorStore.getState().reset();
  useUiStore.setState({
    componentTree: {
      projectId: null,
      expanded: {},
      search: '',
      types: [],
      reviewStatuses: [],
      tags: [],
      snapshotDate: null,
    },
  });
});

describe('PolicyTree — modo fotografia (§20)', () => {
  it('escolher uma data mostra a versão daquela data e bloqueia a edição', async () => {
    const user = userEvent.setup();
    const { projectId } = setupPolitica();
    renderTree(projectId);

    expect(screen.getByRole('button', { name: /Nova seção/ })).toBeTruthy();

    const dateInput = screen.getByLabelText('Ver a política como em');
    await user.clear(dateInput);
    await user.type(dateInput, '2026-03-01');

    expect(screen.getByText('Fotografia de 01/03/2026 · somente leitura')).toBeTruthy();
    // A v2 só vigora em junho: em março o nó mostra a v1.
    const node = screen.getByTestId('tree-node-REGRA_GOODLIST');
    expect(node.textContent).toContain('v1');

    // Nenhuma das portas de edição da barra continua aberta.
    expect(screen.queryByRole('button', { name: /Nova seção/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Pendurar matriz/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Carregar Markdown/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Publicar pendentes/ })).toBeNull();
    expect(screen.queryByLabelText('Mais ações para Goodlist')).toBeNull();
  });

  it('depois da troca de vigência a mesma árvore mostra a versão nova', async () => {
    const user = userEvent.setup();
    const { projectId } = setupPolitica();
    renderTree(projectId);

    const dateInput = screen.getByLabelText('Ver a política como em');
    await user.clear(dateInput);
    await user.type(dateInput, '2026-07-01');

    expect(screen.getByTestId('tree-node-REGRA_GOODLIST').textContent).toContain('v2');
  });

  it('seção pura aparece como estrutura, nunca como "sem política vigente" (I29)', async () => {
    const user = userEvent.setup();
    const { projectId } = setupPolitica();
    renderTree(projectId);

    const dateInput = screen.getByLabelText('Ver a política como em');
    await user.clear(dateInput);
    await user.type(dateInput, '2026-03-01');

    const secao = screen.getByTestId('tree-node-CAP_LISTAS');
    expect(secao.textContent).toContain('estrutura');
    expect(secao.textContent).not.toContain('sem política vigente');
  });

  it('"Voltar para hoje" devolve a árvore editável', async () => {
    const user = userEvent.setup();
    const { projectId } = setupPolitica();
    renderTree(projectId);

    const dateInput = screen.getByLabelText('Ver a política como em');
    await user.clear(dateInput);
    await user.type(dateInput, '2026-03-01');
    await user.click(screen.getByRole('button', { name: /Voltar para hoje/ }));

    expect(screen.getByRole('button', { name: /Nova seção/ })).toBeTruthy();
    expect(useUiStore.getState().componentTree.snapshotDate).toBeNull();
  });
});
