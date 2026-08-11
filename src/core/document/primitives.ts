import { z } from 'zod';

/**
 * Primitivos de schema (regex + `ZodType`) usados tanto por
 * `document/schema.ts` quanto por `import/profile.ts` (`ImportProfile`
 * referencia `variableId`/`code` com as mesmas regras). Vive num módulo à
 * parte porque `schema.ts` importa `ImportProfileSchema` de `import/profile.ts`
 * (docs/03 §7.1) — se os primitivos continuassem em `schema.ts`, essa
 * importação fecharia um ciclo em tempo de execução (`profile.ts` também
 * precisa destes primitivos). Reexportado por `schema.ts` para que todo o
 * resto do código continue importando de `@/core/document/schema` sem saber
 * que este módulo existe.
 */

// Mensagens de erro do Zod em pt-BR para o que não for coberto por
// `.regex(..., mensagem)` explícito (ex.: tipo errado, enum inválido).
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') {
        return { message: 'Campo obrigatório ausente.' };
      }
      return { message: `Tipo inválido: esperado ${issue.expected}, recebido ${issue.received}.` };
    case z.ZodIssueCode.invalid_enum_value:
      return {
        message: `Valor inválido: "${String(ctx.data)}" não está entre as opções permitidas (${issue.options.join(', ')}).`,
      };
    case z.ZodIssueCode.invalid_literal:
      return { message: `Valor inválido: esperado ${JSON.stringify(issue.expected)}.` };
    case z.ZodIssueCode.too_small:
      return { message: `Valor muito pequeno (mínimo: ${issue.minimum}).` };
    case z.ZodIssueCode.too_big:
      return { message: `Valor muito grande (máximo: ${issue.maximum}).` };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `Campos não reconhecidos neste escopo: ${issue.keys.join(', ')}.` };
    default:
      return { message: ctx.defaultError };
  }
});

/** `code` casa `^[A-Z0-9_]+$` — nunca contém `|` nem `:`, separadores de caminho (docs/04-eixos-aninhados.md §2). */
export const CODE_REGEX = /^[A-Z0-9_]+$/;
/** Toda data é ISO 8601 em UTC, no formato produzido por `Date.prototype.toISOString()`. */
export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Todo decimal é string, nunca `number`. */
export const DECIMAL_REGEX = /^-?\d+(\.\d+)?$/;
/** Subconjunto de `DECIMAL_REGEX` sem parte fracionária — usado por `boundaryMode: 'INCLUSIVE_INTEGER'` (docs/03 §2). */
export const INTEGER_REGEX = /^-?\d+$/;
export const COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
/** Todo id é `nanoid(12)`: alfabeto padrão do nanoid, comprimento 12. */
export const NANOID_REGEX = /^[A-Za-z0-9_-]{12}$/;

export const idSchema = z.string().regex(NANOID_REGEX, 'id inválido: esperado nanoid(12).');
export const codeSchema = z
  .string()
  .regex(CODE_REGEX, 'code deve casar ^[A-Z0-9_]+$ — sem "|" nem ":", que são separadores de caminho.');
export const isoDateSchema = z.string().regex(ISO_DATE_REGEX, 'data deve ser ISO 8601 UTC.');
export const decimalSchema = z.string().regex(DECIMAL_REGEX, 'decimal deve ser uma string numérica.');
export const colorSchema = z.string().regex(COLOR_REGEX, 'cor deve casar #RRGGBB.');
