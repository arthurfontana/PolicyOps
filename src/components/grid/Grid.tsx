import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodePath } from '@/core/axes/paths';
import { coordIndex, toKey, type Coord, type Direction } from '@/core/axes/selection';
import type { HeaderRow } from '@/core/axes/header-layout';
import type { AxisRole } from '@/core/document/schema';
import type { CellChangeKind } from '@/core/diff/types';
import type { EditorAxisView, EditorView } from '@/core/queries';
import {
  cellRingShadow,
  contrastText,
  FOCUS_RING_COLOR,
  HEADER_SELECTED_FILL_COLOR,
  isCellPending,
  MARQUEE_BORDER_COLOR,
  MARQUEE_FILL_COLOR,
  resolveCellColor,
  SELECTION_COLOR,
} from '@/lib/colors';
import { formatBRL, formatBRLRange, formatThousands } from '@/lib/format';

/**
 * O grid com cabeçalhos aninhados — docs/07-ux-e-editor.md §4 e §5,
 * docs/04-eixos-aninhados.md §4 e §7. CSS Grid em DOM puro, sem canvas nem
 * biblioteca de terceiros.
 *
 * Componente de apresentação: recebe `EditorView` (a saída de `getEditorView`),
 * o zoom e — opcionalmente — a API de seleção. Não importa nenhum store; quem
 * chama decide de onde vêm esses dados. Sem `selection`, o grid é somente
 * leitura (é o caso das miniaturas de portfólio, §10).
 *
 * A geometria da seleção mora em `src/core/axes/selection.ts`; aqui só há
 * tradução de evento em intenção e de estado em pixel.
 */

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
const BASE_CELL_WIDTH = 88;
const BASE_CELL_HEIGHT = 56;
/** Célula de 12px, só cor, sem texto — a miniatura de portfólio (docs/07 §10, item 3). */
const THUMBNAIL_CELL_SIZE = 12;
/**
 * Altura da faixa de cabeçalho de X e largura da coluna de cabeçalho de Y.
 * Exportadas porque a tela de comparação precisa delas para alinhar a rolagem
 * de dois grids com **números de níveis diferentes** (S14, modo lado a lado).
 */
export const HEADER_ROW_HEIGHT = 32;
export const Y_HEADER_COL_WIDTH = 120;

/** Menor largura/altura a que uma coluna ou linha pode ser arrastada. */
const MIN_COL_WIDTH = 32;
const MIN_ROW_HEIGHT = 20;

/** Modificadores do gesto, já normalizados (`Cmd` no macOS é `Ctrl` aqui). */
export interface GridModifiers {
  shift: boolean;
  ctrl: boolean;
}

/** Retângulo do arrasto em curso; a seleção só é materializada no `mouseup`. */
export interface GridMarquee {
  additive: boolean;
  from: Coord;
  to: Coord;
}

/**
 * O que o grid precisa para ser selecionável. `useGridSelection(view)` produz
 * essa API a partir do `editor-store`; os testes podem produzir a sua.
 */
export interface GridSelectionApi {
  selection: ReadonlySet<string>;
  anchor: Coord | null;
  focus: Coord | null;
  marquee: GridMarquee | null;
  /** `mousedown` numa célula. */
  pressCell: (coord: Coord, modifiers: GridModifiers) => void;
  /** O ponteiro entrou nesta célula durante o arrasto. */
  hoverCell: (coord: Coord) => void;
  /** `mouseup` em qualquer lugar — inclusive fora do grid. */
  releasePointer: () => void;
  pressHeader: (role: AxisRole, level: number, prefixPath: string, modifiers: GridModifiers) => void;
  selectAll: () => void;
  clear: () => void;
  moveFocus: (direction: Direction, shift: boolean) => void;
  /** `Enter` — foca o primeiro campo do inspector (S11). */
  activate?: () => void;
  /** `Delete` / `Backspace` — limpa as células selecionadas (S11). */
  clearCells?: () => void;
}

/**
 * Sobreposição de diff — docs/07-ux-e-editor.md §9, S14.
 *
 * É o que evita duplicar o grid para a tela de comparação: o mesmo componente
 * ganha marca diagonal, badge do tipo e esmaecimento das inalteradas, e
 * continua sendo o grid da S09 em tudo o mais.
 */
export interface GridDiffOverlay {
  /** Tipo de mudança por chave de célula (`xPath::yPath`). */
  marks: ReadonlyMap<string, CellChangeKind>;
  /** Célula aberta no inspector — recebe o anel de foco. */
  selectedKey?: string | null;
  /**
   * Clique numa célula **alterada**: mostra antes → depois. Só as marcadas
   * ficam clicáveis e recebem parada de tabulação — 1.500 paradas de tab num
   * grid de leitura seriam ruído puro.
   */
  onSelectKey?: (key: string) => void;
  /** Esconde o conteúdo das células inalteradas ("mostrar apenas alteradas"). */
  onlyChanged?: boolean;
  /** Chave sob o ponteiro, compartilhada entre os dois grids do lado a lado. */
  hoverKey?: string | null;
  onHoverKey?: (key: string | null) => void;
  /** Recebe o contêiner de rolagem, para a sincronização do modo lado a lado. */
  registerScrollElement?: (element: HTMLDivElement | null) => void;
}

