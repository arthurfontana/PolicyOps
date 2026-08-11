import { useMemo } from 'react';
import { PencilLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { getErrorMessage } from '@/core/error-messages';
import { summaryToText } from '@/core/diff/semantics';
import { diffVersions } from '@/core/diff';
import { getImportOrigin, listImportRuns, listOpenDrafts } from '@/core/queries';
import { getStaleAxes } from '@/core/reconcile/stale';
import { publishVersion } from '@/core/versioning/lifecycle';
import { formatDateBR, formatDateTimeBR } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/**
 * `/drafts` — docs/prompts/S13-ciclo-de-vida.md item 5, e a **fila de revisão**
 * da carga (docs/12-carga-de-matrizes.md §6.2, US-07).
 *
 * A mesma tela serve os dois papéis: sem filtro, é a lista de tudo o que está
 * em andamento; filtrada por `importRunId`, é a fila daquela carga, com o
 * resumo semântico, "marcar como revisado" e a publicação em lote **só dos
 * revisados** (CT-15). A carga nunca publica sozinha (RN-10) — quem publica é
 * quem revisou.
 */
export function DraftsScreen() {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const openMatrix = useEditorStore((s) => s.openMatrix);
  const setCompareVersions = useEditorStore((s) => s.setCompareVersions);
  const setView = useUiStore((s) => s.setView);
  const importRunFilter = useUiStore((s) => s.importRunFilter);
  const setImportRunFilter = useUiStore((s) => s.setImportRunFilter);
  const reviewedVersionIds = useUiStore((s) => s.reviewedVersionIds);
  const toggleReviewed = useUiStore((s) => s.toggleReviewed);
  const clearReviewed = useUiStore((s) => s.clearReviewed);
  const { toast } = useToast();

  const allDrafts = useMemo(() => (document === null ? [] : listOpenDrafts(document)), [document]);
  const runs = useMemo(() => (document === null ? [] : listImportRuns(document)), [document]);

  /** A carga que criou cada rascunho — `null` quando ele nasceu à mão (US-10). */
  const originByVersion = useMemo(() => {
    const byVersion = new Map<string, ReturnType<typeof getImportOrigin>>();
    if (document === null) return byVersion;
    for (const entry of allDrafts) {
      byVersion.set(entry.version.id, getImportOrigin(document, entry.version.id));
    }
    return byVersion;
  }, [document, allDrafts]);

  const drafts = useMemo(() => {
    if (importRunFilter === null) return allDrafts;
    return allDrafts.filter(
      (entry) => originByVersion.get(entry.version.id)?.importRunId === importRunFilter,
    );
  }, [allDrafts, importRunFilter, originByVersion]);

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

  /** O resumo semântico do rascunho contra a versão que ele substitui (§4.3). */
  const summaryByVersion = useMemo(() => {
    const byVersion = new Map<string, string[]>();
    if (document === null) return byVersion;
    for (const entry of drafts) {
      const baseId = entry.version.baseVersionId;
      if (baseId === undefined) continue;
      try {
        const diff = diffVersions(document, baseId, entry.version.id);
        if (diff.comparable) byVersion.set(entry.version.id, summaryToText(diff.summary));
      } catch {
        // Base ausente ou incomparável: a linha só não mostra o resumo.
      }
    }
    return byVersion;
  }, [document, drafts]);

  if (document === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum documento aberto.</p>
      </div>
    );
  }

  const activeRun = runs.find((run) => run.importRunId === importRunFilter) ?? null;
  const reviewed = new Set(reviewedVersionIds);
  const reviewedHere = drafts.filter((entry) => reviewed.has(entry.version.id));

  function publish(versionId: string, notes: string): boolean {
    const result = dispatch(publishVersion({ versionId, notes }));
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'A publicação foi recusada',
        description: result.error.message || getErrorMessage(result.error.code),
      });
      return false;
    }
    return true;
  }

  /** CT-15: publica em lote só os revisados, para no primeiro erro e diz o que foi. */
  function publishReviewed() {
    const notes = activeRun?.notes ?? '';
    const codes: string[] = [];
    const versionIds: string[] = [];
    for (const entry of reviewedHere) {
      // Para no primeiro erro e informa o que já foi publicado: metade do lote
      // publicada é um fato do documento, não um detalhe a esconder.
      if (!publish(entry.version.id, notes)) break;
      codes.push(entry.matrix.code);
      versionIds.push(entry.version.id);
    }
    clearReviewed(versionIds);
    if (codes.length > 0) {
      toast({
        title: `${codes.length} ${codes.length === 1 ? 'versão publicada' : 'versões publicadas'}`,
        description: codes.join(', '),
      });
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-8">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          {activeRun === null ? 'Rascunhos' : 'Fila de revisão da carga'}
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {activeRun === null
            ? 'Todos os rascunhos abertos, de todos os projetos — o que está em andamento agora.'
            : `Carga ${activeRun.profileCode}${activeRun.fileName === null ? '' : ` · ${activeRun.fileName}`} de ${formatDateBR(activeRun.at)} — revise cada rascunho antes de publicar.`}
        </p>
      </div>

      {runs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-neutral-500 dark:text-neutral-400">Filtrar por carga:</span>
          <Button
            type="button"
            size="sm"
            variant={importRunFilter === null ? 'default' : 'outline'}
            onClick={() => setImportRunFilter(null)}
          >
            Todos
          </Button>
          {runs.slice(0, 5).map((run) => (
            <Button
              key={run.importRunId}
              type="button"
              size="sm"
              variant={importRunFilter === run.importRunId ? 'default' : 'outline'}
              data-testid={`draft-run-filter-${run.importRunId}`}
              onClick={() => setImportRunFilter(run.importRunId)}
            >
              {run.profileCode} · {formatDateBR(run.at)}
            </Button>
          ))}
        </div>
      )}

      {activeRun !== null && drafts.length > 0 && (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            disabled={reviewedHere.length === 0}
            data-testid="publish-reviewed"
            onClick={publishReviewed}
          >
            Publicar {reviewedHere.length} {reviewedHere.length === 1 ? 'revisado' : 'revisados'}
          </Button>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {reviewedHere.length} de {drafts.length} marcados como revisados.
          </span>
        </div>
      )}

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <PencilLine className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {activeRun === null
                ? 'Nenhum rascunho aberto no momento.'
                : 'Todos os rascunhos desta carga já foram publicados ou descartados.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {drafts.map(({ matrix, project, version, pendingCells }) => {
            const origin = originByVersion.get(version.id) ?? null;
            const phrases = summaryByVersion.get(version.id) ?? [];
            const isReviewed = reviewed.has(version.id);
            return (
              <div
                key={version.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
                data-testid={`draft-item-${matrix.code}`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    openMatrix(matrix.id, version.id);
                    setView('matrix');
                  }}
                >
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
                  {origin !== null && (
                    <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                      Criado pela carga {origin.profileCode} em {formatDateBR(origin.at)}
                    </p>
                  )}
                  {phrases.length > 0 && (
                    <p className="truncate text-xs text-neutral-600 dark:text-neutral-300">
                      {phrases.join(' · ')}
                    </p>
                  )}
                </button>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex items-center gap-1">
                    {version.baseVersionId !== undefined && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          openMatrix(matrix.id, version.id);
                          setCompareVersions(version.baseVersionId!, version.id);
                          setView('compare');
                        }}
                      >
                        Ver diff
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant={isReviewed ? 'default' : 'outline'}
                      data-testid={`review-${matrix.code}`}
                      onClick={() => toggleReviewed(version.id)}
                    >
                      {isReviewed ? 'Revisado' : 'Marcar como revisado'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      data-testid={`publish-${matrix.code}`}
                      onClick={() => {
                        if (publish(version.id, origin?.notes ?? '')) {
                          clearReviewed([version.id]);
                        }
                      }}
                    >
                      Publicar
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
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
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
