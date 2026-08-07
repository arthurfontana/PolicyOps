import Decimal from 'decimal.js-light';
import { CODE_REGEX, DECIMAL_REGEX } from '../document/schema';
import type { Domain, RegionalDimension, VariableType } from '../document/schema';

/**
 * Validação de domínios — docs/05-regras-de-negocio.md §5.1 (I8, I9, I18) e
 * §5.6.1 (I9 regional, I19).
 *
 * Função **pura**, sem `DomainError`: é usada tanto pelo comando
 * `variable/saveDomains` (que embrulha o primeiro problema numa
 * `DomainError`) quanto pela interface, em tempo real, a cada tecla — e ali
 * uma exceção seria o jeito errado de pedir a lista de problemas.
 */

export type DomainValidationErrorCode =
  | 'INVALID_DOMAIN_SET'
  | 'RANGE_NOT_CONTIGUOUS'
  | 'BOOLEAN_NEEDS_TWO_DOMAINS'
  | 'REGIONAL_CODE_DUPLICATE'
  | 'RANGE_REGIONAL_INCOMPLETE'
  | 'RANGE_REGIONAL_NOT_CONTIGUOUS';

export type DomainValidationIssue = {
  code: DomainValidationErrorCode;
  /** Frase pronta em pt-BR. */
  message: string;
  /** Códigos de domínio envolvidos, quando aplicável (ex.: o par não contíguo). */
  domainCodes?: string[];
  /** Código do regional envolvido — só nos problemas de `regionalDimension`. */
  regionCode?: string;
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

/**
 * `rangeMin`/`rangeMax` (ou o par equivalente de um `RegionalRange`) chegam de
 * campos de texto sendo digitados: podem estar ausentes, vazios ou num
 * formato ainda incompleto ('', '-', '12.'). `Decimal` lança nesses casos, e
 * como esta função roda a cada tecla na interface (real-time), nunca pode
 * lançar — só reportar o problema.
 */
function isValidDecimal(value: string | undefined): value is string {
  return value !== undefined && DECIMAL_REGEX.test(value);
}

/** I9 (identidade): no máximo um `isCatchAll`, e ele é o último por `position`. Não depende de regional. */
function checkCatchAllIdentity(
  domains: Domain[],
  code: 'RANGE_NOT_CONTIGUOUS' | 'RANGE_REGIONAL_NOT_CONTIGUOUS',
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  const sorted = [...domains].sort((a, b) => a.position - b.position);
  const catchAlls = sorted.filter((domain) => domain.isCatchAll === true);

  if (catchAlls.length > 1) {
    issues.push({
      code,
      message: `Há ${catchAlls.length} domínios marcados como "demais casos" — no máximo um é permitido.`,
      domainCodes: catchAlls.map((domain) => domain.code),
    });
  }
  if (catchAlls.length === 1 && sorted[sorted.length - 1] !== catchAlls[0]) {
    issues.push({
      code,
      message: `O domínio "${catchAlls[0]!.code}", marcado como "demais casos", precisa ser o último da faixa.`,
      domainCodes: [catchAlls[0]!.code],
    });
  }

  return issues;
}

type RangeAccessor = {
  min: (domain: Domain) => string | undefined;
  max: (domain: Domain) => string | undefined;
};

/** I9 (valores): mínimo/máximo definidos, decimais válidos, e contíguos entre faixas vizinhas. */
function checkValueContiguity(
  domains: Domain[],
  accessor: RangeAccessor,
  code: 'RANGE_NOT_CONTIGUOUS' | 'RANGE_REGIONAL_NOT_CONTIGUOUS',
  regionCode?: string,
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  const sorted = [...domains].sort((a, b) => a.position - b.position);
  const regionTag = regionCode === undefined ? {} : { regionCode };
  const regionSuffix = regionCode === undefined ? '' : ` no regional "${regionCode}"`;

  for (const domain of sorted) {
    if (domain.isCatchAll === true) continue;
    const min = accessor.min(domain);
    const max = accessor.max(domain);
    if (min === undefined || max === undefined) {
      issues.push({
        code,
        message: `O domínio "${domain.code}" precisa de mínimo e máximo definidos${regionSuffix} — só o "demais casos" pode ficar sem.`,
        domainCodes: [domain.code],
        ...regionTag,
      });
    } else if (!isValidDecimal(min) || !isValidDecimal(max)) {
      issues.push({
        code,
        message: `O domínio "${domain.code}" tem mínimo ou máximo que não é um número decimal válido${regionSuffix}.`,
        domainCodes: [domain.code],
        ...regionTag,
      });
    }
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;
    if (current.isCatchAll === true) continue;
    const currentMax = accessor.max(current);
    const nextMin = accessor.min(next);
    if (!isValidDecimal(currentMax) || !isValidDecimal(nextMin)) continue;
    if (!new Decimal(currentMax).eq(new Decimal(nextMin))) {
      issues.push({
        code,
        message: `As faixas "${current.code}" e "${next.code}" não são contíguas${regionSuffix}: o máximo de "${current.code}" (${currentMax}) precisa ser igual ao mínimo de "${next.code}" (${nextMin}).`,
        domainCodes: [current.code, next.code],
        ...regionTag,
      });
    }
  }

  return issues;
}

/** I9: só para RANGE sem `regionalDimension` — faixas contíguas, não sobrepostas, catch-all único e por último. */
function checkRangeContiguity(domains: Domain[]): DomainValidationIssue[] {
  return [
    ...checkCatchAllIdentity(domains, 'RANGE_NOT_CONTIGUOUS'),
    ...checkValueContiguity(domains, { min: (d) => d.rangeMin, max: (d) => d.rangeMax }, 'RANGE_NOT_CONTIGUOUS'),
  ];
}

/** I19: `regions` não vazio, `code` único. */
function checkRegionalDimension(regionalDimension: RegionalDimension): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  if (regionalDimension.regions.length === 0) {
    issues.push({
      code: 'INVALID_DOMAIN_SET',
      message: 'A dimensão regional precisa ter ao menos um regional.',
    });
  }

  const counts = new Map<string, number>();
  for (const region of regionalDimension.regions) {
    counts.set(region.code, (counts.get(region.code) ?? 0) + 1);
  }
  for (const [code, count] of counts) {
    if (count > 1) {
      issues.push({
        code: 'REGIONAL_CODE_DUPLICATE',
        message: `O código de regional "${code}" aparece ${count} vezes — cada regional precisa de um código único nesta versão.`,
        regionCode: code,
      });
    }
  }

  return issues;
}

