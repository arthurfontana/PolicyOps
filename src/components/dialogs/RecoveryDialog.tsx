import { Download, LifeBuoy } from 'lucide-react';
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
import { describeAutoFix, diagnosticReport, groupBySeverity } from '@/storage/recovery';
import { baseName } from '@/storage/format';

/**
 * Modo de recuperação — docs/06-persistencia-e-concorrencia.md §10.
 *
 * O arquivo não é descartado: os problemas aparecem em português, agrupados
 * por gravidade, com a correção automática de quem tem `autoFix` e o caminho
 * no JSON de quem não tem. **Nada é gravado** até o usuário aceitar, e a
 * gravação é sempre "salvar como" — o arquivo original fica intacto.
 */
export function RecoveryDialog() {
  const recovery = usePersistenceStore((s) => s.recovery);
  const acceptRecovery = usePersistenceStore((s) => s.acceptRecovery);
  const discardRecovery = usePersistenceStore((s) => s.discardRecovery);

  if (recovery === null) return null;

  const groups = groupBySeverity(recovery.issues);
  const fixable = recovery.preview.fixed.length;
  const remaining = recovery.preview.remaining.length;

  function exportReport() {
    if (recovery === null) return;
    const text = diagnosticReport(recovery.fileName, recovery.issues, new Date());
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${baseName(recovery.fileName)}-diagnostico.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  return (
    <Dialog open onOpenChange={(next) => !next && discardRecovery()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-amber-600" aria-hidden />
            Modo de recuperação — {recovery.fileName}
          </DialogTitle>
          <DialogDescription>
            O arquivo abriu, mas não passou na validação. Nada foi alterado nele: as correções abaixo
            só valem depois que você aceitar, e a gravação será sempre em um arquivo novo (&quot;salvar
            como&quot;).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">{recovery.issues.length} problema(s)</Badge>
          <Badge variant="green">{fixable} com correção automática</Badge>
          <Badge variant="amber">{remaining} para corrigir à mão</Badge>
        </div>

        <div className="flex max-h-80 flex-col gap-4 overflow-auto">
          {groups.map((group) => (
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
                    <div className="mt-1 text-neutral-600 dark:text-neutral-400">
                      {describeAutoFix(issue) === null
                        ? 'Sem correção automática — corrija no JSON, no caminho acima.'
                        : `Correção automática: ${describeAutoFix(issue)}.`}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {recovery.preview.actions.length > 0 && (
          <details className="rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
            <summary className="cursor-pointer text-neutral-700 dark:text-neutral-300">
              O que a correção automática vai fazer ({recovery.preview.actions.length} ação/ões)
            </summary>
            <ul className="mt-2 flex flex-col gap-1 text-neutral-600 dark:text-neutral-400">
              {recovery.preview.actions.map((action, index) => (
                <li key={`${action.path}-${index}`}>• {action.description}</li>
              ))}
            </ul>
          </details>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={exportReport}>
            <Download className="mr-2 h-4 w-4" /> Exportar diagnóstico
          </Button>
          <Button variant="secondary" onClick={discardRecovery}>
            Não abrir
          </Button>
          <Button disabled={remaining > 0} onClick={() => void acceptRecovery()}>
            Corrigir e salvar como…
          </Button>
        </DialogFooter>
        {remaining > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Ainda há {remaining} problema(s) sem correção automática. Corrija-os no arquivo e abra de
            novo — a aplicação não abre um documento que não valida.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
