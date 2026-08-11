import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { MAX_COMBINATIONS } from '@/core/axes/tuples';
import type { ImportTable } from '@/core/import/parse-table';
import type { DocumentWithProfiles, ImportProfile } from '@/core/import/profile';
import { columnsWithRole } from '@/core/import/profile';
import { checkGridSize, step2ProfileIssues } from './wizard-guards';

export interface Step2CalcPanelProps {
  doc: DocumentWithProfiles;
  table: ImportTable;
  profile: ImportProfile;
  matrixCount: number;
}

/**
 * Painel lateral fixo do passo 2: partições × desdobramento = matrizes,
 * células totais, maior grid e o limite de 6.000 (I16) —
 * docs/12-carga-de-matrizes.md §6.1.
 */
export function Step2CalcPanel({ doc, table, profile, matrixCount }: Step2CalcPanelProps) {
  const issues = useMemo(() => step2ProfileIssues(doc, profile, table.header), [doc, profile, table.header]);
  const blocking = issues.filter((issue) => issue.severity === 'ERROR');
  const grid = useMemo(() => (blocking.length === 0 ? checkGridSize(doc, profile) : undefined), [
    doc,
    profile,
    blocking.length,
  ]);

  const partitionCount = columnsWithRole(profile, 'PARTITION').length;
  const unpivotOptions = profile.unpivot?.options.length ?? 1;
  const totalCells = grid?.ok === true ? matrixCount * grid.combinations : undefined;

  return (
    <Card className="w-72 shrink-0">
      <CardContent className="flex flex-col gap-3 p-4 text-sm">
        <h3 className="font-medium text-neutral-900 dark:text-neutral-100">Cálculo ao vivo</h3>

        {blocking.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-xs text-red-600 dark:text-red-400">
            {blocking.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        ) : (
          <>
            <p className="text-neutral-600 dark:text-neutral-400">
              {partitionCount} {partitionCount === 1 ? 'partição' : 'partições'}
              {profile.unpivot !== undefined && ` × ${unpivotOptions} ${profile.unpivot.label}`} ={' '}
              <span className="font-medium text-neutral-900 dark:text-neutral-100">
                {matrixCount} {matrixCount === 1 ? 'matriz' : 'matrizes'}
              </span>
            </p>
            {grid !== undefined && grid.ok && (
              <>
                <p className="text-neutral-600 dark:text-neutral-400">
                  Maior grid: <span className="font-medium">{grid.combinations}</span> combinações
                  (limite {MAX_COMBINATIONS})
                </p>
                {totalCells !== undefined && (
                  <p className="text-neutral-600 dark:text-neutral-400">
                    Células totais (estimado): <span className="font-medium">{totalCells}</span>
                  </p>
                )}
              </>
            )}
            {grid !== undefined && !grid.ok && (
              <p className="text-xs text-red-600 dark:text-red-400">{grid.reason}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
