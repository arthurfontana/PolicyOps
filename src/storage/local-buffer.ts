import type { PolicyOpsDocument } from '@/core/document/schema';
import { indexedDbAvailable, openDatabase, requestToPromise, withStore } from './idb';

/**
 * Autosave e recuperação — docs/06-persistencia-e-concorrencia.md §8.
 *
 * Independente do modo, e **sempre ligado**. A cada mudança, com debounce de
 * 3 s, o documento vai para o IndexedDB local; guarda os 10 últimos estados
 * em rodízio; ao abrir, se houver buffer mais novo que o arquivo, a
 * aplicação oferece recuperar.
 *
 * É o que cobre queda do navegador e fechamento acidental — num produto sem
 * servidor, a principal causa de perda.
 */

export const AUTOSAVE_DEBOUNCE_MS = 3_000;
export const MAX_BUFFER_ENTRIES = 10;
export const BUFFER_DB_NAME = 'policyops-buffer';
export const BUFFER_STORE_NAME = 'snapshots';

export type BufferEntry = {
  /** `${docId}:${carimbo}` — chave primária. */
  key: string;
  docId: string;
  revision: number;
  /** Momento em que o buffer foi gravado (não é `meta.savedAt`). */
  savedAt: string;
  document: PolicyOpsDocument;
};

/** Porta de armazenamento: IndexedDB no navegador, memória nos testes. */
export interface BufferStorePort {
  put(entry: BufferEntry): Promise<void>;
  allFor(docId: string): Promise<BufferEntry[]>;
  deleteKeys(keys: string[]): Promise<void>;
  deleteFor(docId: string): Promise<void>;
}

export function memoryBufferStore(): BufferStorePort & { entries: Map<string, BufferEntry> } {
  const entries = new Map<string, BufferEntry>();
  return {
    entries,
    put: (entry) => {
      entries.set(entry.key, entry);
      return Promise.resolve();
    },
    allFor: (docId) =>
      Promise.resolve([...entries.values()].filter((entry) => entry.docId === docId)),
    deleteKeys: (keys) => {
      for (const key of keys) entries.delete(key);
      return Promise.resolve();
    },
    deleteFor: (docId) => {
      for (const [key, entry] of entries) if (entry.docId === docId) entries.delete(key);
      return Promise.resolve();
    },
  };
}

export function indexedDbBufferStore(): BufferStorePort {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const db = (): Promise<IDBDatabase> => {
    dbPromise ??= openDatabase(BUFFER_DB_NAME, 1, (database) => {
      if (!database.objectStoreNames.contains(BUFFER_STORE_NAME)) {
        const store = database.createObjectStore(BUFFER_STORE_NAME, { keyPath: 'key' });
        store.createIndex('docId', 'docId', { unique: false });
      }
    });
    return dbPromise;
  };

  return {
    async put(entry) {
      await withStore(await db(), BUFFER_STORE_NAME, 'readwrite', (store) => {
        store.put(entry);
      });
    },
    async allFor(docId) {
      return withStore(await db(), BUFFER_STORE_NAME, 'readonly', (store) =>
        requestToPromise<BufferEntry[]>(
          store.index('docId').getAll(docId) as IDBRequest<BufferEntry[]>,
        ),
      );
    },
    async deleteKeys(keys) {
      await withStore(await db(), BUFFER_STORE_NAME, 'readwrite', (store) => {
        for (const key of keys) store.delete(key);
      });
    },
    async deleteFor(docId) {
      const entries = await this.allFor(docId);
      await this.deleteKeys(entries.map((entry) => entry.key));
    },
  };
}

/**
 * O buffer é "mais novo" quando é do mesmo documento e tem `revision` maior
 * ou `savedAt` posterior ao do arquivo aberto (§8).
 */
export function isBufferNewer(entry: BufferEntry, doc: PolicyOpsDocument): boolean {
  if (entry.docId !== doc.meta.id) return false;
  if (entry.revision > doc.meta.revision) return true;
  if (entry.revision < doc.meta.revision) return false;
  const fileSavedAt = doc.meta.savedAt;
  // Buffer da mesma revisão só existe porque houve mudança depois do último
  // salvamento — arquivo nunca salvo incluído.
  return fileSavedAt === null || entry.savedAt > fileSavedAt;
}

