import { useEffect, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { createRelease } from '@/core/document/releases';
import { dateInputToIso } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';

export interface CreateReleaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (releaseId: string) => void;
}

/**
 * Criação da release (docs/14 §3.4) — `code` é rótulo de calendário
 * ("2026.09.01"), sem a mesma máscara do `code` de DB/componente (I31 exige
 * só unicidade). Nasce `PLANNED`; o resto (data planejada, observação) é
 * opcional aqui e editável depois no detalhe.
 */
export function CreateReleaseDialog({ open, onOpenChange, onCreated }: CreateReleaseDialogProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setCode('');
    setName('');
    setPlannedDate('');
    setNotes('');
  }, [open]);

  const canCreate = code.trim() !== '';

  function handleCreate() {
    const result = dispatch(
      createRelease({
        code: code.trim(),
        ...(name.trim() !== '' ? { name: name.trim() } : {}),
        ...(plannedDate !== '' ? { plannedDate: dateInputToIso(plannedDate) } : {}),
        ...(notes.trim() !== '' ? { notes: notes.trim() } : {}),
      }),
    );
    if (!result.ok) {
      toast({ variant: 'destructive', title: 'Não foi possível criar a release', description: result.error.message });
      return;
    }
    onOpenChange(false);
    onCreated(result.data.releaseId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova release</DialogTitle>
          <DialogDescription>
            Nasce planejada. DBs entram depois, no detalhe — só os já aprovados podem ser vinculados.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-release-code">Código</Label>
            <Input
              id="new-release-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="2026.09.01"
              required
            />
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Rótulo de calendário — livre, só precisa ser único no documento.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-release-name">Nome (opcional)</Label>
            <Input
              id="new-release-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Subida de setembro"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-release-date">Data planejada (opcional)</Label>
            <Input
              id="new-release-date"
              type="date"
              value={plannedDate}
              onChange={(e) => setPlannedDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-release-notes">Observações (opcional)</Label>
            <Textarea
              id="new-release-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[64px] text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={!canCreate} onClick={handleCreate}>
            Criar release
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
