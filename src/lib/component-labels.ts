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

/**
 * Rótulo pt-BR de cada campo de payload (S36) — os mesmos de
 * `ComponentPayloadFields` (docs/07 §17.5), sem o sufixo de digitação
 * ("separados por vírgula"), que só faz sentido no formulário. É o que o diff
 * campo a campo da revisão do DB (§19.5) mostra na coluna da esquerda.
 *
 * Chave desconhecida cai no nome cru do campo: um payload de schema futuro
 * aparece com o nome técnico em vez de sumir da comparação.
 */
export const PAYLOAD_FIELD_LABELS: Record<string, string> = {
  businessDescription: 'Descrição de negócio',
  technicalDefinition: 'Definição técnica',
  inputs: 'Entradas',
  conditions: 'Condições',
  outcome: 'Resultado',
  reasonCodes: 'Reason codes',
  dependencies: 'Dependências',
  notes: 'Notas',
  purpose: 'Finalidade',
  fields: 'Campos',
  code: 'Código',
  decision: 'Decisão',
  message: 'Mensagem',
  technicalName: 'Nome técnico',
  source: 'Origem',
  domainDescription: 'Domínio (descritivo)',
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
