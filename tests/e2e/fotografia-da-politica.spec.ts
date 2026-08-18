import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 39 — fotografia histórica da política e comparação
 * (docs/prompts/S39-fotografia-historica.md, US-GOV-07/08, docs/07 §20):
 * a mesma árvore vista em duas datas, e a comparação listando exatamente a
 * mudança do intervalo.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('a política em duas datas: a árvore vira fotografia e a comparação lista o que mudou', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E Fotografia');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Política PJ' })).toBeVisible();

  // --- Uma regra com duas versões, vigências conhecidas --------------------
  await page.getByRole('button', { name: 'Nova seção' }).click();
  await page.getByLabel('Tipo do novo componente').selectOption('RULE');
  await page.getByLabel('Nome do novo componente').fill('Goodlist');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  const node = page.getByTestId('tree-node-GOODLIST');
  await expect(node).toBeVisible();
  await node.click();

  await page.getByRole('button', { name: 'Criar rascunho' }).click();
  await page.getByLabel(/Descrição de negócio/).fill('Aprova sempre que o cliente estiver na lista.');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByLabel('Vigência (obrigatória)').fill('2026-02-01');
  await page.getByRole('button', { name: 'Publicar versão 1' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await page.getByRole('button', { name: 'Criar rascunho a partir desta versão' }).click();
  await page.getByLabel(/Descrição de negócio/).fill('Aprova só se o valor do pedido couber no limite em lista.');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByLabel('Vigência (obrigatória)').fill('2026-03-01');
  await page.getByRole('button', { name: 'Publicar versão 2' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // --- Modo fotografia: a mesma árvore em 15/02 e em 15/03 ----------------
  const verComoEm = page.getByLabel('Ver a política como em');
  await verComoEm.fill('2026-02-15');

  await expect(page.getByText('Fotografia de 15/02/2026 · somente leitura')).toBeVisible();
  await expect(node).toContainText('v1');
  await expect(page.getByRole('button', { name: 'Nova seção' })).toHaveCount(0);
  await expect(page.getByText('Edição bloqueada enquanto a árvore mostra o passado.')).toBeVisible();
  await expect(page.getByText('Mostrando a versão 1')).toBeVisible();

  await verComoEm.fill('2026-03-15');
  await expect(node).toContainText('v2');
  await expect(page.getByText('Mostrando a versão 2')).toBeVisible();

  await page.getByTestId('policy-tree').getByRole('button', { name: 'Voltar para hoje' }).click();
  await expect(page.getByRole('button', { name: 'Nova seção' })).toBeVisible();

  // --- Comparação data × data ---------------------------------------------
  await page.getByRole('button', { name: 'Comparar política' }).click();
  await expect(page.getByRole('heading', { name: 'Comparar a política' })).toBeVisible();

  await page.getByLabel('Data base').fill('2026-02-15');
  await page.getByLabel('Data comparada').fill('2026-03-15');

  const card = page.getByTestId('policy-change-GOODLIST');
  await expect(card).toBeVisible();
  await expect(card).toContainText('alterado');
  await expect(card).toContainText('v1 → v2');
  await expect(card).toContainText('businessDescription');
  await expect(page.getByText('1 alterados')).toBeVisible();

  // Nada muda dentro de um intervalo sem publicação.
  await page.getByLabel('Data comparada').fill('2026-02-20');
  await expect(page.getByText('Nada mudou na política entre as duas pontas.')).toBeVisible();

  expect(pageErrors).toEqual([]);
});
