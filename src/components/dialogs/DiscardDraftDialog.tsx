import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { getErrorMessage } from '@/core/error-messages';
import { discardDraft } from '@/core/versioning/lifecycle';
import type { MatrixVersion } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';

export interface DiscardDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: MatrixVersion;
  onDiscarded: () => void;
}

/**
 * Diálogo de descarte — docs/prompts/S13-ciclo-de-vida.md item 3: contagem de
 * células editadas desde a criação do rascunho, e o aviso de que o número da
 * versão é queimado (§1.4 de docs/05-regras-de-negocio.md).
 */
export function DiscardDraftDialog({ open, onOpenChange, version, onDiscarded }: DiscardDraftDialogProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const editedCells = Object.keys(version.cells).length;

  function handleConfirm() {
    const result = dispatch(discardDraft({ versionId: version.id }));
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível descartar o rascunho',
        description: result.error.message || getErrorMessage(result.error.code),
      });
      return;
    }
    onDiscarded();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Descartar a versão {version.number}?</DialogTitle>
          <DialogDescription>
            {editedCells === 0
              ? 'Nenhuma célula foi preenchida neste rascunho.'
              : `${editedCells} célula${editedCells === 1 ? '' : 's'} preenchida${editedCells === 1 ? '' : 's'} neste rascunho`}{' '}
            será{editedCells === 1 ? '' : 'ão'} perdida{editedCells === 1 ? '' : 's'} — esta ação não pode
            ser desfeita. O número {version.number} não será reutilizado: a próxima versão pula direto
            para {version.number + 1}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              handleConfirm();
            }}
          >
            Descartar rascunho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
