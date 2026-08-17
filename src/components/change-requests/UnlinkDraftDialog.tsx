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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { unlinkChangeRequestDraft } from '@/core/document/cr-drafts';
import type { ChangeRequest, PolicyComponent } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';

export interface UnlinkDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changeRequest: ChangeRequest;
  component: PolicyComponent;
}

/**
 * Desvincular o rascunho de um item (docs/07 §19.5, S36). O diálogo existe por
 * causa de uma regra só: **desfazer o vínculo não descarta o rascunho sem
 * confirmação** (docs/14 §3.3). O padrão é soltar e deixar o trabalho no
 * componente; descartar é uma caixa que a pessoa precisa marcar.
 */
export function UnlinkDraftDialog({ open, onOpenChange, changeRequest, component }: UnlinkDraftDialogProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const [discard, setDiscard] = useState(false);

  useEffect(() => {
    if (open) setDiscard(false);
  }, [open]);

  function handleConfirm() {
    const result = dispatch(
      unlinkChangeRequestDraft({
        changeRequestId: changeRequest.id,
        componentId: component.id,
        discardDraft: discard,
      }),
    );
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível desvincular',
        description: result.error.message,
      });
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Desvincular o rascunho de &quot;{component.name}&quot;?</DialogTitle>
          <DialogDescription>
            O item de &quot;{changeRequest.code}&quot; fica sem rascunho e a publicação passa a
            recusá-lo (E-GOV-04) até você vincular outro. O rascunho em si continua no componente,
            editável como qualquer outro.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <Checkbox
            id="unlink-discard"
            checked={discard}
            onCheckedChange={(checked) => setDiscard(checked === true)}
          />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="unlink-discard" className="text-sm">
              Descartar o rascunho também
            </Label>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Joga fora o conteúdo proposto. Em matriz, o número da versão é queimado e não volta.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" variant={discard ? 'destructive' : 'default'} onClick={handleConfirm}>
            {discard ? 'Desvincular e descartar' : 'Desvincular'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
