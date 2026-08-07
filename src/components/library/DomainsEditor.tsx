import { useState, type ReactNode } from 'react';
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
import { ClipboardPaste, Download, GripVertical, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BoundaryMode, Domain, RegionalDimension, RegionalOption, VariableType } from '@/core/document/schema';
import type { DomainValidationIssue } from '@/core/library/validate-domains';
import { parseRegionalRangeTable, type ParseRegionalRangeTableResult } from '@/core/library/regional-import';
import { mergeImportedDomains, parseDomainTable, type ParseDomainTableResult } from '@/core/library/domain-import';
import { COLOR_PALETTES, suggestPaletteColors } from '@/lib/color-palettes';
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

/**
 * Sugestão automática de cor — docs/05-regras-de-negocio.md §5.6.4. Domínio
 * sem `color` que bata com uma paleta oficial (código ou rótulo) já nasce com
 * a cor sugerida; domínio que já tem cor (digitada, colada ou herdada pelo
 * merge) nunca é sobrescrito por esta função — só "Aplicar paleta" sobrescreve
 * explicitamente.
 */
function autoSuggestColors(domains: Domain[]): Domain[] {
  let next = domains;
  for (const palette of COLOR_PALETTES) {
    next = next.map((domain) => {
      if (domain.color !== undefined) return domain;
      const [suggested] = suggestPaletteColors([domain], palette.id);
      return suggested ?? domain;
    });
  }
  return next;
}

/** Linhas de exemplo — fonte única para o modelo `.csv` e o preview inline (docs/07 §11). */
function domainTemplateRows(type: VariableType): string[][] {
  if (type === 'RANGE') {
    return [
      ['Domínio', 'Mínimo', 'Máximo', 'Cor'],
      ['R1 - Risco baixo', '0', '100', '#00FF2A'],
      ['R2 - Risco médio', '100', '200', '#FFA200'],
    ];
  }
  return [
    ['Domínio', 'Cor'],
    ['SIM', '#16A34A'],
    ['NAO', '#DC2626'],
  ];
}

function downloadDomainTemplate(type: VariableType): void {
  const csv = domainTemplateRows(type)
    .map((row) => row.join(','))
    .join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'modelo-dominios.csv';
  link.click();
  URL.revokeObjectURL(url);
}

