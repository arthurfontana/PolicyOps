import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { decodeCellKey, decodePath, encodeCellKey } from '@/core/axes/paths';
import type { CatalogItem, Cell } from '@/core/document/schema';
import { getEditorView, type EditorAxisView, type EditorView } from '@/core/queries';
import { CELL_FIELDS, applyCellPatch, type CellField, type PatchCoord } from '@/core/versioning/cells';
import { buildPatchFromForm, computeFieldState, type CellFormValues, type TouchedFieldKey } from '@/core/versioning/cell-form';
import { useToast } from '@/components/ui/use-toast';
import type { AxisRole } from '@/core/document/schema';
import { suppressTuplesCommand } from '@/core/versioning/axis-commands';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

/**
 * Inspector de célula(s) — docs/07-ux-e-editor.md §6.2, docs/05 §2.
 *
 * Um único formulário serve os dois casos (1 célula ou N): o cabeçalho e a
 * semântica de placeholder mudam, o resto é igual. A peça delicada é o
 * `Set<string>` de campos tocados: o valor inicial de um campo divergente é
 * sintético (`undefined`, mostrado como "— vários —"), então `dirtyFields` do
 * formulário não bastaria para saber se o usuário mexeu ou não.
 */

const DIVERGENT_PLACEHOLDER = '— vários —';

function readablePath(axisView: EditorAxisView, path: string): string {
  return decodePath(path)
    .map((code, level) => axisView.axis.levels[level]?.domains.find((d) => d.code === code)?.label ?? code)
    .join(' › ');
}

function catalogOptions(items: CatalogItem[]): ComboboxOption[] {
  return items.map((item) => ({ value: item.code, label: item.label }));
}

/** Os 5 códigos de catálogo mais usados nas células desta versão, por kind. */
function topUsed(cells: Record<string, Cell>, field: 'decision' | 'offer', limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const cell of Object.values(cells)) {
    const code = cell[field];
    if (code === undefined) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([code]) => code);
}

interface FieldRowProps {
  label: string;
  touched: boolean;
  onClear: () => void;
  disabled: boolean;
  children: React.ReactNode;
}

function FieldRow({ label, touched, onClear, disabled, children }: FieldRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{label}</Label>
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="text-[11px] text-neutral-400 underline-offset-2 hover:text-neutral-700 hover:underline disabled:pointer-events-none disabled:opacity-40 dark:hover:text-neutral-200"
        >
          Limpar
        </button>
      </div>
      {children}
      {touched && <span className="text-[10px] text-blue-600 dark:text-blue-400">alterado nesta edição</span>}
    </div>
  );
}

