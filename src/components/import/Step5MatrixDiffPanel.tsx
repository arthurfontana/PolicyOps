import { Badge } from '@/components/ui/badge';
import { decodeCellKey } from '@/core/axes/paths';
import { DIFFED_CELL_FIELDS, type CellChange } from '@/core/diff/types';
import type { Cell } from '@/core/document/schema';

const FIELD_LABEL: Record<(typeof DIFFED_CELL_FIELDS)[number], string> = {
  decision: 'Decisão',
  offer: 'Oferta',
  limit: 'Limite',
  limitOverride: 'Limite (override)',
  color: 'Cor',
  note: 'Nota',
  attrs: 'Atributos',
};

function cellFieldText(cell: Cell, field: keyof Cell): string {
  if (field === 'attrs') return cell.attrs === undefined ? '—' : JSON.stringify(cell.attrs);
  const value = cell[field];
  return value === undefined ? '—' : String(value);
}

/**
 * Diff célula a célula de uma matriz do plano — lista direta sobre
 * `MatrixPlan.changes` (já calculado por `planImport` via `src/core/diff/`),
 * em vez de embutir o grid completo de `CompareView`: a matriz `NEW` não tem
 * versão real para as duas pontas da comparação, e uma reconstrução sintética
 * de `EditorView` correta pesaria mais do que o valor que agrega nesta sessão
 * somente-leitura (docs/13-decisoes.md DEC-CARGA-014).
 */
export function Step5MatrixDiffPanel({ changes }: { changes: CellChange[] }) {
  if (changes.length === 0) {
    return <p className="p-3 text-xs text-neutral-500 dark:text-neutral-400">Sem alterações de célula.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-neutral-200 p-3 dark:border-neutral-800">
      {changes.slice(0, 200).map((change) => {
        const { xPath, yPath } = decodeCellKey(change.key);
        return (
          <div key={change.key} className="flex items-start gap-2 text-xs">
            <Badge variant={change.kind === 'ADDED' ? 'green' : change.kind === 'REMOVED' ? 'secondary' : 'amber'}>
              {change.kind}
            </Badge>
            <span className="font-mono text-neutral-500 dark:text-neutral-400">
              {xPath} · {yPath}
            </span>
            <span className="text-neutral-700 dark:text-neutral-300">
              {change.kind === 'ADDED' && `oferta ${cellFieldText(change.after, 'offer')}, decisão ${cellFieldText(change.after, 'decision')}`}
              {change.kind === 'REMOVED' && `era oferta ${cellFieldText(change.before, 'offer')}`}
              {change.kind === 'MODIFIED' &&
                change.fields
                  .map((field) => `${FIELD_LABEL[field]}: ${cellFieldText(change.before, field)} → ${cellFieldText(change.after, field)}`)
                  .join(' · ')}
            </span>
          </div>
        );
      })}
      {changes.length > 200 && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">…e mais {changes.length - 200} células.</p>
      )}
    </div>
  );
}
