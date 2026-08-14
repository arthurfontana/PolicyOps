import type { PolicyOpsDocument } from '@/core/document/schema';
import { DomainError } from '@/core/errors';
import { failureResult, type OpenedFile, type SaveOptions, type SaveResult, type StorageAdapter } from './adapter';
import type { DirectoryPort } from './directory';
import { prepareSave, readDocumentFromBytes } from './document-io';
import { coerceToDocumentShape } from './recovery';

/**
 * Adapter do modo `SERVER` — servidor local por usuário, via `fetch`
 * (docs/14-plataforma-local.md §4–§5, docs/06-persistencia-e-concorrencia.md
 * §2 e §5). O arquivo é **fixo**: uma pasta de rede, um `politicas.json`, um
 * servidor por usuário na frente dela — não há seletor, nem "salvar como",
 * nem "recentes" (isso tudo pressupõe escolher entre vários arquivos).
 *
 * O conflito de §5 é decidido pelo servidor, não por reler e comparar aqui:
 * o `PUT /api/document` leva o `baseHash` da última leitura e volta `409`
 * (com o conteúdo remoto) quando o disco mudou por baixo — a mesma forma que
 * `SaveResult.CONFLICT` já usa para o modo `FULL`. Erro de rede (o processo
 * do servidor caiu, ou a máquina perdeu a pasta) nunca é tratado como
 * conflito: vira `IO`, com uma mensagem que pergunta a pergunta certa.
 */

export type ServerAdapterOptions = {
  /** Nome de quem está salvando — carimba `meta.savedBy` (§4). No modo `SERVER` normalmente vem de `GET /api/whoami` (ADR-003), não do diálogo de identificação. */
  getActor: () => string;
  now?: () => Date;
  /** Token por boot (docs/14 §5) — vai em `X-PolicyOps-Token` em toda chamada. */
  token: string;
  /** Ponto de injeção para os testes: por padrão, o `fetch` global. */
  fetchImpl?: typeof fetch;
  /** Nome do arquivo de dados, de `GET /api/health` (`dataFile`). Padrão: `politicas.json`. */
  dataFileName?: string;
  /** Pasta de dados, de `GET /api/health` (`dataDir`) — só para exibição (`getHandleInfo().path`). */
  dataDir?: string;
};

const DEFAULT_DATA_FILE_NAME = 'politicas.json';

type ConflictBody = { remoteRaw?: string | null; remoteHash?: string | null };
type LockBody = { lock?: { holder?: string } };
type DocumentBody = { raw: string };
type SaveBody = { hash: string };

function networkErrorMessage(error: unknown): string {
  return `Não foi possível falar com o servidor local — ele foi fechado? (${String(error)})`;
}

export class ServerAdapter implements StorageAdapter {
  readonly mode = 'SERVER' as const;
  readonly canWriteInPlace = true;

  private readonly options: ServerAdapterOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly token: string;
  private readonly dataFileName: string;
  private readonly dataDir: string | undefined;

  /** Hash do que foi lido/gravado por último — o `baseHash` do próximo `PUT` (§5). */
  private lastSeenHash: string | null = null;
  /** Hash remoto visto no último `409` — o que "sobrescrever mesmo assim"/"mesclar" aceitam como base. */
  private lastConflictHash: string | null = null;

  constructor(options: ServerAdapterOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.token = options.token;
    this.dataFileName = options.dataFileName ?? DEFAULT_DATA_FILE_NAME;
    this.dataDir = options.dataDir;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private headers(): Record<string, string> {
    return { 'X-PolicyOps-Token': this.token };
  }

  private async errorDetail(response: Response, fallback: string): Promise<string> {
    try {
      const body = (await response.json()) as { detail?: string };
      if (typeof body.detail === 'string' && body.detail !== '') return body.detail;
    } catch {
      /* corpo de erro não é JSON — segue com o fallback */
    }
    return `${fallback} (código ${response.status})`;
  }

  private toOpenedFile(document: PolicyOpsDocument, issues: OpenedFile['issues'], raw: OpenedFile['raw']): OpenedFile {
    return { document, raw, issues, fileName: this.dataFileName, format: 'json' };
  }

  // -------------------------------------------------------------------------
  // Abrir — sempre o mesmo arquivo, sem seletor (docs/14 §8).
  // -------------------------------------------------------------------------

  async open(): Promise<OpenedFile> {
    let response: Response;
    try {
      response = await this.fetchImpl('/api/document', { headers: this.headers() });
    } catch (error) {
      throw new DomainError('DOCUMENT_INVALID', networkErrorMessage(error));
    }
    if (!response.ok) {
      throw new DomainError(
        'DOCUMENT_INVALID',
        await this.errorDetail(response, 'Não foi possível abrir o documento no servidor local.'),
      );
    }

    const body = (await response.json()) as DocumentBody;
    const read = await readDocumentFromBytes(new TextEncoder().encode(body.raw));
    this.lastSeenHash = read.hash;
    this.lastConflictHash = null;
    return this.toOpenedFile(read.document, read.issues, { bytes: read.bytes, hash: read.hash });
  }

  /**
   * Arrastar-e-soltar pressupõe escolher entre arquivos — no modo `SERVER`
   * o documento é fixo pela pasta do servidor, então não se aplica.
   */
  openFromDrop(): Promise<OpenedFile> {
    return Promise.reject(
      new DomainError(
        'DOCUMENT_INVALID',
        'Neste modo o documento é o arquivo fixo da pasta do servidor — arrastar outro arquivo não se aplica. Feche esta aba e abra pelo endereço que o servidor imprimiu para editar essa pasta.',
      ),
    );
  }

  /** Sem "recentes" no modo `SERVER`: há só o arquivo fixo desta pasta (§8). */
  openRecent(): Promise<OpenedFile | null> {
    return Promise.resolve(null);
  }

  // -------------------------------------------------------------------------
  // Salvar — conflito decidido pelo servidor (§5), não por reler aqui.
  // -------------------------------------------------------------------------

  async save(doc: PolicyOpsDocument, _options?: SaveOptions): Promise<SaveResult> {
    let prepared;
    try {
      // O servidor grava texto, não bytes compactados (docs/14 §4, "content é
      // texto, não objeto") — o modo `SERVER` não oferece `.pmz`.
      prepared = await prepareSave(doc, { actor: this.options.getActor(), now: this.now(), format: 'json' });
    } catch (error) {
      if (error instanceof DomainError) return failureResult('IO', error.message);
      return failureResult('IO', `Falha ao preparar o documento: ${String(error)}`);
    }

    let response: Response;
    try {
      response = await this.fetchImpl('/api/document', {
        method: 'PUT',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseHash: this.lastSeenHash, content: prepared.text }),
      });
    } catch (error) {
      return failureResult('IO', networkErrorMessage(error));
    }

