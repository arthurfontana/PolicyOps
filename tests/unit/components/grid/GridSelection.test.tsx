// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { Grid } from '@/components/grid/Grid';
import { createSampleDocument } from '@/core/document/create';
import { getEditorView, resolveOpenVersion } from '@/core/queries';
import type { PolicyOpsDocument } from '@/core/document/schema';
import type { EditorView } from '@/core/queries';
import { useGridSelection } from '@/hooks/useGridSelection';
import { useEditorStore } from '@/store/editor-store';

/**
 * A tabela de interações de docs/07-ux-e-editor.md §5, linha por linha, sobre
 * `MTZ_LIMITE_PJ` do documento de exemplo: X = Score (6 colunas), Y = SEGMENTO
 * › FAT com supressão assimétrica (8 linhas: Varejo 3, Atacado 3, Corporate 2).
 */

function openVersionId(doc: PolicyOpsDocument, matrixCode: string): string {
  const matrix = doc.matrices.find((candidate) => candidate.code === matrixCode);
  if (matrix === undefined) throw new Error(`Matriz ${matrixCode} não existe no exemplo.`);
  const version = resolveOpenVersion(matrix);
  if (version === null) throw new Error(`Matriz ${matrixCode} não tem versão aberta.`);
  return version.id;
}

/** O grid + a engine, como na tela de matriz. */
function SelectableGrid({ view }: { view: EditorView }) {
  const selection = useGridSelection(view);
  return <Grid view={view} zoom={1} selection={selection} />;
}

const doc = createSampleDocument();
const pjView = getEditorView(doc, openVersionId(doc, 'MTZ_LIMITE_PJ'));

const X = pjView.x.axis.tuples; // R1..R6
const Y = pjView.y.axis.tuples; // VAREJO|ATE_100K … CORPORATE|ACIMA_10M

function cell(xIndex: number, yIndex: number): HTMLElement {
  const key = `${X[xIndex]}::${Y[yIndex]}`;
  const element = document.querySelector<HTMLElement>(`[data-cell-key="${key}"]`);
  if (element === null) throw new Error(`Célula ${key} não está no DOM.`);
  return element;
}

function header(role: 'X' | 'Y', level: number, path: string): HTMLElement {
  const selector = `[role="${role === 'X' ? 'columnheader' : 'rowheader'}"][data-header-path="${path}"][data-header-level="${level}"]`;
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`Cabeçalho ${path} (nível ${level}) não está no DOM.`);
  return element;
}

function selectedKeys(): string[] {
  return [...useEditorStore.getState().selection];
}

function selectionSize(): number {
  return useEditorStore.getState().selection.size;
}

function ariaSelectedCount(): number {
  return document.querySelectorAll('[role="gridcell"][aria-selected="true"]').length;
}

beforeEach(() => {
  useEditorStore.getState().clear();
});

