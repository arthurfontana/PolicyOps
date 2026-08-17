import { useEffect, useMemo, useState } from 'react';
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
import { createChangeRequest, suggestNextChangeRequestCode } from '@/core/document/change-requests';
import { CODE_REGEX } from '@/core/document/schema';
import { useActor } from '@/hooks/useActor';
import { useDocumentStore } from '@/store/document-store';
import { useToast } from '@/components/ui/use-toast';

export interface CreateChangeRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (changeRequestId: string) => void;
}

/**
 * Criação do DB (US-GOV-03) — só o essencial para nascer em `DRAFT`: título e
 * código, sugerido sequencialmente a partir do maior `DB_<n>` do documento e
 * sempre editável (I26, docs/14 §12 pergunta 1). Motivadores, itens,
 * impactos, critérios, testes e vigência entram depois, no detalhe.
 */
export function CreateChangeRequestDialog({ open, onOpenChange, onCreated }: CreateChangeRequestDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { actor } = useActor();
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);

  const suggestedCode = useMemo(() => (document === null ? 'DB_1' : suggestNextChangeRequestCode(document)), [document]);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setCode(suggestedCode);
    setCodeTouched(false);
  }, [open, suggestedCode]);

  const codeError = code.trim() === '' ? null : CODE_REGEX.test(code) ? null : 'O código só pode ter letras maiúsculas, números e "_".';
  const canCreate = title.trim() !== '' && code.trim() !== '' && codeError === null;

  function handleCreate() {
    const result = dispatch(
      createChangeRequest({
        code: code.trim(),
        title: title.trim(),
        ...(actor !== null && actor.trim() !== '' ? { requestedBy: actor } : {}),
      }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível criar o DB', description: result.error.message });
      return;
    }
    onOpenChange(false);
    onCreated(result.data.changeRequestId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Diário de Bordo</DialogTitle>
          <DialogDescription>
            Nasce em rascunho. Motivadores, itens, impactos, critérios de aceite, testes e vigência entram na
            tela seguinte.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-db-title">Título</Label>
            <Input
              id="new-db-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Goodlist passa a olhar o valor do pedido"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-db-code">Código</Label>
            <Input
              id="new-db-code"
              value={code}
              onChange={(e) => {
                setCodeTouched(true);
                setCode(e.target.value.toUpperCase());
              }}
              placeholder="DB_515"
              required
            />
            {codeError !== null && <p className="text-xs text-red-600 dark:text-red-400">{codeError}</p>}
            {!codeTouched && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Sugestão sequencial — pode ser trocada por qualquer código único.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={!canCreate} onClick={handleCreate}>
            Criar DB
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
