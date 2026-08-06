import { test, expect, type Locator, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * A tabela de interações de docs/07-ux-e-editor.md §5 verificada **no
 * navegador**, linha por linha, sobre `MTZ_LIMITE_PJ` (6 colunas de Score × 8
 * linhas de SEGMENTO › FAT) — critério de aceite da Sessão 10.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

/** Abre o exemplo e navega até o grid de `MTZ_LIMITE_PJ`. */
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

const X_TUPLES = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
const Y_TUPLES = [
  'VAREJO|ATE_100K',
  'VAREJO|100K_500K',
  'VAREJO|500K_1M',
  'ATACADO|500K_1M',
  'ATACADO|1M_10M',
  'ATACADO|ACIMA_10M',
  'CORPORATE|1M_10M',
  'CORPORATE|ACIMA_10M',
];

function cell(page: Page, xIndex: number, yIndex: number): Locator {
  return page.locator(`[data-cell-key="${X_TUPLES[xIndex]}::${Y_TUPLES[yIndex]}"]`);
}

function yHeader(page: Page, level: number, path: string): Locator {
  return page.locator(`[role="rowheader"][data-header-path="${path}"][data-header-level="${level}"]`);
}

function selectedCells(page: Page): Locator {
  return page.locator('[role="gridcell"][aria-selected="true"]');
}

test('§5 — clique, Shift, Ctrl, setas, Ctrl+A e Esc no navegador', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await openPJMatrix(page);

  // Clique: seleção única + âncora.
  await cell(page, 1, 2).click();
  await expect(selectedCells(page)).toHaveCount(1);
  await expect(page.getByTestId('selection-counter')).toContainText('×');

  // Shift + clique: retângulo desde a âncora.
  await cell(page, 3, 4).click({ modifiers: ['Shift'] });
  await expect(selectedCells(page)).toHaveCount(3 * 3);

  // Shift + clique de novo parte da âncora, não da última célula.
  await cell(page, 2, 3).click({ modifiers: ['Shift'] });
  await expect(selectedCells(page)).toHaveCount(2 * 2);

  // Ctrl + clique: alterna e reancora.
  await cell(page, 5, 7).click({ modifiers: ['ControlOrMeta'] });
  await expect(selectedCells(page)).toHaveCount(5);
  await cell(page, 5, 7).click({ modifiers: ['ControlOrMeta'] });
  await expect(selectedCells(page)).toHaveCount(4);

  // Setas movem a seleção única; Shift + setas expandem e encolhem.
  await cell(page, 0, 0).click();
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, 0, 1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(selectedCells(page)).toHaveCount(4);
  await page.keyboard.press('Shift+ArrowUp');
  await expect(selectedCells(page)).toHaveCount(2);

  // Ctrl + A e Esc.
  await page.keyboard.press('ControlOrMeta+a');
  await expect(selectedCells(page)).toHaveCount(48);
  await expect(page.getByTestId('selection-counter')).toHaveText('48 células selecionadas');
  await page.keyboard.press('Escape');
  await expect(selectedCells(page)).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});

test('§5 — cabeçalhos aninhados: Varejo pega 18 células, Corporate 12, e a faixa pega o Atacado', async ({
  page,
}) => {
  await openPJMatrix(page);

  // Nível 0: "Varejo" cobre 3 linhas → 18 células.
  await yHeader(page, 0, 'VAREJO').click();
  await expect(selectedCells(page)).toHaveCount(18);
  await expect(page.getByTestId('selection-counter')).toHaveText('18 células selecionadas');
  await expect(yHeader(page, 0, 'VAREJO')).toHaveAttribute('data-selected', 'true');

  // "Corporate" cobre 2 linhas → 12 células (supressão assimétrica).
  await yHeader(page, 0, 'CORPORATE').click();
  await expect(selectedCells(page)).toHaveCount(12);

  // Nível 1: uma linha só.
  await yHeader(page, 1, 'VAREJO|100K_500K').click();
  await expect(selectedCells(page)).toHaveCount(6);
  await expect(yHeader(page, 0, 'VAREJO')).not.toHaveAttribute('data-selected', 'true');

  // Shift + clique estende a faixa do mesmo nível, inclusive o Atacado do meio.
  await yHeader(page, 0, 'VAREJO').click();
  await yHeader(page, 0, 'CORPORATE').click({ modifiers: ['Shift'] });
  await expect(selectedCells(page)).toHaveCount(48);
  await expect(yHeader(page, 0, 'ATACADO')).toHaveAttribute('data-selected', 'true');

  // Ctrl + clique em cabeçalho soma.
  await yHeader(page, 0, 'VAREJO').click();
  await yHeader(page, 0, 'CORPORATE').click({ modifiers: ['ControlOrMeta'] });
  await expect(selectedCells(page)).toHaveCount(30);
  await expect(yHeader(page, 0, 'ATACADO')).not.toHaveAttribute('data-selected', 'true');

  // Canto superior esquerdo seleciona tudo.
  await page.getByTestId('grid-corner').click();
  await expect(selectedCells(page)).toHaveCount(48);
});

test('§5 — marquee: arrasto substitui, Ctrl + arrasto soma, e sair do grid gruda nos limites', async ({
  page,
}) => {
  await openPJMatrix(page);

  // Arrasto simples: 3 × 3, com o retângulo translúcido visível durante o gesto.
  // `hover()` posiciona o ponteiro no centro visível da célula — mais robusto
  // que coordenadas fixas, que podem cair fora da área de rolagem.
  await cell(page, 1, 1).hover();
  await page.mouse.down();
  await cell(page, 3, 3).hover();
  await expect(page.getByTestId('grid-marquee')).toBeVisible();
  await expect(selectedCells(page)).toHaveCount(9);

  // Sair do grid e voltar: a coordenada gruda no limite e volta.
  await page.mouse.move(5000, 5000, { steps: 4 });
  await expect(selectedCells(page)).toHaveCount(5 * 7);
  await cell(page, 3, 3).hover();
  await expect(selectedCells(page)).toHaveCount(9);
  await page.mouse.up();
  await expect(page.getByTestId('grid-marquee')).toHaveCount(0);
  await expect(selectedCells(page)).toHaveCount(9);

  // Ctrl + arrasto soma um bloco distante, sem apagar o que já estava.
  await page.keyboard.down('Control');
  await cell(page, 0, 5).hover();
  await page.mouse.down();
  await cell(page, 0, 6).hover();
  await page.mouse.up();
  await page.keyboard.up('Control');
  await expect(selectedCells(page)).toHaveCount(11);

  // O arrasto não deixou o navegador selecionar texto na página.
  const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(selectedText).toBe('');
});
