import { hashDocument } from '@/core/document/serialize';

/**
 * Servidor local falso — mesma forma de resposta de `server/policyops_server.py`
 * (docs/14-plataforma-local.md §4), o bastante para exercitar `server-adapter.ts`
 * e `ApiAdvisoryLock` (`lock.ts`) sem subir Python. O E2E
 * (`tests/e2e/modo-servidor.spec.ts`) é quem cobre o servidor de verdade.
 *
 * Só entende `/api/health`, `/api/whoami`, `/api/document` e
 * `/api/document/lock` — o que os dois clientes acima chamam.
 */

export type FakeServerLock = {
  holder: string;
  since: string;
  heartbeat: string;
  docRevision: number;
  username: string;
};

export type FakeServerOptions = {
  token?: string;
  initialText?: string | null;
  now?: () => Date;
  dataDir?: string;
  dataFile?: string;
};

const STALE_MS = 10 * 60_000;
/** O "dono" de todo lock que este servidor falso escreve — só há um usuário por instância de teste. */
const SERVER_USERNAME = 'me';

export function fakeServer(options?: FakeServerOptions) {
  const token = options?.token ?? 'token-de-teste';
  const dataDir = options?.dataDir ?? '\\\\rede\\Politicas';
  const dataFile = options?.dataFile ?? 'politicas.json';
  const now = options?.now ?? (() => new Date());

  let text: string | null = options?.initialText ?? null;
  let lock: FakeServerLock | null = null;
  let online = true;

  function isStale(candidate: FakeServerLock): boolean {
    const heartbeat = Date.parse(candidate.heartbeat);
    return Number.isNaN(heartbeat) || now().getTime() - heartbeat > STALE_MS;
  }
  function isMine(candidate: FakeServerLock): boolean {
    return candidate.username === SERVER_USERNAME;
  }

  async function currentHash(): Promise<string | null> {
    return text === null ? null : await hashDocument(text);
  }

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'X-PolicyOps-Api': '1' },
    });
  }

  function checkToken(init?: RequestInit): boolean {
    return new Headers(init?.headers).get('X-PolicyOps-Token') === token;
  }

  async function readBody<T>(init?: RequestInit): Promise<T> {
    return JSON.parse(String(init?.body ?? '{}')) as T;
  }

  function lockConflict(body: { force?: boolean }): Response | null {
    if (lock !== null && !isMine(lock) && !isStale(lock) && body.force !== true) {
      return json(423, { code: 'LOCKED', detail: `${lock.holder} está editando.`, lock });
    }
    return null;
  }

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!online) throw new TypeError('Failed to fetch: servidor local fora do ar (teste)');
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.endsWith('/api/health')) {
      return json(200, { app: 'Policy Matrix Studio', apiVersion: 1, dataDir, dataFile, started: now().toISOString() });
    }

    if (url.endsWith('/api/whoami')) {
      if (!checkToken(init)) return json(401, { code: 'UNAUTHORIZED', detail: 'sem token' });
      return json(200, { username: 'arthur', displayName: 'Arthur', roles: ['PUBLISHER'] });
    }

    if (url.endsWith('/api/document/lock')) {
      if (!checkToken(init)) return json(401, { code: 'UNAUTHORIZED', detail: 'sem token' });

      if (method === 'POST') {
        const body = await readBody<{ docRevision: number; force?: boolean }>(init);
        const conflict = lockConflict(body);
        if (conflict !== null) return conflict;
        const since = lock !== null && isMine(lock) ? lock.since : now().toISOString();
        lock = {
          holder: 'Quem Testa',
          since,
          heartbeat: now().toISOString(),
          docRevision: body.docRevision,
          username: SERVER_USERNAME,
        };
        return json(200, { lock });
      }

      if (method === 'DELETE') {
        if (lock === null) return json(200, { released: false });
        if (!isMine(lock)) return json(409, { code: 'LOCK_NOT_OWNED', detail: 'não é seu', lock });
        lock = null;
        return json(200, { released: true });
      }
    }

    if (url.endsWith('/api/document')) {
      if (!checkToken(init)) return json(401, { code: 'UNAUTHORIZED', detail: 'sem token' });

      if (method === 'GET') {
        if (text === null) return json(404, { code: 'NOT_FOUND', detail: `Ainda não existe ${dataFile}.` });
        return json(200, {
          raw: text,
          hash: await currentHash(),
          bytes: new TextEncoder().encode(text).byteLength,
          mtime: now().toISOString(),
        });
      }

      if (method === 'PUT') {
        const body = await readBody<{ baseHash: string | null; content: string; force?: boolean }>(init);
        const conflict = lockConflict(body);
        if (conflict !== null) return conflict;

        const expected = body.baseHash ?? null;
        const actual = await currentHash();
        if (actual !== expected) {
          return json(409, { code: 'CONFLICT', detail: 'O arquivo mudou no disco.', remoteRaw: text, remoteHash: actual });
        }

        text = body.content;
        return json(200, {
          hash: await currentHash(),
          savedAt: now().toISOString(),
          bytes: new TextEncoder().encode(text).byteLength,
          backup: null,
        });
      }
    }

    return json(404, { code: 'NOT_FOUND', detail: `rota desconhecida: ${url}` });
  }) as typeof fetch;

  return {
    fetchImpl,
    token,
    dataDir,
    dataFile,
    content: () => text,
    writeExternally: (newText: string) => {
      text = newText;
    },
    deleteExternally: () => {
      text = null;
    },
    setExternalLock: (holder: string, sinceIso: string, heartbeatIso = sinceIso) => {
      lock = { holder, since: sinceIso, heartbeat: heartbeatIso, docRevision: 0, username: 'outra-pessoa' };
    },
    clearLock: () => {
      lock = null;
    },
    currentLock: () => lock,
    goOffline: () => {
      online = false;
    },
    goOnline: () => {
      online = true;
    },
  };
}
