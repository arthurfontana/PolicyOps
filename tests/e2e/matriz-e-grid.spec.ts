import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Critérios de aceite da Sessão 09 (docs/prompts/S09-grid-e-matrizes.md):
 * abrir o exemplo → projeto PJ → matriz → grid aninhado visível com 48
 * células; rolar e verificar que os cabeçalhos permanecem fixos.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('exemplo → projeto PJ → matriz → grid aninhado de 48 células, com cabeçalhos fixos ao rolar', async ({
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

  await page.getByRole('button', { name: /MTZ_LIMITE_PJ/ }).click();

  await expect(page.getByRole('heading', { name: 'Limite de Crédito — Pessoa Jurídica', level: 1 })).toBeVisible();
  await expect(page.locator('[role="gridcell"]')).toHaveCount(48);
  await expect(page.getByTestId('grid-counters')).toContainText('48 combinações');

  // Sticky aninhado: o cabeçalho de nível 0 de Y ("Varejo") e o cabeçalho de
  // X ("R1") continuam visíveis depois de rolar bastante nos dois eixos —
  // critério de aceite explícito da S09.
  const varejoHeader = page.getByRole('rowheader', { name: 'Varejo' });
  const scoreHeader = page.getByRole('columnheader', { name: /^R1/ }).first();
  await expect(varejoHeader).toBeVisible();
  await expect(scoreHeader).toBeVisible();

  const scrollContainer = page.getByTestId('policy-grid-scroll');
  await scrollContainer.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    el.scrollTop = el.scrollHeight;
  });

  await expect(varejoHeader).toBeVisible();
  await expect(scoreHeader).toBeVisible();

  expect(pageErrors).toEqual([]);
});
