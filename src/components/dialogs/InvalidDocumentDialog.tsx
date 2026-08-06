import { ShieldAlert } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePersistenceStore } from '@/store/persistence-store';
import { groupBySeverity } from '@/storage/recovery';

/**
 * Documento inválido no salvamento — docs/06-persistencia-e-concorrencia.md §4.
 *
 * "Documento inválido **não é gravado** — melhor recusar do que corromper o
 * arquivo compartilhado. A interface mostra o que está errado e onde."
 */
export function InvalidDocumentDialog() {
  const invalid = usePersistenceStore((s) => s.invalid);
  const dismissInvalid = usePersistenceStore((s) => s.dismissInvalid);

  if (invalid === null) return null;

  return (
    <Dialog open onOpenChange={(next) => !next && dismissInvalid()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-600" aria-hidden />
            Nada foi gravado
          </DialogTitle>
          <DialogDescription>
            O documento não passou na validação, e por isso o salvamento foi recusado — gravar assim
            corromperia o arquivo do time. Abaixo, o que está errado e onde.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-80 flex-col gap-4 overflow-auto">
          {groupBySeverity(invalid.issues).map((group) => (
            <section key={group.severity} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {group.label}
              </h3>
              <ul className="flex flex-col gap-2">
                {group.issues.map((issue, index) => (
                  <li
                    key={`${issue.invariant}-${issue.path}-${index}`}
                    className="rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{issue.invariant}</Badge>
                      <span className="text-neutral-900 dark:text-neutral-100">{issue.message}</span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                      {issue.path}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <DialogFooter>
          <Button onClick={dismissInvalid}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
