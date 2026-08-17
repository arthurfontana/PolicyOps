import type { BadgeVariant } from '@/components/ui/badge';
import type { ChangeRequestChangeType, CrPriority, CrStatus } from '@/core/document/schema';

/**
 * Rótulos e cores do Diário de Bordo (docs/14-governanca-de-alteracoes.md
 * §3.3/§5, docs/07-ux-e-editor.md §19) — mesmo `status`/`priority`/
 * `changeType` do documento, só em pt-BR e com uma cor de badge por estado.
 * Fica em `src/lib/` (não em `src/core/`, que é TypeScript puro sem nada de
 * apresentação) — regra 4 de docs/prompts/README.md.
 */

export const CR_STATUS_LABELS: Record<CrStatus, string> = {
  DRAFT: 'Rascunho',
  SUBMITTED: 'Submetido',
  IN_REVIEW: 'Em revisão',
  CHANGES_REQUESTED: 'Devolvido',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  IN_DEVELOPMENT: 'Em desenvolvimento',
  IN_VALIDATION: 'Em validação',
  READY_FOR_RELEASE: 'Pronto para release',
  SCHEDULED: 'Agendado',
  PUBLISHED: 'Publicado',
  CANCELLED: 'Cancelado',
};

export const CR_STATUS_VARIANTS: Record<CrStatus, BadgeVariant> = {
  DRAFT: 'secondary',
  SUBMITTED: 'blue',
  IN_REVIEW: 'blue',
  CHANGES_REQUESTED: 'amber',
  APPROVED: 'green',
  REJECTED: 'outline',
  IN_DEVELOPMENT: 'blue',
  IN_VALIDATION: 'blue',
  READY_FOR_RELEASE: 'blue',
  SCHEDULED: 'blue',
  PUBLISHED: 'green',
  CANCELLED: 'outline',
};

/** `REJECTED`/`CANCELLED` usam `outline` — esta classe extra marca o encerramento sem inventar variant nova em `badge.tsx`. */
export const CR_STATUS_CLOSED_CLASS = 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-400';

export const CR_PRIORITY_LABELS: Record<CrPriority, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};

export const CR_PRIORITY_VARIANTS: Record<CrPriority, BadgeVariant> = {
  LOW: 'secondary',
  MEDIUM: 'blue',
  HIGH: 'amber',
  CRITICAL: 'outline',
};

export const CHANGE_TYPE_LABELS: Record<ChangeRequestChangeType, string> = {
  UPDATE: 'Atualizar',
  CREATE: 'Criar',
  DEACTIVATE: 'Desativar',
  REACTIVATE: 'Reativar',
  MOVE: 'Mover',
  DOC_ONLY: 'Só documentação',
};
