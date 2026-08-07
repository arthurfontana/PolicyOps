import type {
  Axis,
  AxisRole,
  CompatibilityRule,
  CompatibilityVersion,
  Matrix,
  MatrixVersion,
  PolicyOpsDocument,
  Variable,
  VariableVersion,
} from '../document/schema';

/**
 * Detecção de defasagem de eixo — docs/05-regras-de-negocio.md §5.2.
 *
 * Um eixo está defasado quando **qualquer** uma destas for verdadeira:
 *
 * 1. algum `level.variableVersionId` aponta para versão que não é mais `PUBLISHED`;
 * 2. alguma regra em `derivedFrom.compatibilityVersionIds` não é mais `PUBLISHED`;
 * 3. **passou a existir** uma regra publicada para um par adjacente que não
 *    tinha regra quando as tuplas foram geradas.
 *
 * O terceiro caso é o mais fácil de esquecer: nada mudou no eixo, nada mudou
 * nas versões que ele pina — o que mudou foi a biblioteca ganhar uma regra
 * entre duas variáveis que o eixo já empilhava. Sem ele, o usuário nunca
 * descobriria que o grid dele tem combinações que o negócio já declarou
 * inexistentes.
 *
 * Este módulo **só lê**. Adotar a evolução é sempre ato explícito
 * (`reconcile/resnapshot.ts`).
 */

export type StaleReasonKind = 'LEVEL_PIN_OUTDATED' | 'RULE_OUTDATED' | 'NEW_RULE_AVAILABLE';

export type StaleReason = {
  kind: StaleReasonKind;
  /**
   * Frase pronta em pt-BR, no formato do badge de §5.2:
   * *"Score HVI3 — v1 pinada, v2 disponível"*.
   */
  message: string;
  /** Nível do eixo a que o motivo se refere (o filho, no caso das regras). */
  levelIndex?: number;
  variableId?: string;
  variableCode?: string;
  ruleId?: string;
  ruleCode?: string;
  ruleName?: string;
  /** Número da versão que o eixo pina hoje; `null` quando ela sumiu da biblioteca. */
  pinnedNumber: number | null;
  /** Número da versão publicada disponível; `null` quando não há nenhuma. */
  availableNumber: number | null;
};

export type AxisStaleness = { role: AxisRole; stale: boolean; reasons: StaleReason[] };

// ---------------------------------------------------------------------------
// Buscas na biblioteca
// ---------------------------------------------------------------------------

function findVariable(doc: PolicyOpsDocument, variableId: string): Variable | undefined {
  return doc.variables.find((candidate) => candidate.id === variableId);
}

/** A versão `PUBLISHED` da variável — I11 garante no máximo uma. */
export function publishedVariableVersion(variable: Variable): VariableVersion | undefined {
  return variable.versions.find((candidate) => candidate.state === 'PUBLISHED');
}

/** A regra (e a versão) a que um `CompatibilityVersion.id` pertence. */
function findCompatibilityByVersionId(
  doc: PolicyOpsDocument,
  versionId: string,
): { rule: CompatibilityRule; version: CompatibilityVersion } | undefined {
  for (const rule of doc.compatibility) {
    const version = rule.versions.find((candidate) => candidate.id === versionId);
    if (version !== undefined) return { rule, version };
  }
  return undefined;
}

/**
 * A regra publicada aplicável ao par ordenado `(pai, filho)`, ignorando regras
 * arquivadas. I12 garante no máximo uma.
 */
