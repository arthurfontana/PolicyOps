import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Critério de aceite da Sessão 33a (docs/prompts/S33a-arvore-da-politica.md):
 * montar 3 níveis na árvore, pendurar uma matriz existente, mover uma seção
 * e conferir que a ordem persiste no documento salvo.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('montar 3 níveis, pendurar matriz existente, mover uma seção e conferir a ordem salva', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E Árvore');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Política PJ' })).toBeVisible();

  // --- Nível 1: uma seção raiz -------------------------------------------
  await page.getByRole('button', { name: 'Nova seção' }).click();
  await page.getByLabel('Nome do novo componente').fill('Capítulo E2E');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); // descarta a caixa encadeada

  const capitulo = page.getByTestId('tree-node-CAPITULO_E2E');
  await expect(capitulo).toBeVisible();

  // --- Nível 2: filho do capítulo, via Tab antes de gravar ----------------
  await capitulo.click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.getByLabel('Nome do novo componente').fill('Grupo E2E');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  const grupo = page.getByTestId('tree-node-GRUPO_E2E');
  await expect(grupo).toBeVisible();

  // --- Nível 3: neto do capítulo, filho do grupo --------------------------
  await grupo.click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.getByLabel('Nome do novo componente').fill('Regra E2E');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('tree-node-REGRA_E2E')).toBeVisible();

  // --- Pendurar uma matriz existente sob o capítulo -----------------------
  await capitulo.hover();
  await page.getByRole('button', { name: 'Mais ações para Capítulo E2E' }).click();
  await page.getByRole('menuitem', { name: 'Adicionar matriz…' }).click();
  await expect(page.getByRole('dialog', { name: 'Pendurar matriz existente' })).toBeVisible();
  await page.getByRole('option', { name: /MTZ_LIMITE_PJ/ }).click();
  await expect(page.getByRole('dialog', { name: 'Pendurar matriz existente' })).not.toBeVisible();
  await expect(page.getByTestId('tree-node-MTZ_LIMITE_PJ')).toBeVisible();

  // --- Mover "Grupo E2E" (com "Regra E2E" dentro) para a raiz do projeto --
  await grupo.hover();
  await page.getByRole('button', { name: 'Mais ações para Grupo E2E' }).click();
  await page.getByRole('menuitem', { name: 'Mover para…' }).click();
  await expect(page.getByRole('dialog', { name: /Mover "Grupo E2E"/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Destino' }).click();
  await page.getByRole('option', { name: 'Raiz da política' }).click();
  await page.getByRole('button', { name: 'Início' }).click();
  await page.getByRole('button', { name: 'Mover', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // --- Salva e confere a ordem persistida no documento --------------------
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Control+s'),
  ]);
  const filePath = await download.path();
  if (filePath === null) throw new Error('Download sem caminho local.');
  const saved = JSON.parse(readFileSync(filePath, 'utf-8'));

  const byCode: Record<string, { parentId: string | null; position: number; type: string }> = {};
  for (const component of saved.components as Array<{
    code: string;
    parentId?: string;
    position: number;
    type: string;
  }>) {
    byCode[component.code] = { parentId: component.parentId ?? null, position: component.position, type: component.type };
  }

  const capituloId = saved.components.find((c: { code: string }) => c.code === 'CAPITULO_E2E').id;
  const grupoId = saved.components.find((c: { code: string }) => c.code === 'GRUPO_E2E').id;

  // "Grupo E2E" virou raiz, na posição 0.
  expect(byCode.GRUPO_E2E).toMatchObject({ parentId: null, position: 0, type: 'SECTION' });
  // "Regra E2E" continua dentro de "Grupo E2E" — a subárvore moveu junto.
  expect(byCode.REGRA_E2E).toMatchObject({ parentId: grupoId, type: 'SECTION' });
  // "Capítulo E2E" ficou sem "Grupo E2E", mas com o nó da matriz pendurada.
  expect(byCode.MTZ_LIMITE_PJ.parentId).toBe(capituloId);
  expect(byCode.MTZ_LIMITE_PJ.type).toBe('MATRIX');

  const matrixNode = saved.components.find((c: { code: string }) => c.code === 'MTZ_LIMITE_PJ');
  const matrix = saved.matrices.find((m: { id: string }) => m.id === matrixNode.matrixId);
  expect(matrix.code).toBe('MTZ_LIMITE_PJ');

  expect(pageErrors).toEqual([]);
});
