/**
 * Duplês de teste da camada de persistência.
 *
 * O adapter do modo FULL conversa com `FileSystemFileHandle`: `getFile()` para
 * ler e `createWritable()` para gravar. Um handle falso com essas duas
 * operações é o que permite testar a detecção de conflito de verdade —
 * inclusive checando o **conteúdo do arquivo depois**, que é o ponto do
 * teste exigido por §11 ("não grava" precisa ser verificado no disco, não só
 * no retorno).
 */

export type FakeFileHandle = FileSystemFileHandle & {
  /** Conteúdo atual "no disco". */
  content: () => string;
  /** Simula outra pessoa salvando por cima. */
  writeExternally: (text: string) => void;
  /** Quantas vezes a aplicação gravou neste arquivo. */
  writeCount: () => number;
};

export function fakeFileHandle(name: string, initialText: string): FakeFileHandle {
  let bytes = new TextEncoder().encode(initialText);
  let writes = 0;

  const handle = {
    kind: 'file' as const,
    name,
    getFile: () => Promise.resolve(new File([bytes as BlobPart], name)),
    createWritable: () => {
      const chunks: Uint8Array[] = [];
      return Promise.resolve({
        write: (data: BufferSource | Blob | string) => {
          if (typeof data === 'string') chunks.push(new TextEncoder().encode(data));
          else if (data instanceof Uint8Array) chunks.push(data);
          else if (ArrayBuffer.isView(data))
            chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
          else if (data instanceof ArrayBuffer) chunks.push(new Uint8Array(data));
          return Promise.resolve();
        },
        close: () => {
          const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
          const merged = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
          }
          bytes = merged;
          writes += 1;
          return Promise.resolve();
        },
      });
    },
    isSameEntry: () => Promise.resolve(false),
    content: () => new TextDecoder().decode(bytes),
    writeExternally: (text: string) => {
      bytes = new TextEncoder().encode(text);
    },
    writeCount: () => writes,
  };

  return handle as unknown as FakeFileHandle;
}
