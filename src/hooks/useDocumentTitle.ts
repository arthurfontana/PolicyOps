import { useEffect } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

const APP_NAME = 'PolicyOps';

/**
 * Título da aba refletindo o documento e a matriz abertos — docs/07 §12.
 * `document.title` é o único jeito de expressar isso (sem `<Helmet>` nem
 * biblioteca equivalente na lista aprovada de docs/02 §2).
 */
export function useDocumentTitle(): void {
  const documentName = useDocumentStore((s) => s.document?.meta.name ?? null);
  const view = useUiStore((s) => s.view);
  const currentMatrixId = useEditorStore((s) => s.currentMatrixId);
  // Seleciona o nome (primitivo, comparável por igualdade) em vez do array de
  // matrizes: devolver um array novo a cada chamada do seletor — mesmo
  // "igual" em conteúdo — quebra o cache de snapshot do React e entra em
  // loop de atualização (erro #185).
  const matrixName = useDocumentStore(
    (s) => s.document?.matrices.find((candidate) => candidate.id === currentMatrixId)?.name,
  );

  useEffect(() => {
    if (documentName === null) {
      document.title = APP_NAME;
      return;
    }
    const matrix = view === 'matrix' ? matrixName : undefined;
    document.title = matrix !== undefined ? `${matrix} — ${documentName} · ${APP_NAME}` : `${documentName} · ${APP_NAME}`;
  }, [documentName, view, matrixName]);
}
