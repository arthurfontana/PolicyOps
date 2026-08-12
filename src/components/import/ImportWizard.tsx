import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/library/ConfirmDialog';
import type { DocumentWithProfiles } from '@/core/import/profile';
import type { ImportTable } from '@/core/import/parse-table';
import { useDocumentStore } from '@/store/document-store';
import { useUiStore } from '@/store/ui-store';
import { useImportStore, type WizardStep } from '@/store/import-store';
import { WizardStepper, type StepMeta } from './WizardStepper';
import { Step1File } from './Step1File';
import { Step2Columns } from './Step2Columns';
import { Step3Library } from './Step3Library';
import { Step4Content } from './Step4Content';
import { Step5Plan } from './Step5Plan';
import { isApplicable } from './plan-preview';
import { Step6Apply } from './Step6Apply';
import { planImport } from '@/core/import/plan';
import { checkGridSize, libraryGapsOf, profileIssues, step2ProfileIssues } from './wizard-guards';
import { matchImportProfile, nearestImportProfile } from '@/core/import/profile';

const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Arquivo',
  2: 'Colunas',
  3: 'Biblioteca',
  4: 'Conteúdo',
  5: 'Plano',
  6: 'Aplicar',
};

/**
 * Casca do assistente de carga — docs/12-carga-de-matrizes.md §6.1,
 * docs/07-ux-e-editor.md §14. Seis passos numerados; nada é gravado no
 * documento antes do passo 6 fora dos comandos de biblioteca que o próprio
 * usuário aciona no passo 3.
 */
