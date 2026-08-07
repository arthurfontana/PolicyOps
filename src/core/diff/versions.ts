import type { Matrix, MatrixVersion, PolicyOpsDocument } from '../document/schema';
import { diffAxis } from './axes';
import { countStructuralCombinations, diffCells } from './cells';
import { buildLimitCatalog, summarizeChanges, summaryToText } from './semantics';
import { EMPTY_DIFF_SUMMARY, type VersionDiff, type VersionRef } from './types';

/**
 * O motor de diff entre duas versões de matriz — docs/05-regras-de-negocio.md §4.
 *
 * Este módulo **não** importa `versioning/lifecycle`: quem resolve ids é
 * `./index.ts`. A separação existe para que `publishVersion` possa gravar o
 * resumo semântico no payload de `VERSION_PUBLISHED` sem ciclo de importação.
 */

export type VersionSide = { matrix: Matrix; version: MatrixVersion };

/**
 * Os dois documentos de onde vêm catálogo e biblioteca de cada lado.
 *
 * Quase sempre são o mesmo documento. As exceções são reais: o conflito de
 * salvamento (docs/06 §5) compara uma versão do documento remoto com a
 * correspondente do meu, e cada lado precisa resolver os próprios rótulos e
 * valores de catálogo.
 */
export type DiffContext = { a: PolicyOpsDocument; b: PolicyOpsDocument };

export function versionRef(matrix: Matrix, version: MatrixVersion): VersionRef {
  const ref: VersionRef = {
    versionId: version.id,
    matrixId: matrix.id,
    matrixCode: matrix.code,
    matrixName: matrix.name,
    number: version.number,
    state: version.state,
    createdAt: version.createdAt,
  };
  if (version.effectiveFrom !== undefined) ref.effectiveFrom = version.effectiveFrom;
  if (version.effectiveTo !== undefined) ref.effectiveTo = version.effectiveTo;
  return ref;
}

/**
 * Compara duas versões. `a` é a base (a mais antiga), `b` a comparada.
 *
 * Comparar uma versão com ela mesma devolve diff vazio e `comparable: true`
 * (§4.4). Comparar versões de matrizes diferentes é permitido — e é o que
 * torna "PF × PJ" possível — desde que as pilhas de variáveis coincidam.
 */
export function diffVersionPair(
  context: DiffContext,
  a: VersionSide,
  b: VersionSide,
): VersionDiff {
  const axes = {
    x: diffAxis(context.a, context.b, a.version.axes.x, b.version.axes.x),
    y: diffAxis(context.a, context.b, a.version.axes.y, b.version.axes.y),
  };

  const refs = { a: versionRef(a.matrix, a.version), b: versionRef(b.matrix, b.version) };

  // Pilha de variáveis diferente em qualquer eixo: os caminhos das tuplas
  // passam a significar outra coisa e casar células por `xPath::yPath` seria
  // comparar coisas sem relação. Sem diff de células (§4.1).
  if (axes.x.levelsChanged || axes.y.levelsChanged) {
    return {
      ...refs,
      comparable: false,
      incomparableReason: 'DIFFERENT_LEVELS',
      axes,
      cells: [],
      summary: { ...EMPTY_DIFF_SUMMARY },
      summaryText: [],
    };
  }

  const cells = diffCells(a.version, b.version);
  const summary = summarizeChanges(
    cells,
    // Cada lado resolve o `numericValue` do próprio catálogo: no mesmo
    // documento é o mesmo mapa, e no conflito de salvamento não é.
    { before: buildLimitCatalog(context.a), after: buildLimitCatalog(context.b) },
    countStructuralCombinations(a.version, b.version),
  );

  return {
    ...refs,
    comparable: true,
    axes,
    cells,
    summary,
    summaryText: summaryToText(summary),
  };
}
