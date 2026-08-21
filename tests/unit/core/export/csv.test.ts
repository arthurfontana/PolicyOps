import { describe, expect, it } from 'vitest';
import { csvFileName, exportVersionCsv } from '@/core/export/csv';
import { applyCellPatch } from '@/core/versioning/cells';
import { locateMatrix, publishVersion } from '@/core/versioning/lifecycle';
import { apply, baseDocument, createTestMatrix, fillAllCells, testCtx } from '../versioning/fixtures';

/**
 * docs/08-camada-de-comandos.md §5: uma linha por combinação, uma coluna por
 * nível de cada eixo, `;`, decimal com vírgula, UTF-8 com BOM.
 */

function publishedMatrix() {
  const ctx = testCtx();
  const created = createTestMatrix(baseDocument(), ctx);
  let doc = fillAllCells(created.document, ctx, created.data.versionId);

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
      patch: { coords: [{ xPath: 'R2', yPath: 'ALTO' }], set: { limitOverride: '2500.50', note: 'Caso especial; com ponto e vírgula.' } },
    }),
  ).document;
  doc = apply(doc, ctx, publishVersion({ versionId: created.data.versionId, notes: 'Publicação inicial.' })).document;

  return { document: doc, matrixId: created.data.matrixId, versionId: created.data.versionId };
}

/**
 * Rascunho com uma combinação deliberadamente sem decisão — `version/publish`
 * exige tudo preenchido (`UNSET_CELLS_REMAIN`), então essa fixture fica em
 * `DRAFT` só para provar a linha vazia no CSV.
 */
function draftMatrixWithPendingCell() {
  const ctx = testCtx();
  const created = createTestMatrix(baseDocument(), ctx);
  const doc = fillAllCells(created.document, ctx, created.data.versionId);
  const cleared = apply(
    doc,
    ctx,
    applyCellPatch({
      versionId: created.data.versionId,
      patch: { coords: [{ xPath: 'R3', yPath: 'ALTO' }], set: { decision: null, offer: null, limit: null } },
    }),
  ).document;

  return { document: cleared, matrixId: created.data.matrixId, versionId: created.data.versionId };
}

function parseCsv(csv: string): string[][] {
  const withoutBom = csv.replace(/^\uFEFF/, '');
  return withoutBom
    .trimEnd()
    .split('\r\n')
    .map((line) => {
      // Parser simples suficiente para os testes: aspas só aparecem quando há `;`, `"` ou quebra de linha.
      const fields: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (inQuotes) {
          if (char === '"' && line[i + 1] === '"') {
            current += '"';
            i += 1;
          } else if (char === '"') {
            inQuotes = false;
          } else {
            current += char;
          }
        } else if (char === '"') {
          inQuotes = true;
        } else if (char === ';') {
          fields.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      fields.push(current);
      return fields;
    });
}

describe('exportVersionCsv', () => {
  it('começa com BOM UTF-8', () => {
    const { document, matrixId, versionId } = publishedMatrix();
    const { matrix } = locateMatrix(document, matrixId);
    const version = matrix.versions.find((candidate) => candidate.id === versionId)!;
    const csv = exportVersionCsv(document, version);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('tem uma coluna por nível de cada eixo, com o code da variável no cabeçalho', () => {
    const { document, matrixId, versionId } = publishedMatrix();
    const { matrix } = locateMatrix(document, matrixId);
    const version = matrix.versions.find((candidate) => candidate.id === versionId)!;
    const [header] = parseCsv(exportVersionCsv(document, version));
    expect(header).toEqual([
      'x_SCORE',
      'y_RESTRITIVO',
      'decisao',
      'oferta',
      'limite',
      'limite_valor',
      'limite_minimo',
      'limite_maximo',
      'cor',
      'observacao',
    ]);
  });

  it('tem uma linha por combinação (não só por célula preenchida)', () => {
    const { document, matrixId, versionId } = publishedMatrix();
    const { matrix } = locateMatrix(document, matrixId);
    const version = matrix.versions.find((candidate) => candidate.id === versionId)!;
    const rows = parseCsv(exportVersionCsv(document, version));
    // cabeçalho + 3 (SCORE) × 2 (RESTRITIVO) = 6 combinações.
    expect(rows).toHaveLength(7);
  });

  it('usa o rótulo do domínio, não o code, nas colunas de eixo', () => {
    const { document, matrixId, versionId } = publishedMatrix();
    const { matrix } = locateMatrix(document, matrixId);
    const version = matrix.versions.find((candidate) => candidate.id === versionId)!;
    const rows = parseCsv(exportVersionCsv(document, version));
    const row = rows.find((fields) => fields[0] === 'Rótulo R1' && fields[1] === 'Rótulo SEM')!;
    expect(row).toBeDefined();
  });

  it('decisão e oferta pelo rótulo do catálogo; limite pelo code; limite_valor com decimal em vírgula', () => {
    const { document, matrixId, versionId } = publishedMatrix();
    const { matrix } = locateMatrix(document, matrixId);
    const version = matrix.versions.find((candidate) => candidate.id === versionId)!;
    const rows = parseCsv(exportVersionCsv(document, version));

    const withLimit = rows.find((fields) => fields[0] === 'Rótulo R1' && fields[1] === 'Rótulo SEM')!;
    expect(withLimit[2]).toBe('Aprovado');
    expect(withLimit[4]).toBe('LIM_1000');
    expect(withLimit[5]).toBe('1000');

    const withOverride = rows.find((fields) => fields[0] === 'Rótulo R2' && fields[1] === 'Rótulo ALTO')!;
    expect(withOverride[5]).toBe('2500,50');
    // A observação tinha `;` — precisa ter sobrevivido ao parse com aspas.
    expect(withOverride[9]).toBe('Caso especial; com ponto e vírgula.');
  });

  it('combinação pendente vira linha com os campos de decisão vazios', () => {
    const { document, matrixId, versionId } = draftMatrixWithPendingCell();
    const { matrix } = locateMatrix(document, matrixId);
    const version = matrix.versions.find((candidate) => candidate.id === versionId)!;
    const rows = parseCsv(exportVersionCsv(document, version));
    const pending = rows.find((fields) => fields[0] === 'Rótulo R3' && fields[1] === 'Rótulo ALTO')!;
    expect(pending.slice(2)).toEqual(['', '', '', '', '', '', '', '']);
  });
});

describe('csvFileName', () => {
  it('segue {matrixCode}_v{n}_{aaaammdd}.csv', () => {
    expect(csvFileName('MTZ_LIMITE_PJ', 12, new Date('2026-03-05T00:00:00.000Z'))).toBe(
      'MTZ_LIMITE_PJ_v12_20260305.csv',
    );
  });
});
