import type { Axis, AxisLevel, PolicyOpsDocument } from '../document/schema';
import type { AxisDiff, AxisLevelDiff } from './types';

/**
 * Diff de eixos — docs/05-regras-de-negocio.md §4.1.
 *
 * A distinção que comanda o resto do motor: mudar a **pilha de variáveis**
 * torna as duas versões estruturalmente incomparáveis (os caminhos das tuplas
 * passam a significar outra coisa), enquanto mudar só o **conjunto de tuplas**
 * — por compatibilidade ou supressão — não torna: vira tupla adicionada ou
 * removida. Este segundo caso é o mais comum na prática.
 */

/** A pilha de variáveis do eixo, na ordem dos níveis. */
function variableStack(axis: Axis): string[] {
  return axis.levels.map((level) => level.variableId);
}

export function stacksMatch(a: Axis, b: Axis): boolean {
  const left = variableStack(a);
  const right = variableStack(b);
  return left.length === right.length && left.every((variableId, index) => variableId === right[index]);
}

/**
 * Número da `VariableVersion` pinada pelo nível. `0` quando o pin aponta para
 * uma versão que não existe mais no documento (I15 violada): o diff prefere
 * relatar "mudou de 0 para 3" a estourar.
 */
function pinNumber(doc: PolicyOpsDocument, level: AxisLevel): number {
  const variable = doc.variables.find((candidate) => candidate.id === level.variableId);
  return variable?.versions.find((candidate) => candidate.id === level.variableVersionId)?.number ?? 0;
}

function diffLevel(
  docA: PolicyOpsDocument,
  docB: PolicyOpsDocument,
  index: number,
  a: AxisLevel,
  b: AxisLevel,
): AxisLevelDiff {
  const beforeByCode = new Map(a.domains.map((domain) => [domain.code, domain]));
  const afterByCode = new Map(b.domains.map((domain) => [domain.code, domain]));

  const addedDomains: string[] = [];
  const relabeled: Array<{ code: string; from: string; to: string }> = [];
  for (const domain of b.domains) {
    const before = beforeByCode.get(domain.code);
    if (before === undefined) {
      addedDomains.push(domain.code);
      continue;
    }
    // Renomear um domínio (mesmo `code`) é correção de nomenclatura: muda o
    // rótulo exibido e **nada** nas células (docs/05 §5.4).
    if (before.label !== domain.label) {
      relabeled.push({ code: domain.code, from: before.label, to: domain.label });
    }
  }
  const removedDomains = a.domains
    .filter((domain) => !afterByCode.has(domain.code))
    .map((domain) => domain.code);

  const diff: AxisLevelDiff = {
    index,
    variableId: b.variableId,
    addedDomains,
    removedDomains,
    relabeled,
  };
  if (a.variableVersionId !== b.variableVersionId) {
    diff.pinChanged = { from: pinNumber(docA, a), to: pinNumber(docB, b) };
  }
  return diff;
}

/**
 * As tuplas comuns aos dois eixos aparecem em ordem relativa diferente.
 * Comparar só as comuns é o que separa "reordenou" de "entraram/saíram
 * tuplas": acrescentar uma tupla no meio não é reordenação.
 */
function isReordered(a: Axis, b: Axis): boolean {
  const inB = new Set(b.tuples);
  const inA = new Set(a.tuples);
  const commonInA = a.tuples.filter((tuple) => inB.has(tuple));
  const commonInB = b.tuples.filter((tuple) => inA.has(tuple));
  return commonInA.some((tuple, index) => tuple !== commonInB[index]);
}

export function diffAxis(
  docA: PolicyOpsDocument,
  docB: PolicyOpsDocument,
  a: Axis,
  b: Axis,
): AxisDiff {
  const levelsChanged = !stacksMatch(a, b);

  // Com a pilha diferente, comparar nível a nível compararia variáveis
  // distintas — o que a tela precisa dizer nesse caso é "as estruturas são
  // outras", e ela tira isso dos próprios eixos, não deste diff.
  const levels = levelsChanged
    ? []
    : a.levels.map((level, index) => diffLevel(docA, docB, index, level, b.levels[index]!));

  const inA = new Set(a.tuples);
  const inB = new Set(b.tuples);

  return {
    role: b.role,
    levelsChanged,
    levels,
    addedTuples: b.tuples.filter((tuple) => !inA.has(tuple)),
    removedTuples: a.tuples.filter((tuple) => !inB.has(tuple)),
    reorderedTuples: isReordered(a, b),
  };
}
