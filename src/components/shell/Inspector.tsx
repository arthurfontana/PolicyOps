import { CellInspector } from '@/components/inspector/CellInspector';
import { CompareInspector } from '@/components/inspector/CompareInspector';
import { ComponentInspector } from '@/components/inspector/ComponentInspector';
import { VersionInspector } from '@/components/inspector/VersionInspector';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

export function Inspector() {
  const hasDocument = useDocumentStore((s) => s.document !== null);
  const view = useUiStore((s) => s.view);
  const currentVersionId = useEditorStore((s) => s.currentVersionId);
  const selection = useEditorStore((s) => s.selection);
  const selectedComponentId = useEditorStore((s) => s.selectedComponentId);

  // Na tela de comparação o painel mostra o "antes → depois" da célula
  // clicada (docs/07-ux-e-editor.md §9), não a célula do editor.
  if (hasDocument && view === 'compare') return <CompareInspector />;

  // Componente selecionado na árvore (docs/07 §17.5) tem prioridade sobre a
  // versão de matriz que possa ter ficado aberta atrás: é a árvore que o
  // usuário está olhando agora.
  if (hasDocument && view === 'projects' && selectedComponentId !== null) {
    return <ComponentInspector componentId={selectedComponentId} />;
  }

  if (hasDocument && currentVersionId !== null && selection.size > 0) {
    return <CellInspector selection={selection} />;
  }

  if (hasDocument && currentVersionId !== null) return <VersionInspector />;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Propriedades</h2>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Nada selecionado. Abra uma matriz para ver as propriedades da versão.
      </p>
    </div>
  );
}
