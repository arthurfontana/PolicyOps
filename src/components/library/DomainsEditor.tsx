import { useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Domain, VariableType } from '@/core/document/schema';
import type { DomainValidationIssue } from '@/core/library/validate-domains';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

export interface DomainsEditorProps {
  type: VariableType;
  domains: Domain[];
  onChange: (domains: Domain[]) => void;
  issues: DomainValidationIssue[];
  disabled?: boolean;
}

type Row = { rowId: string; domain: Domain };

function toRows(domains: Domain[]): Row[] {
  return [...domains]
    .sort((a, b) => a.position - b.position)
    .map((domain, index) => ({ rowId: `row-${index}-${domain.code}`, domain }));
}

function renumber(rows: Row[]): Row[] {
  return rows.map((row, index) => ({ ...row, domain: { ...row.domain, position: index } }));
}

function toDomains(rows: Row[]): Domain[] {
  return rows.map((row) => row.domain);
}

function blankDomain(position: number, type: VariableType): Domain {
  const domain: Domain = { code: '', label: '', position };
  if (type === 'RANGE') {
    domain.rangeMin = '';
    domain.rangeMax = '';
  }
  return domain;
}

function issuesFor(issues: DomainValidationIssue[], code: string): DomainValidationIssue[] {
  if (code === '') return [];
  return issues.filter((issue) => issue.domainCodes?.includes(code));
}

function generalIssues(issues: DomainValidationIssue[]): DomainValidationIssue[] {
  return issues.filter((issue) => issue.domainCodes === undefined);
}

