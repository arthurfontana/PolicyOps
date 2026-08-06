import { create } from 'zustand';
import type { AxisRole } from '@/core/document/schema';
import {
  allCoords,
  coordsUnderHeader,
  expandFrom,
  headerRangeCoords,
  isHeaderFullySelected,
  rectBetween,
  stepCoord,
  toKey,
  type Coord,
  type Direction,
  type SelectionView,
} from '@/core/axes/selection';
import { useDocumentStore } from './document-store';

/**
 * Estado de navegação do editor de matriz (projeto, matriz e versão abertas,
 * zoom) e a **engine de seleção** do grid — docs/07-ux-e-editor.md §5,
 * docs/09-roadmap-de-entregas.md S09/S10.
 *
 * Fica fora de `ui-store` porque referencia ids do documento (projeto,
 * matriz, versão): abrir um documento novo invalida esses ids, então
 * `usePersistenceStore`/`useDocumentStore` são quem decide quando limpar
 * (`reset`), e não a troca de tela.
 *
 * A seleção é uma casca fina: nenhum cálculo de retângulo, de prefixo ou de
 * ordem visual vive aqui — tudo vem de `src/core/axes/selection.ts`. As ações
 * que precisam de geometria recebem a `SelectionView` como primeiro argumento,
 * em vez de o store guardar uma cópia da view: a view é derivada do documento
 * (`getEditorView`, memoizada) e duplicá-la no store criaria duas fontes de
 * verdade para as tuplas.
 */

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
}

/** Arrasto em curso. A seleção só é materializada no `mouseup` (§6 da S10). */
export interface MarqueeState {
  active: boolean;
  /** `Ctrl/Cmd + arrastar` soma ao que já estava selecionado; sem modificador, substitui. */
  additive: boolean;
  from: Coord;
  to: Coord;
}

/**
 * Âncora dos cabeçalhos, separada da âncora de células: `Shift + clique em
 * cabeçalho` estende a faixa **do mesmo nível**, então precisa lembrar de qual
 * cabeçalho (e de qual nível de qual eixo) a faixa partiu.
 */
export interface HeaderAnchor {
  role: AxisRole;
  level: number;
  path: string;
}

function keysOf(coords: Coord[]): Set<string> {
  const keys = new Set<string>();
  for (const coord of coords) keys.add(toKey(coord));
  return keys;
}

/**
 * Função e não constante: um `Set` compartilhado entre dois estados seria uma
 * referência mutável viajando no tempo — cada limpeza precisa do seu.
 */
function emptySelection(): Pick<
  EditorState,
  'selection' | 'anchor' | 'focus' | 'headerAnchor' | 'marquee'
> {
  return {
    selection: new Set<string>(),
    anchor: null,
    focus: null,
    headerAnchor: null,
    marquee: null,
  };
}

interface EditorState {
  /** Projeto selecionado em `/projects` — `null` mostra a lista. */
  selectedProjectId: string | null;
  /** Matriz e versão abertas na tela de matriz — `null` é o estado vazio. */
  currentMatrixId: string | null;
  currentVersionId: string | null;
  zoom: number;

  /**
   * `false` em versão publicada, superada ou descartada. A **seleção continua
   * funcionando** — é útil para inspecionar uma versão histórica; o que a
   * flag governa é a edição (S11), não a seleção.
   */
  isEditable: boolean;

  selection: Set<string>;
  anchor: Coord | null;
  focus: Coord | null;
  headerAnchor: HeaderAnchor | null;
  marquee: MarqueeState | null;

  setSelectedProject: (projectId: string | null) => void;
  openMatrix: (matrixId: string, versionId: string | null) => void;
  setVersion: (versionId: string) => void;
  closeMatrix: () => void;
  setEditable: (isEditable: boolean) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  reset: () => void;

