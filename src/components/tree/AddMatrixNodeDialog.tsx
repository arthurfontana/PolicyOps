import { useEffect, useMemo, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
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
import { TagFilterBar } from '@/components/projects/TagFilterBar';
import { createComponent } from '@/core/document/components';
import { listMatrices, listUnmirroredMatrices } from '@/core/queries';
import { useDocumentStore } from '@/store/document-store';
import { useToast } from '@/components/ui/use-toast';

export interface AddMatrixNodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Seção onde o nó `MATRIX` entra — `undefined` é a raiz do projeto. */
  parentId: string | undefined;
  onCreated: (componentId: string) => void;
}

function uniqueMatrixNodeCode(existingCodes: Set<string>, matrixCode: string): string {
  if (!existingCodes.has(matrixCode)) return matrixCode;
  let suffix = 2;
  let candidate = `${matrixCode}_${suffix}`;
  while (existingCodes.has(candidate)) {
    suffix += 1;
    candidate = `${matrixCode}_${suffix}`;
  }
  return candidate;
}

/**
 * Seletor de matriz existente para virar nó `MATRIX` (docs/07-ux-e-editor.md
 * §17.2, I27): busca + filtro por tag sobre as matrizes do projeto **ainda
 * não referenciadas** na árvore — a árvore nunca cria matriz, só aponta.
 */
export function AddMatrixNodeDialog({ open, onOpenChange, projectId, parentId, onCreated }: AddMatrixNodeDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setTags([]);
  }, [open]);

  const { candidates, facets } = useMemo(() => {
    if (document === null) return { candidates: [], facets: [] };
    const unmirroredIds = new Set(listUnmirroredMatrices(document, projectId).map((matrix) => matrix.id));
    const { matrices, facets: allFacets } = listMatrices(document, { projectId, tags, search });
    return { candidates: matrices.filter((matrix) => unmirroredIds.has(matrix.id)), facets: allFacets };
  }, [document, projectId, tags, search]);

  if (document === null) return null;

  function handlePick(matrixId: string) {
    const matrix = document!.matrices.find((candidate) => candidate.id === matrixId);
    if (matrix === undefined) return;
    const existingCodes = new Set(document!.components.map((component) => component.code));
    const code = uniqueMatrixNodeCode(existingCodes, matrix.code);
    const result = dispatch(
      createComponent({
        projectId,
        code,
        name: matrix.name,
        type: 'MATRIX',
        matrixId,
        ...(parentId === undefined ? {} : { parentId }),
      }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível pendurar a matriz', description: result.error.message });
      return;
    }
    onOpenChange(false);
    onCreated(result.data.componentId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pendurar matriz existente</DialogTitle>
          <DialogDescription>
            Escolha entre as matrizes do projeto ainda não referenciadas na árvore. A árvore só aponta —
            para criar uma matriz nova, use "Nova matriz" na lista de matrizes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            placeholder="Buscar por código ou nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <TagFilterBar facets={facets} selected={tags} onToggle={(code) => setTags((prev) => prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code])} onClear={() => setTags([])} />

          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto" role="listbox" aria-label="Matrizes disponíveis">
            {candidates.length === 0 && (
              <li className="rounded-md bg-neutral-50 p-3 text-center text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                Nenhuma matriz livre corresponde ao filtro.
              </li>
            )}
            {candidates.map((matrix) => (
              <li key={matrix.id}>
                <button
                  type="button"
                  role="option"
                  onClick={() => handlePick(matrix.id)}
                  className="flex w-full items-center gap-2 rounded-md border border-neutral-200 p-2 text-left text-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
                >
                  <Grid3x3 className="h-4 w-4 shrink-0 text-neutral-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-neutral-900 dark:text-neutral-100">{matrix.name}</div>
                    <div className="font-mono text-xs text-neutral-400">{matrix.code}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
