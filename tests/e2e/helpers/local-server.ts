import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Sobe o servidor local **de verdade** (`server/policyops_server.py`, S26)
 * contra uma pasta temporária, e devolve o endereço com `?t=` que ele imprime
 * — o mesmo que o launcher da S28 abre.
 *
 * Compartilhado por `modo-servidor.spec.ts` (S27) e `evidencias.spec.ts`
 * (S30): os dois precisam de servidor real porque o que está sob teste é
 * justamente o que acontece **no disco** da pasta de rede.
 *
 * Não casa com o `testMatch` do Playwright (`*.spec.ts`), então este arquivo
 * não é coletado como suíte.
 */

export const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', '..', 'dist', 'PolicyOps.html');
const SERVER_SCRIPT = path.resolve(import.meta.dirname, '..', '..', '..', 'server', 'policyops_server.py');
const SAMPLE_FIXTURE = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'sample-document.json');
const PYTHON = process.env.POLICYOPS_PYTHON ?? 'python';

export function requireBuild(): void {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
}

export type RunningServer = {
  dataDir: string;
  documentPath: string;
  url: string;
  stop: () => Promise<void>;
};

/**
 * Sobe o servidor e **confirma que ele está atendendo** antes de devolver.
 *
 * A confirmação não é zelo, e checar `dataDir` no corpo do health não é
 * paranoia: `choose_port` testa a porta e a solta antes do uvicorn ligar de
 * verdade (docs/14 §5 assume um punhado de portas dedicadas numa máquina), e
 * dois workers do Playwright subindo servidores no mesmo instante conseguem
 * escolher a mesma porta. Quem perde a corrida morre *depois* de imprimir o
 * endereço — e o `/api/health` daquele endereço responde, porque quem atende é
 * o servidor **do outro worker**. O teste só descobriria isso lá na frente,
 * como uma página sem documento (o token do vencedor não é o dele: `401`).
 */
export async function startServer(options?: { seed?: boolean }): Promise<RunningServer> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const server = await spawnServer(options);
    try {
      await waitForHealth(server.url, server.dataDir);
      return server;
    } catch (error) {
      lastError = error;
      await server.stop();
    }
  }
  throw new Error(`O servidor local não respondeu em /api/health depois de 3 tentativas: ${String(lastError)}`);
}

async function waitForHealth(url: string, dataDir: string, timeoutMs = 10_000): Promise<void> {
  const health = new URL('/api/health', url).href;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(health);
      if (response.ok) {
        const body = (await response.json()) as { dataDir?: string };
        if (body.dataDir === dataDir) return;
        lastError = `outro servidor atende em ${health} (dataDir ${String(body.dataDir)})`;
        break;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(String(lastError));
}

function spawnServer(options?: { seed?: boolean }): Promise<RunningServer> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'policyops-e2e-server-'));
  const documentPath = path.join(dataDir, 'politicas.json');
  if (options?.seed !== false) {
    writeFileSync(documentPath, readFileSync(SAMPLE_FIXTURE));
  }

  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(
      PYTHON,
      [SERVER_SCRIPT, '--data-dir', dataDir, '--html', DIST_PATH],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let settled = false;
    let buffer = '';
    let exited = false;
    child.once('exit', () => {
      exited = true;
    });

    // `stop()` precisa ser seguro para chamar mais de uma vez: um teste que já
    // derrubou o servidor de propósito (simulando "o processo caiu") e depois
    // o `afterEach` chamando `stop()` de novo não pode travar esperando um
    // `exit` que já aconteceu e nunca mais vai disparar.
    const stop = (): Promise<void> => {
      if (exited) return Promise.resolve();
      return new Promise<void>((res) => {
        child.once('exit', () => res());
        child.kill('SIGTERM');
        // Em CI, `SIGTERM` pode não bastar a tempo — reforça com `SIGKILL`.
        setTimeout(() => {
          if (!exited) child.kill('SIGKILL');
        }, 3000);
      });
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        void stop();
        reject(new Error(`Timeout esperando o servidor local subir. Saída até agora:\n${buffer}`));
      }
    }, 15_000);

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const match = /PolicyOps: (http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/.exec(buffer);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ dataDir, documentPath, url: match[1]!, stop });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    child.once('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`servidor local encerrou antes de subir (código ${code}). Saída:\n${buffer}`));
      }
    });
  });
}
