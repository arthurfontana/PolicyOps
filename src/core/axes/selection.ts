import type { AxisRole } from '../document/schema';
import { type CellCoord, tuplesUnder } from './combinations';
import { decodeCellKey, encodeCellKey, pathPrefix } from './paths';

/**
 * Engine de seleção — docs/07-ux-e-editor.md §5, docs/04-eixos-aninhados.md §7.
 *
 * TypeScript puro: nenhuma dessas funções conhece React, store ou DOM. O store
 * (`src/store/editor-store.ts`) é só uma casca que guarda `selection`, `anchor`
 * e `focus` e delega o cálculo para cá.
 *
 * **Regra estrutural (§5):** todo retângulo é calculado sobre os *índices nos
 * arrays `tuples`* — nunca sobre a ordem alfabética dos códigos, nunca sobre a
 * ordem de inserção no `Set`. As tuplas já vêm na ordem visual do grid desde a
 * S03 (docs/04 §3), e é ela que define o que é "acima", "à direita" e
 * "entre".
 */

export type Coord = CellCoord;

export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

/**
 * O mínimo que a seleção precisa saber do grid: as tuplas de cada eixo, na
 * ordem visual. `EditorView` (docs/08 §4) satisfaz essa forma estruturalmente,
 * então o componente passa a própria view sem adaptador.
 */
export interface SelectionAxisView {
  axis: { tuples: string[] };
}

export interface SelectionView {
  x: SelectionAxisView;
  y: SelectionAxisView;
}

/** Chave de célula — a mesma de `cells` no documento (docs/04 §2). */
export function toKey(coord: Coord): string {
  return encodeCellKey(coord.xPath, coord.yPath);
}

export function fromKey(key: string): Coord {
  return decodeCellKey(key);
}

export type CoordIndex = { xIndex: number; yIndex: number };

/**
 * Posição visual da coordenada. `null` quando a coordenada não existe mais no
 * grid — acontece ao trocar de versão com uma seleção viva, ou depois de uma
 * supressão manual.
 */
export function coordIndex(view: SelectionView, coord: Coord): CoordIndex | null {
  const xIndex = view.x.axis.tuples.indexOf(coord.xPath);
  const yIndex = view.y.axis.tuples.indexOf(coord.yPath);
  if (xIndex < 0 || yIndex < 0) return null;
  return { xIndex, yIndex };
}

/** Coordenada em uma posição visual, ou `null` se estiver fora do grid. */
export function coordAt(view: SelectionView, index: CoordIndex): Coord | null {
  const xPath = view.x.axis.tuples[index.xIndex];
  const yPath = view.y.axis.tuples[index.yIndex];
  if (xPath === undefined || yPath === undefined) return null;
  return { xPath, yPath };
}

/**
 * Coordenadas em ordem de leitura (uma linha de Y por vez), filtradas pelos
 * conjuntos de tuplas. `null` significa "todas as tuplas deste eixo".
 *
 * Toda função de seleção passa por aqui: é o que garante que o resultado saia
 * na ordem visual, e não na ordem em que os cabeçalhos foram varridos.
 */
function coordsWithin(
  view: SelectionView,
  xPaths: ReadonlySet<string> | null,
  yPaths: ReadonlySet<string> | null,
): Coord[] {
  const coords: Coord[] = [];
  for (const yPath of view.y.axis.tuples) {
    if (yPaths !== null && !yPaths.has(yPath)) continue;
    for (const xPath of view.x.axis.tuples) {
      if (xPaths !== null && !xPaths.has(xPath)) continue;
      coords.push({ xPath, yPath });
    }
  }
  return coords;
}

/** Todas as combinações do grid, em ordem de leitura. */
export function allCoords(view: SelectionView): Coord[] {
  return coordsWithin(view, null, null);
}

/**
 * Retângulo entre duas coordenadas, inclusivo nas duas pontas e **normalizado**:
 * a âncora pode estar depois do alvo em qualquer um dos eixos (ou nos dois).
 *
 * Coordenada que não existe no grid devolve `[]` em vez de lançar — a seleção
 * é estado de interface e não deve derrubar o grid.
 */
export function rectBetween(view: SelectionView, a: Coord, b: Coord): Coord[] {
  const from = coordIndex(view, a);
  const to = coordIndex(view, b);
  if (from === null || to === null) return [];
  const x0 = Math.min(from.xIndex, to.xIndex);
  const x1 = Math.max(from.xIndex, to.xIndex);
  const y0 = Math.min(from.yIndex, to.yIndex);
  const y1 = Math.max(from.yIndex, to.yIndex);
  const coords: Coord[] = [];
  for (let yIndex = y0; yIndex <= y1; yIndex++) {
    for (let xIndex = x0; xIndex <= x1; xIndex++) {
      coords.push({ xPath: view.x.axis.tuples[xIndex]!, yPath: view.y.axis.tuples[yIndex]! });
    }
  }
  return coords;
}

