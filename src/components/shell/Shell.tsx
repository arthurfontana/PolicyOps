import { useEffect, type ReactNode } from 'react';
import { PanelLeft, PanelRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui-store';
import { Sidebar } from './Sidebar';
import { Inspector } from './Inspector';
import { StatusBar } from './StatusBar';
import { PersistenceBanners } from './PersistenceBanners';
import { ThemeToggle } from './ThemeToggle';
import { Button } from '@/components/ui/button';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function useCollapseShortcuts() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleInspector = useUiStore((s) => s.toggleInspector);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === '[') {
        event.preventDefault();
        toggleSidebar();
      } else if (event.key === ']') {
        event.preventDefault();
        toggleInspector();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleSidebar, toggleInspector]);
}

export function Shell({ children }: { children: ReactNode }) {
  useCollapseShortcuts();

  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const inspectorCollapsed = useUiStore((s) => s.inspectorCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleInspector = useUiStore((s) => s.toggleInspector);

  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-neutral-200 px-3 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Expandir barra lateral ([)' : 'Recolher barra lateral ([)'}
            aria-pressed={sidebarCollapsed}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold">PolicyOps</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleInspector}
            aria-label={inspectorCollapsed ? 'Expandir inspector (])' : 'Recolher inspector (])'}
            aria-pressed={inspectorCollapsed}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <PersistenceBanners />

      <div className="flex min-h-0 flex-1">
        {!sidebarCollapsed && (
          <aside className={cn('w-[248px] shrink-0 border-r border-neutral-200 dark:border-neutral-800')}>
            <Sidebar />
          </aside>
        )}

        <main className="min-w-0 flex-1 overflow-auto">{children}</main>

        {!inspectorCollapsed && (
          <aside className={cn('w-[340px] shrink-0 border-l border-neutral-200 dark:border-neutral-800')}>
            <Inspector />
          </aside>
        )}
      </div>

      <StatusBar />
    </div>
  );
}
