import Decimal from 'decimal.js-light';
import type { Domain, GroupingRange } from './schema';

/**
 * Utilitários de `path` de agrupamento — docs/03-modelo-do-documento.md §2.
 *
 * Ficam no nível do documento (e não em `src/core/library/`) porque tanto a
 * validação estrutural (`document/validate.ts`, I9/I19) quanto a validação de
 * edição (`library/validate-domains.ts`) precisam ler `groupingRanges` do
 * mesmo jeito, e o documento é a camada comum às duas.
 */

/** Chave de agrupamento de um `path` — `code` nunca contém `|` (`^[A-Z0-9_]+$`). */
export function groupingPathKey(path: string[]): string {
  return path.join('|');
}

/** "SAO_PAULO › MEI" a partir dos códigos, para mensagens e cabeçalhos de grupo. */
export function formatGroupingPath(path: string[]): string {
  return path.join(' › ');
}

/** A faixa de um domínio num caminho específico, ou `undefined` se ele não tem entrada ali. */
export function groupingRangeAt(domain: Domain, key: string): GroupingRange | undefined {
  return domain.groupingRanges?.find((range) => groupingPathKey(range.path) === key);
}

export type ContiguityDirection = 'ASCENDING' | 'DESCENDING';

function toDecimalOrUndefined(value: string | undefined): Decimal | undefined {
  if (value === undefined) return undefined;
  try {
    return new Decimal(value);
  } catch {
    return undefined;
  }
}

/**
 * Direção da sequência de faixas por `position` (I9, docs/03 §9): o mínimo
 * pode crescer a cada domínio seguinte (o caso de sempre) ou decrescer —
 * cortes de score costumam vir do negócio na ordem "melhor faixa primeiro"
 * (R01 com a faixa mais alta, R20 com a mais baixa). Detectada pelo primeiro
 * par de mínimos válidos e distintos, por `position`; `ASCENDING` é o padrão
 * quando não há como decidir (uma faixa só, ou nenhum par com mínimos
 * numéricos distintos) — mesmo comportamento de sempre.
 */
export function detectContiguityDirection(domains: Array<{ min: string | undefined }>): ContiguityDirection {
  for (let i = 0; i < domains.length - 1; i++) {
    const a = toDecimalOrUndefined(domains[i]!.min);
    const b = toDecimalOrUndefined(domains[i + 1]!.min);
    if (a === undefined || b === undefined || a.eq(b)) continue;
    return a.lt(b) ? 'ASCENDING' : 'DESCENDING';
  }
  return 'ASCENDING';
}

/**
 * Todos os `path` distintos presentes nos dados, na ordem de aparição — a
 * validação é sempre sobre o que o usuário definiu, nunca sobre o produto
 * cartesiano das opções (I19, nota após a tabela em docs/03 §9).
 */
export function distinctGroupingPaths(domains: Domain[]): string[][] {
  const seen = new Map<string, string[]>();
  for (const domain of domains) {
    for (const range of domain.groupingRanges ?? []) {
      const key = groupingPathKey(range.path);
      if (!seen.has(key)) seen.set(key, [...range.path]);
    }
  }
  return [...seen.values()];
}
