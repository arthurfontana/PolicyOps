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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { getErrorMessage } from '@/core/error-messages';
import { addNote } from '@/core/versioning/lifecycle';
import type { MatrixVersion } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';

export interface AddNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: MatrixVersion;
  onAdded?: () => void;
}

/**
 * `version/addNote` — docs/prompts/S13-ciclo-de-vida.md item 6. É o único
 * conteúdo que pode ser acrescentado a uma versão já publicada; o texto abaixo
 * deixa isso explícito, como o item pede.
 */
export function AddNoteDialog({ open, onOpenChange, version, onAdded }: AddNoteDialogProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const [text, setText] = useState('');

  useEffect(() => {
    if (open) setText('');
  }, [open]);

  const published = version.state !== 'DRAFT';

  function handleSubmit() {
    const trimmed = text.trim();
    if (trimmed === '') return;
    const result = dispatch(addNote({ versionId: version.id, text: trimmed }));
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível anotar',
        description: result.error.message || getErrorMessage(result.error.code),
      });
      return;
    }
    onOpenChange(false);
    onAdded?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Anotar na versão {version.number}</DialogTitle>
          <DialogDescription>
            {published
              ? 'Esta versão já foi publicada e não pode mais ser editada — uma anotação é o único conteúdo que ainda pode ser acrescentado a ela, para registrar contexto posterior.'
              : 'Registra um evento no histórico desta versão, sem alterar o rascunho.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="version-note-text">Anotação</Label>
          <Textarea
            id="version-note-text"
            autoFocus
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="O que aconteceu ou precisa ficar registrado."
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={text.trim() === ''} onClick={handleSubmit}>
            Anotar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
