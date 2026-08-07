import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { CellChange, CellChangeKind } from '@/core/diff/types';
import type { EditorView } from '@/core/queries';
import {
  afterCellOf,
  beforeCellOf,
  CELL_FIELD_LABEL,
  changeReasonLabel,
  DIFF_KIND_LABEL,
  fieldsOf,
  formatCellField,
  readableCellPath,
} from '@/lib/diff-view';

/**
 * "Antes → depois" de uma combinação — docs/07-ux-e-editor.md §9: é o que
 * clicar numa célula alterada mostra no inspector.
 *
 * Componente de apresentação puro: recebe a mudança e as duas views. A tela
 * de comparação o monta no inspector do shell; o diálogo de conflito o monta
 * dentro de si mesmo, porque ali não há inspector.
 */

const KIND_VARIANT: Record<CellChangeKind, 'blue' | 'amber' | 'secondary'> = {
  ADDED: 'blue',
  REMOVED: 'secondary',
  MODIFIED: 'amber',
};

export interface DiffCellDetailProps {
  change: CellChange | null;
  aView: EditorView;
  bView: EditorView;
  /** Rótulos das duas pontas, ex.: "v1" e "v2". */
  aLabel: string;
  bLabel: string;
}

export function DiffCellDetail({ change, aView, bView, aLabel, bLabel }: DiffCellDetailProps) {
  if (change === null) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Clique numa célula marcada para ver o antes e o depois.
      </p>
    );
  }

  const before = beforeCellOf(change);
  const after = afterCellOf(change);
  const fields = fieldsOf(change);
  const reason = changeReasonLabel(change);

  return (
    <div className="flex flex-col gap-3" data-testid="diff-cell-detail">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={KIND_VARIANT[change.kind]}>{DIFF_KIND_LABEL[change.kind]}</Badge>
          {reason !== null && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">{reason}</span>
          )}
        </div>
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {readableCellPath(change.key, bView, aView)}
        </p>
      </div>

      <table className="w-full text-left text-xs">
        <thead className="text-neutral-500 dark:text-neutral-400">
          <tr>
            <th className="py-1 font-medium">Campo</th>
            <th className="py-1 font-medium">{aLabel}</th>
            <th className="py-1" aria-hidden />
            <th className="py-1 font-medium">{bLabel}</th>
          </tr>
        </thead>
        <tbody>
          {fields.length === 0 && (
            <tr>
              <td colSpan={4} className="py-2 text-neutral-400 dark:text-neutral-500">
                Sem campos preenchidos.
              </td>
            </tr>
          )}
          {fields.map((field) => (
            <tr key={field} className="border-t border-neutral-100 dark:border-neutral-800">
              <td className="py-1.5 pr-2 text-neutral-500 dark:text-neutral-400">
                {CELL_FIELD_LABEL[field]}
              </td>
              <td className="py-1.5 pr-2 text-neutral-700 dark:text-neutral-300">
                {formatCellField(before, field, aView.catalog)}
              </td>
              <td className="py-1.5 pr-2 text-neutral-400">
                <ArrowRight className="h-3 w-3" aria-label="para" />
              </td>
              <td className="py-1.5 font-medium text-neutral-900 dark:text-neutral-100">
                {formatCellField(after, field, bView.catalog)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
