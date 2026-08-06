import type { CompatibilityRule, CompatibilityVersion, Domain } from '../document/schema';
import { DomainError } from '../errors';
import { encodePath } from './paths';

/**
 * Geração de tuplas com compatibilidade — docs/04-eixos-aninhados.md §3.
 *
 * A ordem produzida aqui é a ordem visual do grid: nível 0 varrido por
 * `position`, dentro dele o nível 1 por `position`, e assim por diante.
 * É determinística e **nunca** deve ser reordenada depois.
 */

/** docs/04 §1: 1 a 3 níveis por eixo. */
export const MAX_AXIS_LEVELS = 3;
/** docs/04 §1: alerta em 1.500 combinações. */
export const LARGE_GRID_THRESHOLD = 1_500;
/** docs/04 §1 e I16: teto de 6.000 combinações por versão. */
export const MAX_COMBINATIONS = 6_000;

export type TupleWarningCode =
  | 'PARENT_HAS_NO_CHILDREN'
  | 'RULE_REFERENCES_UNKNOWN_DOMAIN'
  | 'NO_RULE_FOR_PAIR'
  | 'SUPPRESSION_NOT_APPLICABLE'
  | 'LARGE_GRID';

/** Aviso de §3.1: a geração continua, a interface mostra o aviso. */
export type TupleWarning = {
  code: TupleWarningCode;
  /** Frase pronta em pt-BR. */
  message: string;
  /** Nível em que o aviso ocorreu, quando aplicável. */
  levelIndex?: number;
  /** Caminho envolvido (pai que sumiu, supressão inaplicável). */
  path?: string;
  /** Códigos envolvidos (domínios citados pela regra e inexistentes). */
  codes?: string[];
  /** `CompatibilityRule.id` da regra envolvida. */
  ruleId?: string;
  /** Contagem envolvida (tamanho do grid). */
  count?: number;
};

/**
 * Uma regra de compatibilidade publicada, achatada com o par de variáveis a
 * que pertence.
 *
 * `CompatibilityVersion` sozinha não basta para escolher a regra de um par:
 * `parentVariableId`/`childVariableId` vivem em `CompatibilityRule`
 * (docs/03 §3), e a versão só guarda os *pins* de versão de variável. A
 * seleção é por **variável**, não por versão de variável — é o que permite um
 * eixo pinado em v2 continuar usando a regra escrita contra a v1 até o
 * resnapshot explícito (docs/05 §5).
 */
export type ApplicableCompatibility = {
  ruleId: string;
  ruleCode: string;
  parentVariableId: string;
  childVariableId: string;
  version: CompatibilityVersion;
};

/**
 * Extrai de uma biblioteca de compatibilidade as regras aplicáveis: uma regra
 * não arquivada com versão `PUBLISHED` (I12 garante no máximo uma por par).
 */
export function collectPublishedCompatibility(
  rules: CompatibilityRule[],
): ApplicableCompatibility[] {
  const applicable: ApplicableCompatibility[] = [];
  for (const rule of rules) {
    if (rule.archivedAt !== undefined) continue;
    const version = rule.versions.find((candidate) => candidate.state === 'PUBLISHED');
    if (version === undefined) continue;
    applicable.push({
      ruleId: rule.id,
      ruleCode: rule.code,
      parentVariableId: rule.parentVariableId,
      childVariableId: rule.childVariableId,
      version,
    });
  }
  return applicable;
}

/** O que a geração precisa de um nível: a variável e o snapshot de domínios. */
export type TupleLevelInput = { variableId: string; domains: Domain[] };

export type GenerateTuplesInput = {
  levels: TupleLevelInput[];
  /** Regras publicadas relevantes. */
  compatibility: ApplicableCompatibility[];
  manualSuppressions?: string[];
};

export type GenerateTuplesResult = {
  tuples: string[];
  /** `CompatibilityVersion.id` das regras usadas — alimenta `derivedFrom`. */
  usedRuleIds: string[];
  warnings: TupleWarning[];
};

/** I13: 1 a 3 níveis, sem variável repetida no mesmo eixo. */
export function assertLevelsValid(levels: TupleLevelInput[]): void {
  if (levels.length === 0) {
    throw new DomainError('AXIS_NEEDS_ONE_LEVEL', 'Um eixo precisa de pelo menos um nível.');
  }
  if (levels.length > MAX_AXIS_LEVELS) {
    throw new DomainError(
      'TOO_MANY_LEVELS',
      `Um eixo pode ter no máximo ${MAX_AXIS_LEVELS} níveis; foram informados ${levels.length}.`,
      { levels: levels.length },
    );
  }
  const seen = new Set<string>();
  for (const level of levels) {
    if (seen.has(level.variableId)) {
      throw new DomainError(
        'DUPLICATE_VARIABLE_IN_AXIS',
        'A mesma variável não pode ocupar dois níveis do mesmo eixo.',
        { variableId: level.variableId },
      );
    }
    seen.add(level.variableId);
    if (level.domains.length === 0) {
      throw new DomainError(
        'INVALID_INPUT',
        'Um nível de eixo precisa de pelo menos um domínio.',
        { variableId: level.variableId },
      );
    }
  }
}

/** I14: nenhuma variável aparece nos dois eixos da mesma versão. */
export function assertVariablesNotOnBothAxes(
  xLevels: TupleLevelInput[],
  yLevels: TupleLevelInput[],
): void {
  const onX = new Set(xLevels.map((level) => level.variableId));
  for (const level of yLevels) {
    if (onX.has(level.variableId)) {
      throw new DomainError(
        'VARIABLE_ON_BOTH_AXES',
        'A mesma variável não pode aparecer nos dois eixos da matriz.',
        { variableId: level.variableId },
      );
    }
  }
}

