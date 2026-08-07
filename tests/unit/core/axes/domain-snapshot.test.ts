import { describe, expect, it } from 'vitest';
import { snapshotDomains } from '@/core/axes/domain-snapshot';
import type { Domain } from '@/core/document/schema';

/**
 * docs/03-modelo-do-documento.md §6.1: o snapshot copia só os campos de
 * identidade, nunca `groupingRanges`.
 */
describe('snapshotDomains', () => {
  it('copia os campos obrigatórios e omite os opcionais ausentes', () => {
    const domains: Domain[] = [{ code: 'R1', label: 'Risco 1', position: 0 }];
    expect(snapshotDomains(domains)).toEqual([{ code: 'R1', label: 'Risco 1', position: 0 }]);
  });

  it('copia shortLabel, color, rangeMin/rangeMax, minInclusive/maxInclusive e isCatchAll quando presentes', () => {
    const domains: Domain[] = [
      {
        code: 'FX1',
        label: 'Faixa 1',
        shortLabel: 'F1',
        position: 0,
        color: '#16A34A',
        rangeMin: '0',
        rangeMax: '100',
        minInclusive: true,
        maxInclusive: false,
        isCatchAll: false,
      },
    ];
    expect(snapshotDomains(domains)).toEqual([
      {
        code: 'FX1',
        label: 'Faixa 1',
        shortLabel: 'F1',
        position: 0,
        color: '#16A34A',
        rangeMin: '0',
        rangeMax: '100',
        minInclusive: true,
        maxInclusive: false,
        isCatchAll: false,
      },
    ]);
  });

  it('nunca copia groupingRanges — a matriz não carrega os agrupamentos', () => {
    const domains: Domain[] = [
      {
        code: 'FX1',
        label: 'Faixa 1',
        position: 0,
        groupingRanges: [
          { path: ['SP', 'MEI'], min: '0', max: '100' },
          { path: ['SUL', 'MEI'], min: '0', max: '120' },
        ],
      },
    ];
    const [snapshot] = snapshotDomains(domains);
    expect(snapshot).not.toHaveProperty('groupingRanges');
    expect(snapshot).toEqual({ code: 'FX1', label: 'Faixa 1', position: 0 });
  });
});
