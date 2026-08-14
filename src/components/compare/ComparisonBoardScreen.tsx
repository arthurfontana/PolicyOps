import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Columns3, Download, Maximize2, Minus, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/library/ConfirmDialog';
import { Grid, MAX_ZOOM, MIN_ZOOM } from '@/components/grid/Grid';
import { useToast } from '@/components/ui/use-toast';
import type { Matrix, MatrixVersion } from '@/core/document/schema';
import { getEditorView } from '@/core/queries';
import { boardPngFileName, exportNodeAsPng } from '@/lib/export-png';
import { versionBadge, vigenciaText } from '@/lib/matrix-badges';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore, MAX_BOARD_ITEMS } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

const ZOOM_STEP = 0.1;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
}

/**
 * Board de comparação — docs/07-ux-e-editor.md §9b. Diferente da tela de
 * comparação da S14 (`compare`, duas versões da **mesma** matriz), aqui é
 * qualquer conjunto de matrizes fixado em `boardItems` (editor-store), até
 * `MAX_BOARD_ITEMS`, lado a lado inteiras — o caso de uso é "3 riscos de
 * canais diferentes, olhados juntos numa reunião".
 */
export function ComparisonBoardScreen() {
  const document = useDocumentStore((s) => s.document);
  const boardItems = useEditorStore((s) => s.boardItems);
  const unpinFromBoard = useEditorStore((s) => s.unpinFromBoard);
  const clearBoard = useEditorStore((s) => s.clearBoard);
  const setView = useUiStore((s) => s.setView);
  const setPresentationMode = useUiStore((s) => s.setPresentationMode);
  const { toast } = useToast();

  const [zoom, setZoom] = useState(1);
  const [clearOpen, setClearOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  const columns = useMemo(() => {
    if (document === null) return [];
    return boardItems.map((item) => {
      const matrix = document.matrices.find((candidate) => candidate.id === item.matrixId) ?? null;
      const version = matrix?.versions.find((candidate) => candidate.id === item.versionId) ?? null;
      return { item, matrix, version };
    });
  }, [document, boardItems]);

  async function handleExportPng() {
    if (boardRef.current === null) return;
    setExporting(true);
    try {
      const codes = columns.map(({ matrix }) => matrix?.code).filter((code): code is string => code !== undefined);
      await exportNodeAsPng(boardRef.current, boardPngFileName(codes));
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível gerar o PNG',
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setExporting(false);
    }
  }

  if (document === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum documento aberto.</p>
      </div>
    );
  }

  if (boardItems.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Columns3 className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
        <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
          Nada fixado ainda. Abra uma matriz e use <strong>&quot;Adicionar à comparação&quot;</strong> para trazer
          até {MAX_BOARD_ITEMS} matrizes lado a lado aqui — pensado para levar direto a uma
          reunião.
        </p>
        <Button onClick={() => setView('projects')}>Ir para projetos</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-2 dark:border-neutral-800">
        <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => setView('projects')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Columns3 className="h-4 w-4 text-neutral-400" aria-hidden />
        <h1 className="font-semibold text-neutral-900 dark:text-neutral-100">Comparação de matrizes</h1>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {boardItems.length} de {MAX_BOARD_ITEMS} fixadas
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-0.5 rounded-md border border-neutral-200 px-1 dark:border-neutral-800">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Diminuir zoom"
              onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <span className="w-10 text-center text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Aumentar zoom"
              onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setPresentationMode(true)}>
            <Maximize2 className="mr-1.5 h-3.5 w-3.5" /> Modo apresentação
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={exporting} onClick={handleExportPng}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> {exporting ? 'Gerando…' : 'Exportar imagem'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setClearOpen(true)}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Limpar tudo
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div ref={boardRef} className="flex min-h-full w-fit gap-3 bg-white p-3 dark:bg-neutral-950">
          {columns.map(({ item, matrix, version }) => (
            <BoardColumn
              key={item.matrixId}
              matrix={matrix}
              version={version}
              zoom={zoom}
              onRemove={() => unpinFromBoard(item.matrixId)}
            />
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Limpar a comparação?"
        description="Remove todas as matrizes fixadas aqui. Nenhuma matriz ou versão é afetada — é só o board que esvazia."
        confirmLabel="Limpar"
        destructive
        onConfirm={() => {
          clearBoard();
          setClearOpen(false);
        }}
      />
    </div>
  );
}

function BoardColumn({
  matrix,
  version,
  zoom,
  onRemove,
}: {
  matrix: Matrix | null;
  version: MatrixVersion | null;
  zoom: number;
  onRemove: () => void;
}) {
  const document = useDocumentStore((s) => s.document);
  const view = useMemo(
    () => (document === null || version === null ? null : getEditorView(document, version.id)),
    [document, version],
  );

  if (matrix === null || version === null || view === null) {
    return (
      <div className="flex w-80 shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {matrix?.name ?? 'Matriz'} não está mais disponível para comparar.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRemove}>
          <X className="mr-1.5 h-3.5 w-3.5" /> Remover
        </Button>
      </div>
    );
  }

  const badge = versionBadge(version);

  return (
    <div className="flex w-fit shrink-0 flex-col gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-start justify-between gap-2 border-b border-neutral-100 p-3 dark:border-neutral-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{matrix.name}</h2>
            <span className="shrink-0 font-mono text-xs text-neutral-400">{matrix.code}</span>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Versão {version.number} · {badge.label} · {vigenciaText(version)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remover ${matrix.name} da comparação`}
          className="shrink-0"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Grid view={view} zoom={zoom} />
    </div>
  );
}
