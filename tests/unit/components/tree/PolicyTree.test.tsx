// @vitest-environment jsdom
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderPolicyTree } from './policy-tree-harness';
import type { Command } from '@/core/command';
import { createComponent, listChildren, setComponentReviewStatus } from '@/core/document/components';
import { createComponentDraft } from '@/core/versioning/component-lifecycle';
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

const renderTree = renderPolicyTree;

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
    },
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

  it('filtro sem nenhum resultado tem estado próprio, com "Limpar filtros" (§12, S44)', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    await user.type(screen.getByLabelText('Buscar na árvore'), 'não existe nada assim');

    expect(screen.getByText('Nenhum componente corresponde ao filtro.')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-node-CMA')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByTestId('tree-node-CMA')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum componente corresponde ao filtro.')).not.toBeInTheDocument();
  });
});


describe('PolicyTree — barra de ferramentas: alvo da criação (§2.1, CT-UX-03)', () => {
  it('sem nó selecionado o chip diz "raiz da política" e "Nova seção" cria na raiz', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    expect(screen.getByTestId('policy-toolbar-target')).toHaveTextContent('em: raiz da política');

    await user.click(screen.getByRole('button', { name: /Nova seção/ }));
    await user.type(screen.getByLabelText('Nome do novo componente'), 'Capítulo novo');
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');

    const created = useDocumentStore.getState().document!.components.find((c) => c.name === 'Capítulo novo')!;
    expect(created.parentId).toBeUndefined();
    expect(created.type).toBe('SECTION');
  });

  it('com nó selecionado o chip mostra o caminho e a criação nasce irmã dele', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    await user.click(screen.getByTestId('tree-node-B'));
    expect(screen.getByTestId('policy-toolbar-target')).toHaveTextContent('em: CMA › B');

    await user.click(screen.getByRole('button', { name: /Nova seção/ }));
    await user.type(screen.getByLabelText('Nome do novo componente'), 'Irmã de B');
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');

    // Mesma semântica do Enter na árvore: irmão logo abaixo do selecionado.
    expect(namesOf(projectId, cma)).toEqual(['A', 'B', 'Irmã de B', 'C']);
    const created = useDocumentStore.getState().document!.components.find((c) => c.name === 'Irmã de B')!;
    expect(created.parentId).toBe(cma);
  });

  it('"Nova regra" cria irmão do tipo Regra, e Shift+Enter na árvore faz o mesmo', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    await user.click(screen.getByTestId('tree-node-B'));
    await user.click(screen.getByRole('button', { name: /Nova regra/ }));
    await user.type(screen.getByLabelText('Nome do novo componente'), 'Regra da barra');
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');

    const pelaBarra = useDocumentStore.getState().document!.components.find((c) => c.name === 'Regra da barra')!;
    expect(pelaBarra.type).toBe('RULE');
    expect(pelaBarra.parentId).toBe(cma);

    await user.click(screen.getByTestId('tree-node-A'));
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(screen.getByLabelText('Nome do novo componente'), 'Regra do teclado');
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');

    const peloTeclado = useDocumentStore.getState().document!.components.find(
      (c) => c.name === 'Regra do teclado',
    )!;
    expect(peloTeclado.type).toBe('RULE');
    expect(peloTeclado.parentId).toBe(cma);
  });
});

