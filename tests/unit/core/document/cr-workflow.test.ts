import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  assertItemsEditable,
  assertSubmittable,
  assertTransitionAllowed,
  canTransition,
  crStatusRank,
  CR_TRANSITIONS,
  isChangeRequestClosed,
  isChangeRequestFrozen,
  missingForSubmit,
  PUBLISHED_REACHED_BY,
} from '@/core/document/cr-workflow';
import { DomainError } from '@/core/errors';
import { CR_STATUSES, type ChangeRequest, type CrStatus } from '@/core/document/schema';

/**
 * O grafo de estados do DB — docs/14 §5, RN-GOV-01.
 *
 * A tabela `ESPERADO` abaixo é escrita **do texto de docs/14 §5**, não do
 * código: é ela que responde "nenhuma transição fora do grafo passa", e é o
 * único lugar em que o grafo é transcrito duas vezes de propósito. Se alguém
 * mudar `CR_TRANSITIONS` sem mudar §5, o teste da varredura 12 × 12 cai.
 */

const ESPERADO: Record<CrStatus, CrStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['IN_REVIEW', 'CANCELLED'],
  IN_REVIEW: ['CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED'],
  CHANGES_REQUESTED: ['DRAFT', 'CANCELLED'],
  APPROVED: ['IN_DEVELOPMENT', 'CANCELLED'],
  REJECTED: ['CANCELLED'],
  IN_DEVELOPMENT: ['IN_VALIDATION', 'CANCELLED'],
  IN_VALIDATION: ['READY_FOR_RELEASE', 'CANCELLED'],
  READY_FOR_RELEASE: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: [],
  CANCELLED: [],
};

