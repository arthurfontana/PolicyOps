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
  'INVALID_DOMAIN_SET',
  'RANGE_NOT_CONTIGUOUS',
  'BOOLEAN_NEEDS_TWO_DOMAINS',
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
  'RANGE_REGIONAL_INCOMPLETE',
  'RANGE_REGIONAL_NOT_CONTIGUOUS',
  'REGIONAL_CODE_DUPLICATE',
  'REGIONAL_IMPORT_PARSE_ERROR',
  'DOMAIN_TABLE_PARSE_ERROR',
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
