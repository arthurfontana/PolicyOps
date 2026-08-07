import { snapshotDomains } from '../axes/domain-snapshot';
import { decodeCellKey, decodePath } from '../axes/paths';
import {
  assertGridFits,
  collectPublishedCompatibility,
  generateTuples,
  type TupleWarning,
} from '../axes/tuples';
import type {
  Axis,
  AxisLevel,
  AxisRole,
  Cell,
  Domain,
  MatrixVersion,
  PolicyOpsDocument,
  Variable,
  VariableVersion,
} from '../document/schema';
import { DomainError } from '../errors';
import { locateVersion } from '../versioning/lifecycle';
import { getAxisStaleness, publishedVariableVersion } from './stale';

/**
 * Reconciliação de eixo — docs/05-regras-de-negocio.md §5.3 e §5.4.
 *
 * Recalcula o que o eixo **seria hoje**, com as versões publicadas atuais das
 * variáveis e as regras de compatibilidade publicadas atuais, e compara com o
 * snapshot congelado do eixo.
 *
 * ## O princípio
 *
 * Este módulo é uma função pura de `(documento, versão, eixo)` para um
 * `MatrixVersion` **novo**. Ele nunca escreve no documento, nunca alcança
 * outra versão da matriz e nunca é chamado sem que a camada de comandos tenha
 * passado por `assertEditable` antes. Uma versão `PUBLISHED` ou `SUPERSEDED`
 * jamais é tocada: o resultado é sempre um objeto novo, e quem o grava é
 * `axis/resnapshot`, que só grava em `DRAFT`.
 *
 * ## Identidade de combinação
 *
 * Uma combinação é identificada pelo **caminho** (`VAREJO|500K_1M`), não por
 * posição. Renomear o rótulo de um domínio ou reordenar os domínios não muda o
 * caminho, então a célula sobrevive; remover o domínio muda, e a célula é
 * descartada com o conteúdo íntegro no payload do evento.
 *
 * A exceção é a **substituição**: um `code` removido numa versão e recriado em
 * outra é outra coisa, ainda que o caminho coincida (§5.4). Detectar isso exige
 * olhar a cadeia de versões da variável entre o pin e a versão publicada atual
 * — é o que `replacedDomainCodes` faz. Sem isso, "R3 — Risco médio" apagada e
 * "R3 — Renda alta" criada depois herdariam a mesma decisão, silenciosamente.
 */

// ---------------------------------------------------------------------------
// O plano — §5.3
// ---------------------------------------------------------------------------

export type ResnapshotLevelChange = {
  index: number;
  variableId: string;
  variableCode: string;
  /** Rótulo do nível no eixo — é o que o diálogo mostra. */
  label: string;
  /** Número da versão pinada; `null` quando ela sumiu da biblioteca. */
  from: number | null;
  /** Número da versão publicada que passa a ser pinada. */
  to: number;
  addedDomains: string[];
  removedDomains: string[];
  /**
   * Domínios cujo `code` some e reaparece na cadeia de versões: substituição,
   * não permanência. A célula nasce vazia (§5.4).
   */
  replacedDomains: string[];
  relabeled: Array<{ code: string; from: string; to: string }>;
  reordered: boolean;
  /**
   * A variável foi arquivada desde o snapshot. O eixo continua funcionando com
   * a versão publicada dela — arquivar tira das opções de novos eixos, não
   * invalida os existentes —, mas o diálogo diz isso em voz alta.
   */
  variableArchived: boolean;
};

export type ResnapshotCompatibilityChange = {
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  /** Versão usada na geração das tuplas atuais; `null` quando a regra não se aplicava. */
  from: number | null;
  /** Versão que passa a valer; `null` quando a regra deixa de se aplicar. */
  to: number | null;
};

export type ResnapshotPlan = {
  role: AxisRole;
  levels: ResnapshotLevelChange[];
  compatibility: ResnapshotCompatibilityChange[];
  addedTuples: string[];
  removedTuples: string[];
  /** Combinações do grid que passam a existir — as células a preencher. */
  newCombinations: number;
  /** Combinações do grid que deixam de existir. */
  droppedCombinations: number;
  /** As células descartadas, **na íntegra** — é o que vai para a auditoria. */
  droppedCells: Array<{ key: string; cell: Cell }>;
  /** Supressões manuais que deixam de se aplicar: a combinação não existe mais. */
  droppedSuppressions: string[];
  warnings: TupleWarning[];
};