function db(status: CrStatus, overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 'cr0000000001',
    code: 'DB_515',
    title: 'Goodlist',
    status,
    motivators: [],
    requestedBy: 'Arthur',
    items: [],
    acceptanceCriteria: [],
    testScenarios: [],
    impacts: [],
    approvals: [],
    events: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function erro(run: () => void): DomainError {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('Esperava um DomainError, e a chamada passou.');
}

describe('grafo de estados (RN-GOV-01)', () => {
  it('transcreve exatamente o grafo de docs/14 §5, os 12 estados incluídos', () => {
    expect(Object.keys(CR_TRANSITIONS).sort()).toEqual([...CR_STATUSES].sort());
    for (const status of CR_STATUSES) {
      expect(CR_TRANSITIONS[status], `saídas de ${status}`).toEqual(ESPERADO[status]);
    }
  });

  it('aceita todas as transições válidas e recusa todas as outras (varredura 12 × 12)', () => {
    for (const from of CR_STATUSES) {
      for (const to of CR_STATUSES) {
        const valida = ESPERADO[from].includes(to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(valida);

        if (valida && to !== 'PUBLISHED') {
          expect(() => assertTransitionAllowed(db(from), to)).not.toThrow();
          continue;
        }
        const error = erro(() => assertTransitionAllowed(db(from), to));
        expect(error.code, `${from} → ${to}`).toBe('CR_TRANSITION_INVALID');
      }
    }
  });

  it('PUBLISHED nunca é alcançável por transição, nem a partir de SCHEDULED', () => {
    const error = erro(() => assertTransitionAllowed(db('SCHEDULED'), 'PUBLISHED'));
    expect(error.code).toBe('CR_TRANSITION_INVALID');
    expect(error.message).toContain(PUBLISHED_REACHED_BY);
    // A aresta existe no grafo — quem a percorre é a publicação da S36.
    expect(canTransition('SCHEDULED', 'PUBLISHED')).toBe(true);
    expect(allowedTransitions('SCHEDULED')).toEqual(['CANCELLED']);
  });

  it('recusa a transição para o próprio estado, com mensagem específica', () => {
    const error = erro(() => assertTransitionAllowed(db('IN_REVIEW'), 'IN_REVIEW'));
    expect(error.code).toBe('CR_TRANSITION_INVALID');
    expect(error.message).toContain('já está em IN_REVIEW');
  });

  it('diz que o estado é final quando não há para onde ir', () => {
    const error = erro(() => assertTransitionAllowed(db('CANCELLED'), 'DRAFT'));
    expect(error.message).toContain('estado final');
    expect(allowedTransitions('PUBLISHED')).toEqual([]);
  });

  it('lista os destinos possíveis na mensagem de recusa', () => {
    const error = erro(() => assertTransitionAllowed(db('DRAFT'), 'APPROVED'));
    expect(error.message).toContain('SUBMITTED, CANCELLED');
    expect(error.details).toMatchObject({ from: 'DRAFT', to: 'APPROVED' });
  });
});

describe('ordem dos estados e congelamento (I30)', () => {
  it('ordena os estados como CR_STATUSES, que é a ordem de docs/14 §5', () => {
    expect(crStatusRank('DRAFT')).toBe(0);
    expect(crStatusRank('APPROVED')).toBeLessThan(crStatusRank('IN_DEVELOPMENT'));
    expect(crStatusRank('CANCELLED')).toBe(CR_STATUSES.length - 1);
  });

  it('congela os itens de APPROVED em diante — inclusive nos estados fechados', () => {
    const congelados: CrStatus[] = [
      'APPROVED',
      'REJECTED',
      'IN_DEVELOPMENT',
      'IN_VALIDATION',
      'READY_FOR_RELEASE',
      'SCHEDULED',
      'PUBLISHED',
      'CANCELLED',
    ];
    const editaveis: CrStatus[] = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED'];

    for (const status of congelados) {
      expect(isChangeRequestFrozen(status), status).toBe(true);
      expect(erro(() => assertItemsEditable(db(status))).code).toBe('CR_TRANSITION_INVALID');
    }
    for (const status of editaveis) {
      expect(isChangeRequestFrozen(status), status).toBe(false);
      expect(() => assertItemsEditable(db(status))).not.toThrow();
    }
  });

  it('trata publicado, rejeitado e cancelado como fechados', () => {
    for (const status of CR_STATUSES) {
      const fechado = status === 'PUBLISHED' || status === 'REJECTED' || status === 'CANCELLED';
      expect(isChangeRequestClosed(status), status).toBe(fechado);
    }
  });
});

describe('RN-GOV-03 — o que falta para submeter', () => {
  const completo = db('DRAFT', {
    motivators: ['RISCO'],
    items: [{ componentId: 'cmp000000001', changeType: 'UPDATE', proposedSummary: 'Proposto' }],
    proposedEffectiveDate: '2026-09-01T00:00:00.000Z',
  });

  it('não cobra nada de um DB completo', () => {
    expect(missingForSubmit(completo)).toEqual([]);
    expect(() => assertSubmittable(completo)).not.toThrow();
  });

  it('cobra motivador, item e vigência, um a um', () => {
    expect(missingForSubmit({ ...completo, motivators: [] })).toEqual(['MOTIVATOR']);
    expect(missingForSubmit({ ...completo, items: [] })).toEqual(['ITEM']);
    const semVigencia = { ...completo };
    delete semVigencia.proposedEffectiveDate;
    expect(missingForSubmit(semVigencia)).toEqual(['EFFECTIVE_DATE']);
  });

  it('não aceita item com proposto em branco como item', () => {
    const branco = {
      ...completo,
      items: [{ componentId: 'cmp000000001', changeType: 'UPDATE' as const, proposedSummary: '   ' }],
    };
    expect(missingForSubmit(branco)).toEqual(['ITEM']);
  });

  it('falha com E-GOV-03 listando tudo que falta', () => {
    const vazio = db('DRAFT');
    const error = erro(() => assertSubmittable(vazio));
    expect(error.code).toBe('CR_INCOMPLETE');
    expect(error.message).toContain('ao menos um motivador');
    expect(error.message).toContain('a vigência pretendida');
    expect(error.details).toMatchObject({ missing: ['MOTIVATOR', 'ITEM', 'EFFECTIVE_DATE'] });
  });
});
