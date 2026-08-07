import { useState, type FormEvent } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { createVariable } from '@/core/library/variables';
import type { VariableType } from '@/core/document/schema';
import { VARIABLE_TYPE_LABELS } from '@/lib/variable-types';
import { useDocumentStore } from '@/store/document-store';

export interface CreateVariableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (variableId: string) => void;
  /** Só aparece o link "Criar a partir de existente" quando informado (docs/07 §11). */
  onWantDuplicate?: () => void;
}

export function CreateVariableDialog({ open, onOpenChange, onCreated, onWantDuplicate }: CreateVariableDialogProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<VariableType>('CATEGORICAL');
  const [description, setDescription] = useState('');

  function reset() {
    setCode('');
    setName('');
    setType('CATEGORICAL');
    setDescription('');
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const result = dispatch(
      createVariable({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        type,
        ...(description.trim() !== '' ? { description: description.trim() } : {}),
      }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível criar a variável', description: result.error.message });
      return;
    }
    reset();
    onOpenChange(false);
    onCreated(result.data.variableId);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova variável</DialogTitle>
          <DialogDescription>
            Cria a variável com a versão 1 em rascunho, sem domínios — você os adiciona em seguida.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-variable-code">Código</Label>
            <Input
              id="new-variable-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="SCORE_HVI3"
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-variable-name">Nome</Label>
            <Input
              id="new-variable-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Score HVI3"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-variable-type">Tipo</Label>
            <Select value={type} onValueChange={(value) => setType(value as VariableType)}>
              <SelectTrigger id="new-variable-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(VARIABLE_TYPE_LABELS) as VariableType[]).map((option) => (
                  <SelectItem key={option} value={option}>
                    {VARIABLE_TYPE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-variable-description">Descrição (opcional)</Label>
            <Input
              id="new-variable-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {onWantDuplicate !== undefined && (
            <button
              type="button"
              className="self-start text-xs text-neutral-500 underline-offset-2 hover:underline dark:text-neutral-400"
              onClick={() => {
                reset();
                onOpenChange(false);
                onWantDuplicate();
              }}
            >
              Ou crie a partir de uma variável existente
            </button>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit">Criar variável</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
