import Decimal from 'decimal.js-light';
import { CODE_REGEX, DECIMAL_REGEX } from '../document/schema';
import type { Domain, VariableType } from '../document/schema';

/**
 * Validação de domínios — docs/05-regras-de-negocio.md §5.1 (I8, I9, I18).
 *
 * Função **pura**, sem `DomainError`: é usada tanto pelo comando
 * `variable/saveDomains` (que embrulha o primeiro problema numa
 * `DomainError`) quanto pela interface, em tempo real, a cada tecla — e ali
 * uma exceção seria o jeito errado de pedir a lista de problemas.
 */

export type DomainValidationErrorCode =
  | 'INVALID_DOMAIN_SET'
  | 'RANGE_NOT_CONTIGUOUS'
  | 'BOOLEAN_NEEDS_TWO_DOMAINS';

export type DomainValidationIssue = {
  code: DomainValidationErrorCode;
  /** Frase pronta em pt-BR. */
  message: string;
  /** Códigos de domínio envolvidos, quando aplicável (ex.: o par não contíguo). */
  domainCodes?: string[];
};

export type DomainValidationResult =
  | { ok: true }
  | { ok: false; issues: DomainValidationIssue[] };

function checkCount(type: VariableType, domains: Domain[]): DomainValidationIssue[] {
  if (type === 'BOOLEAN') {
    if (domains.length !== 2) {
      return [
        {
          code: 'BOOLEAN_NEEDS_TWO_DOMAINS',
          message: `Uma variável booleana precisa ter exatamente 2 domínios (tem ${domains.length}).`,
        },
      ];
    }
    return [];
  }
  if (domains.length < 2) {
    return [
      {
        code: 'INVALID_DOMAIN_SET',
        message: `São necessários pelo menos 2 domínios (tem ${domains.length}).`,
      },
    ];
  }
  return [];
}

function checkCodes(domains: Domain[]): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  const counts = new Map<string, number>();

  for (const domain of domains) {
    if (!CODE_REGEX.test(domain.code)) {
      issues.push({
        code: 'INVALID_DOMAIN_SET',
        message: `O código "${domain.code}" é inválido: precisa casar ^[A-Z0-9_]+$ — sem "|" nem ":".`,
        domainCodes: [domain.code],
      });
    }
    counts.set(domain.code, (counts.get(domain.code) ?? 0) + 1);
  }

  for (const [code, count] of counts) {
    if (count > 1) {
      issues.push({
        code: 'INVALID_DOMAIN_SET',
        message: `O código "${code}" aparece ${count} vezes — cada domínio precisa de um código único nesta versão.`,
        domainCodes: [code],
      });
    }
  }

  return issues;
}

function checkPositions(domains: Domain[]): DomainValidationIssue[] {
  const sorted = [...domains].sort((a, b) => a.position - b.position);
  const hasGapOrDuplicate = sorted.some((domain, index) => domain.position !== index);
  if (!hasGapOrDuplicate) return [];
  return [
    {
      code: 'INVALID_DOMAIN_SET',
      message: 'As posições dos domínios precisam ser 0, 1, 2… em sequência, sem buracos nem repetição.',
    },
  ];
}

/** I9: só para RANGE — faixas contíguas, não sobrepostas, catch-all único e por último. */
function checkRangeContiguity(domains: Domain[]): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  const sorted = [...domains].sort((a, b) => a.position - b.position);

  const catchAlls = sorted.filter((domain) => domain.isCatchAll === true);
  if (catchAlls.length > 1) {
    issues.push({
      code: 'RANGE_NOT_CONTIGUOUS',
      message: `Há ${catchAlls.length} domínios marcados como "demais casos" — no máximo um é permitido.`,
      domainCodes: catchAlls.map((domain) => domain.code),
    });
  }
  if (catchAlls.length === 1 && sorted[sorted.length - 1] !== catchAlls[0]) {
    issues.push({
      code: 'RANGE_NOT_CONTIGUOUS',
      message: `O domínio "${catchAlls[0]!.code}", marcado como "demais casos", precisa ser o último da faixa.`,
      domainCodes: [catchAlls[0]!.code],
    });
  }

  // `rangeMin`/`rangeMax` chegam de campos de texto sendo digitados: podem
  // estar ausentes, vazios ou num formato ainda incompleto ('', '-', '12.').
  // `Decimal` lança nesses casos, e como esta função roda a cada tecla na
  // interface (real-time), nunca pode lançar — só reportar o problema.
  function isValidDecimal(value: string | undefined): value is string {
    return value !== undefined && DECIMAL_REGEX.test(value);
  }

  for (const domain of sorted) {
    if (domain.isCatchAll === true) continue;
    if (domain.rangeMin === undefined || domain.rangeMax === undefined) {
      issues.push({
        code: 'RANGE_NOT_CONTIGUOUS',
        message: `O domínio "${domain.code}" precisa de mínimo e máximo definidos — só o "demais casos" pode ficar sem.`,
        domainCodes: [domain.code],
      });
    } else if (!isValidDecimal(domain.rangeMin) || !isValidDecimal(domain.rangeMax)) {
      issues.push({
        code: 'RANGE_NOT_CONTIGUOUS',
        message: `O domínio "${domain.code}" tem mínimo ou máximo que não é um número decimal válido.`,
        domainCodes: [domain.code],
      });
    }
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;
    if (current.isCatchAll === true) continue;
    if (!isValidDecimal(current.rangeMax) || !isValidDecimal(next.rangeMin)) continue;
    if (!new Decimal(current.rangeMax).eq(new Decimal(next.rangeMin))) {
      issues.push({
        code: 'RANGE_NOT_CONTIGUOUS',
        message: `As faixas "${current.code}" e "${next.code}" não são contíguas: o máximo de "${current.code}" (${current.rangeMax}) precisa ser igual ao mínimo de "${next.code}" (${next.rangeMin}).`,
        domainCodes: [current.code, next.code],
      });
    }
  }

  return issues;
}

export function validateDomains(type: VariableType, domains: Domain[]): DomainValidationResult {
  const issues: DomainValidationIssue[] = [
    ...checkCount(type, domains),
    ...checkCodes(domains),
    ...checkPositions(domains),
    ...(type === 'RANGE' ? checkRangeContiguity(domains) : []),
  ];
  if (issues.length === 0) return { ok: true };
  return { ok: false, issues };
}