describe('§5 — clique, Shift, Ctrl', () => {
  it('clique seleciona uma célula e define a âncora', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(cell(1, 2));

    expect(selectedKeys()).toEqual([`${X[1]}::${Y[2]}`]);
    expect(useEditorStore.getState().anchor).toEqual({ xPath: X[1], yPath: Y[2] });
    expect(useEditorStore.getState().focus).toEqual({ xPath: X[1], yPath: Y[2] });
    expect(cell(1, 2)).toHaveAttribute('aria-selected', 'true');
  });

  it('Shift + clique faz o retângulo entre a âncora e a célula clicada', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(cell(1, 1));
    await user.keyboard('{Shift>}');
    await user.click(cell(3, 3));
    await user.keyboard('{/Shift}');

    expect(selectionSize()).toBe(3 * 3);
    expect(selectedKeys()).toContain(`${X[2]}::${Y[2]}`);
    expect(selectedKeys()).not.toContain(`${X[0]}::${Y[1]}`);
  });

  it('Shift + clique parte da âncora, não da última célula clicada', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(cell(0, 0));
    await user.keyboard('{Shift>}');
    await user.click(cell(2, 0));
    // Segundo Shift + clique: o retângulo é recalculado desde a âncora (0,0),
    // e não desde (2,0).
    await user.click(cell(1, 0));
    await user.keyboard('{/Shift}');

    expect(selectedKeys()).toEqual([`${X[0]}::${Y[0]}`, `${X[1]}::${Y[0]}`]);
  });

  it('Ctrl + clique alterna a célula e a torna a nova âncora — inclusive ao removê-la', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(cell(0, 0));
    await user.keyboard('{Control>}');
    await user.click(cell(2, 2));
    expect(selectionSize()).toBe(2);
    expect(useEditorStore.getState().anchor).toEqual({ xPath: X[2], yPath: Y[2] });

    // Mesma célula de novo: sai da seleção, mas continua sendo a âncora.
    await user.click(cell(2, 2));
    await user.keyboard('{/Control}');
    expect(selectedKeys()).toEqual([`${X[0]}::${Y[0]}`]);
    expect(useEditorStore.getState().anchor).toEqual({ xPath: X[2], yPath: Y[2] });
  });

  it('Ctrl + clique removendo a célula deixa a âncora pronta para o próximo Shift + clique', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(cell(0, 0));
    await user.keyboard('{Control>}');
    await user.click(cell(2, 2));
    await user.click(cell(2, 2));
    await user.keyboard('{/Control}');

    await user.keyboard('{Shift>}');
    await user.click(cell(3, 2));
    await user.keyboard('{/Shift}');

    expect(selectedKeys()).toEqual([`${X[2]}::${Y[2]}`, `${X[3]}::${Y[2]}`]);
  });
});

describe('§5 — marquee', () => {
  it('arrastar substitui a seleção e o retângulo translúcido aparece durante o gesto', () => {
    render(<SelectableGrid view={pjView} />);

    fireEvent.mouseDown(cell(4, 4), { button: 0 });
    fireEvent.mouseEnter(cell(1, 1));

    expect(screen.getByTestId('grid-marquee')).toBeInTheDocument();
    // Retângulo invertido nos dois eixos: 4 colunas × 4 linhas.
    expect(ariaSelectedCount()).toBe(16);
    // A seleção só é materializada no `mouseup`.
    expect(selectionSize()).toBe(1);

    fireEvent.mouseUp(window);
    expect(selectionSize()).toBe(16);
    expect(screen.queryByTestId('grid-marquee')).not.toBeInTheDocument();
  });

  it('Ctrl + arrastar soma à seleção; arrastar sem modificador substitui', () => {
    render(<SelectableGrid view={pjView} />);

    // Seleção inicial de 1 célula, longe do arrasto.
    fireEvent.mouseDown(cell(5, 7), { button: 0 });
    fireEvent.mouseUp(window);
    expect(selectionSize()).toBe(1);

    // Ctrl + arrastar: soma 4 células.
    fireEvent.mouseDown(cell(0, 0), { button: 0, ctrlKey: true });
    fireEvent.mouseEnter(cell(1, 1));
    expect(ariaSelectedCount()).toBe(5); // as 4 do retângulo + a que já estava
    fireEvent.mouseUp(window);
    expect(selectionSize()).toBe(5);

    // Arrasto sem modificador substitui tudo.
    fireEvent.mouseDown(cell(2, 2), { button: 0 });
    fireEvent.mouseEnter(cell(3, 2));
    expect(ariaSelectedCount()).toBe(2);
    fireEvent.mouseUp(window);
    expect(selectionSize()).toBe(2);
  });

  it('arrastar para fora do grid e voltar mantém o retângulo grudado nos limites', () => {
    render(<SelectableGrid view={pjView} />);

    fireEvent.mouseDown(cell(2, 2), { button: 0 });
    // Ponteiro muito além do canto inferior direito: sem `getBoundingClientRect`
    // no jsdom, o clamp é exercitado pela própria coordenada de célula.
    fireEvent.mouseMove(window, { clientX: 10_000, clientY: 10_000 });
    fireEvent.mouseEnter(cell(5, 7));
    expect(ariaSelectedCount()).toBe(4 * 6);
    // Voltando para dentro, o retângulo encolhe.
    fireEvent.mouseEnter(cell(3, 3));
    expect(ariaSelectedCount()).toBe(4);
    fireEvent.mouseUp(window);
    expect(selectionSize()).toBe(4);
  });
});

