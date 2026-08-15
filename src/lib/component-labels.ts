import {
  FileQuestion,
  Grid3x3,
  Hash,
  ListChecks,
  type LucideIcon,
  Rows3,
  ScrollText,
  Variable as VariableIcon,
} from 'lucide-react';
import type { BadgeVariant } from '@/components/ui/badge';
import type { ComponentReviewStatus, PolicyComponentType } from '@/core/document/schema';

/**
 * Rótulos e ícones da árvore de política (docs/07-ux-e-editor.md §17) — o
 * mesmo `type`/`reviewStatus` do documento, só em pt-BR e com um ícone por
 * tipo. Fica em `src/lib/` (não em `src/core/`, que é TypeScript puro sem
 * nada de apresentação) — regra 4 de docs/prompts/README.md.
 */

export const COMPONENT_TYPE_LABELS: Record<PolicyComponentType, string> = {
  SECTION: 'Seção',
  RULE: 'Regra',
  MATRIX: 'Matriz',
  LIST: 'Lista',
  REASON_CODE: 'Reason code',
  POLICY_VARIABLE: 'Variável de política',
  OTHER: 'Outro',
};

export const COMPONENT_TYPE_ICONS: Record<PolicyComponentType, LucideIcon> = {
  SECTION: Rows3,
  RULE: ScrollText,
  MATRIX: Grid3x3,
  LIST: ListChecks,
  REASON_CODE: Hash,
  POLICY_VARIABLE: VariableIcon,
  OTHER: FileQuestion,
};

export const COMPONENT_REVIEW_STATUS_LABELS: Record<ComponentReviewStatus, string> = {
  STRUCTURED: 'Estruturado',
  VALIDATED: 'Validado',
  PENDING_REVIEW: 'Aguardando revisão',
  HISTORICAL_SOURCE: 'Fonte histórica',
};

export const COMPONENT_REVIEW_STATUS_VARIANTS: Record<ComponentReviewStatus, BadgeVariant> = {
  STRUCTURED: 'secondary',
  VALIDATED: 'green',
  PENDING_REVIEW: 'amber',
  HISTORICAL_SOURCE: 'outline',
};
