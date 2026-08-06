import { useEffect, useMemo } from 'react';
import { ArrowLeft, Minus, Plus, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Grid, MAX_ZOOM, MIN_ZOOM } from '@/components/grid/Grid';
import { getEditorView, listMatrixVersions } from '@/core/queries';
import { useGridSelection } from '@/hooks/useGridSelection';
import { versionBadge } from '@/lib/matrix-badges';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/** Grid vazio: mantém a ordem dos hooks estável quando não há versão aberta. */
const EMPTY_SELECTION_VIEW = { x: { axis: { tuples: [] } }, y: { axis: { tuples: [] } } };

/**
 * Tela de matriz — docs/07-ux-e-editor.md §2, §4, §5; docs/prompts/S09 e S10.
 * Navegação de versão + o grid selecionável. A edição de valores (e o
 * inspector) chega na S11: a seleção funciona em qualquer estado de versão,
 * inclusive publicada, porque selecionar é leitura.
 */
export function MatrixScreen() {
  const document = useDocumentStore((s) => s.document);
  const currentMatrixId = useEditorStore((s) => s.currentMatrixId);
  const currentVersionId = useEditorStore((s) => s.currentVersionId);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const zoomIn = useEditorStore((s) => s.zoomIn);
  const zoomOut = useEditorStore((s) => s.zoomOut);
  const resetZoom = useEditorStore((s) => s.resetZoom);
  const setVersion = useEditorStore((s) => s.setVersion);
  const setSelectedProject = useEditorStore((s) => s.setSelectedProject);
  const setEditable = useEditorStore((s) => s.setEditable);
  const setView = useUiStore((s) => s.setView);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === '0') {
        event.preventDefault();
        resetZoom();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resetZoom]);

  const matrix = document?.matrices.find((candidate) => candidate.id === currentMatrixId) ?? null;
  const versions = useMemo(
    () => (document === null || matrix === null ? [] : listMatrixVersions(document, matrix.id)),
    [document, matrix],
  );
  const view = useMemo(
    () => (document === null || currentVersionId === null ? null : getEditorView(document, currentVersionId)),
    [document, currentVersionId],
  );

  // `isEditable` é só um marcador para a S11 — a seleção funciona igual em
  // versão publicada, que é como se inspeciona uma matriz histórica (§5).
  useEffect(() => {
    setEditable(view?.editable ?? false);
  }, [setEditable, view]);

  // Hooks não podem ficar depois dos retornos antecipados: sem versão aberta a
  // engine recebe um grid vazio e simplesmente não tem o que selecionar.
  const selectionApi = useGridSelection(view ?? EMPTY_SELECTION_VIEW);

  if (document === null || matrix === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhuma matriz aberta.</p>
        <Button onClick={() => setView('projects')}>Ir para projetos</Button>
      </div>
    );
  }

  function backToProject() {
    setSelectedProject(matrix!.projectId);
    setView('projects');
  }

  if (view === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Button variant="ghost" size="icon" className="absolute left-3 top-3" aria-label="Voltar" onClick={backToProject}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          "{matrix.name}" ainda não tem versão publicada nem rascunho para mostrar.
        </p>
      </div>
    );
  }

  const badge = versionBadge(view.version);
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-2 dark:border-neutral-800">
        <Button variant="ghost" size="icon" aria-label="Voltar ao projeto" onClick={backToProject}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="font-semibold text-neutral-900 dark:text-neutral-100">{matrix.name}</h1>
        <span className="font-mono text-xs text-neutral-400">{matrix.code}</span>
        <Badge variant={badge.variant} className={badge.strike ? 'line-through' : undefined}>
          {badge.label}
        </Badge>

        <Select value={view.version.id} onValueChange={setVersion}>
          <SelectTrigger className="ml-2 w-56" aria-label="Selecionar versão">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {versions.map((summary) => (
              <SelectItem key={summary.id} value={summary.id}>
                v{summary.number} · {versionBadge(summary).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Diminuir zoom" onClick={zoomOut} disabled={zoom <= MIN_ZOOM}>
            <Minus className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
            {zoomPercent}%
          </span>
          <Button variant="ghost" size="icon" aria-label="Aumentar zoom" onClick={zoomIn} disabled={zoom >= MAX_ZOOM}>
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Redefinir zoom (Ctrl+0)" onClick={resetZoom}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Grid view={view} zoom={zoom} onZoomChange={setZoom} selection={selectionApi} />
      </div>
    </div>
  );
}