describe('§5 — cabeçalhos em qualquer nível', () => {
  it('clicar em "Varejo" (nível 0) seleciona exatamente 18 células — 3 linhas × 6 colunas', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(header('Y', 0, 'VAREJO'));

    expect(selectionSize()).toBe(18);
    expect(header('Y', 0, 'VAREJO')).toHaveAttribute('data-selected', 'true');
  });

  it('clicar em "Corporate" seleciona 12 — 2 linhas × 6 colunas', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(header('Y', 0, 'CORPORATE'));

    expect(selectionSize()).toBe(12);
  });

  it('clicar num cabeçalho de nível 1 seleciona 1 linha só', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(header('Y', 1, 'VAREJO|100K_500K'));

    expect(selectionSize()).toBe(6);
    expect(header('Y', 1, 'VAREJO|100K_500K')).toHaveAttribute('data-selected', 'true');
    // O nível 0 não acende com uma linha só das três.
    expect(header('Y', 0, 'VAREJO')).not.toHaveAttribute('data-selected');
  });

  it('clicar num cabeçalho de X seleciona a coluna inteira', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(header('X', 0, X[2]!));

    expect(selectionSize()).toBe(8);
    expect(header('X', 0, X[2]!)).toHaveAttribute('data-selected', 'true');
  });

  it('Shift + clique em cabeçalho estende a faixa do mesmo nível — de Varejo a Corporate pega o Atacado', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(header('Y', 0, 'VAREJO'));
    await user.keyboard('{Shift>}');
    await user.click(header('Y', 0, 'CORPORATE'));
    await user.keyboard('{/Shift}');

    expect(selectionSize()).toBe(48);
    expect(header('Y', 0, 'ATACADO')).toHaveAttribute('data-selected', 'true');
  });

  it('Ctrl + clique em cabeçalho soma ao que já estava selecionado', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(header('Y', 0, 'VAREJO'));
    await user.keyboard('{Control>}');
    await user.click(header('Y', 0, 'CORPORATE'));
    await user.keyboard('{/Control}');

    expect(selectionSize()).toBe(30);
    expect(header('Y', 0, 'ATACADO')).not.toHaveAttribute('data-selected');
  });

  it('Ctrl + clique num cabeçalho inteiramente selecionado o remove', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(header('Y', 0, 'VAREJO'));
    await user.keyboard('{Control>}');
    await user.click(header('Y', 0, 'VAREJO'));
    await user.keyboard('{/Control}');

    expect(selectionSize()).toBe(0);
  });

  it('cabeçalho de nível 0 acende quando as 3 linhas são selecionadas por outro caminho', () => {
    render(<SelectableGrid view={pjView} />);

    // Arrasto cobrindo as 3 linhas do Varejo em todas as colunas.
    fireEvent.mouseDown(cell(0, 0), { button: 0 });
    fireEvent.mouseEnter(cell(5, 2));
    fireEvent.mouseUp(window);

    expect(selectionSize()).toBe(18);
    expect(header('Y', 0, 'VAREJO')).toHaveAttribute('data-selected', 'true');
    expect(header('Y', 1, 'VAREJO|500K_1M')).toHaveAttribute('data-selected', 'true');
    expect(header('Y', 0, 'ATACADO')).not.toHaveAttribute('data-selected');
  });

  it('clicar no canto superior esquerdo seleciona tudo', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(screen.getByTestId('grid-corner'));

    expect(selectionSize()).toBe(48);
    expect(screen.getByTestId('grid-corner')).toHaveAttribute('data-selected', 'true');
  });

  it('cabeçalhos são alcançáveis por teclado e respondem a Enter', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    header('Y', 0, 'ATACADO').focus();
    expect(header('Y', 0, 'ATACADO')).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(selectionSize()).toBe(18);
  });
});

