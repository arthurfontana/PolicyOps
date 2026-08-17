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
import { getErrorMessage } from '@/core/error-messages';
import { approveChangeRequest, rejectChangeRequest, returnChangeRequest } from '@/core/document/change-requests';
import type { ChangeRequest, CrApprovalDecision } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';
import { useToast } from '@/components/ui/use-toast';

export interface DecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changeRequest: ChangeRequest;
  decision: CrApprovalDecision;
  onDecided: () => void;
}

const TITLE: Record<CrApprovalDecision, string> = {
  APPROVED: 'Aprovar a solicitação',
  RETURNED: 'Devolver a solicitação',
  REJECTED: 'Rejeitar a solicitação',
};

const CONFIRM_LABEL: Record<CrApprovalDecision, string> = {
  APPROVED: 'Aprovar',
  RETURNED: 'Devolver',
  REJECTED: 'Rejeitar',
};

const DESCRIPTION: Record<CrApprovalDecision, string> = {
  APPROVED:
    'Aprovar move o status para APPROVED e grava a decisão na trilha. Não publica nada — nenhuma versão de componente ou matriz muda de estado (RN-GOV-04).',
  RETURNED: 'A solicitação volta para CHANGES_REQUESTED e o autor pode editar de novo. Diga o que precisa ser ajustado.',
  REJECTED: 'A solicitação vai para REJECTED — estado fechado, sem volta. Um comentário ajuda a registrar o motivo.',
};

/**
 * Decisão da fila de aprovação (US-GOV-04): aprovar/devolver/rejeitar sempre
 * pelos comandos de decisão (`changeRequest/approve`/`return`/`reject`), que
 * fazem a transição do grafo **e** gravam `{by, at, decision, comment}` em
 * `approvals` — nunca `changeRequest/transition` puro (docs/14 §5.1, item 4).
 * Devolução exige comentário (RN-GOV-04/US-GOV-04); nos outros dois, é
 * opcional.
 */
export function DecisionDialog({ open, onOpenChange, changeRequest, decision, onDecided }: DecisionDialogProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (open) setComment('');
  }, [open]);

  const commentRequired = decision === 'RETURNED';
  const canConfirm = !commentRequired || comment.trim() !== '';

  function handleConfirm() {
    const input = { changeRequestId: changeRequest.id, ...(comment.trim() !== '' ? { comment: comment.trim() } : {}) };
    const command =
      decision === 'APPROVED'
        ? approveChangeRequest(input)
        : decision === 'RETURNED'
          ? returnChangeRequest(input)
          : rejectChangeRequest(input);
    const result = dispatch(command);
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: `Não foi possível ${CONFIRM_LABEL[decision].toLowerCase()}`,
        description: result.error.message || getErrorMessage(result.error.code),
      });
      return;
    }
    onOpenChange(false);
    onDecided();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{TITLE[decision]}</DialogTitle>
          <DialogDescription>
            "{changeRequest.code}" — {changeRequest.title}. {DESCRIPTION[decision]}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="decision-comment">
            Comentário {commentRequired ? <span className="text-red-500">(obrigatório)</span> : '(opcional)'}
          </Label>
          <Textarea
            id="decision-comment"
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={commentRequired ? 'O que precisa ser ajustado?' : ''}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant={decision === 'REJECTED' ? 'destructive' : 'default'}
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {CONFIRM_LABEL[decision]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
