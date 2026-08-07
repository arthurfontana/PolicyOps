import { describe, expect, it } from 'vitest';
import { exportPortfolioCanonical, exportVersionCanonical } from '@/core/export/canonical';
import { applyCellPatch } from '@/core/versioning/cells';
import { locateMatrix, publishVersion } from '@/core/versioning/lifecycle';
import { apply, baseDocument, createTestMatrix, fillAllCells, IDS, testCtx } from '../versioning/fixtures';

/**
 * Testes da S15 (docs/prompts/S15-vigencia-por-data.md): "Exportação produz
 * o formato canônico exato, com decimais como string." — docs/08 §5.
 */

function publishedMatrix() {
  const ctx = testCtx();
  const created = createTestMatrix(baseDocument(), ctx);
  let doc = fillAllCells(created.document, ctx, created.data.versionId);

  // Uma célula com `limit` do catálogo (decimal vem do `CatalogItem`) e outra
  // com `limitOverride` (decimal explícito na célula) — os dois caminhos de
  // `limitValue` no canônico.
  doc = apply(
    doc,
    ctx,
    applyCellPatch({
      versionId: created.data.versionId,
      patch: { coords: [{ xPath: 'R1', yPath: 'SEM' }], set: { limit: 'LIM_1000' } },
    }),
  ).document;
  doc = apply(
    doc,
    ctx,
    applyCellPatch({
      versionId: created.data.versionId,
      patch: { coords: [{ xPath: 'R2', yPath: 'ALTO' }], set: { limitOverride: '2500.50', note: 'Caso especial.' } },
    }),
  ).document;

  doc = apply(
    doc,
    ctx,
    publishVersion({ versionId: created.data.versionId, notes: 'Publicação inicial.' }),
  ).document;

  return { document: doc, matrixId: created.data.matrixId, versionId: created.data.versionId };
}

describe('exportVersionCanonical', () => {
  it('produz o formato canônico exato de docs/08 §5, com decimais como string', () => {
    const { document, matrixId, versionId } = publishedMatrix();
    const { matrix } = locateMatrix(document, matrixId);
    const canonicalVersion = matrix.versions.find((candidate) => candidate.id === versionId)!;

    const canonical = exportVersionCanonical(document, matrix, canonicalVersion);

    expect(canonical.schemaVersion).toBe(1);
    expect(canonical.matrix).toEqual({ code: 'MTZ_A', name: 'Matriz MTZ_A', project: 'PROJ_A' });
    expect(canonical.version.number).toBe(1);
    expect(canonical.version.state).toBe('PUBLISHED');
    expect(canonical.version.effectiveTo).toBeNull();
    expect(typeof canonical.version.effectiveFrom).toBe('string');

    expect(canonical.axes.x).toEqual({ levels: [{ variable: 'SCORE', variableVersion: 1 }], tuples: ['R1', 'R2', 'R3'] });
    expect(canonical.axes.y).toEqual({
      levels: [{ variable: 'RESTRITIVO', variableVersion: 1 }],
      tuples: ['SEM', 'ALTO'],
    });

    const withLimit = canonical.cells.find((cell) => cell.x === 'R1' && cell.y === 'SEM')!;
    expect(withLimit.decision).toBe('APROVADO');
    expect(withLimit.limit).toBe('LIM_1000');
    expect(withLimit.limitValue).toBe('1000');
    expect(typeof withLimit.limitValue).toBe('string');

    const withOverride = canonical.cells.find((cell) => cell.x === 'R2' && cell.y === 'ALTO')!;
    expect(withOverride.limitValue).toBe('2500.50');
    expect(typeof withOverride.limitValue).toBe('string');
    expect(withOverride.note).toBe('Caso especial.');
    // `limit` não foi definido nessa célula — a chave fica ausente, não `undefined` gravado.
    expect('limit' in withOverride).toBe(false);

    // Todas as 6 combinações têm decisão (fillAllCells) — nenhuma fica de fora.
    expect(canonical.cells).toHaveLength(6);
  });

  it('omite campos ausentes da célula em vez de gravar `undefined`', () => {
    const { document, matrixId, versionId } = publishedMatrix();
    const { matrix } = locateMatrix(document, matrixId);
    const version = matrix.versions.find((candidate) => candidate.id === versionId)!;
    const canonical = exportVersionCanonical(document, matrix, version);

    const plain = canonical.cells.find((cell) => cell.x === 'R3' && cell.y === 'SEM')!;
    expect(Object.keys(plain).sort()).toEqual(['decision', 'x', 'y']);
  });
});

describe('exportPortfolioCanonical', () => {
  it('exporta todas as matrizes vigentes do projeto na data, e ignora as que ainda não existiam', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const filled = fillAllCells(created.document, ctx, created.data.versionId);
    const document = apply(
      filled,
      ctx,
      publishVersion({ versionId: created.data.versionId, notes: 'Publicação inicial.' }),
    ).document;

    const at = ctx.now();
    const exported = exportPortfolioCanonical(document, IDS.projectA, at);
    expect(exported).toHaveLength(1);
    expect(exported[0]!.matrix.code).toBe('MTZ_A');

    // Um instante antes da matriz existir: nada a exportar.
    const before = new Date(at.getTime() - 1);
    expect(exportPortfolioCanonical(document, IDS.projectA, before)).toEqual([]);
  });
});
