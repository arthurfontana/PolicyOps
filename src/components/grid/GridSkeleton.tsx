import { HEADER_ROW_HEIGHT, Y_HEADER_COL_WIDTH } from './Grid';

/**
 * Skeleton de carregamento do grid — docs/07-ux-e-editor.md §12: "incluindo o
 * do grid com as dimensões corretas". As proporções vêm dos mesmos números
 * usados pelo `Grid` real (`HEADER_ROW_HEIGHT`, `Y_HEADER_COL_WIDTH`), para
 * o layout não pular quando o conteúdo de verdade substituir o skeleton.
 *
 * Acima de `MAX_VISIBLE` por eixo, a malha visual satura: milhares de `div`
 * de skeleton não ajudam a leitura e custam DOM à toa — a contagem real
 * continua correta no `aria-label`.
 */
const CELL_WIDTH = 88;
const CELL_HEIGHT = 56;
const MAX_VISIBLE = 12;

export interface GridSkeletonProps {
  xCount: number;
  yCount: number;
  xLevels?: number;
  yLevels?: number;
}

export function GridSkeleton({ xCount, yCount, xLevels = 1, yLevels = 1 }: GridSkeletonProps) {
  const visibleCols = Math.max(1, Math.min(xCount, MAX_VISIBLE));
  const visibleRows = Math.max(1, Math.min(yCount, MAX_VISIBLE));

  return (
    <div
      role="status"
      aria-label={`Carregando grid de ${xCount} × ${yCount} combinações`}
      className="flex h-full w-full flex-col gap-1 overflow-hidden bg-white p-2 dark:bg-neutral-950"
    >
      <div className="flex gap-1" style={{ paddingLeft: Y_HEADER_COL_WIDTH * yLevels }}>
        {Array.from({ length: xLevels }).map((_, level) => (
          <div key={level} className="flex flex-1 gap-1" style={{ height: HEADER_ROW_HEIGHT }}>
            {Array.from({ length: visibleCols }).map((_, i) => (
              <div key={i} className="flex-1 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-1 gap-1">
        <div className="flex flex-col gap-1" style={{ width: Y_HEADER_COL_WIDTH * yLevels }}>
          {Array.from({ length: visibleRows }).map((_, i) => (
            <div
              key={i}
              className="flex-1 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800"
              style={{ minHeight: CELL_HEIGHT }}
            />
          ))}
        </div>
        <div
          className="grid flex-1 gap-1"
          style={{
            gridTemplateColumns: `repeat(${visibleCols}, minmax(${CELL_WIDTH}px, 1fr))`,
            gridTemplateRows: `repeat(${visibleRows}, minmax(${CELL_HEIGHT}px, 1fr))`,
          }}
        >
          {Array.from({ length: visibleCols * visibleRows }).map((_, i) => (
            <div key={i} className="animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          ))}
        </div>
      </div>
    </div>
  );
}
