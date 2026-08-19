import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 42 — o componente de política ganha página própria no centro da
 * tela, sem painel de 340px (docs/07-ux-e-editor.md §2, §6, §17.5;
 * DEC-UX-002). Cobre CT-UX-02 do §21.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('CT-UX-02: a página do componente ocupa o centro, sem painel direito, com a descrição de negócio em ≥6 linhas', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E Página do Componente');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Política PJ' })).toBeVisible();

  // --- Uma regra com rascunho aberto ---------------------------------------
  await page.getByRole('button', { name: 'Nova seção' }).click();
  await page.getByLabel('Tipo do novo componente').selectOption('RULE');
  await page.getByLabel('Nome do novo componente').fill('Bloqueios por Dívida');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  const node = page.getByTestId('tree-node-BLOQUEIOS_POR_DIVIDA');
  await expect(node).toBeVisible();
  await node.click();

  // --- A página abre no centro, com o botão ▥ desabilitado ------------------
  const componentPage = page.getByTestId('component-page');
  await expect(componentPage).toBeVisible();

  const inspectorButton = page.getByRole('button', { name: /inspector/i });
  await expect(inspectorButton).toBeDisabled();
  await expect(inspectorButton).toHaveAttribute('title', 'Esta tela não tem propriedades de seleção');
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Criar rascunho' }).click();

  // --- O campo "Descrição de negócio" tem pelo menos 6 linhas visíveis -----
  const businessDescription = page.getByLabel(/Descrição de negócio/);
  await expect(businessDescription).toBeVisible();
  const rows = await businessDescription.evaluate((el) => (el as HTMLTextAreaElement).rows);
  expect(rows).toBeGreaterThanOrEqual(6);

  // Ainda sem painel direito, mesmo com o rascunho aberto.
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toHaveCount(0);
  await expect(inspectorButton).toBeDisabled();

  expect(pageErrors).toEqual([]);
});
