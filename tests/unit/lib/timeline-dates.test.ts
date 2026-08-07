import { describe, expect, it } from 'vitest';
import {
  DATE_SHORTCUTS,
  endOfDayInstant,
  formatDateInputBR,
  fromDateInputValue,
  toDateInputValue,
} from '@/lib/timeline-dates';

describe('toDateInputValue e fromDateInputValue', () => {
  it('são inversas', () => {
    const date = new Date(2026, 2, 15); // 15/03/2026, fuso local
    expect(toDateInputValue(date)).toBe('2026-03-15');
    expect(fromDateInputValue('2026-03-15')).toEqual(date);
  });

  it('preenche mês e dia com zero à esquerda', () => {
    expect(toDateInputValue(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('endOfDayInstant', () => {
  it('devolve 23:59:59.999 local do dia informado', () => {
    const instant = endOfDayInstant('2026-03-15');
    expect(instant.getFullYear()).toBe(2026);
    expect(instant.getMonth()).toBe(2);
    expect(instant.getDate()).toBe(15);
    expect(instant.getHours()).toBe(23);
    expect(instant.getMinutes()).toBe(59);
    expect(instant.getSeconds()).toBe(59);
    expect(instant.getMilliseconds()).toBe(999);
  });
});

describe('formatDateInputBR', () => {
  it('yyyy-MM-dd vira dd/mm/aaaa sem passar por Date (sem risco de fuso)', () => {
    expect(formatDateInputBR('2026-03-15')).toBe('15/03/2026');
  });
});

describe('DATE_SHORTCUTS', () => {
  it('tem os 5 atalhos de docs/07 §10, na ordem', () => {
    expect(DATE_SHORTCUTS.map((s) => s.label)).toEqual([
      'Hoje',
      'Início do mês',
      '30 dias atrás',
      '90 dias atrás',
      'Início do ano',
    ]);
  });

  it('"Início do mês" resolve para o dia 1 do mês corrente', () => {
    const shortcut = DATE_SHORTCUTS.find((s) => s.label === 'Início do mês')!;
    const resolved = shortcut.resolve();
    expect(resolved.getDate()).toBe(1);
  });

  it('"30 dias atrás" resolve para uma data anterior a hoje', () => {
    const shortcut = DATE_SHORTCUTS.find((s) => s.label === '30 dias atrás')!;
    expect(shortcut.resolve().getTime()).toBeLessThan(Date.now());
  });
});
