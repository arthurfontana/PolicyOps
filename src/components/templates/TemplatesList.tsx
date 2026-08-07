import { useMemo, useState } from 'react';
import { LayoutTemplate, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { listTemplates } from '@/core/queries';
import { useDocumentStore } from '@/store/document-store';

export interface TemplatesListProps {
  onSelect: (templateId: string) => void;
  onCreate: () => void;
}

/** Rota `/templates` — docs/07-ux-e-editor.md §11. */
export function TemplatesList({ onSelect, onCreate }: TemplatesListProps) {
  const document = useDocumentStore((s) => s.document);
  const [search, setSearch] = useState('');

  const summaries = useMemo(() => {
    if (document === null) return [];
    return listTemplates(document);
  }, [document]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === '') return summaries;
    return summaries.filter(
      ({ template }) =>
        template.code.toLowerCase().includes(query) || template.name.toLowerCase().includes(query),
    );
  }, [summaries, search]);

  if (document === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum documento aberto.</p>
      </div>
    );
  }

  const isEmpty = summaries.length === 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Templates</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Eixos e regras de pré-preenchimento reutilizáveis na criação de matrizes.
          </p>
        </div>
        <Button onClick={onCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> Novo template
        </Button>
      </div>

      {isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <LayoutTemplate className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Nenhum template ainda. Crie um do zero, ou abra uma matriz existente e use "Criar template a
              partir desta matriz".
            </p>
            <Button onClick={onCreate}>
              <Plus className="mr-1.5 h-4 w-4" /> Novo template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="relative min-w-48">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome ou código…"
              className="pl-8"
            />
          </div>

          {filtered.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                Nenhum template corresponde à busca.
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map(({ template, combinations, filledCount, error }) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => onSelect(template.id)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                        {template.name}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-neutral-400">{template.code}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                      <span>
                        {template.axes.x.levels.length} nível(is) em X × {template.axes.y.levels.length} em Y
                      </span>
                      <span aria-hidden>·</span>
                      {error !== null ? (
                        <span className="text-amber-700 dark:text-amber-400">{error}</span>
                      ) : (
                        <span>
                          {filledCount} de {combinations} combinações pré-preenchidas
                        </span>
                      )}
                      <span aria-hidden>·</span>
                      <span>
                        {template.seedRules.length} regra{template.seedRules.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
