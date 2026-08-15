import { Badge } from '@/components/ui/badge';
import { ComponentBreadcrumb } from '@/components/tree/ComponentBreadcrumb';
import { listChildren } from '@/core/document/components';
import { componentPath } from '@/core/queries';
import {
  COMPONENT_REVIEW_STATUS_LABELS,
  COMPONENT_REVIEW_STATUS_VARIANTS,
  COMPONENT_TYPE_ICONS,
  COMPONENT_TYPE_LABELS,
} from '@/lib/component-labels';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

export interface ComponentContentPanelProps {
  projectId: string;
  projectName: string;
  componentId: string;
}

/**
 * Conteúdo do nó selecionado na árvore (docs/07-ux-e-editor.md §17.1/§17.5):
 * breadcrumb clicável + o essencial da estrutura. Payload de regra,
 * versionamento e vigência são da S33b — o inspector à direita
 * (`ComponentInspector`) já mostra esses campos desabilitados.
 */
export function ComponentContentPanel({ projectId, projectName, componentId }: ComponentContentPanelProps) {
  const document = useDocumentStore((s) => s.document);
  const setSelectedComponent = useEditorStore((s) => s.setSelectedComponent);

  const component = document?.components.find((candidate) => candidate.id === componentId) ?? null;

  if (document === null || component === null) {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Este componente não existe mais (pode ter sido arquivado ou desfeito).
        </p>
        <button
          type="button"
          onClick={() => setSelectedComponent(null)}
          className="text-sm text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
        >
          Voltar às matrizes do projeto
        </button>
      </div>
    );
  }

  const path = componentPath(document, componentId);
  const childCount = listChildren(document, projectId, componentId).length;
  const Icon = COMPONENT_TYPE_ICONS[component.type];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <ComponentBreadcrumb
        projectName={projectName}
        path={path}
        onNavigateRoot={() => setSelectedComponent(null)}
        onNavigate={(id) => setSelectedComponent(id)}
      />

      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 shrink-0 text-neutral-400" />
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{component.name}</h1>
        <span className="shrink-0 font-mono text-xs text-neutral-400">{component.code}</span>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline">{COMPONENT_TYPE_LABELS[component.type]}</Badge>
        <Badge variant={COMPONENT_REVIEW_STATUS_VARIANTS[component.reviewStatus]}>
          {COMPONENT_REVIEW_STATUS_LABELS[component.reviewStatus]}
        </Badge>
      </div>

      {component.origin !== undefined && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Origem: {component.origin.source}
          {component.origin.locator !== undefined ? `, ${component.origin.locator}` : ''}
        </p>
      )}

      {childCount > 0 && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {childCount} {childCount === 1 ? 'item filho' : 'itens filhos'} nesta {component.type === 'SECTION' ? 'seção' : 'estrutura'}.
        </p>
      )}

      <p className="rounded-md border border-dashed border-neutral-300 p-3 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        Descrição de negócio, definição técnica e o ciclo de versão deste componente chegam na
        Sessão 33b. Edite nome, tags, origem e revisão no painel de propriedades à direita.
      </p>
    </div>
  );
}
