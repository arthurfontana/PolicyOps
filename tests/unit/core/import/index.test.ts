import { describe, expect, it } from 'vitest';
import * as engine from '@/core/import';

/**
 * O barril de `src/core/import/` é a porta de entrada do motor para o
 * assistente (S22) e para a aplicação (S24) — este teste garante que ela
 * continua exportando as sete peças de docs/12-carga-de-matrizes.md §5.1.
 */
describe('src/core/import', () => {
  it('exporta o motor inteiro', () => {
    expect(typeof engine.parseDelimitedTable).toBe('function');
    expect(typeof engine.validateProfile).toBe('function');
    expect(typeof engine.matchImportProfile).toBe('function');
    expect(typeof engine.normalizeValue).toBe('function');
    expect(typeof engine.resolveImport).toBe('function');
    expect(typeof engine.planImport).toBe('function');
    expect(typeof engine.computeLibraryGaps).toBe('function');
    expect(typeof engine.hashText).toBe('function');
    expect(typeof engine.importIssue).toBe('function');
    expect(engine.IMPORT_ERROR_CODES).toContain('IMPORT_UNMAPPED_VALUE');
  });
});
