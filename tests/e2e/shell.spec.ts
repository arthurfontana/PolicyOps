import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Prova a premissa central do produto: dist/PolicyOps.html, aberto direto
 * pelo protocolo file:// (duplo clique, sem servidor), mostra o shell
 * funcionando. docs/02-arquitetura.md e o critério de aceite da Sessão 01.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('abre por file:// e mostra o shell com o diálogo de identidade', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);

  // O diálogo de identidade é modal na primeira abertura: Radix marca o resto
  // da página com aria-hidden enquanto ele está aberto, então só o próprio
  // diálogo é verificável por role até o nome ser preenchido.
  await expect(page.getByRole('heading', { name: 'Como você quer ser identificado no histórico?' })).toBeVisible();
  await expect(page.getByText('É possível trocar depois', { exact: false })).toBeVisible();

  await page.getByLabel('Nome').fill('Teste E2E');
  await page.getByRole('button', { name: 'Começar' }).click();

  await expect(page.getByRole('heading', { name: /identificado/i })).not.toBeVisible();
  await expect(page.getByText('PolicyOps', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Policy Matrix Studio' })).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('identificação persiste, sidebar colapsa com [ e tema alterna', async ({ page }) => {
  await page.goto(FILE_URL);

  await page.getByLabel('Nome').fill('Teste E2E');
  await page.getByRole('button', { name: 'Começar' }).click();
  await expect(page.getByRole('heading', { name: /identificado/i })).not.toBeVisible();
  await expect(page.getByText('Teste E2E')).toBeVisible();

  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
  await page.locator('body').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('[');
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeHidden();
  await page.keyboard.press('[');
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();

  const html = page.locator('html');
  await expect(html).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Mudar para tema escuro' }).click();
  await expect(html).toHaveClass(/dark/);

  await page.reload();
  await expect(page.getByText('Teste E2E')).toBeVisible();
  await expect(html).toHaveClass(/dark/);
  await expect(page.getByRole('heading', { name: /identificado/i })).not.toBeVisible();
});

test('navegar para a biblioteca reflete no hash e sobrevive a reload', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E');
  await page.getByRole('button', { name: 'Começar' }).click();

  await page.getByRole('button', { name: /^Variáveis/ }).click();
  await expect(page).toHaveURL(/#\/library\/variables$/);
  await expect(page.getByRole('heading', { name: 'Biblioteca › Variáveis' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Biblioteca › Variáveis' })).toBeVisible();
});
