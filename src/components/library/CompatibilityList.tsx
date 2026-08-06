import { useMemo, useState } from 'react';
import { ArrowRight, Plus, Search, Shuffle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { listCompatibilityRules } from '@/core/queries';
import { useDocumentStore } from '@/store/document-store';
import { CreateCompatibilityDialog } from './CreateCompatibilityDialog';

function usageLabel(usageCount: number): string {
  if (usageCount === 0) return 'sem uso em nenhum eixo';
  return `usada em ${usageCount} ${usageCount === 1 ? 'eixo' : 'eixos'}`;
}

export interface CompatibilityListProps {
  onSelect: (ruleId: string) => void;
}

/** Rota `/library/compatibility` — docs/07-ux-e-editor.md §11. */
export function CompatibilityList({ onSelect }: CompatibilityListProps) {
  const document = useDocumentStore((s) => s.document);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const summaries = useMemo(() => {
    if (document === null) return [];
    return listCompatibilityRules(document, { search: search.trim() === '' ? undefined : search });
  }, [document, search]);

  if (document === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum documento aberto.</p>
      </div>
    );
  }

  const isEmpty = document.compatibility.filter((r) => r.archivedAt === undefined).length === 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Biblioteca › Compatibilidade
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Regras que declaram, para um par de variáveis, quais combinações existem.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Nova regra
        </Button>
      </div>

      {isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Shuffle className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Nenhuma regra de compatibilidade ainda. Crie a primeira para declarar quais combinações
              existem entre duas variáveis.
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Nova regra
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

          {summaries.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                Nenhuma regra corresponde à busca.
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {summaries.map(
                ({ rule, parentVariable, childVariable, publishedVersion, draftVersion, validCombinations, totalCombinations, usageCount }) => (
                  <button
                    key={rule.id}
                    type="button"
                    onClick={() => onSelect(rule.id)}
                    className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                            {rule.name}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-neutral-400">{rule.code}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                          <span className="flex items-center gap-1">
                            {parentVariable?.name ?? '?'}
                            <ArrowRight className="h-3 w-3" aria-hidden />
                            {childVariable?.name ?? '?'}
                          </span>
                          <span aria-hidden>·</span>
                          <span>
                            {publishedVersion === null
                              ? 'sem versão publicada'
                              : `${validCombinations} de ${totalCombinations} combinações válidas (v${publishedVersion.number})`}
                          </span>
                          <span aria-hidden>·</span>
                          <span>{usageLabel(usageCount)}</span>
                        </div>
                      </div>
                    </div>
                    {draftVersion !== null && <Badge variant="amber">rascunho aberto</Badge>}
                  </button>
                ),
              )}
            </div>
          )}
        </>
      )}

      <CreateCompatibilityDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={onSelect} />
    </div>
  );
}
