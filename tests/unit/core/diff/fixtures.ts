import type {
  Axis,
  AxisLevel,
  Cell,
  Domain,
  Matrix,
  MatrixVersion,
  PolicyOpsDocument,
} from '@/core/document/schema';
import { baseDocument, fixedId, IDS, RESTRITIVO_DOMAINS, SCORE_DOMAINS, T0 } from '../versioning/fixtures';

/**
 * Fixtures do motor de diff.
 *
 * Aqui as versões são montadas **à mão**, e não pelos comandos: o diff de §4.1
 * é sobre estrutura (pilha de níveis, pins, domínios, tuplas), e chegar a cada
 * combinação estrutural pelo ciclo de vida normal daria voltas enormes para
 * testar exatamente a mesma entrada.
 */

export type AxisSpec = {
  levels: Array<{ variableId: string; variableVersionId: string; label: string; domains: Domain[] }>;
  tuples: string[];
};

export function axisOf(role: Axis['role'], spec: AxisSpec): Axis {
  const levels: AxisLevel[] = spec.levels.map((level, index) => ({
    id: fixedId(`${role.toLowerCase()}lvl${index}`),
    variableId: level.variableId,
    variableVersionId: level.variableVersionId,
    label: level.label,
    domains: level.domains,
  }));
  return { role, levels, tuples: spec.tuples, derivedFrom: { compatibilityVersionIds: [] } };
}

/** X = SCORE (R1..R3), Y = RESTRITIVO (SEM, ALTO) — 6 combinações. */
export function scoreAxis(tuples = SCORE_DOMAINS.map((domain) => domain.code)): Axis {
  return axisOf('X', {
    levels: [
      {
        variableId: IDS.score,
        variableVersionId: IDS.scoreV1,
        label: 'Score',
        domains: SCORE_DOMAINS,
      },
    ],
    tuples,
  });
}

export function restritivoAxis(
  tuples = RESTRITIVO_DOMAINS.map((domain) => domain.code),
): Axis {
  return axisOf('Y', {
    levels: [
      {
        variableId: IDS.restritivo,
        variableVersionId: IDS.restritivoV1,
        label: 'Restritivo',
        domains: RESTRITIVO_DOMAINS,
      },
    ],
    tuples,
  });
}

export function versionOf(
  id: string,
  number: number,
  axes: { x: Axis; y: Axis },
  cells: Record<string, Cell>,
): MatrixVersion {
  return {
    id,
    number,
    state: number === 1 ? 'SUPERSEDED' : 'DRAFT',
    createdAt: T0,
    createdBy: 'Equipe',
    axes,
    cells,
  };
}

export const V1 = fixedId('v1');
export const V2 = fixedId('v2');

/**
 * Documento com uma matriz de duas versões, `v1` e `v2`, exatamente como
 * descritas. É a base de quase todo teste deste diretório.
 */
export function documentWith(
  v1: MatrixVersion,
  v2: MatrixVersion,
  extraMatrices: Matrix[] = [],
): PolicyOpsDocument {
  const doc = baseDocument();
  const matrix: Matrix = {
    id: fixedId('mtz'),
    projectId: IDS.projectA,
    code: 'MTZ_DIFF',
    name: 'Matriz de diff',
    createdAt: T0,
    versions: [v1, v2],
  };
  return { ...doc, matrices: [matrix, ...extraMatrices] };
}

/** Duas versões idênticas de 6 combinações, todas `APROVADO`. */
export function twoIdenticalVersions(): PolicyOpsDocument {
  const cells: Record<string, Cell> = {};
  for (const x of SCORE_DOMAINS) {
    for (const y of RESTRITIVO_DOMAINS) cells[`${x.code}::${y.code}`] = { decision: 'APROVADO' };
  }
  return documentWith(
    versionOf(V1, 1, { x: scoreAxis(), y: restritivoAxis() }, structuredClone(cells)),
    versionOf(V2, 2, { x: scoreAxis(), y: restritivoAxis() }, structuredClone(cells)),
  );
}

/**
 * Duas versões iguais em tudo, menos a célula `R1::SEM`, que em v2 recebe
 * `after`. É o atalho dos testes de métrica: uma célula, uma mudança.
 */
export function oneCellChanged(before: Cell, after: Cell): PolicyOpsDocument {
  const cellsA: Record<string, Cell> = { 'R1::SEM': before };
  const cellsB: Record<string, Cell> = { 'R1::SEM': after };
  return documentWith(
    versionOf(V1, 1, { x: scoreAxis(), y: restritivoAxis() }, cellsA),
    versionOf(V2, 2, { x: scoreAxis(), y: restritivoAxis() }, cellsB),
  );
}