export function publishedRuleForPair(
  doc: PolicyOpsDocument,
  parentVariableId: string,
  childVariableId: string,
): { rule: CompatibilityRule; version: CompatibilityVersion } | undefined {
  for (const rule of doc.compatibility) {
    if (rule.archivedAt !== undefined) continue;
    if (rule.parentVariableId !== parentVariableId) continue;
    if (rule.childVariableId !== childVariableId) continue;
    const version = rule.versions.find((candidate) => candidate.state === 'PUBLISHED');
    if (version !== undefined) return { rule, version };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// §5.2 — os três motivos
// ---------------------------------------------------------------------------

function pinReason(doc: PolicyOpsDocument, axis: Axis, levelIndex: number): StaleReason | null {
  const level = axis.levels[levelIndex]!;
  const variable = findVariable(doc, level.variableId);
  if (variable === undefined) {
    return {
      kind: 'LEVEL_PIN_OUTDATED',
      levelIndex,
      variableId: level.variableId,
      variableCode: level.label,
      pinnedNumber: null,
      availableNumber: null,
      message: `${level.label} — a variável não está mais na biblioteca.`,
    };
  }
  const pinned = variable.versions.find((candidate) => candidate.id === level.variableVersionId);
  if (pinned !== undefined && pinned.state === 'PUBLISHED') return null;

  const available = publishedVariableVersion(variable);
  const pinnedNumber = pinned?.number ?? null;
  const availableNumber = available?.number ?? null;
  return {
    kind: 'LEVEL_PIN_OUTDATED',
    levelIndex,
    variableId: variable.id,
    variableCode: variable.code,
    pinnedNumber,
    availableNumber,
    message:
      availableNumber === null
        ? `${level.label} — a versão pinada não é mais a publicada, e a variável não tem nenhuma versão publicada.`
        : pinnedNumber === null
          ? `${level.label} — a versão pinada sumiu da biblioteca, v${availableNumber} disponível.`
          : `${level.label} — v${pinnedNumber} pinada, v${availableNumber} disponível.`,
  };
}

function ruleReasons(doc: PolicyOpsDocument, axis: Axis): { reasons: StaleReason[]; usedRuleIds: Set<string> } {
  const reasons: StaleReason[] = [];
  const usedRuleIds = new Set<string>();

  for (const versionId of axis.derivedFrom.compatibilityVersionIds) {
    const found = findCompatibilityByVersionId(doc, versionId);
    if (found === undefined) {
      reasons.push({
        kind: 'RULE_OUTDATED',
        ruleId: versionId,
        ruleCode: versionId,
        pinnedNumber: null,
        availableNumber: null,
        message: 'Uma regra de compatibilidade usada por este eixo não existe mais na biblioteca.',
      });
      continue;
    }
    const { rule, version } = found;
    usedRuleIds.add(rule.id);
    if (version.state === 'PUBLISHED') continue;

    const available = rule.versions.find((candidate) => candidate.state === 'PUBLISHED');
    const availableNumber = available?.number ?? null;
    reasons.push({
      kind: 'RULE_OUTDATED',
      ruleId: rule.id,
      ruleCode: rule.code,
      ruleName: rule.name,
      pinnedNumber: version.number,
      availableNumber,
      message:
        availableNumber === null
          ? `Regra ${rule.name} — v${version.number} pinada, e a regra não tem mais versão publicada.`
          : `Regra ${rule.name} — v${version.number} pinada, v${availableNumber} disponível.`,
    });
  }

  return { reasons, usedRuleIds };
}

/**
 * Terceiro caso de §5.2: regra publicada que **passou a existir** para um par
 * adjacente que não tinha regra quando as tuplas foram geradas.
 */
function newRuleReasons(
  doc: PolicyOpsDocument,
  axis: Axis,
  usedRuleIds: Set<string>,
): StaleReason[] {
  const reasons: StaleReason[] = [];
  for (let index = 1; index < axis.levels.length; index++) {
    const parent = axis.levels[index - 1]!;
    const child = axis.levels[index]!;
    const found = publishedRuleForPair(doc, parent.variableId, child.variableId);
    if (found === undefined || usedRuleIds.has(found.rule.id)) continue;
    reasons.push({
      kind: 'NEW_RULE_AVAILABLE',
      levelIndex: index,
      ruleId: found.rule.id,
      ruleCode: found.rule.code,
      ruleName: found.rule.name,
      pinnedNumber: null,
      availableNumber: found.version.number,
      message: `Regra ${found.rule.name} — passou a existir entre os níveis ${index} e ${index + 1}, v${found.version.number} disponível.`,
    });
  }
  return reasons;
}

/** Os motivos de defasagem de um eixo, na ordem em que a interface os mostra. */
export function getAxisStaleness(doc: PolicyOpsDocument, axis: Axis): AxisStaleness {
  const reasons: StaleReason[] = [];

  for (let index = 0; index < axis.levels.length; index++) {
    const reason = pinReason(doc, axis, index);
    if (reason !== null) reasons.push(reason);
  }

  const rules = ruleReasons(doc, axis);
  reasons.push(...rules.reasons);
  reasons.push(...newRuleReasons(doc, axis, rules.usedRuleIds));

  return { role: axis.role, stale: reasons.length > 0, reasons };
}

/** Os motivos que dizem respeito a um nível específico — o badge ao lado dele. */
export function reasonsForLevel(staleness: AxisStaleness, levelIndex: number): StaleReason[] {
  return staleness.reasons.filter(
    (reason) => reason.kind === 'LEVEL_PIN_OUTDATED' && reason.levelIndex === levelIndex,
  );
}

/** Os motivos que dizem respeito a regras de compatibilidade — o badge ao lado do par. */
export function reasonsForRules(staleness: AxisStaleness): StaleReason[] {
  return staleness.reasons.filter((reason) => reason.kind !== 'LEVEL_PIN_OUTDATED');
}

// ---------------------------------------------------------------------------
// Varredura do documento
// ---------------------------------------------------------------------------

export type StaleAxisEntry = {
  matrixId: string;
  matrixCode: string;
  matrixName: string;
  projectId: string;
  versionId: string;
  versionNumber: number;
  role: AxisRole;
  staleness: AxisStaleness;
};

function entryFor(matrix: Matrix, version: MatrixVersion, staleness: AxisStaleness): StaleAxisEntry {
  return {
    matrixId: matrix.id,
    matrixCode: matrix.code,
    matrixName: matrix.name,
    projectId: matrix.projectId,
    versionId: version.id,
    versionNumber: version.number,
    role: staleness.role,
    staleness,
  };
}

/**
 * Todos os rascunhos com eixo defasado — a tela de impacto das bibliotecas e a
 * tela de rascunhos.
 *
 * Só `DRAFT`: em versões publicadas e históricas a defasagem não é pendência,
 * é registro (§5.2). Uma versão publicada que "adotasse" qualquer coisa
 * perderia o lastro, e é justamente isso que o snapshot existe para impedir.
 */
export function getStaleAxes(doc: PolicyOpsDocument): StaleAxisEntry[] {
  const entries: StaleAxisEntry[] = [];
  for (const matrix of doc.matrices) {
    for (const version of matrix.versions) {
      if (version.state !== 'DRAFT') continue;
      for (const axis of [version.axes.x, version.axes.y]) {
        const staleness = getAxisStaleness(doc, axis);
        if (!staleness.stale) continue;
        entries.push(entryFor(matrix, version, staleness));
      }
    }
  }
  return entries;
}

/**
 * Os rascunhos que podem adotar uma nova versão **desta variável** — a lista
 * de "quem pode adotar" da tela de impacto da biblioteca de variáveis.
 *
 * Nada em lote: a lista é de links, um por matriz, e cada adoção passa pelo
 * diálogo de reconciliação daquele rascunho (decisão de produto de §5.4).
 */
export function getDraftsAdoptingVariable(
  doc: PolicyOpsDocument,
  variableId: string,
): StaleAxisEntry[] {
  return getStaleAxes(doc).filter((entry) =>
    entry.staleness.reasons.some(
      (reason) => reason.kind === 'LEVEL_PIN_OUTDATED' && reason.variableId === variableId,
    ),
  );
}

/** O mesmo, para uma regra de compatibilidade. */
export function getDraftsAdoptingRule(
  doc: PolicyOpsDocument,
  ruleId: string,
): StaleAxisEntry[] {
  return getStaleAxes(doc).filter((entry) =>
    entry.staleness.reasons.some(
      (reason) => reason.kind !== 'LEVEL_PIN_OUTDATED' && reason.ruleId === ruleId,
    ),
  );
}
