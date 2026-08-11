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

/**
 * Filtro de tags da lista de matrizes (docs/07-ux-e-editor.md §15) — estado
 * de interface, nunca do documento: não é salvo no `.json`. Escopado por
 * `projectId` para que trocar de projeto comece com o filtro limpo, mas
 * navegar entre a lista e o editor de uma matriz dentro do **mesmo**
 * projeto preserve os chips ativos.
 */
export type MatrixFilterState = {
  projectId: string | null;
  tags: string[];
  search: string;
};

interface UiState {
  view: View;
  /**
   * Fila de revisão da carga (docs/12 §6.2): a `importRunId` filtrada na tela
   * de Rascunhos e as versões já marcadas como revisadas.
   *
   * "Revisado" é **estado de interface**, não campo do documento: é a marca
   * pessoal de quem está conferindo agora, não um fato da política. Fica aqui
   * porque precisa sobreviver ao fechamento do assistente, e some quando a
   * aplicação é recarregada — o que existe de verdade é o rascunho.
   */
  importRunFilter: string | null;
  reviewedVersionIds: string[];
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
  theme: Theme;
  actor: string | null;
  identityDialogOpen: boolean;
  matrixFilter: MatrixFilterState;
  setView: (view: View) => void;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  toggleTheme: () => void;
  setActor: (name: string) => void;
  setImportRunFilter: (importRunId: string | null) => void;
  toggleReviewed: (versionId: string) => void;
  clearReviewed: (versionIds: string[]) => void;
  openIdentityDialog: () => void;
  closeIdentityDialog: () => void;
  /** Troca o projeto do filtro; limpa tags e busca quando o projeto muda. */
  setMatrixFilterProject: (projectId: string | null) => void;
  toggleMatrixFilterTag: (code: string) => void;
  setMatrixFilterSearch: (search: string) => void;
  clearMatrixFilter: () => void;
}

const initialActor = readLocalStorage(ACTOR_STORAGE_KEY);

export const useUiStore = create<UiState>((set) => ({
  view: viewFromHash(typeof window !== 'undefined' ? window.location.hash : ''),
  importRunFilter: null,
  reviewedVersionIds: [],
  sidebarCollapsed: false,
  inspectorCollapsed: false,
  theme: readInitialTheme(),
  actor: initialActor,
  identityDialogOpen: initialActor === null,
  matrixFilter: { projectId: null, tags: [], search: '' },

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

  setImportRunFilter: (importRunFilter) => set({ importRunFilter }),

  toggleReviewed: (versionId) =>
    set((s) => ({
      reviewedVersionIds: s.reviewedVersionIds.includes(versionId)
        ? s.reviewedVersionIds.filter((id) => id !== versionId)
        : [...s.reviewedVersionIds, versionId],
    })),

  clearReviewed: (versionIds) =>
    set((s) => ({
      reviewedVersionIds: s.reviewedVersionIds.filter((id) => !versionIds.includes(id)),
    })),

  openIdentityDialog: () => set({ identityDialogOpen: true }),
  closeIdentityDialog: () => set({ identityDialogOpen: false }),

  setMatrixFilterProject: (projectId) =>
    set((s) =>
      s.matrixFilter.projectId === projectId
        ? s
        : { matrixFilter: { projectId, tags: [], search: '' } },
    ),

  toggleMatrixFilterTag: (code) =>
    set((s) => {
      const tags = s.matrixFilter.tags.includes(code)
        ? s.matrixFilter.tags.filter((candidate) => candidate !== code)
        : [...s.matrixFilter.tags, code];
      return { matrixFilter: { ...s.matrixFilter, tags } };
    }),

  setMatrixFilterSearch: (search) => set((s) => ({ matrixFilter: { ...s.matrixFilter, search } })),

  clearMatrixFilter: () =>
    set((s) => ({ matrixFilter: { ...s.matrixFilter, tags: [], search: '' } })),
}));
