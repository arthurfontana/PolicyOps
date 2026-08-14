import { test, expect } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { userInfo } from 'node:os';
import path from 'node:path';

/**
 * Identidade e papéis (Sessão 29) — docs/14-plataforma-local.md §6, ADR-003.
 *
 * Sobe o servidor local de verdade (mesmo padrão de `modo-servidor.spec.ts`)
 * contra uma pasta semeada com um documento cuja ACL define o usuário
 * corrente (o login que `getpass.getuser()` vai resolver no processo Python
 * — o mesmo processo do SO que roda este teste) como `READER`. Critério de
 * aceite da S29: com essa ACL, a interface abre em consulta e o salvamento é
 * recusado nas duas camadas — a interface (dispatcher) e o servidor (403).
 */

const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const SERVER_SCRIPT = path.resolve(import.meta.dirname, '..', '..', 'server', 'policyops_server.py');
const SAMPLE_FIXTURE = path.resolve(import.meta.dirname, '..', 'fixtures', 'sample-document.json');
const PYTHON = process.env.POLICYOPS_PYTHON ?? 'python';

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

type RunningServer = {
  dataDir: string;
  documentPath: string;
  url: string;
  stop: () => Promise<void>;
};

function startServer(seedDocument: unknown): Promise<RunningServer> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'policyops-e2e-acl-'));
  const documentPath = path.join(dataDir, 'politicas.json');
  writeFileSync(documentPath, JSON.stringify(seedDocument, null, 2));

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

    const stop = (): Promise<void> => {
      if (exited) return Promise.resolve();
      return new Promise<void>((res) => {
        child.once('exit', () => res());
        child.kill('SIGTERM');
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

/** O login que `getpass.getuser()` resolve no processo Python — mesma máquina, mesmo usuário do SO. */
const CURRENT_OS_USERNAME = userInfo().username;

/**
 * `startServer` resolve assim que a linha do endereço aparece no stdout, mas
 * o `print` (docs/14 §9, `main()`) acontece **antes** de `uvicorn.run`
 * começar a aceitar conexões — uma corrida pequena, que os outros specs de
 * `modo-servidor.spec.ts` não sentem por sorte de tempo. Aqui, espera
 * `/api/health` responder de verdade antes de navegar.
 */
async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  const healthUrl = new URL(url);
  healthUrl.pathname = '/api/health';
  healthUrl.search = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // ainda não está escutando — tenta de novo
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`/api/health não respondeu a tempo em ${healthUrl}`);
}

function seededDocumentWithReaderAcl(): unknown {
  const doc = JSON.parse(readFileSync(SAMPLE_FIXTURE, 'utf-8')) as {
    meta: Record<string, unknown>;
  };
  doc.meta = {
    ...doc.meta,
    acl: {
      users: [
        { username: CURRENT_OS_USERNAME, role: 'READER' },
        { username: 'outra-pessoa-admin', role: 'ADMIN' },
      ],
      defaultRole: 'READER',
    },
  };
  return doc;
}

test.describe('papéis e ACL — sessão 29', () => {
  let server: RunningServer;

  test.afterEach(async () => {
    await server.stop();
    rmSync(server.dataDir, { recursive: true, force: true });
  });

  test('ACL definindo o usuário como READER: interface abre em consulta e o save é recusado nas duas camadas', async ({
    page,
  }) => {
    server = await startServer(seededDocumentWithReaderAcl());
    await waitForHealth(server.url);

    await page.goto(server.url);
    await expect(
      page.getByRole('heading', { name: 'Documento de exemplo — Políticas de Crédito' }),
    ).toBeVisible();

    // Camada 1 — interface: o papel efetivo aparece na barra de status, e o
    // botão Salvar fica desabilitado com o motivo (docs/14 §6).
    await expect(page.getByTestId('effective-role')).toHaveText('READER');
    await expect(page.getByText('papel READER — só consulta')).toBeVisible();
    const saveButton = page.getByRole('button', { name: 'Salvar', exact: true });
    await expect(saveButton).toBeDisabled();

    // A tela de administração de acesso não aparece na sidebar para READER
    // (a ACL já tem ADMIN — não é modo aberto, não há bootstrap a fazer).
    await expect(page.getByRole('button', { name: 'Acesso' })).not.toBeVisible();

    // Camada 2 — servidor: mesmo contornando a interface e chamando a API
    // direto (o que um script malicioso faria), o servidor recusa com 403.
    // `policyops.server-token` é a mesma chave que `capabilities.ts` usa para
    // guardar o token lido da URL — pega-o do jeito que o front guardou, para
    // montar a mesma chamada que ele faria.
    const rawPut = await page.evaluate(async () => {
      const token = sessionStorage.getItem('policyops.server-token') ?? '';
      const current = await fetch('/api/document', { headers: { 'X-PolicyOps-Token': token } }).then((r) =>
        r.json(),
      );
      const response = await fetch('/api/document', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-PolicyOps-Token': token },
        body: JSON.stringify({ baseHash: current.hash, content: current.raw }),
      });
      return { status: response.status, body: await response.json() };
    });
    expect(rawPut.status).toBe(403);
    expect(rawPut.body.code).toBe('FORBIDDEN');
  });
});
