import { useEffect, useState, type FormEvent } from 'react';
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
import { createProject, updateProject } from '@/core/document/commands';
import type { Project } from '@/core/document/schema';
import { dateInputToIso, isoToDateInputValue } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';
import { useToast } from '@/components/ui/use-toast';

export interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Presente = editar; ausente = criar. */
  project?: Project | null;
  onSaved?: (projectId: string) => void;
}

/** Criação e edição de projeto em Dialog — docs/07-ux-e-editor.md §1. */
export function CreateProjectDialog({
  open,
  onOpenChange,
  project = null,
  onSaved,
}: CreateProjectDialogProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [foundationEffectiveFrom, setFoundationEffectiveFrom] = useState('');

  useEffect(() => {
    if (!open) return;
    setCode(project?.code ?? '');
    setName(project?.name ?? '');
    setDescription(project?.description ?? '');
    setFoundationEffectiveFrom(
      project?.foundationEffectiveFrom !== undefined ? isoToDateInputValue(project.foundationEffectiveFrom) : '',
    );
  }, [open, project]);

  const isEdit = project !== null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isEdit) {
      const result = dispatch(
        updateProject({
          projectId: project.id,
          name: name.trim(),
          description: description.trim() === '' ? null : description.trim(),
          foundationEffectiveFrom: foundationEffectiveFrom === '' ? null : dateInputToIso(foundationEffectiveFrom),
        }),
      );
      if (!result.ok) {
        toast({ title: 'Não foi possível salvar o projeto', description: result.error.message });
        return;
      }
      onOpenChange(false);
      onSaved?.(project.id);
      return;
    }

    const createResult = dispatch(
      createProject({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        ...(description.trim() !== '' ? { description: description.trim() } : {}),
      }),
    );
    if (!createResult.ok) {
      toast({ title: 'Não foi possível criar o projeto', description: createResult.error.message });
      return;
    }
    if (foundationEffectiveFrom !== '') {
      dispatch(
        updateProject({
          projectId: createResult.data.projectId,
          foundationEffectiveFrom: dateInputToIso(foundationEffectiveFrom),
        }),
      );
    }
    onOpenChange(false);
    onSaved?.(createResult.data.projectId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar projeto' : 'Novo projeto'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Altera nome e descrição — o código não muda depois de criado.'
              : 'Agrupa matrizes relacionadas, como as políticas de uma linha de produto.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {!isEdit && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-project-code">Código</Label>
              <Input
                id="new-project-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="POLITICA_PJ"
                required
                autoFocus
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-name">Nome</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Política PJ"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-description">Descrição (opcional)</Label>
            <Input
              id="project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-foundation-effective-from">Vigência da fundação (opcional)</Label>
            <Input
              id="project-foundation-effective-from"
              type="date"
              value={foundationEffectiveFrom}
              onChange={(event) => setFoundationEffectiveFrom(event.target.value)}
            />
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Sugerida como vigência da primeira versão de cada componente novo, e usada por "Publicar
              pendentes" na árvore — sempre editável ao publicar.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit">{isEdit ? 'Salvar' : 'Criar projeto'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
