import { useEffect } from 'react';
import { HASH_BY_VIEW, useUiStore, viewFromHash } from '@/store/ui-store';

/**
 * Mantém `ui-store.view` e `window.location.hash` sincronizados nos dois
 * sentidos, para que recarregar a página (F5) mantenha a mesma tela —
 * sem nenhuma biblioteca de rotas (docs/02-arquitetura.md, docs/07 item 11).
 */
export function useHashRouting(): void {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);

  useEffect(() => {
    const syncFromHash = () => setView(viewFromHash(window.location.hash));
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, [setView]);

  useEffect(() => {
    const nextHash = HASH_BY_VIEW[view];
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, [view]);
}
