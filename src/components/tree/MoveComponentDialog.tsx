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
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { moveComponent, subtreeIds } from '@/core/document/components';
import { componentPath } from '@/core/queries';
import { useDocumentStore } from '@/store/document-store';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

const ROOT_VALUE = '__ROOT__';

export interface MoveComponentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  componentId: string;
}

/** "Mover para…" (docs/07-ux-e-editor.md §17.3): destino por busca + início/fim, validado por `component/move`. */
export function MoveComponentDialog({ open, onOpenChange, componentId }: MoveComponentDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const [destination, setDestination] = useState<string>(ROOT_VALUE);
  const [position, setPosition] = useState<'start' | 'end'>('end');

  const component = document?.components.find((candidate) => candidate.id === componentId) ?? null;

  useEffect(() => {
    if (!open || component === null) return;
    setDestination(component.parentId ?? ROOT_VALUE);
    setPosition('end');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- campos escalares de propósito, não o objeto
  }, [open, component?.id, component?.parentId]);

  const options = useMemo<ComboboxOption[]>(() => {
    if (document === null || component === null) return [];
    const blocked = subtreeIds(document, component.id);
    return [
      { value: ROOT_VALUE, label: 'Raiz da política' },
      ...document.components
        .filter(
          (candidate) =>
            candidate.projectId === component.projectId &&
            candidate.archivedAt === undefined &&
            candidate.type !== 'MATRIX' &&
            !blocked.has(candidate.id),
        )
        .map((candidate) => ({
          value: candidate.id,
          label: componentPath(document, candidate.id)
            .map((node) => node.name)
            .join(' › '),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [document, component]);

  if (document === null || component === null) return null;

  function handleConfirm() {
    const parentId = destination === ROOT_VALUE ? null : destination;
    const result = dispatch(
      moveComponent({
        componentId,
        parentId,
        position: position === 'start' ? 0 : undefined,
      }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível mover', description: result.error.message });
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover "{component.name}"</DialogTitle>
          <DialogDescription>
            Escolha o destino na árvore. Mover valida ciclo e o teto de profundidade automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="move-destination">Destino</Label>
            <Combobox
              options={options}
              value={destination}
              onChange={setDestination}
              placeholder="Selecione o destino…"
              searchPlaceholder="Buscar seção…"
              aria-label="Destino"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Posição entre os irmãos</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={position === 'start'}
                className={cn(position === 'start' && 'border-neutral-900 dark:border-neutral-100')}
                onClick={() => setPosition('start')}
              >
                Início
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={position === 'end'}
                className={cn(position === 'end' && 'border-neutral-900 dark:border-neutral-100')}
                onClick={() => setPosition('end')}
              >
                Fim
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm}>
            Mover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
