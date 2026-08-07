import { useMemo, useState } from 'react';
import { GitMerge, TriangleAlert } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { mergeDocuments } from '@/core/merge';
import {
  MERGE_ACTION_LABEL,
  type MergeChoice,
  type MergeConflict,
  type MergeResolutions,
  type MergeSide,
} from '@/core/merge';
import { useDocumentStore } from '@/store/document-store';
import { usePersistenceStore } from '@/store/persistence-store';
import { MergeComparePanel } from './MergeComparePanel';

/**
 * A tela de merge — docs/06-persistencia-e-concorrencia.md §7.
 *
 * A regra que comanda o desenho: **nada é mesclado sem o usuário ver**. A tela
 * lista tudo que será aplicado automaticamente e pede decisão só nos
 * conflitos. O resultado é recalculado a cada escolha — o que está na tela é
 * exatamente o que será gravado — e nada é escrito até "Mesclar e salvar".
 */

function ConflictCard({
  conflict,
  resolution,
  onChoose,
  onChooseField,
  onCompare,
}: {
  conflict: MergeConflict;
  resolution: { choice: MergeChoice; fields?: Record<string, MergeSide> };
  onChoose: (choice: MergeChoice) => void;
  onChooseField: (key: string, side: MergeSide) => void;
  onCompare: () => void;
}) {
  const base: MergeSide = resolution.choice === 'THEIRS' ? 'THEIRS' : 'MINE';
  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20"
      data-testid="merge-conflict"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {conflict.title}
          </h4>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">{conflict.summary}</p>
        </div>
        {conflict.preview.kind === 'MATRIX_VERSION' && (
          <Button variant="secondary" size="sm" onClick={onCompare}>
            Comparar
          </Button>
        )}
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="sr-only">{conflict.title}</legend>
        {conflict.options.map((option) => (
          <label key={option.choice} className="flex items-start gap-2 text-xs">
            <input
              type="radio"
              className="mt-0.5"
              name={conflict.id}
              value={option.choice}
              checked={resolution.choice === option.choice}
              onChange={() => onChoose(option.choice)}
            />
            <span>
              <span className="font-medium text-neutral-900 dark:text-neutral-100">
                {option.label}
              </span>
              <span className="text-neutral-600 dark:text-neutral-400"> — {option.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {conflict.fields.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead className="text-neutral-500 dark:text-neutral-400">
            <tr>
              <th className="py-1 font-medium">Campo</th>
              <th className="py-1 font-medium">O meu</th>
              <th className="py-1 font-medium">O do arquivo</th>
            </tr>
          </thead>
          <tbody>
            {conflict.fields.map((field) => {
              const side = resolution.fields?.[field.key] ?? base;
              return (
                <tr key={field.key} className="border-t border-amber-200 dark:border-amber-900">
                  <td className="py-1 pr-2">{field.label}</td>
                  {(['MINE', 'THEIRS'] as const).map((candidate) => (
                    <td key={candidate} className="py-1 pr-2">
                      <label className="flex items-start gap-1.5">
                        {field.choosable && (
                          <input
                            type="radio"
                            className="mt-0.5"
                            name={`${conflict.id}:${field.key}`}
                            checked={side === candidate}
                            onChange={() => onChooseField(field.key, candidate)}
                          />
                        )}
                        <span
                          className={
                            side === candidate
                              ? 'font-medium text-neutral-900 dark:text-neutral-100'
                              : 'text-neutral-500 dark:text-neutral-400'
                          }
                        >
                          {candidate === 'MINE' ? field.mine : field.theirs}
                        </span>
                      </label>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </li>
  );
}

export function MergeDialog() {
  const merge = usePersistenceStore((s) => s.merge);
  const applyMerge = usePersistenceStore((s) => s.applyMerge);
  const cancelMerge = usePersistenceStore((s) => s.cancelMerge);
  const mine = useDocumentStore((s) => s.document);

  const [resolutions, setResolutions] = useState<MergeResolutions>({});
  const [comparing, setComparing] = useState<MergeConflict | null>(null);

  const preview = useMemo(() => {
    if (merge === null || mine === null) return null;
    return mergeDocuments(mine, merge.theirs, { resolutions });
  }, [merge, mine, resolutions]);

  if (merge === null || mine === null || preview === null) return null;

  const { applied, conflicts } = preview;
  const review = applied.filter((action) => action.needsReview === true);

  function close(): void {
    setResolutions({});
    setComparing(null);
    cancelMerge();
  }

  function resolutionFor(conflict: MergeConflict) {
    return resolutions[conflict.id] ?? { choice: conflict.defaultChoice };
  }

  return (
    <>
      <Dialog open onOpenChange={(next) => !next && close()}>
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitMerge className="h-5 w-5" aria-hidden />
              Mesclar com {merge.fileName}
            </DialogTitle>
            <DialogDescription>
              {merge.headline} Nada é gravado até você confirmar: revise o que entra
              automaticamente e decida os conflitos abaixo.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="green" data-testid="merge-applied-count">
              {applied.length} aplicação(ões) automática(s)
            </Badge>
            <Badge variant={conflicts.length > 0 ? 'amber' : 'secondary'} data-testid="merge-conflict-count">
              {conflicts.length} decisão(ões)
            </Badge>
            {review.length > 0 && <Badge variant="amber">{review.length} para revisar depois</Badge>}
          </div>

          {review.length > 0 && (
            <Alert>
              <TriangleAlert className="h-4 w-4 text-amber-600" aria-hidden />
              <AlertTitle>Aplicado, mas confira depois</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {review.map((action) => (
                    <li key={`${action.kind}-${action.entity.id}-${action.summary}`}>
                      {action.summary}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
            {conflicts.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  Precisa da sua decisão
                </h3>
                <ul className="flex flex-col gap-2">
                  {conflicts.map((conflict) => (
                    <ConflictCard
                      key={conflict.id}
                      conflict={conflict}
                      resolution={resolutionFor(conflict)}
                      onChoose={(choice) =>
                        setResolutions((current) => ({
                          ...current,
                          [conflict.id]: { ...resolutionFor(conflict), choice },
                        }))
                      }
                      onChooseField={(key, side) =>
                        setResolutions((current) => {
                          const previous = resolutionFor(conflict);
                          return {
                            ...current,
                            [conflict.id]: {
                              ...previous,
                              fields: { ...previous.fields, [key]: side },
                            },
                          };
                        })
                      }
                      onCompare={() => setComparing(conflict)}
                    />
                  ))}
                </ul>
              </section>
            )}

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Será aplicado automaticamente
              </h3>
              {applied.length === 0 ? (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Nada a aplicar automaticamente: os dois documentos já têm o mesmo conteúdo.
                </p>
              ) : (
                <ul className="flex flex-col gap-1" data-testid="merge-applied">
                  {applied.map((action, index) => (
                    <li
                      key={`${action.kind}-${action.entity.id}-${index}`}
                      className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800"
                    >
                      <Badge variant="secondary" className="shrink-0">
                        {MERGE_ACTION_LABEL[action.kind]}
                      </Badge>
                      <span className="text-neutral-700 dark:text-neutral-300">
                        {action.summary}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={close}>
              Cancelar
            </Button>
            <Button
              data-testid="merge-confirm"
              onClick={() => {
                const chosen = resolutions;
                setResolutions({});
                setComparing(null);
                void applyMerge(chosen);
              }}
            >
              Mesclar e salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {comparing !== null && comparing.preview.kind === 'MATRIX_VERSION' && (
        <MergeComparePanel
          open
          onOpenChange={(next) => !next && setComparing(null)}
          mine={mine}
          theirs={merge.theirs}
          title={comparing.title}
          mineVersionId={comparing.preview.mineVersionId}
          theirsVersionId={comparing.preview.theirsVersionId}
        />
      )}
    </>
  );
}
