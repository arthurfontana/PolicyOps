import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Critérios de aceite da Sessão 17 Parte A (docs/prompts/S17-templates-merge-export.md):
 * criar matriz a partir de "Limite PJ segmentado" e ver o grid aninhado
 * pré-preenchido.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('wizard passo zero: criar matriz a partir do template "Limite PJ segmentado" pré-preenche o grid aninhado', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Política PJ' })).toBeVisible();

  await page.getByRole('button', { name: 'Nova matriz' }).click();
  const createDialog = page.getByRole('dialog');
  await expect(createDialog.getByText('Passo 1 de 3')).toBeVisible();

  // Passo zero: usa o template em vez de começar do zero.
  await createDialog.getByRole('button', { name: /Limite PJ segmentado/ }).click();

  await expect(createDialog.getByText('Passo 2 de 3')).toBeVisible();
  await createDialog.getByLabel('Nome').fill('Limite PJ Segmentado — E2E');
  await createDialog.getByRole('button', { name: 'Avançar' }).click();

  // Passo 2, vindo de template: eixos bloqueados, com o preview do template.
  await expect(createDialog.getByText('Passo 3 de 3')).toBeVisible();
  await expect(createDialog.getByText(/vêm do template e não podem ser alterados/)).toBeVisible();
  await expect(createDialog.getByText(/Segmento.*Faixa de Faturamento/)).toBeVisible();
  await expect(createDialog.getByTestId('template-grid-preview')).toContainText('de 48 combinaç');

  await createDialog.getByRole('button', { name: 'Criar matriz' }).click();

  await expect(
    page.getByRole('heading', { name: 'Limite PJ Segmentado — E2E', level: 1 }),
  ).toBeVisible();
  await expect(page.locator('[role="gridcell"]')).toHaveCount(48);
  await expect(page.getByTestId('grid-counters')).toContainText('48 combinações');
  // Defaults preenchem 100% das combinações — o grid aninhado nasce sem pendências.
  await expect(page.getByTestId('grid-counters')).toContainText('48 preenchidas');
  await expect(page.getByTestId('grid-counters')).toContainText('0 pendentes');

  expect(pageErrors).toEqual([]);
});

test('lista de templates mostra os dois templates de exemplo, e o editor abre com as regras do template', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  await page.getByRole('button', { name: 'Templates' }).click();
  await expect(page.getByRole('heading', { name: 'Templates', level: 1 })).toBeVisible();
  await expect(page.getByText('Matriz padrão PF')).toBeVisible();
  await expect(page.getByText('Limite PJ segmentado')).toBeVisible();

  await page.getByText('Limite PJ segmentado').click();
  await expect(page.getByRole('heading', { name: 'Editar template' })).toBeVisible();
  await expect(page.getByLabel('Código')).toHaveValue('TPL_PJ_SEGMENTADO');
  await expect(page.getByTestId('seed-rule-row')).toHaveCount(4);
  await expect(page.getByTestId('template-grid-preview')).toContainText('48 de 48 combinaç');

  expect(pageErrors).toEqual([]);
});