describe('PolicyTree — recolher/expandir tudo e Alt+clique (§17.1)', () => {
  it('"Expandir tudo" abre todos os níveis e "Recolher tudo" fecha', async () => {
    const user = userEvent.setup();
    const { projectId } = setupTree();
    renderTree(projectId);

    expect(screen.queryByTestId('tree-node-B')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expandir tudo' }));
    expect(screen.getByTestId('tree-node-B')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Recolher tudo' }));
    expect(screen.queryByTestId('tree-node-B')).not.toBeInTheDocument();
  });

  it('Alt+clique no chevron abre a subárvore inteira do nó', async () => {
    const user = userEvent.setup();
    const { projectId, cma, a } = setupTree();
    dispatch(createComponent({ projectId, code: 'A1', name: 'A1', type: 'SECTION', parentId: a }));
    renderTree(projectId);

    const chevron = within(screen.getByTestId('tree-node-CMA')).getByRole('button', { name: /Expandir/ });
    await user.keyboard('{Alt>}');
    await user.click(chevron);
    await user.keyboard('{/Alt}');

    // Não só o filho direto: o neto também, porque a subárvore inteira abriu.
    expect(screen.getByTestId('tree-node-A')).toBeInTheDocument();
    expect(screen.getByTestId('tree-node-A1')).toBeInTheDocument();
    expect(useUiStore.getState().componentTree.expanded[cma]).toBe(true);
    expect(useUiStore.getState().componentTree.expanded[a]).toBe(true);
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
    // ROOT_9, sem nenhuma regra na subárvore, some. Os chips de tipo vivem no
    // popover "Filtrar" da barra de ferramentas (§2.1).
    await user.clear(screen.getByLabelText('Buscar na árvore'));
    await user.click(screen.getByRole('button', { name: /Filtrar/ }));
    await user.click(screen.getByRole('button', { name: 'Regra' }));
    expect(screen.getByTestId(`tree-node-${leafCode}`)).toBeInTheDocument();
    expect(screen.getByTestId(`tree-node-${rootCode}`).className).toContain('opacity-40');
    expect(screen.queryByTestId('tree-node-ROOT_9')).not.toBeInTheDocument();
  }, 15000);
});

describe('PolicyTree — a árvore é sempre hoje (DEC-UX-004)', () => {
  it('a barra não tem seletor de data, e o nó continua editável com a consulta aberta em outra data', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    // A tela de Vigência está numa data do passado: a árvore não muda por isso.
    useUiStore.setState({ policyAtDate: '2026-03-01' });
    renderTree(projectId, { [cma]: true });

    expect(screen.queryByLabelText('Ver a política como em')).toBeNull();
    expect(screen.queryByText(/Fotografia de/)).toBeNull();
    expect(screen.getByRole('button', { name: /Nova seção/ })).toBeTruthy();
    expect(screen.getByLabelText('Mais ações para CMA')).toBeTruthy();

    // E editar continua funcionando: F2 renomeia como em qualquer outro dia.
    await user.click(screen.getByTestId('tree-node-CMA'));
    await user.keyboard('{F2}');
    expect(screen.getByLabelText('Renomear CMA')).toBeTruthy();
  });
});

describe('PolicyTree — navegação por teclado (§17.1, S44)', () => {
  it('↑/↓ movem o foco entre os nós visíveis, sem sair da lista nas pontas', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    // Ordem visível: CMA, A, B, C.
    await user.click(screen.getByTestId('tree-node-A'));
    expect(screen.getByTestId('tree-node-A')).toHaveFocus();

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByTestId('tree-node-C')).toHaveFocus();

    // Já no último nó visível: mais um ArrowDown não sai da lista.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('tree-node-C')).toHaveFocus();

    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(screen.getByTestId('tree-node-CMA')).toHaveFocus();
    // Já no primeiro nó visível: mais um ArrowUp não sai da lista.
    await user.keyboard('{ArrowUp}');
    expect(screen.getByTestId('tree-node-CMA')).toHaveFocus();
  });

  it('Home/End saltam para o primeiro/último nó visível', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    await user.click(screen.getByTestId('tree-node-B'));
    await user.keyboard('{End}');
    expect(screen.getByTestId('tree-node-C')).toHaveFocus();

    await user.keyboard('{Home}');
    expect(screen.getByTestId('tree-node-CMA')).toHaveFocus();
  });

  it('← no nó raiz já recolhido não quebra (sem pai para saltar)', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    // CMA recolhido (o padrão sem `expanded`).
    renderTree(projectId);

    await user.click(screen.getByTestId('tree-node-CMA'));
    expect(screen.getByTestId('tree-node-CMA')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    // Continua com o mesmo nó em foco — não existe pai para o qual saltar.
    expect(screen.getByTestId('tree-node-CMA')).toHaveFocus();
    expect(useUiStore.getState().componentTree.expanded[cma]).toBeFalsy();
  });

  it('← num nó filho sem filhos e já "recolhido" salta para o pai', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    await user.click(screen.getByTestId('tree-node-B'));
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('tree-node-CMA')).toHaveFocus();
  });

  it('aria-level reflete a profundidade em 4 níveis', async () => {
    const { projectId, cma, a } = setupTree();
    dispatch(createComponent({ projectId, code: 'A1', name: 'A1', type: 'SECTION', parentId: a }));
    const a1 = useDocumentStore.getState().document!.components.find((c) => c.code === 'A1')!.id;
    dispatch(createComponent({ projectId, code: 'A1X', name: 'A1X', type: 'RULE', parentId: a1 }));
    renderTree(projectId, { [cma]: true, [a]: true, [a1]: true });

    expect(screen.getByTestId('tree-node-CMA')).toHaveAttribute('aria-level', '1');
    expect(screen.getByTestId('tree-node-A')).toHaveAttribute('aria-level', '2');
    expect(screen.getByTestId('tree-node-A1')).toHaveAttribute('aria-level', '3');
    expect(screen.getByTestId('tree-node-A1X')).toHaveAttribute('aria-level', '4');
  });

  it('typeahead: digitar letras sem correspondência não move o foco', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    await user.click(screen.getByTestId('tree-node-CMA'));
    await user.keyboard('zzz');
    expect(screen.getByTestId('tree-node-CMA')).toHaveFocus();
  });

  it('typeahead: digitar a letra do nó salta para ele', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    await user.click(screen.getByTestId('tree-node-CMA'));
    await user.keyboard('c');
    expect(screen.getByTestId('tree-node-C')).toHaveFocus();
  });

  it('Delete pede confirmação antes de arquivar o nó em foco', async () => {
    const user = userEvent.setup();
    const { projectId, cma } = setupTree();
    renderTree(projectId, { [cma]: true });

    await user.click(screen.getByTestId('tree-node-B'));
    await user.keyboard('{Delete}');
    expect(screen.getByText('Arquivar "B"?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Arquivar' }));

    const b = useDocumentStore.getState().document!.components.find((c) => c.name === 'B')!;
    expect(b.archivedAt).not.toBeUndefined();
  });
});

