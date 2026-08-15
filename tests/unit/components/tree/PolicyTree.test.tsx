// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { PolicyTree } from '@/components/tree/PolicyTree';
import { Toaster } from '@/components/ui/toaster';
import type { Command } from '@/core/command';
import { createComponent, listChildren } from '@/core/document/components';
import { createSampleDocument } from '@/core/document/create';
import type { PolicyComponent } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/**
 * Ergonomia de digitação em volume (docs/07-ux-e-editor.md §17.3) — sem ela
 * a sessão não cumpre o objetivo de montar ~50 seções em menos de 30 min.
 */

function dispatch<O>(command: Command<unknown, O>): O {
  const result = useDocumentStore.getState().dispatch(command);
  if (!result.ok) throw new Error(`Comando falhou: ${result.error.code} — ${result.error.message}`);
  return result.data;
}

function setupTree(): { projectId: string; cma: string; a: string; b: string; c: string } {
  const doc = createSampleDocument();
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  const projectId = doc.projects.find((p) => p.code === 'POLITICA_PF')!.id;

  const cma = dispatch(createComponent({ projectId, code: 'CMA', name: 'CMA', type: 'SECTION' })).componentId;
  const a = dispatch(
    createComponent({ projectId, code: 'A', name: 'A', type: 'SECTION', parentId: cma }),
  ).componentId;
  const b = dispatch(
    createComponent({ projectId, code: 'B', name: 'B', type: 'SECTION', parentId: cma }),
  ).componentId;
  const c = dispatch(
    createComponent({ projectId, code: 'C', name: 'C', type: 'SECTION', parentId: cma }),
  ).componentId;

  return { projectId, cma, a, b, c };
}

function renderTree(projectId: string, expanded: Record<string, boolean> = {}) {
  useUiStore.setState((s) => ({
    componentTree: { ...s.componentTree, projectId, expanded },
  }));
  return render(
    <>
      <PolicyTree projectId={projectId} />
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useEditorStore.getState().reset();
  useUiStore.setState({
    componentTree: { projectId: null, expanded: {}, search: '', types: [], reviewStatuses: [], tags: [] },
  });
});

function namesOf(projectId: string, parentId: string): string[] {
  const doc = useDocumentStore.getState().document!;
  return listChildren(doc, projectId, parentId).map((c) => c.name);
}

describe('PolicyTree — ergonomia de criação (§17.3)', () => {
  it('Enter num nó cria um irmão logo abaixo, já em edição, na posição certa', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    await user.click(screen.getByTestId('tree-node-B'));
    await user.keyboard('{Enter}');

    const input = screen.getByLabelText('Nome do novo componente');
    await user.type(input, 'Novo');
    await user.keyboard('{Enter}');

    // Novo entra logo depois de B (o nó em que Enter foi pressionado), não no
    // fim da lista — mesmo o comando de criação sempre anexando no fim.
    expect(namesOf(projectId, cma)).toEqual(['A', 'B', 'Novo', 'C']);
    const created = useDocumentStore.getState().document!.components.find((c) => c.name === 'Novo')!;
    expect(created.parentId).toBe(cma);

    // Enter encadeia: a segunda caixa de criação já está aberta, como irmã do que acabou de ser criado.
    expect(screen.getByLabelText('Nome do novo componente')).toBeInTheDocument();
  });

  it('Tab antes de gravar reparenta o rascunho para filho do nó de origem', async () => {
    const user = userEvent.setup();
    const { projectId, cma, a } = setupTree();
    renderTree(projectId, { [cma]: true });

    await user.click(screen.getByTestId('tree-node-A'));
    await user.keyboard('{Enter}');
    await user.keyboard('{Tab}');

    const input = screen.getByLabelText('Nome do novo componente');
    await user.type(input, 'FilhoDeA');
    await user.keyboard('{Enter}');

    const created = useDocumentStore.getState().document!.components.find((c) => c.name === 'FilhoDeA')!;
    expect(created.parentId).toBe(a);
  });

  it('trocar o tipo no seletor compacto antes de digitar o nome não descarta o rascunho (S33b)', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    await user.click(screen.getByTestId('tree-node-B'));
    await user.keyboard('{Enter}');
    // Escolher o tipo tira o foco do campo de nome (ainda vazio) antes de
    // digitar — sem suprimir o blur, isso descartaria o rascunho inteiro.
    await user.selectOptions(screen.getByLabelText('Tipo do novo componente'), 'RULE');
    expect(screen.getByLabelText('Nome do novo componente')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nome do novo componente'), 'Regra Nova');
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');

    const created = useDocumentStore.getState().document!.components.find((c) => c.name === 'Regra Nova');
    expect(created?.type).toBe('RULE');
  });

  it('Escape cancela o rascunho sem criar nada', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    await user.click(screen.getByTestId('tree-node-B'));
    await user.keyboard('{Enter}');
    await user.type(screen.getByLabelText('Nome do novo componente'), 'Descartado');
    await user.keyboard('{Escape}');

    expect(screen.queryByLabelText('Nome do novo componente')).not.toBeInTheDocument();
    expect(namesOf(projectId, cma)).toEqual(['A', 'B', 'C']);
  });

  it('Ctrl/Cmd+D duplica o componente com sufixo no código', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    await user.click(screen.getByTestId('tree-node-B'));
    await user.keyboard('{Control>}d{/Control}');

    expect(namesOf(projectId, cma)).toEqual(['A', 'B', 'B (cópia)', 'C']);
    const doc = useDocumentStore.getState().document!;
    expect(doc.components.some((c) => c.code === 'B_COPIA')).toBe(true);
  });
});

