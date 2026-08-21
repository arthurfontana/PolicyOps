import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 44 — teclado/volume (docs/07-ux-e-editor.md §17.1/§17.3, US-UX-03):
 * cadastrar cinco regras irmãs só de teclado, preencher a descrição de
 * negócio de cada uma e publicar as cinco de uma vez pelo diálogo "Publicar
 * pendentes" — o fluxo que faz ~50 regras não virarem duas semanas.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('cinco regras irmãs criadas e nomeadas só de teclado, com descrição, publicadas em lote', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E Volume');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Política PJ' })).toBeVisible();

  const names = ['Regra Volume 1', 'Regra Volume 2', 'Regra Volume 3', 'Regra Volume 4', 'Regra Volume 5'];

  // --- Criação: a árvore está vazia, então não há nó nenhum para focar com
  // o teclado ainda — "Nova regra" na barra (um clique, como em qualquer
  // outra sessão de E2E que começa de uma árvore vazia) nasce a primeira
  // regra na raiz. Dali em diante, o Enter que encadeia herda o mesmo tipo
  // (RULE) do rascunho anterior — as cinco saem de um só clique inicial,
  // sem tocar o mouse de novo (US-UX-03). ------------------------------------
  // A barra de ferramentas colapsa a criação além da primeira abaixo de
  // ~1100px (§2.1) — nessa largura "Nova regra" mora dentro de "⋯ Mais".
  const novaRegraButton = page.getByRole('button', { name: 'Nova regra' });
  const maisButton = page.getByRole('button', { name: '⋯ Mais' });
  if (await maisButton.isVisible()) {
    await maisButton.click();
    await page.getByRole('menuitem', { name: 'Nova regra' }).click();
  } else {
    await novaRegraButton.click();
  }
  for (const name of names) {
    const nameInput = page.getByLabel('Nome do novo componente');
    await expect(nameInput).toBeVisible();
    await nameInput.click();
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Escape'); // descarta a sexta caixa (encadeada, vazia)

  for (const name of names) {
    const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    await expect(page.getByTestId(`tree-node-${code}`)).toBeVisible();
  }

  // --- Preenche a descrição de negócio de cada uma (docs/07 §17.5) ---------
  for (const name of names) {
    const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    await page.getByTestId(`tree-node-${code}`).click();
    await expect(page.getByTestId('component-page')).toBeVisible();
    await page.getByRole('button', { name: 'Criar rascunho' }).click();
    const businessDescription = page.getByLabel(/Descrição de negócio/);
    await businessDescription.fill(`Descrição de negócio — ${name}.`);
    await page.keyboard.press('Tab');
  }

  // --- Publica as cinco de uma vez, pelo contador amplo de pendentes -------
  await expect(page.getByTestId('policy-toolbar-pending-counter')).toHaveText('5 pendentes');
  await page.getByTestId('policy-toolbar-pending-counter').click();
  await expect(page.getByRole('dialog', { name: 'Publicar pendentes' })).toBeVisible();
  await expect(page.getByText('5 componente(s) com rascunho em aberto')).toBeVisible();
  await page.getByLabel('Vigência do lote (obrigatória)').fill('2026-04-01');
  await page.getByRole('button', { name: /Publicar 5/ }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // --- A árvore reflete as cinco regras publicadas --------------------------
  await expect(page.getByTestId('policy-toolbar-pending-counter')).toHaveText('0 pendentes');
  for (const name of names) {
    const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    const node = page.getByTestId(`tree-node-${code}`);
    await expect(node).toBeVisible();
    await expect(node).toContainText('Vigente');
  }

  expect(pageErrors).toEqual([]);
});

test('diálogo de atalhos lista a árvore, a barra de ferramentas e a página do componente', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E Atalhos');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Atalhos de teclado' })).toBeVisible();
  await expect(page.getByText('Política — árvore')).toBeVisible();
  await expect(page.getByText('Política — barra de ferramentas')).toBeVisible();
  await expect(page.getByText('Política — página do componente')).toBeVisible();
  await expect(page.getByText('Ctrl+Shift+N')).toBeVisible();
  await expect(page.getByText('Typeahead: salta para o próximo nó cujo nome começa com o texto digitado')).toBeVisible();
});
