import { describe, expect, it } from 'vitest';
import { diffVersions } from '@/core/diff';
import type { Cell, Domain, PolicyOpsDocument } from '@/core/document/schema';
import { IDS } from '../versioning/fixtures';
import { axisOf, documentWith, versionOf, V1, V2 } from './fixtures';

/**
 * Orçamento da S14: duas versões de 1.500 combinações em menos de 150 ms.
 *
 * O casamento é por chave, em memória, numa passada sobre a união dos dois
 * mapas de células — nunca sobre o produto cartesiano dos eixos.
 */

const X_COUNT = 50;
const Y_COUNT = 30;
const COMBINATIONS = X_COUNT * Y_COUNT; // 1.500

function syntheticDomains(prefix: string, count: number): Domain[] {
  return Array.from({ length: count }, (_unused, position) => ({
    code: `${prefix}${position}`,
    label: `${prefix} ${position}`,
    position,
  }));
}

/** Duas versões de 1.500 combinações, com `changed` células diferentes. */
function syntheticDocument(changed: number): PolicyOpsDocument {
  const xDomains = syntheticDomains('X', X_COUNT);
  const yDomains = syntheticDomains('Y', Y_COUNT);
  const xAxis = () =>
    axisOf('X', {
      levels: [{ variableId: IDS.bigX, variableVersionId: IDS.bigXV1, label: 'X', domains: xDomains }],
      tuples: xDomains.map((domain) => domain.code),
    });
  const yAxis = () =>
    axisOf('Y', {
      levels: [{ variableId: IDS.bigY, variableVersionId: IDS.bigYV1, label: 'Y', domains: yDomains }],
      tuples: yDomains.map((domain) => domain.code),
    });

  const cellsA: Record<string, Cell> = {};
  const cellsB: Record<string, Cell> = {};
  let index = 0;
  for (const y of yDomains) {
    for (const x of xDomains) {
      const key = `${x.code}::${y.code}`;
      cellsA[key] = { decision: 'REPROVADO', limit: 'LIM_1000', offer: 'OFERTA_A' };
      cellsB[key] =
        index < changed
          ? { decision: 'APROVADO', limit: 'LIM_1000', offer: 'OFERTA_B', limitOverride: '2500' }
          : { decision: 'REPROVADO', limit: 'LIM_1000', offer: 'OFERTA_A' };
      index += 1;
    }
  }

  return documentWith(
    versionOf(V1, 1, { x: xAxis(), y: yAxis() }, cellsA),
    versionOf(V2, 2, { x: xAxis(), y: yAxis() }, cellsB),
  );
}

describe('desempenho do diff', () => {
  it(`compara duas versões de ${COMBINATIONS} combinações em menos de 150 ms`, () => {
    const doc = syntheticDocument(400);
    // Uma execução de aquecimento tira o custo de JIT da medição — o que
    // interessa é o custo do casamento, não o do primeiro toque no código.
    diffVersions(doc, V1, V2);

    const started = performance.now();
    const diff = diffVersions(doc, V1, V2);
    const elapsed = performance.now() - started;

    expect(diff.cells).toHaveLength(400);
    expect(diff.summary.cellsOpened).toBe(400);
    expect(diff.summary.offersChanged).toBe(400);
    expect(diff.summary.limitsIncreased).toBe(400);
    expect(elapsed).toBeLessThan(150);
  });

  it('não degrada quando todas as 1.500 combinações mudam', () => {
    const doc = syntheticDocument(COMBINATIONS);
    diffVersions(doc, V1, V2);

    const started = performance.now();
    const diff = diffVersions(doc, V1, V2);
    const elapsed = performance.now() - started;

    expect(diff.cells).toHaveLength(COMBINATIONS);
    expect(elapsed).toBeLessThan(150);
  });

  it('o documento sintético é mesmo do tamanho anunciado', () => {
    const doc = syntheticDocument(0);
    const version = doc.matrices[0]!.versions[0]!;
    expect(version.axes.x.tuples.length * version.axes.y.tuples.length).toBe(COMBINATIONS);
    expect(Object.keys(version.cells)).toHaveLength(COMBINATIONS);
  });
});