const STEP: Record<Direction, CoordIndex> = {
  UP: { xIndex: 0, yIndex: -1 },
  DOWN: { xIndex: 0, yIndex: 1 },
  LEFT: { xIndex: -1, yIndex: 0 },
  RIGHT: { xIndex: 1, yIndex: 0 },
};

/**
 * Um passo na ordem visual, com clamp nos limites do grid. Coordenada fora do
 * grid volta inalterada.
 */
export function stepCoord(view: SelectionView, coord: Coord, direction: Direction): Coord {
  const at = coordIndex(view, coord);
  if (at === null) return coord;
  const delta = STEP[direction];
  const next = {
    xIndex: clamp(at.xIndex + delta.xIndex, view.x.axis.tuples.length - 1),
    yIndex: clamp(at.yIndex + delta.yIndex, view.y.axis.tuples.length - 1),
  };
  // `coordIndex` já provou que os dois eixos têm tuplas e `clamp` mantém os
  // índices dentro dos limites: a coordenada existe.
  return coordAt(view, next)!;
}

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

/**
 * `Shift + setas`: o retângulo é sempre recalculado entre a âncora e a **ponta
 * móvel** dada um passo adiante. Inverter a direção encolhe o retângulo, porque
 * a ponta móvel volta na direção da âncora — não é acumulativo.
 */
export function expandFrom(
  view: SelectionView,
  anchor: Coord,
  direction: Direction,
  current: Coord,
): Coord[] {
  return rectBetween(view, anchor, stepCoord(view, current, direction));
}

function axisOf(view: SelectionView, role: AxisRole): SelectionAxisView {
  return role === 'X' ? view.x : view.y;
}

/**
 * Combinações sob um cabeçalho, **em qualquer nível** (§5, docs/04 §7).
 * Clicar em "Varejo" pega as 3 linhas do Varejo; clicar em
 * "Varejo › 100k–500k" pega 1. Num eixo de 3 níveis, o nível 1 pega tudo sob o
 * prefixo de 2 códigos.
 */
export function coordsUnderHeader(
  view: SelectionView,
  role: AxisRole,
  prefixPath: string,
): Coord[] {
  const paths = new Set(tuplesUnder(axisOf(view, role).axis, prefixPath));
  return role === 'X' ? coordsWithin(view, paths, null) : coordsWithin(view, null, paths);
}

/**
 * Caminhos dos cabeçalhos de um nível, na ordem visual e sem repetição — os
 * mesmos `path` que `computeHeaderLayout` produz para aquela faixa (docs/04 §4).
 */
export function headerPathsAtLevel(
  view: SelectionView,
  role: AxisRole,
  level: number,
): string[] {
  const paths: string[] = [];
  let last: string | undefined;
  for (const tuple of axisOf(view, role).axis.tuples) {
    const path = pathPrefix(tuple, level + 1);
    if (path === last) continue;
    last = path;
    paths.push(path);
  }
  return paths;
}

/**
 * `Shift + clique em cabeçalho`: a faixa **do mesmo nível** entre dois
 * cabeçalhos, não um retângulo de células soltas. Estender de "Varejo" a
 * "Corporate" pega tudo, inclusive o Atacado no meio.
 */
export function headerRangeCoords(
  view: SelectionView,
  role: AxisRole,
  level: number,
  fromPath: string,
  toPath: string,
): Coord[] {
  const headerPaths = headerPathsAtLevel(view, role, level);
  const from = headerPaths.indexOf(fromPath);
  const to = headerPaths.indexOf(toPath);
  if (from < 0 || to < 0) return [];
  const range = headerPaths.slice(Math.min(from, to), Math.max(from, to) + 1);
  const tuples = new Set<string>();
  for (const path of range) {
    for (const tuple of tuplesUnder(axisOf(view, role).axis, path)) tuples.add(tuple);
  }
  return role === 'X' ? coordsWithin(view, tuples, null) : coordsWithin(view, null, tuples);
}

/**
 * Cabeçalho aceso: **todas** as suas combinações estão na seleção. Vale para
 * qualquer nível — se as 3 linhas de Varejo estão selecionadas, "Varejo"
 * acende. Cabeçalho sem nenhuma combinação (prefixo que não existe) nunca
 * acende.
 */
export function isHeaderFullySelected(
  view: SelectionView,
  role: AxisRole,
  prefixPath: string,
  selection: ReadonlySet<string>,
): boolean {
  const coords = coordsUnderHeader(view, role, prefixPath);
  if (coords.length === 0) return false;
  return coords.every((coord) => selection.has(toKey(coord)));
}
