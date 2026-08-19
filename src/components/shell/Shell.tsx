import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, PanelLeft, PanelRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STEP,
  useUiStore,
} from '@/store/ui-store';
import { Button } from '@/components/ui/button';
import { useHasInspector } from '@/hooks/useHasInspector';
import { Sidebar } from './Sidebar';
import { Inspector } from './Inspector';
import { StatusBar } from './StatusBar';
import { PersistenceBanners } from './PersistenceBanners';
import { ThemeToggle } from './ThemeToggle';
import { ErrorBoundary } from './ErrorBoundary';
import { ShortcutsDialog } from './ShortcutsDialog';
import { ToolbarHost, ToolbarSlot } from './Toolbar';

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

/**
 * Alça de 4px na borda direita da navegação — docs/07-ux-e-editor.md §2,
 * DEC-UX-005. Arrastar ajusta a largura dentro do intervalo, duplo clique
 * volta ao padrão e `←`/`→` movem 16px com a alça em foco (quem não usa
 * mouse também precisa caber os nomes das seções na tela).
 */
function SidebarResizeHandle() {
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth);
  const resetSidebarWidth = useUiStore((s) => s.resetSidebarWidth);
  const [dragging, setDragging] = useState(false);
  const originRef = useRef<{ pointerX: number; width: number } | null>(null);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const origin = originRef.current;
      if (origin === null) return;
      setSidebarWidth(origin.width + (event.clientX - origin.pointerX));
    },
    [setSidebarWidth],
  );

  const onPointerUp = useCallback(() => {
    originRef.current = null;
    setDragging(false);
  }, []);

  useEffect(() => {
    if (!dragging) return undefined;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [dragging, onPointerMove, onPointerUp]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ajustar largura da navegação"
      aria-valuenow={sidebarWidth}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      data-testid="sidebar-resize-handle"
      title="Arraste para ajustar a largura · duplo clique volta ao padrão"
      onPointerDown={(event) => {
        event.preventDefault();
        originRef.current = { pointerX: event.clientX, width: sidebarWidth };
        setDragging(true);
      }}
      onDoubleClick={() => resetSidebarWidth()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          setSidebarWidth(sidebarWidth - SIDEBAR_WIDTH_STEP);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          setSidebarWidth(sidebarWidth + SIDEBAR_WIDTH_STEP);
        }
      }}
      className={cn(
        'absolute right-0 top-0 h-full w-1 cursor-col-resize bg-neutral-200 transition-colors print:hidden dark:bg-neutral-800',
        'hover:bg-blue-400 focus:bg-blue-500 focus:outline-none dark:hover:bg-blue-600',
        dragging && 'bg-blue-500',
      )}
    />
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useShellShortcuts(() => setShortcutsOpen(true));
  usePresentationEscape();

  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const inspectorCollapsed = useUiStore((s) => s.inspectorCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleInspector = useUiStore((s) => s.toggleInspector);
  const presentationMode = useUiStore((s) => s.presentationMode);
  const setPresentationMode = useUiStore((s) => s.setPresentationMode);
  const hasInspector = useHasInspector();
  const inspectorDisabledReason = 'Esta tela não tem propriedades de seleção';

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
    <ToolbarHost>
    <div className="flex h-screen flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      {/* Cabeçalho e barra de ferramentas moram no mesmo landmark: a faixa de
          ações da tela é chrome do shell, não conteúdo solto (§2.1). */}
      <header className="shrink-0 print:hidden">
        <div className="flex h-11 items-center justify-between border-b border-neutral-200 px-3 dark:border-neutral-800">
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
              disabled={!hasInspector}
              onClick={toggleInspector}
              aria-label={inspectorCollapsed ? 'Expandir inspector (])' : 'Recolher inspector (])'}
              aria-pressed={inspectorCollapsed}
              title={hasInspector ? undefined : inspectorDisabledReason}
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <ToolbarSlot />
      </header>

      <div role="region" aria-label="Avisos">
        <PersistenceBanners />
      </div>

      <div className="flex min-h-0 flex-1 print:block">
        {!sidebarCollapsed && (
          <aside
            aria-label="Barra lateral"
            style={{ width: sidebarWidth }}
            className={cn('relative min-w-0 shrink-0 print:hidden')}
          >
            <ErrorBoundary region="Barra lateral">
              <Sidebar />
            </ErrorBoundary>
            {/* Dentro do `aside` de propósito: a alça é parte da navegação, e
                conteúdo fora de landmark é violação de acessibilidade. */}
            <SidebarResizeHandle />
          </aside>
        )}

        <main className="min-w-0 flex-1 overflow-auto print:overflow-visible">
          <ErrorBoundary region="Conteúdo">{children}</ErrorBoundary>
        </main>

        {hasInspector && !inspectorCollapsed && (
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
    </ToolbarHost>
  );
}
