import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 34 — editor rico de especificação (docs/prompts/S34-editor-rico.md).
 *
 * O critério de aceite que só o E2E prova: **escrever, salvar, reabrir e nada
 * mudou**. O caminho é o do modo somente-download (file://), o mesmo de
 * `persistencia.spec.ts`.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

async function abrirRegraComRascunho(page: Page): Promise<void> {
  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Arthur');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();

  await page.getByRole('button', { name: 'Nova seção' }).click();
  await page.getByLabel('Tipo do novo componente').selectOption('RULE');
  await page.getByLabel('Nome do novo componente').fill('Regra com Especificação');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  await page.getByTestId('tree-node-REGRA_COM_ESPECIFICACAO').click();
  await page.getByRole('button', { name: 'Criar rascunho' }).click();
  await page.getByLabel(/Descrição de negócio/).fill('Regra usada para exercitar o editor rico.');
  await page.keyboard.press('Tab');
}

test('escrever a especificação, salvar, reabrir — nada mudou', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await abrirRegraComRascunho(page);

  // --- escrever: parágrafo, título e lista ---------------------------------
  await page.getByRole('button', { name: 'Começar a escrever' }).click();
  const primeiraLinha = page.getByRole('textbox', { name: /Parágrafo da especificação/ }).first();
  await primeiraLinha.click();
  await page.keyboard.type('O cliente com dívida vencida é reprovado.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Consultas obrigatórias');

  await expect(page.getByRole('textbox', { name: /Parágrafo da especificação/ })).toHaveCount(2);

  // --- colar uma tabela como o Excel manda ---------------------------------
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const line = window.document.activeElement;
    if (line === null) throw new Error('nenhuma linha em foco');
    const data = new DataTransfer();
    data.setData(
      'text/html',
      '<table><tr><td>Faixa</td><td>Decisão</td></tr><tr><td>Até 300</td><td>Reprovar</td></tr></table>',
    );
    data.setData('text/plain', 'Faixa\tDecisão\nAté 300\tReprovar');
    line.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(page.getByRole('textbox', { name: 'Cabeçalho da coluna 1' })).toHaveValue('Faixa');

  // --- salvar --------------------------------------------------------------
  // Ctrl+S: o botão "Salvar" vive na tela do documento, e o que interessa aqui
  // é salvar **de dentro do editor**, sem sair da árvore.
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const dir = await mkdtemp(path.join(tmpdir(), 'policyops-e2e-'));
  const savedPath = path.join(dir, download.suggestedFilename());
  await download.saveAs(savedPath);

  const salvo = JSON.parse(readFileSync(savedPath, 'utf-8'));
  const spec = salvo.components
    .flatMap((component: { versions: Array<{ spec?: { blocks: unknown[] } }> }) => component.versions)
    .map((version: { spec?: { blocks: unknown[] } }) => version.spec)
    .find((candidate: unknown) => candidate !== undefined);
  expect(spec.blocks).toHaveLength(3);
  expect(spec.blocks[2]).toMatchObject({
    type: 'table',
    header: ['Faixa', 'Decisão'],
    rows: [['Até 300', 'Reprovar']],
  });

  // --- reabrir: o texto está lá, igual ------------------------------------
  // A rota vive no hash: voltar para "#/" **antes** de recarregar é o que
  // devolve a tela inicial, com o botão de abrir arquivo.
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.reload();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Abrir', exact: true }).click();
  await (await chooser).setFiles(savedPath);

  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await page.getByTestId('tree-node-REGRA_COM_ESPECIFICACAO').click();

  await expect(page.getByText('O cliente com dívida vencida é reprovado.')).toBeVisible();
  await expect(page.getByText('Consultas obrigatórias')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Cabeçalho da coluna 1' })).toHaveValue('Faixa');

  expect(pageErrors).toEqual([]);
});

test('digitar e desfazer uma vez volta o parágrafo inteiro', async ({ page }) => {
  await abrirRegraComRascunho(page);

  await page.getByRole('button', { name: 'Começar a escrever' }).click();
  const linha = page.getByRole('textbox', { name: /Parágrafo da especificação/ }).first();
  await linha.click();
  await page.keyboard.type('Um parágrafo inteiro digitado letra a letra.');
  await expect(linha).toHaveText('Um parágrafo inteiro digitado letra a letra.');

  await page.keyboard.press('Control+z');
  await expect(linha).toHaveText('');

  await page.keyboard.press('Control+Shift+z');
  await expect(linha).toHaveText('Um parágrafo inteiro digitado letra a letra.');
});