export type ResnapshotResult = {
  /** A versão recalculada — **nova**, nada é mutado. */
  version: MatrixVersion;
  plan: ResnapshotPlan;
  /** Tuplas do eixo antes e depois — o que a miniatura do grid desenha. */
  tuplesBefore: string[];
  tuplesAfter: string[];
};

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function axisOf(version: MatrixVersion, role: AxisRole): Axis {
  return role === 'X' ? version.axes.x : version.axes.y;
}

function otherAxisOf(version: MatrixVersion, role: AxisRole): Axis {
  return role === 'X' ? version.axes.y : version.axes.x;
}

/** O caminho da chave de célula no eixo operado. */
function ownPathOf(role: AxisRole, key: string): string {
  const { xPath, yPath } = decodeCellKey(key);
  return role === 'X' ? xPath : yPath;
}

function byPosition(domains: Domain[]): Domain[] {
  return [...domains].sort((a, b) => a.position - b.position);
}

function codesOf(domains: Domain[]): string[] {
  return byPosition(domains).map((domain) => domain.code);
}

/**
 * Ordem relativa dos domínios que existem nas duas versões. Comparar as listas
 * inteiras acusaria reordenação sempre que um domínio entrasse no meio — o que
 * é adição, não reordenação.
 */
function isReordered(before: Domain[], after: Domain[]): boolean {
  const beforeCodes = new Set(before.map((domain) => domain.code));
  const afterCodes = new Set(after.map((domain) => domain.code));
  const shared = (domains: Domain[], keep: Set<string>): string =>
    codesOf(domains)
      .filter((code) => keep.has(code))
      .join('|');
  return shared(before, afterCodes) !== shared(after, beforeCodes);
}

/**
 * `code` que existe no pin **e** na versão alvo, mas some em alguma versão
 * intermediária: foi removido e recriado, e portanto é outro domínio (§5.4).
 *
 * Rascunhos da variável ficam de fora da cadeia: um domínio removido num
 * rascunho ainda não publicado nunca deixou de existir para o mundo.
 */
function replacedDomainCodes(
  variable: Variable,
  pinned: VariableVersion | undefined,
  target: VariableVersion,
): string[] {
  if (pinned === undefined || pinned.id === target.id) return [];
  const chain = variable.versions
    .filter(
      (candidate) =>
        candidate.state !== 'DRAFT' &&
        candidate.number > pinned.number &&
        candidate.number <= target.number,
    )
    .sort((a, b) => a.number - b.number);
  if (chain.length === 0) return [];

  const targetCodes = new Set(target.domains.map((domain) => domain.code));
  const replaced: string[] = [];
  for (const code of codesOf(pinned.domains)) {
    if (!targetCodes.has(code)) continue;
    const vanished = chain.some(
      (candidate) => !candidate.domains.some((domain) => domain.code === code),
    );
    if (vanished) replaced.push(code);
  }
  return replaced;
}

// ---------------------------------------------------------------------------
// Níveis: novo pin, novo snapshot de domínios
// ---------------------------------------------------------------------------

type ResolvedLevel = {
  level: AxisLevel;
  change: ResnapshotLevelChange;
  /** Códigos substituídos neste nível — quebram a identidade da combinação. */
  replaced: Set<string>;
};

