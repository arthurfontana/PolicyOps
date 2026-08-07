import { useMemo } from 'react';
import { PencilLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { listOpenDrafts } from '@/core/queries';
import { getStaleAxes } from '@/core/reconcile/stale';
import { formatDateTimeBR } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/**
 * `/drafts` — docs/prompts/S13-ciclo-de-vida.md item 5. Todos os rascunhos
 * abertos de todos os projetos, para o time saber o que está em andamento.
 */
export function DraftsScreen() {
  const document = useDocumentStore((s) => s.document);
  const openMatrix = useEditorStore((s) => s.openMatrix);
  const setView = useUiStore((s) => s.setView);

  const drafts = useMemo(() => (document === null ? [] : listOpenDrafts(document)), [document]);

  /**
   * Rascunhos com eixo defasado — docs/05 §5.2. A tela de rascunhos é onde o
   * time vê o que está em andamento; a defasagem é parte disso.
   */
  const staleByVersion = useMemo(() => {
    const byVersion = new Map<string, number>();
    if (document === null) return byVersion;
    for (const entry of getStaleAxes(document)) {
      byVersion.set(entry.versionId, (byVersion.get(entry.versionId) ?? 0) + 1);
    }
    return byVersion;
  }, [document]);

  if (document === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum documento aberto.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-8">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Rascunhos</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Todos os rascunhos abertos, de todos os projetos — o que está em andamento agora.
        </p>
      </div>

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <PencilLine className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Nenhum rascunho aberto no momento.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {drafts.map(({ matrix, project, version, pendingCells }) => (
            <button
              key={version.id}
              type="button"
              onClick={() => {
                openMatrix(matrix.id, version.id);
                setView('matrix');
              }}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                    {matrix.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-neutral-400">{matrix.code}</span>
                  <span className="shrink-0 text-xs text-neutral-400">v{version.number}</span>
                </div>
                <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {project?.name ?? 'sem projeto'} · criado por {version.createdBy} em{' '}
                  {formatDateTimeBR(version.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge variant="amber">Rascunho</Badge>
                {(staleByVersion.get(version.id) ?? 0) > 0 && (
                  <Badge variant="amber" data-testid="draft-stale-badge">
                    {staleByVersion.get(version.id) === 1
                      ? '1 eixo defasado'
                      : `${staleByVersion.get(version.id)} eixos defasados`}
                  </Badge>
                )}
                {pendingCells > 0 && (
                  <Badge variant="secondary">
                    {pendingCells} {pendingCells === 1 ? 'pendência' : 'pendências'}
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
