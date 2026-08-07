import { describe, expect, it } from 'vitest';
import { diffVersions } from '@/core/diff';
import {
  APPROVING_DECISION_CODES,
  isApprovingDecision,
  isReprovingDecision,
  summaryToText,
} from '@/core/diff/semantics';
import { EMPTY_DIFF_SUMMARY, type DiffSummary } from '@/core/diff/types';
import { oneCellChanged, V1, V2 } from './fixtures';

/**
 * Cada métrica de docs/05-regras-de-negocio.md §4.3, isolada, com caso
 * positivo e caso negativo — o critério de teste explícito da S14.
 */

function summaryOf(before: Parameters<typeof oneCellChanged>[0], after: Parameters<typeof oneCellChanged>[1]): DiffSummary {
  const doc = oneCellChanged(before, after);
  return diffVersions(doc, V1, V2).summary;
}

describe('APPROVING_DECISION_CODES', () => {
  it('é o único ponto que sabe o que é decisão aprovadora, e vem do code', () => {
    expect(APPROVING_DECISION_CODES).toEqual(['APROVADO', 'EXCECAO']);
    expect(isApprovingDecision('APROVADO')).toBe(true);
    expect(isApprovingDecision('EXCECAO')).toBe(true);
    expect(isApprovingDecision('REPROVADO')).toBe(false);
    expect(isApprovingDecision('ANALISE_MANUAL')).toBe(false);
    expect(isApprovingDecision(undefined)).toBe(false);
  });

  it('célula sem decisão não é reprovadora — nunca chegou a fechar nada', () => {
    expect(isReprovingDecision(undefined)).toBe(false);
    expect(isReprovingDecision('REPROVADO')).toBe(true);
    expect(isReprovingDecision('ANALISE_MANUAL')).toBe(true);
    expect(isReprovingDecision('APROVADO')).toBe(false);
  });
});

describe('cellsOpened', () => {
  it('conta quando a decisão passa de reprovadora para aprovadora', () => {
    expect(summaryOf({ decision: 'REPROVADO' }, { decision: 'APROVADO' }).cellsOpened).toBe(1);
  });

  it('EXCECAO também é aprovadora — vem do code, não da cor', () => {
    expect(summaryOf({ decision: 'ANALISE_MANUAL' }, { decision: 'EXCECAO' }).cellsOpened).toBe(1);
  });

  it('não conta quando a decisão já era aprovadora', () => {
    expect(summaryOf({ decision: 'APROVADO' }, { decision: 'EXCECAO' }).cellsOpened).toBe(0);
  });

  it('não conta quando a célula não tinha decisão — preencher não é abrir', () => {
    expect(summaryOf({ note: 'sem decisão' }, { decision: 'APROVADO' }).cellsOpened).toBe(0);
  });
});

describe('cellsClosed', () => {
  it('conta quando a decisão passa de aprovadora para REPROVADO', () => {
    expect(summaryOf({ decision: 'APROVADO' }, { decision: 'REPROVADO' }).cellsClosed).toBe(1);
  });

  it('não conta quando vai de aprovadora para análise manual', () => {
    const summary = summaryOf({ decision: 'APROVADO' }, { decision: 'ANALISE_MANUAL' });
    expect(summary.cellsClosed).toBe(0);
    expect(summary.cellsToManualReview).toBe(1);
  });
});

describe('cellsToManualReview', () => {
  it('conta quando a decisão passa para ANALISE_MANUAL', () => {
    expect(
      summaryOf({ decision: 'REPROVADO' }, { decision: 'ANALISE_MANUAL' }).cellsToManualReview,
    ).toBe(1);
  });

  it('não conta quando a decisão sai de ANALISE_MANUAL', () => {
    expect(
      summaryOf({ decision: 'ANALISE_MANUAL' }, { decision: 'REPROVADO' }).cellsToManualReview,
    ).toBe(0);
  });
});

describe('offersChanged', () => {
  it('conta quando a oferta muda', () => {
    expect(
      summaryOf(
        { decision: 'APROVADO', offer: 'OFERTA_A' },
        { decision: 'APROVADO', offer: 'OFERTA_B' },
      ).offersChanged,
    ).toBe(1);
  });

  it('não conta quando só a decisão muda', () => {
    expect(
      summaryOf(
        { decision: 'APROVADO', offer: 'OFERTA_A' },
        { decision: 'REPROVADO', offer: 'OFERTA_A' },
      ).offersChanged,
    ).toBe(0);
  });

  it('não reconta células adicionadas nem removidas', () => {
    const added = oneCellChanged({ offer: 'OFERTA_A' }, { offer: 'OFERTA_A' });
    // A célula some de v2 e nasce outra, em coordenada diferente: uma
    // removida e uma adicionada, nenhuma "oferta alterada".
    added.matrices[0]!.versions[1]!.cells = { 'R2::SEM': { offer: 'OFERTA_B' } };
    const diff = diffVersions(added, V1, V2);
    expect(diff.cells.map((change) => change.kind).sort()).toEqual(['ADDED', 'REMOVED']);
    expect(diff.summary.offersChanged).toBe(0);
  });
});

