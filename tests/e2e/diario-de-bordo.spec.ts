import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 35 — Diário de Bordo como Solicitação de Alteração estruturada
 * (docs/prompts/S35-diario-de-bordo.md): reproduz o DB-515 real (Goodlist)
 * ponta a ponta pela tela, cobrindo:
 *
 * - CT-GOV-01 (parcial — publicar é a S36): DRAFT → SUBMITTED → IN_REVIEW →
 *   APPROVED, com motivador, item com "hoje" vindo da versão vigente,
 *   "proposto", vigência, e trilha completa.
 * - CT-GOV-02: aprovar não publica — a versão do componente continua
 *   PUBLISHED em v1, sem v2 nenhuma.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('DB-515 (Goodlist): criar, motivador, item com "hoje" da versão vigente, submeter, revisar e aprovar — aprovar não publica (CT-GOV-01 parcial, CT-GOV-02)', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E DB');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  // --- Política real: a regra "Goodlist" publicada em v1 -------------------
  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PF/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Política PF' })).toBeVisible();

  await page.getByRole('button', { name: 'Nova seção' }).click();
  await page.getByLabel('Tipo do novo componente').selectOption('RULE');
  await page.getByLabel('Nome do novo componente').fill('Goodlist');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  await page.getByTestId('tree-node-GOODLIST').click();
  await page.getByRole('button', { name: 'Criar rascunho' }).click();
  await page.getByLabel(/Descrição de negócio/).fill('Aprova sempre que o cliente estiver na lista.');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByLabel('Vigência (obrigatória)').fill('2026-01-01');
  await page.getByRole('button', { name: /Publicar versão 1/ }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // --- Diário de Bordo: criar o DB-515 --------------------------------------
  await page.getByRole('button', { name: 'Diário de Bordo' }).click();
  await expect(page.getByRole('heading', { name: 'Diário de Bordo' })).toBeVisible();

  await page.getByRole('button', { name: 'Novo DB' }).first().click();
  await expect(page.getByLabel('Código')).toHaveValue('DB_1'); // I26: sugestão sequencial, editável
  await page.getByLabel('Código').fill('DB_515');
  await page.getByLabel('Título').fill('Goodlist passa a olhar o valor do pedido');
  await page.getByRole('button', { name: 'Criar DB' }).click();
  await expect(page.getByText('DB_515', { exact: true })).toBeVisible();
  await expect(page.getByText('Rascunho', { exact: true })).toBeVisible();

  // --- Motivador (criação inline, mesmo padrão das tags) --------------------
  await page.getByRole('button', { name: /Motivador/ }).click();
  await page.getByPlaceholder(/Buscar ou criar motivador/).fill('Risco');
  await page.getByRole('button', { name: /Criar e marcar/ }).click();
  await expect(page.getByText('Risco', { exact: true })).toBeVisible();

  // --- Vigência proposta ------------------------------------------------------
  await page.getByLabel(/Vigência proposta/).fill('2026-09-01');

  // --- Item sobre a Goodlist: "hoje" vem da versão vigente, "proposto" é obrigatório
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  await page.getByRole('option', { name: /Goodlist/ }).click();
  const currentField = page.locator('textarea[id^="item-current-"]');
  await expect(currentField).toHaveValue('Aprova sempre que o cliente estiver na lista.');
  const proposedField = page.locator('textarea[id^="item-proposed-"]');
  await expect(proposedField).toHaveValue('A definir.');
  await proposedField.fill('Aprova só se o valor do pedido for menor ou igual ao limite em lista.');
  await proposedField.blur();

  // Todos os requisitos de RN-GOV-03 preenchidos — o aviso de pendência some.
  await expect(page.getByText(/Falta para submeter/)).not.toBeVisible();

  // --- Workflow: DRAFT → SUBMITTED → IN_REVIEW → APPROVED --------------------
  await page.getByRole('button', { name: 'Submeter' }).click();
  await expect(page.getByText('Submetido', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Mover para Em revisão/ }).click();
  await expect(page.getByText('Em revisão', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprovar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Devolver' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rejeitar' })).toBeVisible();

  await page.getByRole('button', { name: 'Aprovar' }).click();
  const decisionDialog = page.getByRole('dialog', { name: 'Aprovar a solicitação' });
  await expect(decisionDialog).toBeVisible();
  await expect(decisionDialog.getByText(/RN-GOV-04/)).toBeVisible();
  await decisionDialog.getByRole('button', { name: 'Aprovar' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // CT-GOV-02: aprovar não publica — o status vira APPROVED e o banner explica.
  await expect(page.getByText('Aprovado', { exact: true })).toBeVisible();
  await expect(page.getByText(/Aprovar não publica nada \(RN-GOV-04\)/)).toBeVisible();

  // Itens congelados (I30): os campos do item ficam desabilitados.
  await expect(proposedField).toBeDisabled();

  // Trilha completa.
  await expect(page.getByText(/aprovou a solicitação "DB_515"/)).toBeVisible();
  await expect(page.getByText(/moveu a solicitação "DB_515" de SUBMITTED para IN_REVIEW/)).toBeVisible();
  await expect(page.getByText(/moveu a solicitação "DB_515" de DRAFT para SUBMITTED/)).toBeVisible();
  await expect(page.getByText(/incluiu "GOODLIST" no escopo da solicitação "DB_515"/)).toBeVisible();

  // --- Salva e confere o documento persistido ---------------------------------
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const filePath = await download.path();
  if (filePath === null) throw new Error('Download sem caminho local.');
  const saved = JSON.parse(readFileSync(filePath, 'utf-8'));

  const db515 = saved.changeRequests.find((cr: { code: string }) => cr.code === 'DB_515');
  expect(db515).toMatchObject({
    status: 'APPROVED',
    motivators: ['RISCO'],
    proposedEffectiveDate: '2026-09-01T00:00:00.000Z',
  });
  expect(db515.items).toHaveLength(1);
  expect(db515.items[0]).toMatchObject({
    changeType: 'UPDATE',
    currentSummary: 'Aprova sempre que o cliente estiver na lista.',
    proposedSummary: 'Aprova só se o valor do pedido for menor ou igual ao limite em lista.',
  });
  expect(db515.approvals).toHaveLength(1);
  expect(db515.approvals[0].decision).toBe('APPROVED');

  // CT-GOV-02, na persistência: a Goodlist continua só com a v1 publicada —
  // nenhuma versão nova, nenhuma mudança de estado.
  const goodlist = saved.components.find((c: { code: string }) => c.code === 'GOODLIST');
  expect(goodlist.versions).toHaveLength(1);
  expect(goodlist.versions[0]).toMatchObject({ number: 1, state: 'PUBLISHED' });

  expect(pageErrors).toEqual([]);
});
