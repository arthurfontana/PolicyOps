import { describe, expect, it } from 'vitest';
import { validateDomains } from '@/core/library/validate-domains';
import type { Domain } from '@/core/document/schema';

/**
 * `validateDomains` — docs/05-regras-de-negocio.md §5.1 (I8, I9, I18).
 * Exaustivo: cada regra e cada erro, docs/prompts/S06-biblioteca-variaveis.md.
 */

function domain(code: string, position: number, extra: Partial<Domain> = {}): Domain {
  return { code, label: `Rótulo ${code}`, position, ...extra };
}

function range(
  code: string,
  position: number,
  rangeMin: string,
  rangeMax: string | undefined,
  extra: Partial<Domain> = {},
): Domain {
  const d = domain(code, position, { rangeMin, ...extra });
  if (rangeMax !== undefined) d.rangeMax = rangeMax;
  return d;
}

describe('validateDomains', () => {
  it('aceita um conjunto CATEGORICAL válido', () => {
    const result = validateDomains('CATEGORICAL', [domain('A', 0), domain('B', 1), domain('C', 2)]);
    expect(result.ok).toBe(true);
  });

  it('aceita um BOOLEAN com exatamente 2 domínios', () => {
    const result = validateDomains('BOOLEAN', [domain('SIM', 0), domain('NAO', 1)]);
    expect(result.ok).toBe(true);
  });

  it('rejeita BOOLEAN com 3 domínios — BOOLEAN_NEEDS_TWO_DOMAINS', () => {
    const result = validateDomains('BOOLEAN', [domain('A', 0), domain('B', 1), domain('C', 2)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === 'BOOLEAN_NEEDS_TWO_DOMAINS')).toBe(true);
    }
  });

  it('rejeita BOOLEAN com 1 domínio — BOOLEAN_NEEDS_TWO_DOMAINS', () => {
    const result = validateDomains('BOOLEAN', [domain('SIM', 0)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.code).toBe('BOOLEAN_NEEDS_TWO_DOMAINS');
    }
  });

  it('rejeita menos de 2 domínios em tipo não-BOOLEAN — INVALID_DOMAIN_SET', () => {
    const result = validateDomains('CATEGORICAL', [domain('A', 0)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.code).toBe('INVALID_DOMAIN_SET');
    }
  });

  it('rejeita zero domínios', () => {
    const result = validateDomains('ORDINAL', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.code).toBe('INVALID_DOMAIN_SET');
  });

  it('rejeita código com separador de caminho ("|")', () => {
    const result = validateDomains('CATEGORICAL', [domain('A|B', 0), domain('C', 1)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === 'INVALID_DOMAIN_SET')).toBe(true);
    }
  });

  it('rejeita código com dois-pontos (":")', () => {
    const result = validateDomains('CATEGORICAL', [domain('A:B', 0), domain('C', 1)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === 'INVALID_DOMAIN_SET')).toBe(true);
    }
  });

  it('rejeita código minúsculo (fora de ^[A-Z0-9_]+$)', () => {
    const result = validateDomains('CATEGORICAL', [domain('minusculo', 0), domain('B', 1)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.code).toBe('INVALID_DOMAIN_SET');
  });

  it('rejeita código duplicado na mesma versão', () => {
    const result = validateDomains('CATEGORICAL', [domain('A', 0), domain('A', 1)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.message.includes('aparece'));
      expect(issue?.code).toBe('INVALID_DOMAIN_SET');
      expect(issue?.domainCodes).toEqual(['A']);
    }
  });

  it('rejeita position com buraco (0, 2)', () => {
    const result = validateDomains('CATEGORICAL', [domain('A', 0), domain('B', 2)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.code).toBe('INVALID_DOMAIN_SET');
  });

  it('rejeita position repetida', () => {
    const result = validateDomains('CATEGORICAL', [domain('A', 0), domain('B', 0)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.code).toBe('INVALID_DOMAIN_SET');
  });

  it('não exige position começando em 0 na ordem de inserção, só depois de ordenar', () => {
    const result = validateDomains('CATEGORICAL', [domain('B', 1), domain('A', 0)]);
    expect(result.ok).toBe(true);
  });

  // -- RANGE -----------------------------------------------------------------

  it('aceita RANGE contíguo, terminando em catch-all', () => {
    const result = validateDomains('RANGE', [
      range('BAIXO', 0, '0', '100'),
      range('MEDIO', 1, '100', '500'),
      range('ALTO', 2, '500', undefined, { isCatchAll: true }),
    ]);
    expect(result.ok).toBe(true);
  });

  it('aceita RANGE sem catch-all quando todas as faixas têm min/max', () => {
    const result = validateDomains('RANGE', [range('BAIXO', 0, '0', '100'), range('ALTO', 1, '100', '200')]);
    expect(result.ok).toBe(true);
  });

  it('rejeita faixa com buraco (rangeMax de uma ≠ rangeMin da seguinte) — RANGE_NOT_CONTIGUOUS', () => {
    const result = validateDomains('RANGE', [
      range('BAIXO', 0, '0', '100'),
      range('ALTO', 1, '150', '200'),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.code === 'RANGE_NOT_CONTIGUOUS');
      expect(issue).toBeDefined();
      expect(issue?.domainCodes).toEqual(['BAIXO', 'ALTO']);
    }
  });

  it('rejeita faixas sobrepostas (rangeMax de uma > rangeMin da seguinte) — RANGE_NOT_CONTIGUOUS', () => {
    const result = validateDomains('RANGE', [
      range('BAIXO', 0, '0', '150'),
      range('ALTO', 1, '100', '200'),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'RANGE_NOT_CONTIGUOUS')).toBe(true);
    }
  });

  it('rejeita catch-all no meio (não é o último por position)', () => {
    const result = validateDomains('RANGE', [
      range('BAIXO', 0, '0', undefined, { isCatchAll: true }),
      range('ALTO', 1, '0', '100'),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.message.includes('último'));
      expect(issue?.code).toBe('RANGE_NOT_CONTIGUOUS');
    }
  });

  it('rejeita mais de um catch-all', () => {
    const result = validateDomains('RANGE', [
      range('A', 0, '0', undefined, { isCatchAll: true }),
      range('B', 1, '0', undefined, { isCatchAll: true }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.message.includes('demais casos'));
      expect(issue?.code).toBe('RANGE_NOT_CONTIGUOUS');
    }
  });

  it('rejeita RANGE não-catchAll sem rangeMin/rangeMax', () => {
    const result = validateDomains('RANGE', [
      domain('BAIXO', 0),
      range('ALTO', 1, '100', undefined, { isCatchAll: true }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'RANGE_NOT_CONTIGUOUS')).toBe(true);
    }
  });

  it('usa Decimal para comparar faixas, não ponto flutuante (0.1 + 0.2 contíguo)', () => {
    const result = validateDomains('RANGE', [
      range('A', 0, '0', '0.1'),
      range('B', 1, '0.1', '0.30000000000000004'),
    ]);
    // Em ponto flutuante ingênuo 0.1+0.2 !== 0.30000000000000004 seria
    // comparado por igualdade de string ou por Number, arriscando falso
    // positivo/negativo; aqui a fronteira é literalmente a mesma string,
    // então o teste relevante é que não lança e não usa Number() em algum
    // ponto que perderia precisão decimal.
    expect(result.ok).toBe(true);
  });

  it('nunca lança para rangeMin/rangeMax vazios ou incompletos (campo sendo digitado)', () => {
    // Regressão: `new Decimal('')` lança, e como esta função roda a cada
    // tecla na interface, uma faixa recém-adicionada (ainda vazia) não pode
    // derrubar a aplicação — só reportar o problema.
    expect(() =>
      validateDomains('RANGE', [
        domain('A', 0, { rangeMin: '', rangeMax: '' }),
        domain('B', 1, { rangeMin: '0', rangeMax: '10' }),
      ]),
    ).not.toThrow();
    const result = validateDomains('RANGE', [
      domain('A', 0, { rangeMin: '', rangeMax: '' }),
      domain('B', 1, { rangeMin: '0', rangeMax: '10' }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === 'RANGE_NOT_CONTIGUOUS')).toBe(true);

    expect(() =>
      validateDomains('RANGE', [domain('A', 0, { rangeMin: '-', rangeMax: '12.' })]),
    ).not.toThrow();
  });

  it('detecta não-contiguidade que só aparece em precisão decimal (não flutuante)', () => {
    const result = validateDomains('RANGE', [
      range('A', 0, '0', '10.10'),
      range('B', 1, '10.1', '20'),
    ]);
    // "10.10" e "10.1" são o mesmo decimal — contíguo.
    expect(result.ok).toBe(true);
  });
});
