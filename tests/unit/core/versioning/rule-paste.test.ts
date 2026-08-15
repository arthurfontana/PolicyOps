import { describe, expect, it } from 'vitest';
import { recognizeRulePaste } from '@/core/versioning/rule-paste';

/**
 * Entrada em volume — docs/07 §17.3 item 5. Cobre o formato real do
 * documento (docs/14 §9.1): parágrafo solto, `Definição técnica:`,
 * `Observação:` (com e sem, reason code múltiplo, linha vazia no meio).
 */
describe('recognizeRulePaste', () => {
  it('reconhece parágrafo + definição técnica + observação (formato real)', () => {
    const result = recognizeRulePaste(
      [
        'Bloqueia o cliente com dívida em aberto igual ou superior a R$ 5.000.',
        'Definição técnica: Aging > 0 e Valor >= 5000',
        'Observação: Reason code DV01 — reprovado, Oferta = 0.',
      ].join('\n'),
    );

    expect(result).toEqual({
      businessDescription: 'Bloqueia o cliente com dívida em aberto igual ou superior a R$ 5.000.',
      technicalDefinition: 'Aging > 0 e Valor >= 5000',
      reasonCodes: ['DV01'],
      outcome: 'Reprovado',
      notes: 'Oferta = 0.',
    });
  });

  it('sem Observação: só businessDescription e technicalDefinition', () => {
    const result = recognizeRulePaste(
      [
        'Reprova o pedido originado em sistema legado sem conferência de identidade.',
        'Definição técnica: OrigemSistema in ("LEGADO")',
      ].join('\n'),
    );

    expect(result).toEqual({
      businessDescription: 'Reprova o pedido originado em sistema legado sem conferência de identidade.',
      technicalDefinition: 'OrigemSistema in ("LEGADO")',
    });
  });

  it('reason code múltiplo, separados por vírgula', () => {
    const result = recognizeRulePaste(
      'Bloqueia duplicidade de CPF na base.\nObservação: Reason code DV03, DV04 — reprovado, CPF já cadastrado.',
    );

    expect(result.reasonCodes).toEqual(['DV03', 'DV04']);
    expect(result.outcome).toBe('Reprovado');
    expect(result.notes).toBe('CPF já cadastrado.');
  });

  it('reason code múltiplo, separados por "e"', () => {
    const result = recognizeRulePaste('Texto.\nObservação: Reason code DV01 e DV02 — reprovado.');
    expect(result.reasonCodes).toEqual(['DV01', 'DV02']);
  });

  it('linha vazia no meio do parágrafo não vira parte do texto nem quebra o reconhecimento', () => {
    const result = recognizeRulePaste(
      [
        'Primeira frase do parágrafo.',
        '',
        'Segunda frase do parágrafo.',
        '',
        'Definição técnica: X > 10',
        '',
        'Observação: Reason code DV09 — reprovado, nota final.',
      ].join('\n'),
    );

    expect(result.businessDescription).toBe('Primeira frase do parágrafo. Segunda frase do parágrafo.');
    expect(result.technicalDefinition).toBe('X > 10');
    expect(result.reasonCodes).toEqual(['DV09']);
    expect(result.notes).toBe('nota final.');
  });

  it('só parágrafo, sem nenhum prefixo reconhecido', () => {
    const result = recognizeRulePaste('Texto solto, sem marcador nenhum.');
    expect(result).toEqual({ businessDescription: 'Texto solto, sem marcador nenhum.' });
  });

  it('Observação sem "Reason code" reconhecido vira nota crua, sem quebrar', () => {
    const result = recognizeRulePaste('Texto.\nObservação: revisar com a área de risco.');
    expect(result.reasonCodes).toBeUndefined();
    expect(result.notes).toBe('revisar com a área de risco.');
    expect(result.outcome).toBeUndefined();
  });
});
