import { useEditorStore } from '@/store/editor-store';
import { ProjectDetail } from './ProjectDetail';
import { ProjectsList } from './ProjectsList';

/** Rota `/projects` — docs/07-ux-e-editor.md §1, docs/prompts/S09-grid-e-matrizes.md. */
export function ProjectsScreen() {
  const selectedProjectId = useEditorStore((s) => s.selectedProjectId);

  if (selectedProjectId !== null) return <ProjectDetail projectId={selectedProjectId} />;
  return <ProjectsList />;
}