/** Lista de erros (vermelho) ou avisos (âmbar) de um resultado de colagem — reaproveitada pelos dois diálogos. */
function ParseFeedback({ items, tone }: { items: string[]; tone: 'error' | 'warning' }) {
  if (items.length === 0) return null;
  const cls =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400'
      : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400';
  return (
    <ul className={cn('flex flex-col gap-1 rounded-md border p-2 text-xs', cls)}>
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-1.5">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Diálogo de "Colar tabela" — mesma estrutura para o caminho regional (S18) e o genérico (S19). */
function PasteDialog({
  open,
  onOpenChange,
  title,
  description,
  textareaLabel,
  extra,
  text,
  onTextChange,
  result,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  textareaLabel: string;
  extra?: ReactNode;
  text: string;
  onTextChange: (text: string) => void;
  result: { errors: string[]; warnings: string[] } | null;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {extra}
        <Textarea
          aria-label={textareaLabel}
          rows={10}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Cole aqui a tabela copiada do Excel…"
          className="font-mono text-xs"
        />
        {result !== null && <ParseFeedback items={result.errors} tone="error" />}
        {result !== null && <ParseFeedback items={result.warnings} tone="warning" />}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={onConfirm}>
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
  showManualInclusion,
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
  /** Só true quando o usuário abriu "Opções avançadas" e ligou o controle de inclusão manual (docs/07 §11). */
  showManualInclusion: boolean;
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
          {boundaryMode === 'INCLUSIVE_INTEGER' && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              limites inclusivos, passo 1
            </span>
          )}
          {boundaryMode !== 'INCLUSIVE_INTEGER' && showManualInclusion && (
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

  // "Opções avançadas" — docs/07 §11: boundaryMode e inclusão manual por
  // faixa ficam colapsados por padrão; o comportamento assumido é HALF_OPEN.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showManualInclusion, setShowManualInclusion] = useState(false);

  // Colagem genérica (fora do modo regional) — docs/05 §5.6.2.
  const [genericPasteOpen, setGenericPasteOpen] = useState(false);
  const [genericPasteText, setGenericPasteText] = useState('');
  const [genericPasteResult, setGenericPasteResult] = useState<ParseDomainTableResult | null>(null);

  // Paletas de cor — docs/05 §5.6.4.
  const [paletteMatchInfo, setPaletteMatchInfo] = useState<{ name: string; matched: number; total: number } | null>(
    null,
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function commit(next: Row[]) {
    const renumbered = renumber(next);
    const suggested = autoSuggestColors(renumbered.map((row) => row.domain));
    const withSuggestedColors = renumbered.map((row, index) => ({ ...row, domain: suggested[index]! }));
    setRows(withSuggestedColors);
    onChange(toDomains(withSuggestedColors));
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

  /**
   * Colagem genérica (fora do modo regional) — docs/05 §5.6.2/§5.6.3: o
   * resultado de `mergeImportedDomains` substitui o conteúdo do editor para
   * revisão; nada é gravado até o "Salvar" normal do pai (`variable/saveDomains`).
   */
  function handleGenericPasteConfirm() {
    const result = parseDomainTable(genericPasteText);
    setGenericPasteResult(result);
    if (result.errors.length > 0) return;
    const merged = mergeImportedDomains(toDomains(rows), result);
    commit(toRows(merged));
    setGenericPasteOpen(false);
    setGenericPasteText('');
    setGenericPasteResult(null);
  }

  /** "Aplicar paleta" — docs/05 §5.6.4: sobrescreve a cor de todo domínio que bater, mostra quantos bateram. */
  function handleApplyPalette(paletteId: string) {
    const palette = COLOR_PALETTES.find((candidate) => candidate.id === paletteId);
    if (palette === undefined) return;
    const before = toDomains(rows);
    const after = suggestPaletteColors(before, paletteId);
    // "Bateram" é quem a paleta reconhece por code/label — não quem mudou de
    // cor: reaplicar a mesma paleta sobre domínios já coloridos por ela
    // continua contando como acerto (docs/05 §5.6.4).
    const uncolored = before.map((domain) => ({ ...domain, color: undefined }));
    const matched = suggestPaletteColors(uncolored, paletteId).filter((domain) => domain.color !== undefined).length;
    commit(toRows(after));
    setPaletteMatchInfo({ name: palette.name, matched, total: before.length });
  }

  const topIssues = generalIssues(issues);
  const showGenericPaste = !regionalMode;
  const showPaletteButton = type === 'RANGE' || type === 'CATEGORICAL' || type === 'ORDINAL';

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
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="flex w-fit items-center gap-1 text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            {advancedOpen ? '▾' : '▸'} Opções avançadas
          </button>
          {advancedOpen && (
            <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
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
              <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <Checkbox
                  checked={showManualInclusion}
                  disabled={disabled}
                  onCheckedChange={(checked) => setShowManualInclusion(checked === true)}
                />
                Definir inclusão manualmente por faixa (caso raro)
              </label>
            </div>
          )}
        </div>
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

      {!disabled && (showGenericPaste || showPaletteButton) && (
        <div className="flex flex-wrap gap-2">
          {showGenericPaste && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setGenericPasteOpen(true)}
              className="self-start"
            >
              <ClipboardPaste className="mr-1.5 h-4 w-4" /> Colar tabela
            </Button>
          )}
          {showPaletteButton && (
            <select
              aria-label="Aplicar paleta"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value !== '') handleApplyPalette(event.target.value);
                event.target.value = '';
              }}
              className="h-8 rounded-md border border-neutral-300 bg-white px-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            >
              <option value="" disabled>
                Aplicar paleta…
              </option>
              {COLOR_PALETTES.map((palette) => (
                <option key={palette.id} value={palette.id}>
                  {palette.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {paletteMatchInfo !== null && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {paletteMatchInfo.matched} de {paletteMatchInfo.total} domínio(s) coloridos pela paleta "
          {paletteMatchInfo.name}".
        </p>
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
                showManualInclusion={showManualInclusion}
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

      <PasteDialog
        open={pasteOpen}
        onOpenChange={(next) => {
          setPasteOpen(next);
          if (!next) {
            setPasteText('');
            setPasteResult(null);
          }
        }}
        title="Colar tabela de regionais"
        description="Cole direto do Excel: regional nas colunas (linha de código + linha MIN/MAX), uma faixa por linha."
        textareaLabel="Tabela colada"
        text={pasteText}
        onTextChange={setPasteText}
        result={pasteResult}
        onConfirm={handlePasteConfirm}
      />

      <PasteDialog
        open={genericPasteOpen}
        onOpenChange={(next) => {
          setGenericPasteOpen(next);
          if (!next) {
            setGenericPasteText('');
            setGenericPasteResult(null);
          }
        }}
        title="Colar tabela de domínios"
        description={`Cole direto do Excel: uma linha de cabeçalho ("Domínio"${type === 'RANGE' ? ', "Mínimo", "Máximo"' : ''} e "Cor" são reconhecidas) e uma linha por domínio.`}
        textareaLabel="Tabela de domínios colada"
        text={genericPasteText}
        onTextChange={setGenericPasteText}
        result={genericPasteResult}
        onConfirm={handleGenericPasteConfirm}
        extra={
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[11px] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400">
            <p className="mb-1 font-medium text-neutral-600 dark:text-neutral-300">Exemplo:</p>
            <pre className="whitespace-pre-wrap font-mono">
              {domainTemplateRows(type)
                .map((row) => row.join('\t'))
                .join('\n')}
            </pre>
            <Button type="button" variant="ghost" size="sm" onClick={() => downloadDomainTemplate(type)}>
              <Download className="mr-1.5 h-4 w-4" /> Baixar modelo simples (.csv)
            </Button>
          </div>
        }
      />

    </div>
  );
}
