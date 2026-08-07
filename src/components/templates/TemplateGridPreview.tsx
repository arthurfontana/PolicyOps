import { encodeCellKey } from '@/core/axes/paths';
import type { Cell } from '@/core/document/schema';

/**
 * Preview ao vivo do grid resultante — docs/07-ux-e-editor.md §11: "preview ao
 * vivo do grid resultante e contador '38 de 48 combinações pré-preenchidas'".
 * Miniatura só de preenchimento (verde = preenchida, hachurada = pendente) —
 * não é o grid de verdade (isso é `components/grid/Grid.tsx`), só uma
 * indicação visual rápida de quanto o template cobre.
 */

const MAX_SIDE = 24;

export interface TemplateGridPreviewProps {
  xTuples: string[];
  yTuples: string[];
  cells: Record<string, Cell>;
}

export function TemplateGridPreview({ xTuples, yTuples, cells }: TemplateGridPreviewProps) {
  const combinations = xTuples.length * yTuples.length;
  const filled = Object.values(cells).filter((cell) => cell.decision !== undefined).length;
  const shownX = xTuples.slice(0, MAX_SIDE);
  const shownY = yTuples.slice(0, MAX_SIDE);
  const truncated = xTuples.length > shownX.length || yTuples.length > shownY.length;

  return (
    <div className="flex flex-col gap-1.5" data-testid="template-grid-preview">
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        {combinations === 0
          ? 'Sem combinações — escolha ao menos um nível em cada eixo.'
          : `${filled} de ${combinations} combinaç${combinations === 1 ? 'ão' : 'ões'} pré-preenchida${filled === 1 ? '' : 's'}`}
      </p>
      {combinations > 0 && (
        <div
          className="grid gap-[2px] overflow-x-auto"
          style={{ gridTemplateColumns: `repeat(${shownX.length}, 10px)` }}
          role="img"
          aria-label={`Preview do template: ${filled} de ${combinations} combinações pré-preenchidas`}
        >
          {shownY.flatMap((yPath) =>
            shownX.map((xPath) => {
              const key = encodeCellKey(xPath, yPath);
              const isFilled = cells[key]?.decision !== undefined;
              return (
                <span
                  key={key}
                  data-filled={isFilled}
                  className={
                    isFilled
                      ? 'h-[10px] w-[10px] rounded-[1px] bg-emerald-400 dark:bg-emerald-600'
                      : 'h-[10px] w-[10px] rounded-[1px] bg-[repeating-linear-gradient(45deg,#d4d4d4_0,#d4d4d4_2px,transparent_2px,transparent_4px)] dark:bg-neutral-800'
                  }
                />
              );
            }),
          )}
        </div>
      )}
      {truncated && (
        <p className="text-[11px] text-neutral-400">
          (miniatura truncada em {MAX_SIDE} × {MAX_SIDE})
        </p>
      )}
    </div>
  );
}
