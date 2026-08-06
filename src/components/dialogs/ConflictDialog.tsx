import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePersistenceStore } from '@/store/persistence-store';
import { MERGE_COMING_LATER } from '@/storage/conflict';

/**
 * Conflito de salvamento — docs/06-persistencia-e-concorrencia.md §5.
 *
 * As três saídas do documento normativo, e nada de sobrescrita silenciosa:
 * "Sobrescrever mesmo assim" só habilita depois de a pessoa **digitar o nome
 * do arquivo**. "Mesclar" aparece desabilitada, com a sessão em que chega.
 */
export function ConflictDialog() {
  const conflict = usePersistenceStore((s) => s.conflict);
  const saveConflictCopy = usePersistenceStore((s) => s.saveConflictCopy);
  const overwriteAnyway = usePersistenceStore((s) => s.overwriteAnyway);
  const dismissConflict = usePersistenceStore((s) => s.dismissConflict);

  const [showChanges, setShowChanges] = useState(false);
  const [typedName, setTypedName] = useState('');

  const open = conflict !== null;
  const confirmed = conflict !== null && typedName.trim() === conflict.fileName;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setShowChanges(false);
          setTypedName('');
          dismissConflict();
        }
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="h-5 w-5 text-amber-600" aria-hidden />
            Conflito ao salvar
          </DialogTitle>
          <DialogDescription>{conflict?.headline}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setShowChanges((value) => !value)}>
              {showChanges ? 'Ocultar o que mudou' : 'Ver o que mudou'}
            </Button>
            <Button variant="secondary" disabled title={MERGE_COMING_LATER}>
              Mesclar
            </Button>
            <Button variant="secondary" onClick={() => void saveConflictCopy()}>
              Salvar como cópia
            </Button>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{MERGE_COMING_LATER}</p>

          {showChanges && conflict !== null && (
            <div className="max-h-64 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                  <tr>
                    <th className="p-2 font-medium">Campo</th>
                    <th className="p-2 font-medium">O meu</th>
                    <th className="p-2 font-medium">O do arquivo</th>
                  </tr>
                </thead>
                <tbody>
                  {conflict.lines.map((line) => (
                    <tr
                      key={line.label}
                      className={
                        line.changed
                          ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                          : ''
                      }
                    >
                      <td className="p-2">{line.label}</td>
                      <td className="p-2">{line.mine}</td>
                      <td className="p-2">{line.theirs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col gap-1.5 rounded-md border border-red-200 p-3 dark:border-red-900">
            <Label htmlFor="overwrite-confirm" className="text-red-700 dark:text-red-400">
              Sobrescrever mesmo assim
            </Label>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Isso descarta o que a outra pessoa salvou. Para confirmar, digite o nome do arquivo:{' '}
              <code className="font-mono">{conflict?.fileName}</code>
            </p>
            <div className="flex gap-2">
              <Input
                id="overwrite-confirm"
                value={typedName}
                onChange={(event) => setTypedName(event.target.value)}
                placeholder={conflict?.fileName}
              />
              <Button
                variant="destructive"
                disabled={!confirmed}
                onClick={() => {
                  const name = typedName;
                  setTypedName('');
                  void overwriteAnyway(name);
                }}
              >
                Sobrescrever
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setShowChanges(false);
              setTypedName('');
              dismissConflict();
            }}
          >
            Não salvar agora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
