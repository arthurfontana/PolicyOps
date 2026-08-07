import { decodeCellKey } from '../axes/paths';
import type { Axis, Cell, MatrixVersion } from '../document/schema';
import { DIFFED_CELL_FIELDS, type CellChange, type DiffedCellField } from './types';

/**
 * Diff de células — docs/05-regras-de-negocio.md §4.2.
 *
 * Casamento por `xPath::yPath`, em **uma passada** sobre a união das chaves dos
 * dois mapas: nada de varrer o produto cartesiano dos eixos. É o que segura o
 * orçamento de 150 ms para 1.500 combinações.
 */

/** Comparação estrutural rasa de `attrs` (valores são string, número ou booleano). */
function attrsEqual(a: Cell['attrs'], b: Cell['attrs']): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key]);
}

/** Os campos em que as duas células diferem, na ordem canônica. */
export function changedFields(before: Cell, after: Cell): DiffedCellField[] {
  const fields: DiffedCellField[] = [];
  for (const field of DIFFED_CELL_FIELDS) {
    if (field === 'attrs') {
      if (!attrsEqual(before.attrs, after.attrs)) fields.push(field);
      continue;
    }
    if (before[field] !== after[field]) fields.push(field);
  }
  return fields;
}

/** Conjunto de tuplas de cada eixo, para saber se uma combinação existe no grid. */
type GridIndex = { x: Set<string>; y: Set<string> };

function gridIndex(version: MatrixVersion): GridIndex {
  return { x: tupleSet(version.axes.x), y: tupleSet(version.axes.y) };
}

function tupleSet(axis: Axis): Set<string> {
  return new Set(axis.tuples);
}

function hasCombination(index: GridIndex, key: string): boolean {
  const { xPath, yPath } = decodeCellKey(key);
  return index.x.has(xPath) && index.y.has(yPath);
}

/**
 * As mudanças de célula entre duas versões. Células idênticas **não** entram no
 * resultado.
 *
 * `ADDED` distingue os dois casos que a interface trata de forma diferente:
 * `NEW_TUPLE` (a combinação não existia no grid de A) e `WAS_EMPTY` (existia e
 * estava em branco). `REMOVED` é o espelho: `DROPPED_TUPLE` e `NOW_EMPTY`.
 */
export function diffCells(a: MatrixVersion, b: MatrixVersion): CellChange[] {
  const indexA = gridIndex(a);
  const indexB = gridIndex(b);
  const changes: CellChange[] = [];

  for (const [key, after] of Object.entries(b.cells)) {
    const before = a.cells[key];
    if (before === undefined) {
      changes.push({
        kind: 'ADDED',
        key,
        reason: hasCombination(indexA, key) ? 'WAS_EMPTY' : 'NEW_TUPLE',
        after,
      });
      continue;
    }
    const fields = changedFields(before, after);
    if (fields.length === 0) continue;
    changes.push({ kind: 'MODIFIED', key, before, after, fields });
  }

  for (const [key, before] of Object.entries(a.cells)) {
    if (b.cells[key] !== undefined) continue;
    changes.push({
      kind: 'REMOVED',
      key,
      reason: hasCombination(indexB, key) ? 'NOW_EMPTY' : 'DROPPED_TUPLE',
      before,
    });
  }

  return changes;
}

/**
 * Quantas combinações o grid ganhou e perdeu por mudança estrutural do eixo —
 * `combinationsAdded` / `combinationsRemoved` de §4.3.
 *
 * Sai da aritmética dos eixos (`|X| × |Y|` menos a interseção), não de uma
 * varredura do produto cartesiano: com 1.500 combinações a diferença é entre
 * somar dois tamanhos e materializar dois conjuntos de 1.500 chaves.
 */
export function countStructuralCombinations(
  a: MatrixVersion,
  b: MatrixVersion,
): { combinationsAdded: number; combinationsRemoved: number } {
  const xA = tupleSet(a.axes.x);
  const yA = tupleSet(a.axes.y);
  const sharedX = b.axes.x.tuples.filter((tuple) => xA.has(tuple)).length;
  const sharedY = b.axes.y.tuples.filter((tuple) => yA.has(tuple)).length;
  const shared = sharedX * sharedY;
  return {
    combinationsAdded: b.axes.x.tuples.length * b.axes.y.tuples.length - shared,
    combinationsRemoved: a.axes.x.tuples.length * a.axes.y.tuples.length - shared,
  };
}