export function ImportWizard() {
  const document = useDocumentStore((s) => s.document);
  const setView = useUiStore((s) => s.setView);
  const step = useImportStore((s) => s.step);
  const setStep = useImportStore((s) => s.setStep);
  const parsed = useImportStore((s) => s.parsed);
  const profile = useImportStore((s) => s.profile);
  const dirty = useImportStore((s) => s.dirty);
  const fileName = useImportStore((s) => s.fileName);
  const selectedKeys = useImportStore((s) => s.selectedKeys);
  const restoreKeys = useImportStore((s) => s.restoreKeys);
  const report = useImportStore((s) => s.report);
  const reset = useImportStore((s) => s.reset);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  const docWithProfiles = document as DocumentWithProfiles | null;

  const headerDiffAcknowledged = useImportStore((s) => s.headerDiffAcknowledged);

  /**
   * RN-19/CT-12: cabeçalho parecido com um perfil salvo, mas diferente, segura
   * o passo 1 até o usuário ver a diferença e confirmar o mapeamento manual.
   */
  const headerDiffPending = useMemo(() => {
    if (docWithProfiles === null || parsed === undefined || parsed.header.length === 0) return false;
    if (headerDiffAcknowledged) return false;
    if (matchImportProfile(docWithProfiles, parsed.header) !== undefined) return false;
    return nearestImportProfile(docWithProfiles, parsed.header) !== undefined;
  }, [docWithProfiles, parsed, headerDiffAcknowledged]);

  const table: ImportTable | undefined = useMemo(
    () => (parsed === undefined ? undefined : { header: parsed.header, rows: parsed.rows, lines: parsed.lines }),
    [parsed],
  );

  const step2Ready = useMemo(() => {
    if (docWithProfiles === null || parsed === undefined) return false;
    if (step2ProfileIssues(docWithProfiles, profile, parsed.header).some((i) => i.severity === 'ERROR')) {
      return false;
    }
    return checkGridSize(docWithProfiles, profile).status !== 'OVER';
  }, [docWithProfiles, profile, parsed]);

  const libraryGaps = useMemo(() => {
    if (docWithProfiles === null || table === undefined || !step2Ready) return undefined;
    return libraryGapsOf(docWithProfiles, table, profile);
  }, [docWithProfiles, table, profile, step2Ready]);

  const step4Ready = useMemo(() => {
    if (docWithProfiles === null || parsed === undefined) return false;
    return !profileIssues(docWithProfiles, profile, parsed.header).some((i) => i.severity === 'ERROR');
  }, [docWithProfiles, profile, parsed]);

  const hasApplicable = useMemo(() => {
    // Só no passo do plano em diante: `planImport` sobre 102 matrizes custa
    // caro demais para rodar a cada render dos passos anteriores.
    if (docWithProfiles === null || table === undefined || !step4Ready || step < 5) return false;
    const plan = planImport(docWithProfiles, table, profile, { fileName, restoreKeys });
    const applicable = plan.matrices.filter(isApplicable);
    if (applicable.length === 0) return false;
    if (selectedKeys === undefined) return true;
    const chosen = new Set(selectedKeys);
    return applicable.some((entry) => chosen.has(entry.key));
  }, [docWithProfiles, table, profile, fileName, step4Ready, selectedKeys, restoreKeys, step]);

  const canAdvanceFrom: Record<WizardStep, boolean> = {
    1: parsed !== undefined && parsed.errors.length === 0 && !headerDiffPending,
    2: step2Ready,
    3: (libraryGaps?.length ?? 1) === 0,
    4: step4Ready,
    // Do plano só se avança com ao menos uma matriz nova ou alterada
    // selecionada — é o "nenhuma alteração a aplicar" de CT-01.
    5: hasApplicable,
    6: false,
  };

  let furthestReachable: WizardStep = 1;
  for (const candidate of [1, 2, 3, 4, 5, 6] as WizardStep[]) {
    furthestReachable = candidate;
    if (!canAdvanceFrom[candidate]) break;
  }

  const steps: StepMeta[] = ([1, 2, 3, 4, 5, 6] as WizardStep[]).map((candidate) => ({
    step: candidate,
    label: STEP_LABELS[candidate],
    reachable: candidate === 1 || candidate <= Math.max(furthestReachable, step),
    done: candidate === 3 ? libraryGaps?.length === 0 : undefined,
  }));

  function goNext() {
    if (step === 6) return;
    if (!canAdvanceFrom[step]) return;
    let next = (step + 1) as WizardStep;
    if (next === 3 && (libraryGaps?.length ?? 1) === 0) next = 4;
    setStep(next);
  }

  function goTo(target: WizardStep) {
    const meta = steps.find((s) => s.step === target);
    if (meta?.reachable !== true) return;
    setStep(target);
  }

  function requestClose() {
    if (dirty) {
      setCloseConfirmOpen(true);
      return;
    }
    doClose();
  }

  function doClose() {
    reset();
    setView('projects');
  }

  if (document === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum documento aberto.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 overflow-hidden p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Carga de matrizes</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Abrir o arquivo, revisar o plano e aplicar. Nada é publicado pelo assistente.
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Fechar assistente" onClick={requestClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <WizardStepper steps={steps} current={step} onSelect={goTo} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {step === 1 && <Step1File />}
        {step === 2 && table !== undefined && <Step2Columns table={table} />}
        {step === 3 && table !== undefined && <Step3Library table={table} />}
        {step === 4 && <Step4Content />}
        {step === 5 && table !== undefined && <Step5Plan table={table} />}
        {step === 6 && table !== undefined && <Step6Apply table={table} />}
      </div>

      <div className="flex items-center justify-between border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <Button
          variant="outline"
          disabled={step === 1 || report !== undefined}
          onClick={() => setStep((step - 1) as WizardStep)}
        >
          Voltar
        </Button>
        {step < 6 && (
          <Button disabled={!canAdvanceFrom[step]} onClick={goNext}>
            Avançar
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={closeConfirmOpen}
        onOpenChange={setCloseConfirmOpen}
        title="Descartar o mapeamento?"
        description="Você tem um mapeamento não salvo. Fechar o assistente descarta o progresso desta carga — nenhuma variável, domínio ou item de biblioteca já criado é desfeito."
        confirmLabel="Fechar e descartar"
        destructive
        onConfirm={doClose}
      />
    </div>
  );
}
