import type { PolicyOpsDocument } from '@/core/document/schema';
import { DomainError } from '@/core/errors';
import { failureResult, type OpenedFile, type SaveOptions, type SaveResult, type StorageAdapter } from './adapter';
import { writeBackup, type BackupOutcome } from './backups';
import { classifyPickerFailure } from './capabilities';
import { fsaDirectory, type DirectoryPort } from './directory';
import { prepareSave, readDocumentFromBytes, type ReadDocumentResult } from './document-io';
import { extensionFor, mimeTypeFor, readBlobBytes, suggestedFileName, type FileFormat } from './format';
import { coerceToDocumentShape } from './recovery';
import { ensureReadWritePermission, loadHandles, saveHandles, type StoredHandles } from './recents';

/**
 * Adapter do modo `FULL` — File System Access API.
 * docs/06-persistencia-e-concorrencia.md §2, §4, §5 e §9.
 *
 * O fluxo de conflito de §5 mora aqui, e é o motivo de o adapter guardar o
 * hash do que leu por último: antes de gravar ele **relê o arquivo** e
 * compara. Hash diferente = alguém salvou no meio do caminho → devolve
 * `CONFLICT` e **não grava**. Nunca há sobrescrita silenciosa.
 */

export type FsaAdapterOptions = {
  /** Nome de quem está salvando — carimba `meta.savedBy` (§4). */
  getActor: () => string;
  now?: () => Date;
  /** Avisa uma vez quando o backup não pôde ser feito (§9). */
  onBackupUnavailable?: (message: string) => void;
};

const FILE_TYPES = [
  {
    description: 'Documento PolicyOps',
    accept: { 'application/json': ['.json'], 'application/gzip': ['.pmz'] },
  },
];

function pickerWindow(): Window {
  if (typeof window === 'undefined') {
    throw new DomainError('DOCUMENT_INVALID', 'A File System Access API não existe neste ambiente.');
  }
  return window;
}

export class FsaAdapter implements StorageAdapter {
  readonly mode = 'FULL' as const;
  readonly canWriteInPlace = true;

  private fileHandle: FileSystemFileHandle | null = null;
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private directoryPort: DirectoryPort | null = null;
  private lastSeenHash: string | null = null;
  private currentFormat: FileFormat = 'json';
  private backupWarned = false;

  private readonly options: FsaAdapterOptions;

