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
  | 'db-timeline'
  | 'policy-compare';

export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'policyops.theme';
const ACTOR_STORAGE_KEY = 'policyops.actor';
const SIDEBAR_WIDTH_STORAGE_KEY = 'policyops.sidebarWidth';

/**
 * Largura da barra lateral (docs/07-ux-e-editor.md §2, DEC-UX-005): a
 * navegação agora carrega a árvore inteira da política, e nome de seção real
 * não cabe em 248px. É preferência de interface — `localStorage`, como o tema
 * —, nunca documento.
 */
export const SIDEBAR_MIN_WIDTH = 248;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 288;
/** Abaixo disto o `code` do nó não aparece na árvore (§17.1). */
export const SIDEBAR_CODE_VISIBLE_WIDTH = 340;
/** Passo das setas ←/→ com a alça de redimensionamento em foco (§2). */
export const SIDEBAR_WIDTH_STEP = 16;

/** Arrastar respeita os limites; o intervalo é a régua, não uma sugestão. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

/**
 * Leitura defensiva do `localStorage`: valor corrompido (ou de uma versão
 * futura, fora do intervalo) cai no padrão em vez de deixar a navegação com
 * 4px ou 4000px — DEC-UX-005, "custo aceito".
 */
export function parseSidebarWidth(raw: string | null): number {
  if (raw === null) return SIDEBAR_DEFAULT_WIDTH;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || raw.trim() === '') return SIDEBAR_DEFAULT_WIDTH;
  const rounded = Math.round(parsed);
  if (rounded < SIDEBAR_MIN_WIDTH || rounded > SIDEBAR_MAX_WIDTH) return SIDEBAR_DEFAULT_WIDTH;
  return rounded;
}

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
  'policy-compare': '#/politica/comparar',
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
  /** Largura da navegação em px, dentro de `SIDEBAR_MIN_WIDTH`–`SIDEBAR_MAX_WIDTH`. */
  sidebarWidth: number;
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
  /**
   * Data da tela de Vigência (docs/07 §10, DEC-UX-004): `yyyy-MM-dd` da
   * fotografia que a consulta histórica está mostrando, ou `null` enquanto a
   * tela ainda não escolheu uma (nasce em "hoje"). Mora na store, e não na
   * tela, porque os saltos vêm de fora dela — a faixa de vigência da página do
   * componente (§20.2) e os atalhos "Ver a política em…" da comparação
   * (§20.3). É estado de interface: nunca entra no documento, e **nunca**
   * bloqueia a edição em lugar nenhum — a árvore da barra lateral é sempre
   * hoje.
   */
  policyAtDate: string | null;
  setView: (view: View) => void;
  toggleSidebar: () => void;
  /** Arrasta a borda da navegação; o valor entra no intervalo e é persistido. */
  setSidebarWidth: (width: number) => void;
  /** Duplo clique na alça — volta ao padrão (§2). */
  resetSidebarWidth: () => void;
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
  /** Fecha um conjunto de nós — `Alt+clique` no chevron fecha a subárvore inteira (§17.1). */
  collapseComponents: (componentIds: string[]) => void;
  /** "Recolher tudo" no cabeçalho do projeto (§17.1). */
  collapseAllComponents: () => void;
  setComponentTreeSearch: (search: string) => void;
  toggleComponentTreeType: (type: PolicyComponentType) => void;
  toggleComponentTreeReviewStatus: (status: ComponentReviewStatus) => void;
  toggleComponentTreeTag: (code: string) => void;
  clearComponentTreeFilter: () => void;

  /** Troca a data da tela de Vigência sem navegar (a própria tela, ao mexer no seletor). */
  setPolicyAtDate: (date: string) => void;
  /** O salto: abre a tela de Vigência **na** data — é o que §20.2 e §20.3 usam. */
  openPolicyAt: (date: string) => void;
}

const initialActor = readLocalStorage(ACTOR_STORAGE_KEY);

export const useUiStore = create<UiState>((set) => ({
  view: viewFromHash(typeof window !== 'undefined' ? window.location.hash : ''),
  importRunFilter: null,
  reviewedVersionIds: [],
  sidebarCollapsed: false,
  sidebarWidth: parseSidebarWidth(readLocalStorage(SIDEBAR_WIDTH_STORAGE_KEY)),
  inspectorCollapsed: false,
  presentationMode: false,
  theme: readInitialTheme(),
  actor: initialActor,
  identityDialogOpen: initialActor === null && !hasServerTokenHint(),
  matrixFilter: { projectId: null, tags: [], search: '' },
  componentTree: EMPTY_COMPONENT_TREE_STATE,
  policyAtDate: null,

  setView: (view) => set({ view }),

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setSidebarWidth: (width) => {
    const next = clampSidebarWidth(width);
    writeLocalStorage(SIDEBAR_WIDTH_STORAGE_KEY, String(next));
    set({ sidebarWidth: next });
  },

  resetSidebarWidth: () => {
    writeLocalStorage(SIDEBAR_WIDTH_STORAGE_KEY, String(SIDEBAR_DEFAULT_WIDTH));
    set({ sidebarWidth: SIDEBAR_DEFAULT_WIDTH });
  },

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

  collapseComponents: (componentIds) =>
    set((s) => {
      const expanded = { ...s.componentTree.expanded };
      for (const id of componentIds) delete expanded[id];
      return { componentTree: { ...s.componentTree, expanded } };
    }),

  collapseAllComponents: () => set((s) => ({ componentTree: { ...s.componentTree, expanded: {} } })),

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

  setPolicyAtDate: (policyAtDate) => set({ policyAtDate }),

  openPolicyAt: (policyAtDate) => set({ policyAtDate, view: 'timeline' }),
}));
