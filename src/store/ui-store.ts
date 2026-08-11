import { create } from 'zustand';

/**
 * Estado de UI da aplicação: navegação (SPA de arquivo único, sem
 * react-router — docs/02-arquitetura.md), painéis do shell, tema e a
 * identidade do usuário (nome de exibição para o histórico, não login).
 */
export type View =
  | 'home'
  | 'document'
  | 'projects'
  | 'library-variables'
  | 'library-compatibility'
  | 'library-content'
  | 'templates'
  | 'timeline'
  | 'drafts'
  | 'matrix'
  | 'compare'
  | 'import';

export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'policyops.theme';
const ACTOR_STORAGE_KEY = 'policyops.actor';

export const HASH_BY_VIEW: Record<View, string> = {
  home: '#/',
  document: '#/documento',
  projects: '#/projects',
  'library-variables': '#/library/variables',
  'library-compatibility': '#/library/compatibility',
  'library-content': '#/library/content',
  templates: '#/templates',
  timeline: '#/timeline',
  drafts: '#/drafts',
  matrix: '#/matrix',
  compare: '#/compare',
  import: '#/import',
};

const VIEW_BY_HASH: Partial<Record<string, View>> = Object.fromEntries(
  Object.entries(HASH_BY_VIEW).map(([view, hash]) => [hash, view as View]),
);

/** Ignora a query string (`?date=...&project=...`) — só a rota decide a `View`. */
export function viewFromHash(hash: string): View {
  const base = hash.split('?')[0] ?? hash;
  return VIEW_BY_HASH[base] ?? 'home';
}

function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage indisponível (ex.: modo privado); segue apenas em memória */
  }
}

function readInitialTheme(): Theme {
  const stored = readLocalStorage(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyThemeClass(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

interface UiState {
  view: View;
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
  theme: Theme;
  actor: string | null;
  identityDialogOpen: boolean;
  setView: (view: View) => void;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  toggleTheme: () => void;
  setActor: (name: string) => void;
  openIdentityDialog: () => void;
  closeIdentityDialog: () => void;
}

const initialActor = readLocalStorage(ACTOR_STORAGE_KEY);

export const useUiStore = create<UiState>((set) => ({
  view: viewFromHash(typeof window !== 'undefined' ? window.location.hash : ''),
  sidebarCollapsed: false,
  inspectorCollapsed: false,
  theme: readInitialTheme(),
  actor: initialActor,
  identityDialogOpen: initialActor === null,

  setView: (view) => set({ view }),

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  toggleInspector: () => set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed })),

  toggleTheme: () =>
    set((s) => {
      const next: Theme = s.theme === 'dark' ? 'light' : 'dark';
      applyThemeClass(next);
      writeLocalStorage(THEME_STORAGE_KEY, next);
      return { theme: next };
    }),

  setActor: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    writeLocalStorage(ACTOR_STORAGE_KEY, trimmed);
    set({ actor: trimmed, identityDialogOpen: false });
  },

  openIdentityDialog: () => set({ identityDialogOpen: true }),
  closeIdentityDialog: () => set({ identityDialogOpen: false }),
}));
