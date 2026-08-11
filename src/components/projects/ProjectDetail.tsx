import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Grid3x3, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CreateProjectDialog } from '@/components/dialogs/CreateProjectDialog';
import { CreateMatrixDialog } from '@/components/dialogs/CreateMatrixDialog';
import { ConfirmDialog } from '@/components/library/ConfirmDialog';
import { TagFilterBar } from '@/components/projects/TagFilterBar';
import { archiveProject } from '@/core/document/commands';
import { listMatrices, listProjectMatrices, resolveOpenVersion } from '@/core/queries';
import { formatDateBR } from '@/lib/format';
import { versionBadge } from '@/lib/matrix-badges';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';
import { useImportStore } from '@/store/import-store';
import { useToast } from '@/components/ui/use-toast';

export interface ProjectDetailProps {
  projectId: string;
}

/** Referência estável — evita recriar o array a cada render como dependência de `useMemo`. */
const EMPTY_TAGS: string[] = [];

export function ProjectDetail({ projectId }: ProjectDetailProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const setSelectedProject = useEditorStore((s) => s.setSelectedProject);
  const openMatrix = useEditorStore((s) => s.openMatrix);
  const setView = useUiStore((s) => s.setView);
  const matrixFilter = useUiStore((s) => s.matrixFilter);
  const setMatrixFilterProject = useUiStore((s) => s.setMatrixFilterProject);
  const toggleMatrixFilterTag = useUiStore((s) => s.toggleMatrixFilterTag);
  const setMatrixFilterSearch = useUiStore((s) => s.setMatrixFilterSearch);
  const clearMatrixFilter = useUiStore((s) => s.clearMatrixFilter);
  const { toast } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [createMatrixOpen, setCreateMatrixOpen] = useState(false);

  // Trocar de projeto começa com o filtro limpo; navegar entre a lista e o
  // editor de uma matriz do mesmo projeto preserva tags e busca (docs/07 §15).
  useEffect(() => {
    setMatrixFilterProject(projectId);
  }, [projectId, setMatrixFilterProject]);

  const filterIsCurrent = matrixFilter.projectId === projectId;
  const activeTags = filterIsCurrent ? matrixFilter.tags : EMPTY_TAGS;
  const activeSearch = filterIsCurrent ? matrixFilter.search : '';

  const project = document?.projects.find((candidate) => candidate.id === projectId) ?? null;
  const allMatrices = useMemo(
    () => (document === null ? [] : listProjectMatrices(document, projectId)),
    [document, projectId],
  );
  const { facets, filteredIds } = useMemo(() => {
    if (document === null) return { facets: [], filteredIds: null as Set<string> | null };
    const result = listMatrices(document, {
      projectId,
      tags: filterIsCurrent ? matrixFilter.tags : EMPTY_TAGS,
      search: filterIsCurrent ? matrixFilter.search : '',
    });
    return { facets: result.facets, filteredIds: new Set(result.matrices.map((m) => m.id)) };
  }, [document, projectId, filterIsCurrent, matrixFilter.tags, matrixFilter.search]);
  const matrices = useMemo(
    () => (filteredIds === null ? allMatrices : allMatrices.filter((entry) => filteredIds.has(entry.matrix.id))),
    [allMatrices, filteredIds],
  );

  if (document === null || project === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Projeto não encontrado.</p>
        <Button onClick={() => setSelectedProject(null)}>Voltar aos projetos</Button>
      </div>
    );
  }

  function handleOpenMatrix(matrixId: string) {
    const matrix = document!.matrices.find((candidate) => candidate.id === matrixId);
    if (matrix === undefined) return;
    const version = resolveOpenVersion(matrix);
    openMatrix(matrixId, version?.id ?? null);
    setView('matrix');
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-8">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Voltar aos projetos"
          onClick={() => setSelectedProject(null)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {project.name}
            </h1>
            <span className="shrink-0 font-mono text-xs text-neutral-400">{project.code}</span>
          </div>
          {project.description !== undefined && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{project.description}</p>
          )}
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Editar projeto" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Arquivar projeto"
          onClick={() => setArchiveOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Matrizes</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              useImportStore.getState().setProjectId(projectId);
              setView('import');
            }}
          >
            <Upload className="mr-1.5 h-4 w-4" /> Carregar tabela
          </Button>
          <Button onClick={() => setCreateMatrixOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Nova matriz
          </Button>
        </div>
      </div>

      {allMatrices.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Buscar por código ou nome…"
              value={activeSearch}
              onChange={(e) => setMatrixFilterSearch(e.target.value)}
              className="max-w-sm"
            />
            <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
              {allMatrices.length} matrizes
              {activeTags.length > 0 || activeSearch.trim().length > 0
                ? ` · ${matrices.length} no filtro`
                : ''}
            </span>
          </div>
          <TagFilterBar
            facets={facets}
            selected={activeTags}
            onToggle={toggleMatrixFilterTag}
            onClear={clearMatrixFilter}
          />
        </div>
      )}

      {allMatrices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Grid3x3 className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Nenhuma matriz ainda neste projeto.
            </p>
            <Button onClick={() => setCreateMatrixOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Nova matriz
            </Button>
          </CardContent>
        </Card>
      ) : matrices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Grid3x3 className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Nenhuma matriz corresponde ao filtro.
            </p>
            <Button variant="outline" onClick={clearMatrixFilter}>
              Limpar filtro
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {matrices.map(({ matrix, xLabel, yLabel, publishedVersion, draftVersion }) => (
            <button
              key={matrix.id}
              type="button"
              onClick={() => handleOpenMatrix(matrix.id)}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                    {matrix.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-neutral-400">{matrix.code}</span>
                </div>
                <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {xLabel} × {yLabel}
                </p>
                {publishedVersion !== null && (
                  <p className="text-xs text-neutral-400 dark:text-neutral-500">
                    última publicação:{' '}
                    {publishedVersion.publishedAt === undefined ? '—' : formatDateBR(publishedVersion.publishedAt)}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {publishedVersion !== null && (
                  <Badge variant={versionBadge(publishedVersion).variant}>
                    {versionBadge(publishedVersion).label}
                  </Badge>
                )}
                {draftVersion !== null && <Badge variant="amber">Rascunho aberto</Badge>}
              </div>
            </button>
          ))}
        </div>
      )}

      <CreateProjectDialog open={editOpen} onOpenChange={setEditOpen} project={project} />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Arquivar "${project.name}"?`}
        description="O projeto some das listas ativas. As matrizes continuam existindo e podem ser consultadas pelo histórico."
        confirmLabel="Arquivar"
        destructive
        onConfirm={() => {
          const result = dispatch(archiveProject({ projectId: project.id }));
          if (!result.ok) {
            toast({ title: 'Não foi possível arquivar o projeto', description: result.error.message });
            return;
          }
          setSelectedProject(null);
        }}
      />
      <CreateMatrixDialog
        open={createMatrixOpen}
        onOpenChange={setCreateMatrixOpen}
        projectId={project.id}
        onCreated={(matrixId, versionId) => {
          openMatrix(matrixId, versionId);
          setView('matrix');
        }}
      />
    </div>
  );
}
