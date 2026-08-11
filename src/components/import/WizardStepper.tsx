import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WizardStep } from '@/store/import-store';

export type StepMeta = {
  step: WizardStep;
  label: string;
  /** Passo alcançável a partir do estado atual (navegação livre só para trás). */
  reachable: boolean;
  /** Passo 3 marcado ✓ e pulado quando não há pendência de biblioteca. */
  done?: boolean;
};

export interface WizardStepperProps {
  steps: StepMeta[];
  current: WizardStep;
  onSelect: (step: WizardStep) => void;
}

/** Barra de passos numerada — docs/12-carga-de-matrizes.md §6.1. */
export function WizardStepper({ steps, current, onSelect }: WizardStepperProps) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Passos da carga">
      {steps.map((meta, index) => (
        <li key={meta.step} className="flex items-center gap-1.5">
          {index > 0 && <span className="h-px w-4 bg-neutral-300 dark:bg-neutral-700" aria-hidden />}
          <button
            type="button"
            disabled={!meta.reachable}
            onClick={() => onSelect(meta.step)}
            aria-current={meta.step === current ? 'step' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              meta.step === current
                ? 'border-neutral-900 bg-neutral-900 text-neutral-50 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                : 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400',
              !meta.reachable && 'cursor-not-allowed opacity-40',
              meta.reachable && meta.step !== current && 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
            )}
          >
            {meta.done === true ? (
              <Check className="h-3 w-3" aria-hidden />
            ) : (
              <span>{meta.step}</span>
            )}
            {meta.label}
          </button>
        </li>
      ))}
    </ol>
  );
}
