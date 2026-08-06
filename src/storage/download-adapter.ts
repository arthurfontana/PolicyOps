import type { PolicyOpsDocument } from '@/core/document/schema';
import { DomainError } from '@/core/errors';
import {
  failureResult,
  type OpenedFile,
  type SaveOptions,
  type SaveResult,
  type StorageAdapter,
} from './adapter';
import type { DirectoryPort } from './directory';
import { prepareSave, readDocumentFromBytes, type ReadDocumentResult } from './document-io';
import { mimeTypeFor, readBlobBytes, suggestedFileName, type FileFormat } from './format';

/**
 * Adapter do modo `DOWNLOAD_ONLY` — docs/06-persistencia-e-concorrencia.md §2.
 *
 * Fallback universal: abrir por `<input type="file">` ou arrastar-e-soltar,
 * salvar por `<a download>` com Blob. É o que roda quando a página está em
 * `file://` (origem opaca) ou num navegador sem File System Access API.
 *
 * O que este modo **não** faz, e a interface precisa dizer: reler o arquivo.
 * Sem reler não há detecção de conflito (§5). Nada aqui finge o contrário.
 */

export type DownloadAdapterOptions = {
  getActor: () => string;
  now?: () => Date;
  /** Ponto de injeção para os testes: por padrão usa o DOM. */
  pickFile?: () => Promise<File | null>;
  downloadBlob?: (blob: Blob, fileName: string) => void;
};

/** `<input type="file">` descartável — o seletor do modo DOWNLOAD_ONLY. */
function pickFileWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.pmz,application/json,application/gzip';
    input.style.display = 'none';

    const finish = (file: File | null) => {
      input.remove();
      resolve(file);
    };

    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    // 'cancel' não existe em todo navegador; quando não existe, a promessa
    // simplesmente não resolve — e o usuário reabre o seletor.
    input.addEventListener('cancel', () => finish(null), { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

function downloadWithAnchor(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revogar imediatamente cancela downloads em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export class DownloadAdapter implements StorageAdapter {
  readonly mode = 'DOWNLOAD_ONLY' as const;
  readonly canWriteInPlace = false;

  private fileName: string | null = null;
  private currentFormat: FileFormat = 'json';

  private readonly options: DownloadAdapterOptions;

  constructor(options: DownloadAdapterOptions) {
    this.options = options;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  async open(): Promise<OpenedFile> {
    const pick = this.options.pickFile ?? pickFileWithInput;
    const file = await pick();
    if (file === null) throw new DOMException('Seleção cancelada', 'AbortError');
    return this.openFromDrop(file);
  }

  async openFromDrop(file: File): Promise<OpenedFile> {
    const read: ReadDocumentResult = await readDocumentFromBytes(await readBlobBytes(file));
    this.fileName = file.name;
    this.currentFormat = read.format;
    return {
      document: read.document,
      raw: { bytes: read.bytes, hash: read.hash },
      issues: read.issues,
      fileName: file.name,
      format: read.format,
    };
  }

  /**
   * Sem handle persistido não há como reabrir sozinho: a interface usa o
   * `null` para cair no seletor, já apontando o arquivo certo pelo nome.
   */
  openRecent(): Promise<OpenedFile | null> {
    return Promise.resolve(null);
  }

  /** Salvar aqui é sempre baixar um arquivo novo. */
  save(doc: PolicyOpsDocument, options?: SaveOptions): Promise<SaveResult> {
    return this.saveAs(doc, options);
  }

  async saveAs(doc: PolicyOpsDocument, options?: SaveOptions): Promise<SaveResult> {
    let prepared;
    try {
      prepared = await prepareSave(doc, {
        actor: this.options.getActor(),
        now: this.now(),
        format: options?.format ?? this.currentFormat,
      });
    } catch (error) {
      if (error instanceof DomainError) return failureResult('IO', error.message);
      return failureResult('IO', `Falha ao preparar o arquivo: ${String(error)}`);
    }

    const fileName =
      options?.suggestedName ??
      this.fileName ??
      suggestedFileName(doc.meta.name, prepared.format);

    const blob = new Blob([prepared.bytes as BlobPart], { type: mimeTypeFor(prepared.format) });
    try {
      (this.options.downloadBlob ?? downloadWithAnchor)(blob, fileName);
    } catch (error) {
      return failureResult('IO', `Falha ao gerar o download: ${String(error)}`);
    }

    this.fileName = fileName;
    this.currentFormat = prepared.format;
    return {
      ok: true,
      revision: prepared.stamp.revision,
      savedAt: prepared.stamp.savedAt,
      hash: prepared.hash,
      fileName,
    };
  }

  /** Não há como reler um download — e é isso que a interface avisa (§5). */
  reloadCurrent(): Promise<PolicyOpsDocument | null> {
    return Promise.resolve(null);
  }

  acceptRemoteAsBase(): void {
    /* sem detecção de conflito, não há base remota a aceitar */
  }

  getHandleInfo(): { name: string; path?: string } | null {
    return this.fileName === null ? null : { name: this.fileName };
  }

  getDirectory(): DirectoryPort | null {
    return null;
  }

  requestDirectoryAccess(): Promise<boolean> {
    return Promise.resolve(false);
  }

  close(): void {
    this.fileName = null;
    this.currentFormat = 'json';
  }
}

export function createDownloadAdapter(options: DownloadAdapterOptions): DownloadAdapter {
  return new DownloadAdapter(options);
}
