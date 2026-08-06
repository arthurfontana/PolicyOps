/**
 * Porta de acesso a uma pasta — o mínimo de que o bloqueio consultivo (§6) e
 * os backups automáticos (§9) precisam.
 *
 * Por que existe: a File System Access API entrega um `FileSystemFileHandle`
 * quando o usuário escolhe um arquivo, e **um handle de arquivo não dá acesso
 * à pasta que o contém**. Gravar `{nome}.lock.json` ao lado e criar
 * `_backups/` exigem um `FileSystemDirectoryHandle`, que só vem de
 * `showDirectoryPicker()`. Isolar isso numa porta faz duas coisas: mantém
 * lock e backup testáveis sem navegador (`memoryDirectory`) e deixa explícito
 * o caso em que a aplicação simplesmente não tem a pasta — aí os dois
 * recursos ficam indisponíveis, e a interface diz isso com todas as letras.
 */

export interface DirectoryPort {
  readonly name: string;
  /** `null` quando o arquivo não existe. */
  readFile(fileName: string): Promise<Uint8Array | null>;
  writeFile(fileName: string, data: Uint8Array): Promise<void>;
  removeFile(fileName: string): Promise<void>;
  listFiles(): Promise<string[]>;
  /** Subpasta; `create: true` cria se não existir. `null` se não deu. */
  subdirectory(name: string, options?: { create?: boolean }): Promise<DirectoryPort | null>;
}

// ---------------------------------------------------------------------------
// Implementação sobre a File System Access API
// ---------------------------------------------------------------------------

export function fsaDirectory(handle: FileSystemDirectoryHandle): DirectoryPort {
  return {
    name: handle.name,

    async readFile(fileName) {
      try {
        const fileHandle = await handle.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch {
        return null;
      }
    },

    async writeFile(fileName, data) {
      const fileHandle = await handle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(data as unknown as BufferSource);
      await writable.close();
    },

    async removeFile(fileName) {
      await handle.removeEntry(fileName);
    },

    async listFiles() {
      const names: string[] = [];
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind === 'file') names.push(name);
      }
      return names;
    },

    async subdirectory(name, options) {
      try {
        return fsaDirectory(await handle.getDirectoryHandle(name, { create: options?.create }));
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Implementação em memória — testes de lock e de backup
// ---------------------------------------------------------------------------

export type MemoryDirectory = DirectoryPort & {
  files: Map<string, Uint8Array>;
  children: Map<string, MemoryDirectory>;
  /** Conveniência para os testes: conteúdo como texto. */
  readText(fileName: string): string | null;
  writeText(fileName: string, text: string): void;
};

export function memoryDirectory(name = 'memoria'): MemoryDirectory {
  const files = new Map<string, Uint8Array>();
  const children = new Map<string, MemoryDirectory>();

  const dir: MemoryDirectory = {
    name,
    files,
    children,

    readFile: (fileName) => Promise.resolve(files.get(fileName) ?? null),
    writeFile: (fileName, data) => {
      files.set(fileName, new Uint8Array(data));
      return Promise.resolve();
    },
    removeFile: (fileName) => {
      files.delete(fileName);
      return Promise.resolve();
    },
    listFiles: () => Promise.resolve([...files.keys()]),
    subdirectory: (childName, options) => {
      const existing = children.get(childName);
      if (existing) return Promise.resolve(existing);
      if (!options?.create) return Promise.resolve(null);
      const created = memoryDirectory(childName);
      children.set(childName, created);
      return Promise.resolve(created);
    },

    readText: (fileName) => {
      const data = files.get(fileName);
      return data ? new TextDecoder().decode(data) : null;
    },
    writeText: (fileName, text) => {
      files.set(fileName, new TextEncoder().encode(text));
    },
  };

  return dir;
}
