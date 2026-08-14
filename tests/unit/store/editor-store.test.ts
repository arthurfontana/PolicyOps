import { beforeEach, describe, expect, it } from 'vitest';
import type { SelectionView } from '@/core/axes/selection';
import { MAX_BOARD_ITEMS, useEditorStore } from '@/store/editor-store';

/**
 * O que o store da seleção faz *além* de delegar para
 * `src/core/axes/selection.ts` — docs/07-ux-e-editor.md §5. A geometria é
 * provada em `tests/unit/core/axes/selection.test.ts` e as interações no teste
 * de componente; aqui ficam a âncora, a limpeza e o ciclo do marquee.
 */

const view: SelectionView = {
  x: { axis: { tuples: ['R1', 'R2', 'R3'] } },
  y: { axis: { tuples: ['VAREJO|A', 'VAREJO|B', 'ATACADO|B'] } },
};

function store() {
  return useEditorStore.getState();
}

beforeEach(() => {
  useEditorStore.getState().reset();
});

describe('âncora e foco', () => {
  it('`extendTo` sem âncora cai em seleção única', () => {
    store().extendTo(view, { xPath: 'R2', yPath: 'VAREJO|B' });
    expect([...store().selection]).toEqual(['R2::VAREJO|B']);
    expect(store().anchor).toEqual({ xPath: 'R2', yPath: 'VAREJO|B' });
  });

  it('`extendTo` mantém a âncora e move só o foco', () => {
    store().selectSingle({ xPath: 'R1', yPath: 'VAREJO|A' });
    store().extendTo(view, { xPath: 'R2', yPath: 'VAREJO|B' });
    expect(store().selection.size).toBe(4);
    expect(store().anchor).toEqual({ xPath: 'R1', yPath: 'VAREJO|A' });
    expect(store().focus).toEqual({ xPath: 'R2', yPath: 'VAREJO|B' });
  });

  it('`toggle` alterna e reancora nas duas direções', () => {
    const coord = { xPath: 'R3', yPath: 'ATACADO|B' };
    store().toggle(coord);
    expect(store().selection.has('R3::ATACADO|B')).toBe(true);
    store().toggle(coord);
    expect(store().selection.size).toBe(0);
    expect(store().anchor).toEqual(coord);
  });

  it('`selectRect` aditivo soma ao que já estava', () => {
    store().selectSingle({ xPath: 'R3', yPath: 'ATACADO|B' });
    store().selectRect(view, { xPath: 'R1', yPath: 'VAREJO|A' }, { xPath: 'R1', yPath: 'VAREJO|B' }, true);
    expect(store().selection.size).toBe(3);
  });

  it('`moveFocus` sem foco nem âncora começa pela primeira combinação', () => {
    store().moveFocus(view, 'DOWN');
    expect([...store().selection]).toEqual(['R1::VAREJO|B']);
  });

  it('`moveFocus` num grid vazio não faz nada', () => {
    const empty: SelectionView = { x: { axis: { tuples: [] } }, y: { axis: { tuples: [] } } };
    store().moveFocus(empty, 'DOWN');
    expect(store().selection.size).toBe(0);
    expect(store().focus).toBeNull();
  });

  it('`moveFocus` com Shift sem âncora ancora na própria célula corrente', () => {
    store().moveFocus(view, 'DOWN');
    store().clear();
    store().moveFocus(view, 'RIGHT', { shift: true });
    expect(store().anchor).toEqual({ xPath: 'R1', yPath: 'VAREJO|A' });
    expect(store().selection.size).toBe(2);
  });
});

describe('cabeçalhos', () => {
  it('`extendHeader` sem âncora de cabeçalho age como `selectHeader`', () => {
    store().extendHeader(view, 'Y', 0, 'ATACADO');
    expect(store().selection.size).toBe(3);
    expect(store().headerAnchor).toEqual({ role: 'Y', level: 0, path: 'ATACADO' });
  });

  it('`extendHeader` de outro nível reancora em vez de estender atravessado', () => {
    store().selectHeader(view, 'Y', 0, 'VAREJO');
    store().extendHeader(view, 'Y', 1, 'ATACADO|B');
    expect(store().selection.size).toBe(3);
    expect(store().headerAnchor).toEqual({ role: 'Y', level: 1, path: 'ATACADO|B' });
  });

  it('`extendHeader` preserva a âncora: estender duas vezes parte sempre do mesmo cabeçalho', () => {
    store().selectHeader(view, 'Y', 1, 'VAREJO|A');
    store().extendHeader(view, 'Y', 1, 'ATACADO|B');
    expect(store().selection.size).toBe(9);
    store().extendHeader(view, 'Y', 1, 'VAREJO|B');
    expect(store().selection.size).toBe(6);
    expect(store().headerAnchor).toEqual({ role: 'Y', level: 1, path: 'VAREJO|A' });
  });

  it('`toggleHeader` completa a seleção parcial antes de esvaziá-la', () => {
    store().selectSingle({ xPath: 'R1', yPath: 'VAREJO|A' });
    store().toggleHeader(view, 'Y', 0, 'VAREJO');
    expect(store().selection.size).toBe(6);
    store().toggleHeader(view, 'Y', 0, 'VAREJO');
    expect(store().selection.size).toBe(0);
  });

  it('`selectHeader` com prefixo inexistente não deixa âncora pendurada', () => {
    store().selectHeader(view, 'Y', 0, 'INEXISTENTE');
    expect(store().selection.size).toBe(0);
    expect(store().anchor).toBeNull();
  });
});