describe('§5 — teclado', () => {
  it('setas movem a seleção única na ordem visual das tuplas', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(cell(0, 2));
    await user.keyboard('{ArrowDown}');

    // Índice 3 é ATACADO|500K_1M: a ordem é a das tuplas, não a dos códigos.
    expect(selectedKeys()).toEqual([`${X[0]}::${Y[3]}`]);
    expect(cell(0, 3)).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(selectedKeys()).toEqual([`${X[1]}::${Y[3]}`]);
  });

  it('setas grudam nos limites do grid', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(cell(0, 0));
    await user.keyboard('{ArrowUp}{ArrowLeft}');

    expect(selectedKeys()).toEqual([`${X[0]}::${Y[0]}`]);
  });

  it('Shift + setas expande a partir da âncora e encolhe ao inverter a direção', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(cell(2, 2));
    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    expect(selectionSize()).toBe(3);

    await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
    expect(selectionSize()).toBe(2);

    // Duas inversões: volta à própria âncora, sem acumular para cima.
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
    expect(selectedKeys()).toEqual([`${X[2]}::${Y[2]}`]);
  });

  it('Shift + setas cruzando a âncora inverte o retângulo em vez de crescer para os dois lados', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(cell(2, 2));
    await user.keyboard('{Shift>}{ArrowUp}{ArrowUp}{/Shift}');

    expect(selectedKeys()).toEqual([
      `${X[2]}::${Y[0]}`,
      `${X[2]}::${Y[1]}`,
      `${X[2]}::${Y[2]}`,
    ]);
  });

  it('Ctrl + A seleciona tudo', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(cell(0, 0));
    await user.keyboard('{Control>}a{/Control}');

    expect(selectionSize()).toBe(48);
  });

  it('Esc limpa a seleção', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(header('Y', 0, 'VAREJO'));
    expect(selectionSize()).toBe(18);

    cell(0, 0).focus();
    await user.keyboard('{Escape}');
    expect(selectionSize()).toBe(0);
    expect(useEditorStore.getState().anchor).toBeNull();
  });

  it('Esc sem nada selecionado não engole o evento', () => {
    render(<SelectableGrid view={pjView} />);

    const target = cell(0, 0);
    target.focus();
    const notPrevented = fireEvent.keyDown(target, { key: 'Escape' });

    // `fireEvent` devolve `false` quando o evento foi cancelado.
    expect(notPrevented).toBe(true);
  });

  it('as teclas só agem com o foco no grid: digitar fora não mexe na seleção', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="campo do inspector" />
        <SelectableGrid view={pjView} />
      </>,
    );

    await user.click(cell(1, 1));
    expect(selectionSize()).toBe(1);

    const input = screen.getByLabelText('campo do inspector');
    await user.click(input);
    await user.keyboard('{ArrowDown}{ArrowRight}abc{Escape}');

    expect(input).toHaveValue('abc');
    expect(selectedKeys()).toEqual([`${X[1]}::${Y[1]}`]);
  });

  it('roving tabindex: só a célula focada é tabulável', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(cell(2, 1));

    expect(cell(2, 1)).toHaveAttribute('tabindex', '0');
    expect(cell(0, 0)).toHaveAttribute('tabindex', '-1');
  });
});

describe('§5 — contador e anúncio', () => {
  it('mostra o caminho legível quando é uma célula só', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(cell(2, 1));

    const counter = screen.getByTestId('selection-counter');
    expect(counter).toHaveAttribute('aria-live', 'polite');
    // Rótulos dos domínios, não códigos: `${caminho de Y} × ${caminho de X}`.
    expect(counter.textContent).toBe('Varejo › R$ 100 mil a R$ 500 mil × R3 — Risco moderado-baixo');
  });

  it('mostra a contagem quando são várias', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid view={pjView} />);

    await user.click(header('Y', 0, 'VAREJO'));

    expect(screen.getByTestId('selection-counter').textContent).toBe('18 células selecionadas');
  });

  it('fica vazio sem seleção', () => {
    render(<SelectableGrid view={pjView} />);
    expect(screen.getByTestId('selection-counter').textContent).toBe('');
  });
});

