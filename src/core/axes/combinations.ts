import type { Axis, AxisRole, MatrixVersion } from '../document/schema';
import { encodeCellKey, isDescendantOf } from './paths';

/**
 * Combinações, pendências e seleção hierárquica —
 * docs/04-eixos-aninhados.md §6 e §7.
 *
 * O conjunto de combinações é sempre derivado de `x.tuples × y.tuples`, nunca
 * materializado no arquivo (docs/03 §6.2). Combinações suprimidas não estão em
 * `tuples` e, por construção, não contam como pendentes.
 */

export type CellCoord = { xPath: string; yPath: string };
export type Combination = CellCoord & { key: string };

/** Ordem de leitura do grid: uma linha (tupla de Y) por vez, colunas da esquerda para a direita. */
export function allCombinations(version: MatrixVersion): Combination[] {
  const combinations: Combination[] = [];
  for (const yPath of version.axes.y.tuples) {
    for (const xPath of version.axes.x.tuples) {
      combinations.push({ xPath, yPath, key: encodeCellKey(xPath, yPath) });
    }
  }
  return combinations;
}

/** Uma combinação está pendente quando `cells[key]?.decision` é indefinido. */
function isPending(version: MatrixVersion, key: string): boolean {
  return version.cells[key]?.decision === undefined;
}

export function countPending(version: MatrixVersion): number {
  let pending = 0;
  for (const combination of allCombinations(version)) {
    if (isPending(version, combination.key)) pending += 1;
  }
  return pending;
}

export function listPending(version: MatrixVersion, limit?: number): Combination[] {
  const pending: Combination[] = [];
  for (const combination of allCombinations(version)) {
    if (limit !== undefined && pending.length >= limit) break;
    if (isPending(version, combination.key)) pending.push(combination);
  }
  return pending;
}

/**
 * Tuplas cobertas por um prefixo de cabeçalho. Clicar em "Varejo" pega as 3
 * linhas do Varejo; clicar em "Varejo › 100k–500k" pega 1.
 *
 * Recebe `Pick<Axis, 'tuples'>` e não `Axis` porque a engine de seleção (S10)
 * opera sobre a view do grid, que só carrega as tuplas do eixo.
 */
export function tuplesUnder(axis: Pick<Axis, 'tuples'>, prefixPath: string): string[] {
  return axis.tuples.filter((tuple) => isDescendantOf(tuple, prefixPath));
}

/** Coordenadas de todas as células sob um cabeçalho, em ordem de leitura do grid. */
export function coordsForHeader(
  version: MatrixVersion,
  role: AxisRole,
  prefixPath: string,
): CellCoord[] {
  const coords: CellCoord[] = [];
  if (role === 'X') {
    const xPaths = tuplesUnder(version.axes.x, prefixPath);
    for (const yPath of version.axes.y.tuples) {
      for (const xPath of xPaths) coords.push({ xPath, yPath });
    }
    return coords;
  }
  const yPaths = tuplesUnder(version.axes.y, prefixPath);
  for (const yPath of yPaths) {
    for (const xPath of version.axes.x.tuples) coords.push({ xPath, yPath });
  }
  return coords;
}
