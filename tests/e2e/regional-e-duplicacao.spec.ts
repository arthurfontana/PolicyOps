import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 18 — Dimensão regional em variáveis RANGE e duplicação de variável.
 * Critério de aceite E2E (docs/prompts/S18): criar variável RANGE, ligar
 * dimensão regional, colar uma tabela pequena (2 regionais × 3 faixas),
 * salvar, publicar; duplicar essa variável a partir da tela de nova variável
 * e conferir que a cópia chega com os mesmos domínios em DRAFT.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('cria variável RANGE regional colando tabela, publica, e duplica a partir da tela de nova variável', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E Regional');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();
  await expect(page.getByRole('heading', { name: 'Documento de exemplo — Políticas de Crédito' })).toBeVisible();

  await page.getByRole('button', { name: 'Variáveis' }).click();
  await expect(page.getByRole('heading', { name: 'Biblioteca › Variáveis' })).toBeVisible();

  await page.getByRole('button', { name: 'Nova variável' }).click();
  await page.getByLabel('Código').fill('HVI_REGIONAL');
  await page.getByLabel('Nome').fill('HVI Regional');
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Faixa' }).click();
  await page.getByRole('button', { name: 'Criar variável' }).click();

  await expect(page.getByText('Domínios da versão 1')).toBeVisible();

  // Liga a dimensão regional.
  await page.getByRole('checkbox', { name: 'Esta faixa varia por regional' }).check();

  // Cola uma tabela pequena: 2 regionais (BASE, SP) × 3 faixas.
  await page.getByRole('button', { name: 'Colar tabela' }).click();
  const table = [
    ['', 'BASE', '', 'SP', ''].join('\t'),
    ['', 'MIN', 'MAX', 'MIN', 'MAX'].join('\t'),
    ['R1 - Baixo', '0', '100', '0', '120'].join('\t'),
    ['R2 - Medio', '100', '200', '120', '240'].join('\t'),
    ['R3 - Alto', '200', '999', '240', '999'].join('\t'),
  ].join('\n');
  await page.getByLabel('Tabela colada').fill(table);
  await page.getByRole('button', { name: 'Aplicar' }).click();

  // A caixa fechou e o grid regional foi preenchido, sem erro de contiguidade.
  await expect(page.getByLabel('Tabela colada')).not.toBeVisible();
  await expect(page.getByText(/não são contíguas/)).not.toBeVisible();
  await expect(page.getByLabel('Mínimo (BASE)').first()).toHaveValue('0');

  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Domínios salvos').first()).toBeVisible();

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Versão 1 publicada').first()).toBeVisible();

  await page.getByRole('button', { name: 'Voltar à lista de variáveis' }).click();
  const row = page.getByRole('button', { name: /HVI Regional/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('3 domínios (v1)')).toBeVisible();

  // Duplicar a partir da tela de nova variável.
  await page.getByRole('button', { name: 'Nova variável' }).click();
  await page.getByRole('button', { name: 'Ou crie a partir de uma variável existente' }).click();

  await page.getByRole('combobox', { name: 'Variável de origem' }).click();
  await page.getByRole('option', { name: /HVI_REGIONAL/ }).click();
  await page.getByLabel('Código da nova variável').fill('HVI_REGIONAL_2');
  await page.getByLabel('Nome').fill('HVI Regional 2');
  await page.getByRole('button', { name: 'Criar variável' }).click();

  // Caiu no detalhe da cópia, v1 em DRAFT, com os mesmos 3 domínios.
  await expect(page.getByText('Domínios da versão 1')).toBeVisible();
  await expect(page.getByText('Rascunho').first()).toBeVisible();
  await expect(page.getByText('3 domínio(s)')).toBeVisible();
  await expect(page.getByLabel('Mínimo (BASE)').first()).toHaveValue('0');
  await expect(page.getByLabel('Mínimo (SP)').first()).toHaveValue('0');

  await page.getByRole('button', { name: 'Voltar à lista de variáveis' }).click();
  const originalRow = page.getByRole('button', { name: /^HVI Regional /, exact: false }).first();
  await expect(originalRow.getByText('3 domínios (v1)')).toBeVisible();

  expect(pageErrors).toEqual([]);
});
