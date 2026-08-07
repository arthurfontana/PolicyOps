import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
 * Modo **Lista** da tela de comparação — docs/07-ux-e-editor.md §9.
 *
 * Tabela filtrável por tipo de mudança e ordenável, com o caminho legível
 * completo (`Varejo › 100k–500k × R3`). A exportação chega na S17 e por ora
 * fica desabilitada, com a sessão dita no tooltip.
 */

const ALL = 'TODOS';
const EXPORT_COMING_LATER = 'Exportar o diff chega na Sessão 17.';

type SortKey = 'path' | 'kind' | 'fields';

const KIND_VARIANT: Record<CellChangeKind, 'blue' | 'amber' | 'secondary'> = {
  ADDED: 'blue',
  REMOVED: 'secondary',
  MODIFIED: 'amber',
};

export interface DiffListProps {
  changes: readonly CellChange[];
  aView: EditorView;
  bView: EditorView;
  aLabel: string;
  bLabel: string;
  selectedKey: string | null;
  onSelectKey: (key: string) => void;
}

type Row = {
  change: CellChange;
  path: string;
  fieldsLabel: string;
  before: string;
  after: string;
};

export function DiffList({
  changes,
  aView,
  bView,
  aLabel,
  bLabel,
  selectedKey,
  onSelectKey,
}: DiffListProps) {
  const [kindFilter, setKindFilter] = useState<string>(ALL);
  const [sortKey, setSortKey] = useState<SortKey>('path');
  const [ascending, setAscending] = useState(true);

  const rows = useMemo<Row[]>(
    () =>
      changes.map((change) => {
        const fields = fieldsOf(change);
        // A linha resume os campos numa célula só; o detalhe campo a campo
        // fica no inspector, ao clicar.
        const before = beforeCellOf(change);
        const after = afterCellOf(change);
        return {
          change,
          path: readableCellPath(change.key, bView, aView),
          fieldsLabel: fields.map((field) => CELL_FIELD_LABEL[field]).join(', ') || '—',
          before: fields.map((field) => formatCellField(before, field, aView.catalog)).join(' · ') || '—',
          after: fields.map((field) => formatCellField(after, field, bView.catalog)).join(' · ') || '—',
        };
      }),
    [changes, aView, bView],
  );

  const visible = useMemo(() => {
    const filtered = kindFilter === ALL ? rows : rows.filter((row) => row.change.kind === kindFilter);
    const direction = ascending ? 1 : -1;
    return [...filtered].sort((left, right) => {
      if (sortKey === 'kind') {
        return direction * (left.change.kind.localeCompare(right.change.kind) || left.path.localeCompare(right.path, 'pt-BR'));
      }
      if (sortKey === 'fields') {
        return direction * (left.fieldsLabel.localeCompare(right.fieldsLabel, 'pt-BR') || left.path.localeCompare(right.path, 'pt-BR'));
      }
      return direction * left.path.localeCompare(right.path, 'pt-BR');
    });
  }, [rows, kindFilter, sortKey, ascending]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setAscending((current) => !current);
      return;
    }
    setSortKey(key);
    setAscending(true);
  }

  function SortableHeader({ column, children }: { column: SortKey; children: React.ReactNode }) {
    const active = sortKey === column;
    const Icon = ascending ? ArrowUp : ArrowDown;
    return (
      <th scope="col" className="p-2 font-medium">
        <button
          type="button"
          onClick={() => toggleSort(column)}
          aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
          className="flex items-center gap-1 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          {children}
          {active && <Icon className="h-3 w-3" aria-hidden />}
        </button>
      </th>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-56" aria-label="Filtrar por tipo de mudança">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os tipos de mudança</SelectItem>
            <SelectItem value="ADDED">Adicionadas</SelectItem>
            <SelectItem value="REMOVED">Removidas</SelectItem>
            <SelectItem value="MODIFIED">Modificadas</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-neutral-500 dark:text-neutral-400" data-testid="diff-list-count">
          {visible.length} de {rows.length} mudança(s)
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-auto">
              <Button type="button" variant="outline" size="sm" disabled>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Exportar
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{EXPORT_COMING_LATER}</TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
            <tr>
              <SortableHeader column="kind">Tipo</SortableHeader>
              <SortableHeader column="path">Combinação</SortableHeader>
              <SortableHeader column="fields">Campos</SortableHeader>
              <th scope="col" className="p-2 font-medium">
                {aLabel}
              </th>
              <th scope="col" className="p-2 font-medium">
                {bLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-neutral-400 dark:text-neutral-500">
                  Nenhuma mudança corresponde ao filtro.
                </td>
              </tr>
            )}
            {visible.map((row) => (
              <tr
                key={row.change.key}
                data-testid="diff-list-row"
                data-cell-key={row.change.key}
                aria-selected={selectedKey === row.change.key}
                onClick={() => onSelectKey(row.change.key)}
                className={`cursor-pointer border-t border-neutral-100 dark:border-neutral-800 ${
                  selectedKey === row.change.key ? 'bg-amber-50 dark:bg-amber-950/30' : ''
                }`}
              >
                <td className="p-2">
                  <Badge variant={KIND_VARIANT[row.change.kind]}>
                    {DIFF_KIND_LABEL[row.change.kind]}
                  </Badge>
                  {changeReasonLabel(row.change) !== null && (
                    <span className="ml-1 text-[11px] text-neutral-400">
                      {changeReasonLabel(row.change)}
                    </span>
                  )}
                </td>
                <td className="p-2 font-medium text-neutral-800 dark:text-neutral-200">{row.path}</td>
                <td className="p-2 text-neutral-500 dark:text-neutral-400">{row.fieldsLabel}</td>
                <td className="p-2 text-neutral-600 dark:text-neutral-300">{row.before}</td>
                <td className="p-2 text-neutral-900 dark:text-neutral-100">{row.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
