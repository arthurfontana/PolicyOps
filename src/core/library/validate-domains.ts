import Decimal from 'decimal.js-light';
import { CODE_REGEX, DECIMAL_REGEX, INTEGER_REGEX } from '../document/schema';
import type { BoundaryMode, Domain, GroupingDimension, VariableType } from '../document/schema';
import {
  distinctGroupingPaths,
  formatGroupingPath,
  groupingPathKey,
  groupingRangeAt,
} from '../document/grouping';

/**
 * Validação de domínios — docs/05-regras-de-negocio.md §5.1 (I8, I9, I18) e
 * §5.6.1 (I9 por caminho de agrupamento, I19).
 *
 * Função **pura**, sem `DomainError`: é usada tanto pelo comando
 * `variable/saveDomains` (que embrulha o primeiro problema numa
 * `DomainError`) quanto pela interface, em tempo real, a cada tecla — e ali
 * uma exceção seria o jeito errado de pedir a lista de problemas.
 */

/** Teto de níveis de agrupamento (I19) — independente do teto de 3 de `AxisLevel` (I13). */
export const MAX_GROUPING_LEVELS = 4;

export type DomainValidationErrorCode =
  | 'INVALID_DOMAIN_SET'
  | 'RANGE_NOT_CONTIGUOUS'
  | 'BOOLEAN_NEEDS_TWO_DOMAINS'
  | 'TOO_MANY_GROUPING_LEVELS'
  | 'GROUPING_DIMENSION_CODE_DUPLICATE'
  | 'GROUPING_OPTION_CODE_DUPLICATE'
  | 'GROUPING_PATH_INVALID'
  | 'RANGE_GROUPING_NOT_CONTIGUOUS';