function resolveLevel(doc: PolicyOpsDocument, axis: Axis, index: number): ResolvedLevel {
  const level = axis.levels[index]!;
  const variable = doc.variables.find((candidate) => candidate.id === level.variableId);
  if (variable === undefined) {
    throw new DomainError(
      'NOT_FOUND',
      `A variável do nível ${index + 1} deste eixo não existe mais neste documento.`,
      { variableId: level.variableId, levelIndex: index },
    );
  }
  const target = publishedVariableVersion(variable);
  if (target === undefined) {
    throw new DomainError(
      'VARIABLE_HAS_NO_PUBLISHED_VERSION',
      `A variável "${variable.code}" não tem versão publicada — publique uma antes de atualizar o eixo.`,
      { variableId: variable.id, code: variable.code, levelIndex: index },
    );
  }
  const pinned = variable.versions.find((candidate) => candidate.id === level.variableVersionId);

  const before = pinned?.domains ?? level.domains;
  const after = target.domains;
  const beforeCodes = new Set(before.map((domain) => domain.code));
  const afterCodes = new Set(after.map((domain) => domain.code));
  const replaced = replacedDomainCodes(variable, pinned, target);
  const replacedSet = new Set(replaced);

  const relabeled: Array<{ code: string; from: string; to: string }> = [];
  for (const domain of byPosition(before)) {
    if (replacedSet.has(domain.code)) continue;
    const match = after.find((candidate) => candidate.code === domain.code);
    if (match !== undefined && match.label !== domain.label) {
      relabeled.push({ code: domain.code, from: domain.label, to: match.label });
    }
  }

  return {
    // O id e o rótulo do nível pertencem à versão da matriz, não à biblioteca:
    // o resnapshot troca o pin e o snapshot de domínios, e só.
    level: {
      ...level,
      variableVersionId: target.id,
      // Só identidade — nunca `groupingRanges` (docs/03 §6.1).
      domains: snapshotDomains(target.domains),
    },
    change: {
      index,
      variableId: variable.id,
      variableCode: variable.code,
      label: level.label,
      from: pinned?.number ?? null,
      to: target.number,
      addedDomains: codesOf(after).filter((code) => !beforeCodes.has(code)),
      removedDomains: codesOf(before).filter((code) => !afterCodes.has(code)),
      replacedDomains: replaced,
      relabeled,
      reordered: isReordered(before, after),
      variableArchived: variable.archivedAt !== undefined,
    },
    replaced: replacedSet,
  };
}

// ---------------------------------------------------------------------------
// Compatibilidade: o que entra e o que sai de `derivedFrom`
// ---------------------------------------------------------------------------

