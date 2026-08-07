import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 19 — importação genérica de domínios, continuidade automática e
 * paletas de cor. Critério de aceite E2E (docs/prompts/S19):
 *   1. Criar variável CATEGORICAL, colar Domínio+Cor com 4 linhas, salvar, publicar.
 *   2. Criar variável RANGE simples, colar Domínio+Mínimo+Máximo sem tocar em
 *      inclusão manual, confirmar que a contiguidade passa sem configuração extra.
 *   3. Duplicar essa variável e confirmar que as cores aplicadas por paleta sobrevivem.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('CATEGORICAL: colar Domínio+Cor (4 linhas) sem agrupamento, salvar e publicar', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E S19');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();
  await expect(page.getByRole('heading', { name: 'Documento de exemplo — Políticas de Crédito' })).toBeVisible();

  await page.getByRole('button', { name: 'Variáveis' }).click();
  await page.getByRole('button', { name: 'Nova variável' }).click();
  await page.getByLabel('Código').fill('RISCO_CAT');
  await page.getByLabel('Nome').fill('Risco Categórico');
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Categórica' }).click();
  await page.getByRole('button', { name: 'Criar variável' }).click();

  await expect(page.getByText('Domínios da versão 1')).toBeVisible();

  await page.getByRole('button', { name: 'Colar tabela' }).click();
  const table = [
    ['Domínio', 'Cor'].join('\t'),
    ['BAIXISSIMO', '#00FF2A'].join('\t'),
    ['BAIXO', '#F0FFF6'].join('\t'),
    ['MEDIO', '#FFA200'].join('\t'),
    ['ALTO', '#FF8080'].join('\t'),
  ].join('\n');
  await page.getByLabel('Tabela de domínios colada').fill(table);
  await page.getByRole('button', { name: 'Aplicar' }).click();

  await expect(page.getByLabel('Tabela de domínios colada')).not.toBeVisible();
  await expect(page.locator('input[value="BAIXISSIMO"]').first()).toBeVisible();
  await expect(page.locator('input[value="ALTO"]').first()).toBeVisible();

  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Domínios salvos').first()).toBeVisible();

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Versão 1 publicada').first()).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('RANGE simples: colar Domínio+Mínimo+Máximo sem tocar em inclusão manual valida contiguidade; duplicar preserva cores de paleta', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E S19b');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  await page.getByRole('button', { name: 'Variáveis' }).click();
  await page.getByRole('button', { name: 'Nova variável' }).click();
  await page.getByLabel('Código').fill('RISCO_R');
  await page.getByLabel('Nome').fill('Risco R');
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Faixa' }).click();
  await page.getByRole('button', { name: 'Criar variável' }).click();

  await expect(page.getByText('Domínios da versão 1')).toBeVisible();

  // Colagem genérica sem agrupamento: só Domínio, Mínimo, Máximo — sem
  // tocar em nenhum checkbox de inclusão manual (docs/05 §5.6.0, docs/07 §11).
  await page.getByRole('button', { name: 'Colar tabela' }).click();
  const table = [
    ['Domínio', 'Mínimo', 'Máximo'].join('\t'),
    ['R1', '0', '100'].join('\t'),
    ['R2', '100', '200'].join('\t'),
    ['R3', '200', '999'].join('\t'),
  ].join('\n');
  await page.getByLabel('Tabela de domínios colada').fill(table);
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByLabel('Tabela de domínios colada')).not.toBeVisible();

  // Continuidade automática: nenhum checkbox de inclusão foi tocado, e a
  // validação de contiguidade passa mesmo assim.
  await expect(page.getByText('mín. inclusivo')).not.toBeVisible();
  await expect(page.getByText(/não são contíguas/)).not.toBeVisible();

  // Aplica a paleta Risco R01–R20 — os três domínios (R1, R2, R3) recebem cor.
  await page.getByLabel('Aplicar paleta').selectOption('RISCO_R01_R20');
  await expect(page.getByText(/3 de 3 domínio\(s\) coloridos/)).toBeVisible();

  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Domínios salvos').first()).toBeVisible();

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Versão 1 publicada').first()).toBeVisible();

  // Duplica a variável e confirma que as cores aplicadas pela paleta sobrevivem.
  await page.getByRole('button', { name: 'Voltar à lista de variáveis' }).click();
  await page.getByRole('button', { name: 'Nova variável' }).click();
  await page.getByRole('button', { name: 'Ou crie a partir de uma variável existente' }).click();

  await page.getByRole('combobox', { name: 'Variável de origem' }).click();
  await page.getByRole('option', { name: /RISCO_R/ }).click();
  await page.getByLabel('Código da nova variável').fill('RISCO_R_2');
  await page.getByLabel('Nome').fill('Risco R 2');
  await page.getByRole('button', { name: 'Criar variável' }).click();

  await expect(page.getByText('Domínios da versão 1')).toBeVisible();
  const colorInputs = page.getByLabel('Cor');
  await expect(colorInputs).toHaveCount(3);
  await expect(colorInputs.first()).toHaveValue('#00ff2a');

  expect(pageErrors).toEqual([]);
});
