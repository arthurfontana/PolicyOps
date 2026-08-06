import { indexedDbAvailable, openDatabase, requestToPromise, withStore } from './idb';
import { slugify } from './format';
import type { StorageMode } from './capabilities';

/**
 * Arquivos recentes — docs/07-ux-e-editor.md §1.
 *
 * A lista visível (nome, data, tamanho) fica em `localStorage`, porque é
 * texto e precisa estar disponível na primeira pintura da tela inicial. Os
 * **handles** ficam em IndexedDB, porque um `FileSystemFileHandle` não
 * sobrevive a `JSON.stringify` — é o que permite reabrir sem novo seletor,
 * pedindo no máximo uma reconfirmação de permissão com um clique.
 */

export const RECENTS_STORAGE_KEY = 'policyops.recents';
export const MAX_RECENTS = 10;
export const HANDLES_DB_NAME = 'policyops-handles';
export const HANDLES_STORE_NAME = 'handles';

export type RecentEntry = {
  id: string;
  fileName: string;
  documentName: string;
  bytes: number;
  openedAt: string;
  revision: number;
  /** Modo em que foi aberto — só `FULL` tem handle para reabrir. */
  mode: StorageMode;
  hasHandle: boolean;
};

export function recentId(fileName: string, documentId: string): string {
  return `${slugify(fileName)}::${documentId}`;
}

function readAll(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENTS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RecentEntry =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as RecentEntry).id === 'string' &&
        typeof (entry as RecentEntry).fileName === 'string',
    );
  } catch {
    return [];
  }
}

function writeAll(entries: RecentEntry[]): void {
  try {
    localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_RECENTS)));
  } catch {
    /* localStorage indisponível (modo privado): recentes ficam só nesta aba */
  }
}

export function listRecents(): RecentEntry[] {
  return readAll();
}

export function rememberRecent(entry: RecentEntry): RecentEntry[] {
  const others = readAll().filter((candidate) => candidate.id !== entry.id);
  const next = [entry, ...others].slice(0, MAX_RECENTS);
  writeAll(next);
  return next;
}

export function forgetRecent(id: string): RecentEntry[] {
  const next = readAll().filter((entry) => entry.id !== id);
  writeAll(next);
  void deleteHandles(id);
  return next;
}

export function clearRecents(): void {
  writeAll([]);
}

// ---------------------------------------------------------------------------
// Handles (IndexedDB)
// ---------------------------------------------------------------------------

export type StoredHandles = {
  id: string;
  file: FileSystemFileHandle;
  directory?: FileSystemDirectoryHandle;
};

let handlesDb: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  handlesDb ??= openDatabase(HANDLES_DB_NAME, 1, (database) => {
    if (!database.objectStoreNames.contains(HANDLES_STORE_NAME)) {
      database.createObjectStore(HANDLES_STORE_NAME, { keyPath: 'id' });
    }
  });
  return handlesDb;
}

export async function saveHandles(entry: StoredHandles): Promise<void> {
  if (!indexedDbAvailable()) return;
  try {
    await withStore(await db(), HANDLES_STORE_NAME, 'readwrite', (store) => {
      store.put(entry);
    });
  } catch {
    /* sem IndexedDB o recente ainda aparece: só não reabre sem seletor */
  }
}

export async function loadHandles(id: string): Promise<StoredHandles | null> {
  if (!indexedDbAvailable()) return null;
  try {
    const stored = await withStore(await db(), HANDLES_STORE_NAME, 'readonly', (store) =>
      requestToPromise<StoredHandles | undefined>(
        store.get(id) as IDBRequest<StoredHandles | undefined>,
      ),
    );
    return stored ?? null;
  } catch {
    return null;
  }
}

export async function deleteHandles(id: string): Promise<void> {
  if (!indexedDbAvailable()) return;
  try {
    await withStore(await db(), HANDLES_STORE_NAME, 'readwrite', (store) => {
      store.delete(id);
    });
  } catch {
    /* nada a fazer */
  }
}

/**
 * Reconfirmação de permissão com um clique (§1 de docs/07). Precisa ser
 * chamada de dentro do gesto do usuário — o navegador exige.
 */
export async function ensureReadWritePermission(handle: FileSystemHandle): Promise<boolean> {
  const descriptor = { mode: 'readwrite' } as const;
  try {
    if ((await handle.queryPermission?.(descriptor)) === 'granted') return true;
    return (await handle.requestPermission?.(descriptor)) === 'granted';
  } catch {
    return false;
  }
}
