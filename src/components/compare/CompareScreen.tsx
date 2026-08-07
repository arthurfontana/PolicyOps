import { useEffect, useMemo } from 'react';
import { ArrowLeft, ArrowRight, GitCompare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ExportMenu } from '@/components/shell/ExportMenu';
import { diffVersions, orderForCompare } from '@/core/diff';
import { diffCsvFileName, exportDiffCsv } from '@/core/export/diff-csv';
import { defaultComparePair, getEditorView } from '@/core/queries';
import { downloadCsv } from '@/lib/download';
import { listComparableVersions } from '@/lib/diff-view';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';
import { CompareView } from './CompareView';

/**
 * Rota `compare` — docs/07-ux-e-editor.md §9.
 *
 * Resolve o par de versões (do store, ou um padrão sensato) e entrega tudo
 * pronto para `CompareView`, que é quem desenha. O "antes → depois" de cada
 * célula aparece no inspector do shell, alimentado por `compareSelectedKey`.
 */

export function CompareScreen() {
  const document = useDocumentStore((s) => s.document);
  const compareVersionIds = useEditorStore((s) => s.compareVersionIds);
  const setCompareVersions = useEditorStore((s) => s.setCompareVersions);
  const selectedKey = useEditorStore((s) => s.compareSelectedKey);
  const setSelectedKey = useEditorStore((s) => s.setCompareSelectedKey);
  const setView = useUiStore((s) => s.setView);

  const options = useMemo(
    () => (document === null ? [] : listComparableVersions(document)),
    [document],
  );
  const known = useMemo(() => new Set(options.map((option) => option.id)), [options]);

  // Um par vindo de outro documento (ou de uma versão que sumiu) não pode
  // sobreviver a esta tela: cai no padrão sensato.
  const pair =
    compareVersionIds !== null &&
    known.has(compareVersionIds.aId) &&
    known.has(compareVersionIds.bId)
      ? compareVersionIds
      : document === null
        ? null
        : defaultComparePair(document);

  useEffect(() => {
    if (document === null || pair === null) return;
    if (compareVersionIds?.aId === pair.aId && compareVersionIds.bId === pair.bId) return;
    setCompareVersions(pair.aId, pair.bId);
  }, [document, pair, compareVersionIds, setCompareVersions]);

  if (document === null || pair === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Não há duas versões de matriz para comparar neste documento.
        </p>
        <Button onClick={() => setView('projects')}>Ir para projetos</Button>
      </div>
    );
  }

  const { aId, bId } = pair;
  const diff = diffVersions(document, aId, bId);
  const aView = getEditorView(document, aId);
  const bView = getEditorView(document, bId);
  const aLabel = `${diff.a.matrixCode} v${diff.a.number}`;
  const bLabel = `${diff.b.matrixCode} v${diff.b.number}`;

  /** Escolher qualquer das duas pontas reordena: a mais antiga fica à esquerda. */
  function choose(side: 'a' | 'b', versionId: string) {
    const other = side === 'a' ? bId : aId;
    if (versionId === other) return;
    const ordered = orderForCompare(document!, versionId, other);
    setCompareVersions(ordered.aId, ordered.bId);
  }

  function handleExportDiffCsv() {
    downloadCsv(diffCsvFileName(diff.a.matrixCode, diff.a.number, diff.b.number), exportDiffCsv(document!, diff));
  }

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="icon" aria-label="Voltar à matriz" onClick={() => setView('matrix')}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <GitCompare className="h-4 w-4 text-neutral-400" aria-hidden />
      <h1 className="font-semibold text-neutral-900 dark:text-neutral-100">Comparar versões</h1>

      <Select value={aId} onValueChange={(value) => choose('a', value)}>
        <SelectTrigger className="ml-2 w-64" aria-label="Versão base (a mais antiga)">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <ArrowRight className="h-4 w-4 text-neutral-400" aria-hidden />

      <Select value={bId} onValueChange={(value) => choose('b', value)}>
        <SelectTrigger className="w-64" aria-label="Versão comparada">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="ml-auto">
        <ExportMenu items={[{ key: 'diff-csv', label: 'Exportar CSV do diff', onSelect: handleExportDiffCsv }]} />
      </div>
    </div>
  );

  return (
    <CompareView
      diff={diff}
      aView={aView}
      bView={bView}
      aLabel={aLabel}
      bLabel={bLabel}
      header={header}
      selectedKey={selectedKey}
      onSelectKey={setSelectedKey}
    />
  );
}
