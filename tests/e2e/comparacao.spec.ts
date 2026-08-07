import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Critério de aceite da Sessão 14 (docs/prompts/S14-diff-e-comparacao.md):
 * comparar v1 × v2 de `MTZ_LIMITE_PF` mostra exatamente as 3 células alteradas
 * nos três modos.
 *
 * As três são dado determinístico do documento de exemplo (docs/03 §11):
 * `R1::SEM` e `R2::SEM` vão de Aprovado para Análise manual, e `R1::BAIXO`
 * vai de Aprovado para Reprovado — as três perdendo o limite que tinham.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

const CHANGED_KEYS = ['R1::BAIXO', 'R1::SEM', 'R2::SEM'];

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

/** Abre o exemplo na v2 (rascunho) de MTZ_LIMITE_PF e clica em "Comparar com a vigente". */
async function openPFComparison(page: Page): Promise<void> {
  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();
  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PF/ }).first().click();
  await page.getByRole('button', { name: /MTZ_LIMITE_PF/ }).click();

  // A matriz abre na vigente (v1): trocar para o rascunho habilita "Comparar
  // com a vigente".
  await page.getByLabel('Selecionar versão').click();
  await page.getByRole('option', { name: /v2/ }).click();
  await page.getByRole('button', { name: 'Comparar com a vigente' }).click();

  await expect(page.getByRole('heading', { name: 'Comparar versões' })).toBeVisible();
}

test('compara v1 × v2 de MTZ_LIMITE_PF nos três modos', async ({ page }) => {
  await openPFComparison(page);

  // A mais antiga sempre à esquerda, mesmo tendo partido da v2.
  await expect(page.getByLabel('Versão base (a mais antiga)')).toContainText('v1');
  await expect(page.getByLabel('Versão comparada')).toContainText('v2');

  // Resumo semântico, em linguagem de negócio.
  const cards = page.getByTestId('diff-summary-cards');
  await expect(cards).toContainText('célula fechada');
  await expect(cards).toContainText('células enviadas para análise manual');
  await expect(cards).toContainText('limites reduzidos');

  // --- Sobreposto (padrão) -------------------------------------------------
  await expect(page.getByTestId('compare-overlay')).toBeVisible();
  const marked = page.locator('[role="gridcell"][data-diff]');
  await expect(marked).toHaveCount(3);
  for (const key of CHANGED_KEYS) {
    await expect(page.locator(`[role="gridcell"][data-diff][data-cell-key="${key}"]`)).toHaveAttribute(
      'data-diff',
      'MODIFIED',
    );
  }

  // Clicar mostra antes → depois no inspector.
  await page.locator('[data-cell-key="R1::BAIXO"]').first().click();
  const detail = page.getByTestId('diff-cell-detail');
  await expect(detail).toContainText('Aprovado');
  await expect(detail).toContainText('Reprovado');

  // --- Lado a lado ---------------------------------------------------------
  await page.getByRole('tab', { name: 'Lado a lado' }).click();
  const panes = page.getByTestId('compare-side-by-side');
  await expect(panes.locator('[role="grid"]')).toHaveCount(2);
  // Cada grid marca as mesmas 3 combinações — 6 células marcadas no total.
  await expect(panes.locator('[role="gridcell"][data-diff]')).toHaveCount(6);

  // --- Lista ---------------------------------------------------------------
  await page.getByRole('tab', { name: 'Lista' }).click();
  await expect(page.getByTestId('diff-list-row')).toHaveCount(3);
  await expect(page.getByTestId('diff-list-count')).toContainText('3 de 3');
  // Caminho legível completo, com os rótulos dos domínios. Escopado à tabela:
  // o inspector mostra o mesmo caminho da célula aberta acima.
  await expect(
    page.getByRole('cell', { name: 'Restritivo baixo × R1 — Risco muito baixo' }),
  ).toBeVisible();
  // A exportação do diff só chega na S17.
  await expect(page.getByRole('button', { name: 'Exportar' })).toBeDisabled();
});

test('comparar matrizes de estruturas diferentes mostra o banner e força o lado a lado', async ({
  page,
}) => {
  await openPFComparison(page);

  // MTZ_LIMITE_PJ tem o eixo Y aninhado (Segmento › Faturamento): pilha
  // diferente da de MTZ_LIMITE_PF, logo estruturalmente incomparável.
  await page.getByLabel('Versão comparada').click();
  await page.getByRole('option', { name: /MTZ_LIMITE_PJ v1/ }).click();

  await expect(page.getByTestId('incomparable-banner')).toBeVisible();
  await expect(page.getByTestId('compare-side-by-side')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Sobreposto' })).toBeDisabled();
});