export interface GridProps {
  view: EditorView;
  zoom: number;
  /** Ctrl+scroll ajusta o zoom — omitido, o gesto é ignorado (ex.: miniaturas). */
  onZoomChange?: (zoom: number) => void;
  /** Omitida, o grid é somente leitura. */
  selection?: GridSelectionApi;
  /**
   * Pulso temporário nas células pendentes — reação a `UNSET_CELLS_REMAIN` ao
   * tentar publicar (docs/prompts/S13, item 2). Puramente visual: não muda
   * seleção nem foco.
   */
  highlightPending?: boolean;
  /** Marca as células alteradas entre duas versões (S14). */
  diffOverlay?: GridDiffOverlay;
  /** Esconde o rodapé de legenda e contadores — a tela de comparação tem os seus. */
  hideFooter?: boolean;
  /**
   * `'thumbnail'`: miniatura de 12px por célula, só cor, sem texto nem
   * cabeçalhos — a visão de portfólio (docs/07 §10, item 3). Os separadores
   * de nível continuam desenhados, para o agrupamento seguir legível.
   * Sempre somente leitura, independente de `selection`.
   */
  variant?: 'full' | 'thumbnail';
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function clampIndex(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

/**
 * Índice (0-based, dentro da área de dados) sob um pixel, a partir dos
 * deslocamentos acumulados das colunas/linhas — a busca binária substitui a
 * divisão fixa por `cellWidth`/`cellHeight` agora que cada uma pode ter um
 * tamanho diferente (redimensionamento por arrasto).
 */
function dataIndexAtOffset(offsets: number[], headerCount: number, count: number, pixel: number): number {
  if (count === 0) return 0;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsets[headerCount + mid]! <= pixel) low = mid;
    else high = mid - 1;
  }
  return clampIndex(low, count - 1);
}

/** Índices (0-based) que fecham um grupo de nível 0 — fronteira de separador forte. */
function topLevelBoundaries(headerRows: HeaderRow[], levelCount: number): Set<number> {
  const boundaries = new Set<number>();
  if (levelCount <= 1 || headerRows.length === 0) return boundaries;
  for (const cell of headerRows[0]!.cells) boundaries.add(cell.startIndex + cell.span - 1);
  return boundaries;
}

/** Caminho legível: `Varejo › 100k–500k`, a partir dos rótulos dos domínios, não dos códigos. */
function readablePath(axisView: EditorAxisView, path: string): string {
  const codes = decodePath(path);
  return codes
    .map((code, level) => {
      const domain = axisView.axis.levels[level]?.domains.find((candidate) => candidate.code === code);
      return domain?.label ?? code;
    })
    .join(' › ');
}

function modifiersOf(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): GridModifiers {
  return { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey };
}

const ARROW_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
};

// ---------------------------------------------------------------------------
// Célula
// ---------------------------------------------------------------------------
// #region: celula

interface GridCellProps {
  xPath: string;
  yPath: string;
  cellKey: string;
  column: number;
  row: number;
  background: string;
  color: string;
  pending: boolean;
  pulsePending: boolean;
  decisionLabel?: string;
  offerLabel?: string;
  limitDisplay?: string;
  hasNote: boolean;
  isXBoundary: boolean;
  isYBoundary: boolean;
  title: string;
  selected: boolean;
  isAnchor: boolean;
  isFocused: boolean;
  /** Recebe o tabindex do roving quando nenhuma célula está focada. */
  isTabStop: boolean;
  interactive: boolean;
  /** Miniatura: sem papel de `gridcell`, sem foco — puramente visual (docs/07 §10). */
  decorative?: boolean;
  onPress?: (coord: Coord, modifiers: GridModifiers) => void;
  onHover?: (coord: Coord) => void;
  /** --- Sobreposição de diff (S14) --- */
  diffKind?: CellChangeKind;
  /** Célula inalterada num diff: 40% de opacidade (docs/07 §9). */
  diffDimmed?: boolean;
  /** "Mostrar apenas alteradas": a inalterada perde o conteúdo, não a posição. */
  diffBlank?: boolean;
  diffSelected?: boolean;
  diffHovered?: boolean;
  onDiffSelect?: (key: string) => void;
  onDiffHover?: (key: string | null) => void;
}

/** Letra do badge do tipo de mudança — cor nunca é o único portador (docs/05 §3). */
const DIFF_BADGE: Record<CellChangeKind, string> = {
  ADDED: '+',
  REMOVED: '−',
  MODIFIED: '~',
};

const DIFF_CELL_CLASS: Record<CellChangeKind, string> = {
  ADDED: 'policy-diff-added',
  REMOVED: 'policy-diff-removed',
  MODIFIED: 'policy-diff-modified',
};

