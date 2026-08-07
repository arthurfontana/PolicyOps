import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CatalogItem, CompatibilityRule, Domain, PolicyOpsDocument, Variable } from '@/core/document/schema';
import {
  checkI1,
  checkI2,
  checkI3,
  checkI4,
  checkI5,
  checkI6,
  checkI7,
  checkI8,
  checkI9,
  checkI10,
  checkI11,
  checkI12,
  checkI13,
  checkI14,
  checkI15,
  checkI16,
  checkI17,
  checkI18,
  checkI19,
  checkPositions,
  validateDocument,
} from '@/core/document/validate';

function loadFixture(name: string): PolicyOpsDocument {
  const path = fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8')) as PolicyOpsDocument;
}

function base(): PolicyOpsDocument {
  return structuredClone(loadFixture('valid-base.json'));
}

describe('validateDocument — casos gerais', () => {
  it('aceita a base válida sem nenhum ERROR', () => {
    const result = validateDocument(base());
    expect(result.ok).toBe(true);
  });

  it('rejeita entrada fora do formato do schema (nem chega às invariantes)', () => {
    const result = validateDocument({ nada: 'a ver' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.invariant).toBe('SCHEMA');
    }
  });
});

describe('I1 — no máximo uma MatrixVersion em DRAFT por matriz', () => {
  it('válido: nenhuma versão em rascunho', () => {
    expect(checkI1(base())).toEqual([]);
  });

  it('inválido: duas versões em rascunho', () => {
    const doc = base();
    const v1 = doc.matrices[0]!.versions[0]!;
    doc.matrices[0]!.versions.push(
      { ...structuredClone(v1), id: 'mtxv00000002', number: 2, state: 'DRAFT', publishedAt: undefined, publishedBy: undefined, effectiveFrom: undefined },
      { ...structuredClone(v1), id: 'mtxv00000003', number: 3, state: 'DRAFT', publishedAt: undefined, publishedBy: undefined, effectiveFrom: undefined },
    );
    const issues = checkI1(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I1');
    expect(issues[0]!.path).toBe('matrices[0]');
  });
});

describe('I2 — no máximo uma MatrixVersion em PUBLISHED por matriz', () => {
  it('válido: uma única versão publicada', () => {
    expect(checkI2(base())).toEqual([]);
  });

  it('inválido: duas versões publicadas (fixture defect-two-published-versions)', () => {
    const doc = loadFixture('defect-two-published-versions.json');
    const issues = checkI2(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I2');
    expect(issues[0]!.path).toBe('matrices[0]');
  });
});

describe('I3 — versão PUBLISHED/SUPERSEDED/ARCHIVED é imutável (proxy estrutural)', () => {
  it('válido: versão publicada tem publishedAt/publishedBy/effectiveFrom', () => {
    expect(checkI3(base())).toEqual([]);
  });

  it('inválido: versão PUBLISHED sem publishedBy', () => {
    const doc = base();
    doc.matrices[0]!.versions[0]!.publishedBy = undefined;
    const issues = checkI3(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I3');
  });
});

describe('I4 — intervalos de vigência não se sobrepõem nem deixam buracos', () => {
  it('válido: duas versões encadeadas sem buraco', () => {
    const doc = base();
    const v1 = doc.matrices[0]!.versions[0]!;
    v1.effectiveTo = '2026-06-01T00:00:00.000Z';
    doc.matrices[0]!.versions.push({
      ...structuredClone(v1),
      id: 'mtxv00000002',
      number: 2,
      effectiveFrom: '2026-06-01T00:00:00.000Z',
      effectiveTo: undefined,
    });
    expect(checkI4(doc)).toEqual([]);
  });

  it('inválido: versão sem effectiveTo mas existe versão posterior', () => {
    const doc = base();
    const v1 = doc.matrices[0]!.versions[0]!;
    doc.matrices[0]!.versions.push({
      ...structuredClone(v1),
      id: 'mtxv00000002',
      number: 2,
      effectiveFrom: '2026-06-01T00:00:00.000Z',
    });
    const issues = checkI4(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I4');
  });
});

describe('I5 — toda chave de cells decompõe em xPath::yPath válidos', () => {
  it('válido: todas as chaves batem com as tuplas', () => {
    expect(checkI5(base())).toEqual([]);
  });

  it('inválido: chave de célula fora das tuplas (fixture defect-invalid-cell-coord)', () => {
    const doc = loadFixture('defect-invalid-cell-coord.json');
    const issues = checkI5(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I5');
    expect(issues[0]!.path).toBe('matrices[0].versions[0].cells["A::ZZZ"]');
    expect(issues[0]!.autoFix).toBe('REMOVE');
  });
});

describe('I6 — publicar exige zero combinações sem decision', () => {
  it('válido: versão publicada com todas as combinações preenchidas', () => {
    expect(checkI6(base())).toEqual([]);
  });

  it('inválido: versão publicada com uma combinação sem decision', () => {
    const doc = base();
    delete doc.matrices[0]!.versions[0]!.cells['A::S1'];
    const issues = checkI6(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I6');
  });
});

describe('I7 — CatalogItem de kind LIMIT tem numericValue', () => {
  const limitItem: CatalogItem = {
    id: 'cat000000002',
    kind: 'LIMIT',
    code: 'LIM_100',
    label: 'Limite 100',
    position: 1,
    numericValue: '100',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('válido: LIMIT com numericValue', () => {
    const doc = base();
    doc.catalog.push(limitItem);
    expect(checkI7(doc)).toEqual([]);
  });

  it('inválido: LIMIT sem numericValue', () => {
    const doc = base();
    doc.catalog.push({ ...limitItem, numericValue: undefined });
    const issues = checkI7(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I7');
    expect(issues[0]!.path).toBe('catalog[1]');
  });
});

describe('I8 — BOOLEAN tem exatamente 2 domínios; demais, ao menos 2', () => {
  it('válido: CATEGORICAL com 2 domínios', () => {
    expect(checkI8(base())).toEqual([]);
  });

  it('inválido: BOOLEAN com 3 domínios', () => {
    const doc = base();
    doc.variables[0]!.type = 'BOOLEAN';
    doc.variables[0]!.versions[0]!.domains.push({ code: 'C', label: 'C', position: 2 });
    const issues = checkI8(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I8');
  });
});

describe('I9 — RANGE contíguo, sem sobreposição, um isCatchAll ao final', () => {
  function rangeVariable(domains: Domain[]): Variable {
    return {
      id: 'var000000003',
      code: 'FAIXA',
      name: 'Faixa',
      type: 'RANGE',
      createdAt: '2026-01-01T00:00:00.000Z',
      versions: [
        {
          id: 'varv00000003',
          number: 1,
          state: 'PUBLISHED',
          createdAt: '2026-01-01T00:00:00.000Z',
          createdBy: 'Arthur',
          publishedAt: '2026-01-01T00:00:00.000Z',
          publishedBy: 'Arthur',
          domains,
        },
      ],
    };
  }

  it('válido: faixas contíguas com catchAll ao final', () => {
    const doc = base();
    doc.variables.push(
      rangeVariable([
        { code: 'BAIXA', label: 'Baixa', position: 0, rangeMin: '0', rangeMax: '100' },
        { code: 'ALTA', label: 'Alta', position: 1, rangeMin: '100', isCatchAll: true },
      ]),
    );
    expect(checkI9(doc)).toEqual([]);
  });

  it('inválido: faixas com buraco (rangeMax ≠ rangeMin da próxima)', () => {
    const doc = base();
    doc.variables.push(
      rangeVariable([
        { code: 'BAIXA', label: 'Baixa', position: 0, rangeMin: '0', rangeMax: '100' },
        { code: 'ALTA', label: 'Alta', position: 1, rangeMin: '150', isCatchAll: true },
      ]),
    );
    const issues = checkI9(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I9');
  });

  it('I9 regional: contíguo em todas as regionais é válido', () => {
    const doc = base();
    doc.variables.push(
      rangeVariable([
        {
          code: 'A',
          label: 'A',
          position: 0,
          regionalRanges: { BASE: { min: '0', max: '100' }, SP: { min: '0', max: '120' } },
        },
        {
          code: 'B',
          label: 'B',
          position: 1,
          regionalRanges: { BASE: { min: '100', max: '200' }, SP: { min: '120', max: '240' } },
        },
      ]),
    );
    doc.variables[doc.variables.length - 1]!.versions[0]!.regionalDimension = {
      regions: [{ code: 'BASE', label: 'Base' }, { code: 'SP', label: 'São Paulo' }],
    };
    expect(checkI9(doc)).toEqual([]);
  });

  it('I9 regional: buraco numa única regional é inválido', () => {
    const doc = base();
    doc.variables.push(
      rangeVariable([
        {
          code: 'A',
          label: 'A',
          position: 0,
          regionalRanges: { BASE: { min: '0', max: '100' }, SP: { min: '0', max: '120' } },
        },
        {
          code: 'B',
          label: 'B',
          position: 1,
          // SP tem buraco (120 -> 150); BASE continua contíguo.
          regionalRanges: { BASE: { min: '100', max: '200' }, SP: { min: '150', max: '240' } },
        },
      ]),
    );
    doc.variables[doc.variables.length - 1]!.versions[0]!.regionalDimension = {
      regions: [{ code: 'BASE', label: 'Base' }, { code: 'SP', label: 'São Paulo' }],
    };
    const issues = checkI9(doc);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.invariant).toBe('I9');
  });
});

describe('I19 — regionalDimension: regions não vazio/único; todo domínio RANGE tem entrada por regional', () => {
  function rangeVariableWithRegional(domains: Domain[], regions: Array<{ code: string; label: string }>): Variable {
    return {
      id: 'var000000004',
      code: 'FAIXA_REG',
      name: 'Faixa Regional',
      type: 'RANGE',
      createdAt: '2026-01-01T00:00:00.000Z',
      versions: [
        {
          id: 'varv00000004',
          number: 1,
          state: 'PUBLISHED',
          createdAt: '2026-01-01T00:00:00.000Z',
          createdBy: 'Arthur',
          publishedAt: '2026-01-01T00:00:00.000Z',
          publishedBy: 'Arthur',
          domains,
          regionalDimension: { regions },
        },
      ],
    };
  }

  it('válido: todo domínio tem entrada para todo regional', () => {
    const doc = base();
    doc.variables.push(
      rangeVariableWithRegional(
        [
          { code: 'A', label: 'A', position: 0, regionalRanges: { BASE: { min: '0', max: '100' } } },
          { code: 'B', label: 'B', position: 1, regionalRanges: { BASE: { min: '100', max: '200' } } },
        ],
        [{ code: 'BASE', label: 'Base' }],
      ),
    );
    expect(checkI19(doc)).toEqual([]);
  });

  it('inválido: regions vazio', () => {
    const doc = base();
    doc.variables.push(
      rangeVariableWithRegional(
        [
          { code: 'A', label: 'A', position: 0 },
          { code: 'B', label: 'B', position: 1 },
        ],
        [],
      ),
    );
    const issues = checkI19(doc);
    expect(issues.some((i) => i.invariant === 'I19')).toBe(true);
  });

  it('inválido: code de regional duplicado', () => {
    const doc = base();
    doc.variables.push(
      rangeVariableWithRegional(
        [
          { code: 'A', label: 'A', position: 0, regionalRanges: { BASE: { min: '0', max: '100' } } },
          { code: 'B', label: 'B', position: 1, regionalRanges: { BASE: { min: '100', max: '200' } } },
        ],
        [{ code: 'BASE', label: 'Base 1' }, { code: 'BASE', label: 'Base 2' }],
      ),
    );
    const issues = checkI19(doc);
    expect(issues.some((i) => i.invariant === 'I19')).toBe(true);
  });

  it('inválido: domínio sem entrada para uma regional', () => {
    const doc = base();
    doc.variables.push(
      rangeVariableWithRegional(
        [
          {
            code: 'A',
            label: 'A',
            position: 0,
            regionalRanges: { BASE: { min: '0', max: '100' }, SP: { min: '0', max: '100' } },
          },
          // B não tem entrada para SP.
          { code: 'B', label: 'B', position: 1, regionalRanges: { BASE: { min: '100', max: '200' } } },
        ],
        [{ code: 'BASE', label: 'Base' }, { code: 'SP', label: 'São Paulo' }],
      ),
    );
    const issues = checkI19(doc);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.invariant === 'I19')).toBe(true);
  });

  it('variável sem regionalDimension não é afetada', () => {
    expect(checkI19(base())).toEqual([]);
  });
});

describe('I10 — VariableVersion/CompatibilityVersion publicada é imutável (proxy estrutural)', () => {
  it('válido: versão de variável publicada tem publishedAt/publishedBy', () => {
    expect(checkI10(base())).toEqual([]);
  });

  it('inválido: versão de variável PUBLISHED sem publishedAt', () => {
    const doc = base();
    doc.variables[0]!.versions[0]!.publishedAt = undefined;
    const issues = checkI10(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I10');
    expect(issues[0]!.path).toBe('variables[0].versions[0]');
  });
});

describe('I11 — no máximo uma DRAFT e uma PUBLISHED por variável/regra', () => {
  it('válido: uma única versão publicada', () => {
    expect(checkI11(base())).toEqual([]);
  });

  it('inválido: duas versões em rascunho da mesma variável', () => {
    const doc = base();
    const v1 = doc.variables[0]!.versions[0]!;
    doc.variables[0]!.versions.push(
      { ...structuredClone(v1), id: 'varv00000004', number: 2, state: 'DRAFT', publishedAt: undefined, publishedBy: undefined },
      { ...structuredClone(v1), id: 'varv00000005', number: 3, state: 'DRAFT', publishedAt: undefined, publishedBy: undefined },
    );
    const issues = checkI11(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I11');
  });
});

describe('I12 — uma única regra de compatibilidade publicada por par (parent, child)', () => {
  function compatRule(id: string, code: string): CompatibilityRule {
    return {
      id,
      code,
      name: code,
      parentVariableId: 'var000000001',
      childVariableId: 'var000000002',
      createdAt: '2026-01-01T00:00:00.000Z',
      versions: [
        {
          id: `${id}v1`,
          number: 1,
          state: 'PUBLISHED',
          createdAt: '2026-01-01T00:00:00.000Z',
          createdBy: 'Arthur',
          publishedAt: '2026-01-01T00:00:00.000Z',
          publishedBy: 'Arthur',
          parentVariableVersionId: 'varv00000001',
          childVariableVersionId: 'varv00000002',
          allow: {},
          defaultForUnlisted: 'ALL',
        },
      ],
    };
  }

  it('válido: uma única regra publicada para o par', () => {
    const doc = base();
    doc.compatibility.push(compatRule('rule000000001', 'REGRA_A'));
    expect(checkI12(doc)).toEqual([]);
  });

  it('inválido: duas regras publicadas para o mesmo par (parent, child)', () => {
    const doc = base();
    doc.compatibility.push(compatRule('rule000000001', 'REGRA_A'), compatRule('rule000000002', 'REGRA_B'));
    const issues = checkI12(doc);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.invariant === 'I12')).toBe(true);
  });
});

describe('I13 — axes.*.levels tem de 1 a 3 elementos, sem variável repetida', () => {
  it('válido: 1 nível por eixo', () => {
    expect(checkI13(base())).toEqual([]);
  });

  it('inválido: mesma variável repetida em dois níveis do mesmo eixo', () => {
    const doc = base();
    const level = doc.matrices[0]!.versions[0]!.axes.x.levels[0]!;
    doc.matrices[0]!.versions[0]!.axes.x.levels.push({ ...structuredClone(level), id: 'lvlx00000002' });
    const issues = checkI13(doc);
    expect(issues.some((i) => i.invariant === 'I13')).toBe(true);
  });
});

describe('I14 — nenhuma variável aparece nos dois eixos da mesma versão', () => {
  it('válido: eixos usam variáveis diferentes', () => {
    expect(checkI14(base())).toEqual([]);
  });

  it('inválido: mesma variável em X e Y', () => {
    const doc = base();
    doc.matrices[0]!.versions[0]!.axes.y.levels[0]!.variableId = 'var000000001';
    const issues = checkI14(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I14');
  });
});

describe('I15 — tuples sem duplicatas; todo código existe nos domínios do nível', () => {
  it('válido: tuplas únicas e códigos existentes', () => {
    expect(checkI15(base())).toEqual([]);
  });

  it('inválido: tupla órfã (código sem domínio correspondente) — fixture defect-orphan-tuple', () => {
    const doc = loadFixture('defect-orphan-tuple.json');
    const issues = checkI15(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I15');
    expect(issues[0]!.message).toContain('ORPHAN');
    expect(issues[0]!.autoFix).toBe('REMOVE');
  });

  it('inválido: tupla duplicada', () => {
    const doc = base();
    doc.matrices[0]!.versions[0]!.axes.x.tuples.push('A');
    const issues = checkI15(doc);
    expect(issues.some((i) => i.invariant === 'I15' && i.message.includes('duplicada'))).toBe(true);
  });
});

describe('I16 — xTuples.length × yTuples.length ≤ 6.000', () => {
  it('válido: 4 combinações', () => {
    expect(checkI16(base())).toEqual([]);
  });

  it('inválido: acima de 6.000 combinações', () => {
    const doc = base();
    doc.matrices[0]!.versions[0]!.axes.x.tuples = Array.from({ length: 61 }, (_, i) => `X${i}`);
    doc.matrices[0]!.versions[0]!.axes.y.tuples = Array.from({ length: 100 }, (_, i) => `Y${i}`);
    const issues = checkI16(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I16');
  });
});

describe('I17 — toda referência a catálogo em cells aponta para code existente do kind correto', () => {
  it('válido: decisões referenciadas existem no catálogo', () => {
    expect(checkI17(base())).toEqual([]);
  });

  it('inválido: célula referencia decisão inexistente — fixture defect-catalog-ref-missing', () => {
    const doc = loadFixture('defect-catalog-ref-missing.json');
    const issues = checkI17(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I17');
    expect(issues[0]!.path).toBe('matrices[0].versions[0].cells["A::S1"]');
    expect(issues[0]!.autoFix).toBe('CLEAR_REF');
  });
});

describe('I18 — todo code é único no seu escopo', () => {
  it('válido: nenhum código repetido', () => {
    expect(checkI18(base())).toEqual([]);
  });

  it('inválido: duas variáveis com o mesmo code', () => {
    const doc = base();
    doc.variables[1]!.code = doc.variables[0]!.code;
    const issues = checkI18(doc);
    expect(issues.some((i) => i.invariant === 'I18')).toBe(true);
  });
});

describe('POSITION — 0-based sem buracos (Domain/CatalogItem/Project)', () => {
  it('válido: posições sequenciais', () => {
    expect(checkPositions(base())).toEqual([]);
  });

  it('inválido: buraco nas posições dos domínios — fixture defect-position-gap', () => {
    const doc = loadFixture('defect-position-gap.json');
    const issues = checkPositions(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('POSITION');
    expect(issues[0]!.autoFix).toBe('RENUMBER');
    expect(issues[0]!.path).toBe('variables[1].versions[0].domains[1]');
  });
});

describe('validateDocument — fixtures defeituosas produzem exatamente os issues esperados', () => {
  it('defect-catalog-ref-missing.json → só I17', () => {
    const result = validateDocument(loadFixture('defect-catalog-ref-missing.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.invariant)).toEqual(['I17']);
    }
  });

  it('defect-invalid-cell-coord.json → só I5', () => {
    const result = validateDocument(loadFixture('defect-invalid-cell-coord.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.invariant)).toEqual(['I5']);
    }
  });

  it('defect-orphan-tuple.json → só I15', () => {
    const result = validateDocument(loadFixture('defect-orphan-tuple.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.invariant)).toEqual(['I15']);
    }
  });

  it('defect-position-gap.json → só POSITION', () => {
    const result = validateDocument(loadFixture('defect-position-gap.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.invariant)).toEqual(['POSITION']);
    }
  });

  it('defect-two-published-versions.json → só I2', () => {
    const result = validateDocument(loadFixture('defect-two-published-versions.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.invariant)).toEqual(['I2']);
    }
  });

  it('valid-minimal.json é aceito sem nenhum ERROR', () => {
    const result = validateDocument(loadFixture('valid-minimal.json'));
    expect(result.ok).toBe(true);
  });

  it('sample-document.json (documento de exemplo serializado) é aceito sem nenhum ERROR', () => {
    const result = validateDocument(loadFixture('sample-document.json'));
    expect(result.ok).toBe(true);
  });
});
