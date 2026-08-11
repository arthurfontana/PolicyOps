import { describe, expect, it } from 'vitest';
import { parseDelimitedTable } from '@/core/import/parse-table';
import { planImport } from '@/core/import/plan';
import { resolveImport } from '@/core/import/resolve';
import { applyImport } from '@/core/import/apply';
import { createCatalogItem } from '@/core/library/catalog';
import { apply, testCtx } from '../versioning/fixtures';
import type { PolicyOpsDocument } from '@/core/document/schema';
import type { Ctx } from '@/core/command';
import type { ImportPlan } from '@/core/import/plan';
import { cineminhaDocument, cineminhaProfile, fullCsv, publishPlan, tableOf } from './fixtures';

/**
 * Os orçamentos de docs/12-carga-de-matrizes.md §5.7, medidos sobre o arquivo
 * real (6.678 linhas × 6 desdobramentos = 40.068 células, 102 matrizes) e
 * sobre uma tabela sintética de 20.000 × 30.
 *
 * Cada medição roda uma vez a mais antes de valer: o que interessa é o custo do
 * algoritmo, não o do primeiro toque no código.
 */

const profile = cineminhaProfile();

function syntheticCsv(rows: number, columns: number): string {
  const header = Array.from({ length: columns }, (_unused, index) => `COL_${index}`).join(';');
  const line = Array.from({ length: columns }, (_unused, index) => `valor ${index}`).join(';');
  return [header, ...Array.from({ length: rows }, () => line)].join('\n');
}

describe('desempenho da carga (§5.7)', () => {
  it('lê 20.000 linhas × 30 colunas em menos de 300 ms', () => {
    const text = syntheticCsv(20_000, 30);
    parseDelimitedTable(text);

    const started = performance.now();
    const parsed = parseDelimitedTable(text);
    const elapsed = performance.now() - started;

    expect(parsed.rows).toHaveLength(20_000);
    expect(parsed.header).toHaveLength(30);
    expect(parsed.errors).toEqual([]);
    expect(elapsed).toBeLessThan(300);
  });

  it('resolve 6.678 linhas em 40.068 células em menos de 400 ms', () => {
    const doc = cineminhaDocument();
    const table = tableOf(fullCsv());
    resolveImport(doc, table, profile);

    const started = performance.now();
    const resolved = resolveImport(doc, table, profile);
    const elapsed = performance.now() - started;

    expect(resolved.rows).toHaveLength(40_068);
    expect(resolved.issues).toEqual([]);
    expect(elapsed).toBeLessThan(400);
  });

  it('planeja 102 matrizes novas em menos de 1 s', () => {
    const doc = cineminhaDocument();
    const table = tableOf(fullCsv());
    planImport(doc, table, profile);

    const started = performance.now();
    const plan = planImport(doc, table, profile, { fileName: 'CINEMINHA_20260708.csv' });
    const elapsed = performance.now() - started;

    expect(plan.matrices).toHaveLength(102);
    expect(plan.totals.cellsChanged).toBe(40_068);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('compara 102 matrizes publicadas em menos de 1 s', () => {
    const doc = cineminhaDocument();
    const table = tableOf(fullCsv());
    const publicado = publishPlan(doc, planImport(doc, table, profile));
    planImport(publicado, table, profile);

    const started = performance.now();
    const plan = planImport(publicado, table, profile);
    const elapsed = performance.now() - started;

    expect(plan.totals.unchanged).toBe(102);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('aplica a carga de 102 matrizes em menos de 2 s', () => {
    const ctx = testCtx();
    const table = tableOf(fullCsv());
    const doc = withTagCatalog(cineminhaDocument(), ctx, planImport(cineminhaDocument(), table, profile));
    const plan = planImport(doc, table, profile, { fileName: 'CINEMINHA_20260708.csv' });

    const command = applyImport({
      profile,
      table,
      fileName: 'CINEMINHA_20260708.csv',
      planHash: plan.planHash,
      selectedKeys: plan.matrices.map((entry) => entry.key),
      notes: 'Carga de desempenho do arquivo completo',
    });

    const started = performance.now();
    const applied = apply(doc, ctx, command);
    const elapsed = performance.now() - started;

    expect(applied.document.matrices).toHaveLength(102);
    expect(applied.data.createdDrafts).toHaveLength(102);
    expect(elapsed).toBeLessThan(2_000);
  });
});

/** As 25 tags do arquivo completo, criadas pelo comando normal (RN-17). */
function withTagCatalog(doc: PolicyOpsDocument, ctx: Ctx, plan: ImportPlan): PolicyOpsDocument {
  let working = doc;
  for (const code of new Set(plan.matrices.flatMap((entry) => entry.tags))) {
    working = apply(working, ctx, createCatalogItem({ kind: 'TAG', code, label: code })).document;
  }
  return working;
}
