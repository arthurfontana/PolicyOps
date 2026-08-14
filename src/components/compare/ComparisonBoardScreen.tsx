import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Columns3,
  Download,
  Maximize2,
  Minus,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/library/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Grid, MAX_ZOOM, MIN_ZOOM } from '@/components/grid/Grid';
import { useToast } from '@/components/ui/use-toast';
import type { Matrix, MatrixVersion } from '@/core/document/schema';
import { getEditorView, listMatrices, resolveOpenVersion } from '@/core/queries';
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
          Nada fixado ainda. Busque uma matriz abaixo para trazer até {MAX_BOARD_ITEMS} lado a
          lado aqui — pensado para levar direto a uma reunião.
        </p>
        <div className="flex items-center gap-2">
          <AddMatrixPopover />
          <Button variant="ghost" onClick={() => setView('projects')}>
            Ir para projetos
          </Button>
        </div>
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
        <AddMatrixPopover />

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

/**
 * Busca-e-fixa direto na tela de comparação: sem isso, o único jeito de
 * adicionar uma matriz era ir até `/projects`, pinar por lá e voltar — a
 * fricção que esta caixa resolve. Reaproveita `listMatrices` sem `projectId`
 * (busca cruza todos os projetos) e o mesmo par pin/unpin do board; o popover
 * não fecha ao pinar, para dar para ir adicionando várias em sequência.
 */
function AddMatrixPopover() {
  const document = useDocumentStore((s) => s.document);
  const boardItems = useEditorStore((s) => s.boardItems);
  const pinToBoard = useEditorStore((s) => s.pinToBoard);
  const unpinFromBoard = useEditorStore((s) => s.unpinFromBoard);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const pinnedIds = useMemo(() => new Set(boardItems.map((item) => item.matrixId)), [boardItems]);
  const results = useMemo(
    () => (document === null ? [] : listMatrices(document, { search: query }).matrices),
    [document, query],
  );

  function projectName(projectId: string): string {
    return document?.projects.find((candidate) => candidate.id === projectId)?.name ?? '';
  }

  function toggle(matrixId: string) {
    if (pinnedIds.has(matrixId)) {
      unpinFromBoard(matrixId);
      return;
    }
    const matrix = document?.matrices.find((candidate) => candidate.id === matrixId);
    const version = matrix === undefined ? null : resolveOpenVersion(matrix);
    if (version === null) {
      toast({
        title: 'Sem versão para comparar',
        description: 'Esta matriz ainda não tem rascunho nem versão publicada.',
      });
      return;
    }
    if (boardItems.length >= MAX_BOARD_ITEMS) {
      toast({
        title: 'Comparação cheia',
        description: `Só é possível comparar até ${MAX_BOARD_ITEMS} matrizes de uma vez. Remova uma antes de adicionar outra.`,
      });
      return;
    }
    pinToBoard(matrixId, version.id);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Search className="mr-1.5 h-3.5 w-3.5" /> Adicionar matriz
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por código ou nome…"
          className="mb-2"
        />
        <ul role="listbox" className="max-h-72 overflow-auto">
          {results.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-neutral-500 dark:text-neutral-400">Nenhuma matriz encontrada.</li>
          )}
          {results.map((matrix) => {
            const pinned = pinnedIds.has(matrix.id);
            return (
              <li key={matrix.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={pinned}
                  onClick={() => toggle(matrix.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                        {matrix.name}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-neutral-400">{matrix.code}</span>
                    </span>
                    <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {projectName(matrix.projectId)}
                    </span>
                  </span>
                  {pinned ? (
                    <PinOff className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
                  ) : (
                    <Pin className="h-4 w-4 shrink-0 text-neutral-400" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
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
