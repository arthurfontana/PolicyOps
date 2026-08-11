import { useMemo } from 'react';
import { Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { ImportTable } from '@/core/import/parse-table';
import type { CatalogGap, CompatibilityGap, DomainsGap } from '@/core/import/library-gaps';
import type { DocumentWithProfiles } from '@/core/import/profile';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';
import { libraryGapsOf } from './wizard-guards';
import { DomainsGapCard } from './library/DomainsGapCard';
import { CompatibilityGapCard } from './library/CompatibilityGapCard';
import { CatalogGapCard } from './library/CatalogGapCard';

/**
 * Passo 3 — biblioteca. docs/12-carga-de-matrizes.md US-03, US-04,
 * DEC-CARGA-008. Ordem `DOMAINS → COMPATIBILITY → CATALOG`: o mapa de
 * compatibilidade depende dos domínios de cada lado já existirem.
 */
export function Step3Library({ table }: { table: ImportTable }) {
  const document = useDocumentStore((s) => s.document);
  const profile = useImportStore((s) => s.profile);

  const gaps = useMemo(() => {
    if (document === null) return [];
    return libraryGapsOf(document as DocumentWithProfiles, table, profile);
  }, [document, table, profile]);

  if (document === null) return null;

  const domainsGaps = gaps.filter((gap): gap is DomainsGap => gap.kind === 'DOMAINS');
  const compatibilityGaps = gaps.filter((gap): gap is CompatibilityGap => gap.kind === 'COMPATIBILITY');
  const catalogGaps = gaps.filter((gap): gap is CatalogGap => gap.kind === 'CATALOG');

  if (gaps.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
          <Check className="h-6 w-6 text-green-600 dark:text-green-400" />
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            A biblioteca já tem tudo que este mapeamento precisa.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {domainsGaps.map((gap) => (
        <DomainsGapCard key={`${gap.variableId}:${gap.column}`} gap={gap} />
      ))}
      {compatibilityGaps.map((gap) => (
        <CompatibilityGapCard key={`${gap.parentVariableId}:${gap.childVariableId}`} gap={gap} />
      ))}
      {catalogGaps.map((gap) => (
        <CatalogGapCard key={gap.catalogKind} gap={gap} />
      ))}
    </div>
  );
}
