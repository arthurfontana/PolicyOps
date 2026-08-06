import type { Axis, AxisLevel } from '../document/schema';
import { decodePath, pathPrefix } from './paths';

/**
 * Layout do cabeçalho aninhado — docs/04-eixos-aninhados.md §4.
 *
 * Os spans são derivados das **tuplas reais**, agrupando tuplas consecutivas
 * que compartilham o prefixo. Nunca do produto cartesiano teórico: é isso que
 * faz a supressão assimétrica (Varejo com 3 faixas, Corporate com 2) produzir
 * spans 3 e 2 sem nenhum caso especial.
 */

export type HeaderCell = {
  code: string;
  label: string;
  shortLabel?: string;
  color?: string;
  /** Prefixo até este nível — é a chave de seleção (§7). */
  path: string;
  /** Quantas tuplas este cabeçalho cobre. */
  span: number;
  /** Índice da primeira tupla coberta. */
  startIndex: number;
};

export type HeaderRow = { level: number; cells: HeaderCell[] };

function headerCell(level: AxisLevel, code: string, path: string, startIndex: number): HeaderCell {
  const domain = level.domains.find((candidate) => candidate.code === code);
  const cell: HeaderCell = {
    code,
    // Um código sem domínio correspondente só acontece com snapshot
    // inconsistente (I15); exibir o próprio código é melhor que quebrar o grid.
    label: domain === undefined ? code : domain.label,
    path,
    span: 1,
    startIndex,
  };
  if (domain?.shortLabel !== undefined) cell.shortLabel = domain.shortLabel;
  if (domain?.color !== undefined) cell.color = domain.color;
  return cell;
}

export function computeHeaderLayout(axis: Axis): HeaderRow[] {
  const rows: HeaderRow[] = [];
  for (let level = 0; level < axis.levels.length; level++) {
    const cells: HeaderCell[] = [];
    let current: HeaderCell | undefined;
    for (let index = 0; index < axis.tuples.length; index++) {
      const tuple = axis.tuples[index]!;
      const path = pathPrefix(tuple, level + 1);
      if (current !== undefined && current.path === path) {
        current.span += 1;
        continue;
      }
      current = headerCell(axis.levels[level]!, decodePath(tuple)[level]!, path, index);
      cells.push(current);
    }
    rows.push({ level, cells });
  }
  return rows;
}
