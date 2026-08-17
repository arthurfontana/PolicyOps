import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { createCatalogItem } from '@/core/library/catalog';
import { CODE_REGEX, type CatalogItemKind } from '@/core/document/schema';
import { normalizeValue } from '@/core/import/profile';
import { useDocumentStore } from '@/store/document-store';
import { useToast } from '@/components/ui/use-toast';

/** `code` único dentro do kind, derivado do rótulo — mesma regra de `ComponentTagsEditor`/`MatrixTagsEditor`. */
function uniqueCode(label: string, existingCodes: Set<string>): string {
  const base = normalizeValue(label) || 'ITEM';
  if (!existingCodes.has(base)) return base;
  let suffix = 2;
  while (existingCodes.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

export interface CatalogChipPickerProps {
  /** `MOTIVATOR` (docs/14 §3.3) ou `IMPACT_CATEGORY` (§3.3, item de impacto). */
  kind: CatalogItemKind;
  selected: string[];
  onChange: (codes: string[]) => void;
  /** Rótulo do botão "+ X" e do placeholder de busca. */
  itemLabel: string;
  disabled?: boolean;
}

/**
 * Multi-seleção de `CatalogItem` com criação inline — o mesmo padrão de tag
 * da S23 (`ComponentTagsEditor`), generalizado para qualquer `kind` sem
 * grupo: motivadores e categorias de impacto do DB (docs/14 §3.3, US-GOV-03).
 * Ao contrário do editor de tags, este é controlado: quem chama decide onde
 * a lista de codes é gravada (`ChangeRequest.motivators`, aqui; a categoria
 * de um item de impacto individual, em `ImpactsEditor`).
 */
export function CatalogChipPicker({ kind, selected, onChange, itemLabel, disabled = false }: CatalogChipPickerProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  if (document === null) return null;

  const items = document.catalog.filter((item) => item.kind === kind);
  const activeItems = items.filter((item) => item.archivedAt === undefined);
  const byCode = new Map(items.map((item) => [item.code, item]));

  const q = query.trim().toLowerCase();
  const suggestions = activeItems
    .filter((item) => !selected.includes(item.code))
    .filter((item) => q === '' || item.label.toLowerCase().includes(q) || item.code.toLowerCase().includes(q))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

  const trimmedQuery = query.trim();
  const canOfferCreate =
    trimmedQuery.length > 0 && !items.some((item) => item.label.toLowerCase() === trimmedQuery.toLowerCase());

  function add(code: string) {
    if (!selected.includes(code)) onChange([...selected, code]);
    setQuery('');
  }

  function remove(code: string) {
    onChange(selected.filter((candidate) => candidate !== code));
  }

  function createAndAdd() {
    const label = trimmedQuery;
    if (label.length === 0) return;
    if (!CODE_REGEX.test(label) && normalizeValue(label) === '') {
      toast({ title: `Não foi possível criar ${itemLabel.toLowerCase()}`, description: 'Digite um nome com ao menos uma letra ou número.' });
      return;
    }
    const code = uniqueCode(label, new Set(items.map((item) => item.code)));
    const created = dispatch(createCatalogItem({ kind, code, label }));
    if (!created.ok) {
      toast({ title: `Não foi possível criar ${itemLabel.toLowerCase()}`, description: created.error.message });
      return;
    }
    add(code);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {selected.map((code) => {
        const item = byCode.get(code);
        return (
          <Badge key={code} variant="secondary" className="gap-1 pr-1">
            <span>{item?.label ?? code}</span>
            {item?.archivedAt !== undefined && <span className="text-neutral-400">(arquivado)</span>}
            {!disabled && (
              <button
                type="button"
                aria-label={`Remover ${item?.label ?? code}`}
                onClick={() => remove(code)}
                className="rounded-full p-0.5 hover:bg-neutral-300/60 dark:hover:bg-neutral-700"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        );
      })}

      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs">
              <Plus className="h-3 w-3" /> {itemLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" align="start">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Buscar ou criar ${itemLabel.toLowerCase()}…`}
              className="mb-2"
            />
            <ul role="listbox" aria-label={itemLabel} className="max-h-48 overflow-auto">
              {suggestions.map((item) => (
                <li key={item.code}>
                  <button
                    type="button"
                    role="option"
                    onClick={() => add(item.code)}
                    className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <span className="truncate">{item.label}</span>
                  </button>
                </li>
              ))}
              {suggestions.length === 0 && !canOfferCreate && (
                <li className="px-2 py-1.5 text-sm text-neutral-500 dark:text-neutral-400">Nenhum resultado.</li>
              )}
            </ul>
            {canOfferCreate && (
              <div className="mt-2 flex flex-col gap-1.5 border-t border-neutral-200 pt-2 dark:border-neutral-800">
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Criar {itemLabel.toLowerCase()} «{trimmedQuery}»
                </p>
                <Button type="button" size="sm" onClick={createAndAdd}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Criar e marcar
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
