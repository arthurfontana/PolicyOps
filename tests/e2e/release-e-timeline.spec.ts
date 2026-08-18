import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 37 — release e a linha do tempo do Diário de Bordo, pela tela.
 * Reproduz o cenário do §25 da especificação de origem: "Release 2026.09.01 —
 * DB-515, DB-519", criável, publicável em lote (CT-GOV-03) e legível na
 * timeline, cada DB com a sua própria vigência (RN-GOV-05, docs/14 §3.4).
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('release 2026.09.01 agrupa DB-515 e DB-519, publica os dois com vigências distintas e aparece na timeline', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E Release');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  // --- Política real: duas regras publicadas em v1 -------------------------
  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PF/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Política PF' })).toBeVisible();

  async function criarRegraPublicada(nome: string, codeTestId: string) {
    await page.getByRole('button', { name: 'Nova seção' }).click();
    await page.getByLabel('Tipo do novo componente').selectOption('RULE');
    await page.getByLabel('Nome do novo componente').fill(nome);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    await page.getByTestId(codeTestId).click();
    await page.getByRole('button', { name: 'Criar rascunho' }).click();
    await page.getByLabel(/Descrição de negócio/).fill(`${nome} — v1.`);
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Publicar', exact: true }).click();
    await page.getByLabel('Vigência (obrigatória)').fill('2026-01-01');
    await page.getByRole('button', { name: /Publicar versão 1/ }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }

  await criarRegraPublicada('Goodlist', 'tree-node-GOODLIST');
  await criarRegraPublicada('Cineminha', 'tree-node-CINEMINHA');

  // --- Diário de Bordo: DB-515 (Goodlist) e DB-519 (Cineminha), cada um até
  //     READY_FOR_RELEASE com rascunho vinculado --------------------------
  async function criarDbPronto(code: string, titulo: string, componente: string, vigencia: string) {
    await page.getByRole('button', { name: 'Diário de Bordo' }).click();
    if (await page.getByRole('button', { name: 'Voltar à lista' }).count() > 0) {
      await page.getByRole('button', { name: 'Voltar à lista' }).click();
    }
    await page.getByRole('button', { name: 'Novo DB' }).first().click();
    await page.getByLabel('Código').fill(code);
    await page.getByLabel('Título').fill(titulo);
    await page.getByRole('button', { name: 'Criar DB' }).click();
    await expect(page.getByText(code, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /Motivador/ }).click();
    await page.getByPlaceholder(/Buscar ou criar motivador/).fill('Risco');
    const existingOption = page.getByRole('option', { name: 'Risco', exact: true });
    if (await existingOption.count() > 0) {
      await existingOption.click();
    } else {
      await page.getByRole('button', { name: /Criar e marcar/ }).click();
    }
    await page.keyboard.press('Escape');

    await page.getByLabel(/Vigência proposta/).fill(vigencia);

    await page.getByRole('button', { name: 'Adicionar item' }).click();
    await page.getByRole('option', { name: new RegExp(componente) }).click();
    const proposedField = page.locator('textarea[id^="item-proposed-"]');
    await proposedField.fill(`Proposta para ${componente}.`);
    await proposedField.blur();

    await page.getByRole('button', { name: 'Vincular rascunho' }).click();
    await expect(page.getByText('Vinculado', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Submeter' }).click();
    await page.getByRole('button', { name: /Mover para Em revisão/ }).click();
    await page.getByRole('button', { name: 'Aprovar' }).click();
    await page.getByRole('dialog', { name: 'Aprovar a solicitação' }).getByRole('button', { name: 'Aprovar' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button', { name: /Mover para Em desenvolvimento/ }).click();
    await page.getByRole('button', { name: /Mover para Em validação/ }).click();
    await page.getByRole('button', { name: /Mover para Pronto para release/ }).click();
    await expect(page.getByText('Pronto para release', { exact: true })).toBeVisible();
  }

  await criarDbPronto('DB_515', 'Goodlist passa a olhar o valor do pedido', 'Goodlist', '2026-09-01');
  await criarDbPronto('DB_519', 'Cineminha do G7 muda o corte', 'Cineminha', '2026-10-01');

  // --- Release: cria, agrupa os dois DBs e publica em lote (CT-GOV-03) -----
  await page.getByRole('button', { name: 'Releases' }).click();
  await page.getByRole('button', { name: /Nova release/ }).first().click();
  await page.getByLabel('Código').fill('2026.09.01');
  await page.getByRole('button', { name: 'Criar release' }).click();
  await expect(page.getByText('2026.09.01', { exact: true })).toBeVisible();
  await expect(page.getByText('Sem DB vinculado', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Adicionar DB/ }).click();
  await page.getByRole('dialog', { name: 'Adicionar DB à release' }).getByText('DB_515', { exact: true }).click();
  await page.getByRole('button', { name: /Adicionar DB/ }).click();
  await page.getByRole('dialog', { name: 'Adicionar DB à release' }).getByText('DB_519', { exact: true }).click();

  await expect(page.getByText('Pronta para publicar', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Publicar release/ }).click();
  const publishDialog = page.getByRole('dialog', { name: /Publicar a release "2026\.09\.01"/ });
  await expect(publishDialog).toBeVisible();
  await expect(publishDialog.getByText(/Tudo pronto: 2 DB\(s\)/)).toBeVisible();
  await publishDialog.getByRole('button', { name: /Publicar a release/ }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await expect(page.getByText('Publicada', { exact: true }).first()).toBeVisible();

  // --- Linha do tempo do DB: os dois publicados, mais recente primeiro -----
  await page.getByRole('button', { name: 'Linha do tempo do DB' }).click();
  await expect(page.getByRole('heading', { name: 'Linha do tempo do Diário de Bordo' })).toBeVisible();
  const rows = page.getByTestId(/^db-timeline-row-/);
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('db-timeline-row-DB_519')).toBeVisible();
  await expect(page.getByTestId('db-timeline-row-DB_515')).toBeVisible();
  await expect(page.getByTestId('db-timeline-row-DB_519')).toContainText('vigência 01/10/2026');
  await expect(page.getByTestId('db-timeline-row-DB_515')).toContainText('vigência 01/09/2026');
  await expect(page.getByTestId('db-timeline-row-DB_515')).toContainText('2026.09.01');

  // --- Persistência: cada versão publicada com a vigência do seu DB --------
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const filePath = await download.path();
  if (filePath === null) throw new Error('Download sem caminho local.');
  const saved = JSON.parse(readFileSync(filePath, 'utf-8'));

  const release = saved.releases.find((r: { code: string }) => r.code === '2026.09.01');
  expect(release.status).toBe('PUBLISHED');
  expect(release.publishedAt).toBeTruthy();

  const db515 = saved.changeRequests.find((cr: { code: string }) => cr.code === 'DB_515');
  const db519 = saved.changeRequests.find((cr: { code: string }) => cr.code === 'DB_519');
  expect(db515).toMatchObject({ status: 'PUBLISHED', releaseId: release.id, proposedEffectiveDate: '2026-09-01T00:00:00.000Z' });
  expect(db519).toMatchObject({ status: 'PUBLISHED', releaseId: release.id, proposedEffectiveDate: '2026-10-01T00:00:00.000Z' });

  const goodlist = saved.components.find((c: { code: string }) => c.code === 'GOODLIST');
  const cineminha = saved.components.find((c: { code: string }) => c.code === 'CINEMINHA');
  expect(goodlist.versions.find((v: { state: string }) => v.state === 'PUBLISHED')).toMatchObject({
    effectiveFrom: '2026-09-01T00:00:00.000Z',
  });
  expect(cineminha.versions.find((v: { state: string }) => v.state === 'PUBLISHED')).toMatchObject({
    effectiveFrom: '2026-10-01T00:00:00.000Z',
  });

  expect(pageErrors).toEqual([]);
});
