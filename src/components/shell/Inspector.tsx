import { CellInspector } from '@/components/inspector/CellInspector';
import { CompareInspector } from '@/components/inspector/CompareInspector';
import { VersionInspector } from '@/components/inspector/VersionInspector';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

export function Inspector() {
  const hasDocument = useDocumentStore((s) => s.document !== null);
  const view = useUiStore((s) => s.view);
  const currentVersionId = useEditorStore((s) => s.currentVersionId);
  const selection = useEditorStore((s) => s.selection);

  // Na tela de comparação o painel mostra o "antes → depois" da célula
  // clicada (docs/07-ux-e-editor.md §9), não a célula do editor.
  if (hasDocument && view === 'compare') return <CompareInspector />;

  if (hasDocument && currentVersionId !== null && selection.size > 0) {
    return <CellInspector selection={selection} />;
  }

  if (hasDocument && currentVersionId !== null) return <VersionInspector />;

  return null;
}
