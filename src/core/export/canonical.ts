import { decodeCellKey } from '../axes/paths';
import type { Axis, Matrix, MatrixVersion, PolicyOpsDocument } from '../document/schema';
import { getPortfolioAt } from '../queries';
import { exportFileName } from './filename';

/**
 * Formato canônico de exportação — docs/08-camada-de-comandos.md §5.
 *
 * Estável e versionado, base de uma futura importação: é o artefato que se
 * manda para auditoria ou se confere contra o motor de crédito. Os nomes de
 * campo seguem o documento normativo literalmente — nenhuma liberdade de
 * nomenclatura aqui.
 */

export const CANONICAL_EXPORT_SCHEMA_VERSION = 1 as const;

/** `{matrixCode}_v{n}_{aaaammdd}.json` — mesmo esquema de nome do CSV (docs/08 §5). */
export function canonicalFileName(matrixCode: string, versionNumber: number, at: Date = new Date()): string {
  return exportFileName(matrixCode, versionNumber, 'json', at);
}

export type CanonicalAxisLevel = { variable: string; variableVersion: number };

export type CanonicalCell = {
  x: string;
  y: string;
  decision?: string;
  offer?: string;
  limit?: string;
  /** Sempre string — decimal nunca vira `number` (docs/03 §1). */
  limitValue?: string;
  /** Faixa — modo alternativo a `limit`/`limitValue`. */
  limitMin?: string;
  limitMax?: string;
  color?: string;
  note?: string;
};

export type CanonicalExport = {
  schemaVersion: 1;
  matrix: { code: string; name: string; project: string };
  version: {
    number: number;
    state: 'PUBLISHED' | 'SUPERSEDED';
    effectiveFrom: string;
    effectiveTo: string | null;
  };
  axes: {
    x: { levels: CanonicalAxisLevel[]; tuples: string[] };
    y: { levels: CanonicalAxisLevel[]; tuples: string[] };
  };
  cells: CanonicalCell[];
};

function axisLevelsOf(doc: PolicyOpsDocument, axis: Axis): CanonicalAxisLevel[] {
  return axis.levels.map((level) => {
    const variable = doc.variables.find((candidate) => candidate.id === level.variableId);
    const variableVersion = variable?.versions.find(
      (candidate) => candidate.id === level.variableVersionId,
    );
    return {
      variable: variable?.code ?? level.variableId,
      variableVersion: variableVersion?.number ?? 0,
    };
  });
}

/** Ordem estável: pela posição das tuplas nos eixos da própria versão, X depois Y. */
function canonicalCells(doc: PolicyOpsDocument, version: MatrixVersion): CanonicalCell[] {
  const limitByCode = new Map(
    doc.catalog.filter((item) => item.kind === 'LIMIT').map((item) => [item.code, item] as const),
  );
  const xIndex = new Map(version.axes.x.tuples.map((path, index) => [path, index] as const));
  const yIndex = new Map(version.axes.y.tuples.map((path, index) => [path, index] as const));

  return Object.entries(version.cells)
    .map(([key, cell]) => {
      const { xPath, yPath } = decodeCellKey(key);
      const canonical: CanonicalCell = { x: xPath, y: yPath };
      if (cell.decision !== undefined) canonical.decision = cell.decision;
      if (cell.offer !== undefined) canonical.offer = cell.offer;
      if (cell.limit !== undefined) canonical.limit = cell.limit;
      const limitValue = cell.limitOverride ?? limitByCode.get(cell.limit ?? '')?.numericValue;
      if (limitValue !== undefined) canonical.limitValue = limitValue;
      if (cell.limitMin !== undefined) canonical.limitMin = cell.limitMin;
      if (cell.limitMax !== undefined) canonical.limitMax = cell.limitMax;
      if (cell.color !== undefined) canonical.color = cell.color;
      if (cell.note !== undefined) canonical.note = cell.note;
      return canonical;
    })
    .sort((a, b) => {
      const byX = (xIndex.get(a.x) ?? 0) - (xIndex.get(b.x) ?? 0);
      return byX !== 0 ? byX : (yIndex.get(a.y) ?? 0) - (yIndex.get(b.y) ?? 0);
    });
}

/** O canônico de uma única versão — a unidade que docs/08 §5 descreve. */
export function exportVersionCanonical(
  doc: PolicyOpsDocument,
  matrix: Matrix,
  version: MatrixVersion,
): CanonicalExport {
  const project = doc.projects.find((candidate) => candidate.id === matrix.projectId);
  return {
    schemaVersion: CANONICAL_EXPORT_SCHEMA_VERSION,
    matrix: { code: matrix.code, name: matrix.name, project: project?.code ?? matrix.projectId },
    version: {
      number: version.number,
      state: version.state as 'PUBLISHED' | 'SUPERSEDED',
      effectiveFrom: version.effectiveFrom ?? '',
      effectiveTo: version.effectiveTo ?? null,
    },
    axes: {
      x: { levels: axisLevelsOf(doc, version.axes.x), tuples: version.axes.x.tuples },
      y: { levels: axisLevelsOf(doc, version.axes.y), tuples: version.axes.y.tuples },
    },
    cells: canonicalCells(doc, version),
  };
}

/**
 * O canônico de todas as matrizes de um projeto vigentes em `at` — o botão
 * "Exportar esta visão" da tela de vigência (docs/prompts/S15, item 4).
 * Matrizes sem versão vigente na data (ainda não existiam) ficam de fora do
 * array: não há o que exportar para elas.
 */
export function exportPortfolioCanonical(
  doc: PolicyOpsDocument,
  projectId: string,
  at: Date,
): CanonicalExport[] {
  const result: CanonicalExport[] = [];
  for (const entry of getPortfolioAt(doc, projectId, at)) {
    if (entry.version === null) continue;
    result.push(exportVersionCanonical(doc, entry.matrix, entry.version));
  }
  return result;
}