export type DomainValidationIssue = {
  code: DomainValidationErrorCode;
  /** Frase pronta em pt-BR. */
  message: string;
  /** Códigos de domínio envolvidos, quando aplicável (ex.: o par não contíguo). */
  domainCodes?: string[];
  /** Caminho de agrupamento envolvido — só nos problemas de `groupingDimensions`. */
  path?: string[];
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
 * `rangeMin`/`rangeMax` (ou o par equivalente de um `GroupingRange`) chegam de
 * campos de texto sendo digitados: podem estar ausentes, vazios ou num
 * formato ainda incompleto ('', '-', '12.'). `Decimal` lança nesses casos, e
 * como esta função roda a cada tecla na interface (real-time), nunca pode
 * lançar — só reportar o problema.
 */
function isValidDecimal(value: string | undefined): value is string {
  return value !== undefined && DECIMAL_REGEX.test(value);
}

/** `INCLUSIVE_INTEGER` (docs/03 §2) exige inteiro — sem parte decimal. */
function isValidInteger(value: string | undefined): value is string {
  return value !== undefined && INTEGER_REGEX.test(value);
}

/** I9 (identidade): no máximo um `isCatchAll`, e ele é o último por `position`. Não depende de agrupamento. */
function checkCatchAllIdentity(
  domains: Domain[],
  code: 'RANGE_NOT_CONTIGUOUS' | 'RANGE_GROUPING_NOT_CONTIGUOUS',
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

/** I9 (valores): mínimo/máximo definidos, válidos para o `boundaryMode`, e contíguos entre faixas vizinhas. */
function checkValueContiguity(
  domains: Domain[],
  accessor: RangeAccessor,
  code: 'RANGE_NOT_CONTIGUOUS' | 'RANGE_GROUPING_NOT_CONTIGUOUS',
  boundaryMode: BoundaryMode,
  path?: string[],
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  const sorted = [...domains].sort((a, b) => a.position - b.position);
  const pathTag = path === undefined ? {} : { path };
  const pathSuffix = path === undefined ? '' : ` em "${formatGroupingPath(path)}"`;
  const isInclusiveInteger = boundaryMode === 'INCLUSIVE_INTEGER';
  const isValid = isInclusiveInteger ? isValidInteger : isValidDecimal;

  for (const domain of sorted) {
    if (domain.isCatchAll === true) continue;
    const min = accessor.min(domain);
    const max = accessor.max(domain);
    if (min === undefined || max === undefined) {
      issues.push({
        code,
        message: `O domínio "${domain.code}" precisa de mínimo e máximo definidos${pathSuffix} — só o "demais casos" pode ficar sem.`,
        domainCodes: [domain.code],
        ...pathTag,
      });
    } else if (!isValid(min) || !isValid(max)) {
      issues.push({
        code,
        message: isInclusiveInteger
          ? `O domínio "${domain.code}" tem mínimo ou máximo que não é um número inteiro válido${pathSuffix} — o modo de limites inclusivos exige inteiros.`
          : `O domínio "${domain.code}" tem mínimo ou máximo que não é um número decimal válido${pathSuffix}.`,
        domainCodes: [domain.code],
        ...pathTag,
      });
    }
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;
    if (current.isCatchAll === true) continue;
    const currentMax = accessor.max(current);
    const nextMin = accessor.min(next);
    if (!isValid(currentMax) || !isValid(nextMin)) continue;
    const expectedNextMin = isInclusiveInteger
      ? new Decimal(currentMax).plus(1)
      : new Decimal(currentMax);
    if (!expectedNextMin.eq(new Decimal(nextMin))) {
      issues.push({
        code,
        message: isInclusiveInteger
          ? `As faixas "${current.code}" e "${next.code}" não são contíguas${pathSuffix}: no modo de limites inclusivos, o máximo de "${current.code}" (${currentMax}) + 1 precisa ser igual ao mínimo de "${next.code}" (${nextMin}).`
          : `As faixas "${current.code}" e "${next.code}" não são contíguas${pathSuffix}: o máximo de "${current.code}" (${currentMax}) precisa ser igual ao mínimo de "${next.code}" (${nextMin}).`,
        domainCodes: [current.code, next.code],
        ...pathTag,
      });
    }
  }

  return issues;
}

/** I9: só para RANGE sem `groupingDimensions` — faixas contíguas, não sobrepostas, catch-all único e por último. */
function checkRangeContiguity(domains: Domain[], boundaryMode: BoundaryMode): DomainValidationIssue[] {
  return [
    ...checkCatchAllIdentity(domains, 'RANGE_NOT_CONTIGUOUS'),
    ...checkValueContiguity(
      domains,
      { min: (d) => d.rangeMin, max: (d) => d.rangeMax },
      'RANGE_NOT_CONTIGUOUS',
      boundaryMode,
    ),
  ];
}

/** I19 (estrutura dos níveis): 1 a 4 níveis, `code` de nível único, `options` não vazio com `code` único dentro do nível. */
function checkGroupingStructure(groupingDimensions: GroupingDimension[]): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];

  if (groupingDimensions.length === 0) {
    issues.push({
      code: 'INVALID_DOMAIN_SET',
      message: 'Os agrupamentos desta variável precisam ter ao menos um nível — remova o agrupamento se ele não é usado.',
    });
  }
  if (groupingDimensions.length > MAX_GROUPING_LEVELS) {
    issues.push({
      code: 'TOO_MANY_GROUPING_LEVELS',
      message: `Uma variável pode ter no máximo ${MAX_GROUPING_LEVELS} níveis de agrupamento (tem ${groupingDimensions.length}).`,
    });
  }

  const levelCounts = new Map<string, number>();
  for (const dimension of groupingDimensions) {
    levelCounts.set(dimension.code, (levelCounts.get(dimension.code) ?? 0) + 1);
  }
  for (const [code, count] of levelCounts) {
    if (count > 1) {
      issues.push({
        code: 'GROUPING_DIMENSION_CODE_DUPLICATE',
        message: `O código de agrupamento "${code}" aparece ${count} vezes — cada nível precisa de um código único nesta versão.`,
      });
    }
  }

  for (const dimension of groupingDimensions) {
    if (dimension.options.length === 0) {
      issues.push({
        code: 'INVALID_DOMAIN_SET',
        message: `O agrupamento "${dimension.code}" precisa ter ao menos uma opção.`,
      });
    }
    const optionCounts = new Map<string, number>();
    for (const option of dimension.options) {
      optionCounts.set(option.code, (optionCounts.get(option.code) ?? 0) + 1);
    }
    for (const [code, count] of optionCounts) {
      if (count > 1) {
        issues.push({
          code: 'GROUPING_OPTION_CODE_DUPLICATE',
          message: `A opção "${code}" aparece ${count} vezes no agrupamento "${dimension.code}" — cada opção precisa de um código único dentro do próprio nível.`,
        });
      }
    }
  }

  return issues;
}

/** I19 (caminhos): todo `path` tem o comprimento de `groupingDimensions` e aponta para opções existentes. */
function checkGroupingPaths(
  domains: Domain[],
  groupingDimensions: GroupingDimension[],
): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [];
  const optionsByLevel = groupingDimensions.map(
    (dimension) => new Set(dimension.options.map((option) => option.code)),
  );

  for (const domain of domains) {
    const seenPaths = new Set<string>();
    for (const range of domain.groupingRanges ?? []) {
      if (range.path.length !== groupingDimensions.length) {
        issues.push({
          code: 'GROUPING_PATH_INVALID',
          message: `O domínio "${domain.code}" tem uma faixa com ${range.path.length} nível(is) de agrupamento, mas esta versão tem ${groupingDimensions.length}.`,
          domainCodes: [domain.code],
          path: range.path,
        });
        continue;
      }

      const unknownLevel = range.path.findIndex((code, level) => !optionsByLevel[level]!.has(code));
      if (unknownLevel >= 0) {
        issues.push({
          code: 'GROUPING_PATH_INVALID',
          message: `O domínio "${domain.code}" tem uma faixa em "${range.path[unknownLevel]}", que não é uma opção do agrupamento "${groupingDimensions[unknownLevel]!.code}".`,
          domainCodes: [domain.code],
          path: range.path,
        });
        continue;
      }

      const key = groupingPathKey(range.path);
      if (seenPaths.has(key)) {
        issues.push({
          code: 'INVALID_DOMAIN_SET',
          message: `O domínio "${domain.code}" tem duas faixas para a mesma combinação "${formatGroupingPath(range.path)}".`,
          domainCodes: [domain.code],
          path: range.path,
        });
      }
      seenPaths.add(key);
    }
  }

  return issues;
}

