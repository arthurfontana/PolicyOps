import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Critérios de aceite da Sessão 13 (docs/prompts/S13-ciclo-de-vida.md): o
 * ciclo completo — rascunho, publicação e histórico — funciona no navegador
 * sem tocar no arquivo manualmente.
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

/**
 * O texto do badge de estado aparece em até três lugares (barra superior, o
 * seletor de versão e o inspector) — escopar à `<main>` (barra superior +
 * grid) pega só a barra superior, sem ambiguidade de `strict mode`.
 */
function topBarText(page: Page, text: string) {
  return page.getByRole('main').getByText(text, { exact: true });
}

/** Conteúdo de cada célula do grid, na ordem de leitura — base de comparação (§ restauração). */
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

/**
 * A partir da v1 vigente de MTZ_LIMITE_PJ já aberta: cria o rascunho, aprova
 * 3 células (edição real, verificável) e publica como v2. Devolve o
 * documento com v1 SUPERSEDED e v2 PUBLISHED vigente.
 */
async function createEditAndPublishDraft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Criar rascunho' }).click();
  await expect(page.getByLabel('Selecionar versão')).toContainText('v2');

  // R4, R5 e R6 × Corporate|1M_10M começam em ANALISE_MANUAL (dado
  // determinístico do exemplo): as três garantidamente mudam ao aprovar.
  const yPath = 'CORPORATE|1M_10M';
  const cellR4 = page.locator(`[data-cell-key="R4::${yPath}"]`);
  const cellR5 = page.locator(`[data-cell-key="R5::${yPath}"]`);
  const cellR6 = page.locator(`[data-cell-key="R6::${yPath}"]`);
  await cellR4.click();
  await cellR5.click({ modifiers: ['Control'] });
  await cellR6.click({ modifiers: ['Control'] });
  await expect(page.getByTestId('selection-counter')).toContainText('3 células selecionadas');

  await page.getByRole('button', { name: 'Aprovar tudo' }).click();

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  // O resumo semântico do diálogo (S14) prova que a edição das 3 células foi
  // registrada — e na linguagem do negócio: elas passaram de análise manual a
  // aprovadas, logo foram abertas.
  await expect(dialog.getByTestId('publish-diff-summary')).toContainText('3 células abertas');
  await dialog.getByLabel('Notas desta publicação').fill('Ajuste pontual na política de crédito PJ.');
  await dialog.getByLabel(/digite o número da versão/i).fill('2');
  await dialog.getByRole('button', { name: 'Publicar versão 2' }).click();

  await expect(topBarText(page, 'Vigente · v2')).toBeVisible();
}

test('fluxo completo: vigente → criar rascunho → editar 3 células → publicar → histórico com a janela correta', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await openPJMatrix(page);
  await expect(topBarText(page, 'Vigente · v1')).toBeVisible();

  await createEditAndPublishDraft(page);

  // O histórico mostra a v1 agora como versão histórica, com janela de
  // vigência (de X a hoje) — não mais "Vigente".
  await page.getByRole('button', { name: 'Histórico' }).click();
  const history = page.getByRole('dialog');
  await expect(history.getByText('Versão 2')).toBeVisible();
  await expect(history.getByText('Versão 1')).toBeVisible();
  await expect(history.getByText(/vigente de .* até /)).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('caminho de erro: matriz nova com tudo pendente → publicar dá barra dedicada, não toast → "selecionar todas as pendentes" funciona', async ({
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

  await page.getByRole('button', { name: 'Nova matriz' }).click();
  const createDialog = page.getByRole('dialog');
  await createDialog.getByLabel('Nome').fill('Matriz de Teste de Pendências');
  await createDialog.getByRole('button', { name: 'Avançar' }).click();

  // Eixo X: Faixa de Renda (4 domínios) — variável sem uso em nenhuma matriz do exemplo.
  await createDialog.getByRole('button', { name: 'Adicionar nível' }).nth(0).click();
  await createDialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: /Faixa de Renda/ }).click();

  // Eixo Y: Tempo de Empresa (4 domínios) — idem.
  await createDialog.getByRole('button', { name: 'Adicionar nível' }).nth(1).click();
  await createDialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: /Tempo de Empresa/ }).click();

  await expect(createDialog.getByText('4 linhas × 4 colunas = 16 combinações')).toBeVisible();
  await createDialog.getByRole('button', { name: 'Criar matriz' }).click();

  await expect(page.locator('[role="gridcell"]')).toHaveCount(16);
  await expect(page.getByTestId('grid-counters')).toContainText('16 pendentes');

  await page.getByRole('button', { name: 'Publicar' }).click();
  const publishDialog = page.getByRole('dialog');
  await publishDialog.getByLabel('Notas desta publicação').fill('Tentando publicar sem preencher nada.');
  await publishDialog.getByLabel(/digite o número da versão/i).fill('1');
  await publishDialog.getByRole('button', { name: 'Publicar versão 1' }).click();

  // Não é um toast: o diálogo fecha e uma barra dedicada aparece, acionável.
  await expect(publishDialog).not.toBeVisible();
  const pendingBar = page.getByTestId('pending-cells-bar');
  await expect(pendingBar).toBeVisible();
  await expect(pendingBar).toContainText('16 combinações ainda não preenchidas');

  await pendingBar.getByRole('button', { name: 'Selecionar todas as pendentes' }).click();
  await expect(page.getByTestId('selection-counter')).toContainText('16 células selecionadas');

  expect(pageErrors).toEqual([]);
});

test('descarte: criar rascunho → descartar → criar outro → o número da versão pulou', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await openPJMatrix(page);

  await page.getByRole('button', { name: 'Criar rascunho' }).click();
  await expect(page.getByLabel('Selecionar versão')).toContainText('v2');

  await page.getByRole('button', { name: 'Descartar rascunho' }).click();
  const discardDialog = page.getByRole('dialog');
  await expect(discardDialog.getByText(/não será reutilizado/)).toBeVisible();
  await discardDialog.getByRole('button', { name: 'Descartar rascunho' }).click();

  await expect(topBarText(page, 'Vigente · v1')).toBeVisible();

  await page.getByRole('button', { name: 'Criar rascunho' }).click();
  // v2 foi queimada: o próximo rascunho é v3, não uma nova v2.
  await expect(page.getByLabel('Selecionar versão')).toContainText('v3');

  expect(pageErrors).toEqual([]);
});

test('restauração: abrir versão histórica → restaurar como rascunho → o conteúdo confere com a histórica', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await openPJMatrix(page);
  await createEditAndPublishDraft(page);

  // Volta para a v1, agora histórica (SUPERSEDED).
  await page.getByLabel('Selecionar versão').click();
  await page.getByRole('option', { name: /^v1 ·/ }).click();
  await expect(page.getByRole('main').getByText(/^Histórico ·/)).toBeVisible();

  const historicSnapshot = await gridSnapshot(page);

  await page.getByRole('button', { name: 'Restaurar como rascunho' }).click();

  await expect(topBarText(page, 'Rascunho')).toBeVisible();
  await expect(page.getByLabel('Selecionar versão')).toContainText('v3');
  expect(await gridSnapshot(page)).toEqual(historicSnapshot);

  expect(pageErrors).toEqual([]);
});
