import { useState } from 'react';
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
import { ClipboardPaste, GripVertical, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BoundaryMode, Domain, RegionalDimension, RegionalOption, VariableType } from '@/core/document/schema';
import type { DomainValidationIssue } from '@/core/library/validate-domains';
import { parseRegionalRangeTable, type ParseRegionalRangeTableResult } from '@/core/library/regional-import';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface DomainsEditorProps {
  type: VariableType;
  domains: Domain[];
  onChange: (domains: Domain[]) => void;
  issues: DomainValidationIssue[];
  disabled?: boolean;
  /** Ausente = variável não usa regional (docs/07 §11, docs/05 §5.6). */
  regionalDimension?: RegionalDimension;
  /**
   * Só quando definido o toggle "Esta faixa varia por regional" aparece —
   * omitir mantém o editor no modo de sempre (usado por quem ainda não
   * migrou para o fluxo regional).
   */
  onRegionalDimensionChange?: (regionalDimension: RegionalDimension | undefined) => void;
  /** Ausente = `HALF_OPEN`, o comportamento de sempre (docs/03 §2). */
  boundaryMode?: BoundaryMode;
  /**
   * Só quando definido o toggle "Faixas com limites fechados nos dois
   * lados" aparece — mesmo padrão de `onRegionalDimensionChange`.
   */
  onBoundaryModeChange?: (boundaryMode: BoundaryMode | undefined) => void;
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

function blankDomain(position: number, type: VariableType, regionalMode: boolean): Domain {
  const domain: Domain = { code: '', label: '', position };
  if (type === 'RANGE') {
    if (regionalMode) domain.regionalRanges = {};
    else {
      domain.rangeMin = '';
      domain.rangeMax = '';
    }
  }
  return domain;
}

/**
 * Alternar o interruptor regional não converte valores automaticamente
 * (docs/05 §5.6): domínios partem de faixas vazias no modo para o qual
 * mudou. Preserva só a identidade (code/label/shortLabel/color/isCatchAll).
 */
function stripRangeFields(domain: Domain): Domain {
  const next: Domain = { code: domain.code, label: domain.label, position: domain.position };
  if (domain.shortLabel !== undefined) next.shortLabel = domain.shortLabel;
  if (domain.color !== undefined) next.color = domain.color;
  if (domain.isCatchAll !== undefined) next.isCatchAll = domain.isCatchAll;
  return next;
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
  regions,
  boundaryMode,
  disabled,
  issues,
  onUpdate,
  onUpdateRegionalRange,
  onToggleCatchAll,
  onRemove,
}: {
  row: Row;
  type: VariableType;
  /** Presente = grid regional; ausente = par mín/máx único de sempre. */
  regions: RegionalOption[] | undefined;
  boundaryMode: BoundaryMode;
  disabled: boolean;
  issues: DomainValidationIssue[];
  onUpdate: (rowId: string, patch: Partial<Domain>) => void;
  onUpdateRegionalRange: (rowId: string, regionCode: string, patch: { min?: string; max?: string }) => void;
  onToggleCatchAll: (rowId: string, checked: boolean) => void;
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

      {type === 'RANGE' && regions === undefined && (
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
          {boundaryMode === 'INCLUSIVE_INTEGER' ? (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              limites inclusivos, passo 1
            </span>
          ) : (
            <>
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
            </>
          )}
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

      {type === 'RANGE' && regions !== undefined && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          {regions.length === 0 && (
            <span className="text-xs text-neutral-400">
              Adicione ao menos um regional acima para definir as faixas.
            </span>
          )}
          {regions.map((region) => {
            const current = row.domain.regionalRanges?.[region.code];
            return (
              <div
                key={region.code || region.label}
                className="flex items-center gap-1.5 rounded border border-neutral-200 p-1.5 dark:border-neutral-800"
              >
                <span className="font-mono text-[10px] font-medium uppercase text-neutral-500 dark:text-neutral-400">
                  {region.code || '—'}
                </span>
                <Input
                  aria-label={`Mínimo (${region.code})`}
                  placeholder="mín"
                  value={current?.min ?? ''}
                  disabled={disabled}
                  onChange={(event) =>
                    onUpdateRegionalRange(row.rowId, region.code, { min: event.target.value })
                  }
                  className="w-20"
                />
                <span className="text-xs text-neutral-400">até</span>
                <Input
                  aria-label={`Máximo (${region.code})`}
                  placeholder="máx"
                  value={current?.max ?? ''}
                  disabled={disabled || row.domain.isCatchAll === true}
                  onChange={(event) =>
                    onUpdateRegionalRange(row.rowId, region.code, { max: event.target.value })
                  }
                  className="w-20"
                />
              </div>
            );
          })}
          <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            <Checkbox
              checked={row.domain.isCatchAll ?? false}
              disabled={disabled}
              onCheckedChange={(checked) => onToggleCatchAll(row.rowId, checked === true)}
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

function SortableRegionRow({
  id,
  region,
  disabled,
  onUpdate,
  onRemove,
}: {
  id: string;
  region: RegionalOption;
  disabled: boolean;
  onUpdate: (patch: Partial<RegionalOption>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('flex items-center gap-2', isDragging && 'opacity-60')}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-neutral-400 disabled:cursor-not-allowed disabled:opacity-30"
        disabled={disabled}
        aria-label={`Arrastar para reordenar o regional "${region.code || 'regional'}"`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Input
        aria-label="Código do regional"
        placeholder="BASE"
        value={region.code}
        disabled={disabled}
        onChange={(event) => onUpdate({ code: event.target.value.toUpperCase() })}
        className="w-28 font-mono text-xs"
      />
      <Input
        aria-label="Rótulo do regional"
        placeholder="Rótulo"
        value={region.label}
        disabled={disabled}
        onChange={(event) => onUpdate({ label: event.target.value })}
        className="min-w-32 flex-1"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Remover regional "${region.code || 'regional'}"`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** Editor de lista dos regionais — code/label, drag para reordenar (docs/07 §11). */
function RegionalOptionsEditor({
  regions,
  disabled,
  onChange,
}: {
  regions: RegionalOption[];
  disabled: boolean;
  onChange: (regions: RegionalOption[]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const ids = regions.map((_region, index) => `region-${index}`);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(regions, from, to));
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
      <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Regionais</span>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1.5">
            {regions.map((region, index) => (
              <SortableRegionRow
                key={ids[index]}
                id={ids[index]!}
                region={region}
                disabled={disabled}
                onUpdate={(patch) => onChange(regions.map((r, i) => (i === index ? { ...r, ...patch } : r)))}
                onRemove={() => onChange(regions.filter((_r, i) => i !== index))}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {regions.length === 0 && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Nenhum regional ainda. Adicione ao menos um para definir as faixas.
        </p>
      )}
      {!disabled && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onChange([...regions, { code: '', label: '' }])}
          className="self-start"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Adicionar regional
        </Button>
      )}
    </div>
  );
}

/**
 * Tabela de domínios com reordenação por drag (`@dnd-kit/sortable`) —
 * docs/07-ux-e-editor.md §11. Habilitada só em DRAFT (`disabled` controla).
 * Cada mudança chama `onChange` imediatamente — a validação em tempo real
 * (`issues`, calculada pelo pai com `validateDomains`) reage sem recarregar.
 *
 * Dimensão regional (só RANGE): o toggle "Esta faixa varia por regional" só
 * aparece quando o pai passa `onRegionalDimensionChange` — quem não usa
 * regional não precisa saber que a opção existe.
 */
export function DomainsEditor({
  type,
  domains,
  onChange,
  issues,
  disabled = false,
  regionalDimension,
  onRegionalDimensionChange,
  boundaryMode,
  onBoundaryModeChange,
}: DomainsEditorProps) {
  const regionalMode = type === 'RANGE' && regionalDimension !== undefined;
  const effectiveBoundaryMode: BoundaryMode = boundaryMode ?? 'HALF_OPEN';
  const [rows, setRows] = useState<Row[]>(() => toRows(domains));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState<ParseRegionalRangeTableResult | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function commit(next: Row[]) {
    const renumbered = renumber(next);
    setRows(renumbered);
    onChange(toDomains(renumbered));
  }

  function handleUpdate(rowId: string, patch: Partial<Domain>) {
    commit(rows.map((row) => (row.rowId === rowId ? { ...row, domain: { ...row.domain, ...patch } } : row)));
  }

  function handleUpdateRegionalRange(rowId: string, regionCode: string, patch: { min?: string; max?: string }) {
    commit(
      rows.map((row) => {
        if (row.rowId !== rowId) return row;
        const current = row.domain.regionalRanges?.[regionCode] ?? { min: '' };
        const nextRanges = { ...(row.domain.regionalRanges ?? {}) };
        nextRanges[regionCode] = { ...current, ...patch };
        return { ...row, domain: { ...row.domain, regionalRanges: nextRanges } };
      }),
    );
  }

  function handleToggleCatchAll(rowId: string, checked: boolean) {
    commit(
      rows.map((row) => {
        if (row.rowId !== rowId) return row;
        const nextRanges = { ...(row.domain.regionalRanges ?? {}) };
        if (checked) {
          for (const code of Object.keys(nextRanges)) {
            nextRanges[code] = { ...nextRanges[code]!, max: undefined };
          }
        }
        return { ...row, domain: { ...row.domain, isCatchAll: checked, regionalRanges: nextRanges } };
      }),
    );
  }

  function handleRemove(rowId: string) {
    commit(rows.filter((row) => row.rowId !== rowId));
  }

  function handleAdd() {
    const domain = blankDomain(rows.length, type, regionalMode);
    commit([...rows, { rowId: `new-${rows.length}-${Date.now()}`, domain }]);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const from = rows.findIndex((row) => row.rowId === active.id);
    const to = rows.findIndex((row) => row.rowId === over.id);
    if (from < 0 || to < 0) return;
    commit(arrayMove(rows, from, to));
  }

  function handleToggleRegional(checked: boolean) {
    if (onRegionalDimensionChange === undefined) return;
    commit(rows.map((row) => ({ ...row, domain: stripRangeFields(row.domain) })));
    onRegionalDimensionChange(checked ? { regions: [] } : undefined);
  }

  function handlePasteConfirm() {
    const result = parseRegionalRangeTable(pasteText);
    setPasteResult(result);
    if (result.errors.length > 0) return;
    commit(toRows(result.domains));
    onRegionalDimensionChange?.({ regions: result.regions });
    setPasteOpen(false);
    setPasteText('');
    setPasteResult(null);
  }

  const topIssues = generalIssues(issues);

  return (
    <div className="flex flex-col gap-2">
      {type === 'RANGE' && onRegionalDimensionChange !== undefined && (
        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <Checkbox
            checked={regionalMode}
            disabled={disabled}
            onCheckedChange={(checked) => handleToggleRegional(checked === true)}
          />
          Esta faixa varia por regional
        </label>
      )}

      {type === 'RANGE' && onBoundaryModeChange !== undefined && (
        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <Checkbox
            checked={effectiveBoundaryMode === 'INCLUSIVE_INTEGER'}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onBoundaryModeChange(checked === true ? 'INCLUSIVE_INTEGER' : undefined)
            }
          />
          Faixas com limites fechados nos dois lados (ex.: 0–357, 358–437 — inteiros, passo 1)
        </label>
      )}

      {regionalMode && (
        <>
          <RegionalOptionsEditor
            regions={regionalDimension.regions}
            disabled={disabled}
            onChange={(regions) => onRegionalDimensionChange?.({ regions })}
          />
          {!disabled && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setPasteOpen(true)}
              className="self-start"
            >
              <ClipboardPaste className="mr-1.5 h-4 w-4" /> Colar tabela
            </Button>
          )}
        </>
      )}

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
                regions={regionalMode ? regionalDimension.regions : undefined}
                boundaryMode={effectiveBoundaryMode}
                disabled={disabled}
                issues={issues}
                onUpdate={handleUpdate}
                onUpdateRegionalRange={handleUpdateRegionalRange}
                onToggleCatchAll={handleToggleCatchAll}
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

      <Dialog
        open={pasteOpen}
        onOpenChange={(next) => {
          setPasteOpen(next);
          if (!next) {
            setPasteText('');
            setPasteResult(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Colar tabela de regionais</DialogTitle>
            <DialogDescription>
              Cole direto do Excel: regional nas colunas (linha de código + linha MIN/MAX), uma faixa por
              linha.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Tabela colada"
            rows={10}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder="Cole aqui a tabela copiada do Excel…"
            className="font-mono text-xs"
          />
          {pasteResult !== null && pasteResult.errors.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
              {pasteResult.errors.map((error, index) => (
                <li key={index} className="flex items-start gap-1.5">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {error}
                </li>
              ))}
            </ul>
          )}
          {pasteResult !== null && pasteResult.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
              {pasteResult.warnings.map((warning, index) => (
                <li key={index} className="flex items-start gap-1.5">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {warning}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPasteOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handlePasteConfirm}>
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
