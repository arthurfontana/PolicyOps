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

  it('WARNING, não ERROR (docs/05 §9): não bloqueia validateDocument, logo não bloqueia prepareSave', () => {
    const doc = base();
    doc.variables[0]!.type = 'BOOLEAN';
    doc.variables[0]!.versions[0]!.domains.push({ code: 'C', label: 'C', position: 2 });
    expect(checkI8(doc)[0]!.severity).toBe('WARNING');
    expect(validateDocument(doc).ok).toBe(true);
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
    const variable = rangeVariable([
      { code: 'BAIXA', label: 'Baixa', position: 0, rangeMin: '0', rangeMax: '100' },
      { code: 'ALTA', label: 'Alta', position: 1, rangeMin: '100', isCatchAll: true },
    ]);
    variable.versions[0]!.boundaryMode = 'HALF_OPEN';
    doc.variables.push(variable);
    expect(checkI9(doc)).toEqual([]);
  });

  it('inválido: faixas com buraco (rangeMax ≠ rangeMin da próxima)', () => {
    const doc = base();
    const variable = rangeVariable([
      { code: 'BAIXA', label: 'Baixa', position: 0, rangeMin: '0', rangeMax: '100' },
      { code: 'ALTA', label: 'Alta', position: 1, rangeMin: '150', isCatchAll: true },
    ]);
    variable.versions[0]!.boundaryMode = 'HALF_OPEN';
    doc.variables.push(variable);
    const issues = checkI9(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I9');
  });

  it('WARNING, não ERROR (docs/05 §9): não bloqueia validateDocument, logo não bloqueia prepareSave', () => {
    const doc = base();
    const variable = rangeVariable([
      { code: 'BAIXA', label: 'Baixa', position: 0, rangeMin: '0', rangeMax: '100' },
      { code: 'ALTA', label: 'Alta', position: 1, rangeMin: '150', isCatchAll: true },
    ]);
    variable.versions[0]!.boundaryMode = 'HALF_OPEN';
    doc.variables.push(variable);
    expect(checkI9(doc)[0]!.severity).toBe('WARNING');
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('I9 com agrupamento: contíguo em todos os caminhos é válido', () => {
    const doc = base();
    doc.variables.push(
      rangeVariable([
        {
          code: 'A',
          label: 'A',
          position: 0,
          groupingRanges: [
            { path: ['BASE'], min: '0', max: '100' },
            { path: ['SP'], min: '0', max: '120' },
          ],
        },
        {
          code: 'B',
          label: 'B',
          position: 1,
          groupingRanges: [
            { path: ['BASE'], min: '100', max: '200' },
            { path: ['SP'], min: '120', max: '240' },
          ],
        },
      ]),
    );
    doc.variables[doc.variables.length - 1]!.versions[0]!.groupingDimensions = [
      {
        code: 'REGIONAL',
        label: 'Regional',
        options: [
          { code: 'BASE', label: 'Base' },
          { code: 'SP', label: 'São Paulo' },
        ],
      },
    ];
    doc.variables[doc.variables.length - 1]!.versions[0]!.boundaryMode = 'HALF_OPEN';
    expect(checkI9(doc)).toEqual([]);
  });

  it('I9 com agrupamento: buraco num único caminho é inválido, e a mensagem aponta o caminho', () => {
    const doc = base();
    doc.variables.push(
      rangeVariable([
        {
          code: 'A',
          label: 'A',
          position: 0,
          groupingRanges: [
            { path: ['BASE'], min: '0', max: '100' },
            { path: ['SP'], min: '0', max: '120' },
          ],
        },
        {
          code: 'B',
          label: 'B',
          position: 1,
          // SP tem buraco (120 -> 150); BASE continua contíguo.
          groupingRanges: [
            { path: ['BASE'], min: '100', max: '200' },
            { path: ['SP'], min: '150', max: '240' },
          ],
        },
      ]),
    );
    doc.variables[doc.variables.length - 1]!.versions[0]!.groupingDimensions = [
      {
        code: 'REGIONAL',
        label: 'Regional',
        options: [
          { code: 'BASE', label: 'Base' },
          { code: 'SP', label: 'São Paulo' },
        ],
      },
    ];
    doc.variables[doc.variables.length - 1]!.versions[0]!.boundaryMode = 'HALF_OPEN';
    const issues = checkI9(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I9');
    expect(issues[0]!.message).toContain('"SP"');
  });

  it('I9 com agrupamento: domínio ausente de um caminho não vira erro de contiguidade', () => {
    const doc = base();
    doc.variables.push(
      rangeVariable([
        {
          code: 'A',
          label: 'A',
          position: 0,
          groupingRanges: [
            { path: ['BASE'], min: '0', max: '100' },
            { path: ['SP'], min: '0', max: '120' },
          ],
        },
        // B só existe em BASE — assimetria legítima (I19, nota após a tabela).
        { code: 'B', label: 'B', position: 1, groupingRanges: [{ path: ['BASE'], min: '100', max: '200' }] },
      ]),
    );
    doc.variables[doc.variables.length - 1]!.versions[0]!.groupingDimensions = [
      {
        code: 'REGIONAL',
        label: 'Regional',
        options: [
          { code: 'BASE', label: 'Base' },
          { code: 'SP', label: 'São Paulo' },
        ],
      },
    ];
    doc.variables[doc.variables.length - 1]!.versions[0]!.boundaryMode = 'HALF_OPEN';
    expect(checkI9(doc)).toEqual([]);
  });

  it('boundaryMode INCLUSIVE_INTEGER: faixas com salto de 1 (formato fechado-fechado do Excel) são válidas', () => {
    const doc = base();
    const variable = rangeVariable([
      { code: 'R20', label: 'R20', position: 0, rangeMin: '0', rangeMax: '357' },
      { code: 'R19', label: 'R19', position: 1, rangeMin: '358', rangeMax: '437' },
      { code: 'R18', label: 'R18', position: 2, rangeMin: '438', isCatchAll: true },
    ]);
    variable.versions[0]!.boundaryMode = 'INCLUSIVE_INTEGER';
    doc.variables.push(variable);
    expect(checkI9(doc)).toEqual([]);
  });

  it('boundaryMode INCLUSIVE_INTEGER: buraco real (salto > 1) continua inválido', () => {
    const doc = base();
    const variable = rangeVariable([
      { code: 'R20', label: 'R20', position: 0, rangeMin: '0', rangeMax: '357' },
      { code: 'R19', label: 'R19', position: 1, rangeMin: '360', isCatchAll: true },
    ]);
    variable.versions[0]!.boundaryMode = 'INCLUSIVE_INTEGER';
    doc.variables.push(variable);
    const issues = checkI9(doc);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.invariant).toBe('I9');
  });

  it('boundaryMode INCLUSIVE_INTEGER: faixas no formato HALF_OPEN (máx == próx.mín, sem +1) ficam inválidas', () => {
    const doc = base();
    const variable = rangeVariable([
      { code: 'BAIXA', label: 'Baixa', position: 0, rangeMin: '0', rangeMax: '100' },
      { code: 'ALTA', label: 'Alta', position: 1, rangeMin: '100', isCatchAll: true },
    ]);
    variable.versions[0]!.boundaryMode = 'INCLUSIVE_INTEGER';
    doc.variables.push(variable);
    const issues = checkI9(doc);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.invariant).toBe('I9');
  });

  it('boundaryMode INCLUSIVE_INTEGER: valor não inteiro falha com issue de I9', () => {
    const doc = base();
    const variable = rangeVariable([
      { code: 'R20', label: 'R20', position: 0, rangeMin: '0', rangeMax: '357.5' },
      { code: 'R19', label: 'R19', position: 1, rangeMin: '358.5', isCatchAll: true },
    ]);
    variable.versions[0]!.boundaryMode = 'INCLUSIVE_INTEGER';
    doc.variables.push(variable);
    const issues = checkI9(doc);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.invariant).toBe('I9');
  });

  it('boundaryMode ausente: comportamento INCLUSIVE_INTEGER (o default) — faixas fechado-fechado com salto de 1', () => {
    const doc = base();
    doc.variables.push(
      rangeVariable([
        { code: 'R20', label: 'R20', position: 0, rangeMin: '0', rangeMax: '357' },
        { code: 'R19', label: 'R19', position: 1, rangeMin: '358', isCatchAll: true },
      ]),
    );
    expect(doc.variables[doc.variables.length - 1]!.versions[0]!.boundaryMode).toBeUndefined();
    expect(checkI9(doc)).toEqual([]);
  });

  it('válido: faixas decrescentes por position (maior faixa primeiro) — corte de score real do negócio', () => {
    const doc = base();
    const variable = rangeVariable([
      { code: 'R01', label: 'R01', position: 0, rangeMin: '704', rangeMax: '999' },
      { code: 'R02', label: 'R02', position: 1, rangeMin: '685', rangeMax: '703' },
      { code: 'R03', label: 'R03', position: 2, rangeMax: '684', isCatchAll: true },
    ]);
    variable.versions[0]!.boundaryMode = 'INCLUSIVE_INTEGER';
    doc.variables.push(variable);
    expect(checkI9(doc)).toEqual([]);
  });

  it('inválido: buraco numa sequência decrescente por position continua acusando I9', () => {
    const doc = base();
    const variable = rangeVariable([
      { code: 'R01', label: 'R01', position: 0, rangeMin: '704', rangeMax: '999' },
      { code: 'R02', label: 'R02', position: 1, rangeMin: '680', rangeMax: '702' },
    ]);
    variable.versions[0]!.boundaryMode = 'INCLUSIVE_INTEGER';
    doc.variables.push(variable);
    const issues = checkI9(doc);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.invariant).toBe('I9');
  });
});

