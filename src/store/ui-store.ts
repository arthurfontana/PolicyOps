import { create } from 'zustand';
import type { ComponentReviewStatus, PolicyComponentType } from '@/core/document/schema';
import { resolveServerToken } from '@/storage/capabilities';

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
  | 'board'
  | 'import'
  | 'acl'
  | 'change-requests'
  | 'releases'
  | 'db-timeline';

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
  board: '#/board',
  import: '#/import',
  acl: '#/acl',
  'change-requests': '#/db',
  releases: '#/releases',
  'db-timeline': '#/db-timeline',
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

/**
 * Só um indício rápido e síncrono — não a detecção completa do modo `SERVER`
 * (essa é assíncrona, em `usePersistenceStore.init()`). Existe para decidir,
 * sem esperar `/api/health`, se o diálogo "como você quer ser identificado?"
 * deve nascer aberto: se há token (`?t=` ou já guardado na sessão), a aba
 * quase certamente foi aberta pelo servidor local, e o diálogo não deveria
 * nem piscar na tela antes de `enterServerMode()` fechá-lo (docs/02 §6,
 * docs/14 §5 e §8).
 */
function hasServerTokenHint(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      resolveServerToken({
        location: window.location,
        sessionStorage: window.sessionStorage,
        replaceUrl: (url) => window.history.replaceState(null, '', url),
      }) !== null
    );
  } catch {
    return false;
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

/**
 * Estado de interface da árvore da política (docs/07-ux-e-editor.md §17.1):
 * expansão, busca e os mesmos três filtros do painel — tipo, `reviewStatus`
 * e faceta de tag. Nunca é salvo no `.json`, igual a `matrixFilter`.
 * Escopado por `projectId` pela mesma razão: trocar de projeto começa com a
 * árvore fechada e sem filtro; navegar dentro do mesmo projeto preserva.
 */
export type ComponentTreeState = {
  projectId: string | null;
  /** `Record`, não `Set`: zustand compara por igualdade estrutural rasa em testes e devtools. */
  expanded: Record<string, boolean>;
  search: string;
  types: PolicyComponentType[];
  reviewStatuses: ComponentReviewStatus[];
  tags: string[];
};

const EMPTY_COMPONENT_TREE_STATE: ComponentTreeState = {
  projectId: null,
  expanded: {},
  search: '',
  types: [],
  reviewStatuses: [],
  tags: [],
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
  /**
   * Modo apresentação do board de comparação (§9b): esconde todo o chrome do
   * shell (topo, sidebar, inspector, barra de status) para uso direto numa
   * reunião — projetada ou compartilhada por tela. Estado de UI puro, nunca
   * salvo: sempre nasce `false` ao abrir a aplicação.
   */
  presentationMode: boolean;
  theme: Theme;
  actor: string | null;
  identityDialogOpen: boolean;
  matrixFilter: MatrixFilterState;
  componentTree: ComponentTreeState;
  setView: (view: View) => void;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  setPresentationMode: (value: boolean) => void;
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

  /** Troca o projeto da árvore; fecha os nós e limpa o filtro quando o projeto muda. */
  setComponentTreeProject: (projectId: string | null) => void;
  toggleComponentExpanded: (componentId: string) => void;
  /** Abre um conjunto de nós (não fecha os demais) — usado para revelar um nó recém-criado ou navegado. */
  expandComponents: (componentIds: string[]) => void;
  setComponentTreeSearch: (search: string) => void;
  toggleComponentTreeType: (type: PolicyComponentType) => void;
  toggleComponentTreeReviewStatus: (status: ComponentReviewStatus) => void;
  toggleComponentTreeTag: (code: string) => void;
  clearComponentTreeFilter: () => void;
}

const initialActor = readLocalStorage(ACTOR_STORAGE_KEY);

export const useUiStore = create<UiState>((set) => ({
  view: viewFromHash(typeof window !== 'undefined' ? window.location.hash : ''),
  importRunFilter: null,
  reviewedVersionIds: [],
  sidebarCollapsed: false,
  inspectorCollapsed: false,
  presentationMode: false,
  theme: readInitialTheme(),
  actor: initialActor,
  identityDialogOpen: initialActor === null && !hasServerTokenHint(),
  matrixFilter: { projectId: null, tags: [], search: '' },
  componentTree: EMPTY_COMPONENT_TREE_STATE,

  setView: (view) => set({ view }),

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  toggleInspector: () => set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed })),

  setPresentationMode: (value) => set({ presentationMode: value }),

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

  setComponentTreeProject: (projectId) =>
    set((s) =>
      s.componentTree.projectId === projectId
        ? s
        : { componentTree: { ...EMPTY_COMPONENT_TREE_STATE, projectId } },
    ),

  toggleComponentExpanded: (componentId) =>
    set((s) => ({
      componentTree: {
        ...s.componentTree,
        expanded: { ...s.componentTree.expanded, [componentId]: !s.componentTree.expanded[componentId] },
      },
    })),

  expandComponents: (componentIds) =>
    set((s) => {
      const expanded = { ...s.componentTree.expanded };
      for (const id of componentIds) expanded[id] = true;
      return { componentTree: { ...s.componentTree, expanded } };
    }),

  setComponentTreeSearch: (search) =>
    set((s) => ({ componentTree: { ...s.componentTree, search } })),

  toggleComponentTreeType: (type) =>
    set((s) => {
      const types = s.componentTree.types.includes(type)
        ? s.componentTree.types.filter((candidate) => candidate !== type)
        : [...s.componentTree.types, type];
      return { componentTree: { ...s.componentTree, types } };
    }),

  toggleComponentTreeReviewStatus: (status) =>
    set((s) => {
      const reviewStatuses = s.componentTree.reviewStatuses.includes(status)
        ? s.componentTree.reviewStatuses.filter((candidate) => candidate !== status)
        : [...s.componentTree.reviewStatuses, status];
      return { componentTree: { ...s.componentTree, reviewStatuses } };
    }),

  toggleComponentTreeTag: (code) =>
    set((s) => {
      const tags = s.componentTree.tags.includes(code)
        ? s.componentTree.tags.filter((candidate) => candidate !== code)
        : [...s.componentTree.tags, code];
      return { componentTree: { ...s.componentTree, tags } };
    }),

  clearComponentTreeFilter: () =>
    set((s) => ({
      componentTree: { ...s.componentTree, search: '', types: [], reviewStatuses: [], tags: [] },
    })),
}));
