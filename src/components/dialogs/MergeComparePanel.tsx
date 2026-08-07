import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CompareView } from '@/components/compare/CompareView';
import { diffVersionPair } from '@/core/diff';
import type { Matrix, MatrixVersion, PolicyOpsDocument } from '@/core/document/schema';
import { getEditorView } from '@/core/queries';

/**
 * Pré-visualização de um conflito de versão de matriz, com a tela de
 * comparação da S14 — docs/06-persistencia-e-concorrencia.md §7 ("com preview
 * de cada lado usando a tela de comparação quando forem versões de matriz").
 *
 * Cada lado vem de um documento diferente, e é por isso que `diffVersionPair`
 * recebe um `DiffContext` com os dois: os rótulos e os valores de catálogo de
 * cada lado precisam ser resolvidos no documento de origem.
 */

export type MergeComparePanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mine: PolicyOpsDocument;
  theirs: PolicyOpsDocument;
  title: string;
  mineVersionId: string | null;
  theirsVersionId: string | null;
};

function findVersion(
  doc: PolicyOpsDocument,
  versionId: string | null,
): { matrix: Matrix; version: MatrixVersion } | null {
  if (versionId === null) return null;
  for (const matrix of doc.matrices) {
    const version = matrix.versions.find((candidate) => candidate.id === versionId);
    if (version !== undefined) return { matrix, version };
  }
  return null;
}

export function MergeComparePanel({
  open,
  onOpenChange,
  mine,
  theirs,
  title,
  mineVersionId,
  theirsVersionId,
}: MergeComparePanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const sides = useMemo(() => {
    const mineSide = findVersion(mine, mineVersionId);
    const theirsSide = findVersion(theirs, theirsVersionId);
    if (mineSide === null || theirsSide === null) return null;
    return {
      mineSide,
      theirsSide,
      // A base (esquerda) é o arquivo: é o que já está no disco; o meu é a
      // proposta por cima.
      diff: diffVersionPair({ a: theirs, b: mine }, theirsSide, mineSide),
      aView: getEditorView(theirs, theirsSide.version.id),
      bView: getEditorView(mine, mineSide.version.id),
    };
  }, [mine, theirs, mineVersionId, theirsVersionId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-6xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            À esquerda, o que está no arquivo; à direita, o do seu documento. Comparar não decide
            nada — a escolha continua na tela de merge.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
          {sides === null ? (
            <p className="p-4 text-sm text-neutral-500 dark:text-neutral-400">
              Um dos lados não tem versão correspondente para comparar lado a lado.
            </p>
          ) : (
            <CompareView
              diff={sides.diff}
              aView={sides.aView}
              bView={sides.bView}
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
