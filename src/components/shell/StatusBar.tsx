import { Circle, Loader2, Lock, TriangleAlert } from 'lucide-react';
import { useUiStore } from '@/store/ui-store';
import { useActor } from '@/hooks/useActor';
import { SAVE_STATUS_LABEL, usePersistenceStore } from '@/store/persistence-store';

/**
 * Barra de status — docs/07-ux-e-editor.md §2 e
 * docs/06-persistencia-e-concorrencia.md §6: nome do arquivo, estado de
 * salvamento, revisão e quem detém o bloqueio consultivo.
 */
function StatusIcon({ status }: { status: ReturnType<typeof usePersistenceStore.getState>['status'] }) {
  if (status === 'saving') return <Loader2 className="h-3 w-3 animate-spin" aria-hidden />;
  if (status === 'error') return <TriangleAlert className="h-3 w-3 text-red-600" aria-hidden />;
  if (status === 'dirty') return <Circle className="h-2 w-2 fill-amber-500 text-amber-500" aria-hidden />;
  if (status === 'saved') return <Circle className="h-2 w-2 fill-green-600 text-green-600" aria-hidden />;
  return null;
}

export function StatusBar() {
  const openIdentityDialog = useUiStore((s) => s.openIdentityDialog);
  const { actor } = useActor();

  const fileName = usePersistenceStore((s) => s.fileName);
  const filePath = usePersistenceStore((s) => s.filePath);
  const status = usePersistenceStore((s) => s.status);
  const revision = usePersistenceStore((s) => s.revision);
  const mode = usePersistenceStore((s) => s.mode);
  const readOnly = usePersistenceStore((s) => s.readOnly);
  const lockHeldByOther = usePersistenceStore((s) => s.lockHeldByOther);
  const lockOwned = usePersistenceStore((s) => s.lockOwned);
  const errorMessage = usePersistenceStore((s) => s.errorMessage);

  const lockLabel = lockHeldByOther
    ? `Bloqueio consultivo: ${lockHeldByOther.info.holder}`
    : lockOwned
      ? 'Bloqueio consultivo: você'
      : null;

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between border-t border-neutral-200 bg-neutral-50 px-3 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={fileName === null ? 'italic text-neutral-400 dark:text-neutral-500' : 'truncate'}
          title={filePath ?? undefined}
        >
          {fileName ?? 'Sem arquivo'}
        </span>
        <span aria-hidden className="text-neutral-300 dark:text-neutral-700">
          ·
        </span>
        <span className="flex items-center gap-1.5" data-testid="save-status">
          <StatusIcon status={status} />
          {SAVE_STATUS_LABEL[status]}
        </span>
        {status !== 'no-document' && (
          <>
            <span aria-hidden className="text-neutral-300 dark:text-neutral-700">
              ·
            </span>
            <span>revisão {revision}</span>
          </>
        )}
        {readOnly && (
          <>
            <span aria-hidden className="text-neutral-300 dark:text-neutral-700">
              ·
            </span>
            <span>somente leitura</span>
          </>
        )}
        {errorMessage !== null && (
          <span className="truncate text-red-600 dark:text-red-400" title={errorMessage}>
            {errorMessage}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {lockLabel !== null && (
          <span className="flex items-center gap-1">
            <Lock className="h-3 w-3" aria-hidden />
            {lockLabel}
          </span>
        )}
        <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] uppercase dark:bg-neutral-800">
          {mode}
        </span>
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
