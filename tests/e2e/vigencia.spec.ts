import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Critérios de aceite da Sessão 15 (docs/prompts/S15-vigencia-por-data.md):
 * escolher uma data no passado mostra a versão histórica correta, com banner;
 * clicar num segmento da linha do tempo navega certo; o link com a data no
 * hash é compartilhável.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

async function openApp(page: Page): Promise<void> {
  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E Vigência');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();
}

/**
 * Publica o rascunho v2 já existente de MTZ_LIMITE_PF (documento de exemplo):
 * v1 vira histórica (vigente desde a criação da biblioteca, ~90 dias atrás,
 * até hoje) e v2 passa a vigente — a janela larga o bastante para os atalhos
 * de data (30/90 dias atrás) caírem dentro dela com folga.
 */
async function publishPFDraft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PF/ }).first().click();
  await page.getByRole('button', { name: /MTZ_LIMITE_PF/ }).click();

  await page.getByLabel('Selecionar versão').click();
  await page.getByRole('option', { name: /^v2 ·/ }).click();

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Notas desta publicação').fill('Segunda publicação da política PF.');
  await dialog.getByLabel(/digite o número da versão/i).fill('2');
  await dialog.getByRole('button', { name: 'Publicar versão 2' }).click();
  await expect(page.getByRole('main').getByText('Vigente · v2', { exact: true })).toBeVisible();
}

test('data no passado mostra a versão histórica correta, com banner e link para o viewer', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await openApp(page);
  await publishPFDraft(page);

  await page.getByRole('button', { name: 'Vigência', exact: true }).click();
  await expect(page).toHaveURL(/#\/timeline/);

  // Projeto padrão já é Política PF — o primeiro projeto do documento.
  await page.getByRole('button', { name: '30 dias atrás' }).click();

  // O hash carrega data e projeto — o link é compartilhável (docs/07 §10).
  const hash = await page.evaluate(() => window.location.hash);
  expect(hash).toContain('#/timeline?');
  expect(hash).toContain('date=');
  expect(hash).toContain('project=');

  const row = page.getByRole('listitem').filter({ hasText: 'MTZ_LIMITE_PF' });
  await expect(row).toContainText('MTZ_LIMITE_PF');
  await expect(row).toContainText('v1');
  await expect(row).not.toContainText('vigente hoje');
  await expect(row.getByText(/vigente de/)).toBeVisible();

  // Link direto para o viewer: abre a versão histórica correta.
  await row.getByRole('button', { name: 'Abrir no viewer' }).click();

  await expect(page.getByTestId('historical-banner')).toBeVisible();
  await expect(page.getByTestId('historical-banner')).toContainText('versão histórica');
  await expect(page.getByTestId('historical-banner')).toContainText('versão 1');
  await expect(page.getByTestId('historical-watermark')).toContainText('HISTÓRICO');
  await expect(page.getByRole('main').getByText(/^Histórico ·/)).toBeVisible();

  // "Ir para a vigente" leva à v2, e o banner/marca d'água somem.
  await page.getByTestId('historical-banner').getByRole('button', { name: 'Ir para a vigente' }).click();
  await expect(page.getByLabel('Selecionar versão')).toContainText('v2');
  await expect(page.getByTestId('historical-banner')).not.toBeVisible();
  await expect(page.getByTestId('historical-watermark')).not.toBeVisible();

  // Um projeto sem política vigente naquela data mostra a mensagem, não erro.
  await page.getByRole('button', { name: 'Vigência', exact: true }).click();
  await page.getByLabel('Selecionar projeto').click();
  await page.getByRole('option', { name: /Política PJ/ }).click();
  await page.getByRole('button', { name: '90 dias atrás' }).click();
  await expect(page.getByText(/sem política vigente em/)).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('clicar num segmento da linha do tempo navega para aquela versão', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await openApp(page);
  await publishPFDraft(page);

  await page.getByRole('button', { name: 'Vigência', exact: true }).click();
  await page.getByTestId('timeline-segment-v1').click();

  await expect(page.getByTestId('historical-banner')).toBeVisible();
  await expect(page.getByLabel('Selecionar versão')).toContainText('v1');

  expect(pageErrors).toEqual([]);
});

test('visão de portfólio mostra a miniatura, e "Exportar esta visão" baixa o JSON canônico', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await openApp(page);
  await page.getByRole('button', { name: 'Vigência', exact: true }).click();

  await page.getByRole('tab', { name: 'Portfólio' }).click();
  await expect(page.getByRole('img', { name: /Miniatura da matriz/ }).first()).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar esta visão' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^vigencia-.*\.json$/);

  expect(pageErrors).toEqual([]);
});