export type LocalBufferOptions = {
  store: BufferStorePort;
  now?: () => Date;
  debounceMs?: number;
  maxEntries?: number;
  setTimeout?: (handler: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
  /** Chamado quando a gravação do buffer falha (cota, modo privado). */
  onError?: (error: unknown) => void;
};

export class LocalBuffer {
  private readonly store: BufferStorePort;
  private readonly now: () => Date;
  private readonly debounceMs: number;
  private readonly maxEntries: number;
  private readonly startTimer: (handler: () => void, ms: number) => number;
  private readonly stopTimer: (id: number) => void;
  private readonly onError: (error: unknown) => void;

  private timerId: number | null = null;
  private pending: PolicyOpsDocument | null = null;
  private counter = 0;

  constructor(options: LocalBufferOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
    this.maxEntries = options.maxEntries ?? MAX_BUFFER_ENTRIES;
    this.startTimer =
      options.setTimeout ?? ((handler, ms) => setTimeout(handler, ms) as unknown as number);
    this.stopTimer = options.clearTimeout ?? ((id) => clearTimeout(id));
    this.onError = options.onError ?? (() => undefined);
  }

  /** Agenda a gravação do estado atual (debounce de 3 s). */
  schedule(doc: PolicyOpsDocument): void {
    this.pending = doc;
    if (this.timerId !== null) this.stopTimer(this.timerId);
    this.timerId = this.startTimer(() => {
      this.timerId = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** Grava agora o que estiver pendente. */
  async flush(): Promise<BufferEntry | null> {
    if (this.timerId !== null) {
      this.stopTimer(this.timerId);
      this.timerId = null;
    }
    const doc = this.pending;
    if (doc === null) return null;
    this.pending = null;

    const at = this.now();
    // O contador desempata gravações dentro do mesmo milissegundo, para que
    // o rodízio nunca sobrescreva um estado por colisão de chave.
    this.counter += 1;
    const entry: BufferEntry = {
      key: `${doc.meta.id}:${at.toISOString()}:${this.counter}`,
      docId: doc.meta.id,
      revision: doc.meta.revision,
      savedAt: at.toISOString(),
      document: doc,
    };

    try {
      await this.store.put(entry);
      await this.rotate(doc.meta.id);
      return entry;
    } catch (error) {
      this.onError(error);
      return null;
    }
  }

  /** Descarta o agendamento sem gravar (ex.: documento fechado). */
  cancel(): void {
    if (this.timerId !== null) {
      this.stopTimer(this.timerId);
      this.timerId = null;
    }
    this.pending = null;
  }

  /** Mantém os `maxEntries` últimos estados, em rodízio (§8). */
  private async rotate(docId: string): Promise<void> {
    const entries = await this.store.allFor(docId);
    if (entries.length <= this.maxEntries) return;
    const excess = entries
      .sort((a, b) => a.savedAt.localeCompare(b.savedAt) || a.key.localeCompare(b.key))
      .slice(0, entries.length - this.maxEntries);
    await this.store.deleteKeys(excess.map((entry) => entry.key));
  }

  async entriesFor(docId: string): Promise<BufferEntry[]> {
    const entries = await this.store.allFor(docId);
    return entries.sort((a, b) => a.savedAt.localeCompare(b.savedAt) || a.key.localeCompare(b.key));
  }

  async latestFor(docId: string): Promise<BufferEntry | null> {
    const entries = await this.entriesFor(docId);
    return entries[entries.length - 1] ?? null;
  }

  /**
   * Buffer mais novo que o documento aberto = oferta de recuperação (§8).
   */
  async recoveryOffer(doc: PolicyOpsDocument): Promise<BufferEntry | null> {
    const latest = await this.latestFor(doc.meta.id);
    if (latest === null) return null;
    return isBufferNewer(latest, doc) ? latest : null;
  }

  /** Limpeza após salvamento bem-sucedido (§8). */
  async clearFor(docId: string): Promise<void> {
    this.cancel();
    try {
      await this.store.deleteFor(docId);
    } catch (error) {
      this.onError(error);
    }
  }
}

/** Buffer pronto para o navegador; `null` quando não há IndexedDB. */
export function createLocalBuffer(options?: Partial<LocalBufferOptions>): LocalBuffer | null {
  if (!indexedDbAvailable()) return null;
  return new LocalBuffer({ store: indexedDbBufferStore(), ...options });
}
