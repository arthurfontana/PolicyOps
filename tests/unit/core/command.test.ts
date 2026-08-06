import { describe, expect, it } from 'vitest';
import {
  applyToDocument,
  defineCommand,
  IRREVERSIBLE_COMMAND,
  irreversible,
  isIrreversible,
  isoFrom,
  makeEvent,
} from '@/core/command';
import { DomainError } from '@/core/errors';
import { baseDocument, testCtx, T0 } from './versioning/fixtures';

describe('defineCommand', () => {
  it('embrulha o resultado em { ok: true } e carrega rótulo e escopo', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const command = defineCommand({
      type: 'teste/ok',
      input: { valor: 1 },
      label: 'Comando de teste',
      scope: { matrixId: 'm' },
      execute: (document) => ({
        document,
        data: 42,
        events: [],
        inverse: irreversible('sem inverso'),
      }),
    });

    expect(command.type).toBe('teste/ok');
    expect(command.label).toBe('Comando de teste');
    expect(command.scope).toEqual({ matrixId: 'm' });

    const result = command.run(doc, ctx);
    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toBe(42);
  });

  it('omite `scope` quando não informado', () => {
    const command = defineCommand({
      type: 'teste/sem-escopo',
      input: null,
      label: 'Sem escopo',
      execute: (document) => ({
        document,
        data: undefined,
        events: [],
        inverse: irreversible('sem inverso'),
      }),
    });
    expect('scope' in command).toBe(false);
  });

  it('converte DomainError lançado em { ok: false }', () => {
    const command = defineCommand({
      type: 'teste/falha',
      input: null,
      label: 'Falha',
      execute: () => {
        throw new DomainError('INVALID_INPUT', 'deu errado');
      },
    });
    const result = command.run(baseDocument(), testCtx());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('INVALID_INPUT');
  });

  it('deixa passar erro que não é de domínio — bug de programação não vira regra de negócio', () => {
    const command = defineCommand({
      type: 'teste/bug',
      input: null,
      label: 'Bug',
      execute: () => {
        throw new TypeError('undefined is not a function');
      },
    });
    expect(() => command.run(baseDocument(), testCtx())).toThrowError(TypeError);
  });
});

describe('irreversible', () => {
  it('falha sempre, com a mensagem que a interface mostra', () => {
    const command = irreversible('Isto não pode ser desfeito.');
    expect(command.type).toBe(IRREVERSIBLE_COMMAND);
    expect(isIrreversible(command)).toBe(true);
    const result = command.run(baseDocument(), testCtx());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toBe('Isto não pode ser desfeito.');
  });

  it('reconhece um comando comum como inversível', () => {
    expect(
      isIrreversible(
        defineCommand({
          type: 'teste/normal',
          input: null,
          label: 'Normal',
          execute: (document) => ({
            document,
            data: undefined,
            events: [],
            inverse: irreversible('x'),
          }),
        }),
      ),
    ).toBe(false);
  });
});

describe('eventos', () => {
  it('carimba id, hora e ator vindos do ctx', () => {
    const ctx = testCtx('Marina');
    const event = makeEvent(ctx, {
      type: 'NOTE_ADDED',
      scope: { versionId: 'v' },
      summary: 'Marina anotou.',
    });
    expect(event).toEqual({
      id: 'id-000000001',
      at: T0,
      actor: 'Marina',
      type: 'NOTE_ADDED',
      scope: { versionId: 'v' },
      summary: 'Marina anotou.',
    });
    expect('payload' in event).toBe(false);
  });

  it('anexa os eventos no fim de `events` e não muta o documento recebido', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const antes = structuredClone(doc);
    const event = makeEvent(ctx, {
      type: 'NOTE_ADDED',
      scope: {},
      summary: 'Anotação.',
      payload: { text: 'oi' },
    });

    const next = applyToDocument(doc, [event], (draft) => {
      draft.meta.name = 'Renomeado';
    });

    expect(doc).toEqual(antes);
    expect(next.meta.name).toBe('Renomeado');
    expect(next.events).toHaveLength(doc.events.length + 1);
    expect(next.events[next.events.length - 1]).toEqual(event);
  });

  it('congela o documento devolvido — mutar por fora estoura na hora', () => {
    const next = applyToDocument(baseDocument(), [], (draft) => {
      draft.meta.name = 'Congelado';
    });
    expect(Object.isFrozen(next)).toBe(true);
    expect(() => {
      (next.meta as { name: string }).name = 'na marra';
    }).toThrowError(TypeError);
  });
});

describe('isoFrom', () => {
  it('produz ISO 8601 UTC com milissegundos', () => {
    expect(isoFrom(new Date(Date.UTC(2026, 7, 6, 14, 32, 0, 0)))).toBe('2026-08-06T14:32:00.000Z');
  });
});