function GridCellImpl(props: GridCellProps) {
  const {
    xPath,
    yPath,
    cellKey,
    column,
    row,
    background,
    color,
    pending,
    pulsePending,
    decisionLabel,
    offerLabel,
    limitDisplay,
    hasNote,
    isXBoundary,
    isYBoundary,
    title,
    selected,
    isAnchor,
    isFocused,
    isTabStop,
    interactive,
    decorative = false,
    onPress,
    onHover,
    diffKind,
    diffDimmed = false,
    diffBlank = false,
    diffSelected = false,
    diffHovered = false,
    onDiffSelect,
    onDiffHover,
  } = props;

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (onPress === undefined || event.button !== 0) return;
      // Impede o navegador de iniciar seleção de texto durante o arrasto — e,
      // como `preventDefault` também cancela o foco automático, o foco é dado
      // à mão: sem isso, clicar numa célula e usar as setas não funcionaria.
      event.preventDefault();
      event.currentTarget.focus();
      onPress({ xPath, yPath }, modifiersOf(event));
    },
    [onPress, xPath, yPath],
  );

  const handleMouseEnter = useCallback(() => {
    onHover?.({ xPath, yPath });
    onDiffHover?.(cellKey);
  }, [onHover, onDiffHover, cellKey, xPath, yPath]);

  const handleDiffClick = useCallback(() => {
    onDiffSelect?.(cellKey);
  }, [onDiffSelect, cellKey]);

  const handleDiffKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (onDiffSelect === undefined || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      onDiffSelect(cellKey);
    },
    [onDiffSelect, cellKey],
  );

  const diffClickable = onDiffSelect !== undefined;
  const showContent = !diffBlank;

  return (
    <div
      role={decorative ? undefined : 'gridcell'}
      data-cell-key={cellKey}
      data-diff={diffKind}
      aria-selected={interactive ? selected : diffClickable ? diffSelected : undefined}
      tabIndex={decorative ? undefined : interactive ? (isFocused || isTabStop ? 0 : -1) : diffClickable ? 0 : undefined}
      title={decorative ? undefined : title}
      onMouseDown={interactive ? handleMouseDown : undefined}
      onMouseEnter={interactive || onDiffHover !== undefined ? handleMouseEnter : undefined}
      onClick={diffClickable ? handleDiffClick : undefined}
      onKeyDown={diffClickable ? handleDiffKeyDown : undefined}
      style={{
        gridColumn: column,
        gridRow: row,
        backgroundColor: background,
        color,
        boxShadow: cellRingShadow({ selected, isAnchor }),
        outline: isFocused
          ? `2px solid ${FOCUS_RING_COLOR}`
          : diffSelected
            ? `2px solid ${FOCUS_RING_COLOR}`
            : diffHovered
              ? `2px solid ${SELECTION_COLOR}`
              : undefined,
        outlineOffset: isFocused || diffSelected || diffHovered ? '-4px' : undefined,
        opacity: diffDimmed ? 0.4 : undefined,
        zIndex: selected || isFocused || diffSelected ? 5 : undefined,
      }}
      className={`relative flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden border-b border-r border-neutral-200 px-1.5 py-1 text-[11px] leading-tight dark:border-neutral-800 ${isXBoundary ? 'border-r-2 border-r-neutral-400 dark:border-r-neutral-600' : ''} ${isYBoundary ? 'border-b-2 border-b-neutral-400 dark:border-b-neutral-600' : ''} ${pending ? 'policy-grid-pending' : ''} ${pending && pulsePending ? 'policy-grid-pending-pulse' : ''} ${diffKind !== undefined ? DIFF_CELL_CLASS[diffKind] : ''} ${diffClickable ? 'cursor-pointer' : ''}`}
    >
      {showContent && decisionLabel !== undefined && (
        <span className="truncate font-semibold">{decisionLabel}</span>
      )}
      {showContent && offerLabel !== undefined && <span className="truncate">{offerLabel}</span>}
      {showContent && limitDisplay !== undefined && <span className="truncate">{limitDisplay}</span>}
      {showContent && hasNote && (
        <span
          aria-hidden
          className="absolute right-0 top-0 h-0 w-0 border-b-[8px] border-l-[8px] border-b-transparent border-l-neutral-900/60 dark:border-l-white/60"
        />
      )}
      {diffKind !== undefined && (
        <span
          data-testid="diff-badge"
          className="absolute left-0 top-0 flex h-3.5 w-3.5 items-center justify-center rounded-br-sm bg-neutral-900/80 text-[9px] font-bold leading-none text-white dark:bg-white/85 dark:text-neutral-900"
        >
          {DIFF_BADGE[diffKind]}
        </span>
      )}
    </div>
  );
}

/**
 * Comparador explícito sobre os campos que afetam a célula: num arrasto sobre
 * 1.500 combinações, só as células que entram ou saem do retângulo re-renderizam
 * (§6 da S10). O conteúdo (cor, rótulos) não muda nesta sessão, mas entra na
 * comparação porque a S11 passa a mexer nele.
 */
const GridCell = memo(GridCellImpl, (prev, next) => {
  return (
    prev.cellKey === next.cellKey &&
    prev.column === next.column &&
    prev.row === next.row &&
    prev.selected === next.selected &&
    prev.isAnchor === next.isAnchor &&
    prev.isFocused === next.isFocused &&
    prev.isTabStop === next.isTabStop &&
    prev.interactive === next.interactive &&
    prev.decorative === next.decorative &&
    prev.background === next.background &&
    prev.color === next.color &&
    prev.pending === next.pending &&
    prev.pulsePending === next.pulsePending &&
    prev.decisionLabel === next.decisionLabel &&
    prev.offerLabel === next.offerLabel &&
    prev.limitDisplay === next.limitDisplay &&
    prev.hasNote === next.hasNote &&
    prev.isXBoundary === next.isXBoundary &&
    prev.isYBoundary === next.isYBoundary &&
    prev.title === next.title &&
    prev.onPress === next.onPress &&
    prev.onHover === next.onHover &&
    prev.diffKind === next.diffKind &&
    prev.diffDimmed === next.diffDimmed &&
    prev.diffBlank === next.diffBlank &&
    prev.diffSelected === next.diffSelected &&
    prev.diffHovered === next.diffHovered &&
    prev.onDiffSelect === next.onDiffSelect &&
    prev.onDiffHover === next.onDiffHover
  );
});

// ---------------------------------------------------------------------------
// Alça de redimensionamento — arrastar a borda entre colunas ou linhas
// ---------------------------------------------------------------------------
// #region: redimensionamento

interface ResizeHandleProps {
  orientation: 'column' | 'row';
  /** Posição (em px) da borda, no eixo do arrasto — vira o `left`/`top` da alça. */
  offset: number;
  /**
   * Onde a alça começa no eixo perpendicular — a área de dados, nunca a faixa
   * de cabeçalho sticky: uma alça de linha que cobrisse as colunas de
   * cabeçalho de Y cruzaria por cima de uma célula de cabeçalho com rowspan
   * (ex.: "Corporate" ocupando 2 linhas) e roubaria o clique de seleção dela.
   */
  crossStart: number;
  /** Comprimento da alça no eixo perpendicular ao arrasto, a partir de `crossStart`. */
  length: number;
  onResize: (delta: number) => void;
  label: string;
}

