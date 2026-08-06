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
import { Badge } from '@/components/ui/badge';

interface NavItem {
  view: View;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Sessões ainda não implementadas mostram o badge "em construção". */
  implemented?: boolean;
}

const TOP_ITEMS: NavItem[] = [{ view: 'projects', label: 'Projetos', icon: FolderKanban }];

const LIBRARY_ITEMS: NavItem[] = [
  { view: 'library-variables', label: 'Variáveis', icon: ListTree, implemented: true },
  { view: 'library-compatibility', label: 'Compatibilidade', icon: Shuffle, implemented: true },
  { view: 'library-content', label: 'Conteúdo', icon: Library },
];

const BOTTOM_ITEMS: NavItem[] = [
  { view: 'templates', label: 'Templates', icon: LayoutTemplate },
  { view: 'timeline', label: 'Vigência', icon: CalendarClock },
  { view: 'drafts', label: 'Rascunhos', icon: PencilLine },
];

function NavButton({ item }: { item: NavItem }) {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const isActive = view === item.view;
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={() => setView(item.view)}
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
    </button>
  );
}

export function Sidebar() {
  return (
    <nav aria-label="Navegação principal" className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div className="flex flex-col gap-1">
        {TOP_ITEMS.map((item) => (
          <NavButton key={item.view} item={item} />
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <div className="px-2.5 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          Biblioteca
        </div>
        {LIBRARY_ITEMS.map((item) => (
          <NavButton key={item.view} item={item} />
        ))}
      </div>

      <div className="flex flex-col gap-1">
        {BOTTOM_ITEMS.map((item) => (
          <NavButton key={item.view} item={item} />
        ))}
      </div>
    </nav>
  );
}
