import { useMemo, useState } from 'react';
import { ArrowRight, Info, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GridMiniature } from '@/components/editor/GridMiniature';
import type { AxisLevel, AxisRole, PolicyOpsDocument } from '@/core/document/schema';
import { DomainError } from '@/core/errors';
import { previewResnapshot, type ResnapshotLevelChange } from '@/core/reconcile/resnapshot';
import { readableTuple } from '@/lib/axis-labels';

/**
 * Diálogo de reconciliação — docs/05-regras-de-negocio.md §5.3 e
 * docs/prompts/S16, item 4.
 *
 * **Nada é gravado antes de passar por aqui.** O diálogo abre o preview
 * (`previewResnapshot`, que é read-only), mostra em português o que entra, o
 * que sai e o que muda de rótulo, desenha o grid resultante, e só então oferece
 * o botão de aplicar. Havendo descarte, exige digitar o nome do eixo — o mesmo
 * padrão do diálogo de remover nível (S12).
 */

/** O nome do eixo, que é o que a confirmação por digitação pede. */
const AXIS_NAME: Record<AxisRole, string> = { X: 'Eixo X', Y: 'Eixo Y' };

const ROLE_LABEL: Record<AxisRole, string> = { X: 'eixo X', Y: 'eixo Y' };

/** Teto de itens listados: acima disso a lista vira ruído e a contagem basta. */
const MAX_LISTED = 12;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function LevelChange({ level }: { level: ResnapshotLevelChange }) {
  const nothing =
    level.addedDomains.length === 0 &&
    level.removedDomains.length === 0 &&
    level.replacedDomains.length === 0 &&
    level.relabeled.length === 0 &&
    !level.reordered;

  return (
    <li className="flex flex-col gap-0.5 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-neutral-900 dark:text-neutral-100">{level.label}</span>
        <span className="text-neutral-500 dark:text-neutral-400">
          {level.from === null ? 'versão desconhecida' : `v${level.from}`}
        </span>
        <ArrowRight className="h-3 w-3 text-neutral-400" aria-hidden />
        <span className="font-medium text-neutral-700 dark:text-neutral-300">v{level.to}</span>
        {level.variableArchived && (
          <span className="text-amber-700 dark:text-amber-400">(variável arquivada)</span>
        )}
      </span>
      {nothing && (
        <span className="text-neutral-500 dark:text-neutral-400">
          Só o pino muda — os domínios são os mesmos.
        </span>
      )}
      {level.addedDomains.length > 0 && (
        <span className="text-neutral-600 dark:text-neutral-400">
          Domínios que entram: {level.addedDomains.join(', ')}
        </span>
      )}
      {level.removedDomains.length > 0 && (
        <span className="text-red-700 dark:text-red-400">
          Domínios que saem: {level.removedDomains.join(', ')}
        </span>
      )}
      {level.replacedDomains.length > 0 && (
        <span className="text-amber-700 dark:text-amber-400">
          Substituídos (mesmo código, outro domínio): {level.replacedDomains.join(', ')} — essas
          células nascem vazias, não herdam nada.
        </span>
      )}
      {level.relabeled.length > 0 && (
        <span className="text-neutral-600 dark:text-neutral-400">
          Renomeados: {level.relabeled.map((entry) => `${entry.from} → ${entry.to}`).join('; ')}
        </span>
      )}
      {level.reordered && (
        <span className="text-neutral-600 dark:text-neutral-400">
          A ordem dos domínios mudou — as células são preservadas, muda a ordem das combinações.
        </span>
      )}
    </li>
  );
}

export interface ResnapshotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: PolicyOpsDocument;
  versionId: string;
  role: AxisRole;
  /** Níveis atuais do eixo — dão o rótulo legível das combinações que saem. */
  levels: AxisLevel[];
  /** Tuplas do outro eixo — não mudam, mas dão a forma real da miniatura. */
  otherTuples: string[];
  onApply: () => void;
}

