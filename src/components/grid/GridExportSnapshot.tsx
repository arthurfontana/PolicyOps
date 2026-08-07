import { forwardRef } from 'react';
import type { Matrix, MatrixVersion } from '@/core/document/schema';
import type { EditorView } from '@/core/queries';
import { formatDateBR, formatDateTimeBR } from '@/lib/format';
import { versionBadge } from '@/lib/matrix-badges';
import { Grid } from './Grid';

/**
 * O nó capturado pelo export PNG — docs/08-camada-de-comandos.md §5: "título,
 * número da versão, vigência e legenda — a imagem vai virar slide de comitê e
 * precisa se explicar sozinha". A legenda e os contadores já vêm do rodapé do
 * próprio `Grid` (docs/07 §4.1); aqui só entra o cabeçalho.
 */
export interface GridExportSnapshotProps {
  matrix: Matrix;
  version: MatrixVersion;
  view: EditorView;
}

function vigenciaText(version: MatrixVersion): string {
  if (version.state === 'DRAFT') return 'Rascunho — ainda não publicado';
  if (version.effectiveFrom === undefined) return 'Sem data de vigência';
  if (version.effectiveTo === undefined) return `Vigente desde ${formatDateBR(version.effectiveFrom)}`;
  return `Vigente de ${formatDateBR(version.effectiveFrom)} a ${formatDateBR(version.effectiveTo)}`;
}

export const GridExportSnapshot = forwardRef<HTMLDivElement, GridExportSnapshotProps>(function GridExportSnapshot(
  { matrix, version, view },
  ref,
) {
  const badge = versionBadge(version);

  return (
    <div
      ref={ref}
      className="flex w-fit flex-col gap-3 bg-white p-6 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold">
          {matrix.name}{' '}
          <span className="font-mono text-sm font-normal text-neutral-400 dark:text-neutral-500">
            ({matrix.code})
          </span>
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Versão {version.number} · {badge.label} · {vigenciaText(version)}
        </p>
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          Exportado em {formatDateTimeBR(new Date().toISOString())}
        </p>
      </div>
      <Grid view={view} zoom={1} />
    </div>
  );
});
