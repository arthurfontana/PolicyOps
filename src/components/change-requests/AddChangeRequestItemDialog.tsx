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
import { componentPath, filterComponentTree } from '@/core/queries';
import type { PolicyComponent } from '@/core/document/schema';
import { COMPONENT_TYPE_ICONS, COMPONENT_TYPE_LABELS } from '@/lib/component-labels';
import { useDocumentStore } from '@/store/document-store';

export interface AddChangeRequestItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Componentes já presentes no DB — RN-GOV-02, um componente entra uma vez só. */
  excludeComponentIds: string[];
  onPick: (componentId: string) => void;
}

/**
 * Seletor de componente para item do DB (US-GOV-03) — o mesmo padrão de
 * busca + lista clicável de `AddMatrixNodeDialog` (docs/07 §17.2), sobre a
 * árvore do projeto (`filterComponentTree`) em vez das matrizes livres.
 */
export function AddChangeRequestItemDialog({
  open,
  onOpenChange,
  projectId,
  excludeComponentIds,
  onPick,
}: AddChangeRequestItemDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  const excluded = useMemo(() => new Set(excludeComponentIds), [excludeComponentIds]);

  const candidates = useMemo<PolicyComponent[]>(() => {
    if (document === null) return [];
    const { matchedIds } = filterComponentTree(document, projectId, { search });
    return document.components.filter((component) => matchedIds.has(component.id) && !excluded.has(component.id));
  }, [document, projectId, search, excluded]);

  if (document === null) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar item ao DB</DialogTitle>
          <DialogDescription>
            Escolha o componente afetado — regra, matriz, lista, reason code ou variável de política. Um
            componente entra uma vez só neste DB (RN-GOV-02).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            placeholder="Buscar por código ou nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />

          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto" role="listbox" aria-label="Componentes disponíveis">
            {candidates.length === 0 && (
              <li className="rounded-md bg-neutral-50 p-3 text-center text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                Nenhum componente corresponde ao filtro.
              </li>
            )}
            {candidates.map((component) => {
              const Icon = COMPONENT_TYPE_ICONS[component.type];
              const path = componentPath(document, component.id);
              const breadcrumb = path.slice(0, -1).map((ancestor) => ancestor.name).join(' › ');
              return (
                <li key={component.id}>
                  <button
                    type="button"
                    role="option"
                    onClick={() => {
                      onOpenChange(false);
                      onPick(component.id);
                    }}
                    className="flex w-full items-start gap-2 rounded-md border border-neutral-200 p-2 text-left text-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                          {component.name}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-neutral-400">{component.code}</span>
                      </div>
                      {breadcrumb.length > 0 && (
                        <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">{breadcrumb}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-neutral-400">{COMPONENT_TYPE_LABELS[component.type]}</span>
                  </button>
                </li>
              );
            })}
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
