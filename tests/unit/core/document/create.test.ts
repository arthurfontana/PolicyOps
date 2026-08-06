import { describe, expect, it } from 'vitest';
import { createEmptyDocument, createSampleDocument } from '@/core/document/create';
import { validateDocument } from '@/core/document/validate';

describe('createEmptyDocument', () => {
  it('cria um documento vazio e válido', () => {
    const doc = createEmptyDocument('Novo documento', 'Arthur');
    const result = validateDocument(doc);
    expect(result.ok).toBe(true);
    expect(doc.variables).toEqual([]);
    expect(doc.matrices).toEqual([]);
    expect(doc.meta.savedAt).toBeNull();
    expect(doc.meta.savedBy).toBeNull();
  });
});

describe('createSampleDocument', () => {
  it('passa em validateDocument sem nenhum ERROR', () => {
    const doc = createSampleDocument();
    const result = validateDocument(doc);
    if (!result.ok) {
      console.error(JSON.stringify(result.issues, null, 2));
    }
    expect(result.ok).toBe(true);
  });

  it('contém as 6 variáveis, 1 regra de compatibilidade, 2 projetos, 2 matrizes', () => {
    const doc = createSampleDocument();
    expect(doc.variables).toHaveLength(6);
    expect(doc.compatibility).toHaveLength(1);
    expect(doc.projects).toHaveLength(2);
    expect(doc.matrices).toHaveLength(2);
  });

  it('MTZ_LIMITE_PF tem 24 combinações, v1 PUBLISHED e v2 DRAFT com 3 células alteradas', () => {
    const doc = createSampleDocument();
    const pf = doc.matrices.find((m) => m.code === 'MTZ_LIMITE_PF')!;
    expect(pf.versions).toHaveLength(2);
    const v1 = pf.versions.find((v) => v.number === 1)!;
    const v2 = pf.versions.find((v) => v.number === 2)!;
    expect(v1.state).toBe('PUBLISHED');
    expect(v2.state).toBe('DRAFT');
    expect(v1.axes.x.tuples.length * v1.axes.y.tuples.length).toBe(24);

    const changed = Object.keys(v1.cells).filter((key) => {
      const before = v1.cells[key];
      const after = v2.cells[key];
      return JSON.stringify(before) !== JSON.stringify(after);
    });
    expect(changed).toHaveLength(3);
  });

  it('MTZ_LIMITE_PJ tem eixo Y de 2 níveis, 8 tuplas em Y, 48 combinações, v1 PUBLISHED', () => {
    const doc = createSampleDocument();
    const pj = doc.matrices.find((m) => m.code === 'MTZ_LIMITE_PJ')!;
    expect(pj.versions).toHaveLength(1);
    const v1 = pj.versions[0]!;
    expect(v1.state).toBe('PUBLISHED');
    expect(v1.axes.y.levels).toHaveLength(2);
    expect(v1.axes.y.tuples).toHaveLength(8);
    expect(v1.axes.x.tuples.length * v1.axes.y.tuples.length).toBe(48);
    expect(Object.keys(v1.cells)).toHaveLength(48);
  });
});
