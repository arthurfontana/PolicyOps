import { create } from 'zustand';
import { useDocumentStore } from './document-store';

/**
 * Estado de navegação do editor de matriz: projeto selecionado, matriz e
 * versão abertas, e o zoom do grid — docs/09-roadmap-de-entregas.md S09.
 *
 * Fica fora de `ui-store` porque referencia ids do documento (projeto,
 * matriz, versão): abrir um documento novo invalida esses ids, então
 * `usePersistenceStore`/`useDocumentStore` são quem decide quando limpar
 * (`reset`), e não a troca de tela.
 */

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
}

interface EditorState {
  /** Projeto selecionado em `/projects` — `null` mostra a lista. */
  selectedProjectId: string | null;
  /** Matriz e versão abertas na tela de matriz — `null` é o estado vazio. */
  currentMatrixId: string | null;
  currentVersionId: string | null;
  zoom: number;

  setSelectedProject: (projectId: string | null) => void;
  openMatrix: (matrixId: string, versionId: string | null) => void;
  setVersion: (versionId: string) => void;
  closeMatrix: () => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  reset: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  selectedProjectId: null,
  currentMatrixId: null,
  currentVersionId: null,
  zoom: 1,

  setSelectedProject: (projectId) => set({ selectedProjectId: projectId }),

  openMatrix: (matrixId, versionId) =>
    set({ currentMatrixId: matrixId, currentVersionId: versionId, zoom: 1 }),

  setVersion: (versionId) => set({ currentVersionId: versionId }),

  closeMatrix: () => set({ currentMatrixId: null, currentVersionId: null }),

  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),

  zoomIn: () => set({ zoom: clampZoom(get().zoom + ZOOM_STEP) }),

  zoomOut: () => set({ zoom: clampZoom(get().zoom - ZOOM_STEP) }),

  resetZoom: () => set({ zoom: 1 }),

  reset: () =>
    set({ selectedProjectId: null, currentMatrixId: null, currentVersionId: null, zoom: 1 }),
}));

// Um documento diferente (ou nenhum) invalida os ids selecionados: sem isso,
// abrir outro arquivo com uma matriz aberta deixaria a tela de matriz
// apontando para um id que não existe mais neste documento.
let lastDocumentId: string | null = null;
useDocumentStore.subscribe((state) => {
  const nextId = state.document?.meta.id ?? null;
  if (nextId === lastDocumentId) return;
  lastDocumentId = nextId;
  useEditorStore.getState().reset();
});
