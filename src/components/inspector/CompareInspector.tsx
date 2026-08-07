import { useMemo } from 'react';
import { DiffCellDetail } from '@/components/compare/DiffCellDetail';
import { diffVersions } from '@/core/diff';
import { getEditorView } from '@/core/queries';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

/**
 * O inspector da tela de comparação — docs/07-ux-e-editor.md §9: "clicar
 * mostra antes → depois no inspector".
 *
 * Recalcula o diff a partir do documento e do par comparado. É barato: o par
 * só muda quando a pessoa troca de versão, e clicar numa célula não recalcula
 * nada além do `useMemo` abaixo.
 */
export function CompareInspector() {
  const document = useDocumentStore((s) => s.document);
  const compareVersionIds = useEditorStore((s) => s.compareVersionIds);
  const selectedKey = useEditorStore((s) => s.compareSelectedKey);

  const resolved = useMemo(() => {
    if (document === null || compareVersionIds === null) return null;
    const { aId, bId } = compareVersionIds;
    const versionIds = new Set(
      document.matrices.flatMap((matrix) => matrix.versions.map((version) => version.id)),
    );
    if (!versionIds.has(aId) || !versionIds.has(bId)) return null;
    return {
      diff: diffVersions(document, aId, bId),
      aView: getEditorView(document, aId),
      bView: getEditorView(document, bId),
    };
  }, [document, compareVersionIds]);

  if (resolved === null) {
    return (
      <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Comparação</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Escolha duas versões para comparar.
        </p>
      </div>
    );
  }

  const { diff, aView, bView } = resolved;
  const change = selectedKey === null ? null : (diff.cells.find((entry) => entry.key === selectedKey) ?? null);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Antes e depois
      </h2>
      <DiffCellDetail
        change={change}
        aView={aView}
        bView={bView}
        aLabel={`v${diff.a.number}`}
        bLabel={`v${diff.b.number}`}
      />
      {diff.comparable && diff.summaryText.length > 0 && (
        <div className="border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Resumo
          </h3>
          <ul className="flex flex-col gap-0.5 text-sm text-neutral-700 dark:text-neutral-300">
            {diff.summaryText.map((phrase) => (
              <li key={phrase}>{phrase}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