function SortableRow({
  row,
  type,
  disabled,
  issues,
  onUpdate,
  onRemove,
}: {
  row: Row;
  type: VariableType;
  disabled: boolean;
  issues: DomainValidationIssue[];
  onUpdate: (rowId: string, patch: Partial<Domain>) => void;
  onRemove: (rowId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.rowId,
    disabled,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const rowIssues = issuesFor(issues, row.domain.code);

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="domain-row"
      className={cn(
        'flex flex-col gap-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-800',
        isDragging && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="shrink-0 cursor-grab touch-none text-neutral-400 disabled:cursor-not-allowed disabled:opacity-30"
          disabled={disabled}
          aria-label={`Arrastar para reordenar "${row.domain.code || 'domínio'}"`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <Input
          aria-label="Código"
          placeholder="CODIGO"
          value={row.domain.code}
          disabled={disabled}
          onChange={(event) => onUpdate(row.rowId, { code: event.target.value.toUpperCase() })}
          className="w-28 font-mono text-xs"
        />
        <Input
          aria-label="Rótulo"
          placeholder="Rótulo"
          value={row.domain.label}
          disabled={disabled}
          onChange={(event) => onUpdate(row.rowId, { label: event.target.value })}
          className="min-w-32 flex-1"
        />
        <Input
          aria-label="Rótulo curto"
          placeholder="Rótulo curto"
          value={row.domain.shortLabel ?? ''}
          disabled={disabled}
          onChange={(event) =>
            onUpdate(row.rowId, { shortLabel: event.target.value === '' ? undefined : event.target.value })
          }
          className="w-28"
        />
        <div className="flex items-center gap-1">
          <input
            type="color"
            aria-label="Cor"
            disabled={disabled}
            value={row.domain.color ?? '#E5E7EB'}
            onChange={(event) => onUpdate(row.rowId, { color: event.target.value.toUpperCase() })}
            className="h-8 w-8 shrink-0 cursor-pointer rounded border border-neutral-300 bg-transparent p-0.5 disabled:cursor-not-allowed dark:border-neutral-700"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={() => onRemove(row.rowId)}
          aria-label={`Remover "${row.domain.code || 'domínio'}"`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {type === 'RANGE' && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <Input
            aria-label="Mínimo"
            placeholder="mín"
            value={row.domain.rangeMin ?? ''}
            disabled={disabled || row.domain.isCatchAll === true}
            onChange={(event) => onUpdate(row.rowId, { rangeMin: event.target.value })}
            className="w-24"
          />
          <span className="text-xs text-neutral-400">até</span>
          <Input
            aria-label="Máximo"
            placeholder="máx"
            value={row.domain.rangeMax ?? ''}
            disabled={disabled || row.domain.isCatchAll === true}
            onChange={(event) => onUpdate(row.rowId, { rangeMax: event.target.value })}
            className="w-24"
          />
          <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            <Checkbox
              checked={row.domain.minInclusive ?? true}
              disabled={disabled}
              onCheckedChange={(checked) => onUpdate(row.rowId, { minInclusive: checked === true })}
            />
            mín. inclusivo
          </label>
          <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            <Checkbox
              checked={row.domain.maxInclusive ?? false}
              disabled={disabled}
              onCheckedChange={(checked) => onUpdate(row.rowId, { maxInclusive: checked === true })}
            />
            máx. inclusivo
          </label>
          <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            <Checkbox
              checked={row.domain.isCatchAll ?? false}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onUpdate(row.rowId, {
                  isCatchAll: checked === true,
                  rangeMax: checked === true ? undefined : (row.domain.rangeMax ?? ''),
                })
              }
            />
            demais casos (catch-all)
          </label>
        </div>
      )}

      {rowIssues.length > 0 && (
        <ul className="flex flex-col gap-0.5 pl-6">
          {rowIssues.map((issue, index) => (
            <li
              key={index}
              className="flex items-start gap-1 text-xs text-red-600 dark:text-red-400"
            >
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Tabela de domínios com reordenação por drag (`@dnd-kit/sortable`) —
 * docs/07-ux-e-editor.md §11. Habilitada só em DRAFT (`disabled` controla).
 * Cada mudança chama `onChange` imediatamente — a validação em tempo real
 * (`issues`, calculada pelo pai com `validateDomains`) reage sem recarregar.
 */
export function DomainsEditor({ type, domains, onChange, issues, disabled = false }: DomainsEditorProps) {
  const [rows, setRows] = useState<Row[]>(() => toRows(domains));
  const nextRowId = useRef(rows.length);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function commit(next: Row[]) {
    const renumbered = renumber(next);
    setRows(renumbered);
    onChange(toDomains(renumbered));
  }

  function handleUpdate(rowId: string, patch: Partial<Domain>) {
    commit(rows.map((row) => (row.rowId === rowId ? { ...row, domain: { ...row.domain, ...patch } } : row)));
  }

  function handleRemove(rowId: string) {
    commit(rows.filter((row) => row.rowId !== rowId));
  }

  function handleAdd() {
    nextRowId.current += 1;
    const domain = blankDomain(rows.length, type);
    commit([...rows, { rowId: `new-${nextRowId.current}`, domain }]);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const from = rows.findIndex((row) => row.rowId === active.id);
    const to = rows.findIndex((row) => row.rowId === over.id);
    if (from < 0 || to < 0) return;
    commit(arrayMove(rows, from, to));
  }

  const topIssues = generalIssues(issues);

  return (
    <div className="flex flex-col gap-2">
      {topIssues.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border border-red-200 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/30">
          {topIssues.map((issue, index) => (
            <li key={index} className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rows.map((row) => row.rowId)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <SortableRow
                key={row.rowId}
                row={row}
                type={type}
                disabled={disabled}
                issues={issues}
                onUpdate={handleUpdate}
                onRemove={handleRemove}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {rows.length === 0 && (
        <p className="rounded-md border border-dashed border-neutral-300 p-3 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          Nenhum domínio ainda. Adicione ao menos 2 para publicar.
        </p>
      )}

      {!disabled && (
        <Button type="button" variant="secondary" size="sm" onClick={handleAdd} className="self-start">
          <Plus className="mr-1.5 h-4 w-4" /> Adicionar domínio
        </Button>
      )}
    </div>
  );
}