export function ResnapshotDialog({
  open,
  onOpenChange,
  doc,
  versionId,
  role,
  levels,
  otherTuples,
  onApply,
}: ResnapshotDialogProps) {
  const [typed, setTyped] = useState('');

  const { value, error } = useMemo(() => {
    try {
      return { value: previewResnapshot(doc, versionId, role), error: null };
    } catch (caught) {
      if (caught instanceof DomainError) return { value: null, error: caught.message };
      throw caught;
    }
  }, [doc, versionId, role]);

  const plan = value?.plan ?? null;
  // Os rótulos das combinações que entram vêm dos domínios novos; os das que
  // saem, dos antigos — só assim "500k–1M" continua legível depois de sumir.
  const nextLevels =
    value === null ? levels : (role === 'X' ? value.version.axes.x : value.version.axes.y).levels;

  const dropped = plan?.droppedCells.length ?? 0;
  const needsTyping = dropped > 0;
  const confirmed = !needsTyping || typed.trim() === AXIS_NAME[role];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Atualizar o {ROLE_LABEL[role]} para as versões mais recentes da biblioteca
          </DialogTitle>
          <DialogDescription>
            Nada é gravado até você confirmar. A versão publicada desta matriz não é tocada em
            nenhuma hipótese — só este rascunho muda.
          </DialogDescription>
        </DialogHeader>

        {error !== null && (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {plan !== null && value !== null && (
          <div className="flex flex-col gap-3" data-testid="resnapshot-preview">
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                Mudanças por nível
              </h3>
              <ul className="flex flex-col gap-1.5">
                {plan.levels.map((level) => (
                  <LevelChange key={level.index} level={level} />
                ))}
              </ul>
            </section>

            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                Mudanças de compatibilidade
              </h3>
              {plan.compatibility.length === 0 ? (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Nenhuma regra de compatibilidade muda neste eixo.
                </p>
              ) : (
                <ul className="flex flex-col gap-1 text-xs">
                  {plan.compatibility.map((change) => (
                    <li
                      key={change.ruleId}
                      className="flex flex-wrap items-center gap-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-800"
                    >
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">
                        {change.ruleName}
                      </span>
                      <span className="text-neutral-500 dark:text-neutral-400">
                        {change.from === null ? 'não se aplicava' : `v${change.from}`}
                      </span>
                      <ArrowRight className="h-3 w-3 text-neutral-400" aria-hidden />
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">
                        {change.to === null ? 'deixa de se aplicar' : `v${change.to}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-1.5" data-testid="resnapshot-added">
              <h3 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                Combinações que entram ({plan.addedTuples.length})
              </h3>
              {plan.addedTuples.length === 0 ? (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Nenhuma combinação nova.
                </p>
              ) : (
                <>
                  <ul className="flex flex-col gap-0.5 text-xs text-neutral-600 dark:text-neutral-400">
                    {plan.addedTuples.slice(0, MAX_LISTED).map((path) => (
                      <li key={path}>{readableTuple(nextLevels, path)}</li>
                    ))}
                    {plan.addedTuples.length > MAX_LISTED && (
                      <li className="text-neutral-400">
                        e mais {plan.addedTuples.length - MAX_LISTED}…
                      </li>
                    )}
                  </ul>
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    Gera {plural(plan.newCombinations, 'célula nova', 'células novas')} que você
                    precisará preencher — o rascunho fica bloqueado para publicação até lá.
                  </p>
                </>
              )}
            </section>

            <section className="flex flex-col gap-1.5" data-testid="resnapshot-removed">
              <h3 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                Combinações que saem ({plan.removedTuples.length})
              </h3>
              {plan.removedTuples.length === 0 ? (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Nenhuma combinação sai.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5 text-xs text-red-600 line-through dark:text-red-400">
                  {plan.removedTuples.slice(0, MAX_LISTED).map((path) => (
                    <li key={path}>{readableTuple(levels, path)}</li>
                  ))}
                  {plan.removedTuples.length > MAX_LISTED && (
                    <li className="text-neutral-400 no-underline">
                      e mais {plan.removedTuples.length - MAX_LISTED}…
                    </li>
                  )}
                </ul>
              )}
              {dropped > 0 && (
                <Alert variant="destructive">
                  <TriangleAlert className="h-4 w-4" />
                  <AlertDescription>
                    {plural(dropped, 'célula será descartada', 'células serão descartadas')} — o
                    conteúdo fica registrado na auditoria e pode ser consultado no histórico da
                    versão.
                  </AlertDescription>
                </Alert>
              )}
            </section>

            {plan.droppedSuppressions.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {plural(
                  plan.droppedSuppressions.length,
                  'supressão manual deixa',
                  'supressões manuais deixam',
                )}{' '}
                de existir: a combinação suprimida não faz mais parte deste eixo.
              </p>
            )}

            {plan.warnings.length > 0 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  <ul className="flex flex-col gap-0.5">
                    {plan.warnings.map((warning, index) => (
                      <li key={`${warning.code}-${index}`}>{warning.message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <GridMiniature
              xBefore={role === 'X' ? value.tuplesBefore : otherTuples}
              xAfter={role === 'X' ? value.tuplesAfter : otherTuples}
              yBefore={role === 'Y' ? value.tuplesBefore : otherTuples}
              yAfter={role === 'Y' ? value.tuplesAfter : otherTuples}
            />

            {needsTyping && (
              <div className="flex flex-col gap-1">
                <Label className="text-xs" htmlFor="confirm-resnapshot">
                  Para confirmar o descarte, digite o nome do eixo:{' '}
                  <strong>{AXIS_NAME[role]}</strong>
                </Label>
                <Input
                  id="confirm-resnapshot"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder={AXIS_NAME[role]}
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant={dropped > 0 ? 'destructive' : 'default'}
            disabled={plan === null || !confirmed}
            onClick={onApply}
          >
            Atualizar eixo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
