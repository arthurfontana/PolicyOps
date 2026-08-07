import { describe, expect, it } from 'vitest';
import { buildSeedCells } from '@/core/templates/seed';
import { baseDocument } from '../versioning/fixtures';

const X_TUPLES = ['R1', 'R2', 'R3'];
const Y_TUPLES = ['SEM', 'ALTO'];

describe('buildSeedCells (docs/05 §8)', () => {
  it('aplica defaults a todas as combinações', () => {
    const { cells, skippedRules } = buildSeedCells({
      xTuples: X_TUPLES,
      yTuples: Y_TUPLES,
      defaults: { decision: 'APROVADO' },
      seedRules: [],
      catalog: baseDocument().catalog,
    });
    expect(skippedRules).toEqual([]);
    expect(Object.keys(cells)).toHaveLength(X_TUPLES.length * Y_TUPLES.length);
    for (const cell of Object.values(cells)) expect(cell.decision).toBe('APROVADO');
  });

  it('aplica seedRules em ordem, a última vencendo na mesma célula', () => {
    const { cells } = buildSeedCells({
      xTuples: X_TUPLES,
      yTuples: Y_TUPLES,
      seedRules: [
        { when: {}, set: { decision: 'APROVADO' } },
        { when: { x: ['R1'] }, set: { decision: 'REPROVADO' } },
        { when: { x: ['R1'], y: ['SEM'] }, set: { decision: 'ANALISE_MANUAL' } },
      ],
      catalog: baseDocument().catalog,
    });
    // A última regra que casa R1×SEM vence.
    expect(cells['R1::SEM']!.decision).toBe('ANALISE_MANUAL');
    // R1×ALTO só foi tocada pelas duas primeiras regras — a segunda vence.
    expect(cells['R1::ALTO']!.decision).toBe('REPROVADO');
    // R2 e R3 só foram tocadas pela regra genérica (when vazio).
    expect(cells['R2::SEM']!.decision).toBe('APROVADO');
    expect(cells['R3::ALTO']!.decision).toBe('APROVADO');
  });

  it('mescla campos de regras diferentes na mesma célula em vez de substituir o objeto inteiro', () => {
    const { cells } = buildSeedCells({
      xTuples: ['R1'],
      yTuples: ['SEM'],
      seedRules: [
        { when: {}, set: { decision: 'APROVADO' } },
        { when: {}, set: { offer: 'OFERTA_A' } },
      ],
      catalog: baseDocument().catalog,
    });
    expect(cells['R1::SEM']).toEqual({ decision: 'APROVADO', offer: 'OFERTA_A' });
  });

  it('código de decisão inexistente vai para skippedRules sem quebrar, e não toca nenhuma célula', () => {
    const { cells, skippedRules } = buildSeedCells({
      xTuples: X_TUPLES,
      yTuples: Y_TUPLES,
      seedRules: [{ when: {}, set: { decision: 'CODIGO_QUE_NAO_EXISTE' } }],
      catalog: baseDocument().catalog,
    });
    expect(cells).toEqual({});
    expect(skippedRules).toHaveLength(1);
    expect(skippedRules[0]!.index).toBe(0);
    expect(skippedRules[0]!.reason).toContain('CODIGO_QUE_NAO_EXISTE');
  });

  it('item de catálogo arquivado conta como inexistente para uma regra', () => {
    const { skippedRules } = buildSeedCells({
      xTuples: X_TUPLES,
      yTuples: Y_TUPLES,
      seedRules: [{ when: {}, set: { offer: 'OFERTA_VELHA' } }],
      catalog: baseDocument().catalog,
    });
    expect(skippedRules).toHaveLength(1);
  });

  it('uma regra inválida não impede as outras de serem aplicadas', () => {
    const { cells, skippedRules } = buildSeedCells({
      xTuples: ['R1'],
      yTuples: ['SEM'],
      seedRules: [
        { when: {}, set: { decision: 'NAO_EXISTE' } },
        { when: {}, set: { decision: 'APROVADO' } },
      ],
      catalog: baseDocument().catalog,
    });
    expect(skippedRules).toHaveLength(1);
    expect(cells['R1::SEM']!.decision).toBe('APROVADO');
  });

  it('célula coberta por regra com decisão nasce preenchida; só com oferta continua pendente', () => {
    const { cells } = buildSeedCells({
      xTuples: ['R1', 'R2'],
      yTuples: ['SEM'],
      seedRules: [
        { when: { x: ['R1'] }, set: { decision: 'APROVADO' } },
        { when: { x: ['R2'] }, set: { offer: 'OFERTA_A' } },
      ],
      catalog: baseDocument().catalog,
    });
    expect(cells['R1::SEM']!.decision).toBeDefined();
    expect(cells['R2::SEM']!.decision).toBeUndefined();
    expect(cells['R2::SEM']!.offer).toBe('OFERTA_A');
  });

  it('PathMatcher de prefixo num eixo Y de 2 níveis atinge só o segmento certo', () => {
    const yTuples = ['VAREJO|ATE_100K', 'VAREJO|500K_1M', 'ATACADO|500K_1M', 'ATACADO|ACIMA_10M'];
    const { cells } = buildSeedCells({
      xTuples: ['R1'],
      yTuples,
      seedRules: [{ when: { y: ['VAREJO'] }, set: { decision: 'ANALISE_MANUAL' } }],
      catalog: baseDocument().catalog,
    });
    expect(cells['R1::VAREJO|ATE_100K']!.decision).toBe('ANALISE_MANUAL');
    expect(cells['R1::VAREJO|500K_1M']!.decision).toBe('ANALISE_MANUAL');
    expect(cells['R1::ATACADO|500K_1M']).toBeUndefined();
    expect(cells['R1::ATACADO|ACIMA_10M']).toBeUndefined();
  });

  it('sem defaults nem seedRules não gera nenhuma célula', () => {
    const { cells, skippedRules } = buildSeedCells({
      xTuples: X_TUPLES,
      yTuples: Y_TUPLES,
      seedRules: [],
      catalog: baseDocument().catalog,
    });
    expect(cells).toEqual({});
    expect(skippedRules).toEqual([]);
  });
});
