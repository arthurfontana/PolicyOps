import { useMemo, useState } from 'react';
import { ListTree, Plus, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listVariables } from '@/core/queries';
import type { VariableType } from '@/core/document/schema';
import { VARIABLE_TYPE_LABELS } from '@/lib/variable-types';
import { useDocumentStore } from '@/store/document-store';
import { CreateVariableDialog } from './CreateVariableDialog';

function usageLabel(publishedMatrixCount: number, draftMatrixCount: number): string {
  if (publishedMatrixCount === 0 && draftMatrixCount === 0) return 'sem uso em nenhuma matriz';
  const parts: string[] = [];
  if (publishedMatrixCount > 0) {
    parts.push(`em ${publishedMatrixCount} ${publishedMatrixCount === 1 ? 'matriz vigente' : 'matrizes vigentes'}`);
  }
  if (draftMatrixCount > 0) {
    parts.push(`${draftMatrixCount} ${draftMatrixCount === 1 ? 'rascunho' : 'rascunhos'}`);
  }
  return parts.join(', ');
}

export interface VariablesListProps {
  onSelect: (variableId: string) => void;
}

export function VariablesList({ onSelect }: VariablesListProps) {
  const document = useDocumentStore((s) => s.document);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<VariableType | 'ALL'>('ALL');
  const [createOpen, setCreateOpen] = useState(false);

  const summaries = useMemo(() => {
    if (document === null) return [];
    return listVariables(document, {
      search: search.trim() === '' ? undefined : search,
      type: type === 'ALL' ? undefined : type,
    });
  }, [document, search, type]);

  if (document === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum documento aberto.</p>
      </div>
    );
  }

  const isEmpty = document.variables.filter((v) => v.archivedAt === undefined).length === 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Biblioteca › Variáveis
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Domínios versionados usados nos eixos das matrizes.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Nova variável
        </Button>
      </div>

      {isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ListTree className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Nenhuma variável ainda. Crie a primeira para montar os eixos de uma matriz.
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Nova variável
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-48">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome ou código…"
                className="pl-8"
              />
            </div>
            <Select value={type} onValueChange={(value) => setType(value as VariableType | 'ALL')}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos os tipos</SelectItem>
                {(Object.keys(VARIABLE_TYPE_LABELS) as VariableType[]).map((option) => (
                  <SelectItem key={option} value={option}>
                    {VARIABLE_TYPE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {summaries.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                Nenhuma variável corresponde à busca.
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {summaries.map(
                ({ variable, publishedVersion, draftVersion, publishedMatrixCount, draftMatrixCount }) => (
                  <button
                    key={variable.id}
                    type="button"
                    onClick={() => onSelect(variable.id)}
                    className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                            {variable.name}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-neutral-400">{variable.code}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                          <Badge variant="secondary">{VARIABLE_TYPE_LABELS[variable.type]}</Badge>
                          <span>
                            {publishedVersion === null
                              ? 'sem versão publicada'
                              : `${publishedVersion.domains.length} domínios (v${publishedVersion.number})`}
                          </span>
                          <span aria-hidden>·</span>
                          <span>{usageLabel(publishedMatrixCount, draftMatrixCount)}</span>
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

      <CreateVariableDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={onSelect} />
    </div>
  );
}
