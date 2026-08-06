/**
 * Miniatura do grid resultante — docs/prompts/S12, item 2.
 *
 * As combinações que **entram** aparecem hachuradas; as que **saem**, riscadas
 * em vermelho. É o desenho que responde "o que exatamente vai acontecer com o
 * meu grid" antes de qualquer operação de nível ser aplicada.
 */

/** Teto de linhas e colunas desenhadas: acima disso a miniatura vira ruído. */
const MAX_SIDE = 24;

export interface GridMiniatureProps {
  xBefore: string[];
  xAfter: string[];
  yBefore: string[];
  yAfter: string[];
}

type TupleState = 'kept' | 'added' | 'removed';

/** União ordenada: primeiro o que continua/entra, depois o que sai. */
function merge(before: string[], after: string[]): Array<{ path: string; state: TupleState }> {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const merged = after.map((path) => ({
    path,
    state: (beforeSet.has(path) ? 'kept' : 'added') as TupleState,
  }));
  for (const path of before) {
    if (!afterSet.has(path)) merged.push({ path, state: 'removed' });
  }
  return merged;
}

const CELL_CLASS: Record<TupleState, string> = {
  kept: 'bg-neutral-200 dark:bg-neutral-700',
  added: 'bg-[repeating-linear-gradient(45deg,#3b82f6_0,#3b82f6_2px,transparent_2px,transparent_4px)]',
  removed: 'bg-red-200 dark:bg-red-900/60',
};

function stateOf(x: TupleState, y: TupleState): TupleState {
  if (x === 'removed' || y === 'removed') return 'removed';
  if (x === 'added' || y === 'added') return 'added';
  return 'kept';
}

export function GridMiniature({ xBefore, xAfter, yBefore, yAfter }: GridMiniatureProps) {
  const columns = merge(xBefore, xAfter);
  const rows = merge(yBefore, yAfter);
  const shownColumns = columns.slice(0, MAX_SIDE);
  const shownRows = rows.slice(0, MAX_SIDE);
  const truncated = columns.length > shownColumns.length || rows.length > shownRows.length;

  return (
    <div className="flex flex-col gap-1.5" data-testid="grid-miniature">
      <div
        className="grid gap-[2px] overflow-x-auto"
        style={{ gridTemplateColumns: `repeat(${shownColumns.length}, 10px)` }}
        role="img"
        aria-label={`Miniatura do grid resultante: ${rows.length} linhas por ${columns.length} colunas`}
      >
        {shownRows.map((row) =>
          shownColumns.map((column) => {
            const state = stateOf(column.state, row.state);
            return (
              <span
                key={`${column.path}::${row.path}`}
                data-state={state}
                className={`h-[10px] w-[10px] rounded-[1px] ${CELL_CLASS[state]} ${
                  state === 'removed' ? 'line-through outline outline-1 outline-red-500' : ''
                }`}
              />
            );
          }),
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-500 dark:text-neutral-400">
        <span className="flex items-center gap-1">
          <span className={`h-[10px] w-[10px] rounded-[1px] ${CELL_CLASS.kept}`} /> permanecem
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-[10px] w-[10px] rounded-[1px] ${CELL_CLASS.added}`} /> novas
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-[10px] w-[10px] rounded-[1px] outline outline-1 outline-red-500 ${CELL_CLASS.removed}`} />{' '}
          saem
        </span>
        {truncated && <span>(miniatura truncada em {MAX_SIDE} × {MAX_SIDE})</span>}
      </div>
    </div>
  );
}
