import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CellSchema,
  CODE_REGEX,
  codeSchema,
  DECIMAL_REGEX,
  decimalSchema,
  DomainSchema,
  ISO_DATE_REGEX,
  isoDateSchema,
  PolicyOpsDocumentSchema,
  GroupingDimensionSchema,
  GroupingOptionSchema,
  GroupingRangeSchema,
} from '@/core/document/schema';

function loadRawFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('codeSchema', () => {
  it('aceita letras maiúsculas, dígitos e underscore', () => {
    expect(codeSchema.safeParse('SCORE_HVI3').success).toBe(true);
    expect(codeSchema.safeParse('R1').success).toBe(true);
    expect(codeSchema.safeParse('LIM_2000').success).toBe(true);
  });

  it('rejeita minúsculas, espaços e vazio', () => {
    expect(codeSchema.safeParse('score').success).toBe(false);
    expect(codeSchema.safeParse('SCORE HVI3').success).toBe(false);
    expect(codeSchema.safeParse('').success).toBe(false);
  });

  it('rejeita "|" e ":" — são os separadores de caminho (docs/04-eixos-aninhados.md §2)', () => {
    expect(codeSchema.safeParse('VAREJO|100K').success).toBe(false);
    expect(codeSchema.safeParse('X::Y').success).toBe(false);
    expect(codeSchema.safeParse('A:B').success).toBe(false);
    expect(CODE_REGEX.test('A|B')).toBe(false);
    expect(CODE_REGEX.test('A:B')).toBe(false);
  });
});

describe('decimalSchema', () => {
  it('aceita strings numéricas, com e sem sinal/decimal', () => {
    expect(decimalSchema.safeParse('2000.00').success).toBe(true);
    expect(decimalSchema.safeParse('0').success).toBe(true);
    expect(decimalSchema.safeParse('-15.5').success).toBe(true);
    expect(DECIMAL_REGEX.test('100000')).toBe(true);
  });

  it('rejeita number e strings não numéricas', () => {
    // decimal nunca é number — é o próprio propósito deste teste.
    expect(decimalSchema.safeParse(2000).success).toBe(false);
    expect(decimalSchema.safeParse('R$ 2000').success).toBe(false);
    expect(decimalSchema.safeParse('').success).toBe(false);
  });
});

describe('isoDateSchema', () => {
  it('aceita ISO 8601 UTC no formato de Date#toISOString()', () => {
    expect(isoDateSchema.safeParse(new Date().toISOString()).success).toBe(true);
    expect(ISO_DATE_REGEX.test('2026-08-05T14:32:00.000Z')).toBe(true);
  });

  it('rejeita datas sem Z, sem milissegundos, ou formato livre', () => {
    expect(isoDateSchema.safeParse('2026-08-05').success).toBe(false);
    expect(isoDateSchema.safeParse('2026-08-05T14:32:00Z').success).toBe(false);
    expect(isoDateSchema.safeParse('05/08/2026').success).toBe(false);
  });
});

describe('DomainSchema — campos opcionais omitidos, nunca null', () => {
  it('aceita domínio só com os campos obrigatórios', () => {
    const result = DomainSchema.safeParse({ code: 'R1', label: 'R1', position: 0 });
    expect(result.success).toBe(true);
  });

  it('rejeita null em campo opcional (shortLabel) — só ausência é permitida', () => {
    const result = DomainSchema.safeParse({ code: 'R1', label: 'R1', position: 0, shortLabel: null });
    expect(result.success).toBe(false);
  });
});

describe('GroupingDimension/GroupingOption/GroupingRange (docs/03 §2, S20)', () => {
  it('GroupingOptionSchema aceita code + label, rejeita code fora de ^[A-Z0-9_]+$', () => {
    expect(GroupingOptionSchema.safeParse({ code: 'SAO_PAULO', label: 'São Paulo' }).success).toBe(true);
    expect(GroupingOptionSchema.safeParse({ code: 'sao paulo', label: 'São Paulo' }).success).toBe(false);
  });

  it('GroupingRangeSchema exige path e min, aceita max ausente (catch-all) e rejeita null em opcional', () => {
    expect(GroupingRangeSchema.safeParse({ path: ['SP', 'MEI'], min: '0', max: '100' }).success).toBe(true);
    expect(GroupingRangeSchema.safeParse({ path: ['SP'], min: '0' }).success).toBe(true);
    expect(GroupingRangeSchema.safeParse({ path: [], min: '0' }).success).toBe(true);
    expect(GroupingRangeSchema.safeParse({ min: '0', max: '100' }).success).toBe(false);
    expect(GroupingRangeSchema.safeParse({ path: ['SP'], max: '100' }).success).toBe(false);
    expect(GroupingRangeSchema.safeParse({ path: ['SP'], min: '0', max: null }).success).toBe(false);
    expect(GroupingRangeSchema.safeParse({ path: ['sp'], min: '0' }).success).toBe(false);
  });

  it('GroupingDimensionSchema exige code, label e a lista de opções', () => {
    expect(
      GroupingDimensionSchema.safeParse({
        code: 'REGIONAL',
        label: 'Regional',
        options: [{ code: 'SP', label: 'São Paulo' }],
      }).success,
    ).toBe(true);
    // Nível sem opções é estruturalmente aceito pelo Zod — quem reclama é I19.
    expect(
      GroupingDimensionSchema.safeParse({ code: 'REGIONAL', label: 'Regional', options: [] }).success,
    ).toBe(true);
    expect(
      GroupingDimensionSchema.safeParse({ code: 'regional', label: 'Regional', options: [] }).success,
    ).toBe(false);
  });

  it('DomainSchema aceita groupingRanges opcional e rejeita o regionalRanges da S18', () => {
    expect(
      DomainSchema.safeParse({
        code: 'R1',
        label: 'R1',
        position: 0,
        groupingRanges: [{ path: ['SP', 'MEI'], min: '0', max: '100' }],
      }).success,
    ).toBe(true);
    expect(
      DomainSchema.safeParse({
        code: 'R1',
        label: 'R1',
        position: 0,
        regionalRanges: { BASE: { min: '0', max: '100' } },
      }).success,
    ).toBe(false);
  });

  it('documentos sem agrupamento continuam válidos, sem groupingDimensions nem groupingRanges', () => {
    for (const name of ['valid-base.json', 'sample-document.json']) {
      const raw = loadRawFixture(name);
      const parsed = PolicyOpsDocumentSchema.safeParse(raw);
      expect(parsed.success, `${name} deveria validar sem alteração de schema`).toBe(true);
      if (parsed.success) {
        expect(parsed.data.schemaVersion).toBe(2);
        for (const variable of parsed.data.variables) {
          for (const version of variable.versions) {
            expect(version.groupingDimensions).toBeUndefined();
            for (const domain of version.domains) {
              expect(domain.groupingRanges).toBeUndefined();
            }
          }
        }
      }
    }
  });
});

describe('CellSchema — células vazias não existem', () => {
  it('rejeita objeto de célula vazio', () => {
    expect(CellSchema.safeParse({}).success).toBe(false);
  });

  it('aceita célula com ao menos um campo preenchido', () => {
    expect(CellSchema.safeParse({ decision: 'APROVADO' }).success).toBe(true);
  });

  it('rejeita null em campo opcional da célula', () => {
    expect(CellSchema.safeParse({ decision: 'APROVADO', note: null }).success).toBe(false);
  });
});