export function CellInspector({ selection }: { selection: ReadonlySet<string> }) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const currentVersionId = useEditorStore((s) => s.currentVersionId);
  const isEditable = useEditorStore((s) => s.isEditable);
  const clearSelection = useEditorStore((s) => s.clear);
  const { toast } = useToast();

  const [touched, setTouched] = useState<Set<TouchedFieldKey>>(new Set());
  const [values, setValues] = useState<CellFormValues>({});

  const selectionSignature = [...selection].sort().join(',');
  // Trocar a seleção esvazia o que o usuário tinha tocado — é um formulário novo.
  useEffect(() => {
    setTouched(new Set());
    setValues({});
  }, [selectionSignature]);

  const view: EditorView | null = useMemo(
    () => (document === null || currentVersionId === null ? null : getEditorView(document, currentVersionId)),
    [document, currentVersionId],
  );

  if (view === null || currentVersionId === null || selection.size === 0) return null;
  const versionId = currentVersionId;

  const coords: PatchCoord[] = [...selection].map(decodeCellKey);
  const cells = coords.map((coord) => view.cells[encodeCellKey(coord.xPath, coord.yPath)]);
  const isSingle = coords.length === 1;

  const fieldStates = Object.fromEntries(
    CELL_FIELDS.map((field) => [field, computeFieldState(cells, field)]),
  ) as Record<CellField, ReturnType<typeof computeFieldState>>;

  function markTouched(field: TouchedFieldKey, value: string | null) {
    setTouched((prev) => new Set(prev).add(field));
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function clearField(field: TouchedFieldKey) {
    markTouched(field, null);
  }

  function displayValue(field: CellField): string {
    if (touched.has(field)) return values[field] ?? '';
    const state = fieldStates[field];
    return state.kind === 'uniform' ? state.value : '';
  }

  function placeholderFor(field: CellField): string | undefined {
    if (touched.has(field)) return undefined;
    return fieldStates[field].kind === 'divergent' ? DIVERGENT_PLACEHOLDER : undefined;
  }

  function applyQuickPatch(set: Partial<Record<CellField, string | null>>) {
    const result = dispatch(applyCellPatch({ versionId, patch: { coords, set } }));
    if (result.ok) {
      setTouched(new Set());
      setValues({});
    }
  }

  function handleApply() {
    const patch = buildPatchFromForm(touched, values, coords);
    if (patch === null) return;
    const result = dispatch(applyCellPatch({ versionId, patch }));
    if (result.ok) {
      setTouched(new Set());
      setValues({});
    }
  }

  // Supressão manual (docs/07 §8): só faz sentido para uma tupla **inteira** —
  // uma linha ou uma coluna do grid selecionada por completo. Meia linha não é
  // "esta combinação não existe", é uma seleção qualquer.
  function fullySelectedTuples(role: AxisRole): string[] {
    const own = role === 'X' ? view!.x.axis.tuples : view!.y.axis.tuples;
    const other = role === 'X' ? view!.y.axis.tuples : view!.x.axis.tuples;
    return own.filter((path) =>
      other.every((otherPath) =>
        selection.has(role === 'X' ? encodeCellKey(path, otherPath) : encodeCellKey(otherPath, path)),
      ),
    );
  }

  const suppressableY = fullySelectedTuples('Y');
  const suppressableX = suppressableY.length > 0 ? [] : fullySelectedTuples('X');
  const suppressRole: AxisRole = suppressableY.length > 0 ? 'Y' : 'X';
  const suppressPaths = suppressableY.length > 0 ? suppressableY : suppressableX;

  function suppressSelected() {
    const result = dispatch(suppressTuplesCommand({ versionId, role: suppressRole, paths: suppressPaths }));
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível marcar como inexistente',
        description: result.error.message,
      });
      return;
    }
    clearSelection();
    toast({
      title:
        suppressPaths.length === 1
          ? '1 combinação marcada como inexistente'
          : `${suppressPaths.length} combinações marcadas como inexistentes`,
      description:
        'Elas somem do grid e deixam de contar como pendentes. Se o padrão se repetir, considere criar uma regra de compatibilidade na biblioteca.',
    });
  }

  const decisionOptions = catalogOptions(view.catalog.decisions);
  const offerOptions = catalogOptions(view.catalog.offers);
  const limitOptions = catalogOptions(view.catalog.limits);

  const topOffers = topUsed(view.cells, 'offer');
  const topOfferItems = topOffers
    .map((code) => view.catalog.byCode.OFFER[code])
    .filter((item): item is CatalogItem => item !== undefined);

  const decisionByCode = view.catalog.byCode.DECISION;
  const quickApprove = Object.values(decisionByCode).find((item) => item.code === 'APROVADO');
  const quickReject = Object.values(decisionByCode).find((item) => item.code === 'REPROVADO');
  const quickManual = Object.values(decisionByCode).find((item) => item.code === 'ANALISE_MANUAL');

  const summaryParts: string[] = [];
  for (const field of touched) {
    if (field === 'attrs') continue;
    const value = values[field as CellField];
    const label = FIELD_TITLE[field as CellField];
    const itemLabel =
      value === null || value === undefined
        ? '(vazio)'
        : (field === 'decision'
            ? view.catalog.byCode.DECISION[value]?.label
            : field === 'offer'
              ? view.catalog.byCode.OFFER[value]?.label
              : field === 'limit'
                ? view.catalog.byCode.LIMIT[value]?.label
                : value) ?? value;
    summaryParts.push(`${label} → ${itemLabel}`);
  }

  const header = isSingle
    ? `${readablePath(view.y, coords[0]!.yPath)} × ${readablePath(view.x, coords[0]!.xPath)}`
    : `${coords.length} células`;

  const disabled = !isEditable;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4" tabIndex={0} data-testid="cell-inspector">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{header}</h2>
        {!isSingle && <p className="text-xs text-neutral-500 dark:text-neutral-400">seleção múltipla</p>}
      </div>

      {disabled && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          Esta versão está publicada e não pode ser editada. Crie um rascunho para alterá-la.
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Ações rápidas</span>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled || quickApprove === undefined}
            onClick={() => applyQuickPatch({ decision: quickApprove!.code })}
          >
            Aprovar tudo
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled || quickReject === undefined}
            onClick={() => applyQuickPatch({ decision: quickReject!.code })}
          >
            Reprovar tudo
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled || quickManual === undefined}
            onClick={() => applyQuickPatch({ decision: quickManual!.code })}
          >
            Análise manual
          </Button>
        </div>
        {topOfferItems.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {topOfferItems.map((item) => (
              <Button
                key={item.code}
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => applyQuickPatch({ offer: item.code })}
              >
                {item.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Estrutura</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || suppressPaths.length === 0}
          onClick={suppressSelected}
        >
          Marcar como inexistente
        </Button>
        {suppressPaths.length === 0 && (
          <span className="text-[11px] text-neutral-400">
            Selecione linhas ou colunas inteiras para marcá-las como inexistentes.
          </span>
        )}
      </div>

      <FieldRow label="Decisão" touched={touched.has('decision')} onClear={() => clearField('decision')} disabled={disabled}>
        <Select
          value={displayValue('decision') || undefined}
          onValueChange={(value) => markTouched('decision', value)}
          disabled={disabled}
        >
          <SelectTrigger aria-label="Decisão">
            <SelectValue placeholder={placeholderFor('decision') ?? 'Selecione…'} />
          </SelectTrigger>
          <SelectContent>
            {decisionOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>

      <FieldRow label="Oferta" touched={touched.has('offer')} onClear={() => clearField('offer')} disabled={disabled}>
        <Combobox
          options={offerOptions}
          value={displayValue('offer') || undefined}
          onChange={(value) => markTouched('offer', value)}
          placeholder={placeholderFor('offer') ?? 'Selecione…'}
          disabled={disabled}
          aria-label="Oferta"
        />
      </FieldRow>

      <FieldRow label="Limite" touched={touched.has('limit')} onClear={() => clearField('limit')} disabled={disabled}>
        <div className="flex flex-col gap-1.5">
          <Combobox
            options={limitOptions}
            value={displayValue('limit') || undefined}
            onChange={(value) => markTouched('limit', value)}
            placeholder={placeholderFor('limit') ?? 'Selecione…'}
            disabled={disabled}
            aria-label="Limite"
          />
          <Input
            placeholder={placeholderFor('limitOverride') ?? 'Valor específico (BRL)'}
            value={displayValue('limitOverride')}
            disabled={disabled}
            onChange={(event) => markTouched('limitOverride', event.target.value || null)}
          />
        </div>
      </FieldRow>

      <FieldRow label="Cor" touched={touched.has('color')} onClear={() => clearField('color')} disabled={disabled}>
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            aria-label="Cor da célula"
            disabled={disabled}
            value={displayValue('color') || '#e5e7eb'}
            onChange={(event) => markTouched('color', event.target.value)}
            className="h-8 w-10 rounded border border-neutral-300 dark:border-neutral-700"
          />
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => clearField('color')}>
            usar cor da decisão
          </Button>
        </div>
      </FieldRow>

      <FieldRow label="Observação" touched={touched.has('note')} onClear={() => clearField('note')} disabled={disabled}>
        <Textarea
          placeholder={placeholderFor('note') ?? 'Observação…'}
          value={displayValue('note')}
          disabled={disabled}
          onChange={(event) => markTouched('note', event.target.value || null)}
        />
      </FieldRow>

      <div className="mt-auto flex flex-col gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
        {summaryParts.length > 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{summaryParts.join('; ')}</p>
        )}
        <Button
          type="button"
          onClick={handleApply}
          disabled={disabled || touched.size === 0}
          className="w-full"
        >
          Aplicar a {coords.length === 1 ? '1 célula' : `${coords.length} células`}
        </Button>
      </div>
    </div>
  );
}

const FIELD_TITLE: Record<CellField, string> = {
  decision: 'decisão',
  offer: 'oferta',
  limit: 'limite',
  limitOverride: 'valor específico',
  color: 'cor',
  note: 'observação',
};
