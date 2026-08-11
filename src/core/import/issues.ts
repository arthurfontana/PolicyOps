import type { DomainErrorCode } from '../errors';

/**
 * Vocabulário de problemas da carga — docs/12-carga-de-matrizes.md §5.4 e §5.8.
 *
 * Um `ImportIssue` é sempre **texto pronto para a tela** com a coordenada do
 * problema (linha 1-based do arquivo original e nome da coluna). A severidade
 * sai do código, e não da situação: um código de §5.8 sempre bloqueia, um
 * código de aviso nunca bloqueia. É o que permite ao plano decidir se pode
 * classificar as matrizes só olhando a lista de problemas.
 */

/**
 * Os códigos de §5.8 — todos bloqueiam. Vivem também em
 * `DomainErrorCode` (`src/core/errors.ts`), com mensagem pt-BR em
 * `error-messages.ts`, porque a aplicação da carga (S24) os lança como
 * `DomainError`.
 */
export const IMPORT_ERROR_CODES = [
  'IMPORT_PARSE_ERROR',
  'IMPORT_PROFILE_INVALID',
  'IMPORT_PROFILE_DUPLICATE',
  'IMPORT_UNMAPPED_VALUE',
  'IMPORT_DUPLICATE_KEY',
  'IMPORT_STRUCTURE_DIVERGED',
  'IMPORT_PLAN_STALE',
  'IMPORT_NOTHING_TO_APPLY',
  'IMPORT_TARGET_HAS_DRAFT',
] as const satisfies readonly DomainErrorCode[];

/**
 * Os avisos — descrevem o que a carga fez ou deixou de fazer sem impedir o
 * plano. Um aviso pode bloquear **uma** matriz (`IMPORT_GRID_TOO_LARGE`,
 * `IMPORT_NO_BASE_VERSION` acompanham um `MatrixPlan` em `BLOCKED`), nunca a
 * carga inteira — DEC-CARGA-009.
 */
export const IMPORT_WARNING_CODES = [
  'IMPORT_CHECK_MISMATCH',
  'IMPORT_ROW_IGNORED',
  'IMPORT_DUPLICATE_ROW',
  'IMPORT_MISSING_ROW',
  'IMPORT_TUPLES_SUPPRESSED',
  'IMPORT_GRID_TOO_LARGE',
  'IMPORT_NO_BASE_VERSION',
  'IMPORT_DELIMITER_NOT_DETECTED',
] as const;

export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];
export type ImportWarningCode = (typeof IMPORT_WARNING_CODES)[number];
export type ImportIssueCode = ImportErrorCode | ImportWarningCode;

export type ImportIssueSeverity = 'ERROR' | 'WARNING';

export type ImportIssue = {
  code: ImportIssueCode;
  severity: ImportIssueSeverity;
  /** pt-BR, pronta para a tela. */
  message: string;
  /** 1-based, do arquivo original. */
  line?: number;
  column?: string;
  details?: Record<string, unknown>;
};

const ERROR_CODES = new Set<string>(IMPORT_ERROR_CODES);

export function importIssueSeverity(code: ImportIssueCode): ImportIssueSeverity {
  return ERROR_CODES.has(code) ? 'ERROR' : 'WARNING';
}

/** Constrói um `ImportIssue` já com a severidade certa para o código. */
export function importIssue(
  code: ImportIssueCode,
  message: string,
  where: { line?: number; column?: string; details?: Record<string, unknown> } = {},
): ImportIssue {
  const issue: ImportIssue = { code, severity: importIssueSeverity(code), message };
  if (where.line !== undefined) issue.line = where.line;
  if (where.column !== undefined) issue.column = where.column;
  if (where.details !== undefined) issue.details = where.details;
  return issue;
}

/** Há problema que impede o plano de classificar matriz alguma? */
export function hasBlockingIssue(issues: readonly ImportIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'ERROR');
}
