import { useEffect, useState, type FormEvent } from 'react';
import { useUiStore } from '@/store/ui-store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

/**
 * Diálogo de identificação (docs/02-arquitetura.md §6): pede um nome para
 * carimbar o histórico. Não é login — na primeira abertura (sem
 * `policyops.actor` salvo) o diálogo não pode ser fechado sem preencher.
 */
export function IdentityDialog() {
  const open = useUiStore((s) => s.identityDialogOpen);
  const actor = useUiStore((s) => s.actor);
  const setActor = useUiStore((s) => s.setActor);
  const closeIdentityDialog = useUiStore((s) => s.closeIdentityDialog);

  const [name, setName] = useState(actor ?? '');
  const isFirstRun = actor === null;
  const trimmed = name.trim();

  useEffect(() => {
    if (open) setName(actor ?? '');
  }, [open, actor]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed) return;
    setActor(trimmed);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isFirstRun) closeIdentityDialog();
      }}
    >
      <DialogContent
        hideClose={isFirstRun}
        onEscapeKeyDown={(event) => {
          if (isFirstRun) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isFirstRun) event.preventDefault();
        }}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Como você quer ser identificado no histórico?</DialogTitle>
            <DialogDescription>
              Isso é só identificação para carimbar suas edições no histórico — não é login nem controle de
              acesso. É possível trocar depois a qualquer momento pela barra de status.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="actor-name">Nome</Label>
            <Input
              id="actor-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Seu nome"
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={!trimmed}>
              {isFirstRun ? 'Começar' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