/** I16: o produto das tuplas dos dois eixos não passa de 6.000. */
export function assertGridFits(combinations: number): void {
  if (combinations > MAX_COMBINATIONS) {
    throw new DomainError(
      'GRID_TOO_LARGE',
      `Esta configuração geraria ${combinations} combinações; o teto é ${MAX_COMBINATIONS}.`,
      { combinations, max: MAX_COMBINATIONS },
    );
  }
}

function orderedDomains(level: TupleLevelInput): Domain[] {
  return [...level.domains].sort((a, b) => a.position - b.position);
}

function ruleForPair(
  compatibility: ApplicableCompatibility[],
  parent: TupleLevelInput,
  child: TupleLevelInput,
): ApplicableCompatibility | undefined {
  return compatibility.find(
    (rule) =>
      rule.parentVariableId === parent.variableId && rule.childVariableId === child.variableId,
  );
}

function unknownDomainWarning(
  rule: ApplicableCompatibility,
  parent: TupleLevelInput,
  child: TupleLevelInput,
  levelIndex: number,
): TupleWarning | undefined {
  const parentCodes = new Set(parent.domains.map((domain) => domain.code));
  const childCodes = new Set(child.domains.map((domain) => domain.code));
  const unknown = new Set<string>();
  for (const [parentCode, allowed] of Object.entries(rule.version.allow)) {
    if (!parentCodes.has(parentCode)) unknown.add(parentCode);
    for (const childCode of allowed) {
      if (!childCodes.has(childCode)) unknown.add(childCode);
    }
  }
  if (unknown.size === 0) return undefined;
  const codes = [...unknown];
  return {
    code: 'RULE_REFERENCES_UNKNOWN_DOMAIN',
    ruleId: rule.ruleId,
    levelIndex,
    codes,
    message: `A regra "${rule.ruleCode}" cita domínios que não existem nas versões pinadas: ${codes.join(', ')}.`,
  };
}

/** Domínios permitidos do nível `i` sob o código de pai `parentCode`. */
function allowedDomains(
  domains: Domain[],
  rule: ApplicableCompatibility | undefined,
  parentCode: string,
): Domain[] {
  if (rule === undefined) return domains;
  const allowed = rule.version.allow[parentCode];
  if (allowed === undefined) {
    return rule.version.defaultForUnlisted === 'ALL' ? domains : [];
  }
  const allowedSet = new Set(allowed);
  return domains.filter((domain) => allowedSet.has(domain.code));
}

/**
 * Aplica o algoritmo de §3 literalmente. Regras valem apenas entre níveis
 * adjacentes (i-1 → i) — limitação consciente, ver §5.4.
 */
export function generateTuples(input: GenerateTuplesInput): GenerateTuplesResult {
  const { levels, compatibility } = input;
  const manualSuppressions = input.manualSuppressions ?? [];
  assertLevelsValid(levels);

  const warnings: TupleWarning[] = [];
  const usedRuleIds: string[] = [];

  // Nível 0 não tem pai: entra inteiro, na ordem de `position`.
  let paths: string[][] = orderedDomains(levels[0]!).map((domain) => [domain.code]);
  assertGridFits(paths.length);

  for (let i = 1; i < levels.length; i++) {
    const parent = levels[i - 1]!;
    const child = levels[i]!;
    const domains = orderedDomains(child);
    const rule = ruleForPair(compatibility, parent, child);

    if (rule === undefined) {
      warnings.push({
        code: 'NO_RULE_FOR_PAIR',
        levelIndex: i,
        message: `Não há regra de compatibilidade publicada entre os níveis ${i} e ${i + 1} deste eixo — o produto cartesiano completo foi usado.`,
      });
    } else {
      usedRuleIds.push(rule.version.id);
      const unknown = unknownDomainWarning(rule, parent, child, i);
      if (unknown !== undefined) warnings.push(unknown);
    }

    const next: string[][] = [];
    for (const partial of paths) {
      const allowed = allowedDomains(domains, rule, partial[i - 1]!);
      if (allowed.length === 0) {
        const path = encodePath(partial);
        warnings.push({
          code: 'PARENT_HAS_NO_CHILDREN',
          levelIndex: i,
          path,
          message: `"${path}" ficou sem nenhum valor permitido no nível ${i + 1} e não aparece no grid.`,
        });
        continue;
      }
      for (const domain of allowed) next.push([...partial, domain.code]);
    }
    assertGridFits(next.length);
    paths = next;
  }

  const generated = paths.map(encodePath);
  const generatedSet = new Set(generated);
  for (const suppression of manualSuppressions) {
    if (!generatedSet.has(suppression)) {
      warnings.push({
        code: 'SUPPRESSION_NOT_APPLICABLE',
        path: suppression,
        message: `A supressão manual de "${suppression}" não se aplica: essa combinação não existe mais neste eixo.`,
      });
    }
  }
  const suppressedSet = new Set(manualSuppressions);
  const tuples = generated.filter((path) => !suppressedSet.has(path));

  if (tuples.length === 0) {
    throw new DomainError(
      'NO_VALID_TUPLES',
      'Nenhuma combinação válida resulta desta configuração de níveis, regras e supressões.',
      { warnings },
    );
  }
  if (tuples.length > LARGE_GRID_THRESHOLD) {
    warnings.push({
      code: 'LARGE_GRID',
      count: tuples.length,
      message: `Este eixo tem ${tuples.length} combinações, acima do limite confortável de ${LARGE_GRID_THRESHOLD}.`,
    });
  }

  return { tuples, usedRuleIds, warnings };
}