describe('I19 — groupingDimensions: 1 a 4 níveis, codes únicos, paths válidos', () => {
  function rangeVariableWithGrouping(
    domains: Domain[],
    groupingDimensions: Variable['versions'][number]['groupingDimensions'],
  ): Variable {
    return {
      id: 'var000000004',
      code: 'FAIXA_AGRUP',
      name: 'Faixa agrupada',
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
          groupingDimensions,
        },
      ],
    };
  }

  const REGIONAL = [
    { code: 'REGIONAL', label: 'Regional', options: [{ code: 'BASE', label: 'Base' }] },
  ];

  it('válido: um nível, paths apontando para opções existentes', () => {
    const doc = base();
    doc.variables.push(
      rangeVariableWithGrouping(
        [
          { code: 'A', label: 'A', position: 0, groupingRanges: [{ path: ['BASE'], min: '0', max: '100' }] },
          { code: 'B', label: 'B', position: 1, groupingRanges: [{ path: ['BASE'], min: '100', max: '200' }] },
        ],
        REGIONAL,
      ),
    );
    expect(checkI19(doc)).toEqual([]);
  });

  it('inválido: nenhum nível', () => {
    const doc = base();
    doc.variables.push(
      rangeVariableWithGrouping(
        [
          { code: 'A', label: 'A', position: 0 },
          { code: 'B', label: 'B', position: 1 },
        ],
        [],
      ),
    );
    const issues = checkI19(doc);
    expect(issues.some((i) => i.invariant === 'I19')).toBe(true);
    // WARNING, não ERROR (docs/05 §9): não bloqueia validateDocument, logo não bloqueia prepareSave.
    expect(issues.every((i) => i.severity === 'WARNING')).toBe(true);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('inválido: mais de 4 níveis', () => {
    const doc = base();
    doc.variables.push(
      rangeVariableWithGrouping(
        [
          { code: 'A', label: 'A', position: 0 },
          { code: 'B', label: 'B', position: 1 },
        ],
        ['N1', 'N2', 'N3', 'N4', 'N5'].map((code) => ({
          code,
          label: code,
          options: [{ code: 'X', label: 'X' }],
        })),
      ),
    );
    expect(checkI19(doc).some((i) => i.message.includes('de 1 a 4 níveis'))).toBe(true);
  });

  it('inválido: código de nível duplicado', () => {
    const doc = base();
    doc.variables.push(
      rangeVariableWithGrouping(
        [
          { code: 'A', label: 'A', position: 0 },
          { code: 'B', label: 'B', position: 1 },
        ],
        [
          { code: 'REGIONAL', label: 'Regional 1', options: [{ code: 'BASE', label: 'Base' }] },
          { code: 'REGIONAL', label: 'Regional 2', options: [{ code: 'SP', label: 'SP' }] },
        ],
      ),
    );
    expect(checkI19(doc).some((i) => i.invariant === 'I19')).toBe(true);
  });

  it('inválido: opção duplicada dentro do nível, e nível sem opção', () => {
    const doc = base();
    doc.variables.push(
      rangeVariableWithGrouping(
        [
          { code: 'A', label: 'A', position: 0 },
          { code: 'B', label: 'B', position: 1 },
        ],
        [
          {
            code: 'REGIONAL',
            label: 'Regional',
            options: [
              { code: 'BASE', label: 'Base 1' },
              { code: 'BASE', label: 'Base 2' },
            ],
          },
          { code: 'PORTE', label: 'Porte', options: [] },
        ],
      ),
    );
    const issues = checkI19(doc);
    expect(issues.some((i) => i.message.includes('aparece 2 vezes no agrupamento'))).toBe(true);
    expect(issues.some((i) => i.message.includes('ao menos uma opção'))).toBe(true);
  });

  it('inválido: path com comprimento errado ou apontando opção inexistente', () => {
    const doc = base();
    doc.variables.push(
      rangeVariableWithGrouping(
        [
          { code: 'A', label: 'A', position: 0, groupingRanges: [{ path: ['BASE', 'MEI'], min: '0', max: '1' }] },
          { code: 'B', label: 'B', position: 1, groupingRanges: [{ path: ['SP'], min: '0', max: '1' }] },
        ],
        REGIONAL,
      ),
    );
    const issues = checkI19(doc);
    expect(issues.some((i) => i.message.includes('nível(is) de agrupamento'))).toBe(true);
    expect(issues.some((i) => i.message.includes('"SP"'))).toBe(true);
  });

  it('válido: domínio sem entrada num caminho que outros preenchem — completude não é invariante', () => {
    const doc = base();
    doc.variables.push(
      rangeVariableWithGrouping(
        [
          {
            code: 'A',
            label: 'A',
            position: 0,
            groupingRanges: [
              { path: ['BASE'], min: '0', max: '100' },
              { path: ['SP'], min: '0', max: '100' },
            ],
          },
          // B não tem entrada para SP — deliberadamente aceito (docs/03 §9).
          { code: 'B', label: 'B', position: 1, groupingRanges: [{ path: ['BASE'], min: '100', max: '200' }] },
        ],
        [
          {
            code: 'REGIONAL',
            label: 'Regional',
            options: [
              { code: 'BASE', label: 'Base' },
              { code: 'SP', label: 'São Paulo' },
            ],
          },
        ],
      ),
    );
    expect(checkI19(doc)).toEqual([]);
  });

  it('variável sem groupingDimensions não é afetada', () => {
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
    // Código de variável duplicado continua ERROR — bloqueia validateDocument (identidade
    // referenciada em todo o documento, fora do escopo do pedido de docs/05 §9).
    expect(issues.some((i) => i.invariant === 'I18' && i.severity === 'ERROR')).toBe(true);
    expect(validateDocument(doc).ok).toBe(false);
  });

  it('WARNING, não ERROR (docs/05 §9): código de domínio duplicado dentro da versão não bloqueia', () => {
    const doc = base();
    doc.variables[0]!.versions[0]!.domains[1]!.code = doc.variables[0]!.versions[0]!.domains[0]!.code;
    const issues = checkI18(doc);
    expect(issues.some((i) => i.invariant === 'I18')).toBe(true);
    expect(issues.every((i) => i.severity === 'WARNING')).toBe(true);
    expect(validateDocument(doc).ok).toBe(true);
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

  it('válido: catálogo com DECISION e OFFER intercalados, cada kind 0-based por si', () => {
    const doc = base();
    doc.catalog = [
      { id: 'cat00000d001', kind: 'DECISION', code: 'APROVADO', label: 'Aprovado', position: 0, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'cat00000o001', kind: 'OFFER', code: 'OFERTA_A', label: 'Oferta A', position: 0, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'cat00000d002', kind: 'DECISION', code: 'REPROVADO', label: 'Reprovado', position: 1, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'cat00000o002', kind: 'OFFER', code: 'OFERTA_B', label: 'Oferta B', position: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    expect(checkPositions(doc)).toEqual([]);
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
