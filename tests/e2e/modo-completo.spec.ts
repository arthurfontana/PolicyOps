import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * O outro lado do critério de aceite da Sessão 05: servido por http local —
 * como no SharePoint, que é https — o Chromium tem origem **não opaca** e a
 * aplicação entra em modo `FULL`.
 *
 * O servidor é local, sobe só para este arquivo e serve um arquivo só. Isso
 * não fere "zero requisições de rede em tempo de execução"
 * (docs/02-arquitetura.md §2): a restrição é sobre o que a *página* busca
 * depois de carregada — e o teste abaixo verifica exatamente isso, falhando
 * se a página pedir qualquer coisa além do próprio HTML.
 *
 * Abrir e salvar de verdade não dá para automatizar aqui: `showOpenFilePicker`
 * abre um seletor nativo, fora da página, que a automação não alcança. Esse
 * caminho é coberto por `tests/unit/storage/fsa-adapter.test.ts`, incluindo
 * conflito e backup.
 */

const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');

let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }

  const html = readFileSync(DIST_PATH);
  server = createServer((request, response) => {
    if (request.url === '/PolicyOps.html' || request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('servida por http local, a aplicação entra em modo FULL', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(`${baseUrl}/PolicyOps.html`);
  await page.getByLabel('Nome').fill('Arthur');
  await page.getByRole('button', { name: 'Começar' }).click();

  await expect(page.getByTestId('mode-headline')).toHaveText(
    'Modo completo — a aplicação grava direto no arquivo',
  );
  await expect(page.getByText('com detecção de conflito', { exact: false })).toBeVisible();
  await expect(page.getByText('IndexedDB: disponível', { exact: false })).toBeVisible();

  // Nenhuma requisição além do próprio HTML: nada de CDN, fonte ou telemetria.
  expect(requested).toEqual([`${baseUrl}/PolicyOps.html`]);
  expect(pageErrors).toEqual([]);
});
