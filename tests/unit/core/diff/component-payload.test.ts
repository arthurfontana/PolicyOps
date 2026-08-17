import { describe, expect, it } from 'vitest';
import { diffComponentPayloads } from '@/core/diff/component-payload';

/**
 * Diff de payload campo a campo (S36, docs/14 §8) — a metade estruturada do
 * "atual × proposto rico" da revisão do DB.
 */

describe('diffComponentPayloads', () => {
  it('marca campo alterado, incluído e removido', () => {
    const diff = diffComponentPayloads(
      {
        kind: 'RULE',
        businessDescription: 'Aprova sempre que estiver na lista.',
        technicalDefinition: 'lista.contem(cpf)',
        notes: 'Regra antiga.',
      },
      {
        kind: 'RULE',
        businessDescription: 'Aprova só até o limite em lista.',
        technicalDefinition: 'lista.contem(cpf)',
        outcome: 'Aprovar',
      },
    );

    expect(diff.comparable).toBe(true);
    expect(diff.hasChanges).toBe(true);
    expect(diff.changes).toEqual([
      {
        field: 'businessDescription',
        kind: 'CHANGED',
        before: 'Aprova sempre que estiver na lista.',
        after: 'Aprova só até o limite em lista.',
      },
      {
        field: 'technicalDefinition',
        kind: 'UNCHANGED',
        before: 'lista.contem(cpf)',
        after: 'lista.contem(cpf)',
      },
      { field: 'notes', kind: 'REMOVED', before: 'Regra antiga.', after: null },
      { field: 'outcome', kind: 'ADDED', before: null, after: 'Aprovar' },
    ]);
  });

  it('lista de textos vira uma linha só, e lista vazia é ausência', () => {
    const diff = diffComponentPayloads(
      { kind: 'RULE', businessDescription: 'x', inputs: ['CPF', 'Valor'], reasonCodes: [] },
      { kind: 'RULE', businessDescription: 'x', inputs: ['CPF', 'Valor', 'Canal'], reasonCodes: ['DV01'] },
    );

    expect(diff.changes).toContainEqual({
      field: 'inputs',
      kind: 'CHANGED',
      before: 'CPF, Valor',
      after: 'CPF, Valor, Canal',
    });
    expect(diff.changes).toContainEqual({
      field: 'reasonCodes',
      kind: 'ADDED',
      before: null,
      after: 'DV01',
    });
  });

  it('item CREATE: sem "antes", tudo é novo', () => {
    const diff = diffComponentPayloads(undefined, {
      kind: 'RULE',
      businessDescription: 'Regra que ainda não existe.',
    });

    expect(diff.comparable).toBe(true);
    expect(diff.changes).toEqual([
      {
        field: 'businessDescription',
        kind: 'ADDED',
        before: null,
        after: 'Regra que ainda não existe.',
      },
    ]);
  });

  it('sem "depois", tudo é removido', () => {
    const diff = diffComponentPayloads({ kind: 'OTHER', businessDescription: 'Some.' }, undefined);
    expect(diff.changes).toEqual([
      { field: 'businessDescription', kind: 'REMOVED', before: 'Some.', after: null },
    ]);
  });

  it('payloads de tipos diferentes não são comparáveis, mas ainda listam os campos', () => {
    const diff = diffComponentPayloads(
      { kind: 'RULE', businessDescription: 'Uma regra.' },
      { kind: 'LIST', businessDescription: 'Uma lista.', purpose: 'Bloquear' },
    );

    expect(diff.comparable).toBe(false);
    expect(diff.changes.map((change) => change.field)).toEqual(['businessDescription', 'purpose']);
  });

  it('dois payloads idênticos não têm mudança nenhuma', () => {
    const diff = diffComponentPayloads(
      { kind: 'OTHER', businessDescription: 'Igual.' },
      { kind: 'OTHER', businessDescription: 'Igual.' },
    );
    expect(diff.hasChanges).toBe(false);
  });

  it('texto em branco conta como ausência, não como mudança de conteúdo', () => {
    const diff = diffComponentPayloads(
      { kind: 'OTHER', businessDescription: 'Texto.', notes: '   ' } as never,
      { kind: 'OTHER', businessDescription: 'Texto.' },
    );
    expect(diff.hasChanges).toBe(false);
  });

  it('dois ausentes é um diff vazio', () => {
    expect(diffComponentPayloads(undefined, undefined)).toEqual({
      comparable: true,
      changes: [],
      hasChanges: false,
    });
  });
});
