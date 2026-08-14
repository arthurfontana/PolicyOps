/**
 * Catálogo estável de códigos de erro de domínio.
 * Fonte normativa: docs/05-regras-de-negocio.md §9.
 */
export const DOMAIN_ERROR_CODES = [
  'NOT_FOUND',
  'DUPLICATE_CODE',
  'INVALID_INPUT',
  'VARIABLE_HAS_NO_PUBLISHED_VERSION',
  'VARIABLE_VERSION_IMMUTABLE',
  'COMPATIBILITY_PAIR_DUPLICATE',
  'COMPATIBILITY_VERSION_IMMUTABLE',
  'DRAFT_ALREADY_EXISTS',
  'NO_VERSION_TO_DERIVE',
  'VERSION_NOT_DRAFT',
  'VERSION_IMMUTABLE',
  'NOTES_REQUIRED',
  'UNSET_CELLS_REMAIN',
  'CELL_GRID_INCONSISTENT',
  'INVALID_COORD',
  'CATALOG_KIND_MISMATCH',
  'CATALOG_ITEM_ARCHIVED',
  'CATALOG_REF_MISSING',
  'LIMIT_NEEDS_NUMERIC_VALUE',
  'EFFECTIVE_DATE_INVALID',
  'PATCH_TOO_LARGE',
  'TOO_MANY_LEVELS',
  'DUPLICATE_VARIABLE_IN_AXIS',
  'VARIABLE_ON_BOTH_AXES',
  'AXIS_NEEDS_ONE_LEVEL',
  'NO_VALID_TUPLES',
  'GRID_TOO_LARGE',
  'AXIS_NOT_STALE',
  'VERSIONS_NOT_COMPARABLE',
  'DOCUMENT_SCHEMA_TOO_NEW',
  'DOCUMENT_INVALID',
  'SAVE_CONFLICT',
  'DOMAIN_TABLE_PARSE_ERROR',
  // Carga de matrizes — docs/12-carga-de-matrizes.md §5.8. São os códigos que
  // **bloqueiam**: aparecem como `ImportIssue` de severidade `ERROR` no plano
  // (`src/core/import/issues.ts`) e como `DomainError` na aplicação.
  'IMPORT_PARSE_ERROR',
  'IMPORT_PROFILE_INVALID',
  'IMPORT_PROFILE_DUPLICATE',
  'IMPORT_UNMAPPED_VALUE',
  'IMPORT_DUPLICATE_KEY',
  'IMPORT_STRUCTURE_DIVERGED',
  'IMPORT_PLAN_STALE',
  'IMPORT_NOTHING_TO_APPLY',
  'IMPORT_TARGET_HAS_DRAFT',
  'IMPORT_TARGET_ARCHIVED',
  'IMPORT_STRUCTURE_RESOLUTION_INVALID',
  'TAG_NOT_FOUND',
  // Identidade e papéis — docs/14-plataforma-local.md §6, S29.
  'ROLE_REQUIRED',
  'ACL_REQUIRES_ADMIN',
  // Evidências — docs/14-plataforma-local.md §7, S30.
  'EVIDENCE_NOT_FOUND',
  'EVIDENCE_DUPLICATE_PATH',
  // Governança de alterações — docs/14-governanca-de-alteracoes.md §6. O
  // catálogo `E-GOV-01..06` entra inteiro na S32a (docs/05 §9 traz a
  // correspondência); só os dois de componente/carga têm emissor aqui, os de
  // workflow ficam sem até a S32b ligar os comandos de DB e release.
  'CR_TRANSITION_INVALID', // E-GOV-01
  'CR_BASE_VERSION_STALE', // E-GOV-02
  'CR_INCOMPLETE', // E-GOV-03
  'RELEASE_PUBLISH_BLOCKED', // E-GOV-04
  'ATTACHMENT_TOO_LARGE', // E-GOV-05
  'COMPONENT_CODE_DUPLICATE', // E-GOV-06
  // Árvore de componentes (S32a): ciclo, profundidade, contenção e espelho.
  // Não é um E-GOV — é a recusa em tempo de comando do que I27/I28 garantem
  // no documento em repouso.
  'COMPONENT_TREE_INVALID',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/**
 * Erro de regra de negócio. `src/core/` só lança `DomainError` — nunca
 * `Error` genérico — para que a camada de apresentação sempre tenha um
 * `code` estável e possa traduzir a mensagem (`error-messages.ts`).
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: unknown;

  constructor(code: DomainErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, DomainError.prototype);
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
