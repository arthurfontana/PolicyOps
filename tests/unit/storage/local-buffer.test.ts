import { describe, expect, it } from 'vitest';
import { createSampleDocument } from '@/core/document/create';
import type { PolicyOpsDocument } from '@/core/document/schema';
import {
  AUTOSAVE_DEBOUNCE_MS,
  LocalBuffer,
  MAX_BUFFER_ENTRIES,
  isBufferNewer,
  memoryBufferStore,
} from '@/storage/local-buffer';

/** Autosave e recuperação — docs/06-persistencia-e-concorrencia.md §8 e §11. */

type Timer = { handler: () => void; ms: number };

function buildBuffer(options?: { start?: Date }) {
  const store = memoryBufferStore();
  const clock = { current: options?.start ?? new Date('2026-08-05T14:32:00.000Z') };
  const timers: Timer[] = [];

  const buffer = new LocalBuffer({
    store,
    now: () => clock.current,
    setTimeout: (handler, ms) => {
      timers.push({ handler, ms });
      return timers.length;
    },
    clearTimeout: (id) => {
      timers[id - 1] = { handler: () => undefined, ms: 0 };
    },
  });

  return {
    store,
    buffer,
    clock,
    timers,
    /** Dispara o último temporizador agendado. */
    fire: async () => {
      timers[timers.length - 1]!.handler();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    advance: (ms: number) => {
      clock.current = new Date(clock.current.getTime() + ms);
    },
  };
}

function withRevision(doc: PolicyOpsDocument, revision: number, savedAt: string | null) {
  return { ...doc, meta: { ...doc.meta, revision, savedAt } };
}

describe('debounce de 3 s', () => {
  it('agenda a gravação com 3 s e só grava quando o tempo passa', async () => {
    const { buffer, store, timers, fire } = buildBuffer();
    const doc = createSampleDocument();

    buffer.schedule(doc);
    expect(timers[timers.length - 1]!.ms).toBe(AUTOSAVE_DEBOUNCE_MS);
    expect(store.entries.size).toBe(0);

    await fire();
    expect(store.entries.size).toBe(1);
    expect([...store.entries.values()][0]!.document.meta.id).toBe(doc.meta.id);
  });

  it('mudanças em sequência gravam uma vez só, com o último estado', async () => {
    const { buffer, store, fire } = buildBuffer();
    const doc = createSampleDocument();

    buffer.schedule(doc);
    buffer.schedule({ ...doc, meta: { ...doc.meta, name: 'Segundo' } });
    buffer.schedule({ ...doc, meta: { ...doc.meta, name: 'Terceiro' } });
    await fire();

    expect(store.entries.size).toBe(1);
    expect([...store.entries.values()][0]!.document.meta.name).toBe('Terceiro');
  });

  it('cancelar descarta o que estava agendado', async () => {
    const { buffer, store, fire } = buildBuffer();
    buffer.schedule(createSampleDocument());
    buffer.cancel();
    await fire();
    expect(store.entries.size).toBe(0);
  });
});

describe('rodízio dos 10 últimos estados', () => {
  it('guarda no máximo 10 por documento, descartando os mais antigos', async () => {
    const { buffer, store, advance, fire } = buildBuffer();
    const doc = createSampleDocument();

    for (let i = 1; i <= MAX_BUFFER_ENTRIES + 5; i++) {
      buffer.schedule({ ...doc, meta: { ...doc.meta, name: `Estado ${i}` } });
      await fire();
      advance(1000);
    }

    const entries = await buffer.entriesFor(doc.meta.id);
    expect(store.entries.size).toBe(MAX_BUFFER_ENTRIES);
    expect(entries[0]!.document.meta.name).toBe('Estado 6');
    expect(entries[entries.length - 1]!.document.meta.name).toBe(
      `Estado ${MAX_BUFFER_ENTRIES + 5}`,
    );
  });

  it('documentos diferentes não disputam a mesma cota', async () => {
    const { buffer, fire, advance } = buildBuffer();
    const a = createSampleDocument();
    const b = { ...createSampleDocument(), meta: { ...createSampleDocument().meta, id: 'outrodoc123' } };

    buffer.schedule(a);
    await fire();
    advance(1000);
    buffer.schedule(b as PolicyOpsDocument);
    await fire();

    expect(await buffer.entriesFor(a.meta.id)).toHaveLength(1);
    expect(await buffer.entriesFor('outrodoc123')).toHaveLength(1);
  });
});

describe('isBufferNewer', () => {
  const doc = withRevision(createSampleDocument(), 5, '2026-08-05T10:00:00.000Z');
  const entry = {
    key: 'k',
    docId: doc.meta.id,
    revision: 5,
    savedAt: '2026-08-05T11:00:00.000Z',
    document: doc,
  };

  it('é mais novo com revisão maior', () => {
    expect(isBufferNewer({ ...entry, revision: 6 }, doc)).toBe(true);
  });

  it('é mais novo com savedAt posterior na mesma revisão', () => {
    expect(isBufferNewer(entry, doc)).toBe(true);
  });

  it('não é mais novo com revisão menor', () => {
    expect(isBufferNewer({ ...entry, revision: 4 }, doc)).toBe(false);
  });

  it('não é mais novo quando o arquivo já foi salvo depois', () => {
    expect(
      isBufferNewer({ ...entry, savedAt: '2026-08-05T09:00:00.000Z' }, doc),
    ).toBe(false);
  });

  it('ignora buffer de outro documento', () => {
    expect(isBufferNewer({ ...entry, docId: 'outro0000000' }, doc)).toBe(false);
  });

  it('documento nunca salvo com buffer é sempre recuperável', () => {
    const unsaved = withRevision(createSampleDocument(), 0, null);
    expect(
      isBufferNewer({ ...entry, docId: unsaved.meta.id, revision: 0 }, unsaved),
    ).toBe(true);
  });
});

describe('ciclo abrir → mudar → salvar', () => {
  it('mudança grava buffer, salvar limpa buffer, abrir com buffer mais novo oferece recuperação', async () => {
    const { buffer, store, fire, advance } = buildBuffer();
    const arquivo = withRevision(createSampleDocument(), 3, '2026-08-05T10:00:00.000Z');

    // 1. mudança → buffer gravado
    buffer.schedule({ ...arquivo, meta: { ...arquivo.meta, name: 'Editado sem salvar' } });
    await fire();
    expect(store.entries.size).toBe(1);

    // 2. abrir o arquivo com buffer mais novo → oferece recuperação
    const offer = await buffer.recoveryOffer(arquivo);
    expect(offer).not.toBeNull();
    expect(offer!.document.meta.name).toBe('Editado sem salvar');

    // 3. salvar → buffer limpo
    await buffer.clearFor(arquivo.meta.id);
    expect(store.entries.size).toBe(0);
    expect(await buffer.recoveryOffer(arquivo)).toBeNull();

    // 4. e um buffer velho, de antes do salvamento, não oferece nada
    advance(1000);
    buffer.schedule(arquivo);
    await fire();
    const salvoDepois = withRevision(arquivo, 4, '2026-08-05T15:00:00.000Z');
    expect(await buffer.recoveryOffer(salvoDepois)).toBeNull();
  });
});

describe('falha de gravação', () => {
  it('não derruba a edição: avisa e segue', async () => {
    const errors: unknown[] = [];
    const store = memoryBufferStore();
    store.put = () => Promise.reject(new Error('cota estourada'));
    let handler: (() => void) | null = null;

    const buffer = new LocalBuffer({
      store,
      onError: (error) => errors.push(error),
      setTimeout: (fn) => {
        handler = fn;
        return 1;
      },
      clearTimeout: () => undefined,
    });

    buffer.schedule(createSampleDocument());
    handler!();
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toHaveLength(1);
  });
});
