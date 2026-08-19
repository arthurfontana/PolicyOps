import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/**
 * O painel direito existe só onde há **seleção dentro** de uma tela — células
 * do grid e célula do diff (docs/07-ux-e-editor.md §2, §6). Componente de
 * política não é seleção, é a tela — tem página própria no centro
 * (`ComponentPage`, §17.5, DEC-UX-002) e não passa mais pelo inspector.
 */
export function useHasInspector(): boolean {
  const hasDocument = useDocumentStore((s) => s.document !== null);
  const view = useUiStore((s) => s.view);
  const currentVersionId = useEditorStore((s) => s.currentVersionId);

  if (!hasDocument) return false;
  if (view === 'compare') return true;
  return currentVersionId !== null;
}
