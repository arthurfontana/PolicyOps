import { useMemo, useState, type ReactNode } from 'react';
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
import { ClipboardPaste, Download, GripVertical, Info, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  BoundaryMode,
  Domain,
  GroupingDimension,
  GroupingRange,
  VariableType,
} from '@/core/document/schema';
import { distinctGroupingPaths, formatGroupingPath, groupingPathKey } from '@/core/document/grouping';
import {
  findIncompleteGroupingPaths,
  MAX_GROUPING_LEVELS,
  type DomainValidationIssue,
} from '@/core/library/validate-domains';
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
import { ConfirmDialog } from './ConfirmDialog';

export interface DomainsEditorProps {
  type: VariableType;
  domains: Domain[];
  onChange: (domains: Domain[]) => void;
  issues: DomainValidationIssue[];
  disabled?: boolean;
  /** Ausente = variável não usa agrupamento (docs/07 §11, docs/05 §5.6). */
  groupingDimensions?: GroupingDimension[];
  /**
   * Só quando definido o editor de agrupamentos aparece — quem não usa
   * agrupamento não precisa saber que a opção existe.
   */
  onGroupingDimensionsChange?: (groupingDimensions: GroupingDimension[] | undefined) => void;
  /** Ausente = `INCLUSIVE_INTEGER`, o default (docs/03 §2). */
  boundaryMode?: BoundaryMode;
  /**
   * Só quando definido o toggle "Faixas decimais/meio-abertas" aparece —
   * mesmo padrão de `onGroupingDimensionsChange`.
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

function blankDomain(position: number, type: VariableType, groupingMode: boolean): Domain {
  const domain: Domain = { code: '', label: '', position };
  if (type === 'RANGE') {
    if (groupingMode) domain.groupingRanges = [];
    else {
      domain.rangeMin = '';
      domain.rangeMax = '';
    }
  }
  return domain;
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

/**
 * Modelo com agrupamentos — docs/07 §11: exatamente o caso real de
 * Regional × Porte de docs/05 §5.6.2, combinações assimétricas inclusive.
 */
function groupingTemplateRows(): string[][] {
  return [
    ['Agrupamento 1', 'Agrupamento 2', 'Domínio', 'Mínimo', 'Máximo', 'Cor'],
    ['São Paulo', 'MEI', 'R1 - Risco baixo', '0', '357', '#00FF2A'],
    ['São Paulo', 'MEI', 'R2 - Risco médio', '358', '420', '#FFA200'],
    ['São Paulo', 'Não MEI', 'R1 - Risco baixo', '0', '340', '#00FF2A'],
    ['Sul', 'MEI', 'R1 - Risco baixo', '0', '360', '#00FF2A'],
  ];
}

function downloadCsv(rows: string[][], filename: string): void {
  const csv = rows.map((row) => row.join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Lista de erros (vermelho) ou avisos (âmbar) de um resultado de colagem. */
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

/** Diálogo único de "Colar tabela" — detecta agrupamento pela própria colagem (docs/07 §11). */
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

/** Erros de contiguidade de um caminho específico — nunca confunde "SP › MEI" com "SUL › MEI". */
function issuesForPath(issues: DomainValidationIssue[], key: string): DomainValidationIssue[] {
  return issues.filter((issue) => issue.path !== undefined && groupingPathKey(issue.path) === key);
}

function SortableRow({
  row,
  showRangeFields,
  boundaryMode,
  showManualInclusion,
  disabled,
  issues,
  onUpdate,
  onRemove,
}: {
  row: Row;
  /** Falso no modo agrupado: as faixas moram na tabela tidy, não na linha de identidade. */
  showRangeFields: boolean;
  boundaryMode: BoundaryMode;
  /** Só true quando o usuário abriu "Opções avançadas" e ligou o controle de inclusão manual (docs/07 §11). */
  showManualInclusion: boolean;
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
  const rowIssues = issuesFor(issues, row.domain.code).filter((issue) => issue.path === undefined);

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

      {showRangeFields && (
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

function SortableGroupingRow({
  id,
  dimension,
  disabled,
  onUpdate,
  onRemove,
}: {
  id: string;
  dimension: GroupingDimension;
  disabled: boolean;
  onUpdate: (patch: Partial<GroupingDimension>) => void;
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
      data-testid="grouping-dimension-row"
      className={cn('flex items-center gap-2', isDragging && 'opacity-60')}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-neutral-400 disabled:cursor-not-allowed disabled:opacity-30"
        disabled={disabled}
        aria-label={`Arrastar para reordenar o agrupamento "${dimension.code || 'agrupamento'}"`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Input
        aria-label="Código do agrupamento"
        placeholder="REGIONAL"
        value={dimension.code}
        disabled={disabled}
        onChange={(event) => onUpdate({ code: event.target.value.toUpperCase() })}
        className="w-32 font-mono text-xs"
      />
      <Input
        aria-label="Nome do agrupamento"
        placeholder="Regional"
        value={dimension.label}
        disabled={disabled}
        onChange={(event) => onUpdate({ label: event.target.value })}
        className="min-w-32 flex-1"
      />
      <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
        {dimension.options.length} opção(ões)
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Remover agrupamento "${dimension.code || 'agrupamento'}"`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

/**
 * Lista dos agrupamentos da versão — nome, contagem de opções, drag para
 * reordenar (docs/07 §11). Populada principalmente pela colagem; a edição
 * manual aqui é complementar (renomear, reordenar, remover, adicionar vazio).
 */
function GroupingDimensionsEditor({
  dimensions,
  disabled,
  onChange,
  onRemoveAt,
}: {
  dimensions: GroupingDimension[];
  disabled: boolean;
  onChange: (dimensions: GroupingDimension[]) => void;
  onRemoveAt: (index: number) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const ids = dimensions.map((_dimension, index) => `grouping-${index}`);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(dimensions, from, to));
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
      <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
        Agrupamentos (hierarquia, da esquerda para a direita)
      </span>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1.5">
            {dimensions.map((dimension, index) => (
              <SortableGroupingRow
                key={ids[index]}
                id={ids[index]!}
                dimension={dimension}
                disabled={disabled}
                onUpdate={(patch) =>
                  onChange(dimensions.map((d, i) => (i === index ? { ...d, ...patch } : d)))
                }
                onRemove={() => onRemoveAt(index)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {dimensions.length === 0 && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Nenhum agrupamento ainda. Cole uma tabela com colunas de agrupamento ou adicione um nível vazio.
        </p>
      )}
      {!disabled && dimensions.length < MAX_GROUPING_LEVELS && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onChange([...dimensions, { code: '', label: '', options: [] }])}
          className="self-start"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Adicionar agrupamento
        </Button>
      )}
    </div>
  );
}

/** Uma linha da tabela tidy: `(agrupamento…, domínio, mín, máx, cor)` dentro de um grupo. */
function GroupingRangeRow({
  domain,
  range,
  boundaryMode,
  disabled,
  onUpdate,
  onRemove,
}: {
  domain: Domain;
  range: GroupingRange;
  boundaryMode: BoundaryMode;
  disabled: boolean;
  onUpdate: (patch: { min?: string; max?: string }) => void;
  onRemove: () => void;
}) {
  return (
    <div data-testid="grouping-range-row" className="flex flex-wrap items-center gap-2">
      <span
        className="h-4 w-4 shrink-0 rounded border border-neutral-300 dark:border-neutral-700"
        style={{ backgroundColor: domain.color ?? 'transparent' }}
        aria-hidden
      />
      <span className="w-24 shrink-0 truncate font-mono text-xs text-neutral-700 dark:text-neutral-300">
        {domain.code || '—'}
      </span>
      <Input
        aria-label={`Mínimo de ${domain.code} em ${formatGroupingPath(range.path)}`}
        placeholder="mín"
        value={range.min}
        disabled={disabled}
        onChange={(event) => onUpdate({ min: event.target.value })}
        className="w-24"
      />
      <span className="text-xs text-neutral-400">até</span>
      <Input
        aria-label={`Máximo de ${domain.code} em ${formatGroupingPath(range.path)}`}
        placeholder="máx"
        value={range.max ?? ''}
        disabled={disabled || domain.isCatchAll === true}
        onChange={(event) => onUpdate({ max: event.target.value })}
        className="w-24"
      />
      {boundaryMode === 'INCLUSIVE_INTEGER' && (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">inclusivo, passo 1</span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Remover ${domain.code} de ${formatGroupingPath(range.path)}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

/**
 * Tabela de domínios com reordenação por drag (`@dnd-kit/sortable`) —
 * docs/07-ux-e-editor.md §11. Habilitada só em DRAFT (`disabled` controla).
 * Cada mudança chama `onChange` imediatamente — a validação em tempo real
 * (`issues`, calculada pelo pai com `validateDomains`) reage sem recarregar.
 *
 * Agrupamentos (só RANGE): quando a versão declara `groupingDimensions`, as
 * faixas deixam de ser um par mín/máx por domínio e viram uma **tabela tidy**
 * — uma linha por `(caminho, domínio)`, agrupada visualmente por caminho, com
 * contiguidade validada por caminho distinto. O editor de agrupamentos é
 * populado principalmente por "Colar tabela"; a edição manual é complementar.
 */
export function DomainsEditor({
  type,
  domains,
  onChange,
  issues,
  disabled = false,
  groupingDimensions,
  onGroupingDimensionsChange,
  boundaryMode,
  onBoundaryModeChange,
}: DomainsEditorProps) {
  const groupingMode = type === 'RANGE' && groupingDimensions !== undefined && groupingDimensions.length > 0;
  const effectiveBoundaryMode: BoundaryMode = boundaryMode ?? 'INCLUSIVE_INTEGER';
  const [rows, setRows] = useState<Row[]>(() => toRows(domains));

  // "Opções avançadas" — docs/07 §11: boundaryMode e inclusão manual por
  // faixa ficam colapsados por padrão; o comportamento assumido é
  // INCLUSIVE_INTEGER (inteiros fechados-fechados, passo 1).
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showManualInclusion, setShowManualInclusion] = useState(false);

  // Colagem genérica — docs/05 §5.6.2: caminho único, detecta agrupamento sozinho.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState<ParseDomainTableResult | null>(null);

  // Remoção de nível apaga faixas: sempre passa por confirmação (docs/07 §11).
  const [dimensionToRemove, setDimensionToRemove] = useState<number | null>(null);

  // Paletas de cor — docs/05 §5.6.4.
  const [paletteMatchInfo, setPaletteMatchInfo] = useState<{ name: string; matched: number; total: number } | null>(
    null,
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const currentDomains = useMemo(() => toDomains(rows), [rows]);

  /** Grupos da tabela tidy, na ordem das opções de cada nível (docs/07 §11). */
  const groups = useMemo(() => {
    if (!groupingMode) return [];
    const rankByLevel = groupingDimensions!.map(
      (dimension) => new Map(dimension.options.map((option, index) => [option.code, index])),
    );
    const rankOf = (path: string[], level: number) =>
      rankByLevel[level]?.get(path[level] ?? '') ?? Number.MAX_SAFE_INTEGER;
    return distinctGroupingPaths(currentDomains)
      .sort((a, b) => {
        for (let level = 0; level < Math.max(a.length, b.length); level++) {
          const diff = rankOf(a, level) - rankOf(b, level);
          if (diff !== 0) return diff;
        }
        return 0;
      })
      .map((path) => ({ path, key: groupingPathKey(path) }));
  }, [groupingMode, groupingDimensions, currentDomains]);

  const incompletePaths = useMemo(
    () => (groupingMode ? findIncompleteGroupingPaths(currentDomains, groupingDimensions!) : []),
    [groupingMode, groupingDimensions, currentDomains],
  );

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

  /** Edita a faixa de um domínio num caminho específico — as demais ficam intactas. */
  function handleUpdateGroupingRange(code: string, key: string, patch: { min?: string; max?: string }) {
    commit(
      rows.map((row) => {
        if (row.domain.code !== code) return row;
        const nextRanges = (row.domain.groupingRanges ?? []).map((range) =>
          groupingPathKey(range.path) === key ? { ...range, ...patch } : range,
        );
        return { ...row, domain: { ...row.domain, groupingRanges: nextRanges } };
      }),
    );
  }

  function handleRemoveGroupingRange(code: string, key: string) {
    commit(
      rows.map((row) => {
        if (row.domain.code !== code) return row;
        const nextRanges = (row.domain.groupingRanges ?? []).filter(
          (range) => groupingPathKey(range.path) !== key,
        );
        return { ...row, domain: { ...row.domain, groupingRanges: nextRanges } };
      }),
    );
  }

  /** Adiciona a combinação faltante de um domínio num caminho já existente. */
  function handleAddGroupingRange(code: string, path: string[]) {
    commit(
      rows.map((row) => {
        if (row.domain.code !== code) return row;
        const nextRanges = [...(row.domain.groupingRanges ?? []), { path: [...path], min: '', max: '' }];
        return { ...row, domain: { ...row.domain, groupingRanges: nextRanges } };
      }),
    );
  }

  function handleRemove(rowId: string) {
    commit(rows.filter((row) => row.rowId !== rowId));
  }

  function handleAdd() {
    const domain = blankDomain(rows.length, type, groupingMode);
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

  /**
   * Ligar o agrupamento é um interruptor binário por versão (docs/05 §5.6):
   * ao criar o primeiro nível, as faixas do modo simples são descartadas — o
   * usuário parte de faixas vazias no modo para o qual mudou.
   */
  function handleGroupingDimensionsChange(next: GroupingDimension[]) {
    if (onGroupingDimensionsChange === undefined) return;
    const wasEmpty = (groupingDimensions ?? []).length === 0;
    if (wasEmpty && next.length > 0) {
      commit(
        rows.map((row) => {
          const domain: Domain = { ...row.domain };
          delete domain.rangeMin;
          delete domain.rangeMax;
          domain.groupingRanges = [];
          return { ...row, domain };
        }),
      );
    }
    onGroupingDimensionsChange(next.length === 0 ? undefined : next);
  }

  /**
   * Remover um nível apaga as faixas daquele nível (docs/07 §11): sem o nível,
   * nenhum `path` existente tem mais o comprimento certo (I19), então as
   * faixas agrupadas são descartadas junto.
   */
  function handleRemoveGroupingDimension(index: number) {
    if (onGroupingDimensionsChange === undefined || groupingDimensions === undefined) return;
    const next = groupingDimensions.filter((_dimension, i) => i !== index);
    commit(
      rows.map((row) => {
        const domain: Domain = { ...row.domain };
        delete domain.groupingRanges;
        if (next.length > 0) domain.groupingRanges = [];
        return { ...row, domain };
      }),
    );
    onGroupingDimensionsChange(next.length === 0 ? undefined : next);
  }

  /**
   * Colagem — docs/05 §5.6.2/§5.6.3: o resultado de `mergeImportedDomains`
   * substitui o conteúdo do editor para revisão, e os `groupingDimensions`
   * detectados passam a valer para a versão; nada é gravado até o "Salvar"
   * normal do pai (`variable/saveDomains`).
   */
  function handlePasteConfirm() {
    const result = parseDomainTable(pasteText);
    setPasteResult(result);
    if (result.errors.length > 0) return;
    const merged = mergeImportedDomains(toDomains(rows), result);
    commit(toRows(merged));
    if (type === 'RANGE' && onGroupingDimensionsChange !== undefined) {
      onGroupingDimensionsChange(
        result.groupingDimensions.length === 0 ? undefined : result.groupingDimensions,
      );
    }
    setPasteOpen(false);
    setPasteText('');
    setPasteResult(null);
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
  const showPaletteButton = type === 'RANGE' || type === 'CATEGORICAL' || type === 'ORDINAL';

  return (
    <div className="flex flex-col gap-2">
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
                  checked={effectiveBoundaryMode === 'HALF_OPEN'}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onBoundaryModeChange(checked === true ? 'HALF_OPEN' : undefined)
                  }
                />
                Faixas decimais/meio-abertas (ex.: 0–10, 10–20 — o máximo de uma não pertence à seguinte)
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

      {type === 'RANGE' && onGroupingDimensionsChange !== undefined && (
        <GroupingDimensionsEditor
          dimensions={groupingDimensions ?? []}
          disabled={disabled}
          onChange={handleGroupingDimensionsChange}
          onRemoveAt={setDimensionToRemove}
        />
      )}

      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setPasteOpen(true)}
            className="self-start"
          >
            <ClipboardPaste className="mr-1.5 h-4 w-4" /> Colar tabela
          </Button>
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

      {/* Aviso não-bloqueante de combinação provavelmente esquecida (docs/07 §11). */}
      {incompletePaths.length > 0 && (
        <div
          data-testid="incomplete-grouping-banner"
          className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <span className="flex items-start gap-1.5 font-medium">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Algumas combinações não têm faixa para todos os domínios. Isso pode ser intencional — não impede
            salvar.
          </span>
          <ul className="flex flex-col gap-0.5 pl-5">
            {incompletePaths.map((entry) => (
              <li key={groupingPathKey(entry.path)}>
                {formatGroupingPath(entry.path)}: sem faixa para {entry.missingDomainCodes.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rows.map((row) => row.rowId)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <SortableRow
                key={row.rowId}
                row={row}
                showRangeFields={type === 'RANGE' && !groupingMode}
                boundaryMode={effectiveBoundaryMode}
                showManualInclusion={showManualInclusion}
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

      {/* Tabela tidy: uma linha por (caminho, domínio), agrupada por caminho. */}
      {groupingMode && (
        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Faixas por combinação
          </span>
          {groups.length === 0 && (
            <p className="rounded-md border border-dashed border-neutral-300 p-3 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              Nenhuma combinação ainda. Cole uma tabela com colunas de agrupamento para preencher as faixas.
            </p>
          )}
          {groups.map((group) => {
            const groupIssues = issuesForPath(issues, group.key);
            const present = currentDomains.filter((domain) =>
              (domain.groupingRanges ?? []).some((range) => groupingPathKey(range.path) === group.key),
            );
            const missing = currentDomains.filter(
              (domain) =>
                domain.code !== '' &&
                !(domain.groupingRanges ?? []).some((range) => groupingPathKey(range.path) === group.key),
            );
            return (
              <div
                key={group.key}
                data-testid="grouping-path-group"
                data-path={group.key}
                className="flex flex-col gap-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-800"
              >
                <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                  {formatGroupingPath(group.path)}
                </span>
                {present.map((domain) => {
                  const range = (domain.groupingRanges ?? []).find(
                    (candidate) => groupingPathKey(candidate.path) === group.key,
                  )!;
                  return (
                    <GroupingRangeRow
                      key={domain.code}
                      domain={domain}
                      range={range}
                      boundaryMode={effectiveBoundaryMode}
                      disabled={disabled}
                      onUpdate={(patch) => handleUpdateGroupingRange(domain.code, group.key, patch)}
                      onRemove={() => handleRemoveGroupingRange(domain.code, group.key)}
                    />
                  );
                })}
                {groupIssues.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {groupIssues.map((issue, index) => (
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
                {!disabled && missing.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {missing.map((domain) => (
                      <Button
                        key={domain.code}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleAddGroupingRange(domain.code, group.path)}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" /> {domain.code}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
        title="Colar tabela de domínios"
        description={`Cole direto do Excel: uma linha de cabeçalho ("Domínio"${type === 'RANGE' ? ', "Mínimo", "Máximo"' : ''} e "Cor" são reconhecidas) e uma linha por combinação. Colunas à esquerda de "Domínio" viram agrupamentos automaticamente.`}
        textareaLabel="Tabela de domínios colada"
        text={pasteText}
        onTextChange={setPasteText}
        result={pasteResult}
        onConfirm={handlePasteConfirm}
        extra={
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[11px] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400">
            <p className="mb-1 font-medium text-neutral-600 dark:text-neutral-300">Exemplo:</p>
            <pre className="whitespace-pre-wrap font-mono">
              {domainTemplateRows(type)
                .map((row) => row.join('\t'))
                .join('\n')}
            </pre>
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => downloadCsv(domainTemplateRows(type), 'modelo-dominios.csv')}
              >
                <Download className="mr-1.5 h-4 w-4" /> Baixar modelo simples (.csv)
              </Button>
              {type === 'RANGE' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => downloadCsv(groupingTemplateRows(), 'modelo-dominios-agrupamentos.csv')}
                >
                  <Download className="mr-1.5 h-4 w-4" /> Baixar modelo com agrupamentos (.csv)
                </Button>
              )}
            </div>
          </div>
        }
      />

      <ConfirmDialog
        open={dimensionToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setDimensionToRemove(null);
        }}
        title="Remover agrupamento"
        description={`Remover "${(groupingDimensions ?? [])[dimensionToRemove ?? 0]?.label || 'este agrupamento'}" apaga as faixas de todas as combinações que dependem desse nível. Os domínios e suas cores continuam como estão.`}
        confirmLabel="Remover agrupamento"
        destructive
        onConfirm={() => {
          if (dimensionToRemove !== null) handleRemoveGroupingDimension(dimensionToRemove);
          setDimensionToRemove(null);
        }}
      />
    </div>
  );
}
