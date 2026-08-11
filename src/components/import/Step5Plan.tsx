import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { summaryToText } from '@/core/diff/semantics';
import type { ImportTable } from '@/core/import/parse-table';
import { planImport, type MatrixPlan, type MatrixPlanStatus } from '@/core/import/plan';
import type { DocumentWithProfiles } from '@/core/import/profile';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';
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

function MatrixRow({ plan }: { plan: MatrixPlan }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = plan.changes.length > 0;
  const phrases = summaryToText(plan.summary);

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800">
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left disabled:cursor-default"
      >
        <div className="flex min-w-0 items-center gap-2">
          {canExpand ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <Badge variant={STATUS_VARIANT[plan.status]}>{STATUS_LABEL[plan.status]}</Badge>
          <span className="truncate font-mono text-xs text-neutral-500 dark:text-neutral-400">{plan.code}</span>
          <span className="truncate text-sm text-neutral-900 dark:text-neutral-100">{plan.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          {plan.reason !== undefined && <span className="text-red-600 dark:text-red-400">{plan.reason}</span>}
          {plan.changes.length > 0 && <span>{plan.changes.length} células</span>}
          {phrases.length > 0 && <span>{phrases.slice(0, 2).join(' · ')}</span>}
        </div>
      </button>
      {expanded && <Step5MatrixDiffPanel changes={plan.changes} />}
    </div>
  );
}

/** Passo 5 — plano, somente leitura. docs/12-carga-de-matrizes.md US-05, §5.5, §6.1. */
export function Step5Plan({ table }: { table: ImportTable }) {
  const document = useDocumentStore((s) => s.document);
  const profile = useImportStore((s) => s.profile);
  const fileName = useImportStore((s) => s.fileName);
  const [showUnchanged, setShowUnchanged] = useState(false);

  const plan = useMemo(() => {
    if (document === null) return undefined;
    return planImport(document as DocumentWithProfiles, table, profile, { fileName });
  }, [document, table, profile, fileName]);

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

  const visible = showUnchanged ? plan.matrices : plan.matrices.filter((m) => m.status !== 'UNCHANGED');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="green">{plan.totals.new} novas</Badge>
        <Badge variant="amber">{plan.totals.changed} alteradas</Badge>
        <Badge variant="secondary">{plan.totals.unchanged} inalteradas</Badge>
        {plan.totals.structural > 0 && <Badge variant="outline">{plan.totals.structural} divergentes</Badge>}
        {plan.totals.absentInFile > 0 && <Badge variant="outline">{plan.totals.absentInFile} ausentes</Badge>}
        {plan.totals.blocked > 0 && <Badge variant="outline">{plan.totals.blocked} bloqueadas</Badge>}
        <span className="text-neutral-500 dark:text-neutral-400">{plan.totals.cellsChanged} células no total</span>
      </div>

      {plan.totals.unchanged > 0 && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setShowUnchanged((v) => !v)}>
          {showUnchanged ? 'Ocultar inalteradas' : `Mostrar ${plan.totals.unchanged} inalteradas`}
        </Button>
      )}

      <div className="flex flex-col gap-2">
        {visible.map((plan_) => (
          <MatrixRow key={plan_.key} plan={plan_} />
        ))}
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-400">A aplicação da carga chega na próxima sessão.</p>
    </div>
  );
}
