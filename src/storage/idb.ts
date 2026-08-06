/**
 * Envelope mínimo de IndexedDB em promessas.
 *
 * IndexedDB aqui **não é armazenamento primário** (docs/02-arquitetura.md §2
 * proíbe isso): o arquivo é o banco. O que vive aqui é o buffer de autosave
 * (§8) e os handles dos arquivos recentes (§1) — dois caches locais, que
 * podem sumir sem perda de dado publicado.
 */

export function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export function openDatabase(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`IndexedDB: falha ao abrir ${name}`));
    request.onblocked = () => reject(new Error(`IndexedDB: ${name} bloqueado por outra aba`));
  });
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB: operação falhou'));
  });
}

export async function withStore<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const transaction = db.transaction(storeName, mode);
  const result = await work(transaction.objectStore(storeName));
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB: transação falhou'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB: transação abortada'));
  });
  return result;
}
