import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, TriangleAlert, Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import type { PolicyComponentType } from '@/core/document/schema';
import { getErrorMessage } from '@/core/error-messages';
import { applyMarkdownImport } from '@/core/import/markdown-apply';
import { parseMarkdownPolicy } from '@/core/import/markdown-policy';
import { planMarkdownImport, type MarkdownImportRow } from '@/core/import/markdown-plan';
import { componentPath } from '@/core/queries';
import { useRoleGate } from '@/hooks/useRole';
import { COMPONENT_TYPE_LABELS } from '@/lib/component-labels';
import { dateInputToIso, dateInputValue, isoToDateInputValue } from '@/lib/format';
import { readImportFile } from '@/storage/import-file';
import { useDocumentStore } from '@/store/document-store';
import { cn } from '@/lib/utils';

const ROOT_VALUE = '__ROOT__';
const ROW_TYPES: readonly PolicyComponentType[] = ['SECTION', 'RULE', 'LIST', 'REASON_CODE', 'POLICY_VARIABLE', 'OTHER'];

export interface MarkdownImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Pré-seleciona o destino quando aberto a partir de "Carregar Markdown aqui…" num nó. */
  initialParentId?: string;
  /** `Project.foundationEffectiveFrom` (RN-GOV-09) — sugestão de vigência da carga. */
  foundationEffectiveFrom?: string;
  onImported: (count: number) => void;
}

type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, string> = { 1: 'Destino e texto', 2: 'Revisão', 3: 'Confirmação' };

/**
 * Carga da política por recorte — docs/14-governanca-de-alteracoes.md §9,
 * docs/prompts/S40-carga-de-componentes.md. Três passos, padrão visual do
 * assistente de carga de matrizes (`src/components/import/`): destino +
 * arquivo/colar texto → revisão da árvore proposta (tipo editável por linha,
 * excluir itens, avisos de heurística, duplicata de `code` bloqueia com
 * E-GOV-06) → confirmação com `effectiveFrom` da carga e resumo. Nada entra
 * sem passar pelo passo 2; a aplicação é um lote atômico com undo total
 * (`component/importMarkdown`, CT-GOV-05).
 */
