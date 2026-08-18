import type { BadgeVariant } from '@/components/ui/badge';
import type { ReleaseJointStatus } from '@/core/document/releases';
import type { ReleaseStatus } from '@/core/document/schema';

/**
 * Rótulos e cores da release (docs/14-governanca-de-alteracoes.md §3.4,
 * docs/07-ux-e-editor.md §19.6) — mesmo raciocínio de
 * `src/lib/change-request-labels.ts`: fica em `src/lib/`, não em `src/core/`.
 */

export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  PLANNED: 'Planejada',
  IN_DEVELOPMENT: 'Em desenvolvimento',
  PUBLISHED: 'Publicada',
  CANCELLED: 'Cancelada',
};

export const RELEASE_STATUS_VARIANTS: Record<ReleaseStatus, BadgeVariant> = {
  PLANNED: 'secondary',
  IN_DEVELOPMENT: 'blue',
  PUBLISHED: 'green',
  CANCELLED: 'outline',
};

/**
 * Rótulo do **status conjunto** (`deriveReleaseJointStatus`) — o que a lista
 * de releases mostra: "dá para publicar hoje?", derivado dos DBs, não o
 * `Release.status` bruto.
 */
export const RELEASE_JOINT_STATUS_LABELS: Record<ReleaseJointStatus, string> = {
  EMPTY: 'Sem DB vinculado',
  IN_PROGRESS: 'Em andamento',
  READY: 'Pronta para publicar',
  PUBLISHED: 'Publicada',
  CANCELLED: 'Cancelada',
};

export const RELEASE_JOINT_STATUS_VARIANTS: Record<ReleaseJointStatus, BadgeVariant> = {
  EMPTY: 'secondary',
  IN_PROGRESS: 'blue',
  READY: 'green',
  PUBLISHED: 'green',
  CANCELLED: 'outline',
};