  constructor(options: FsaAdapterOptions) {
    this.options = options;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  // -------------------------------------------------------------------------
  // Abrir
  // -------------------------------------------------------------------------

  async open(): Promise<OpenedFile> {
    const win = pickerWindow();
    if (typeof win.showOpenFilePicker !== 'function') {
      throw new DomainError('DOCUMENT_INVALID', 'Este navegador não tem showOpenFilePicker.');
    }
    const [handle] = await win.showOpenFilePicker({ types: FILE_TYPES, multiple: false });
    if (handle === undefined) {
      throw new DOMException('Seleção cancelada', 'AbortError');
    }
    return this.adopt(handle);
  }

  async openFromDrop(file: File): Promise<OpenedFile> {
    // Arrastar-e-soltar entrega um `File`. `DataTransferItem.getAsFileSystemHandle`
    // devolveria um handle gravável, mas não existe em todo navegador — quem
    // o passa é `openFromDropHandle`, chamado pelo listener quando disponível.
    const read = await this.read(file);
    this.fileHandle = null;
    this.lastSeenHash = read.hash;
    this.currentFormat = read.format;
    return this.toOpenedFile(read, file.name);
  }

  /** Arrastar-e-soltar com handle gravável, quando o navegador oferece. */
  async openFromDropHandle(handle: FileSystemFileHandle): Promise<OpenedFile> {
    return this.adopt(handle);
  }

  async openRecent(entryId: string): Promise<OpenedFile | null> {
    const stored = await loadHandles(entryId);
    if (stored === null) return null;
    if (!(await ensureReadWritePermission(stored.file))) return null;
    this.attachDirectoryHandle(stored.directory ?? null);
    return this.adopt(stored.file, { keepDirectory: true, recentId: entryId });
  }

  private async adopt(
    handle: FileSystemFileHandle,
    options?: { keepDirectory?: boolean; recentId?: string },
  ): Promise<OpenedFile> {
    const file = await handle.getFile();
    const read = await this.read(file);

    this.fileHandle = handle;
    if (options?.keepDirectory !== true) this.attachDirectoryHandle(null);
    this.lastSeenHash = read.hash;
    this.currentFormat = read.format;
    this.backupWarned = false;

    return this.toOpenedFile(read, handle.name);
  }

  private async read(file: File): Promise<ReadDocumentResult> {
    return readDocumentFromBytes(await readBlobBytes(file));
  }

  private toOpenedFile(read: ReadDocumentResult, fileName: string): OpenedFile {
    return {
      document: read.document,
      raw: { bytes: read.bytes, hash: read.hash },
      issues: read.issues,
      fileName,
      format: read.format,
    };
  }

  /** Guarda os handles do arquivo aberto para os "recentes" (§1). */
  async rememberHandles(id: string): Promise<void> {
    if (this.fileHandle === null) return;
    const entry: StoredHandles = { id, file: this.fileHandle };
    if (this.directoryHandle !== null) entry.directory = this.directoryHandle;
    await saveHandles(entry);
  }

  // -------------------------------------------------------------------------
  // Salvar
  // -------------------------------------------------------------------------

  async save(doc: PolicyOpsDocument, options?: SaveOptions): Promise<SaveResult> {
    if (this.fileHandle === null) return this.saveAs(doc, options);

    let prepared;
    try {
      prepared = await prepareSave(doc, {
        actor: this.options.getActor(),
        now: this.now(),
        format: options?.format ?? this.currentFormat,
      });
    } catch (error) {
      return this.fromError(error);
    }

    // 1. relê o arquivo do disco  2. compara o hash com o da última leitura
    let previousBytes: Uint8Array | null = null;
    try {
      const file = await this.fileHandle.getFile();
      previousBytes = await readBlobBytes(file);
      const current = await readDocumentFromBytes(previousBytes);
      if (this.lastSeenHash !== null && current.hash !== this.lastSeenHash) {
        // 4. diferentes → não grava
        return {
          ok: false,
          reason: 'CONFLICT',
          remote: current.document,
          remoteFileName: this.fileHandle.name,
        };
      }
    } catch (error) {
      if (error instanceof DomainError) {
        // O arquivo em disco virou algo ilegível depois que abrimos. Tratar
        // como conflito é o comportamento seguro: não gravamos por cima.
        return {
          ok: false,
          reason: 'CONFLICT',
          remote: coerceToDocumentShape({}),
          remoteFileName: this.fileHandle.name,
        };
      }
      return this.fromError(error);
    }

    // 3. iguais → backup do conteúdo anterior (§9) e grava
    await this.backupPrevious(previousBytes);

    try {
      await this.write(this.fileHandle, prepared.bytes);
    } catch (error) {
      return this.fromError(error);
    }

    this.lastSeenHash = prepared.hash;
    this.currentFormat = prepared.format;
    return {
      ok: true,
      revision: prepared.stamp.revision,
      savedAt: prepared.stamp.savedAt,
      hash: prepared.hash,
      fileName: this.fileHandle.name,
    };
  }

  async saveAs(doc: PolicyOpsDocument, options?: SaveOptions): Promise<SaveResult> {
    const win = pickerWindow();
    if (typeof win.showSaveFilePicker !== 'function') {
      return failureResult('IO', 'Este navegador não tem showSaveFilePicker.');
    }

    let prepared;
    try {
      prepared = await prepareSave(doc, {
        actor: this.options.getActor(),
        now: this.now(),
        format: options?.format ?? this.currentFormat,
      });
    } catch (error) {
      return this.fromError(error);
    }

    const suggestedName = options?.suggestedName ?? suggestedFileName(doc.meta.name, prepared.format);

    let handle: FileSystemFileHandle;
    try {
      handle = await win.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'Documento PolicyOps',
            accept: { [mimeTypeFor(prepared.format)]: [extensionFor(prepared.format)] },
          },
        ],
      });
    } catch (error) {
      return this.fromError(error);
    }

    try {
      await this.write(handle, prepared.bytes);
    } catch (error) {
      return this.fromError(error);
    }

    this.fileHandle = handle;
    this.lastSeenHash = prepared.hash;
    this.currentFormat = prepared.format;
    return {
      ok: true,
      revision: prepared.stamp.revision,
      savedAt: prepared.stamp.savedAt,
      hash: prepared.hash,
      fileName: handle.name,
    };
  }

  private async write(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
    const writable = await handle.createWritable();
    await writable.write(bytes as unknown as BufferSource);
    await writable.close();
  }

  private async backupPrevious(previous: Uint8Array | null): Promise<BackupOutcome | null> {
    const directory = this.getDirectory();
    if (directory === null || previous === null || this.fileHandle === null) return null;

    const outcome = await writeBackup(
      directory,
      this.fileHandle.name,
      previous,
      this.now(),
    );
    if (!outcome.ok && !this.backupWarned) {
      // Avisa **uma vez** e segue: backup não bloqueia salvamento (§9).
      this.backupWarned = true;
      this.options.onBackupUnavailable?.(outcome.message);
    }
    return outcome;
  }

  private fromError(error: unknown): SaveResult {
    if (error instanceof DomainError) {
      return failureResult('IO', error.message);
    }
    switch (classifyPickerFailure(error)) {
      case 'CANCELLED':
        return failureResult('CANCELLED', 'Salvamento cancelado.');
      case 'PERMISSION':
        return failureResult(
          'PERMISSION',
          'O navegador não deu permissão de escrita neste arquivo. Tente de novo e confirme a permissão.',
        );
      default:
        return failureResult('IO', `Falha ao gravar o arquivo: ${String(error)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Conflito, pasta, encerramento
  // -------------------------------------------------------------------------

  async reloadCurrent(): Promise<PolicyOpsDocument | null> {
    if (this.fileHandle === null) return null;
    const file = await this.fileHandle.getFile();
    const read = await this.read(file);
    return read.document;
  }

  /**
   * "Sobrescrever mesmo assim" (§5): passa a tratar o que está no disco como
   * a base conhecida, para que o próximo `save()` grave por cima. Só é
   * chamado depois de o usuário digitar o nome do arquivo.
   */
  acceptRemoteAsBase(): void {
    this.lastSeenHash = null;
  }

  getHandleInfo(): { name: string; path?: string } | null {
    if (this.fileHandle === null) return null;
    return this.directoryHandle === null
      ? { name: this.fileHandle.name }
      : { name: this.fileHandle.name, path: `${this.directoryHandle.name}/${this.fileHandle.name}` };
  }

  getDirectory(): DirectoryPort | null {
    return this.directoryPort;
  }

  private attachDirectoryHandle(handle: FileSystemDirectoryHandle | null): void {
    this.directoryHandle = handle;
    this.directoryPort = handle === null ? null : fsaDirectory(handle);
  }

  /**
   * Liga o adapter a uma pasta que não veio de `showDirectoryPicker` — hoje,
   * a pasta guardada junto com o handle dos recentes e as pastas em memória
   * dos testes de bloqueio e backup.
   */
  attachDirectory(port: DirectoryPort): void {
    this.directoryPort = port;
  }

  /** Um clique para dar acesso à pasta — habilita lock (§6) e backups (§9). */
  async requestDirectoryAccess(): Promise<boolean> {
    const win = pickerWindow();
    if (typeof win.showDirectoryPicker !== 'function') return false;
    try {
      const handle = await win.showDirectoryPicker({ mode: 'readwrite' });
      if (!(await ensureReadWritePermission(handle))) return false;
      this.attachDirectoryHandle(handle);
      return true;
    } catch {
      return false;
    }
  }

  /** Hash do conteúdo lido por último — a base da detecção de conflito. */
  get baseHash(): string | null {
    return this.lastSeenHash;
  }

  close(): void {
    this.fileHandle = null;
    this.attachDirectoryHandle(null);
    this.lastSeenHash = null;
    this.currentFormat = 'json';
    this.backupWarned = false;
  }
}

export function createFsaAdapter(options: FsaAdapterOptions): FsaAdapter {
  return new FsaAdapter(options);
}
