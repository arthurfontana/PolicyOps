import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
import { duplicateVariable } from '@/core/library/variables';
import { VARIABLE_TYPE_LABELS } from '@/lib/variable-types';
import { useDocumentStore } from '@/store/document-store';

/**
 * "Criar a partir de existente" — docs/07-ux-e-editor.md §11, docs/05 §5.6.3.
 * Seletor de variável + versão de origem, formulário de código/nome/descrição
 * da nova, e chama `variable/duplicate`. A variável nasce com os domínios (e
 * os agrupamentos, se houver) já copiados.
 */

export interface DuplicateVariableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (variableId: string) => void;
}

export function DuplicateVariableDialog({ open, onOpenChange, onCreated }: DuplicateVariableDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const sourceVariables = useMemo(
    () => (document?.variables ?? []).filter((variable) => variable.archivedAt === undefined),
    [document],
  );

  const [sourceVariableId, setSourceVariableId] = useState('');
  const [sourceVersionId, setSourceVersionId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const sourceVariable = sourceVariables.find((variable) => variable.id === sourceVariableId) ?? null;
  const sourceVersions = useMemo(
    () => [...(sourceVariable?.versions ?? [])].sort((a, b) => b.number - a.number),
    [sourceVariable],
  );

  useEffect(() => {
    if (sourceVariable === null) {
      setSourceVersionId('');
      return;
    }
    if (!sourceVariable.versions.some((version) => version.id === sourceVersionId)) {
      setSourceVersionId(sourceVersions[0]?.id ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceVariableId]);

  function reset() {
    setSourceVariableId('');
    setSourceVersionId('');
    setCode('');
    setName('');
    setDescription('');
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const result = dispatch(
      duplicateVariable({
        sourceVariableId,
        sourceVersionId,
        code: code.trim().toUpperCase(),
        name: name.trim(),
        ...(description.trim() !== '' ? { description: description.trim() } : {}),
      }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível duplicar a variável', description: result.error.message });
      return;
    }
    reset();
    onOpenChange(false);
    onCreated(result.data.variableId);
  }

  const canSubmit = sourceVariableId !== '' && sourceVersionId !== '' && code.trim() !== '' && name.trim() !== '';

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
          <DialogTitle>Criar a partir de existente</DialogTitle>
          <DialogDescription>
            Copia os domínios (e os agrupamentos, se houver) de uma versão de outra variável, pronta
            para ajustar em vez de montar do zero.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="duplicate-source-variable">Variável de origem</Label>
            <Select value={sourceVariableId} onValueChange={setSourceVariableId}>
              <SelectTrigger id="duplicate-source-variable">
                <SelectValue placeholder="Selecione uma variável" />
              </SelectTrigger>
              <SelectContent>
                {sourceVariables.map((variable) => (
                  <SelectItem key={variable.id} value={variable.id}>
                    {variable.name} ({variable.code}) — {VARIABLE_TYPE_LABELS[variable.type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="duplicate-source-version">Versão de origem</Label>
            <Select value={sourceVersionId} onValueChange={setSourceVersionId} disabled={sourceVariable === null}>
              <SelectTrigger id="duplicate-source-version">
                <SelectValue placeholder="Selecione uma versão" />
              </SelectTrigger>
              <SelectContent>
                {sourceVersions.map((version) => (
                  <SelectItem key={version.id} value={version.id}>
                    v{version.number} · {version.state} — {version.domains.length} domínio(s)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="duplicate-code">Código da nova variável</Label>
            <Input
              id="duplicate-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="SCORE_HVI2"
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="duplicate-name">Nome</Label>
            <Input
              id="duplicate-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Score HVI2"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="duplicate-description">Descrição (opcional)</Label>
            <Input
              id="duplicate-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Criar variável
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
