import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { setChangeRequestRelease } from '@/core/document/change-requests';
import { isChangeRequestFrozen } from '@/core/document/cr-workflow';
import { listChangeRequestsAvailableForRelease } from '@/core/document/releases';
import { CR_STATUS_LABELS, CR_STATUS_VARIANTS } from '@/lib/change-request-labels';
import { useDocumentStore } from '@/store/document-store';

export interface AddChangeRequestToReleaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  releaseId: string;
}

/**
 * Vincular DB à release (docs/14 §3.4, §6): só entram DBs `≥ APPROVED`,
 * abertos e ainda sem release — a checagem de verdade é do próprio comando
 * (`changeRequest/setRelease`), aqui só filtramos a lista para não oferecer
 * um clique que o núcleo vai recusar.
 */
export function AddChangeRequestToReleaseDialog({
  open,
  onOpenChange,
  releaseId,
}: AddChangeRequestToReleaseDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setSearch('');
  }, [open]);

  const candidates = useMemo(() => {
    if (document === null) return [];
    const searchLower = search.trim().toLowerCase();
    return listChangeRequestsAvailableForRelease(document)
      .filter((cr) => isChangeRequestFrozen(cr.status))
      .filter(
        (cr) => searchLower === '' || `${cr.code} ${cr.title}`.toLowerCase().includes(searchLower),
      );
  }, [document, search]);

  if (document === null) return null;

  function handlePick(changeRequestId: string) {
    const result = dispatch(setChangeRequestRelease({ changeRequestId, releaseId }));
    if (!result.ok) {
      toast({ variant: 'destructive', title: 'Não foi possível vincular o DB', description: result.error.message });
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar DB à release</DialogTitle>
          <DialogDescription>
            Só DBs aprovados (ou adiante no workflow) e ainda sem release entram aqui.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            placeholder="Buscar por código ou título…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />

          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto" role="listbox" aria-label="DBs disponíveis">
            {candidates.length === 0 && (
              <li className="rounded-md bg-neutral-50 p-3 text-center text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                Nenhum DB aprovado, sem release, corresponde ao filtro.
              </li>
            )}
            {candidates.map((cr) => (
              <li key={cr.id}>
                <button
                  type="button"
                  role="option"
                  onClick={() => handlePick(cr.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-neutral-200 p-2 text-left text-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">{cr.title}</span>
                      <span className="shrink-0 font-mono text-xs text-neutral-400">{cr.code}</span>
                    </div>
                  </div>
                  <Badge variant={CR_STATUS_VARIANTS[cr.status]}>{CR_STATUS_LABELS[cr.status]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
