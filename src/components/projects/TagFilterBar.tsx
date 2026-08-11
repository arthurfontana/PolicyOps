import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { TagFacetGroup } from '@/core/queries';
import { cn } from '@/lib/utils';

export interface TagFilterBarProps {
  facets: TagFacetGroup[];
  selected: string[];
  onToggle: (code: string) => void;
  onClear: () => void;
}

/**
 * Faixa de filtro por facetas de tag — docs/07-ux-e-editor.md §15: uma linha
 * por grupo, `OU` dentro do grupo (marcar duas tags do mesmo grupo soma),
 * `E` entre grupos. Cada opção mostra a contagem; o filtro ativo aparece
 * como chips removíveis com "limpar tudo".
 */
export function TagFilterBar({ facets, selected, onToggle, onClear }: TagFilterBarProps) {
  const selectedSet = new Set(selected);
  const hasFacets = facets.some((group) => group.options.length > 0);
  if (!hasFacets) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      {facets.map((group) => (
        <div key={group.group} className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {group.group}
          </span>
          {group.options.map((option) => {
            const isSelected = selectedSet.has(option.code);
            return (
              <button
                key={option.code}
                type="button"
                onClick={() => onToggle(option.code)}
                aria-pressed={isSelected}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  isSelected
                    ? 'border-neutral-900 bg-neutral-900 text-neutral-50 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                    : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800',
                )}
              >
                {option.label} <span className="opacity-60">({option.count})</span>
              </button>
            );
          })}
        </div>
      ))}

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-neutral-200 pt-2 dark:border-neutral-800">
          {selected.map((code) => {
            const option = facets.flatMap((group) => group.options).find((candidate) => candidate.code === code);
            return (
              <Badge key={code} variant="secondary" className="gap-1 pr-1">
                <span>{option?.label ?? code}</span>
                <button
                  type="button"
                  aria-label={`Remover o filtro ${option?.label ?? code}`}
                  onClick={() => onToggle(code)}
                  className="rounded-full p-0.5 hover:bg-neutral-300/60 dark:hover:bg-neutral-700"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClear}>
            Limpar tudo
          </Button>
        </div>
      )}
    </div>
  );
}
