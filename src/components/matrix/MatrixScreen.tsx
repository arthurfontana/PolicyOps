import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Archive,
  CheckCircle2,
  FilePlus2,
  GitCompare,
  History,
  LayoutTemplate,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  StickyNote,
  Trash2,
  Undo2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/library/ConfirmDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { AddNoteDialog } from '@/components/dialogs/AddNoteDialog';
import { DiscardDraftDialog } from '@/components/dialogs/DiscardDraftDialog';
import { PublishVersionDialog } from '@/components/dialogs/PublishVersionDialog';
import { VersionHistoryDialog } from '@/components/dialogs/VersionHistoryDialog';
import { ExportMenu } from '@/components/shell/ExportMenu';
import { decodeCellKey, encodeCellKey } from '@/core/axes/paths';
import { archiveMatrix } from '@/core/document/commands';
import { orderForCompare } from '@/core/diff';
import { Grid, MAX_ZOOM, MIN_ZOOM, type GridSelectionApi } from '@/components/grid/Grid';
import { GridExportSnapshot } from '@/components/grid/GridExportSnapshot';
import { getErrorMessage } from '@/core/error-messages';
import { canonicalFileName, exportVersionCanonical } from '@/core/export/canonical';
import { csvFileName, exportVersionCsv } from '@/core/export/csv';
import {
  getEditorView,
  getOpenDraft,
  getPrecedingVersion,
  getPublishedVersion,
  listMatrixVersions,
} from '@/core/queries';
import { CELL_FIELDS, applyCellPatch } from '@/core/versioning/cells';
import { createDraft, pendingCoords } from '@/core/versioning/lifecycle';
import { extractTemplateSeed } from '@/core/templates/extract';
import { useGridSelection } from '@/hooks/useGridSelection';
import { usePngExportPortal } from '@/hooks/usePngExportPortal';
import { downloadCsv, downloadJson } from '@/lib/download';
import { pngFileName } from '@/lib/export-png';
import { formatDateBR } from '@/lib/format';
import { versionBadge } from '@/lib/matrix-badges';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/** Acima disso, limpar pelas teclas Delete/Backspace pede confirmação (docs/07 §5/§8). */
const CLEAR_CONFIRM_THRESHOLD = 20;

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
  const isEditable = useEditorStore((s) => s.isEditable);
  const selectSingle = useEditorStore((s) => s.selectSingle);
  const selectCoords = useEditorStore((s) => s.selectCoords);
  const setCompareVersions = useEditorStore((s) => s.setCompareVersions);
  const requestTemplateFromMatrix = useEditorStore((s) => s.requestTemplateFromMatrix);

  const dispatch = useDocumentStore((s) => s.dispatch);
  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);
  const canUndo = useDocumentStore((s) => s.canUndo);
  const canRedo = useDocumentStore((s) => s.canRedo);
  const undoLabel = useDocumentStore((s) => s.undoStack[s.undoStack.length - 1]?.label);
  const redoLabel = useDocumentStore((s) => s.redoStack[s.redoStack.length - 1]?.label);
  const { toast } = useToast();

  const {
    nodeRef: pngNodeRef,
    pending: pngPending,
    requestExport: requestPngExport,
  } = usePngExportPortal((error) => {
    toast({
      variant: 'destructive',
      title: 'Não foi possível gerar o PNG',
      description: error instanceof Error ? error.message : String(error),
    });
  });

  const [pendingClear, setPendingClear] = useState<{ coords: { xPath: string; yPath: string }[] } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [archiveMatrixOpen, setArchiveMatrixOpen] = useState(false);
  const [pulsePending, setPulsePending] = useState(false);
  const pulseTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current !== null) window.clearTimeout(pulseTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === '0') {
        event.preventDefault();
        resetZoom();
        return;
      }
      const isUndoChord = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z';
      if (!isUndoChord) return;
      // Não sequestra o desfazer nativo do campo enquanto o usuário digita no
      // inspector (docs/07 §5).
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resetZoom, undo, redo]);

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
  const baseSelectionApi = useGridSelection(view ?? EMPTY_SELECTION_VIEW);

  function runClear(coords: { xPath: string; yPath: string }[]) {
    if (currentVersionId === null || coords.length === 0) return;
    const set = Object.fromEntries(CELL_FIELDS.map((field) => [field, null]));
    dispatch(applyCellPatch({ versionId: currentVersionId, patch: { coords, set } }));
  }

  const selectionApi: GridSelectionApi = {
    ...baseSelectionApi,
    clearCells: () => {
      if (!isEditable) return;
      const coords = [...baseSelectionApi.selection].map(decodeCellKey);
      if (coords.length === 0) return;
      if (coords.length > CLEAR_CONFIRM_THRESHOLD) {
        setPendingClear({ coords });
        return;
      }
      runClear(coords);
    },
  };

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

  function handleArchiveMatrix() {
    const result = dispatch(archiveMatrix({ matrixId: matrix!.id }));
    if (!result.ok) {
      toast({ title: 'Não foi possível arquivar a matriz', description: result.error.message });
      return;
    }
    backToProject();
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
        <Button type="button" variant="outline" size="sm" onClick={() => setArchiveMatrixOpen(true)}>
          <Archive className="mr-1.5 h-3.5 w-3.5" /> Arquivar matriz
        </Button>
        <ConfirmDialog
          open={archiveMatrixOpen}
          onOpenChange={setArchiveMatrixOpen}
          title={`Arquivar "${matrix.name}"?`}
          description="A matriz some da lista do projeto e de qualquer busca. O histórico de versões e eventos fica preservado no arquivo, mas hoje não há como desarquivar pela interface — use Ctrl+Z logo em seguida se mudar de ideia."
          confirmLabel="Arquivar"
          destructive
          onConfirm={handleArchiveMatrix}
        />
      </div>
    );
  }

  const badge = versionBadge(view.version);
  const zoomPercent = Math.round(zoom * 100);

  // --- Ciclo de vida — docs/prompts/S13-ciclo-de-vida.md item 1 ------------

  const { version } = view;
  const isDraft = version.state === 'DRAFT';
  const isSuperseded = version.state === 'SUPERSEDED';
  const isPublished = version.state === 'PUBLISHED';
  const publishedVersion = getPublishedVersion(matrix);
  const openDraft = getOpenDraft(matrix);
  const compareTarget =
    publishedVersion !== null && publishedVersion.id !== version.id
      ? publishedVersion
      : getPrecedingVersion(matrix, version);

  function handleCreateOrOpenDraft() {
    if (openDraft !== null) {
      setVersion(openDraft.id);
      return;
    }
    const result = dispatch(createDraft({ matrixId: matrix!.id }));
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível criar o rascunho',
        description: result.error.message || getErrorMessage(result.error.code),
      });
      return;
    }
    setVersion((result.data as { versionId: string }).versionId);
  }

  function handleRestoreAsDraft() {
    const result = dispatch(createDraft({ matrixId: matrix!.id, baseVersionId: version.id }));
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível restaurar',
        description: result.error.message || getErrorMessage(result.error.code),
      });
      return;
    }
    setVersion((result.data as { versionId: string }).versionId);
  }

  /**
   * A tela mostra sempre a mais antiga à esquerda (docs/07 §9), então o par é
   * ordenado aqui — os botões passam "a outra ponta" e a versão atual sem se
   * preocupar com qual das duas é a base.
   */
  function handleCompare(versionAId: string, versionBId: string) {
    const ordered = orderForCompare(document!, versionAId, versionBId);
    setCompareVersions(ordered.aId, ordered.bId);
    setView('compare');
  }

  function triggerPendingPulse() {
    setPulsePending(true);
    if (pulseTimeoutRef.current !== null) window.clearTimeout(pulseTimeoutRef.current);
    pulseTimeoutRef.current = window.setTimeout(() => setPulsePending(false), 3200);
  }

  function goToFirstPending() {
    const [first] = pendingCoords(version);
    if (first === undefined) return;
    selectSingle(first);
    requestAnimationFrame(() => {
      // `document` aqui em cima é o `PolicyOpsDocument` do store — o DOM é
      // `window.document`, explícito para não colidir com o nome.
      window.document
        .querySelector<HTMLElement>(`[data-cell-key="${encodeCellKey(first.xPath, first.yPath)}"]`)
        ?.focus();
    });
  }

  function selectAllPending() {
    selectCoords(pendingCoords(version));
  }

  function handleCreateTemplateFromMatrix() {
    requestTemplateFromMatrix(extractTemplateSeed(version));
    setView('templates');
  }

  // --- Exportação — docs/08 §5, docs/07 §12 --------------------------------
  // Só para versões imutáveis (publicada ou histórica): o canônico é "estável
  // e versionado", o que não faz sentido para um rascunho ainda em edição.

  function handleExportJson() {
    const canonical = exportVersionCanonical(document!, matrix!, version);
    downloadJson(canonicalFileName(matrix!.code, version.number), canonical);
  }

  function handleExportCsv() {
    downloadCsv(csvFileName(matrix!.code, version.number), exportVersionCsv(document!, version));
  }

  function handleExportPng() {
    requestPngExport(pngFileName(matrix!.code, version.number));
  }

  const exportItems = [
    { key: 'json', label: 'Exportar JSON', onSelect: handleExportJson },
    { key: 'csv', label: 'Exportar CSV', onSelect: handleExportCsv },
    { key: 'png', label: 'Exportar PNG', onSelect: handleExportPng, disabled: pngPending !== null },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabeçalho e rodapé só de impressão — docs/07 §12: matriz, versão e
          vigência em toda página, via `position: fixed` (src/index.css). */}
      <div className="print-page-header hidden print:flex print:items-baseline print:gap-2">
        <strong>{matrix.name}</strong>
        <span>({matrix.code})</span>
        <span>· Versão {version.number}</span>
        <span>· {badge.label}</span>
      </div>
      <div className="print-page-footer hidden print:flex print:items-center print:justify-between">
        <span>
          {matrix.code} · v{version.number}
        </span>
        <span>Impresso em {formatDateBR(new Date().toISOString())}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-2 print:hidden dark:border-neutral-800">
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

        <div className="flex flex-wrap items-center gap-1.5">
          {isDraft && (
            <>
              <Button type="button" size="sm" onClick={() => setPublishOpen(true)}>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Publicar
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setDiscardOpen(true)}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Descartar rascunho
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={compareTarget === null}
                onClick={() => compareTarget !== null && handleCompare(compareTarget.id, version.id)}
              >
                <GitCompare className="mr-1.5 h-3.5 w-3.5" /> Comparar com a vigente
              </Button>
            </>
          )}

          {isPublished && (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={handleCreateOrOpenDraft}>
                <FilePlus2 className="mr-1.5 h-3.5 w-3.5" />
                {openDraft !== null ? 'Abrir rascunho' : 'Criar rascunho'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={compareTarget === null}
                onClick={() => compareTarget !== null && handleCompare(compareTarget.id, version.id)}
              >
                <GitCompare className="mr-1.5 h-3.5 w-3.5" /> Comparar
              </Button>
              <ExportMenu items={exportItems} />
            </>
          )}

          {isSuperseded && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={compareTarget === null}
                onClick={() => compareTarget !== null && handleCompare(compareTarget.id, version.id)}
              >
                <GitCompare className="mr-1.5 h-3.5 w-3.5" /> Comparar
              </Button>
              <ExportMenu items={exportItems} />
            </>
          )}

          <span aria-hidden className="mx-0.5 h-4 w-px bg-neutral-200 dark:bg-neutral-800" />
          <Button type="button" variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
            <History className="mr-1.5 h-3.5 w-3.5" /> Histórico
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setNoteOpen(true)}>
            <StickyNote className="mr-1.5 h-3.5 w-3.5" /> Adicionar nota
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={handleCreateTemplateFromMatrix}>
            <LayoutTemplate className="mr-1.5 h-3.5 w-3.5" /> Criar template a partir desta matriz
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setArchiveMatrixOpen(true)}>
            <Archive className="mr-1.5 h-3.5 w-3.5" /> Arquivar matriz
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant="ghost" size="icon" aria-label="Desfazer (Ctrl+Z)" onClick={() => undo()} disabled={!canUndo}>
                  <Undo2 className="h-4 w-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{canUndo ? `Desfazer: ${undoLabel}` : 'Nada para desfazer'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant="ghost" size="icon" aria-label="Refazer (Ctrl+Shift+Z)" onClick={() => redo()} disabled={!canRedo}>
                  <Redo2 className="h-4 w-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{canRedo ? `Refazer: ${redoLabel}` : 'Nada para refazer'}</TooltipContent>
          </Tooltip>
          <span aria-hidden className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-800" />
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

      {isDraft && view.stats.pendingCells > 0 && (
        <div
          data-testid="pending-cells-bar"
          className="flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 print:hidden dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
        >
          <span className="font-medium">
            {view.stats.pendingCells === 1
              ? '1 combinação ainda não preenchida'
              : `${view.stats.pendingCells} combinações ainda não preenchidas`}
          </span>
          <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={goToFirstPending}>
            Ir para a primeira
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={selectAllPending}>
            Selecionar todas as pendentes
          </Button>
        </div>
      )}

      {isSuperseded && (
        <div
          data-testid="historical-banner"
          className="flex flex-wrap items-center gap-2 border-b border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-800 print:hidden dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300"
        >
          <span>
            Você está vendo a versão {version.number}, vigente de{' '}
            {version.effectiveFrom !== undefined ? formatDateBR(version.effectiveFrom) : '?'} a{' '}
            {version.effectiveTo !== undefined ? formatDateBR(version.effectiveTo) : '?'}. Esta é uma versão
            histórica.
          </span>
          {publishedVersion !== null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setVersion(publishedVersion.id)}
            >
              Ir para a vigente
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={handleRestoreAsDraft}>
            <RotateCcw className="mr-1 h-3 w-3" /> Restaurar como rascunho
          </Button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {isSuperseded && (
          <div
            aria-hidden
            data-testid="historical-watermark"
            className="pointer-events-none absolute inset-0 z-40 flex select-none items-center justify-center overflow-hidden print:hidden"
          >
            <span className="rotate-[-25deg] whitespace-nowrap text-7xl font-black uppercase tracking-widest text-neutral-900/[0.06] dark:text-neutral-100/[0.08]">
              HISTÓRICO
            </span>
          </div>
        )}
        <Grid view={view} zoom={zoom} onZoomChange={setZoom} selection={selectionApi} highlightPending={pulsePending} />
      </div>

      <ConfirmDialog
        open={pendingClear !== null}
        onOpenChange={(open) => {
          if (!open) setPendingClear(null);
        }}
        title="Limpar células selecionadas"
        description={`${pendingClear?.coords.length ?? 0} células voltarão a pendentes. Esta ação pode ser desfeita com Ctrl+Z.`}
        confirmLabel="Limpar"
        destructive
        onConfirm={() => {
          if (pendingClear !== null) runClear(pendingClear.coords);
          setPendingClear(null);
        }}
      />

      <ConfirmDialog
        open={archiveMatrixOpen}
        onOpenChange={setArchiveMatrixOpen}
        title={`Arquivar "${matrix.name}"?`}
        description="A matriz some da lista do projeto e de qualquer busca. O histórico de versões e eventos fica preservado no arquivo, mas hoje não há como desarquivar pela interface — use Ctrl+Z logo em seguida se mudar de ideia."
        confirmLabel="Arquivar"
        destructive
        onConfirm={handleArchiveMatrix}
      />

      {publishOpen && (
        <PublishVersionDialog
          open
          onOpenChange={setPublishOpen}
          matrix={matrix}
          version={version}
          publishedVersion={publishedVersion}
          onPublished={() => {
            toast({ title: 'Versão publicada', description: `A versão ${version.number} agora é a vigente.` });
          }}
          onUnsetCellsRemain={triggerPendingPulse}
        />
      )}

      {discardOpen && (
        <DiscardDraftDialog
          open
          onOpenChange={setDiscardOpen}
          version={version}
          onDiscarded={() => {
            // Sem vigente (ex.: descartar o v1 de uma matriz nova), fica na
            // própria versão — agora "Descartado" — que continua um estado
            // válido para exibir (docs/07 §3).
            if (publishedVersion !== null) setVersion(publishedVersion.id);
          }}
        />
      )}

      {noteOpen && <AddNoteDialog open onOpenChange={setNoteOpen} version={version} />}

      {historyOpen && document !== null && (
        <VersionHistoryDialog
          open
          onOpenChange={setHistoryOpen}
          doc={document}
          matrix={matrix}
          onOpenVersion={setVersion}
          onCompare={handleCompare}
        />
      )}

      {pngPending !== null && matrix !== null && (
        <div style={{ position: 'fixed', left: -99999, top: 0 }} aria-hidden>
          <GridExportSnapshot ref={pngNodeRef} matrix={matrix} version={version} view={view} />
        </div>
      )}
    </div>
  );
}