describe('versão não editável', () => {
  it('a seleção continua funcionando numa versão publicada', async () => {
    const user = userEvent.setup();
    // `MTZ_LIMITE_PJ` do exemplo só tem versão PUBLISHED.
    expect(pjView.editable).toBe(false);

    render(<SelectableGrid view={pjView} />);
    await user.click(header('Y', 0, 'VAREJO'));

    expect(selectionSize()).toBe(18);
  });
});

describe('grid somente leitura (sem a API de seleção)', () => {
  it('não marca `aria-selected` nem responde a clique', async () => {
    const user = userEvent.setup();
    render(<Grid view={pjView} zoom={1} />);

    await user.click(cell(1, 1));

    expect(selectionSize()).toBe(0);
    expect(cell(1, 1)).not.toHaveAttribute('aria-selected');
    expect(cell(1, 1)).not.toHaveAttribute('tabindex');
  });
});

describe('desempenho — 1.500 combinações', () => {
  /** X de 30 colunas × Y de 50 linhas = 1.500 combinações (o teto de alerta). */
  function largeView(): EditorView {
    const xTuples = Array.from({ length: 30 }, (_unused, index) => `C${index}`);
    const yTuples = Array.from({ length: 50 }, (_unused, index) => `L${index}`);
    const buildAxis = (role: 'X' | 'Y', tuples: string[]) => ({
      axis: {
        role,
        levels: [
          {
            id: `lvl-${role}`,
            variableId: role,
            variableVersionId: `${role}-v1`,
            label: role,
            domains: tuples.map((code, position) => ({ code, label: code, position })),
          },
        ],
        tuples,
        derivedFrom: { compatibilityVersionIds: [] },
      },
      headerRows: [
        {
          level: 0,
          cells: tuples.map((code, index) => ({
            code,
            label: code,
            path: code,
            span: 1,
            startIndex: index,
          })),
        },
      ],
      levelCount: 1,
      tupleCount: tuples.length,
    });

    return {
      ...pjView,
      x: buildAxis('X', xTuples) as EditorView['x'],
      y: buildAxis('Y', yTuples) as EditorView['y'],
      cells: {},
      stats: { combinations: 1500, filledCells: 0, decidedCells: 0, pendingCells: 1500 },
    };
  }

  it('um passo do marquee sobre 1.500 células comita rápido', () => {
    const view = largeView();
    render(<SelectableGrid view={view} />);
    expect(screen.getAllByRole('gridcell')).toHaveLength(1500);

    const first = document.querySelector<HTMLElement>('[data-cell-key="C0::L0"]')!;
    const middle = document.querySelector<HTMLElement>('[data-cell-key="C20::L30"]')!;
    const next = document.querySelector<HTMLElement>('[data-cell-key="C21::L30"]')!;

    fireEvent.mouseDown(first, { button: 0 });
    act(() => {
      fireEvent.mouseEnter(middle);
    });

    const start = performance.now();
    act(() => {
      fireEvent.mouseEnter(next);
    });
    const elapsed = performance.now() - start;

    // O `mousemove` não recria o `Set` da seleção: o commit é proporcional às
    // células que entram no retângulo, não às 1.500. O limite é folgado de
    // propósito — o teste denuncia regressão de ordem de grandeza (recriar a
    // seleção a cada quadro custa centenas de ms aqui), não variação de máquina.
    expect(elapsed).toBeLessThan(250);
    // A seleção materializada segue sendo a do `mousedown` — o arrasto ainda
    // não escreveu nada no `Set`.
    expect(useEditorStore.getState().selection.size).toBe(1);

    fireEvent.mouseUp(window);
    expect(useEditorStore.getState().selection.size).toBe(22 * 31);
  });
});
