import { DomainError } from '@/core/errors';

/**
 * Formato do arquivo — docs/06-persistencia-e-concorrencia.md §3.
 *
 * - Padrão `.json`, UTF-8, indentado (a indentação é responsabilidade de
 *   `serialize`, em `src/core/document/serialize.ts`).
 * - Acima de 5 MB a aplicação **oferece** `.pmz` — o mesmo JSON com gzip.
 * - **A leitura detecta o formato pelo magic number, não pela extensão.** Um
 *   `.pmz` renomeado para `.json` (ou o contrário) abre do mesmo jeito.
 */

export type FileFormat = 'json' | 'pmz';

/** Cabeçalho gzip: 0x1f 0x8b, seguido do método de compressão (0x08 = deflate). */
export const GZIP_MAGIC = [0x1f, 0x8b] as const;

/** Acima disto a aplicação oferece `.pmz` (§3). */
export const COMPRESSION_THRESHOLD_BYTES = 5 * 1024 * 1024;

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

export function detectFormat(bytes: Uint8Array): FileFormat {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]
    ? 'pmz'
    : 'json';
}

function stripBom(bytes: Uint8Array): Uint8Array {
  const hasBom =
    bytes.length >= 3 &&
    bytes[0] === UTF8_BOM[0] &&
    bytes[1] === UTF8_BOM[1] &&
    bytes[2] === UTF8_BOM[2];
  return hasBom ? bytes.subarray(3) : bytes;
}

async function throughStream(bytes: Uint8Array, stream: ReadableWritablePair): Promise<Uint8Array> {
  // O fluxo é montado à mão em vez de sair de `Blob.stream()`: nem todo
  // ambiente que roda esta camada implementa `Blob.stream` (o jsdom dos
  // testes de componente, por exemplo), e a origem dos bytes não precisa ser
  // um Blob para nada aqui.
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const piped = source.pipeThrough(stream as ReadableWritablePair<Uint8Array, Uint8Array>);
  const buffer = await new Response(piped as BodyInit).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Bytes de um `Blob`/`File` sem depender de `Blob.arrayBuffer`, que é o
 * caminho curto mas não existe em todo lugar (jsdom, Safari antigo).
 * `FileReader` existe desde sempre.
 */
export function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo.'));
    reader.readAsArrayBuffer(blob);
  });
}

function assertCompressionAvailable(): void {
  if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') {
    throw new DomainError(
      'DOCUMENT_INVALID',
      'Este navegador não sabe compactar/descompactar gzip (CompressionStream). Use o formato .json.',
    );
  }
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  assertCompressionAvailable();
  return throughStream(bytes, new CompressionStream('gzip'));
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  assertCompressionAvailable();
  try {
    return await throughStream(bytes, new DecompressionStream('gzip'));
  } catch {
    throw new DomainError(
      'DOCUMENT_INVALID',
      'O arquivo começa como gzip mas não pôde ser descompactado — ele pode estar truncado ou corrompido.',
    );
  }
}

/** Serializa o texto no formato pedido. Nada aqui conhece extensão de arquivo. */
export async function encodeDocumentText(text: string, format: FileFormat): Promise<Uint8Array> {
  const utf8 = new TextEncoder().encode(text);
  return format === 'pmz' ? gzip(utf8) : utf8;
}

/** Lê os bytes crus decidindo o formato pelo magic number (§3). */
export async function decodeDocumentText(
  bytes: Uint8Array,
): Promise<{ text: string; format: FileFormat }> {
  const format = detectFormat(bytes);
  const raw = format === 'pmz' ? await gunzip(bytes) : stripBom(bytes);
  return { text: new TextDecoder('utf-8').decode(raw), format };
}

export function mimeTypeFor(format: FileFormat): string {
  return format === 'pmz' ? 'application/gzip' : 'application/json';
}

export function extensionFor(format: FileFormat): string {
  return format === 'pmz' ? '.pmz' : '.json';
}

/** `true` quando vale a pena oferecer `.pmz` (§3). */
export function shouldOfferCompression(serializedBytes: number): boolean {
  return serializedBytes > COMPRESSION_THRESHOLD_BYTES;
}

// ---------------------------------------------------------------------------
// Nomes de arquivo
// ---------------------------------------------------------------------------

/** Slug ASCII, minúsculo, hifenizado — base do nome sugerido em "Salvar como". */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'documento' : slug;
}

/** `{slug do nome do documento}.json` (§3). */
export function suggestedFileName(documentName: string, format: FileFormat = 'json'): string {
  return `${slugify(documentName)}${extensionFor(format)}`;
}

/** Nome sem a extensão conhecida — base para lock, backup e cópia de conflito. */
export function baseName(fileName: string): string {
  return fileName.replace(/\.(json|pmz)$/i, '');
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * `…-conflito-{nome}-{hora}.json` (§5). `{nome}` é quem está salvando: o
 * arquivo diz de quem é a cópia sem precisar abrir.
 */
export function conflictCopyName(
  fileName: string,
  holder: string,
  at: Date,
  format: FileFormat = 'json',
): string {
  const hour = `${two(at.getHours())}h${two(at.getMinutes())}`;
  return `${baseName(fileName)}-conflito-${slugify(holder)}-${hour}${extensionFor(format)}`;
}
