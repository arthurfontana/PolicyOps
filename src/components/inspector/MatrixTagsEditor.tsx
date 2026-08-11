import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { setMatrixTags } from '@/core/document/commands';
import { createCatalogItem } from '@/core/library/catalog';
import { CODE_REGEX, type CatalogItem, type Matrix } from '@/core/document/schema';
import { normalizeValue } from '@/core/import/profile';
import { useDocumentStore } from '@/store/document-store';
import { useToast } from '@/components/ui/use-toast';

const UNGROUPED_LABEL = 'Sem grupo';

/** `code` único dentro do kind TAG, derivado do rótulo (docs/07 §15). */
function uniqueTagCode(label: string, existingCodes: Set<string>): string {
  const base = normalizeValue(label) || 'TAG';
  if (!existingCodes.has(base)) return base;
  let suffix = 2;
  while (existingCodes.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

/**
 * Campo de tags do inspector da matriz (docs/07-ux-e-editor.md §15):
 * autocompletar sobre o catálogo de kind TAG mostrando o grupo, criação
 * inline com seletor de grupo, e remoção por chip. Criar tag aqui cria o
 * `CatalogItem`; remover da matriz não apaga o item do catálogo.
 */
export function MatrixTagsEditor({ matrix }: { matrix: Matrix }) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [newGroup, setNewGroup] = useState('');

  const tagItems = useMemo(
    () => (document === null ? [] : document.catalog.filter((item): item is CatalogItem => item.kind === 'TAG')),
    [document],
  );
  const activeTagItems = tagItems.filter((item) => item.archivedAt === undefined);
  const byCode = new Map(tagItems.map((item) => [item.code, item]));
  const currentTags = matrix.tags ?? [];
  const groups = [...new Set(activeTagItems.map((item) => item.group).filter((g): g is string => !!g))].sort();

  const q = query.trim().toLowerCase();
  const suggestions = activeTagItems
    .filter((item) => !currentTags.includes(item.code))
    .filter((item) => q === '' || item.label.toLowerCase().includes(q) || item.code.toLowerCase().includes(q))
    .sort(
      (a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.label.localeCompare(b.label),
    );

  const trimmedQuery = query.trim();
  const canOfferCreate =
    trimmedQuery.length > 0 &&
    !tagItems.some((item) => item.label.toLowerCase() === trimmedQuery.toLowerCase());

  if (document === null) return null;

  function addTag(code: string) {
    const result = dispatch(setMatrixTags({ matrixId: matrix.id, add: [code] }));
    if (!result.ok) {
      toast({ title: 'Não foi possível marcar a tag', description: result.error.message });
      return;
    }
    setQuery('');
  }

  function removeTag(code: string) {
    const result = dispatch(setMatrixTags({ matrixId: matrix.id, remove: [code] }));
    if (!result.ok) {
      toast({ title: 'Não foi possível remover a tag', description: result.error.message });
    }
  }

  function createAndAdd() {
    const label = trimmedQuery;
    if (label.length === 0) return;
    if (!CODE_REGEX.test(label) && normalizeValue(label) === '') {
      toast({ title: 'Não foi possível criar a tag', description: 'Digite um nome com ao menos uma letra ou número.' });
      return;
    }
    const code = uniqueTagCode(label, new Set(tagItems.map((item) => item.code)));
    const group = newGroup.trim();
    const created = dispatch(
      createCatalogItem({ kind: 'TAG', code, label, ...(group.length > 0 ? { group } : {}) }),
    );
    if (!created.ok) {
      toast({ title: 'Não foi possível criar a tag', description: created.error.message });
      return;
    }
    const tagged = dispatch(setMatrixTags({ matrixId: matrix.id, add: [code] }));
    if (!tagged.ok) {
      toast({ title: 'Tag criada, mas não foi possível marcar a matriz', description: tagged.error.message });
      return;
    }
    setQuery('');
    setNewGroup('');
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
      <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Tags</span>
      <div className="flex flex-wrap gap-1.5">
        {currentTags.map((code) => {
          const item = byCode.get(code);
          return (
            <Badge key={code} variant="secondary" className="gap-1 pr-1">
              <span>{item?.label ?? code}</span>
              {item?.archivedAt !== undefined && <span className="text-neutral-400">(arquivada)</span>}
              <button
                type="button"
                aria-label={`Remover a tag ${item?.label ?? code}`}
                onClick={() => removeTag(code)}
                className="rounded-full p-0.5 hover:bg-neutral-300/60 dark:hover:bg-neutral-700"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs">
              <Plus className="h-3 w-3" /> Tag
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" align="start">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar ou criar tag…"
              className="mb-2"
            />
            <ul role="listbox" className="max-h-48 overflow-auto">
              {suggestions.map((item) => (
                <li key={item.code}>
                  <button
                    type="button"
                    role="option"
                    onClick={() => addTag(item.code)}
                    className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <span className="truncate">{item.label}</span>
                    <span className="shrink-0 text-xs text-neutral-400">{item.group ?? UNGROUPED_LABEL}</span>
                  </button>
                </li>
              ))}
              {suggestions.length === 0 && !canOfferCreate && (
                <li className="px-2 py-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                  Nenhuma tag encontrada.
                </li>
              )}
            </ul>
            {canOfferCreate && (
              <div className="mt-2 flex flex-col gap-1.5 border-t border-neutral-200 pt-2 dark:border-neutral-800">
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Criar tag «{trimmedQuery}»
                </p>
                <Label htmlFor="new-tag-group" className="text-xs">
                  Grupo (opcional)
                </Label>
                <Input
                  id="new-tag-group"
                  list="matrix-tag-groups"
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                  placeholder={UNGROUPED_LABEL}
                  className="h-8 text-sm"
                />
                <datalist id="matrix-tag-groups">
                  {groups.map((group) => (
                    <option key={group} value={group} />
                  ))}
                </datalist>
                <Button type="button" size="sm" onClick={createAndAdd}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Criar e marcar
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