describe('marquee', () => {
  it('clique sem arrasto encerra o gesto sem mexer na seleção já aplicada', () => {
    const coord = { xPath: 'R2', yPath: 'VAREJO|B' };
    store().selectSingle(coord);
    store().startMarquee(coord, false);
    store().endMarquee(view);
    expect([...store().selection]).toEqual(['R2::VAREJO|B']);
    expect(store().marquee).toBeNull();
  });

  it('Ctrl + clique sem arrasto alterna a célula no `mouseup`', () => {
    const coord = { xPath: 'R2', yPath: 'VAREJO|B' };
    store().startMarquee(coord, true);
    store().endMarquee(view);
    expect([...store().selection]).toEqual(['R2::VAREJO|B']);
  });

  it('`updateMarquee` ignora coordenada repetida e não faz nada sem marquee', () => {
    store().updateMarquee({ xPath: 'R1', yPath: 'VAREJO|A' });
    expect(store().marquee).toBeNull();

    store().startMarquee({ xPath: 'R1', yPath: 'VAREJO|A' }, false);
    const before = store().marquee;
    store().updateMarquee({ xPath: 'R1', yPath: 'VAREJO|A' });
    expect(store().marquee).toBe(before);
  });

  it('`endMarquee` sem marquee é inócuo', () => {
    store().endMarquee(view);
    expect(store().selection.size).toBe(0);
  });

  it('arrasto materializa o retângulo no fim', () => {
    store().startMarquee({ xPath: 'R1', yPath: 'VAREJO|A' }, false);
    store().updateMarquee({ xPath: 'R2', yPath: 'VAREJO|B' });
    expect(store().selection.size).toBe(0);
    store().endMarquee(view);
    expect(store().selection.size).toBe(4);
    expect(store().marquee).toBeNull();
  });
});

describe('ciclo de vida da seleção', () => {
  it('trocar de versão limpa a seleção — as tuplas mudaram', () => {
    store().selectAll(view);
    expect(store().selection.size).toBe(9);
    store().setVersion('outra-versao');
    expect(store().selection.size).toBe(0);
    expect(store().anchor).toBeNull();
    expect(store().focus).toBeNull();
  });

  it('abrir e fechar matriz também limpa', () => {
    store().selectAll(view);
    store().openMatrix('m1', 'v1');
    expect(store().selection.size).toBe(0);

    store().selectAll(view);
    store().closeMatrix();
    expect(store().selection.size).toBe(0);
  });

  it('cada limpeza devolve um `Set` próprio', () => {
    store().selectAll(view);
    const first = store().selection;
    store().clear();
    const cleared = store().selection;
    store().selectAll(view);
    store().clear();
    expect(cleared).not.toBe(store().selection);
    expect(first).not.toBe(cleared);
  });

  it('`isEditable` é só um marcador: a seleção funciona igual', () => {
    store().setEditable(false);
    store().selectAll(view);
    expect(store().isEditable).toBe(false);
    expect(store().selection.size).toBe(9);
  });
});

describe('zoom', () => {
  it('gruda entre 50% e 200%', () => {
    store().setZoom(5);
    expect(store().zoom).toBe(2);
    store().setZoom(0.1);
    expect(store().zoom).toBe(0.5);
    store().resetZoom();
    expect(store().zoom).toBe(1);
    store().zoomIn();
    expect(store().zoom).toBe(1.1);
    store().zoomOut();
    expect(store().zoom).toBe(1);
  });
});

describe('board de comparação (docs/07 §9b)', () => {
  it('fixa e remove matrizes', () => {
    store().pinToBoard('mtz-1', 'v1');
    store().pinToBoard('mtz-2', 'v1');
    expect(store().boardItems).toEqual([
      { matrixId: 'mtz-1', versionId: 'v1' },
      { matrixId: 'mtz-2', versionId: 'v1' },
    ]);

    store().unpinFromBoard('mtz-1');
    expect(store().boardItems).toEqual([{ matrixId: 'mtz-2', versionId: 'v1' }]);
  });

  it('fixar a mesma matriz de novo atualiza a versão em vez de duplicar', () => {
    store().pinToBoard('mtz-1', 'v1');
    store().pinToBoard('mtz-1', 'v2');
    expect(store().boardItems).toEqual([{ matrixId: 'mtz-1', versionId: 'v2' }]);
  });

  it('não fixa além de `MAX_BOARD_ITEMS`', () => {
    for (let i = 0; i < MAX_BOARD_ITEMS + 2; i += 1) {
      store().pinToBoard(`mtz-${i}`, 'v1');
    }
    expect(store().boardItems).toHaveLength(MAX_BOARD_ITEMS);
  });

  it('`clearBoard` esvazia tudo', () => {
    store().pinToBoard('mtz-1', 'v1');
    store().pinToBoard('mtz-2', 'v1');
    store().clearBoard();
    expect(store().boardItems).toEqual([]);
  });

  it('`reset` também esvazia o board', () => {
    store().pinToBoard('mtz-1', 'v1');
    store().reset();
    expect(store().boardItems).toEqual([]);
  });
});
