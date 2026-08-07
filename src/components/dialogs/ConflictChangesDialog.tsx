import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { CompareView } from '@/components/compare/CompareView';
import { diffDocuments, type ConflictVersionEntry } from '@/core/diff/documents';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { getEditorView } from '@/core/queries';
import type { ConflictLine } from '@/storage/conflict';

/**
 * "Ver o que mudou" do conflito de salvamento —
 * docs/06-persistencia-e-concorrencia.md §5, item 2 da S14.
 *
 * A S05 mostrava uma lista textual de contagens por coleção. Agora é a tela de
 * comparação de verdade: a lista das versões de matriz que divergem entre o
 * meu documento e o do arquivo, e o diff completo da que a pessoa escolher.
 *
 * A base (esquerda) é sempre o documento remoto — é o que existe no disco
 * agora; o meu é a proposta de mudança por cima.
 */

export interface ConflictChangesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mine: PolicyOpsDocument;
  theirs: PolicyOpsDocument;
  /** Comparação campo a campo do topo do documento (revisão, quem salvou, contagens). */
  lines: ConflictLine[];
}

const STATUS_LABEL: Record<ConflictVersionEntry['status'], string> = {
  CHANGED: 'alterada',
  ONLY_MINE: 'só no meu',
  ONLY_THEIRS: 'só no arquivo',
};

export function ConflictChangesDialog({
  open,
  onOpenChange,
  mine,
  theirs,
  lines,
}: ConflictChangesDialogProps) {
  const entries = useMemo(() => diffDocuments(mine, theirs), [mine, theirs]);
  const comparable = entries.filter((entry) => entry.diff !== null);

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    comparable[0]?.versionId ?? null,
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selected = comparable.find((entry) => entry.versionId === selectedVersionId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-6xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>O que mudou entre o arquivo e o meu documento</DialogTitle>
          <DialogDescription>
            {entries.length === 0
              ? 'Nenhuma versão de matriz difere entre os dois documentos.'
              : `${entries.length} versão(ões) de matriz diferem. A esquerda é o arquivo como está no disco; a direita é o que o seu salvamento gravaria.`}
          </DialogDescription>
        </DialogHeader>

        <details className="shrink-0 rounded-md border border-neutral-200 dark:border-neutral-800">
          <summary className="cursor-pointer px-3 py-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            Resumo do documento
          </summary>
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
              <tr>
                <th className="p-2 font-medium">Campo</th>
                <th className="p-2 font-medium">O meu</th>
                <th className="p-2 font-medium">O do arquivo</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.label}
                  className={
                    line.changed
                      ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                      : ''
                  }
                >
                  <td className="p-2">{line.label}</td>
                  <td className="p-2">{line.mine}</td>
                  <td className="p-2">{line.theirs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        {entries.length > 0 && (
          <ul className="flex shrink-0 flex-wrap gap-1.5">
            {entries.map((entry) => (
              <li key={entry.versionId}>
                <button
                  type="button"
                  disabled={entry.diff === null}
                  data-testid="conflict-version-chip"
                  aria-pressed={entry.versionId === selectedVersionId}
                  onClick={() => {
                    setSelectedVersionId(entry.versionId);
                    setSelectedKey(null);
                  }}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
                    entry.versionId === selectedVersionId
                      ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                      : 'border-neutral-300 text-neutral-700 dark:border-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  {entry.matrixCode} v{entry.versionNumber}
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {STATUS_LABEL[entry.status]}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
          {selected === null ? (
            <p className="p-4 text-sm text-neutral-500 dark:text-neutral-400">
              Nenhuma versão de matriz para comparar lado a lado.
            </p>
          ) : (
            <CompareView
              diff={selected.diff!}
              aView={getEditorView(theirs, selected.versionId)}
              bView={getEditorView(mine, selected.versionId)}
              aLabel="No arquivo"
              bLabel="O meu"
              inlineDetail
              selectedKey={selectedKey}
              onSelectKey={setSelectedKey}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
