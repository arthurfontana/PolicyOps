import { Fragment, type ComponentType } from 'react';
import {
  BookOpenCheck,
  CalendarClock,
  Columns3,
  FolderKanban,
  GitCompare,
  History,
  LayoutTemplate,
  Library,
  ListTree,
  Package,
  PencilLine,
  Shuffle,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiStore, type View } from '@/store/ui-store';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useEffectiveRole } from '@/hooks/useRole';
import { isOpenMode } from '@/core/document/roles';
import { getChangeRequestPendingSummary } from '@/core/document/change-requests';
import { listMatrices, listOpenDrafts, listProjects } from '@/core/queries';
import { PolicyTree, READING_ORDER_NOTE } from '@/components/tree/PolicyTree';
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
  { view: 'change-requests', label: 'Diário de Bordo', icon: BookOpenCheck, implemented: true },
  { view: 'releases', label: 'Releases', icon: Package, implemented: true },
  { view: 'db-timeline', label: 'Linha do tempo do DB', icon: History, implemented: true },
  { view: 'templates', label: 'Templates', icon: LayoutTemplate, implemented: true },
  { view: 'timeline', label: 'Vigência', icon: CalendarClock, implemented: true },
  { view: 'policy-compare', label: 'Comparar política', icon: GitCompare, implemented: true },
  { view: 'drafts', label: 'Rascunhos', icon: PencilLine, implemented: true },
  { view: 'board', label: 'Comparação', icon: Columns3, implemented: true },
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
  const matrixFilter = useUiStore((s) => s.matrixFilter);
  const selectedProjectId = useEditorStore((s) => s.selectedProjectId);
  const setSelectedProject = useEditorStore((s) => s.setSelectedProject);

  const summaries = document === null ? [] : listProjects(document);
  const filterActive = matrixFilter.tags.length > 0 || matrixFilter.search.trim().length > 0;
  const filteredCount =
    document === null || matrixFilter.projectId === null || !filterActive
      ? null
      : listMatrices(document, {
          projectId: matrixFilter.projectId,
          tags: matrixFilter.tags,
          search: matrixFilter.search,
        }).matrices.length;

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
      {summaries.map(({ project, matrixCount }) => {
        const showFilteredCount = filteredCount !== null && matrixFilter.projectId === project.id;
        return (
          <Fragment key={project.id}>
          <button
            type="button"
            onClick={() => {
              setSelectedProject(project.id);
              setView('projects');
            }}
            aria-current={view === 'projects' && selectedProjectId === project.id ? 'page' : undefined}
            title={`${project.name} — ${READING_ORDER_NOTE}`}
            className={cn(
              'ml-4 flex w-[calc(100%-1rem)] items-center gap-2 truncate rounded-md px-2.5 py-1 text-left text-xs transition-colors',
              view === 'projects' && selectedProjectId === project.id
                ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
                : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-500 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100',
            )}
          >
            <span className="truncate">{project.name}</span>
            {matrixCount > 0 && (
              <span className="ml-auto shrink-0 text-[10px] text-neutral-400 dark:text-neutral-600">
                {showFilteredCount ? `${matrixCount} · ${filteredCount} no filtro` : matrixCount}
              </span>
            )}
          </button>
          {selectedProjectId === project.id && <PolicyTree projectId={project.id} />}
          </Fragment>
        );
      })}
    </div>
  );
}

const ACL_ITEM: NavItem = { view: 'acl', label: 'Acesso', icon: ShieldCheck, implemented: true };

export function Sidebar() {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const document = useDocumentStore((s) => s.document);
  const role = useEffectiveRole();
  const openDraftCount = document === null ? 0 : listOpenDrafts(document).length;
  const boardCount = useEditorStore((s) => s.boardItems.length);
  const changeRequestPendingCount =
    document === null ? 0 : getChangeRequestPendingSummary(document).awaitingReview.length;

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
            count={
              item.view === 'drafts'
                ? openDraftCount
                : item.view === 'board'
                  ? boardCount
                  : item.view === 'change-requests'
                    ? changeRequestPendingCount
                    : undefined
            }
          />
        ))}
        {/*
          ADMIN vê a tela de acesso; em modo aberto (sem ACL, ou sem nenhum
          ADMIN na lista) ela também aparece para todo mundo — é como o
          primeiro ADMIN nasce (docs/14-plataforma-local.md §6).
        */}
        {document !== null && (role === 'ADMIN' || isOpenMode(document)) && (
          <NavButton item={ACL_ITEM} isActive={view === 'acl'} onClick={() => setView('acl')} />
        )}
      </div>
    </nav>
  );
}
