import { useEffect } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { usePersistenceStore } from '@/store/persistence-store';

/**
 * Ligações da camada de persistência com a janela:
 * - `Ctrl+S` salva, `Ctrl+Shift+S` salva como (docs/07-ux-e-editor.md §2);
 * - `beforeunload` avisa quando há alterações não salvas (§12 de docs/07);
 * - `beforeunload` também libera o bloqueio consultivo
 *   (docs/06-persistencia-e-concorrencia.md §6).
 */
export function usePersistence(): void {
  const init = usePersistenceStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isSaveChord = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
      if (!isSaveChord) return;
      if (useDocumentStore.getState().document === null) return;
      event.preventDefault();
      const store = usePersistenceStore.getState();
      void (event.shiftKey ? store.saveAs() : store.save());
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      // Liberar o lock aqui é "melhor esforço": `beforeunload` não espera
      // promessa. Se não der, o heartbeat parado torna o lock obsoleto em 10
      // minutos — que é exatamente para o que a regra dos 10 minutos existe.
      void usePersistenceStore.getState().releaseLockOnUnload();
      if (!useDocumentStore.getState().dirty) return;
      event.preventDefault();
      // Navegadores modernos ignoram o texto, mas `returnValue` ainda é o
      // que dispara o diálogo em parte deles.
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}
