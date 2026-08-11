import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 06 — Biblioteca de Variáveis. Critério de aceite E2E de
 * docs/prompts/S06-biblioteca-variaveis.md: criar variável RANGE com 4
 * faixas → publicar → ela aparece disponível (versão vigente) para novas
 * matrizes. A tela de criação de matriz é da S09+ e não existe ainda; a
 * "disponibilidade" verificável aqui é a mesma que `matrix/create` exige de
 * `resolveLevel` (docs/05 §1.1.2): a variável ter uma versão PUBLISHED.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('cria variável RANGE com 4 faixas, publica, e ela fica vigente na lista', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();
  await expect(page.getByRole('heading', { name: 'Documento de exemplo — Políticas de Crédito' })).toBeVisible();

  await page.getByRole('button', { name: 'Variáveis' }).click();
  await expect(page.getByRole('heading', { name: 'Biblioteca › Variáveis' })).toBeVisible();

  await page.getByRole('button', { name: 'Nova variável' }).click();
  await page.getByLabel('Código').fill('FAIXA_TESTE');
  await page.getByLabel('Nome').fill('Faixa de Teste');
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Faixa' }).click();
  await page.getByRole('button', { name: 'Criar variável' }).click();

  // Caiu no detalhe da variável recém-criada, v1 em rascunho, sem domínios.
  await expect(page.getByText('Domínios da versão 1')).toBeVisible();
  await expect(page.getByText('Nenhum domínio ainda.')).toBeVisible();

  // Faixas fechado-fechado com passo 1 (boundaryMode padrão INCLUSIVE_INTEGER,
  // docs/05 §5.6.0): máximo de uma faixa + 1 == mínimo da seguinte.
  const ranges: Array<{ code: string; label: string; min: string; max?: string; catchAll?: boolean }> = [
    { code: 'BAIXO', label: 'Baixo', min: '0', max: '99' },
    { code: 'MEDIO', label: 'Médio', min: '100', max: '499' },
    { code: 'ALTO', label: 'Alto', min: '500', max: '999' },
    { code: 'MUITO_ALTO', label: 'Muito alto', min: '1000', catchAll: true },
  ];

  for (const [index, range] of ranges.entries()) {
    await page.getByRole('button', { name: 'Adicionar domínio' }).click();
    const row = page.getByTestId('domain-row').nth(index);
    await row.getByLabel('Código').fill(range.code);
    await row.getByLabel('Rótulo', { exact: true }).fill(range.label);
    await row.getByLabel('Mínimo').fill(range.min);
    if (range.catchAll === true) {
      await row.getByLabel(/demais casos/).check();
    } else {
      await row.getByLabel('Máximo').fill(range.max!);
    }
  }

  // Sem erro de contiguidade — as 4 faixas se encaixam.
  await expect(page.getByText(/não são contíguas/)).not.toBeVisible();

  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Domínios salvos').first()).toBeVisible();

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Versão 1 publicada').first()).toBeVisible();
  await expect(page.getByText('Vigente').first()).toBeVisible();

  await page.getByRole('button', { name: 'Voltar à lista de variáveis' }).click();
  const row = page.getByRole('button', { name: /Faixa de Teste/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('4 domínios (v1)')).toBeVisible();
  await expect(row.getByText('rascunho aberto')).not.toBeVisible();

  expect(pageErrors).toEqual([]);
});
