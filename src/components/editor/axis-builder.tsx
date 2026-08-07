import { useEffect, useMemo, useState } from 'react';
import { GripVertical, Plus, TriangleAlert, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { computeHeaderLayout } from '@/core/axes/header-layout';
import {
  collectPublishedCompatibility,
  generateTuples,
  LARGE_GRID_THRESHOLD,
  MAX_AXIS_LEVELS,
  MAX_COMBINATIONS,
  type TupleWarning,
} from '@/core/axes/tuples';
import type { Axis, AxisLevel, AxisRole, Domain, PolicyOpsDocument } from '@/core/document/schema';
import { DomainError } from '@/core/errors';
import { countAllowedCombinations, getApplicableRule } from '@/core/queries';
import { useUiStore } from '@/store/ui-store';

/**
 * Construtor de eixos — docs/07-ux-e-editor.md §7. Reutilizado na criação da
 * matriz (S09) e no inspector (S12): recebe e devolve só uma lista ordenada
 * de `variableId`, e não conhece nenhum comando — quem grava é o chamador.
 */

export type AxisPreview = {
  tupleCount: number;
  warnings: TupleWarning[];
  /** Erro bloqueante (`NO_VALID_TUPLES`/`GRID_TOO_LARGE`) — mensagem já em pt-BR. */
  error: string | null;
};

export interface AxisBuilderProps {
  role: AxisRole;
  title: string;
  doc: PolicyOpsDocument;
  /** `variableId` de cada nível, na ordem de exibição — nível 0 primeiro. */
  variableIds: string[];
  onChange: (variableIds: string[]) => void;
  /** Variáveis já usadas no outro eixo — nunca aparecem no combobox deste. */
  excludedVariableIds: string[];
  onPreviewChange?: (preview: AxisPreview) => void;
}

type EligibleVariable = { id: string; code: string; name: string; domains: Domain[] };

function publishedDomains(doc: PolicyOpsDocument, variableId: string): Domain[] {
  const variable = doc.variables.find((candidate) => candidate.id === variableId);
  const published = variable?.versions.find((candidate) => candidate.state === 'PUBLISHED');
  return published?.domains ?? [];
}

function eligibleVariables(doc: PolicyOpsDocument, excluded: Set<string>): EligibleVariable[] {
  return doc.variables
    .filter((variable) => variable.archivedAt === undefined)
    .filter((variable) => variable.versions.some((version) => version.state === 'PUBLISHED'))
    .filter((variable) => !excluded.has(variable.id))
    .map((variable) => ({
      id: variable.id,
      code: variable.code,
      name: variable.name,
      domains: publishedDomains(doc, variable.id),
    }));
}

function buildPreviewAxis(
  role: AxisRole,
  levels: Array<{ variableId: string; label: string; domains: Domain[] }>,
  doc: PolicyOpsDocument,
): { axis: Axis | null; warnings: TupleWarning[]; error: string | null } {
  if (levels.length === 0) return { axis: null, warnings: [], error: null };
  try {
    const { tuples, warnings } = generateTuples({
      levels: levels.map((level) => ({ variableId: level.variableId, domains: level.domains })),
      compatibility: collectPublishedCompatibility(doc.compatibility),
    });
    const axisLevels: AxisLevel[] = levels.map((level) => ({
      id: level.variableId,
      variableId: level.variableId,
      variableVersionId: level.variableId,
      label: level.label,
      domains: level.domains,
    }));
    return {
      axis: { role, levels: axisLevels, tuples, derivedFrom: { compatibilityVersionIds: [] } },
      warnings,
      error: null,
    };
  } catch (error) {
    if (error instanceof DomainError) return { axis: null, warnings: [], error: error.message };
    throw error;
  }
}

function PairCompatibility({
  doc,
  parentVariableId,
  childVariableId,
}: {
  doc: PolicyOpsDocument;
  parentVariableId: string;
  childVariableId: string;
}) {
  const setView = useUiStore((s) => s.setView);
  const applicable = getApplicableRule(doc, parentVariableId, childVariableId);
  const parentDomains = publishedDomains(doc, parentVariableId);
  const childDomains = publishedDomains(doc, childVariableId);

  if (applicable === null) {
    const total = parentDomains.length * childDomains.length;
    return (
      <div className="flex items-center gap-2 py-1 pl-6 text-xs text-neutral-500 dark:text-neutral-400">
        <span>
          Sem regra — todas as {total} combinaç{total === 1 ? 'ão' : 'ões'}
        </span>
        <button
          type="button"
          className="text-blue-600 underline underline-offset-2 dark:text-blue-400"
          onClick={() => setView('library-compatibility')}
        >
          criar regra
        </button>
      </div>
    );
  }

  const { valid, total } = countAllowedCombinations(applicable.version, parentDomains, childDomains);
  return (
    <div className="flex items-center gap-2 py-1 pl-6 text-xs text-neutral-500 dark:text-neutral-400">
      <span>
        Regra "{applicable.rule.name}" aplicada — {valid} de {total} combinações válidas
      </span>
      <button
        type="button"
        className="text-blue-600 underline underline-offset-2 dark:text-blue-400"
        onClick={() => setView('library-compatibility')}
      >
        ver na biblioteca
      </button>
    </div>
  );
}

export function AxisBuilder({
  role,
  title,
  doc,
  variableIds,
  onChange,
  excludedVariableIds,
  onPreviewChange,
}: AxisBuilderProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const levels = useMemo(
    () =>
      variableIds.map((variableId) => {
        const variable = doc.variables.find((candidate) => candidate.id === variableId);
        return {
          variableId,
          label: variable?.name ?? variableId,
          code: variable?.code ?? '?',
          domains: publishedDomains(doc, variableId),
        };
      }),
    [variableIds, doc],
  );

  const excluded = useMemo(
    () => new Set([...excludedVariableIds, ...variableIds]),
    [excludedVariableIds, variableIds],
  );
  const options: ComboboxOption[] = useMemo(
    () =>
      eligibleVariables(doc, excluded).map((variable) => ({
        value: variable.id,
        label: `${variable.name} (${variable.code})`,
      })),
    [doc, excluded],
  );

  const preview = useMemo(() => buildPreviewAxis(role, levels, doc), [role, levels, doc]);
  const headerRows = useMemo(
    () => (preview.axis === null ? [] : computeHeaderLayout(preview.axis)),
    [preview.axis],
  );

  useEffect(() => {
    onPreviewChange?.({
      tupleCount: preview.axis?.tuples.length ?? 0,
      warnings: preview.warnings,
      error: preview.error,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onPreviewChange normalmente muda a cada render do pai
  }, [preview]);

  function move(from: number, to: number) {
    if (from === to) return;
    const next = [...variableIds];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  }

  function removeAt(index: number) {
    onChange(variableIds.filter((_, i) => i !== index));
  }

  const largeGridWarning = preview.warnings.find((w) => w.code === 'LARGE_GRID');
  const otherWarnings = preview.warnings.filter((w) => w.code !== 'LARGE_GRID');

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
        <span className="text-xs text-neutral-400">
          {variableIds.length} de {MAX_AXIS_LEVELS} níveis
        </span>
      </div>

      {levels.length === 0 && (
        <p className="rounded-md bg-neutral-50 p-2 text-xs text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
          Nenhum nível ainda. Adicione ao menos um.
        </p>
      )}

      <ul className="flex flex-col">
        {levels.map((level, index) => (
          <li key={level.variableId}>
            <div
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex !== null) move(dragIndex, index);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white p-2 text-sm dark:border-neutral-800 dark:bg-neutral-900"
            >
              <GripVertical
                className="h-4 w-4 shrink-0 cursor-grab text-neutral-400"
                aria-label={`Arrastar para reordenar ${level.label}`}
              />
              <span className="flex-1 truncate">
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  Nível {index}: {level.label}
                </span>
                <span className="ml-1.5 text-xs text-neutral-400">
                  {level.domains.length} domínio{level.domains.length === 1 ? '' : 's'}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover nível ${level.label}`}
                onClick={() => removeAt(index)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {index < levels.length - 1 && (
              <PairCompatibility
                doc={doc}
                parentVariableId={level.variableId}
                childVariableId={levels[index + 1]!.variableId}
              />
            )}
          </li>
        ))}
      </ul>

      {variableIds.length < MAX_AXIS_LEVELS &&
        (addOpen ? (
          <div className="flex items-center gap-2">
            <Combobox
              options={options}
              placeholder="Escolha uma variável…"
              emptyText="Nenhuma variável publicada disponível."
              aria-label="Escolha uma variável"
              onChange={(value) => {
                onChange([...variableIds, value]);
                setAddOpen(false);
              }}
            />
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Adicionar nível
          </Button>
        ))}

      <div className="mt-1 flex flex-col gap-1.5 border-t border-neutral-100 pt-2 dark:border-neutral-800">
        {preview.error !== null && (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>{preview.error}</AlertDescription>
          </Alert>
        )}
        {preview.error === null && preview.axis !== null && (
          <>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {preview.axis.tuples.length} combinaç{preview.axis.tuples.length === 1 ? 'ão' : 'ões'} neste
              eixo
            </p>
            {headerRows.length > 0 && headerRows[0]!.cells.length > 1 && (
              <div className="flex flex-wrap gap-1">
                {headerRows[0]!.cells.map((cell) => (
                  <Badge key={cell.path} variant="secondary" className="font-normal">
                    {cell.label} ({cell.span})
                  </Badge>
                ))}
              </div>
            )}
            {largeGridWarning !== undefined && (
              <Alert>
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription>{largeGridWarning.message}</AlertDescription>
              </Alert>
            )}
            {otherWarnings.map((warning, index) => (
              <p key={index} className="text-xs text-amber-700 dark:text-amber-400">
                {warning.message}
              </p>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export { MAX_COMBINATIONS as AXIS_BUILDER_MAX_COMBINATIONS, LARGE_GRID_THRESHOLD as AXIS_BUILDER_LARGE_GRID_THRESHOLD };
