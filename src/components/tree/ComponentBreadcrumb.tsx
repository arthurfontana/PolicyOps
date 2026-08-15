import { ChevronRight } from 'lucide-react';
import type { PolicyComponent } from '@/core/document/schema';

export interface ComponentBreadcrumbProps {
  projectName: string;
  path: PolicyComponent[];
  onNavigateRoot: () => void;
  onNavigate: (componentId: string) => void;
}

/** Breadcrumb clicável do topo do conteúdo (docs/07-ux-e-editor.md §17.1) — até 6 níveis possíveis. */
export function ComponentBreadcrumb({ projectName, path, onNavigateRoot, onNavigate }: ComponentBreadcrumbProps) {
  return (
    <nav aria-label="Caminho na árvore" className="flex flex-wrap items-center gap-1 text-sm">
      <button
        type="button"
        onClick={onNavigateRoot}
        className="text-neutral-500 hover:text-neutral-900 hover:underline dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        {projectName}
      </button>
      {path.map((component, index) => {
        const isLast = index === path.length - 1;
        return (
          <span key={component.id} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-neutral-300 dark:text-neutral-700" />
            <button
              type="button"
              onClick={() => onNavigate(component.id)}
              aria-current={isLast ? 'page' : undefined}
              className={
                isLast
                  ? 'font-medium text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-900 hover:underline dark:text-neutral-400 dark:hover:text-neutral-100'
              }
            >
              {component.name}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
