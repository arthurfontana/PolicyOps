import { describe, expect, it } from 'vitest';
import type { Domain, Matrix, MatrixVersion, PolicyOpsDocument } from '@/core/document/schema';
import { EMPTY_DIFF_SUMMARY } from '@/core/diff/types';
import { planImport, type ImportPlan, type MatrixPlan } from '@/core/import/plan';
import {
  groupByLibraryChange,
  mergeCompatibilityChanges,
  mergeDomainChanges,
  planStructuralChanges,
  type StructuralPlan,
} from '@/core/import/structural';
import {
  cineminhaDocument,
  cineminhaProfile,
  excerptCsv,
  IDS,
  publishPlan,
  tableOf,
  T0,
} from './fixtures';

/**
 * `planStructuralChanges` — docs/12-carga-de-matrizes.md RN-06, CT-03, §7 (S25).
 */

const profile = cineminhaProfile();

function loadedDocument(): PolicyOpsDocument {
  const doc = cineminhaDocument();
  return publishPlan(doc, planImport(doc, tableOf(excerptCsv()), profile));
}

describe('planStructuralChanges — divergência de compatibilidade (o caso comum)', () => {
  it('não cria domínio quando o código já existe na variável — só falta o par de compatibilidade', () => {
    const doc = loadedDocument();
    // G6 usa SCORE_HVI4; R21 já é domínio de FAIXA_MODELO_ADICIONAL (R01–R25),
    // mas o mapa de compatibilidade só libera R01–R20 e R99 para SCORE_HVI4.
    const comR21 = `${excerptCsv().trimEnd()}\nG6;c.RISCO ALTO;HVI3;R01;HVI4;R21;15;15;15;15;15;15\n`;
    const plan = planImport(doc, tableOf(comR21), profile, { fileName: 'recorte.csv' });
    expect(plan.totals.structural).toBe(6);

    const structural = planStructuralChanges(doc, plan);
    expect(structural).toHaveLength(6);

    const first = structural[0]!;
    expect(first.domainChanges).toEqual([]);
    expect(first.compatibilityChanges).toHaveLength(1);
    expect(first.compatibilityChanges[0]).toMatchObject({
      parentVariableId: IDS.modelo,
      childVariableId: IDS.faixa,
      exists: true,
      addedPairs: [['SCORE_HVI4', 'R21']],
    });
    expect(first.resnapshot.Y).toBeDefined();
    expect(first.resnapshot.Y!.newCombinations).toBeGreaterThan(0);
    // A resolução nunca remove — critério de aceite da S25.
    expect(first.droppedCombinations).toBe(0);
    expect(first.lostCells).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cenário de domínio genuinamente novo
//
// `resolveImport` só deixa um valor de eixo passar quando o código já é
// domínio **publicado** da variável (RN-16) — então, pela esteira normal do
// assistente, `STRUCTURAL` nunca chega com um código que falte na biblioteca
// inteira (o passo 3, US-04, já teria bloqueado o plano com
// `IMPORT_UNMAPPED_VALUE` antes disso). O caminho de "domínio novo" existe
// para quando a matriz diverge por causa de tupla nova ainda assim — e é
// testado aqui construindo o `MatrixPlan` diretamente, sem depender de
// `resolveImport`, exatamente o que a função pura faz: olha `unknownTuples` e
// decide contra a biblioteca **atual**, nunca contra o arquivo.
// ---------------------------------------------------------------------------

function baseFaixaVariable(doc: PolicyOpsDocument) {
  return doc.variables.find((variable) => variable.id === IDS.faixa)!;
}

function matrixWithStaleAxis(doc: PolicyOpsDocument): { doc: PolicyOpsDocument; matrix: Matrix } {
  const faixa = baseFaixaVariable(doc);
  const published = faixa.versions.find((version) => version.state === 'PUBLISHED')!;
  const modelo = doc.variables.find((variable) => variable.id === IDS.modelo)!;
  const modeloPublished = modelo.versions.find((version) => version.state === 'PUBLISHED')!;

  const version: MatrixVersion = {
    id: 'MV_STALE____',
    number: 1,
    state: 'PUBLISHED',
    createdAt: T0,
    createdBy: 'Arthur',
    publishedAt: T0,
    publishedBy: 'Arthur',
    axes: {
      x: {
        role: 'X',
        levels: [
          {
            id: 'LX__________',
            variableId: IDS.hvi3,
            variableVersionId: IDS.hvi3V1,
            label: 'Score HVI3',
            domains: [{ code: 'R01', label: 'R01', position: 0 }],
          },
        ],
        tuples: ['R01'],
        derivedFrom: { compatibilityVersionIds: [] },
      },
      y: {
        role: 'Y',
        levels: [
          {
            id: 'LY0_________',
            variableId: IDS.modelo,
            variableVersionId: modeloPublished.id,
            label: 'Modelo adicional',
            domains: modeloPublished.domains,
          },
          {
            id: 'LY1_________',
            variableId: IDS.faixa,
            variableVersionId: published.id,
            // Snapshot deliberadamente sem R26: a matriz nasceu antes daquele
            // domínio existir em qualquer lugar da biblioteca.
            domains: published.domains.filter((domain) => domain.code !== 'R26'),
          },
        ],
        tuples: ['BHV_G1|R01'],
        derivedFrom: { compatibilityVersionIds: [IDS.compatV1] },
      },
    },
    cells: {},
  };

  const matrix: Matrix = {
    id: 'MTX_STALE___',
    projectId: IDS.project,
    code: 'MTZ_STALE',
    name: 'Matriz com eixo desatualizado',
    createdAt: T0,
    versions: [version],
  };

  return { doc: { ...doc, matrices: [...doc.matrices, matrix] }, matrix };
}

function structuralPlanFor(matrix: Matrix, unknownTuples: MatrixPlan['unknownTuples']): ImportPlan {
  const version = matrix.versions[0]!;
  const matrixPlan: MatrixPlan = {
    key: matrix.code,
    code: matrix.code,
    name: matrix.name,
    tags: [],
    status: 'STRUCTURAL',
    reason: 'teste',
    matrixId: matrix.id,
    baseVersionId: version.id,
    baseVersionNumber: version.number,
    combinations: version.axes.x.tuples.length * version.axes.y.tuples.length,
    suppressedCombinations: 0,
    changes: [],
    summary: { ...EMPTY_DIFF_SUMMARY },
    missingCombinations: [],
    unknownTuples,
  };
  return {
    planHash: 'test-hash',
    profileCode: profile.code,
    source: { rowCount: 1, contentHash: 'x' },
    matrices: [matrixPlan],
    libraryGaps: [],
    totals: {
      new: 0,
      changed: 0,
      unchanged: 0,
      structural: 1,
      absentInFile: 0,
      blocked: 0,
      archived: 0,
      cellsChanged: 0,
    },
    issues: [],
  };
}

describe('planStructuralChanges — domínio novo num modelo existente', () => {
  it('propõe o domínio novo com a versão de origem, e o resnapshot preserva as células antigas', () => {
    const { doc, matrix } = matrixWithStaleAxis(loadedDocument());
    const plan = structuralPlanFor(matrix, [{ path: 'BHV_G1|R26', role: 'Y', lines: [2] }]);

    const [structural] = planStructuralChanges(doc, plan);
    expect(structural).toBeDefined();
    expect(structural!.domainChanges).toHaveLength(1);
    expect(structural!.domainChanges[0]).toMatchObject({
      variableId: IDS.faixa,
      axis: 'Y',
      level: 1,
      fromVersionNumber: 1,
    });
    const codes = structural!.domainChanges[0]!.domains.map((domain: Domain) => domain.code);
    expect(codes).toEqual(['R26']);
    expect(structural!.compatibilityChanges).toHaveLength(1);
    expect(structural!.compatibilityChanges[0]!.addedPairs).toEqual([['BHV_G1', 'R26']]);
    expect(structural!.resnapshot.Y!.newCombinations).toBeGreaterThan(0);
    expect(structural!.droppedCombinations).toBe(0);
    expect(structural!.lostCells).toEqual([]);
  });
});

describe('planStructuralChanges — dois níveis afetados na mesma operação', () => {
  it('modelo novo no nível 0 do eixo Y produz domínio no nível 0 e par novo no nível 1', () => {
    const { doc, matrix } = matrixWithStaleAxis(loadedDocument());
    const plan = structuralPlanFor(matrix, [{ path: 'BHV_G2|R01', role: 'Y', lines: [3] }]);

    const [structural] = planStructuralChanges(doc, plan);
    expect(structural!.domainChanges).toHaveLength(1);
    expect(structural!.domainChanges[0]!.level).toBe(0);
    expect(structural!.domainChanges[0]!.domains.map((domain: Domain) => domain.code)).toEqual([
      'BHV_G2',
    ]);
    expect(structural!.compatibilityChanges).toHaveLength(1);
    expect(structural!.compatibilityChanges[0]!.addedPairs).toEqual([['BHV_G2', 'R01']]);
  });
});

describe('mergeDomainChanges e mergeCompatibilityChanges', () => {
  it('junta a mesma mudança de biblioteca pedida por duas matrizes sem duplicar domínio', () => {
    const { doc, matrix } = matrixWithStaleAxis(loadedDocument());
    const planA = structuralPlanFor(matrix, [{ path: 'BHV_G1|R26', role: 'Y', lines: [2] }]);
    const planB = structuralPlanFor(matrix, [{ path: 'BHV_G1|R26', role: 'Y', lines: [3] }]);
    const [a] = planStructuralChanges(doc, planA);
    const [b] = planStructuralChanges(doc, planB);

    const merged = mergeDomainChanges([a!, b!]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.domains).toHaveLength(1);

    const mergedCompat = mergeCompatibilityChanges([a!, b!]);
    expect(mergedCompat).toHaveLength(1);
    expect(mergedCompat[0]!.addedPairs).toEqual([['BHV_G1', 'R26']]);
  });

  it('groupByLibraryChange agrupa planos com a mesma assinatura', () => {
    const { doc, matrix } = matrixWithStaleAxis(loadedDocument());
    const planA = structuralPlanFor(matrix, [{ path: 'BHV_G1|R26', role: 'Y', lines: [2] }]);
    const planB = structuralPlanFor(matrix, [{ path: 'BHV_G1|R27', role: 'Y', lines: [3] }]);
    const [a] = planStructuralChanges(doc, planA);
    const [b] = planStructuralChanges(doc, planB);

    const sameTwice = groupByLibraryChange([a!, a!]);
    expect(sameTwice).toHaveLength(1);
    expect(sameTwice[0]).toHaveLength(2);

    const different: StructuralPlan[] = groupByLibraryChange([a!, b!]).flat();
    expect(different).toHaveLength(2);
    expect(groupByLibraryChange([a!, b!])).toHaveLength(2);
  });
});
