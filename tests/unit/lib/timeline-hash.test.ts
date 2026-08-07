// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildTimelineHash, parseTimelineHash } from '@/lib/timeline-hash';

/**
 * O link compartilhável da tela de vigência — docs/07-ux-e-editor.md §10:
 * "o link com a data no hash abre a mesma visão para outra pessoa".
 */
describe('parseTimelineHash', () => {
  it('lê date e project da query string do hash', () => {
    expect(parseTimelineHash('#/timeline?date=2026-03-15&project=abc123')).toEqual({
      date: '2026-03-15',
      projectId: 'abc123',
    });
  });

  it('sem query string, devolve os dois como null', () => {
    expect(parseTimelineHash('#/timeline')).toEqual({ date: null, projectId: null });
  });

  it('com só um dos parâmetros, o outro fica null', () => {
    expect(parseTimelineHash('#/timeline?date=2026-01-01')).toEqual({ date: '2026-01-01', projectId: null });
  });
});

describe('buildTimelineHash', () => {
  it('monta a query string com os dois parâmetros', () => {
    expect(buildTimelineHash({ date: '2026-03-15', projectId: 'abc123' })).toBe(
      '#/timeline?date=2026-03-15&project=abc123',
    );
  });

  it('sem nenhum parâmetro, devolve o hash puro', () => {
    expect(buildTimelineHash({ date: null, projectId: null })).toBe('#/timeline');
  });

  it('é o inverso de parseTimelineHash', () => {
    const params = { date: '2026-06-01', projectId: 'xyz987' };
    expect(parseTimelineHash(buildTimelineHash(params))).toEqual(params);
  });
});
