import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessões 35 e 36 — o Diário de Bordo do começo ao fim, pela tela. Reproduz o
 * DB-515 real (Goodlist) cobrindo:
 *
 * - **CT-GOV-01 completo** (S36): DRAFT → SUBMITTED → IN_REVIEW → APPROVED →
 *   IN_DEVELOPMENT → IN_VALIDATION → READY_FOR_RELEASE → **PUBLISHED**, com
 *   motivador, item com "hoje" vindo da versão vigente, "proposto", rascunho
 *   vinculado, vigência e trilha completa — e a v2 do componente em vigor em
 *   2026-09-01, com a v1 `SUPERSEDED` e a timeline apontando o DB.
 * - **CT-GOV-02** (S35): aprovar não publica — enquanto o DB está em APPROVED,
 *   a versão vigente do componente continua sendo a v1.
 * - **I25** (S36): item e rascunho congelados a partir de APPROVED.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('DB-515 (Goodlist): criar, vincular rascunho, aprovar e publicar — a v2 entra em vigor na data do DB (CT-GOV-01, CT-GOV-02)', async ({
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

  // --- S36: vincular o rascunho ao item ---------------------------------------
  await expect(page.getByText('Sem rascunho', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Vincular rascunho' }).click();
  await expect(page.getByText('Vinculado', { exact: true })).toBeVisible();
  // O comparativo rico abre sozinho: payload campo a campo + spec por bloco.
  await expect(page.getByText(/Conteúdo — campo a campo/)).toBeVisible();

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

  // Itens congelados (I30/I25): os campos do item ficam desabilitados e o
  // vínculo do rascunho some — mudar escopo depois de aprovado exige DB novo.
  await expect(proposedField).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Desvincular' })).toHaveCount(0);

  // Trilha completa.
  await expect(page.getByText(/aprovou a solicitação "DB_515"/)).toBeVisible();
  await expect(page.getByText(/moveu a solicitação "DB_515" de SUBMITTED para IN_REVIEW/)).toBeVisible();
  await expect(page.getByText(/moveu a solicitação "DB_515" de DRAFT para SUBMITTED/)).toBeVisible();
  await expect(page.getByText(/incluiu "GOODLIST" no escopo da solicitação "DB_515"/)).toBeVisible();
  await expect(page.getByText(/vinculou o rascunho de "GOODLIST"/)).toBeVisible();

  // --- S36: até READY_FOR_RELEASE e publicar ----------------------------------
  await page.getByRole('button', { name: /Mover para Em desenvolvimento/ }).click();
  await page.getByRole('button', { name: /Mover para Em validação/ }).click();
  await page.getByRole('button', { name: /Mover para Pronto para release/ }).click();

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  const publishDialog = page.getByRole('dialog', { name: /Publicar "DB_515"/ });
  await expect(publishDialog).toBeVisible();
  await expect(publishDialog.getByText(/Publica a versão 2/)).toBeVisible();
  await expect(publishDialog.getByText(/Tudo pronto/)).toBeVisible();
  await publishDialog.getByRole('button', { name: 'Publicar o DB' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await expect(page.getByText('Publicado', { exact: true })).toBeVisible();
  await expect(page.getByText(/publicou a solicitação "DB_515"/)).toBeVisible();

  // --- Timeline do componente: v1 substituída, v2 vigente desde 2026-09-01 -----
  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PF/ }).first().click();
  await page.getByTestId('tree-node-GOODLIST').click();
  await expect(page.getByText(/vigente desde 01\/09\/2026/)).toBeVisible();

  // --- Salva e confere o documento persistido ---------------------------------
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const filePath = await download.path();
  if (filePath === null) throw new Error('Download sem caminho local.');
  const saved = JSON.parse(readFileSync(filePath, 'utf-8'));

  const db515 = saved.changeRequests.find((cr: { code: string }) => cr.code === 'DB_515');
  expect(db515).toMatchObject({
    status: 'PUBLISHED',
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

  // CT-GOV-01 na persistência: a v2 entrou em vigor na data do DB, carrega o
  // DB de origem, e a v1 virou SUPERSEDED com `effectiveTo` casando.
  const goodlist = saved.components.find((c: { code: string }) => c.code === 'GOODLIST');
  expect(goodlist.versions).toHaveLength(2);
  expect(goodlist.versions[0]).toMatchObject({
    number: 1,
    state: 'SUPERSEDED',
    effectiveTo: '2026-09-01T00:00:00.000Z',
  });
  expect(goodlist.versions[1]).toMatchObject({
    number: 2,
    state: 'PUBLISHED',
    effectiveFrom: '2026-09-01T00:00:00.000Z',
    changeRequestId: db515.id,
  });
  // O item continua apontando a versão publicada: é o lastro entre o que foi
  // aprovado e o que entrou em vigor (I30 depois de publicar).
  expect(db515.items[0].draftVersionId).toBe(goodlist.versions[1].id);

  expect(pageErrors).toEqual([]);
});