/**
 * Faixa fina e invisível sobre a borda, que vira o cursor `col-resize`/`row-resize`
 * no hover e arrasta a coluna/linha à esquerda (ou linha acima) da borda.
 * `pointer-events` só existe na faixa — o resto da célula continua clicável normalmente.
 */
function ResizeHandle({ orientation, offset, crossStart, length, onResize, label }: ResizeHandleProps) {
  const isColumn = orientation === 'column';

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const start = isColumn ? event.clientX : event.clientY;

      // O total do arrasto é medido a partir do ponto inicial, não passo a
      // passo — assim uma re-renderização no meio do gesto (o próprio
      // `setState` do redimensionamento) nunca perde nem acumula delta.
      function onPointerMove(moveEvent: PointerEvent) {
        const current = isColumn ? moveEvent.clientX : moveEvent.clientY;
        onResize(current - start);
      }

      function onPointerUp() {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      }

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [isColumn, onResize],
  );

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={isColumn ? 'vertical' : 'horizontal'}
      data-testid={isColumn ? 'grid-col-resize-handle' : 'grid-row-resize-handle'}
      onPointerDown={handlePointerDown}
      style={{
        position: 'absolute',
        zIndex: 40,
        ...(isColumn
          ? { left: offset - 3, top: crossStart, width: 6, height: length, cursor: 'col-resize' }
          : { top: offset - 3, left: crossStart, height: 6, width: length, cursor: 'row-resize' }),
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------
// #region: grid

export function Grid({
  view,
  zoom,
  onZoomChange,
  selection: api,
  highlightPending = false,
  diffOverlay,
  hideFooter = false,
  variant = 'full',
}: GridProps) {
  const { x, y, cells, catalog, stats } = view;
  const thumbnail = variant === 'thumbnail';
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Os handlers do diff precisam de identidade estável pelo mesmo motivo dos
  // de seleção: senão o `React.memo` vê "props mudaram" a cada quadro.
  const overlayRef = useRef(diffOverlay);
  overlayRef.current = diffOverlay;
  const registerScroll = diffOverlay?.registerScrollElement;

  const selectDiffKey = useCallback((key: string) => {
    overlayRef.current?.onSelectKey?.(key);
  }, []);
  const hoverDiffKey = useCallback((key: string | null) => {
    overlayRef.current?.onHoverKey?.(key);
  }, []);
  const onDiffSelect = diffOverlay?.onSelectKey === undefined ? undefined : selectDiffKey;
  const onDiffHover = diffOverlay?.onHoverKey === undefined ? undefined : hoverDiffKey;

  useEffect(() => {
    if (registerScroll === undefined) return;
    registerScroll(scrollRef.current);
    return () => registerScroll(null);
  }, [registerScroll]);

  // A miniatura é sempre somente leitura, mesmo que o chamador passe `selection`.
  const interactive = !thumbnail && api !== undefined;
  const cellWidth = thumbnail ? THUMBNAIL_CELL_SIZE : BASE_CELL_WIDTH * zoom;
  const cellHeight = thumbnail ? THUMBNAIL_CELL_SIZE : BASE_CELL_HEIGHT * zoom;
  const xTuples = x.axis.tuples;
  const yTuples = y.axis.tuples;

  // --- Redimensionamento de colunas e linhas ---------------------------------
  //
  // Cada coluna do grid (as `y.levelCount` colunas de cabeçalho de Y + uma por
  // combinação de X) e cada linha (as `x.levelCount` faixas de cabeçalho de X +
  // uma por combinação de Y) tem um tamanho, em px, que por padrão segue o zoom
  // e pode ser sobrescrito arrastando a alça na borda. A miniatura nunca é
  // redimensionável — ela nem desenha cabeçalho.
  const totalCols = y.levelCount + xTuples.length;
  const totalRows = x.levelCount + yTuples.length;
  const [colOverrides, setColOverrides] = useState<Map<number, number>>(new Map());
  const [rowOverrides, setRowOverrides] = useState<Map<number, number>>(new Map());

  // Trocar de matriz esquece os tamanhos arrastados da anterior — colunas e
  // linhas não correspondem às mesmas posições.
  const matrixId = view.matrix.id;
  useEffect(() => {
    setColOverrides(new Map());
    setRowOverrides(new Map());
  }, [matrixId]);

  const defaultColSize = useCallback(
    (index: number) => (index < y.levelCount ? Y_HEADER_COL_WIDTH : cellWidth),
    [y.levelCount, cellWidth],
  );
  const defaultRowSize = useCallback(
    (index: number) => (index < x.levelCount ? HEADER_ROW_HEIGHT : cellHeight),
    [x.levelCount, cellHeight],
  );

  const colSizes = useMemo(() => {
    if (thumbnail) return [];
    return Array.from({ length: totalCols }, (_, index) => colOverrides.get(index) ?? defaultColSize(index));
  }, [thumbnail, totalCols, colOverrides, defaultColSize]);
  const rowSizes = useMemo(() => {
    if (thumbnail) return [];
    return Array.from({ length: totalRows }, (_, index) => rowOverrides.get(index) ?? defaultRowSize(index));
  }, [thumbnail, totalRows, rowOverrides, defaultRowSize]);

  const colOffsets = useMemo(() => {
    const offsets: number[] = [0];
    for (const size of colSizes) offsets.push(offsets[offsets.length - 1]! + size);
    return offsets;
  }, [colSizes]);
  const rowOffsets = useMemo(() => {
    const offsets: number[] = [0];
    for (const size of rowSizes) offsets.push(offsets[offsets.length - 1]! + size);
    return offsets;
  }, [rowSizes]);

  const resizeColumn = useCallback(
    (index: number, baseSize: number) => (totalDelta: number) => {
      setColOverrides((prev) => {
        const next = new Map(prev);
        next.set(index, Math.max(MIN_COL_WIDTH, Math.round(baseSize + totalDelta)));
        return next;
      });
    },
    [],
  );
  const resizeRow = useCallback(
    (index: number, baseSize: number) => (totalDelta: number) => {
      setRowOverrides((prev) => {
        const next = new Map(prev);
        next.set(index, Math.max(MIN_ROW_HEIGHT, Math.round(baseSize + totalDelta)));
        return next;
      });
    },
    [],
  );

  const xBoundaries = useMemo(
    () => topLevelBoundaries(x.headerRows, x.levelCount),
    [x.headerRows, x.levelCount],
  );
  const yBoundaries = useMemo(
    () => topLevelBoundaries(y.headerRows, y.levelCount),
    [y.headerRows, y.levelCount],
  );

  const usedDecisionCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const cell of Object.values(cells)) {
      if (cell.decision !== undefined) codes.add(cell.decision);
    }
    return codes;
  }, [cells]);
  const legendItems = catalog.decisions.filter((item) => usedDecisionCodes.has(item.code));

  // --- Retângulo do arrasto, derivado na renderização ----------------------
  //
  // Enquanto o marquee está ativo a seleção exibida vem daqui, e não de um
  // `Set` recriado a cada `mousemove` (§6 da S10).
  const marqueeBounds = useMemo(() => {
    const marquee = api?.marquee ?? null;
    if (marquee === null) return null;
    const from = coordIndex(view, marquee.from);
    const to = coordIndex(view, marquee.to);
    if (from === null || to === null) return null;
    return {
      additive: marquee.additive,
      x0: Math.min(from.xIndex, to.xIndex),
      x1: Math.max(from.xIndex, to.xIndex),
      y0: Math.min(from.yIndex, to.yIndex),
      y1: Math.max(from.yIndex, to.yIndex),
    };
  }, [api?.marquee, view]);

  const selectedKeys = api?.selection;

  const isSelectedAt = useCallback(
    (xIndex: number, yIndex: number, key: string): boolean => {
      if (marqueeBounds !== null) {
        const inside =
          xIndex >= marqueeBounds.x0 &&
          xIndex <= marqueeBounds.x1 &&
          yIndex >= marqueeBounds.y0 &&
          yIndex <= marqueeBounds.y1;
        if (inside) return true;
        // Arrasto sem modificador **substitui**: o que estava selecionado antes
        // não aparece mais durante o gesto.
        if (!marqueeBounds.additive) return false;
      }
      return selectedKeys?.has(key) ?? false;
    },
    [marqueeBounds, selectedKeys],
  );

  /**
   * Uma varredura O(células) por render dá as colunas e linhas inteiramente
   * selecionadas. Com isso, o realce de cabeçalho de qualquer nível é uma
   * conjunção de spans — em vez de recalcular `coordsUnderHeader` por
   * cabeçalho a cada quadro do arrasto.
   */
  const { fullColumns, fullRows } = useMemo(() => {
    const columns = new Array<boolean>(xTuples.length).fill(yTuples.length > 0);
    const rows = new Array<boolean>(yTuples.length).fill(xTuples.length > 0);
    if (!interactive) {
      return { fullColumns: columns.fill(false), fullRows: rows.fill(false) };
    }
    for (let yIndex = 0; yIndex < yTuples.length; yIndex++) {
      for (let xIndex = 0; xIndex < xTuples.length; xIndex++) {
        if (isSelectedAt(xIndex, yIndex, `${xTuples[xIndex]!}::${yTuples[yIndex]!}`)) continue;
        columns[xIndex] = false;
        rows[yIndex] = false;
      }
    }
    return { fullColumns: columns, fullRows: rows };
  }, [interactive, isSelectedAt, xTuples, yTuples]);

  /** Cabeçalho aceso quando todas as suas combinações estão selecionadas (§5). */
  function isHeaderSelected(role: AxisRole, startIndex: number, span: number): boolean {
    const flags = role === 'X' ? fullColumns : fullRows;
    for (let index = startIndex; index < startIndex + span; index++) {
      if (flags[index] !== true) return false;
    }
    return span > 0;
  }

  const allSelected =
    interactive && fullColumns.length > 0 && fullColumns.every((selected) => selected);

  // --- Ponteiro -------------------------------------------------------------

  // Os handlers passados para a célula precisam de identidade estável, senão o
  // comparador do `React.memo` vê "props mudaram" e as 1.500 células
  // re-renderizam a cada `mousemove`. O `ref` mantém a API atual sem entrar na
  // identidade da função.
  const apiRef = useRef(api);
  apiRef.current = api;

  const pressCell = useCallback((coord: Coord, modifiers: GridModifiers) => {
    apiRef.current?.pressCell(coord, modifiers);
  }, []);
  const hoverCell = useCallback((coord: Coord) => {
    apiRef.current?.hoverCell(coord);
  }, []);
  const onPressCell = interactive ? pressCell : undefined;
  const onHoverCell = interactive ? hoverCell : undefined;

  const dragging = api !== undefined && api.marquee !== null;

  useEffect(() => {
    if (!dragging) return;

    // Arrastar para fora do grid e voltar: a coordenada é derivada da posição
    // do ponteiro sobre a área de dados e **grudada** nos limites do grid.
    function onMouseMove(event: MouseEvent) {
      const content = contentRef.current;
      if (content === null) return;
      const rect = content.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const xIndex = dataIndexAtOffset(colOffsets, y.levelCount, xTuples.length, event.clientX - rect.left);
      const yIndex = dataIndexAtOffset(rowOffsets, x.levelCount, yTuples.length, event.clientY - rect.top);
      const xPath = xTuples[xIndex];
      const yPath = yTuples[yIndex];
      if (xPath === undefined || yPath === undefined) return;
      apiRef.current?.hoverCell({ xPath, yPath });
    }

    function onMouseUp() {
      apiRef.current?.releasePointer();
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, colOffsets, rowOffsets, x.levelCount, y.levelCount, xTuples, yTuples]);

  // --- Teclado --------------------------------------------------------------
  //
  // O `onKeyDown` mora no contêiner do grid, não em `window`: os atalhos só
  // agem com o foco dentro do grid e nunca sequestram teclas enquanto o
  // usuário digita no inspector (§5).
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (api === undefined) return;
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction !== undefined) {
      event.preventDefault();
      api.moveFocus(direction, event.shiftKey);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault();
      api.selectAll();
      return;
    }
    if (event.key === 'Escape') {
      // Sem nada selecionado, o evento não é engolido: quem está acima (um
      // diálogo, por exemplo) precisa continuar recebendo o Esc.
      if (api.selection.size === 0 && api.marquee === null) return;
      event.preventDefault();
      api.clear();
      return;
    }
    if (event.key === 'Enter' && api.activate !== undefined) {
      event.preventDefault();
      api.activate();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && api.clearCells !== undefined) {
      event.preventDefault();
      api.clearCells();
    }
  }

  /** Roving tabindex: a célula focada é a única com `tabIndex=0`. */
  const focusKey = api?.focus === undefined || api.focus === null ? null : toKey(api.focus);
  const firstCellKey =
    xTuples.length > 0 && yTuples.length > 0 ? `${xTuples[0]!}::${yTuples[0]!}` : null;
  const tabStopKey = focusKey ?? firstCellKey;

  useEffect(() => {
    if (focusKey === null) return;
    const content = contentRef.current;
    if (content === null) return;
    // Só move o foco do DOM se ele já estiver dentro do grid: navegar por
    // teclado deve seguir o foco, abrir a tela não deve roubá-lo.
    if (!content.contains(document.activeElement)) return;
    const target = content.querySelector<HTMLElement>(`[data-cell-key="${focusKey}"]`);
    target?.focus();
  }, [focusKey]);

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey || onZoomChange === undefined) return;
    event.preventDefault();
    const next = clampZoom(zoom - event.deltaY * 0.001);
    onZoomChange(next);
  }

  function handleHeaderMouseDown(
    event: React.MouseEvent<HTMLDivElement>,
    role: AxisRole,
    level: number,
    path: string,
  ) {
    if (api === undefined || event.button !== 0) return;
    event.preventDefault();
    api.pressHeader(role, level, path, modifiersOf(event));
  }

  function handleHeaderKeyDown(
    event: React.KeyboardEvent<HTMLDivElement>,
    role: AxisRole,
    level: number,
    path: string,
  ) {
    if (api === undefined || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    api.pressHeader(role, level, path, modifiersOf(event));
  }

  function handleCornerActivate(event: React.MouseEvent | React.KeyboardEvent) {
    if (api === undefined) return;
    if ('key' in event && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    api.selectAll();
  }

  // --- Contador e anúncio ---------------------------------------------------

  const selectionCount = useMemo(() => {
    if (selectedKeys === undefined) return 0;
    if (marqueeBounds === null) return selectedKeys.size;
    let count = 0;
    for (let yIndex = 0; yIndex < yTuples.length; yIndex++) {
      for (let xIndex = 0; xIndex < xTuples.length; xIndex++) {
        if (isSelectedAt(xIndex, yIndex, `${xTuples[xIndex]!}::${yTuples[yIndex]!}`)) count += 1;
      }
    }
    return count;
  }, [selectedKeys, marqueeBounds, isSelectedAt, xTuples, yTuples]);

  const selectionLabel = useMemo(() => {
    if (selectedKeys === undefined || selectionCount === 0) return '';
    if (selectionCount === 1) {
      // Uma só: o caminho legível, como em `Varejo › 100k–500k × R3`.
      const key = [...selectedKeys][0];
      const coord =
        marqueeBounds !== null
          ? { xPath: xTuples[marqueeBounds.x0]!, yPath: yTuples[marqueeBounds.y0]! }
          : key === undefined
            ? null
            : { xPath: key.slice(0, key.indexOf('::')), yPath: key.slice(key.indexOf('::') + 2) };
      if (coord === null) return '1 célula selecionada';
      return `${readablePath(y, coord.yPath)} × ${readablePath(x, coord.xPath)}`;
    }
    return `${selectionCount} células selecionadas`;
  }, [selectedKeys, selectionCount, marqueeBounds, xTuples, yTuples, x, y]);

  const cornerLabel = [
    y.axis.levels.map((level) => level.label).join(' › '),
    x.axis.levels.map((level) => level.label).join(' › '),
  ]
    .filter((label) => label !== '')
    .join(' \\ ');

  const columnsTemplate = thumbnail
    ? `repeat(${xTuples.length}, ${cellWidth}px)`
    : colSizes.map((size) => `${size}px`).join(' ');
  const rowsTemplate = thumbnail
    ? `repeat(${yTuples.length}, ${cellHeight}px)`
    : rowSizes.map((size) => `${size}px`).join(' ');
  /** Deslocamento das células de dados: sem faixa de cabeçalho na miniatura. */
  const columnOffset = thumbnail ? 0 : y.levelCount;
  const rowOffset = thumbnail ? 0 : x.levelCount;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        onMouseLeave={onDiffHover === undefined ? undefined : () => onDiffHover(null)}
        className="min-h-0 flex-1 overflow-auto"
        data-testid="policy-grid-scroll"
      >
        <div
          ref={contentRef}
          role={thumbnail ? 'img' : 'grid'}
          aria-label={thumbnail ? `Miniatura da matriz "${view.matrix.name}"` : undefined}
          aria-rowcount={thumbnail ? undefined : x.levelCount + yTuples.length}
          aria-colcount={thumbnail ? undefined : y.levelCount + xTuples.length}
          aria-multiselectable={interactive ? true : undefined}
          onKeyDown={interactive ? handleKeyDown : undefined}
          style={{
            display: 'grid',
            width: 'max-content',
            position: 'relative',
            gridTemplateColumns: columnsTemplate,
            gridTemplateRows: rowsTemplate,
            userSelect: dragging ? 'none' : undefined,
          }}
        >
          {/* Canto superior esquerdo: nomes das variáveis de cada nível; clicável para selecionar tudo. */}
          {!thumbnail && (
          <>
          <div
            role={interactive ? 'button' : 'presentation'}
            aria-label={interactive ? 'Selecionar tudo' : undefined}
            data-testid="grid-corner"
            data-selected={allSelected ? 'true' : undefined}
            tabIndex={interactive ? 0 : undefined}
            onMouseDown={interactive ? handleCornerActivate : undefined}
            onKeyDown={interactive ? handleCornerActivate : undefined}
            style={{
              gridColumn: `1 / span ${y.levelCount}`,
              gridRow: `1 / span ${x.levelCount}`,
              position: 'sticky',
              top: 0,
              left: 0,
              zIndex: 30,
              backgroundColor: allSelected ? HEADER_SELECTED_FILL_COLOR : undefined,
            }}
            className="flex items-end justify-start border-b-2 border-r-2 border-neutral-300 bg-neutral-50 p-1.5 text-[10px] font-medium leading-tight text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
            title={interactive ? 'Selecionar tudo' : undefined}
          >
            {cornerLabel}
          </div>

          {/* Cabeçalhos de X: uma faixa por nível, sticky no topo. */}
          {x.headerRows.map((row) =>
            row.cells.map((cell) => {
              const isBoundary = xBoundaries.has(cell.startIndex + cell.span - 1);
              const headerSelected = interactive && isHeaderSelected('X', cell.startIndex, cell.span);
              return (
                <div
                  key={`x-${row.level}-${cell.path}`}
                  role="columnheader"
                  data-header-path={cell.path}
                  data-header-level={row.level}
                  data-selected={headerSelected ? 'true' : undefined}
                  aria-selected={interactive ? headerSelected : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  title={cell.label}
                  onMouseDown={
                    interactive
                      ? (event) => handleHeaderMouseDown(event, 'X', row.level, cell.path)
                      : undefined
                  }
                  onKeyDown={
                    interactive
                      ? (event) => handleHeaderKeyDown(event, 'X', row.level, cell.path)
                      : undefined
                  }
                  style={{
                    gridColumn: `${y.levelCount + cell.startIndex + 1} / span ${cell.span}`,
                    gridRow: row.level + 1,
                    position: 'sticky',
                    top: rowOffsets[row.level],
                    zIndex: 20,
                    backgroundColor: headerSelected ? HEADER_SELECTED_FILL_COLOR : (cell.color ?? undefined),
                    boxShadow: headerSelected ? `inset 0 0 0 2px ${SELECTION_COLOR}` : undefined,
                  }}
                  className={`flex items-center justify-center overflow-hidden truncate border-b border-neutral-200 bg-neutral-50 px-1 text-xs font-medium text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 ${isBoundary ? 'border-r-2 border-r-neutral-300 dark:border-r-neutral-600' : 'border-r border-r-neutral-200 dark:border-r-neutral-800'}`}
                >
                  {cell.shortLabel ?? cell.label}
                </div>
              );
            }),
          )}

          {/* Cabeçalhos de Y: uma coluna por nível, sticky à esquerda. */}
          {y.headerRows.map((row) =>
            row.cells.map((cell) => {
              const isBoundary = yBoundaries.has(cell.startIndex + cell.span - 1);
              const headerSelected = interactive && isHeaderSelected('Y', cell.startIndex, cell.span);
              return (
                <div
                  key={`y-${row.level}-${cell.path}`}
                  role="rowheader"
                  data-header-path={cell.path}
                  data-header-level={row.level}
                  data-selected={headerSelected ? 'true' : undefined}
                  aria-selected={interactive ? headerSelected : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  title={cell.label}
                  onMouseDown={
                    interactive
                      ? (event) => handleHeaderMouseDown(event, 'Y', row.level, cell.path)
                      : undefined
                  }
                  onKeyDown={
                    interactive
                      ? (event) => handleHeaderKeyDown(event, 'Y', row.level, cell.path)
                      : undefined
                  }
                  style={{
                    gridRow: `${x.levelCount + cell.startIndex + 1} / span ${cell.span}`,
                    gridColumn: row.level + 1,
                    position: 'sticky',
                    left: colOffsets[row.level],
                    zIndex: 20,
                    backgroundColor: headerSelected ? HEADER_SELECTED_FILL_COLOR : (cell.color ?? undefined),
                    boxShadow: headerSelected ? `inset 0 0 0 2px ${SELECTION_COLOR}` : undefined,
                  }}
                  className={`flex items-center justify-start overflow-hidden truncate border-r border-neutral-200 bg-neutral-50 px-1.5 text-xs font-medium text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 ${isBoundary ? 'border-b-2 border-b-neutral-300 dark:border-b-neutral-600' : 'border-b border-b-neutral-200 dark:border-b-neutral-800'}`}
                >
                  {cell.shortLabel ?? cell.label}
                </div>
              );
            }),
          )}
          </>
          )}

          {/* Células de dados. */}
          {yTuples.map((yPath, yIndex) =>
            xTuples.map((xPath, xIndex) => {
              const key = `${xPath}::${yPath}`;
              const cell = cells[key];
              const background = resolveCellColor(cell, catalog);
              const decisionItem =
                !thumbnail && cell?.decision !== undefined ? catalog.byCode.DECISION[cell.decision] : undefined;
              const offerItem =
                !thumbnail && cell?.offer !== undefined ? catalog.byCode.OFFER[cell.offer] : undefined;
              const limitItem = cell?.limit !== undefined ? catalog.byCode.LIMIT[cell.limit] : undefined;
              const limitDisplay =
                thumbnail
                  ? undefined
                  : cell?.limitMin !== undefined || cell?.limitMax !== undefined
                    ? formatBRLRange(cell.limitMin, cell.limitMax)
                    : cell?.limitOverride !== undefined
                      ? formatBRL(cell.limitOverride)
                      : limitItem?.numericValue !== undefined
                        ? formatBRL(limitItem.numericValue)
                        : undefined;
              const selected = interactive && isSelectedAt(xIndex, yIndex, key);
              const anchor = api?.anchor ?? null;
              const isAnchor = anchor !== null && anchor.xPath === xPath && anchor.yPath === yPath;
              const diffKind = diffOverlay?.marks.get(key);
              const diffUnchanged = diffOverlay !== undefined && diffKind === undefined;

              return (
                <GridCell
                  key={key}
                  cellKey={key}
                  xPath={xPath}
                  yPath={yPath}
                  column={columnOffset + xIndex + 1}
                  row={rowOffset + yIndex + 1}
                  background={background}
                  color={contrastText(background)}
                  pending={isCellPending(cell)}
                  pulsePending={highlightPending}
                  decorative={thumbnail}
                  {...(decisionItem !== undefined ? { decisionLabel: decisionItem.label } : {})}
                  {...(offerItem !== undefined ? { offerLabel: offerItem.label } : {})}
                  {...(limitDisplay !== undefined ? { limitDisplay } : {})}
                  hasNote={!thumbnail && cell?.note !== undefined}
                  isXBoundary={xBoundaries.has(xIndex)}
                  isYBoundary={yBoundaries.has(yIndex)}
                  title={`${readablePath(x, xPath)} × ${readablePath(y, yPath)}`}
                  selected={selected}
                  isAnchor={isAnchor}
                  isFocused={focusKey === key}
                  isTabStop={tabStopKey === key}
                  interactive={interactive}
                  {...(onPressCell !== undefined ? { onPress: onPressCell } : {})}
                  {...(onHoverCell !== undefined ? { onHover: onHoverCell } : {})}
                  {...(diffKind !== undefined ? { diffKind } : {})}
                  diffDimmed={diffUnchanged}
                  diffBlank={diffUnchanged && diffOverlay?.onlyChanged === true}
                  diffSelected={diffOverlay?.selectedKey === key}
                  diffHovered={diffOverlay?.hoverKey === key}
                  {...(onDiffSelect !== undefined && diffKind !== undefined ? { onDiffSelect } : {})}
                  {...(onDiffHover !== undefined ? { onDiffHover } : {})}
                />
              );
            }),
          )}

          {/* Retângulo translúcido do arrasto. */}
          {marqueeBounds !== null && (
            <div
              aria-hidden
              data-testid="grid-marquee"
              style={{
                gridColumn: `${y.levelCount + marqueeBounds.x0 + 1} / span ${marqueeBounds.x1 - marqueeBounds.x0 + 1}`,
                gridRow: `${x.levelCount + marqueeBounds.y0 + 1} / span ${marqueeBounds.y1 - marqueeBounds.y0 + 1}`,
                backgroundColor: MARQUEE_FILL_COLOR,
                border: `1px solid ${MARQUEE_BORDER_COLOR}`,
                pointerEvents: 'none',
                zIndex: 10,
              }}
            />
          )}

          {/*
            Alças de redimensionamento — uma por fronteira entre colunas/linhas.
            Restritas à área de dados (nunca cruzam a faixa/coluna de cabeçalho
            sticky): senão uma alça sobre a borda interna de um cabeçalho com
            rowspan/colspan (ex.: "Corporate" ocupando 2 linhas) rouba o clique
            de seleção daquele cabeçalho.
          */}
          {!thumbnail &&
            colSizes.slice(0, -1).map((_, index) => (
              <ResizeHandle
                key={`col-resize-${index}`}
                orientation="column"
                offset={colOffsets[index + 1]!}
                crossStart={rowOffsets[x.levelCount]!}
                length={rowOffsets[totalRows]! - rowOffsets[x.levelCount]!}
                onResize={resizeColumn(index, colSizes[index]!)}
                label={`Redimensionar coluna ${index + 1}`}
              />
            ))}
          {!thumbnail &&
            rowSizes.slice(0, -1).map((_, index) => (
              <ResizeHandle
                key={`row-resize-${index}`}
                orientation="row"
                offset={rowOffsets[index + 1]!}
                crossStart={colOffsets[y.levelCount]!}
                length={colOffsets[totalCols]! - colOffsets[y.levelCount]!}
                onResize={resizeRow(index, rowSizes[index]!)}
                label={`Redimensionar linha ${index + 1}`}
              />
            ))}
        </div>
      </div>

      {!hideFooter && !thumbnail && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          <div className="flex flex-wrap items-center gap-2">
            {legendItems.map((item) => (
              <span key={item.code} className="flex items-center gap-1">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-sm border border-black/10"
                  style={{ backgroundColor: item.color ?? '#E5E7EB' }}
                />
                {item.label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {/* Contador flutuante + anúncio polido da seleção (§5). */}
            <span
              role="status"
              aria-live="polite"
              data-testid="selection-counter"
              className="font-medium text-neutral-700 dark:text-neutral-200"
            >
              {selectionLabel}
            </span>
            <span data-testid="grid-counters">
              {formatThousands(stats.combinations)} combinações · {formatThousands(stats.filledCells)} preenchidas ·{' '}
              {formatThousands(stats.pendingCells)} pendentes
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
