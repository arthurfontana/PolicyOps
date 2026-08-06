import { describe, expect, it } from 'vitest';
import {
  CellSchema,
  CODE_REGEX,
  codeSchema,
  DECIMAL_REGEX,
  decimalSchema,
  DomainSchema,
  ISO_DATE_REGEX,
  isoDateSchema,
} from '@/core/document/schema';

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
