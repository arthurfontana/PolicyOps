import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, PanelLeft, PanelRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui-store';
import { Button } from '@/components/ui/button';
import { Sidebar } from './Sidebar';
import { Inspector } from './Inspector';
import { StatusBar } from './StatusBar';
import { PersistenceBanners } from './PersistenceBanners';
import { ThemeToggle } from './ThemeToggle';
import { ErrorBoundary } from './ErrorBoundary';
import { ShortcutsDialog } from './ShortcutsDialog';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** `[`/`]` recolhem sidebar/inspector; `?` abre o diálogo de atalhos (docs/07 §12). */
function useShellShortcuts(onOpenShortcuts: () => void) {
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
      } else if (event.key === '?') {
        event.preventDefault();
        onOpenShortcuts();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleSidebar, toggleInspector, onOpenShortcuts]);
}

/** `Esc` sai do modo apresentação de qualquer lugar — não há formulário nele para conflitar. */
function usePresentationEscape() {
  const presentationMode = useUiStore((s) => s.presentationMode);
  const setPresentationMode = useUiStore((s) => s.setPresentationMode);

  useEffect(() => {
    if (!presentationMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPresentationMode(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [presentationMode, setPresentationMode]);
}

export function Shell({ children }: { children: ReactNode }) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useShellShortcuts(() => setShortcutsOpen(true));
  usePresentationEscape();

  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const inspectorCollapsed = useUiStore((s) => s.inspectorCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleInspector = useUiStore((s) => s.toggleInspector);
  const presentationMode = useUiStore((s) => s.presentationMode);
  const setPresentationMode = useUiStore((s) => s.setPresentationMode);

  if (presentationMode) {
    return (
      <div className="flex h-screen flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="absolute right-3 top-3 z-50 shadow-sm"
          onClick={() => setPresentationMode(false)}
        >
          <X className="mr-1.5 h-3.5 w-3.5" /> Sair da apresentação (Esc)
        </Button>
        <main className="min-h-0 flex-1 overflow-auto">
          <ErrorBoundary region="Conteúdo">{children}</ErrorBoundary>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-neutral-200 px-3 print:hidden dark:border-neutral-800">
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
            onClick={() => setShortcutsOpen(true)}
            aria-label="Ver atalhos de teclado (?)"
          >
            <Keyboard className="h-4 w-4" />
          </Button>
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

      <div role="region" aria-label="Avisos">
        <PersistenceBanners />
      </div>

      <div className="flex min-h-0 flex-1 print:block">
        {!sidebarCollapsed && (
          <aside
            aria-label="Barra lateral"
            className={cn(
              'w-[248px] shrink-0 border-r border-neutral-200 print:hidden dark:border-neutral-800',
            )}
          >
            <ErrorBoundary region="Barra lateral">
              <Sidebar />
            </ErrorBoundary>
          </aside>
        )}

        <main className="min-w-0 flex-1 overflow-auto print:overflow-visible">
          <ErrorBoundary region="Conteúdo">{children}</ErrorBoundary>
        </main>

        {!inspectorCollapsed && (
          <aside
            aria-label="Inspector"
            className={cn(
              'w-[340px] shrink-0 border-l border-neutral-200 print:hidden dark:border-neutral-800',
            )}
          >
            <ErrorBoundary region="Inspector">
              <Inspector />
            </ErrorBoundary>
          </aside>
        )}
      </div>

      <StatusBar />

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