describe('limitsIncreased e limitsDecreased', () => {
  it('compara o valor do catálogo quando não há override', () => {
    // Sem `limit` → com `LIM_1000`: ganhou limite, conta como aumento.
    const gained = summaryOf({ decision: 'APROVADO' }, { decision: 'APROVADO', limit: 'LIM_1000' });
    expect(gained.limitsIncreased).toBe(1);
    expect(gained.limitsDecreased).toBe(0);

    const lost = summaryOf({ decision: 'APROVADO', limit: 'LIM_1000' }, { decision: 'APROVADO' });
    expect(lost.limitsDecreased).toBe(1);
    expect(lost.limitsIncreased).toBe(0);
  });

  it('limitOverride vence o valor do catálogo, nos dois sentidos', () => {
    // LIM_1000 vale 1000 no catálogo; o override de 1500 é um aumento.
    const up = summaryOf(
      { decision: 'APROVADO', limit: 'LIM_1000' },
      { decision: 'APROVADO', limit: 'LIM_1000', limitOverride: '1500' },
    );
    expect(up.limitsIncreased).toBe(1);

    const down = summaryOf(
      { decision: 'APROVADO', limit: 'LIM_1000', limitOverride: '1500' },
      { decision: 'APROVADO', limit: 'LIM_1000', limitOverride: '750.50' },
    );
    expect(down.limitsDecreased).toBe(1);
  });

  it('override igual ao valor do catálogo não é mudança de limite', () => {
    const summary = summaryOf(
      { decision: 'APROVADO', limit: 'LIM_1000' },
      { decision: 'APROVADO', limit: 'LIM_1000', limitOverride: '1000.00' },
    );
    expect(summary.limitsIncreased).toBe(0);
    expect(summary.limitsDecreased).toBe(0);
  });

  it('compara em Decimal, não em ponto flutuante', () => {
    // 0.1 + 0.2 !== 0.3 em binário; em Decimal, "0.30" e "0.3" são iguais.
    const summary = summaryOf(
      { decision: 'APROVADO', limitOverride: '0.3' },
      { decision: 'APROVADO', limitOverride: '0.30' },
    );
    expect(summary.limitsIncreased).toBe(0);
    expect(summary.limitsDecreased).toBe(0);

    const tiny = summaryOf(
      { decision: 'APROVADO', limitOverride: '10000000000000000.01' },
      { decision: 'APROVADO', limitOverride: '10000000000000000.02' },
    );
    expect(tiny.limitsIncreased).toBe(1);
  });
});

describe('notesChanged e colorsChanged', () => {
  it('contam nota e cor separadamente', () => {
    const summary = summaryOf(
      { decision: 'APROVADO' },
      { decision: 'APROVADO', note: 'revisar em 2027', color: '#123456' },
    );
    expect(summary.notesChanged).toBe(1);
    expect(summary.colorsChanged).toBe(1);
  });

  it('célula que mudou só a cor não conta como aberta nem fechada', () => {
    const summary = summaryOf(
      { decision: 'APROVADO', color: '#111111' },
      { decision: 'APROVADO', color: '#222222' },
    );
    expect(summary.colorsChanged).toBe(1);
    expect(summary.cellsOpened).toBe(0);
    expect(summary.cellsClosed).toBe(0);
    expect(summary.cellsToManualReview).toBe(0);
  });
});

describe('summaryText', () => {
  it('omite as métricas zeradas e usa a linguagem do negócio', () => {
    expect(
      summaryToText({
        ...EMPTY_DIFF_SUMMARY,
        cellsOpened: 12,
        cellsClosed: 8,
        offersChanged: 4,
        limitsIncreased: 2,
      }),
    ).toEqual(['12 células abertas', '8 células fechadas', '4 ofertas alteradas', '2 limites aumentados']);
  });

  it('concorda em número no singular', () => {
    expect(
      summaryToText({
        ...EMPTY_DIFF_SUMMARY,
        cellsOpened: 1,
        cellsClosed: 1,
        cellsToManualReview: 1,
        offersChanged: 1,
        limitsIncreased: 1,
        limitsDecreased: 1,
        combinationsAdded: 1,
        combinationsRemoved: 1,
        notesChanged: 1,
        colorsChanged: 1,
      }),
    ).toEqual([
      '1 célula aberta',
      '1 célula fechada',
      '1 célula enviada para análise manual',
      '1 oferta alterada',
      '1 limite aumentado',
      '1 limite reduzido',
      '1 combinação nova',
      '1 combinação removida',
      '1 observação alterada',
      '1 cor alterada',
    ]);
  });

  it('resumo zerado não produz nenhuma frase', () => {
    expect(summaryToText(EMPTY_DIFF_SUMMARY)).toEqual([]);
  });
});
