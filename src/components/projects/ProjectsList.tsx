import { useMemo, useState } from 'react';
import { FolderKanban, Plus, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { listProjects } from '@/core/queries';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';
import { CreateProjectDialog } from '@/components/dialogs/CreateProjectDialog';

/** Lista de projetos — docs/07-ux-e-editor.md §1, docs/prompts/S09-grid-e-matrizes.md. */
export function ProjectsList() {
  const document = useDocumentStore((s) => s.document);
  const setSelectedProject = useEditorStore((s) => s.setSelectedProject);
  const setView = useUiStore((s) => s.setView);
  const [createOpen, setCreateOpen] = useState(false);

  const summaries = useMemo(() => (document === null ? [] : listProjects(document)), [document]);

  if (document === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum documento aberto.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Projetos</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Agrupam as matrizes de política de crédito.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={() => setView('import')}>
            <Upload className="mr-1.5 h-4 w-4" /> Carregar tabela
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Novo projeto
          </Button>
        </div>
      </div>

      {summaries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <FolderKanban className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Nenhum projeto ainda. Crie o primeiro para começar a montar matrizes.
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Novo projeto
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {summaries.map(({ project, matrixCount, openDraftCount }) => (
            <button
              key={project.id}
              type="button"
              onClick={() => setSelectedProject(project.id)}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                    {project.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-neutral-400">{project.code}</span>
                </div>
                {project.description !== undefined && (
                  <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {project.description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge variant="secondary">
                  {matrixCount} {matrixCount === 1 ? 'matriz' : 'matrizes'}
                </Badge>
                {openDraftCount > 0 && (
                  <Badge variant="amber">
                    {openDraftCount} {openDraftCount === 1 ? 'rascunho' : 'rascunhos'}
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={setSelectedProject} />
    </div>
  );
}