  selectSingle: (coord: Coord) => void;
  /** Seleção explícita de um conjunto de coordenadas — é o que uma operação de eixo faz com as combinações novas (S12). */
  selectCoords: (coords: Coord[]) => void;
  extendTo: (view: SelectionView, coord: Coord) => void;
  toggle: (coord: Coord) => void;
  selectRect: (view: SelectionView, from: Coord, to: Coord, additive?: boolean) => void;
  selectHeader: (view: SelectionView, role: AxisRole, level: number, prefixPath: string) => void;
  extendHeader: (view: SelectionView, role: AxisRole, level: number, prefixPath: string) => void;
  toggleHeader: (view: SelectionView, role: AxisRole, level: number, prefixPath: string) => void;
  selectAll: (view: SelectionView) => void;
  clear: () => void;
  moveFocus: (view: SelectionView, direction: Direction, options?: { shift?: boolean }) => void;
  startMarquee: (coord: Coord, additive: boolean) => void;
  updateMarquee: (coord: Coord) => void;
  endMarquee: (view: SelectionView) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  selectedProjectId: null,
  currentMatrixId: null,
  currentVersionId: null,
  zoom: 1,
  isEditable: false,
  selection: new Set<string>(),
  anchor: null,
  focus: null,
  headerAnchor: null,
  marquee: null,

  setSelectedProject: (projectId) => set({ selectedProjectId: projectId }),

  // Abrir outra matriz ou outra versão troca o conjunto de tuplas: manter a
  // seleção apontaria para combinações que não existem no novo grid.
  openMatrix: (matrixId, versionId) =>
    set({ currentMatrixId: matrixId, currentVersionId: versionId, zoom: 1, ...emptySelection() }),

  setVersion: (versionId) => set({ currentVersionId: versionId, ...emptySelection() }),

  closeMatrix: () => set({ currentMatrixId: null, currentVersionId: null, ...emptySelection() }),

