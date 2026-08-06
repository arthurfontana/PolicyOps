import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Critério de aceite da Sessão 12: matriz PJ v1 → criar rascunho → adicionar o
 * nível `TEMPO_EMPRESA` no eixo X com `REPLICATE` → o grid cresce de 48 para
 * 192 células, todas preenchidas → desfazer → volta a 48, idêntico.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

async function openPJMatrix(page: Page): Promise<void> {
  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();
  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await page.getByRole('button', { name: /MTZ_LIMITE_PJ/ }).click();
  await expect(page.locator('[role="gridcell"]')).toHaveCount(48);
}

/** Conteúdo de cada célula do grid, na ordem de leitura — a base da comparação. */
async function gridSnapshot(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const snapshot: Record<string, string> = {};
    for (const cell of document.querySelectorAll('[role="gridcell"]')) {
      const key = cell.getAttribute('data-cell-key');
      if (key !== null) snapshot[key] = cell.textContent ?? '';
    }
    return snapshot;
  });
}

test('rascunho → adicionar nível TEMPO_EMPRESA em X com REPLICATE → 192 células preenchidas → desfazer', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await openPJMatrix(page);
  const antes = await gridSnapshot(page);
  expect(Object.keys(antes)).toHaveLength(48);

  // A v1 está publicada: primeiro o rascunho.
  await page.getByRole('button', { name: 'Criar rascunho' }).click();
  await expect(page.getByRole('button', { name: /Adicionar nível/ }).first()).toBeVisible();

  // Eixo X (colunas) é o primeiro construtor do inspector.
  await page.getByRole('button', { name: /Adicionar nível/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Adicionar nível ao eixo X (colunas)')).toBeVisible();

  await dialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: /Tempo de Empresa/ }).click();

  // Preview obrigatório: 48 combinações viram 192, com REPLICATE marcado.
  await expect(dialog.getByTestId('add-level-preview')).toContainText('48 combinações viram 192');
  await expect(dialog.getByTestId('grid-miniature')).toBeVisible();

  await dialog.getByRole('button', { name: 'Adicionar nível' }).click();

  await expect(page.locator('[role="gridcell"]')).toHaveCount(192);
  // REPLICATE: nada ficou pendente — todas as 192 estão preenchidas.
  await expect(page.getByTestId('grid-counters')).toContainText('192 preenchidas');
  await expect(page.getByTestId('grid-counters')).toContainText('0 pendentes');

  // Desfazer devolve o grid exatamente como estava.
  await page.keyboard.press('Control+z');
  await expect(page.locator('[role="gridcell"]')).toHaveCount(48);
  expect(await gridSnapshot(page)).toEqual(antes);

  expect(pageErrors).toEqual([]);
});
