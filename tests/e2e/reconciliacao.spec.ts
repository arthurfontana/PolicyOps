import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 16 — Reconciliação da biblioteca. Os dois cenários de aceite de
 * docs/prompts/S16-reconciliacao.md, ponta a ponta no navegador:
 *
 * 1. adicionar `R7` na biblioteca → publicar a variável → abrir o rascunho da
 *    matriz → o badge aparece → reconciliar → as combinações novas nascem
 *    hachuradas → preencher → publicar;
 * 2. alterar a regra para Varejo aceitar `1M_10M` → publicar → reconciliar →
 *    6 combinações novas aparecem.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

async function openSample(page: Page): Promise<void> {
  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();
  await expect(
    page.getByRole('heading', { name: 'Documento de exemplo — Políticas de Crédito' }),
  ).toBeVisible();
}

/** Células hachuradas: as combinações pendentes (docs/05 §3, item 5). */
function hatchedCells(page: Page) {
  return page.locator('[role="gridcell"].policy-grid-pending');
}

test('cenário 1 — R7 na biblioteca, badge no rascunho, reconciliação, preenchimento e publicação', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await openSample(page);

  // --- 1. A biblioteca ganha R7 -------------------------------------------
  await page.getByRole('button', { name: 'Variáveis' }).click();
  await page.getByRole('button', { name: /Score HVI3/ }).click();
  await expect(page.getByText('Domínios da versão 1')).toBeVisible();

  await page.getByRole('button', { name: 'Criar rascunho' }).click();
  await expect(page.getByText('Domínios da versão 2')).toBeVisible();

  await page.getByRole('button', { name: 'Adicionar domínio' }).click();
  const novaLinha = page.getByTestId('domain-row').nth(6);
  await novaLinha.getByLabel('Código').fill('R7');
  await novaLinha.getByLabel('Rótulo', { exact: true }).fill('R7 — Risco extremo');

  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Domínios salvos').first()).toBeVisible();
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Versão 2 publicada').first()).toBeVisible();

  // --- 2. A tela de impacto lista quem pode adotar, com link direto --------
  const adocao = page.getByTestId('adoption-list');
  await expect(adocao).toContainText('MTZ_LIMITE_PF');
  await expect(adocao).toContainText('v1 pinada, v2 disponível');
  // Nada em lote: um botão por rascunho, nenhum "atualizar todas".
  await expect(adocao.getByRole('button', { name: 'Reconciliar' })).toHaveCount(1);

  await adocao.getByRole('button', { name: 'Reconciliar' }).click();

  // O link direto abre a matriz **e** o diálogo de reconciliação do eixo certo.
  const dialogo = page.getByRole('dialog');
  await expect(
    dialogo.getByText('Atualizar o eixo X para as versões mais recentes da biblioteca'),
  ).toBeVisible();
  await dialogo.getByRole('button', { name: 'Cancelar' }).click();

  // --- 3. O badge de defasagem, no rascunho e só nele ----------------------
  await expect(page.locator('[role="gridcell"]')).toHaveCount(24);
  const badge = page.getByTestId('stale-badge');
  await expect(badge).toHaveCount(1);
  await expect(badge).toContainText('Score HVI3 — v1 pinada, v2 disponível');

  // Na versão publicada (v1) o badge não aparece: ela é registro, não pendência.
  await page.getByLabel('Selecionar versão').click();
  await page.getByRole('option', { name: /v1 · Vigente/ }).click();
  await expect(page.getByTestId('stale-badge')).toHaveCount(0);
  await page.getByLabel('Selecionar versão').click();
  await page.getByRole('option', { name: /v2 · Rascunho/ }).click();
  await expect(page.getByTestId('stale-badge')).toHaveCount(1);

  // --- 4. Reconciliar, com preview antes de qualquer gravação --------------
  await page.getByTestId('resnapshot-X').click();
  const preview = page.getByRole('dialog').getByTestId('resnapshot-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('v1');
  await expect(preview).toContainText('v2');
  await expect(preview.getByTestId('resnapshot-added')).toContainText('Combinações que entram (1)');
  await expect(preview.getByTestId('resnapshot-added')).toContainText(
    'Gera 4 células novas que você precisará preencher',
  );
  await expect(preview.getByTestId('resnapshot-removed')).toContainText(
    'Combinações que saem (0)',
  );
  await expect(preview.getByTestId('grid-miniature')).toBeVisible();

  // Nada aplicado ainda: o grid continua com 24 combinações.
  await expect(page.locator('[role="gridcell"]')).toHaveCount(24);

  await page.getByRole('dialog').getByRole('button', { name: 'Atualizar eixo' }).click();

  // --- 5. As combinações novas nascem hachuradas e selecionadas ------------
  await expect(page.locator('[role="gridcell"]')).toHaveCount(28);
  await expect(page.getByTestId('grid-counters')).toContainText('4 pendentes');
  await expect(hatchedCells(page)).toHaveCount(4);
  await expect(page.getByTestId('selection-counter')).toContainText('4 células selecionadas');
  await expect(page.getByTestId('pending-cells-bar')).toContainText(
    '4 combinações ainda não preenchidas',
  );

  // I6 bloqueia a publicação enquanto houver pendência.
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  const publicar = page.getByRole('dialog');
  await publicar.getByLabel('Notas desta publicação').fill('Adoção da versão 2 do Score HVI3.');
  await publicar.getByLabel(/digite o número da versão/i).fill('2');
  await publicar.getByRole('button', { name: 'Publicar versão 2' }).click();
  await expect(publicar).not.toBeVisible();
  await expect(page.getByTestId('pending-cells-bar')).toBeVisible();

  // --- 6. Preencher e publicar --------------------------------------------
  await page
    .getByTestId('pending-cells-bar')
    .getByRole('button', { name: 'Selecionar todas as pendentes' })
    .click();
  await page.getByRole('button', { name: 'Aprovar tudo' }).click();
  await expect(page.getByTestId('grid-counters')).toContainText('0 pendentes');
  await expect(hatchedCells(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  const publicar2 = page.getByRole('dialog');
  await publicar2.getByLabel('Notas desta publicação').fill('Adoção da versão 2 do Score HVI3.');
  await publicar2.getByLabel(/digite o número da versão/i).fill('2');
  await publicar2.getByRole('button', { name: 'Publicar versão 2' }).click();

  await expect(page.getByRole('main').getByText('Vigente · v2', { exact: true })).toBeVisible();
  await expect(page.locator('[role="gridcell"]')).toHaveCount(28);

  expect(pageErrors).toEqual([]);
});

test('cenário 2 — Varejo passa a aceitar 1M–10M, reconciliar traz 6 combinações novas', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await openSample(page);

  // --- 1. A regra passa a permitir Varejo até 10 milhões -------------------
  await page.getByRole('button', { name: 'Compatibilidade' }).click();
  await page.getByRole('button', { name: /Segmento × Faixa de Faturamento/ }).click();
  await page.getByRole('button', { name: 'Criar rascunho' }).click();

  const checkbox = page.getByRole('checkbox', {
    name: 'Varejo → R$ 1 milhão a R$ 10 milhões',
    exact: true,
  });
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(page.getByText('9 de 15 combinações válidas')).toBeVisible();

  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Mapa salvo').first()).toBeVisible();
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Versão 2 publicada').first()).toBeVisible();

  // Sem rascunho de matriz aberto, ainda não há quem adote.
  await expect(page.getByText(/Nenhum rascunho tem a adotar/)).toBeVisible();

  // --- 2. O rascunho da matriz PJ, criado depois, herda o pin antigo -------
  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await page.getByRole('button', { name: /MTZ_LIMITE_PJ/ }).click();
  await expect(page.locator('[role="gridcell"]')).toHaveCount(48);

  await page.getByRole('button', { name: 'Criar rascunho' }).click();
  // O clone não regenera tuplas: 48 combinações, as mesmas da v1 (§1.2).
  await expect(page.locator('[role="gridcell"]')).toHaveCount(48);

  const badge = page.getByTestId('stale-badge');
  await expect(badge).toHaveCount(1);
  await expect(badge).toContainText(
    'Regra Segmento × Faixa de Faturamento — v1 pinada, v2 disponível',
  );

  // --- 3. Reconciliar o eixo Y --------------------------------------------
  await page.getByTestId('resnapshot-Y').click();
  const preview = page.getByRole('dialog').getByTestId('resnapshot-preview');
  await expect(preview).toContainText('Segmento × Faixa de Faturamento');
  await expect(preview.getByTestId('resnapshot-added')).toContainText('Combinações que entram (1)');
  await expect(preview.getByTestId('resnapshot-added')).toContainText(
    'Gera 6 células novas que você precisará preencher',
  );
  await expect(preview.getByTestId('resnapshot-removed')).toContainText('Combinações que saem (0)');

  await page.getByRole('dialog').getByRole('button', { name: 'Atualizar eixo' }).click();

  // 6 tuplas em X × 9 em Y = 54 combinações, 6 delas novas e hachuradas.
  await expect(page.locator('[role="gridcell"]')).toHaveCount(54);
  await expect(page.getByTestId('grid-counters')).toContainText('6 pendentes');
  await expect(hatchedCells(page)).toHaveCount(6);
  await expect(page.getByTestId('selection-counter')).toContainText('6 células selecionadas');

  // --- 4. Desfazer restaura tudo ------------------------------------------
  await page.keyboard.press('Control+z');
  await expect(page.locator('[role="gridcell"]')).toHaveCount(48);
  await expect(page.getByTestId('grid-counters')).toContainText('0 pendentes');

  // Com células selecionadas o inspector mostra a célula, não o eixo: limpa a
  // seleção para conferir que o badge de defasagem voltou junto com o pin.
  await page.locator('[data-cell-key="R1::VAREJO|ATE_100K"]').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('stale-badge')).toHaveCount(1);
  await expect(page.getByTestId('stale-badge')).toContainText('v1 pinada, v2 disponível');

  expect(pageErrors).toEqual([]);
});
