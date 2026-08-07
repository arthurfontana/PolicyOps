import type { ComponentType } from 'react';
import {
  CalendarClock,
  FolderKanban,
  LayoutTemplate,
  Library,
  ListTree,
  PencilLine,
  Shuffle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiStore, type View } from '@/store/ui-store';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { listOpenDrafts, listProjects } from '@/core/queries';
import { Badge } from '@/components/ui/badge';

interface NavItem {
  view: View;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Sessões ainda não implementadas mostram o badge "em construção". */
  implemented?: boolean;
}

const LIBRARY_ITEMS: NavItem[] = [
  { view: 'library-variables', label: 'Variáveis', icon: ListTree, implemented: true },
  { view: 'library-compatibility', label: 'Compatibilidade', icon: Shuffle, implemented: true },
  { view: 'library-content', label: 'Conteúdo', icon: Library, implemented: true },
];

const BOTTOM_ITEMS: NavItem[] = [
  { view: 'templates', label: 'Templates', icon: LayoutTemplate },
  { view: 'timeline', label: 'Vigência', icon: CalendarClock, implemented: true },
  { view: 'drafts', label: 'Rascunhos', icon: PencilLine, implemented: true },
];

function NavButton({
  item,
  isActive,
  onClick,
  count,
}: {
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
  /** Badge de rascunho aberto na sidebar (docs/prompts/S13, item 5). */
  count?: number;
}) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
        isActive
          ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.implemented !== true && (
        <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
          em construção
        </Badge>
      )}
      {count !== undefined && count > 0 && (
        <Badge variant="amber" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
          {count}
        </Badge>
      )}
    </button>
  );
}

/** Um item por projeto de verdade — docs/prompts/S09-grid-e-matrizes.md item 1. */
function ProjectNav() {
  const document = useDocumentStore((s) => s.document);
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const selectedProjectId = useEditorStore((s) => s.selectedProjectId);
  const setSelectedProject = useEditorStore((s) => s.setSelectedProject);

  const summaries = document === null ? [] : listProjects(document);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => {
          setSelectedProject(null);
          setView('projects');
        }}
        aria-current={view === 'projects' && selectedProjectId === null ? 'page' : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
          view === 'projects' && selectedProjectId === null
            ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
            : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100',
        )}
      >
        <FolderKanban className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">Projetos</span>
      </button>
      {summaries.map(({ project }) => (
        <button
          key={project.id}
          type="button"
          onClick={() => {
            setSelectedProject(project.id);
            setView('projects');
          }}
          aria-current={view === 'projects' && selectedProjectId === project.id ? 'page' : undefined}
          className={cn(
            'ml-4 flex w-[calc(100%-1rem)] items-center gap-2 truncate rounded-md px-2.5 py-1 text-left text-xs transition-colors',
            view === 'projects' && selectedProjectId === project.id
              ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
              : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-500 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100',
          )}
        >
          <span className="truncate">{project.name}</span>
        </button>
      ))}
    </div>
  );
}

export function Sidebar() {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const document = useDocumentStore((s) => s.document);
  const openDraftCount = document === null ? 0 : listOpenDrafts(document).length;

  return (
    <nav aria-label="Navegação principal" className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <ProjectNav />

      <div className="flex flex-col gap-1">
        <div className="px-2.5 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          Biblioteca
        </div>
        {LIBRARY_ITEMS.map((item) => (
          <NavButton key={item.view} item={item} isActive={view === item.view} onClick={() => setView(item.view)} />
        ))}
      </div>

      <div className="flex flex-col gap-1">
        {BOTTOM_ITEMS.map((item) => (
          <NavButton
            key={item.view}
            item={item}
            isActive={view === item.view}
            onClick={() => setView(item.view)}
            count={item.view === 'drafts' ? openDraftCount : undefined}
          />
        ))}
      </div>
    </nav>
  );
}
