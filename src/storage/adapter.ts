import type { PolicyOpsDocument } from '@/core/document/schema';
import type { ValidationIssue } from '@/core/document/validate';
import type { StorageMode } from './capabilities';
import type { DirectoryPort } from './directory';
import type { FileFormat } from './format';

/**
 * Interface de armazenamento — docs/06-persistencia-e-concorrencia.md §2.
 *
 * **A aplicação inteira só conhece esta interface.** Nenhum componente chama
 * a File System Access API, nem cria `<input type="file">`, nem monta `<a
 * download>`: tudo isso vive nas duas implementações
 * (`fsa-adapter.ts` e `download-adapter.ts`).
 */

export type OpenedFile = {
  document: PolicyOpsDocument;
  raw: { bytes: number; hash: string };
  /** Não vazio = modo de recuperação (§10). */
  issues: ValidationIssue[];
  /** Nome do arquivo aberto — a barra de status precisa dele. */
  fileName: string;
  format: FileFormat;
};

export type SaveResult =
  | { ok: true; revision: number; savedAt: string; hash: string; fileName: string }
  | { ok: false; reason: 'CONFLICT'; remote: PolicyOpsDocument; remoteFileName: string }
  | { ok: false; reason: 'CANCELLED' | 'PERMISSION' | 'IO'; message: string };

export type SaveOptions = {
  /** Nome sugerido em "salvar como" — usado pela cópia de conflito (§5). */
  suggestedName?: string;
  format?: FileFormat;
};

export interface StorageAdapter {
  // -------------------------------------------------------------------------
  // §2, literal
  // -------------------------------------------------------------------------
  readonly mode: StorageMode;
  readonly canWriteInPlace: boolean;

  open(): Promise<OpenedFile>;
  openFromDrop(file: File): Promise<OpenedFile>;
  /** Grava onde abriu. Sem arquivo aberto, delega para `saveAs`. */
  save(doc: PolicyOpsDocument, options?: SaveOptions): Promise<SaveResult>;
  saveAs(doc: PolicyOpsDocument, options?: SaveOptions): Promise<SaveResult>;
  /** Relê para checar conflito. `null` quando o modo não sabe reler (§5). */
  reloadCurrent(): Promise<PolicyOpsDocument | null>;
  getHandleInfo(): { name: string; path?: string } | null;

  // -------------------------------------------------------------------------
  // Extensões — o que §1, §5, §6 e §9 exigem que a aplicação consiga pedir
  // sem falar com a API do navegador por fora do adapter. Cada uma existe
  // porque um requisito do documento normativo não fecha sem ela.
  // -------------------------------------------------------------------------

  /**
   * §1 (recentes) — reabre pelo handle persistido, sem novo seletor. `null`
   * quando o handle não existe mais ou o modo não guarda handles; a interface
   * então cai no seletor normal.
   */
  openRecent(entryId: string): Promise<OpenedFile | null>;

  /**
   * §5 ("Sobrescrever mesmo assim") — aceita o estado remoto como base, para
   * que o `save()` seguinte grave por cima em vez de repetir o CONFLICT.
   * **Nunca** é chamado sem o usuário digitar o nome do arquivo.
   */
  acceptRemoteAsBase(): void;

  /**
   * §6 e §9 — a pasta onde o arquivo está, quando a aplicação tem acesso a
   * ela: é o que permite gravar `{nome}.lock.json` e `_backups/`. `null`
   * quando não há (o seletor de arquivo do navegador dá acesso ao arquivo,
   * não à pasta) — os dois recursos ficam indisponíveis, e a interface diz.
   */
  getDirectory(): DirectoryPort | null;
  /** Pede acesso à pasta ao usuário (um clique). `false` = negado ou indisponível. */
  requestDirectoryAccess(): Promise<boolean>;

  /** Fecha o documento: solta handles e para de segurar recursos. */
  close(): void;
}

/** Erro de gravação já traduzido para o vocabulário de `SaveResult`. */
export function failureResult(reason: 'CANCELLED' | 'PERMISSION' | 'IO', message: string) {
  return { ok: false as const, reason, message };
}