function compatibilityChanges(
  doc: PolicyOpsDocument,
  beforeIds: string[],
  afterIds: string[],
): ResnapshotCompatibilityChange[] {
  type Slot = { ruleCode: string; ruleName: string; from: number | null; to: number | null };
  const slots = new Map<string, Slot>();

  function slotFor(versionId: string): { ruleId: string; slot: Slot; number: number | null } {
    for (const rule of doc.compatibility) {
      const version = rule.versions.find((candidate) => candidate.id === versionId);
      if (version === undefined) continue;
      const existing = slots.get(rule.id);
      const slot = existing ?? { ruleCode: rule.code, ruleName: rule.name, from: null, to: null };
      if (existing === undefined) slots.set(rule.id, slot);
      return { ruleId: rule.id, slot, number: version.number };
    }
    // A regra sumiu da biblioteca: o eixo a usava e não usa mais.
    const existing = slots.get(versionId);
    const slot = existing ?? {
      ruleCode: versionId,
      ruleName: 'Regra removida da biblioteca',
      from: null,
      to: null,
    };
    if (existing === undefined) slots.set(versionId, slot);
    return { ruleId: versionId, slot, number: null };
  }

  for (const versionId of beforeIds) {
    const { slot, number } = slotFor(versionId);
    slot.from = number;
  }
  for (const versionId of afterIds) {
    const { slot, number } = slotFor(versionId);
    slot.to = number;
  }

  const changes: ResnapshotCompatibilityChange[] = [];
  for (const [ruleId, slot] of slots) {
    if (slot.from === slot.to) continue;
    changes.push({
      ruleId,
      ruleCode: slot.ruleCode,
      ruleName: slot.ruleName,
      from: slot.from,
      to: slot.to,
    });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// §5.4 — o cálculo
// ---------------------------------------------------------------------------

/**
 * Recalcula o eixo `role` da versão com o estado atual da biblioteca. Função
 * pura: devolve uma `MatrixVersion` nova e o plano do que mudou, sem tocar em
 * nada do que recebeu.
 */
export function computeResnapshot(
  doc: PolicyOpsDocument,
  version: MatrixVersion,
  role: AxisRole,
): ResnapshotResult {
  const axis = axisOf(version, role);
  const other = otherAxisOf(version, role);

  // 2. Novo pin e novo snapshot de domínios de cada nível.
  const resolved = axis.levels.map((_unused, index) => resolveLevel(doc, axis, index));
  const levels = resolved.map((entry) => entry.level);
  const compatibility = collectPublishedCompatibility(doc.compatibility);

  // 3. Regenera as tuplas preservando as supressões manuais ainda aplicáveis.
  //    O universo (sem supressão nenhuma) é o que diz quais delas sobrevivem;
  //    a segunda geração é a que carrega os avisos, inclusive o de supressão
  //    que deixou de fazer sentido.
  const universe = generateTuples({ levels, compatibility, manualSuppressions: [] });
  const universeSet = new Set(universe.tuples);
  const suppressions = axis.manualSuppressions ?? [];
  const keptSuppressions = suppressions.filter((path) => universeSet.has(path));
  const droppedSuppressions = suppressions.filter((path) => !universeSet.has(path));
  const generated = generateTuples({
    levels,
    compatibility,
    manualSuppressions: suppressions,
  });
  assertGridFits(generated.tuples.length * other.tuples.length);

  // 5. Identidade por caminho — com a ressalva da substituição.
  const hasReplacedCode = (path: string): boolean =>
    decodePath(path).some((code, index) => resolved[index]?.replaced.has(code) === true);
  const beforeSet = new Set(axis.tuples);
  const surviving = new Set(
    generated.tuples.filter((tuple) => beforeSet.has(tuple) && !hasReplacedCode(tuple)),
  );
  const addedTuples = generated.tuples.filter((tuple) => !surviving.has(tuple));
  const removedTuples = axis.tuples.filter((tuple) => !surviving.has(tuple));

  // 5 e 7. As células sobreviventes vão inteiras; as demais saem inteiras.
  const cells: Record<string, Cell> = {};
  const droppedCells: Array<{ key: string; cell: Cell }> = [];
  for (const [key, cell] of Object.entries(version.cells)) {
    if (surviving.has(ownPathOf(role, key))) cells[key] = cell;
    else droppedCells.push({ key, cell });
  }

  // 4. `derivedFrom` passa a apontar para as regras efetivamente usadas agora.
  const nextAxis: Axis = {
    role,
    levels,
    tuples: generated.tuples,
    derivedFrom: { compatibilityVersionIds: generated.usedRuleIds },
  };
  if (keptSuppressions.length > 0) nextAxis.manualSuppressions = keptSuppressions;

  const nextVersion: MatrixVersion = {
    ...version,
    axes: role === 'X' ? { x: nextAxis, y: other } : { x: other, y: nextAxis },
    cells,
  };

  const plan: ResnapshotPlan = {
    role,
    levels: resolved.map((entry) => entry.change),
    compatibility: compatibilityChanges(
      doc,
      axis.derivedFrom.compatibilityVersionIds,
      generated.usedRuleIds,
    ),
    addedTuples,
    removedTuples,
    // 6. Combinações novas ficam ausentes de `cells` → contam como pendentes.
    newCombinations: addedTuples.length * other.tuples.length,
    droppedCombinations: removedTuples.length * other.tuples.length,
    droppedCells,
    droppedSuppressions,
    warnings: generated.warnings,
  };

  return { version: nextVersion, plan, tuplesBefore: axis.tuples, tuplesAfter: generated.tuples };
}

// ---------------------------------------------------------------------------
// §5.3 — o preview
// ---------------------------------------------------------------------------

/**
 * O que aconteceria se o eixo fosse atualizado agora. **Não grava nada** — nem
 * o documento recebido, nem nenhuma estrutura dentro dele, é modificado.
 *
 * Recusa com `AXIS_NOT_STALE` quando não há nada a adotar: oferecer um diálogo
 * de reconciliação que não reconcilia coisa alguma seria pior que recusar.
 */
export function previewResnapshot(
  doc: PolicyOpsDocument,
  versionId: string,
  role: AxisRole,
): ResnapshotResult {
  const { version } = locateVersion(doc, versionId);
  const staleness = getAxisStaleness(doc, axisOf(version, role));
  if (!staleness.stale) {
    throw new DomainError(
      'AXIS_NOT_STALE',
      `O ${role === 'X' ? 'eixo X' : 'eixo Y'} já está nas versões mais recentes da biblioteca.`,
      { versionId, role },
    );
  }
  return computeResnapshot(doc, version, role);
}
