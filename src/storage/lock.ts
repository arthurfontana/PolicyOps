import type { DirectoryPort } from './directory';
import { baseName } from './format';

/**
 * Bloqueio **consultivo** — docs/06-persistencia-e-concorrencia.md §6.
 *
 * Consultivo quer dizer: não impede nada. Ele evita o acidente comum de duas
 * pessoas editarem o mesmo arquivo sem saber, e a interface usa essa palavra.
 * Só existe no modo `FULL`, e só quando a aplicação tem acesso à pasta.
 */

export const LOCK_HEARTBEAT_MS = 60_000;
/** Lock com heartbeat parado há mais de 10 min é obsoleto e pode ser tomado. */
export const LOCK_STALE_MS = 10 * 60_000;

export type LockInfo = {
  holder: string;
  since: string;
  heartbeat: string;
  docRevision: number;
};

export type LockAcquisition =
  | { ok: true; lock: LockInfo }
  | { ok: false; reason: 'HELD'; lock: LockInfo }
  | { ok: false; reason: 'UNAVAILABLE'; message: string };

/** `politicas.json` → `politicas.lock.json` (§6). */
export function lockFileName(dataFileName: string): string {
  return `${baseName(dataFileName)}.lock.json`;
}

export function parseLock(text: string): LockInfo | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (raw === null || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    if (typeof record.holder !== 'string' || typeof record.heartbeat !== 'string') return null;
    return {
      holder: record.holder,
      since: typeof record.since === 'string' ? record.since : record.heartbeat,
      heartbeat: record.heartbeat,
      docRevision: typeof record.docRevision === 'number' ? record.docRevision : 0,
    };
  } catch {
    return null;
  }
}

export function isStale(lock: LockInfo, now: Date): boolean {
  const heartbeat = Date.parse(lock.heartbeat);
  if (Number.isNaN(heartbeat)) return true;
  return now.getTime() - heartbeat > LOCK_STALE_MS;
}

function timeOfDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** *"Arthur está editando este arquivo desde 09:00"* (§6). */
export function describeLock(lock: LockInfo, now: Date): string {
  if (isStale(lock, now)) {
    return `${lock.holder} abriu este arquivo às ${timeOfDay(lock.since)}, mas a aba está parada há mais de 10 minutos — o bloqueio está obsoleto e pode ser assumido.`;
  }
  return `${lock.holder} está editando este arquivo desde ${timeOfDay(lock.since)}.`;
}

export const LOCK_ADVISORY_NOTE =
  'O bloqueio é consultivo: ele não impede ninguém de editar, só evita que duas pessoas trabalhem no mesmo arquivo sem saber.';

// ---------------------------------------------------------------------------

export type AdvisoryLockOptions = {
  directory: DirectoryPort;
  dataFileName: string;
  holder: string;
  now?: () => Date;
  /** Injetáveis para o teste do heartbeat. */
  setInterval?: (handler: () => void, ms: number) => number;
  clearInterval?: (id: number) => void;
};

/**
 * Ciclo de vida do `.lock.json`: ler, tomar, renovar de 60 em 60 segundos e
 * liberar (`beforeunload` e ao fechar o documento).
 */
export class AdvisoryLock {
  private readonly directory: DirectoryPort;
  private readonly fileName: string;
  private readonly holder: string;
  private readonly now: () => Date;
  private readonly startTimer: (handler: () => void, ms: number) => number;
  private readonly stopTimer: (id: number) => void;

  private timerId: number | null = null;
  private held: LockInfo | null = null;
  private revision = 0;

  constructor(options: AdvisoryLockOptions) {
    this.directory = options.directory;
    this.fileName = lockFileName(options.dataFileName);
    this.holder = options.holder;
    this.now = options.now ?? (() => new Date());
    this.startTimer =
      options.setInterval ?? ((handler, ms) => setInterval(handler, ms) as unknown as number);
    this.stopTimer = options.clearInterval ?? ((id) => clearInterval(id));
  }

  get lockFile(): string {
    return this.fileName;
  }

  get current(): LockInfo | null {
    return this.held;
  }

  async read(): Promise<LockInfo | null> {
    const bytes = await this.directory.readFile(this.fileName);
    if (bytes === null) return null;
    return parseLock(new TextDecoder().decode(bytes));
  }

  /**
   * Toma o lock se estiver livre ou obsoleto. Se estiver ativo com outra
   * pessoa, devolve `HELD` — quem decide o que fazer é o usuário, no banner
   * de §6 ("Abrir somente leitura" ou "Editar assim mesmo").
   */
  async acquire(docRevision: number, options?: { force?: boolean }): Promise<LockAcquisition> {
    this.revision = docRevision;
    const existing = await this.read();
    const now = this.now();

    if (
      existing !== null &&
      existing.holder !== this.holder &&
      !isStale(existing, now) &&
      options?.force !== true
    ) {
      return { ok: false, reason: 'HELD', lock: existing };
    }

    const since =
      existing !== null && existing.holder === this.holder ? existing.since : now.toISOString();
    const lock: LockInfo = {
      holder: this.holder,
      since,
      heartbeat: now.toISOString(),
      docRevision,
    };

    try {
      await this.write(lock);
    } catch (error) {
      return {
        ok: false,
        reason: 'UNAVAILABLE',
        message: `Não foi possível gravar o arquivo de bloqueio (${this.fileName}): ${String(error)}`,
      };
    }

    this.held = lock;
    return { ok: true, lock };
  }

  /** Renova o heartbeat uma vez. Chamado pelo temporizador de 60 s. */
  async beat(docRevision?: number): Promise<LockInfo | null> {
    if (this.held === null) return null;
    if (docRevision !== undefined) this.revision = docRevision;
    const renewed: LockInfo = {
      ...this.held,
      heartbeat: this.now().toISOString(),
      docRevision: this.revision,
    };
    try {
      await this.write(renewed);
      this.held = renewed;
      return renewed;
    } catch {
      // Perder um heartbeat não derruba a edição: o lock é consultivo.
      return this.held;
    }
  }

  startHeartbeat(): void {
    if (this.timerId !== null) return;
    this.timerId = this.startTimer(() => {
      void this.beat();
    }, LOCK_HEARTBEAT_MS);
  }

  stopHeartbeat(): void {
    if (this.timerId === null) return;
    this.stopTimer(this.timerId);
    this.timerId = null;
  }

  /** Libera o lock (fechar o documento, `beforeunload`). */
  async release(): Promise<void> {
    this.stopHeartbeat();
    if (this.held === null) return;
    this.held = null;
    try {
      const existing = await this.read();
      // Só apaga o que é meu: se outra pessoa já tomou o lock obsoleto, o
      // arquivo dela não é meu para apagar.
      if (existing === null || existing.holder === this.holder) {
        await this.directory.removeFile(this.fileName);
      }
    } catch {
      /* pasta somente leitura ou arquivo já removido — nada a fazer */
    }
  }

  private async write(lock: LockInfo): Promise<void> {
    const text = JSON.stringify(lock, null, 2);
    await this.directory.writeFile(this.fileName, new TextEncoder().encode(text));
  }
}