    if (response.status === 409) {
      const body: ConflictBody = await response.json().catch(() => ({}) as ConflictBody);
      this.lastConflictHash = typeof body.remoteHash === 'string' ? body.remoteHash : null;
      const remote = await this.remoteFromConflict(body);
      return { ok: false, reason: 'CONFLICT', remote, remoteFileName: this.dataFileName };
    }

    if (response.status === 423) {
      // Defesa em profundidade do servidor (docs/14 §4): na prática o front já
      // bloqueia `save()` por `readOnly` enquanto o lock é de outra pessoa —
      // isto só dispara numa corrida (o lock mudou de mãos entre abrir e
      // salvar). `SaveResult` não tem variante de lock; `PERMISSION` é a que
      // mais se aproxima, com a mensagem dizendo o que é.
      const body: LockBody = await response.json().catch(() => ({}) as LockBody);
      return failureResult(
        'PERMISSION',
        `${body.lock?.holder ?? 'Outra pessoa'} está com o bloqueio consultivo deste arquivo agora. Recarregue e tente "editar assim mesmo" no aviso de bloqueio.`,
      );
    }

    if (!response.ok) {
      return failureResult('IO', await this.errorDetail(response, 'Não foi possível salvar no servidor local.'));
    }

    const body = (await response.json()) as SaveBody;
    this.lastSeenHash = body.hash;
    this.lastConflictHash = null;
    return {
      ok: true,
      revision: prepared.stamp.revision,
      savedAt: prepared.stamp.savedAt,
      hash: body.hash,
      fileName: this.dataFileName,
    };
  }

  private async remoteFromConflict(body: ConflictBody): Promise<PolicyOpsDocument> {
    if (typeof body.remoteRaw === 'string') {
      try {
        const read = await readDocumentFromBytes(new TextEncoder().encode(body.remoteRaw));
        return read.document;
      } catch {
        /* virou lixo no disco entre o servidor calcular o hash e responder — cai no coerce abaixo */
      }
    }
    // `remoteRaw: null` = o arquivo foi apagado por outra pessoa (docs/14 §4).
    return coerceToDocumentShape({});
  }

  /**
   * Indisponível no modo `SERVER`: o arquivo é fixo pela pasta do servidor
   * (§8). A interface esconde a opção, como já faz com recursos ausentes;
   * isto aqui é a rede de segurança se alguém chamar mesmo assim.
   */
  saveAs(): Promise<SaveResult> {
    return Promise.resolve(
      failureResult(
        'PERMISSION',
        'Neste modo o arquivo é fixo pela pasta do servidor — não existe "salvar como".',
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Conflito, pasta, encerramento
  // -------------------------------------------------------------------------

  async reloadCurrent(): Promise<PolicyOpsDocument | null> {
    try {
      const response = await this.fetchImpl('/api/document', { headers: this.headers() });
      if (!response.ok) return null;
      const body = (await response.json()) as DocumentBody;
      const read = await readDocumentFromBytes(new TextEncoder().encode(body.raw));
      return read.document;
    } catch {
      return null;
    }
  }

  /**
   * "Sobrescrever mesmo assim"/"mesclar" (§5): aceita o hash remoto visto no
   * último `409` como base do próximo `save()`. Diferente do modo `FULL`, o
   * servidor **não** ignora o `baseHash` com `force` (`force` só vale para o
   * lock) — então isto não é "gravar por cima de qualquer coisa", é "gravar
   * por cima do que eu vi da última vez que chequei". Se alguém salvar de
   * novo nesse meio-tempo, o próximo `save()` recebe outro `409`, correto.
   */
  acceptRemoteAsBase(): void {
    if (this.lastConflictHash !== null) this.lastSeenHash = this.lastConflictHash;
    this.lastConflictHash = null;
  }

  getHandleInfo(): { name: string; path?: string } | null {
    return this.dataDir === undefined
      ? { name: this.dataFileName }
      : { name: this.dataFileName, path: `${this.dataDir}\\${this.dataFileName}` };
  }

  /**
   * `null`: lock e backup não passam por `DirectoryPort` no modo `SERVER` —
   * o backup é feito pelo servidor dentro do próprio `PUT`, e o lock usa
   * `ApiAdvisoryLock` (`lock.ts`), falado diretamente com a API. Nenhum dos
   * dois depende de acesso de pasta do navegador.
   */
  getDirectory(): DirectoryPort | null {
    return null;
  }

  requestDirectoryAccess(): Promise<boolean> {
    return Promise.resolve(false);
  }

  close(): void {
    this.lastSeenHash = null;
    this.lastConflictHash = null;
  }
}

export function createServerAdapter(options: ServerAdapterOptions): ServerAdapter {
  return new ServerAdapter(options);
}
