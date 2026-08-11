import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { CompareView } from '@/components/compare/CompareView';
import { summaryToText } from '@/core/diff/semantics';
import type { ImportTable } from '@/core/import/parse-table';
import { planImport, type ImportPlan, type MatrixPlan, type MatrixPlanStatus } from '@/core/import/plan';
import type { DocumentWithProfiles } from '@/core/import/profile';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';
import { buildPlanPreview, isApplicable } from './plan-preview';
import { Step5MatrixDiffPanel } from './Step5MatrixDiffPanel';

const STATUS_LABEL: Record<MatrixPlanStatus, string> = {
  NEW: 'Nova',
  CHANGED: 'Alterada',
  UNCHANGED: 'Inalterada',
  STRUCTURAL: 'Estrutura divergente',
  ABSENT_IN_FILE: 'Ausente no arquivo',
  BLOCKED: 'Bloqueada',
};

const STATUS_VARIANT: Record<MatrixPlanStatus, BadgeVariant> = {
  NEW: 'green',
  CHANGED: 'amber',
  UNCHANGED: 'secondary',
  STRUCTURAL: 'outline',
  ABSENT_IN_FILE: 'outline',
  BLOCKED: 'outline',
};

/** O que fazer com uma matriz que a carga não aplica (§5.5). */
const STATUS_ACTION: Partial<Record<MatrixPlanStatus, string>> = {
  STRUCTURAL: 'Atualize a variável e o eixo desta matriz antes de recarregá-la.',
  BLOCKED: 'Resolva o motivo acima antes de recarregar esta matriz.',
  ABSENT_IN_FILE: 'Nada a fazer: o arquivo não traz esta matriz, e a carga não a toca.',
};

type SortMode = 'CELLS' | 'CODE';

// ---------------------------------------------------------------------------