describe('PolicyTree — filtro preserva ancestrais (§17.1)', () => {
  it('buscar por um nó folha mantém os ancestrais visíveis, mas esmaecidos', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    await user.type(screen.getByLabelText('Buscar na árvore'), 'B');

    // "B" bate; "CMA" (ancestral) continua na árvore, só que esmaecido — a
    // árvore filtrada nunca vira uma lista plana só com o item encontrado.
    expect(screen.getByTestId('tree-node-CMA')).toBeInTheDocument();
    expect(screen.getByTestId('tree-node-B')).toBeInTheDocument();
    expect(screen.getByTestId('tree-node-CMA').className).toContain('opacity-40');
    expect(screen.getByTestId('tree-node-B').className).not.toContain('opacity-40');
    expect(screen.queryByTestId('tree-node-A')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tree-node-C')).not.toBeInTheDocument();
  });
});

/**
 * ~300 componentes em 4 níveis (docs/prompts/S33a, critério de aceite):
 * 10 seções raiz × 5 filhos × 4 netos = 260, mais 40 bisnetos (RULE) sob os
 * 40 primeiros netos — construídos direto (sem 300 dispatches) porque o que
 * este teste mede é o painel, não a camada de comandos.
 */
function bigTreeFixture(): { projectId: string; rootCode: string; leafCode: string } {
  const doc = createSampleDocument();
  const projectId = doc.projects.find((p) => p.code === 'POLITICA_PF')!.id;
  const components: PolicyComponent[] = [];
  let counter = 0;
  function push(parentId: string | undefined, code: string, name: string, type: PolicyComponent['type'], position: number): string {
    const id = `synthetic-${counter++}`;
    const component: PolicyComponent = {
      id,
      projectId,
      code,
      name,
      type,
      position,
      reviewStatus: 'STRUCTURED',
      createdAt: '2026-01-01T00:00:00.000Z',
      versions: [],
    };
    if (parentId !== undefined) component.parentId = parentId;
    components.push(component);
    return id;
  }

  let leafCode = '';
  let rulesCreated = 0;
  for (let i = 0; i < 10; i++) {
    const rootId = push(undefined, `ROOT_${i}`, `Capítulo ${i}`, 'SECTION', i);
    for (let j = 0; j < 5; j++) {
      const midId = push(rootId, `MID_${i}_${j}`, `Grupo ${i}.${j}`, 'SECTION', j);
      for (let k = 0; k < 4; k++) {
        const leafId = push(midId, `LEAF_${i}_${j}_${k}`, `Item ${i}.${j}.${k}`, 'SECTION', k);
        // Um bisneto RULE (nível 4) sob os 40 primeiros netos, em qualquer ordem de i/j.
        if (rulesCreated < 40) {
          const ruleCode = `RULE_${i}_${j}_${k}`;
          push(leafId, ruleCode, `Regra ${i}.${j}.${k}`, 'RULE', 0);
          if (leafCode === '') leafCode = ruleCode;
          rulesCreated++;
        }
      }
    }
  }

  doc.components = components;
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  return { projectId, rootCode: 'ROOT_0', leafCode };
}

describe('PolicyTree — ~300 componentes em 4 níveis (docs/prompts/S33a)', () => {
  it('expande, busca e filtra sem travar', async () => {
    const user = userEvent.setup();
    const { projectId, rootCode, leafCode } = bigTreeFixture();
    renderTree(projectId);

    // Raízes visíveis de saída; filhos ainda fechados.
    expect(screen.getByTestId(`tree-node-${rootCode}`)).toBeInTheDocument();
    expect(screen.queryByTestId('tree-node-MID_0_0')).not.toBeInTheDocument();

    await user.click(within(screen.getByTestId(`tree-node-${rootCode}`)).getByRole('button', { name: /Expandir/ }));
    expect(screen.getByTestId('tree-node-MID_0_0')).toBeInTheDocument();

    // Buscar por um nó de nível 4 devolve só o caminho até ele.
    await user.type(screen.getByLabelText('Buscar na árvore'), 'Regra 0.0.0');
    expect(screen.getByTestId(`tree-node-${leafCode}`)).toBeInTheDocument();
    expect(screen.getByTestId(`tree-node-${rootCode}`)).toBeInTheDocument();
    expect(screen.queryByTestId('tree-node-LEAF_1_0_0')).not.toBeInTheDocument();

    // Limpar a busca e filtrar por tipo RULE: as 40 regras (sob ROOT_0 e
    // ROOT_1) aparecem; ROOT_0 continua visível como ancestral esmaecido;
    // ROOT_9, sem nenhuma regra na subárvore, some.
    await user.clear(screen.getByLabelText('Buscar na árvore'));
    await user.click(screen.getByRole('button', { name: 'Regra' }));
    expect(screen.getByTestId(`tree-node-${leafCode}`)).toBeInTheDocument();
    expect(screen.getByTestId(`tree-node-${rootCode}`).className).toContain('opacity-40');
    expect(screen.queryByTestId('tree-node-ROOT_9')).not.toBeInTheDocument();
  }, 15000);
});