  setEditable: (isEditable) => set({ isEditable }),

  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),

  zoomIn: () => set({ zoom: clampZoom(get().zoom + ZOOM_STEP) }),

  zoomOut: () => set({ zoom: clampZoom(get().zoom - ZOOM_STEP) }),

  resetZoom: () => set({ zoom: 1 }),

  reset: () =>
    set({
      selectedProjectId: null,
      currentMatrixId: null,
      currentVersionId: null,
      zoom: 1,
      isEditable: false,
      ...emptySelection(),
    }),

  // --- Seleção de células ---------------------------------------------------

  selectSingle: (coord) =>
    set({
      selection: new Set([toKey(coord)]),
      anchor: coord,
      focus: coord,
      headerAnchor: null,
      marquee: null,
    }),

  // Não passa pela geometria: as coordenadas já vêm calculadas pelo comando
  // que acabou de rodar (as combinações que nasceram da operação de eixo).
  selectCoords: (coords) => {
    const first = coords[0] ?? null;
    set({
      selection: keysOf(coords),
      anchor: first,
      focus: coords[coords.length - 1] ?? first,
      headerAnchor: null,
      marquee: null,
    });
  },

  // `Shift + clique` parte da **âncora**, não da última célula clicada. Sem
  // âncora (primeiro clique da sessão) o alvo vira seleção única.
  extendTo: (view, coord) => {
    const anchor = get().anchor;
    if (anchor === null) {
      get().selectSingle(coord);
      return;
    }
    set({ selection: keysOf(rectBetween(view, anchor, coord)), focus: coord, marquee: null });
  },

  // `Ctrl/Cmd + clique` alterna a célula **e** a torna a nova âncora, mesmo
  // quando a remove da seleção — é de lá que o próximo Shift + clique parte.
  toggle: (coord) => {
    const key = toKey(coord);
    const selection = new Set(get().selection);
    if (selection.has(key)) selection.delete(key);
    else selection.add(key);
    set({ selection, anchor: coord, focus: coord, headerAnchor: null, marquee: null });
  },

  selectRect: (view, from, to, additive = false) => {
    const rect = keysOf(rectBetween(view, from, to));
    const selection = additive ? new Set([...get().selection, ...rect]) : rect;
    set({ selection, anchor: from, focus: to, headerAnchor: null, marquee: null });
  },

  // --- Seleção por cabeçalho ------------------------------------------------

  selectHeader: (view, role, level, prefixPath) => {
    const coords = coordsUnderHeader(view, role, prefixPath);
    const first = coords[0] ?? null;
    set({
      selection: keysOf(coords),
      anchor: first,
      focus: first,
      headerAnchor: { role, level, path: prefixPath },
      marquee: null,
    });
  },

  // A âncora de cabeçalho é preservada: estender duas vezes seguidas parte
  // sempre do mesmo cabeçalho inicial, como no Shift + clique de células.
  extendHeader: (view, role, level, prefixPath) => {
    const headerAnchor = get().headerAnchor;
    if (headerAnchor === null || headerAnchor.role !== role || headerAnchor.level !== level) {
      get().selectHeader(view, role, level, prefixPath);
      return;
    }
    const coords = headerRangeCoords(view, role, level, headerAnchor.path, prefixPath);
    set({ selection: keysOf(coords), focus: coords[coords.length - 1] ?? null, marquee: null });
  },

  toggleHeader: (view, role, level, prefixPath) => {
    const coords = coordsUnderHeader(view, role, prefixPath);
    const selection = new Set(get().selection);
    // Cabeçalho inteiro dentro da seleção sai inteiro; caso contrário, entra
    // inteiro — parcialmente selecionado, o gesto completa em vez de esvaziar.
    if (isHeaderFullySelected(view, role, prefixPath, selection)) {
      for (const coord of coords) selection.delete(toKey(coord));
    } else {
      for (const coord of coords) selection.add(toKey(coord));
    }
    const first = coords[0] ?? null;
    set({
      selection,
      anchor: first,
      focus: first,
      headerAnchor: { role, level, path: prefixPath },
      marquee: null,
    });
  },

  // --- Tudo, nada, teclado --------------------------------------------------

  selectAll: (view) => {
    const coords = allCoords(view);
    const first = coords[0] ?? null;
    set({
      selection: keysOf(coords),
      anchor: first,
      focus: coords[coords.length - 1] ?? first,
      headerAnchor: null,
      marquee: null,
    });
  },

  clear: () => set(emptySelection()),

  moveFocus: (view, direction, options) => {
    const { anchor, focus } = get();
    const current = focus ?? anchor ?? allCoords(view)[0] ?? null;
    if (current === null) return;

    if (options?.shift !== true) {
      get().selectSingle(stepCoord(view, current, direction));
      return;
    }
    // Shift + setas expande a partir da âncora e **encolhe** ao inverter a
    // direção: o retângulo é sempre recalculado, nunca somado.
    const base = anchor ?? current;
    const next = stepCoord(view, current, direction);
    set({
      selection: keysOf(expandFrom(view, base, direction, current)),
      anchor: base,
      focus: next,
      headerAnchor: null,
      marquee: null,
    });
  },

  // --- Marquee --------------------------------------------------------------

  startMarquee: (coord, additive) =>
    set({ marquee: { active: true, additive, from: coord, to: coord } }),

  // Só move a ponta do retângulo: o `Set` da seleção **não** é recriado a cada
  // `mousemove` (§6) — o grid deriva o retângulo na renderização.
  updateMarquee: (coord) => {
    const marquee = get().marquee;
    if (marquee === null || !marquee.active) return;
    if (marquee.to.xPath === coord.xPath && marquee.to.yPath === coord.yPath) return;
    set({ marquee: { ...marquee, to: coord } });
  },

  endMarquee: (view) => {
    const marquee = get().marquee;
    if (marquee === null) return;
    const { additive, from, to } = marquee;
    const isClick = from.xPath === to.xPath && from.yPath === to.yPath;
    // Clique sem arrasto: com Ctrl/Cmd alterna a célula; sem modificador a
    // seleção única já foi aplicada no `mousedown`, então só encerra o gesto.
    if (isClick) {
      if (additive) get().toggle(from);
      else set({ marquee: null });
      return;
    }
    get().selectRect(view, from, to, additive);
  },
}));

// Um documento diferente (ou nenhum) invalida os ids selecionados: sem isso,
// abrir outro arquivo com uma matriz aberta deixaria a tela de matriz
// apontando para um id que não existe mais neste documento.
let lastDocumentId: string | null = null;
useDocumentStore.subscribe((state) => {
  const nextId = state.document?.meta.id ?? null;
  if (nextId === lastDocumentId) return;
  lastDocumentId = nextId;
  useEditorStore.getState().reset();
});
