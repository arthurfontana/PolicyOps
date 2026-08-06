import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Critério de aceite da Sessão 02 (docs/prompts/S02-documento.md): abrir
 * dist/PolicyOps.html e clicar em "Explorar com exemplo" mostra 6 variáveis,
 * 1 regra de compatibilidade, 2 projetos, 2 matrizes, e a matriz PJ com 48
 * combinações.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('Explorar com dados de exemplo mostra as contagens do documento de exemplo', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E');
  await page.getByRole('button', { name: 'Começar' }).click();

  await page.getByRole('button', { name: 'Exemplo' }).click();

  await expect(page.getByRole('heading', { name: 'Documento de exemplo' })).toBeVisible();

  const summaryTiles = page.locator('div.grid.grid-cols-2 > div');
  await expect(summaryTiles).toHaveCount(4);
  await expect(summaryTiles.nth(0)).toContainText('6');
  await expect(summaryTiles.nth(0)).toContainText('Variáveis');
  await expect(summaryTiles.nth(1)).toContainText('1');
  await expect(summaryTiles.nth(1)).toContainText('Regras de compatibilidade');
  await expect(summaryTiles.nth(2)).toContainText('2');
  await expect(summaryTiles.nth(2)).toContainText('Projetos');
  await expect(summaryTiles.nth(3)).toContainText('2');
  await expect(summaryTiles.nth(3)).toContainText('Matrizes');

  await expect(page.getByText('MTZ_LIMITE_PJ', { exact: false })).toBeVisible();
  await expect(page.getByText('6 × 8 = 48 combinações')).toBeVisible();

  expect(pageErrors).toEqual([]);
});