export function MarkdownImportDialog({
  open,
  onOpenChange,
  projectId,
  initialParentId,
  foundationEffectiveFrom,
  onImported,
}: MarkdownImportDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const roleGate = useRoleGate('component/importMarkdown');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [parentId, setParentId] = useState<string>(initialParentId ?? ROOT_VALUE);
  const [rawText, setRawText] = useState('');
  const [excludedTempIds, setExcludedTempIds] = useState<Set<string>>(new Set());
  const [typeOverrides, setTypeOverrides] = useState<Map<string, PolicyComponentType>>(new Map());
  const defaultDate = useMemo(
    () => (foundationEffectiveFrom !== undefined ? isoToDateInputValue(foundationEffectiveFrom) : dateInputValue(new Date())),
    [foundationEffectiveFrom],
  );
  const [effectiveFrom, setEffectiveFrom] = useState(defaultDate);
  const [report, setReport] = useState<{ count: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setParentId(initialParentId ?? ROOT_VALUE);
    setRawText('');
    setExcludedTempIds(new Set());
    setTypeOverrides(new Map());
    setEffectiveFrom(defaultDate);
    setReport(null);
  }, [open, initialParentId, defaultDate]);

  const destinationOptions = useMemo<ComboboxOption[]>(() => {
    if (document === null) return [{ value: ROOT_VALUE, label: 'Raiz da política' }];
    return [
      { value: ROOT_VALUE, label: 'Raiz da política' },
      ...document.components
        .filter((candidate) => candidate.projectId === projectId && candidate.archivedAt === undefined && candidate.type !== 'MATRIX')
        .map((candidate) => ({
          value: candidate.id,
          label: componentPath(document, candidate.id)
            .map((node) => node.name)
            .join(' › '),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [document, projectId]);

  const parsed = useMemo(() => parseMarkdownPolicy(rawText), [rawText]);

  const plan = useMemo(() => {
    if (document === null) return null;
    return planMarkdownImport({
      doc: document,
      projectId,
      ...(parentId === ROOT_VALUE ? {} : { parentId }),
      parsed,
      excludedTempIds: [...excludedTempIds],
      typeOverrides,
    });
  }, [document, projectId, parentId, parsed, excludedTempIds, typeOverrides]);

  function toggleExcluded(tempId: string) {
    setExcludedTempIds((current) => {
      const next = new Set(current);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  }

  function setRowType(tempId: string, type: PolicyComponentType) {
    setTypeOverrides((current) => {
      const next = new Map(current);
      next.set(tempId, type);
      return next;
    });
  }

  async function handleFilePicked(file: File) {
    const { text } = await readImportFile(file);
    setRawText(text);
  }

  function handleClose(next: boolean) {
    if (!next && report !== null) onImported(report.count);
    onOpenChange(next);
  }

  function handleConfirm() {
    if (plan === null || plan.blocked) return;
    const rows: MarkdownImportRow[] = plan.rows.filter((row) => !row.excluded);
    const result = dispatch(
      applyMarkdownImport({
        projectId,
        ...(parentId === ROOT_VALUE ? {} : { parentId }),
        rows,
        effectiveFrom: dateInputToIso(effectiveFrom),
      }),
    );
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível carregar',
        description: result.error.message || getErrorMessage(result.error.code),
      });
      return;
    }
    setReport({ count: result.data.createdComponentIds.length });
  }

  const canAdvanceFrom1 = parsed.roots.length > 0;
  const canAdvanceFrom2 = plan !== null && !plan.blocked;
  const includedCount = plan?.rows.filter((row) => !row.excluded).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      {/* `style` (não só `className`) porque `cn()` não faz merge de utilitários
          conflitantes (`src/lib/utils.ts`) — sem isto, o `max-w-md` default do
          `DialogContent` (`src/components/ui/dialog.tsx`) vence na cascata do
          Tailwind, e a linha de revisão (código + tipo + nome) não cabe. */}
      <DialogContent className="max-w-3xl" style={{ maxWidth: '48rem' }}>
        <DialogHeader>
          <DialogTitle>Carregar Markdown</DialogTitle>
          <DialogDescription>
            Suba um capítulo já convertido em Markdown dentro da seção escolhida — revise antes de confirmar.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex items-center gap-1.5" aria-label="Passos da carga por recorte">
          {([1, 2, 3] as const).map((candidate, index) => (
            <li key={candidate} className="flex items-center gap-1.5">
              {index > 0 && <span className="h-px w-4 bg-neutral-300 dark:bg-neutral-700" aria-hidden />}
              <span
                aria-current={step === candidate ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                  step === candidate
                    ? 'border-neutral-900 bg-neutral-900 text-neutral-50 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                    : 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400',
                )}
              >
                {candidate}
                {STEP_LABELS[candidate]}
              </span>
            </li>
          ))}
        </ol>

        {report !== null ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Check className="h-8 w-8 text-green-600 dark:text-green-400" aria-hidden />
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {report.count} componente(s) carregado(s) e publicado(s).
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Todos nasceram como "Aguardando revisão" — promova a "Validado" quando conferir cada um.
            </p>
          </div>
        ) : (
          <>
            {step === 1 && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="markdown-import-destination">Destino</Label>
                  <Combobox
                    options={destinationOptions}
                    value={parentId}
                    onChange={setParentId}
                    placeholder="Selecione o destino…"
                    searchPlaceholder="Buscar seção…"
                    aria-label="Destino da carga"
                  />
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    O recorte entra sob a seção escolhida (ou na raiz da política) — o heading mais alto do texto vira
                    o primeiro nível abaixo do destino.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="markdown-import-text">Texto em Markdown</Label>
                    <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="mr-1 h-3.5 w-3.5" /> Selecionar arquivo…
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".md,.markdown,.txt"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file !== undefined) void handleFilePicked(file);
                        event.target.value = '';
                      }}
                    />
                  </div>
                  <Textarea
                    id="markdown-import-text"
                    rows={12}
                    value={rawText}
                    onChange={(event) => setRawText(event.target.value)}
                    placeholder={'### Dívida Acima de R$ 5.000\nBloqueia o cliente com dívida em aberto.\n> Tipo: RULE\n> Reason code: DV01'}
                    className="font-mono text-xs"
                  />
                  {rawText.trim().length > 0 && parsed.roots.length === 0 && (
                    <Alert variant="destructive">
                      <TriangleAlert className="h-4 w-4" />
                      <AlertDescription>
                        Nenhum heading reconhecido — o recorte precisa começar em "#", "##" etc.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>
            )}

            {step === 2 && plan !== null && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {includedCount} de {plan.rows.length} linha(s) selecionada(s) para entrar.
                </p>
                <div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                  {plan.rows.map((row) => (
                    <ReviewRow
                      key={row.tempId}
                      row={row}
                      onToggle={() => toggleExcluded(row.tempId)}
                      onTypeChange={(type) => setRowType(row.tempId, type)}
                    />
                  ))}
                  {plan.rows.length === 0 && (
                    <p className="p-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                      Nada para revisar — volte e cole um recorte.
                    </p>
                  )}
                </div>
                {plan.issues.length > 0 && (
                  <Alert>
                    <TriangleAlert className="h-4 w-4" />
                    <AlertDescription>
                      {plan.issues.map((issue) => (
                        <p key={`${issue.code}-${issue.message}`}>{issue.message}</p>
                      ))}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {step === 3 && plan !== null && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="markdown-import-effective-from">Vigência da carga (obrigatória)</Label>
                  <Input
                    id="markdown-import-effective-from"
                    type="date"
                    value={effectiveFrom}
                    onChange={(event) => setEffectiveFrom(event.target.value)}
                  />
                  {foundationEffectiveFrom !== undefined && (
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Sugerida pela vigência da fundação do projeto — pode ser alterada.
                    </p>
                  )}
                </div>
                <Alert>
                  <TriangleAlert className="h-4 w-4" />
                  <AlertDescription>
                    Cria {includedCount} componente(s), cada um já publicado em v1 com{' '}
                    {"reviewStatus: 'PENDING_REVIEW'"} — publicação direta (RN-GOV-07), sem Solicitação de Alteração
                    de origem.
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </>
        )}

        <DialogFooter>
          {report !== null ? (
            <Button type="button" onClick={() => handleClose(false)}>
              Fechar
            </Button>
          ) : (
            <>
              {step > 1 && (
                <Button type="button" variant="ghost" onClick={() => setStep((current) => (current - 1) as Step)}>
                  Voltar
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={() => handleClose(false)}>
                Cancelar
              </Button>
              {step < 3 && (
                <Button
                  type="button"
                  disabled={step === 1 ? !canAdvanceFrom1 : !canAdvanceFrom2}
                  onClick={() => setStep((current) => (current + 1) as Step)}
                >
                  Avançar
                </Button>
              )}
              {step === 3 && (
                <Button
                  type="button"
                  disabled={!canAdvanceFrom2 || effectiveFrom === '' || !roleGate.allowed}
                  onClick={handleConfirm}
                  title={roleGate.reason ?? undefined}
                >
                  Confirmar carga
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewRow({
  row,
  onToggle,
  onTypeChange,
}: {
  row: MarkdownImportRow;
  onToggle: () => void;
  onTypeChange: (type: PolicyComponentType) => void;
}) {
  const blockingIssues = row.issues.filter((issue) => issue.severity === 'ERROR');
  const warnings = row.issues.filter((issue) => issue.severity === 'WARNING');
  return (
    <div
      data-testid={`markdown-import-row-${row.tempId}`}
      className={cn(
        'flex flex-col gap-1 rounded-md px-1.5 py-1 text-sm',
        row.excluded && 'opacity-50',
        blockingIssues.length > 0 && !row.excluded && 'bg-red-50 dark:bg-red-950/30',
      )}
      style={{ marginLeft: `${(row.depth - 1) * 16}px` }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Checkbox
          checked={!row.excluded}
          onCheckedChange={onToggle}
          aria-label={`Incluir "${row.name}" na carga`}
        />
        <span className="min-w-0 basis-full truncate sm:basis-auto sm:flex-1">{row.name}</span>
        <span className="shrink-0 font-mono text-[10px] text-neutral-400">{row.code}</span>
        <Select value={row.type} onValueChange={(value) => onTypeChange(value as PolicyComponentType)}>
          <SelectTrigger className="h-7 w-32 shrink-0 text-xs" aria-label={`Tipo de "${row.name}"`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROW_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {COMPONENT_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {row.typeSource === 'HEURISTIC' && (
          <Badge variant="amber" className="shrink-0">
            heurística
          </Badge>
        )}
      </div>
      {(blockingIssues.length > 0 || warnings.length > 0) && (
        <div className="ml-6 flex flex-col gap-0.5">
          {blockingIssues.map((issue) => (
            <p key={issue.message} className="text-xs text-red-600 dark:text-red-400">
              {issue.message}
            </p>
          ))}
          {warnings.map((issue) => (
            <p key={issue.message} className="text-xs text-amber-600 dark:text-amber-400">
              {issue.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
