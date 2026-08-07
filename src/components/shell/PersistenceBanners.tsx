import { FolderKey, Lock, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePersistenceStore } from '@/store/persistence-store';
import { LOCK_ADVISORY_NOTE } from '@/storage/lock';
import { BACKUP_REDUNDANCY_NOTE } from '@/storage/backups';
import { DOWNLOAD_ONLY_CONFLICT_WARNING } from '@/storage/conflict';
import { useDocumentStore } from '@/store/document-store';

/**
 * Faixas de aviso do topo do shell:
 * - bloqueio consultivo de outra pessoa (§6), com as duas saídas do
 *   documento normativo e a palavra "consultivo" onde ela precisa estar;
 * - pasta indisponível (lock e backup desligados — §6 e §9);
 * - backup que não pôde ser gravado (§9, avisa uma vez e segue);
 * - ausência de detecção de conflito no modo DOWNLOAD_ONLY (§5).
 */

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'amber' | 'neutral' | 'red';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const toneClass = {
    amber: 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300',
    red: 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200',
  }[tone];

  return (
    <div className={`flex items-start gap-2 border-b border-neutral-200 px-3 py-2 text-xs print:hidden dark:border-neutral-800 ${toneClass}`}>
      <span className="mt-0.5 shrink-0" aria-hidden>
        {icon}
      </span>
      <div className="flex flex-1 flex-col gap-1">{children}</div>
    </div>
  );
}

export function PersistenceBanners() {
  const lockHeldByOther = usePersistenceStore((s) => s.lockHeldByOther);
  const lockUnavailableReason = usePersistenceStore((s) => s.lockUnavailableReason);
  const backupWarning = usePersistenceStore((s) => s.backupWarning);
  const mode = usePersistenceStore((s) => s.mode);
  const openReadOnly = usePersistenceStore((s) => s.openReadOnly);
  const takeLockAnyway = usePersistenceStore((s) => s.takeLockAnyway);
  const enableFolderFeatures = usePersistenceStore((s) => s.enableFolderFeatures);
  const hasDocument = useDocumentStore((s) => s.document !== null);

  return (
    <>
      {lockHeldByOther !== null && (
        <Banner tone="amber" icon={<Lock className="h-4 w-4" />}>
          <p className="font-medium">{lockHeldByOther.description}</p>
          <p>{LOCK_ADVISORY_NOTE}</p>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={openReadOnly}>
              Abrir somente leitura (recomendado)
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void takeLockAnyway()}>
              Editar assim mesmo
            </Button>
          </div>
        </Banner>
      )}

      {hasDocument && mode === 'FULL' && lockUnavailableReason !== null && (
        <Banner tone="neutral" icon={<FolderKey className="h-4 w-4" />}>
          <p>{lockUnavailableReason}</p>
          <p>{BACKUP_REDUNDANCY_NOTE}</p>
          <div className="pt-1">
            <Button size="sm" variant="secondary" onClick={() => void enableFolderFeatures()}>
              Dar acesso à pasta
            </Button>
          </div>
        </Banner>
      )}

      {backupWarning !== null && (
        <Banner tone="neutral" icon={<TriangleAlert className="h-4 w-4" />}>
          <p>{backupWarning}</p>
        </Banner>
      )}

      {hasDocument && mode === 'DOWNLOAD_ONLY' && <DownloadOnlyWarning />}
    </>
  );
}

function DownloadOnlyWarning() {
  const dismissed = usePersistenceStore((s) => s.downloadOnlyWarningDismissed);
  const dismiss = usePersistenceStore((s) => s.dismissDownloadOnlyWarning);
  if (dismissed) return null;

  return (
    <Banner tone="amber" icon={<TriangleAlert className="h-4 w-4" />}>
      <div className="flex items-start justify-between gap-2">
        <p>{DOWNLOAD_ONLY_CONFLICT_WARNING}</p>
        <button type="button" onClick={dismiss} aria-label="Dispensar o aviso" className="shrink-0">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </Banner>
  );
}