/** I19: todo domínio RANGE tem entrada em `regionalRanges` para todo `region.code`. */
function checkRegionalCompleteness(
  domains: Domain[],
  regionalDimension: RegionalDimension,
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  for (const domain of domains) {
    for (const region of regionalDimension.regions) {
      if (domain.regionalRanges?.[region.code] === undefined) {
        issues.push({
          code: 'RANGE_REGIONAL_INCOMPLETE',
          message: `O domínio "${domain.code}" não tem faixa definida para o regional "${region.code}".`,
          domainCodes: [domain.code],
          regionCode: region.code,
        });
      }
    }
  }
  return issues;
}

/** I9 regional: contiguidade/sobreposição/catch-all validadas por regional, independentemente. */
function checkRegionalContiguity(
  domains: Domain[],
  regionalDimension: RegionalDimension,
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [...checkCatchAllIdentity(domains, 'RANGE_REGIONAL_NOT_CONTIGUOUS')];

  for (const region of regionalDimension.regions) {
    // Domínios sem entrada para este regional já foram reportados por
    // `checkRegionalCompleteness` — excluí-los aqui evita duplicar o aviso e
    // evita que um "buraco" fantasma apareça na contiguidade.
    const present = domains.filter((domain) => domain.regionalRanges?.[region.code] !== undefined);
    issues.push(
      ...checkValueContiguity(
        present,
        {
          min: (d) => d.regionalRanges?.[region.code]?.min,
          max: (d) => d.regionalRanges?.[region.code]?.max,
        },
        'RANGE_REGIONAL_NOT_CONTIGUOUS',
        region.code,
      ),
    );
  }

  return issues;
}

export function validateDomains(
  type: VariableType,
  domains: Domain[],
  regionalDimension?: RegionalDimension,
): DomainValidationResult {
  const issues: DomainValidationIssue[] = [
    ...checkCount(type, domains),
    ...checkCodes(domains),
    ...checkPositions(domains),
  ];

  if (type === 'RANGE') {
    if (regionalDimension === undefined) {
      issues.push(...checkRangeContiguity(domains));
    } else {
      issues.push(
        ...checkRegionalDimension(regionalDimension),
        ...checkRegionalCompleteness(domains, regionalDimension),
        ...checkRegionalContiguity(domains, regionalDimension),
      );
    }
  }

  if (issues.length === 0) return { ok: true };
  return { ok: false, issues };
}
