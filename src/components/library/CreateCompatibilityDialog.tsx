import { useMemo, useState, type FormEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { createCompatibility } from '@/core/library/compatibility';
import { useDocumentStore } from '@/store/document-store';

export interface CreateCompatibilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (ruleId: string) => void;
}

/** Criação da regra — docs/07-ux-e-editor.md §11: só variáveis com versão publicada podem ser pai ou filho. */
export function CreateCompatibilityDialog({ open, onOpenChange, onCreated }: CreateCompatibilityDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentVariableId, setParentVariableId] = useState('');
  const [childVariableId, setChildVariableId] = useState('');

  const eligibleVariables = useMemo(() => {
    if (document === null) return [];
    return document.variables.filter(
      (variable) =>
        variable.archivedAt === undefined && variable.versions.some((version) => version.state === 'PUBLISHED'),
    );
  }, [document]);

  const options = eligibleVariables.map((variable) => ({
    value: variable.id,
    label: `${variable.name} (${variable.code})`,
  }));

  function reset() {
    setCode('');
    setName('');
    setDescription('');
    setParentVariableId('');
    setChildVariableId('');
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const result = dispatch(
      createCompatibility({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        parentVariableId,
        childVariableId,
        ...(description.trim() !== '' ? { description: description.trim() } : {}),
      }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível criar a regra', description: result.error.message });
      return;
    }
    reset();
    onOpenChange(false);
    onCreated(result.data.ruleId);
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
          <DialogTitle>Nova regra de compatibilidade</DialogTitle>
          <DialogDescription>
            Declara, para um par ordenado de variáveis, quais domínios do filho existem sob cada domínio do
            pai. Só variáveis com versão publicada podem participar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-compat-code">Código</Label>
            <Input
              id="new-compat-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="SEG_X_FATURAMENTO"
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-compat-name">Nome</Label>
            <Input
              id="new-compat-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Segmento × Faixa de Faturamento"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Variável pai</Label>
              <Combobox
                options={options.filter((option) => option.value !== childVariableId)}
                value={parentVariableId}
                onChange={setParentVariableId}
                placeholder="Selecione a variável pai…"
                emptyText="Nenhuma variável com versão publicada."
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Variável filho</Label>
              <Combobox
                options={options.filter((option) => option.value !== parentVariableId)}
                value={childVariableId}
                onChange={setChildVariableId}
                placeholder="Selecione a variável filho…"
                emptyText="Nenhuma variável com versão publicada."
              />
            </div>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            O par é ordenado: {'"'}pai → filho{'"'} é diferente de {'"'}filho → pai{'"'}.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-compat-description">Descrição (opcional)</Label>
            <Input
              id="new-compat-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={parentVariableId === '' || childVariableId === ''}>
              Criar regra
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
