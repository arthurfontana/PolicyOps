import { useMemo, useRef } from 'react';
import { decodePath } from '@/core/axes/paths';
import type { HeaderRow } from '@/core/axes/header-layout';
import type { EditorAxisView, EditorView } from '@/core/queries';
import { contrastText, isCellPending, resolveCellColor } from '@/lib/colors';

/**
 * O grid com cabeçalhos aninhados — docs/07-ux-e-editor.md §4,
 * docs/04-eixos-aninhados.md §4. CSS Grid em DOM puro, sem canvas nem
 * biblioteca de terceiros.
 *
 * Componente de apresentação puro: recebe `EditorView` (a saída de
 * `getEditorView`) e o zoom, e renderiza. Não importa nenhum store — quem
 * chama decide de onde vêm esses dados.
 */

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
const BASE_CELL_WIDTH = 88;
const BASE_CELL_HEIGHT = 56;
const HEADER_ROW_HEIGHT = 32;
const Y_HEADER_COL_WIDTH = 120;

export interface GridProps {
  view: EditorView;
  zoom: number;
  /** Ctrl+scroll ajusta o zoom — omitido, o gesto é ignorado (ex.: miniaturas). */
  onZoomChange?: (zoom: number) => void;
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
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

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatBRL(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? currencyFormatter.format(parsed) : value;
}

export function Grid({ view, zoom, onZoomChange }: GridProps) {
  const { x, y, cells, catalog, stats } = view;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const cellWidth = BASE_CELL_WIDTH * zoom;
  const cellHeight = BASE_CELL_HEIGHT * zoom;
  const xTuples = x.axis.tuples;
  const yTuples = y.axis.tuples;

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

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey || onZoomChange === undefined) return;
    event.preventDefault();
    const next = clampZoom(zoom - event.deltaY * 0.001);
    onZoomChange(next);
  }

  const cornerLabel = [
    y.axis.levels.map((level) => level.label).join(' › '),
    x.axis.levels.map((level) => level.label).join(' › '),
  ]
    .filter((label) => label !== '')
    .join(' \\ ');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        className="min-h-0 flex-1 overflow-auto"
        data-testid="policy-grid-scroll"
      >
        <div
          role="grid"
          aria-rowcount={x.levelCount + yTuples.length}
          aria-colcount={y.levelCount + xTuples.length}
          style={{
            display: 'grid',
            width: 'max-content',
            gridTemplateColumns: `repeat(${y.levelCount}, ${Y_HEADER_COL_WIDTH}px) repeat(${xTuples.length}, ${cellWidth}px)`,
            gridTemplateRows: `repeat(${x.levelCount}, ${HEADER_ROW_HEIGHT}px) repeat(${yTuples.length}, ${cellHeight}px)`,
          }}
        >
          {/* Canto superior esquerdo: nomes das variáveis de cada nível. */}
          <div
            style={{
              gridColumn: `1 / span ${y.levelCount}`,
              gridRow: `1 / span ${x.levelCount}`,
              position: 'sticky',
              top: 0,
              left: 0,
              zIndex: 30,
            }}
            className="flex items-end justify-start border-b-2 border-r-2 border-neutral-300 bg-neutral-50 p-1.5 text-[10px] font-medium leading-tight text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
            title="Selecionar tudo (disponível na S10)"
          >
            {cornerLabel}
          </div>

          {/* Cabeçalhos de X: uma faixa por nível, sticky no topo. */}
          {x.headerRows.map((row) =>
            row.cells.map((cell) => {
              const isBoundary = xBoundaries.has(cell.startIndex + cell.span - 1);
              return (
                <div
                  key={`x-${row.level}-${cell.path}`}
                  role="columnheader"
                  title={cell.label}
                  style={{
                    gridColumn: `${y.levelCount + cell.startIndex + 1} / span ${cell.span}`,
                    gridRow: row.level + 1,
                    position: 'sticky',
                    top: row.level * HEADER_ROW_HEIGHT,
                    zIndex: 20,
                    backgroundColor: cell.color ?? undefined,
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
              return (
                <div
                  key={`y-${row.level}-${cell.path}`}
                  role="rowheader"
                  title={cell.label}
                  style={{
                    gridRow: `${x.levelCount + cell.startIndex + 1} / span ${cell.span}`,
                    gridColumn: row.level + 1,
                    position: 'sticky',
                    left: row.level * Y_HEADER_COL_WIDTH,
                    zIndex: 20,
                    backgroundColor: cell.color ?? undefined,
                  }}
                  className={`flex items-center justify-start overflow-hidden truncate border-r border-neutral-200 bg-neutral-50 px-1.5 text-xs font-medium text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 ${isBoundary ? 'border-b-2 border-b-neutral-300 dark:border-b-neutral-600' : 'border-b border-b-neutral-200 dark:border-b-neutral-800'}`}
                >
                  {cell.shortLabel ?? cell.label}
                </div>
              );
            }),
          )}

          {/* Células de dados. */}
          {yTuples.map((yPath, yIndex) =>
            xTuples.map((xPath, xIndex) => {
              const key = `${xPath}::${yPath}`;
              const cell = cells[key];
              const background = resolveCellColor(cell, catalog);
              const color = contrastText(background);
              const pending = isCellPending(cell);
              const decisionItem = cell?.decision !== undefined ? catalog.byCode.DECISION[cell.decision] : undefined;
              const offerItem = cell?.offer !== undefined ? catalog.byCode.OFFER[cell.offer] : undefined;
              const limitItem = cell?.limit !== undefined ? catalog.byCode.LIMIT[cell.limit] : undefined;
              const limitDisplay =
                cell?.limitOverride !== undefined
                  ? formatBRL(cell.limitOverride)
                  : limitItem?.numericValue !== undefined
                    ? formatBRL(limitItem.numericValue)
                    : undefined;
              const hasNote = cell?.note !== undefined;
              const isXBoundary = xBoundaries.has(xIndex);
              const isYBoundary = yBoundaries.has(yIndex);

              return (
                <div
                  key={key}
                  role="gridcell"
                  title={`${readablePath(x, xPath)} × ${readablePath(y, yPath)}`}
                  style={{
                    gridColumn: y.levelCount + xIndex + 1,
                    gridRow: x.levelCount + yIndex + 1,
                    backgroundColor: background,
                    color,
                  }}
                  className={`relative flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden border-b border-r border-neutral-200 px-1.5 py-1 text-[11px] leading-tight dark:border-neutral-800 ${isXBoundary ? 'border-r-2 border-r-neutral-400 dark:border-r-neutral-600' : ''} ${isYBoundary ? 'border-b-2 border-b-neutral-400 dark:border-b-neutral-600' : ''} ${pending ? 'policy-grid-pending' : ''}`}
                >
                  {decisionItem !== undefined && <span className="truncate font-semibold">{decisionItem.label}</span>}
                  {offerItem !== undefined && <span className="truncate">{offerItem.label}</span>}
                  {limitDisplay !== undefined && <span className="truncate">{limitDisplay}</span>}
                  {hasNote && (
                    <span
                      aria-hidden
                      className="absolute right-0 top-0 h-0 w-0 border-b-[8px] border-l-[8px] border-b-transparent border-l-neutral-900/60 dark:border-l-white/60"
                    />
                  )}
                </div>
              );
            }),
          )}
        </div>
      </div>

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
        <span data-testid="grid-counters">
          {stats.combinations} combinações · {stats.filledCells} preenchidas · {stats.pendingCells} pendentes
        </span>
      </div>
    </div>
  );
}