/**
 * I9 com agrupamento: a mesma regra de contiguidade/sobreposição/catch-all
 * vale **independentemente para cada `path` distinto** presente nos dados. Um
 * domínio ausente de um caminho simplesmente não participa daquele grupo —
 * não é erro (ver `findIncompleteGroupingPaths`, que só avisa).
 */
function checkGroupingContiguity(domains: Domain[], boundaryMode: BoundaryMode): DomainValidationIssue[] {
  const issues: DomainValidationIssue[] = [
    ...checkCatchAllIdentity(domains, 'RANGE_GROUPING_NOT_CONTIGUOUS'),
  ];

  for (const path of distinctGroupingPaths(domains)) {
    const key = groupingPathKey(path);
    const present = domains.filter((domain) => groupingRangeAt(domain, key) !== undefined);
    issues.push(
      ...checkValueContiguity(
        present,
        {
          min: (d) => groupingRangeAt(d, key)?.min,
          max: (d) => groupingRangeAt(d, key)?.max,
        },
        'RANGE_GROUPING_NOT_CONTIGUOUS',
        boundaryMode,
        path,
      ),
    );
  }

  return issues;
}

export type IncompleteGroupingPath = {
  path: string[];
  missingDomainCodes: string[];
};

/**
 * Consulta pura de **aviso**, nunca invariante — docs/03 §9 (nota após I19) e
 * docs/07 §11: para cada `path` presente, os domínios que têm faixa em algum
 * outro caminho mas não neste. É o caso provável de "esqueci de colar uma
 * linha"; hierarquias assimétricas legítimas também caem aqui, e por isso o
 * resultado nunca bloqueia `saveDomains` — só alimenta o banner do editor.
 *
 * Caminhos completos são omitidos do resultado: a lista é o que há para
 * avisar, não um relatório de cobertura.
 */
export function findIncompleteGroupingPaths(
  domains: Domain[],
  groupingDimensions: GroupingDimension[],
): IncompleteGroupingPath[] {
  const withRanges = domains.filter((domain) => (domain.groupingRanges ?? []).length > 0);
  if (withRanges.length === 0) return [];

  const paths = distinctGroupingPaths(withRanges);
  // Ordem de leitura da hierarquia: a ordem das opções em cada nível, não a
  // ordem de aparição nos dados — é assim que o editor lista os grupos.
  const rankByLevel = groupingDimensions.map(
    (dimension) => new Map(dimension.options.map((option, index) => [option.code, index])),
  );
  const rankOf = (path: string[], level: number) =>
    rankByLevel[level]?.get(path[level] ?? '') ?? Number.MAX_SAFE_INTEGER;
  const sortedPaths = [...paths].sort((a, b) => {
    for (let level = 0; level < Math.max(a.length, b.length); level++) {
      const diff = rankOf(a, level) - rankOf(b, level);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  const incomplete: IncompleteGroupingPath[] = [];
  for (const path of sortedPaths) {
    const key = groupingPathKey(path);
    const missingDomainCodes = withRanges
      .filter((domain) => groupingRangeAt(domain, key) === undefined)
      .map((domain) => domain.code);
    if (missingDomainCodes.length > 0) incomplete.push({ path, missingDomainCodes });
  }
  return incomplete;
}

export function validateDomains(
  type: VariableType,
  domains: Domain[],
  groupingDimensions?: GroupingDimension[],
  boundaryMode: BoundaryMode = 'HALF_OPEN',
): DomainValidationResult {
  const issues: DomainValidationIssue[] = [
    ...checkCount(type, domains),
    ...checkCodes(domains),
    ...checkPositions(domains),
  ];

  if (type === 'RANGE') {
    if (groupingDimensions === undefined) {
      issues.push(...checkRangeContiguity(domains, boundaryMode));
    } else {
      issues.push(
        ...checkGroupingStructure(groupingDimensions),
        ...checkGroupingPaths(domains, groupingDimensions),
        ...checkGroupingContiguity(domains, boundaryMode),
      );
    }
  }

  if (issues.length === 0) return { ok: true };
  return { ok: false, issues };
}
