import { describe, expect, it } from 'vitest';
import { buildStructureRows } from '@/components/timeline/policy-structure-rows';
import { getPolicyAt } from '@/core/timeline/policy-at';
import { projetoGrande } from '../../core/document/large-policy-fixture';
import { IDS } from '../../core/versioning/fixtures';

/**
 * As linhas da aba Estrutura (docs/07 §10) sobre o projeto grande da S39 —
 * mesmo orçamento: abrir a data com 300 componentes e 102 matrizes tem de
 * caber em 500 ms, senão a pergunta de auditoria deixa de ser feita.
 */
describe('buildStructureRows — desempenho de abrir a data', () => {
  it('300 componentes e 102 matrizes em menos de 500 ms', () => {
    const document = projetoGrande();
    const at = new Date('2026-09-01T00:00:00.000Z');

    const started = performance.now();
    const rows = buildStructureRows(getPolicyAt(document, IDS.projectA, at), null);
    const elapsed = performance.now() - started;

    expect(rows.length).toBe(402);
    expect(elapsed).toBeLessThan(500);
  });

  it('a profundidade da linha é 0-based e o pai sabe que tem filhos', () => {
    const document = projetoGrande();
    const rows = buildStructureRows(
      getPolicyAt(document, IDS.projectA, new Date('2026-09-01T00:00:00.000Z')),
      null,
    );

    expect(rows.every((row) => row.depth >= 0)).toBe(true);
    // As seções a cada 20 componentes recebem os 19 seguintes como filhos.
    expect(rows.some((row) => row.hasChildren)).toBe(true);
  });
});
