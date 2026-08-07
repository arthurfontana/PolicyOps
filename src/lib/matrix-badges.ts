import type { MatrixVersion } from '@/core/document/schema';
import type { BadgeVariant } from '@/components/ui/badge';
import { formatDateBR } from '@/lib/format';

/** Badges de estado de versão — docs/07-ux-e-editor.md §3. */
export type VersionBadgeInfo = { label: string; variant: BadgeVariant; strike?: boolean };

/** Só os campos que a decisão do badge usa — `MatrixVersion` inteira e `MatrixVersionSummary` cabem aqui. */
export type VersionBadgeInput = Pick<MatrixVersion, 'state' | 'number' | 'effectiveFrom' | 'effectiveTo'>;

export function versionBadge(version: VersionBadgeInput, now: Date = new Date()): VersionBadgeInfo {
  if (version.state === 'DRAFT') return { label: 'Rascunho', variant: 'amber' };

  if (version.state === 'ARCHIVED') return { label: 'Descartado', variant: 'secondary', strike: true };

  if (version.state === 'SUPERSEDED') {
    const from = version.effectiveFrom === undefined ? '?' : formatDateBR(version.effectiveFrom);
    const to = version.effectiveTo === undefined ? '?' : formatDateBR(version.effectiveTo);
    return { label: `Histórico · ${from} a ${to}`, variant: 'secondary' };
  }

  // PUBLISHED: vigente ou agendado, conforme `effectiveFrom` comparado a `now`.
  const effectiveFrom = version.effectiveFrom === undefined ? null : new Date(version.effectiveFrom);
  if (effectiveFrom !== null && effectiveFrom.getTime() > now.getTime()) {
    return { label: `Agendado · a partir de ${formatDateBR(version.effectiveFrom!)}`, variant: 'blue' };
  }
  return { label: `Vigente · v${version.number}`, variant: 'green' };
}
