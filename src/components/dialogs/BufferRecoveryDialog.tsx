import { RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDocumentStore } from '@/store/document-store';
import { usePersistenceStore } from '@/store/persistence-store';
import { summarizeConflict } from '@/storage/conflict';

/**
 * Recuperação do buffer de autosave — docs/06-persistencia-e-concorrencia.md §8.
 *
 * *"Encontramos alterações não salvas de 05/08 às 14:32. Recuperar ou
 * descartar?"*, com preview do que difere.
 */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${date.toLocaleTimeString(
    'pt-BR',
    { hour: '2-digit', minute: '2-digit' },
  )}`;
}

export function BufferRecoveryDialog() {
  const offer = usePersistenceStore((s) => s.bufferOffer);
  const recoverBuffer = usePersistenceStore((s) => s.recoverBuffer);
  const discardBuffer = usePersistenceStore((s) => s.discardBuffer);
  const opened = useDocumentStore((s) => s.document);

  if (offer === null) return null;

  const lines =
    opened === null
      ? []
      : summarizeConflict(opened, offer.document).filter((line) => line.changed);

  return (
    <Dialog open onOpenChange={(next) => !next && void discardBuffer()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" aria-hidden />
            Encontramos alterações não salvas
          </DialogTitle>
          <DialogDescription>
            O rascunho automático de {formatWhen(offer.savedAt)} é mais novo que o arquivo aberto
            (revisão {offer.revision}). Ele fica guardado neste navegador, e é o que sobra quando o
            navegador cai antes de você salvar. Recuperar ou descartar?
          </DialogDescription>
        </DialogHeader>

        {lines.length > 0 && (
          <div className="max-h-56 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="p-2 font-medium">Campo</th>
                  <th className="p-2 font-medium">Arquivo</th>
                  <th className="p-2 font-medium">Rascunho</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.label}>
                    <td className="p-2">{line.label}</td>
                    <td className="p-2">{line.mine}</td>
                    <td className="p-2">{line.theirs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => void discardBuffer()}>
            Descartar
          </Button>
          <Button onClick={recoverBuffer}>Recuperar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