function MatrixRow({
  plan,
  selected,
  onToggle,
  onOpenDiff,
}: {
  plan: MatrixPlan;
  selected: boolean;
  onToggle: () => void;
  onOpenDiff: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const applicable = isApplicable(plan);
  const phrases = summaryToText(plan.summary);

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center gap-2 p-3">
        <Checkbox
          checked={selected}
          disabled={!applicable}
          onCheckedChange={onToggle}
          aria-label={`Selecionar ${plan.code}`}
          data-testid={`plan-select-${plan.code}`}
        />
        <button
          type="button"
          disabled={plan.changes.length === 0}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          {plan.changes.length > 0 ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <Badge variant={STATUS_VARIANT[plan.status]}>{STATUS_LABEL[plan.status]}</Badge>
          <span className="truncate font-mono text-xs text-neutral-500 dark:text-neutral-400">
            {plan.code}
          </span>
          <span className="truncate text-sm text-neutral-900 dark:text-neutral-100">{plan.name}</span>
        </button>
        <div className="flex shrink-0 items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          {plan.changes.length > 0 && <span>{plan.changes.length} células</span>}
          {phrases.length > 0 && <span>{phrases.slice(0, 2).join(' · ')}</span>}
          {applicable && (
            <Button type="button" variant="outline" size="sm" onClick={onOpenDiff}>
              Ver diff
            </Button>
          )}
        </div>
      </div>

      {(plan.reason !== undefined || STATUS_ACTION[plan.status] !== undefined) && (
        <div className="border-t border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
          {plan.reason !== undefined && (
            <p className="text-red-600 dark:text-red-400">{plan.reason}</p>
          )}
          {STATUS_ACTION[plan.status] !== undefined && (
            <p className="text-neutral-500 dark:text-neutral-400">{STATUS_ACTION[plan.status]}</p>
          )}
        </div>
      )}

      {expanded && <Step5MatrixDiffPanel changes={plan.changes} />}
    </div>
  );
}

/** O `CompareView` de §9 dentro de um painel do assistente (DEC-CARGA-015). */
function DiffPanel({ plan, onClose }: { plan: MatrixPlan; onClose: () => void }) {
  const document = useDocumentStore((s) => s.document);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const preview = useMemo(
    () => (document === null ? null : buildPlanPreview(document, plan)),
    [document, plan],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="plan-diff-panel">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {plan.name}
          </p>
          <p className="truncate font-mono text-xs text-neutral-500 dark:text-neutral-400">
            {plan.code}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Fechar diff" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      {preview === null ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Esta matriz não tem duas versões para comparar.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <CompareView
            diff={preview.diff}
            aView={preview.beforeView}
            bView={preview.afterView}
            aLabel={preview.beforeLabel}
            bLabel={preview.afterLabel}
            inlineDetail
            selectedKey={selectedKey}
            onSelectKey={setSelectedKey}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Passo 5 — o plano interativo. docs/12-carga-de-matrizes.md US-05, §5.5, §6.1. */
export function Step5Plan({ table }: { table: ImportTable }) {
  const document = useDocumentStore((s) => s.document);
  const profile = useImportStore((s) => s.profile);
  const fileName = useImportStore((s) => s.fileName);
  const storedSelection = useImportStore((s) => s.selectedKeys);
  const setSelectedKeys = useImportStore((s) => s.setSelectedKeys);
  const toggleKey = useImportStore((s) => s.toggleKey);

  const [showUnchanged, setShowUnchanged] = useState(false);
  const [statusFilter, setStatusFilter] = useState<MatrixPlanStatus | 'ALL'>('ALL');
  const [tagFilter, setTagFilter] = useState<string | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('CELLS');
  const [diffKey, setDiffKey] = useState<string | null>(null);

  const plan: ImportPlan | undefined = useMemo(() => {
    if (document === null) return undefined;
    return planImport(document as DocumentWithProfiles, table, profile, { fileName });
  }, [document, table, profile, fileName]);

  // Sem seleção explícita, tudo o que é aplicável entra marcado — o caminho
  // comum da carga é "aplicar o que o plano encontrou".
  const selection = useMemo(() => {
    if (storedSelection !== undefined) return new Set(storedSelection);
    return new Set((plan?.matrices ?? []).filter(isApplicable).map((entry) => entry.key));
  }, [storedSelection, plan]);

  const tags = useMemo(() => {
    const found = new Set<string>();
    for (const entry of plan?.matrices ?? []) for (const tag of entry.tags) found.add(tag);
    return [...found].sort();
  }, [plan]);

  const visible = useMemo(() => {
    const term = search.trim().toUpperCase();
    const rows = (plan?.matrices ?? []).filter((entry) => {
      if (statusFilter !== 'ALL' && entry.status !== statusFilter) return false;
      if (statusFilter === 'ALL' && entry.status === 'UNCHANGED' && !showUnchanged) return false;
      if (tagFilter !== 'ALL' && !entry.tags.includes(tagFilter)) return false;
      if (term !== '' && !entry.code.toUpperCase().includes(term)) return false;
      return true;
    });
    return rows.sort((a, b) =>
      sort === 'CODE'
        ? a.code.localeCompare(b.code)
        : b.changes.length - a.changes.length || a.code.localeCompare(b.code),
    );
  }, [plan, statusFilter, tagFilter, search, sort, showUnchanged]);

  if (document === null || plan === undefined) return null;

  if (plan.matrices.length === 0 && plan.issues.length > 0) {
    return (
      <Card className="border-red-300 dark:border-red-900">
        <CardContent className="flex flex-col gap-2 p-4">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            O plano está bloqueado — resolva os problemas abaixo e volte a este passo.
          </p>
          <ul className="flex flex-col gap-1 text-xs text-red-600 dark:text-red-400">
            {plan.issues.map((issue, index) => (
              <li key={index}>
                {issue.line !== undefined && `Linha ${issue.line}: `}
                {issue.column !== undefined && `[${issue.column}] `}
                {issue.message}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  const applicable = plan.matrices.filter(isApplicable);
  const selectedCount = applicable.filter((entry) => selection.has(entry.key)).length;

  function selectByStatus(status: MatrixPlanStatus, checked: boolean): void {
    const keys = applicable.filter((entry) => entry.status === status).map((entry) => entry.key);
    const next = new Set(selection);
    for (const key of keys) {
      if (checked) next.add(key);
      else next.delete(key);
    }
    setSelectedKeys([...next]);
  }

  const openDiff = diffKey === null ? null : (plan.matrices.find((e) => e.key === diffKey) ?? null);
  if (openDiff !== null) {
    return <DiffPanel plan={openDiff} onClose={() => setDiffKey(null)} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="green">{plan.totals.new} novas</Badge>
        <Badge variant="amber">{plan.totals.changed} alteradas</Badge>
        <Badge variant="secondary">{plan.totals.unchanged} inalteradas</Badge>
        {plan.totals.structural > 0 && (
          <Badge variant="outline">{plan.totals.structural} divergentes</Badge>
        )}
        {plan.totals.absentInFile > 0 && (
          <Badge variant="outline">{plan.totals.absentInFile} ausentes</Badge>
        )}
        {plan.totals.blocked > 0 && <Badge variant="outline">{plan.totals.blocked} bloqueadas</Badge>}
        <span className="text-neutral-500 dark:text-neutral-400">
          {plan.totals.cellsChanged} células no total
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por código"
          aria-label="Buscar por código"
          className="w-56"
        />
        <select
          aria-label="Filtrar por estado"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as MatrixPlanStatus | 'ALL')}
          className="h-9 rounded-md border border-neutral-200 bg-transparent px-2 text-sm dark:border-neutral-800"
        >
          <option value="ALL">Todos os estados</option>
          {(Object.keys(STATUS_LABEL) as MatrixPlanStatus[]).map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </select>
        {tags.length > 0 && (
          <select
            aria-label="Filtrar por tag"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            className="h-9 rounded-md border border-neutral-200 bg-transparent px-2 text-sm dark:border-neutral-800"
          >
            <option value="ALL">Todas as tags</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Ordenar"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortMode)}
          className="h-9 rounded-md border border-neutral-200 bg-transparent px-2 text-sm dark:border-neutral-800"
        >
          <option value="CELLS">Mais células alteradas</option>
          <option value="CODE">Código</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-neutral-500 dark:text-neutral-400">Selecionar em massa:</span>
        {(['NEW', 'CHANGED'] as const).map((status) => {
          const total = applicable.filter((entry) => entry.status === status).length;
          if (total === 0) return null;
          return (
            <span key={status} className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid={`plan-select-all-${status}`}
                onClick={() => selectByStatus(status, true)}
              >
                Marcar {total} {STATUS_LABEL[status].toLowerCase()}s
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => selectByStatus(status, false)}
              >
                Desmarcar
              </Button>
            </span>
          );
        })}
        <span className="ml-auto text-neutral-500 dark:text-neutral-400" data-testid="plan-selected-count">
          {selectedCount} de {applicable.length} selecionadas
        </span>
      </div>

      {plan.totals.unchanged > 0 && statusFilter === 'ALL' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setShowUnchanged((value) => !value)}
        >
          {showUnchanged
            ? 'Ocultar inalteradas'
            : `Mostrar ${plan.totals.unchanged} inalteradas`}
        </Button>
      )}

      <div className="flex flex-col gap-2">
        {visible.map((entry) => (
          <MatrixRow
            key={entry.key}
            plan={entry}
            selected={selection.has(entry.key)}
            onToggle={() => {
              if (storedSelection === undefined) setSelectedKeys([...selection]);
              toggleKey(entry.key);
            }}
            onOpenDiff={() => setDiffKey(entry.key)}
          />
        ))}
        {visible.length === 0 && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Nenhuma matriz corresponde aos filtros.
          </p>
        )}
      </div>
    </div>
  );
}
