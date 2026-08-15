import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 33b — cadastro estruturado e versionamento de regras
 * (docs/prompts/S33b-cadastro-de-regras.md, CT-GOV base da US-GOV-02):
 * criar regra → publicar → criar v2 → a timeline mostra as duas com
 * vigências corretas.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('criar regra, publicar, criar v2 e publicar de novo — a timeline mostra as duas versões com vigência correta', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E Regras');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Política PJ' })).toBeVisible();

  // --- Cria a regra direto na raiz da árvore, sem diálogo modal -----------
  await page.getByRole('button', { name: 'Nova seção' }).click();
  await page.getByLabel('Tipo do novo componente').selectOption('RULE');
  await page.getByLabel('Nome do novo componente').fill('Dívida Acima de R$ 5.000');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); // descarta a caixa encadeada

  const node = page.getByTestId('tree-node-DIVIDA_ACIMA_DE_R_5_000');
  await expect(node).toBeVisible();
  await node.click();

  // --- v1: rascunho, conteúdo e publicação ---------------------------------
  await page.getByRole('button', { name: 'Criar rascunho' }).click();

  const businessDescription = page.getByLabel(/Descrição de negócio/);
  await businessDescription.fill('Bloqueia o cliente com dívida em aberto igual ou superior a R$ 5.000.');
  await page.getByLabel('Definição técnica').fill('Aging > 0 e Valor >= 5000');
  await page.getByLabel('Reason codes (separados por vírgula)').fill('DV01');
  await page.keyboard.press('Tab');

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Publicar a versão 1' })).toBeVisible();
  await page.getByLabel('Vigência (obrigatória)').fill('2026-02-01');
  await page.getByRole('button', { name: 'Publicar versão 1' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await expect(page.getByText('Mostrando a versão 1')).toBeVisible();
  await expect(page.getByTestId('timeline-segment-v1')).toBeVisible();

  // --- v2: novo rascunho a partir da vigente, conteúdo alterado, publicado depois ---
  await page.getByRole('button', { name: 'Criar rascunho a partir desta versão' }).click();
  const businessDescriptionV2 = page.getByLabel(/Descrição de negócio/);
  await businessDescriptionV2.fill('Bloqueia o cliente com dívida em aberto igual ou superior a R$ 8.000.');
  await page.keyboard.press('Tab');

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Publicar a versão 2' })).toBeVisible();
  await page.getByLabel('Vigência (obrigatória)').fill('2026-03-01');
  await page.getByRole('button', { name: 'Publicar versão 2' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // --- A timeline mostra as duas versões, com as vigências corretas -------
  await expect(page.getByText('Mostrando a versão 2')).toBeVisible();
  const v1Segment = page.getByTestId('timeline-segment-v1');
  const v2Segment = page.getByTestId('timeline-segment-v2');
  await expect(v1Segment).toBeVisible();
  await expect(v2Segment).toBeVisible();
  await expect(v1Segment).toHaveAttribute('aria-label', /01\/02\/2026 a 01\/03\/2026/);
  await expect(v2Segment).toHaveAttribute('aria-label', /vigente de 01\/03\/2026/);

  // --- Salva e confere a vigência persistida no documento ------------------
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const filePath = await download.path();
  if (filePath === null) throw new Error('Download sem caminho local.');
  const saved = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(filePath, 'utf-8')));

  const component = saved.components.find((c: { code: string }) => c.code === 'DIVIDA_ACIMA_DE_R_5_000');
  expect(component.versions.map((v: { number: number; state: string; effectiveFrom?: string; effectiveTo?: string }) => [
    v.number,
    v.state,
    v.effectiveFrom,
    v.effectiveTo,
  ])).toEqual([
    [1, 'SUPERSEDED', '2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'],
    [2, 'PUBLISHED', '2026-03-01T00:00:00.000Z', undefined],
  ]);
  expect(component.versions[1].payload.businessDescription).toBe(
    'Bloqueia o cliente com dívida em aberto igual ou superior a R$ 8.000.',
  );

  expect(pageErrors).toEqual([]);
});
