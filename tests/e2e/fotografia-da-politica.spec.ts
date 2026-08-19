import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Consulta histórica da política — S39 (o núcleo) e S43 (a tela).
 *
 * A fotografia deixou de ser um estado da árvore (DEC-UX-004): a tela de
 * **Vigência** mostra a política inteira na data, a árvore da barra lateral
 * segue no presente e editável, e a comparação lista o que mudou entre duas
 * pontas. Cobre CT-UX-04 (docs/07 §21) e o que a S39 exercitava no antigo
 * modo fotografia.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('CT-UX-04: a política em duas datas na tela de Vigência, com a árvore lateral seguindo no presente', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E Fotografia');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Política PJ' })).toBeVisible();

  // --- Uma regra com duas versões, vigências conhecidas --------------------
  await page.getByRole('button', { name: 'Nova seção' }).click();
  await page.getByLabel('Tipo do novo componente').selectOption('RULE');
  await page.getByLabel('Nome do novo componente').fill('Goodlist');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  const node = page.getByTestId('tree-node-GOODLIST');
  await expect(node).toBeVisible();
  await node.click();

  await page.getByRole('button', { name: 'Criar rascunho' }).click();
  await page.getByLabel(/Descrição de negócio/).fill('Aprova sempre que o cliente estiver na lista.');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByLabel('Vigência (obrigatória)').fill('2026-02-01');
  await page.getByRole('button', { name: 'Publicar versão 1' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await page.getByRole('button', { name: 'Criar rascunho a partir desta versão' }).click();
  await page.getByLabel(/Descrição de negócio/).fill('Aprova só se o valor do pedido couber no limite em lista.');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByLabel('Vigência (obrigatória)').fill('2026-03-01');
  await page.getByRole('button', { name: 'Publicar versão 2' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // --- O salto da faixa de vigência abre a Vigência na data (§20.2) --------
  await page.getByTestId('timeline-segment-v1').click();

  await expect(page).toHaveURL(/#\/timeline/);
  await expect(page.getByRole('tab', { name: 'Estrutura' })).toHaveAttribute('data-state', 'active');
  await expect(page.getByLabel('Data', { exact: true })).toHaveValue('2026-02-01');

  // A árvore da barra lateral **não** congelou: segue no presente (v2) e com
  // o menu do nó no lugar — é o que a DEC-UX-004 comprou.
  await expect(node).toContainText('v2');
  await expect(page.getByLabel('Mais ações para Goodlist')).toHaveCount(1);
  await expect(page.getByText(/Fotografia de/)).toHaveCount(0);

  // --- A estrutura na data, e o conteúdo daquela versão --------------------
  const consulta = page.getByTestId('policy-at-node-GOODLIST');
  await expect(consulta).toContainText('v1');
  await consulta.click();

  const detalhe = page.getByTestId('policy-at-detail');
  await expect(detalhe).toContainText('Aprova sempre que o cliente estiver na lista.');
  await expect(page.getByTestId('policy-at-banner')).toContainText('Esta é uma versão histórica.');
  await expect(page.getByTestId('policy-at-watermark')).toContainText('HISTÓRICO');

  // A matriz do projeto entra na mesma árvore, sem espelho (DEC-GOV-039).
  await expect(page.getByTestId('policy-at-node-MTZ_LIMITE_PJ')).toBeVisible();

  // Outra data, outra versão vigente.
  await page.getByLabel('Data', { exact: true }).fill('2026-03-15');
  await expect(page.getByTestId('policy-at-node-GOODLIST')).toContainText('v2');
  await page.getByTestId('policy-at-node-GOODLIST').click();
  await expect(page.getByTestId('policy-at-detail')).toContainText(
    'Aprova só se o valor do pedido couber no limite em lista.',
  );

  // --- "Abrir no editor (hoje)" sai da consulta e volta ao presente --------
  await page.getByRole('button', { name: 'Abrir no editor (hoje)' }).click();
  await expect(page.getByTestId('component-page')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Criar rascunho a partir desta versão' })).toBeVisible();

  // --- Comparação data × data ---------------------------------------------
  await page.getByRole('button', { name: 'Vigência', exact: true }).click();
  await page.getByRole('button', { name: 'Comparar com outra data' }).click();
  await expect(page.getByRole('heading', { name: 'Comparar a política' })).toBeVisible();

  await page.getByLabel('Data base').fill('2026-02-15');
  await page.getByLabel('Data comparada').fill('2026-03-15');

  const card = page.getByTestId('policy-change-GOODLIST');
  await expect(card).toBeVisible();
  await expect(card).toContainText('alterado');
  await expect(card).toContainText('v1 → v2');
  await expect(card).toContainText('businessDescription');
  await expect(page.getByText('1 alterados')).toBeVisible();

  // O atalho "Ver a política em…" volta para a Vigência, na ponta escolhida.
  await page.getByRole('button', { name: /Ver a política em 15\/02\/2026/ }).click();
  await expect(page).toHaveURL(/#\/timeline/);
  await expect(page.getByLabel('Data', { exact: true })).toHaveValue('2026-02-15');
  await expect(page.getByTestId('policy-at-node-GOODLIST')).toContainText('v1');

  // Nada mudou dentro de um intervalo sem publicação.
  await page.getByRole('button', { name: 'Comparar com outra data' }).click();
  await page.getByLabel('Data base').fill('2026-02-15');
  await page.getByLabel('Data comparada').fill('2026-02-20');
  await expect(page.getByText('Nada mudou na política entre as duas pontas.')).toBeVisible();

  expect(pageErrors).toEqual([]);
});
