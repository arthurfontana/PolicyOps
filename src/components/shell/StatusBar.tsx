import { useUiStore } from '@/store/ui-store';
import { useActor } from '@/hooks/useActor';

export function StatusBar() {
  const openIdentityDialog = useUiStore((s) => s.openIdentityDialog);
  const { actor } = useActor();

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between border-t border-neutral-200 bg-neutral-50 px-3 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
      <div className="flex items-center gap-3">
        <span className="italic text-neutral-400 dark:text-neutral-500">Sem arquivo</span>
        <span aria-hidden className="text-neutral-300 dark:text-neutral-700">
          ·
        </span>
        <span>Nenhum documento aberto</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={openIdentityDialog}
          className="rounded px-1.5 py-0.5 hover:bg-neutral-200 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          title="Trocar identificação"
        >
          {actor ?? 'Identificar-se'}
        </button>
      </div>
    </footer>
  );
}