describe('PolicyTree — pendentes: contador amplo e Ctrl+Shift+N (§2.1, S44)', () => {
  it('o contador soma rascunho aberto e revisão pendente, e some com zero', async () => {
    const { projectId, a } = setupTree();
    renderTree(projectId);
    expect(screen.getByTestId('policy-toolbar-pending-counter')).toHaveTextContent('0 pendentes');
    expect(screen.getByTestId('policy-toolbar-pending-counter')).toBeDisabled();

    act(() => {
      dispatch(setComponentReviewStatus({ componentId: a, reviewStatus: 'PENDING_REVIEW' }));
    });
    expect(screen.getByTestId('policy-toolbar-pending-counter')).toHaveTextContent('1 pendente');
    expect(screen.getByTestId('policy-toolbar-pending-counter')).not.toBeDisabled();
  });

  it('clicar no contador abre o diálogo "Publicar pendentes"', async () => {
    const user = userEvent.setup();
    const { projectId, a } = setupTree();
    dispatch(
      createComponentDraft({ componentId: a, payload: { kind: 'OTHER', businessDescription: 'A' } }),
    );
    renderTree(projectId);

    await user.click(screen.getByTestId('policy-toolbar-pending-counter'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Ctrl+Shift+N vai para o próximo pendente e dá a volta; sem pendentes, o atalho não faz nada', async () => {
    const user = userEvent.setup();
    const { projectId, a, b } = setupTree();
    dispatch(setComponentReviewStatus({ componentId: a, reviewStatus: 'PENDING_REVIEW' }));
    dispatch(setComponentReviewStatus({ componentId: b, reviewStatus: 'PENDING_REVIEW' }));
    renderTree(projectId);

    await user.keyboard('{Control>}{Shift>}N{/Shift}{/Control}');
    expect(useEditorStore.getState().selectedComponentId).toBe(a);

    await user.keyboard('{Control>}{Shift>}N{/Shift}{/Control}');
    expect(useEditorStore.getState().selectedComponentId).toBe(b);

    // Do último pendente, dá a volta para o primeiro — não trava, não avança para além.
    await user.keyboard('{Control>}{Shift>}N{/Shift}{/Control}');
    expect(useEditorStore.getState().selectedComponentId).toBe(a);
  });

  it('sem nenhum pendente, Ctrl+Shift+N não seleciona nada', async () => {
    const user = userEvent.setup();
    const { projectId } = setupTree();
    renderTree(projectId);

    await user.keyboard('{Control>}{Shift>}N{/Shift}{/Control}');
    expect(useEditorStore.getState().selectedComponentId).toBeNull();
  });
});
