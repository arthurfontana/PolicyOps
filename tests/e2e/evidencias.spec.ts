import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requireBuild, startServer, type RunningServer } from './helpers/local-server';

/**
 * Evidências — Sessão 30, docs/14-plataforma-local.md §7 e ADR-004.
 *
 * Sobe o servidor real contra uma pasta temporária e faz o caminho inteiro do
 * critério de aceite: anexar um arquivo a uma **versão publicada**, salvar,
 * conferir que ele está no acervo **com o nome original, legível fora da
 * aplicação** (é o cenário de desastre do ADR-004), reabrir a aba, abrir o
 * arquivo pela aplicação — e então adulterá-lo no disco e ver a aplicação
 * denunciar a divergência em vez de entregar conteúdo trocado.
 */

const DOCX_CONTENT = 'conteudo do DB 513 — ajuste da regra de goodlist';

test.beforeAll(requireBuild);

let uploadDir: string;
let uploadPath: string;

test.beforeAll(() => {
  uploadDir = mkdtempSync(path.join(tmpdir(), 'policyops-e2e-anexo-'));
  uploadPath = path.join(uploadDir, 'DB 513 - Ajuste.docx');
  writeFileSync(uploadPath, DOCX_CONTENT, 'utf-8');
});

test.afterAll(() => {
  rmSync(uploadDir, { recursive: true, force: true });
});

/** `_evidencias/politica-pj/mtz-limite-pj/v1/` — o caminho legível de docs/14 §7. */
function versionFolder(server: RunningServer): string {
  return path.join(server.dataDir, '_evidencias', 'politica-pj', 'mtz-limite-pj', 'v1');
}

function onlyFileIn(folder: string): string {
  const entries = readdirSync(folder);
  expect(entries).toHaveLength(1);
  return path.join(folder, entries[0]!);
}

/** Navega até a v1 **publicada** de MTZ_LIMITE_PJ (a matriz do exemplo sem rascunho aberto). */
async function goToPublishedPJ(page: Page): Promise<void> {
  // O hash guarda a tela, não a matriz aberta (`useHashRouting`) — depois de um
  // F5 a navegação recomeça pela barra lateral, como a de qualquer sessão nova.
  await expect(page.getByTestId('storage-mode')).toHaveText('SERVER');
  await page.getByRole('button', { name: 'Projetos', exact: true }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await page.getByRole('button', { name: /MTZ_LIMITE_PJ/ }).click();
  await expect(page.locator('[role="gridcell"]').first()).toBeVisible();
  // v1 é a única versão desta matriz no exemplo, e está publicada.
  await expect(page.getByLabel('Selecionar versão')).toContainText('v1');
}

async function openPublishedPJ(page: Page, server: RunningServer): Promise<void> {
  await page.goto(server.url);
  await expect(page.getByRole('heading', { name: /Documento de exemplo/ })).toBeVisible();
  await goToPublishedPJ(page);
}

function versionSection(page: Page) {
  return page.getByTestId('evidence-section').filter({ hasText: 'Evidências da versão 1' });
}

test.describe('evidências no modo SERVER', () => {
  let server: RunningServer;

  test.beforeEach(async () => {
    server = await startServer();
  });

  test.afterEach(async () => {
    await server.stop();
    rmSync(server.dataDir, { recursive: true, force: true });
  });

  test('anexar em versão publicada → salvar → reabrir → abrir o arquivo → adulterar denuncia', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await openPublishedPJ(page, server);

    // 1. anexar à versão publicada (o caso típico: a evidência chega depois)
    const section = versionSection(page);
    await section.getByLabel('Nota da evidência').fill('DB que originou a política');
    await section.getByLabel('Arquivo da evidência').setInputFiles(uploadPath);

    const item = section.getByTestId('evidence-item');
    await expect(item).toBeVisible();
    await expect(item).toContainText('DB 513 - Ajuste.docx');
    await expect(item).toContainText('DB que originou a política');

    // 2. o arquivo já está no acervo, com o nome original e o prefixo de data
    const folder = versionFolder(server);
    expect(existsSync(folder)).toBe(true);
    const stored = onlyFileIn(folder);
    expect(path.basename(stored)).toMatch(/^\d{4}-\d{2}-\d{2}_DB 513 - Ajuste\.docx$/);
    // ADR-004, o critério central: legível pelo Explorer, sem a aplicação.
    expect(readFileSync(stored, 'utf-8')).toBe(DOCX_CONTENT);

    // 3. salvar: o vínculo entra no documento; o snapshot da versão não muda
    const antes = JSON.parse(readFileSync(server.documentPath, 'utf-8')) as {
      matrices: Array<{ code: string; versions: Array<{ number: number; cells: unknown }> }>;
    };
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('save-status')).toHaveText('Salvo');

    const salvo = JSON.parse(readFileSync(server.documentPath, 'utf-8')) as {
      attachments: Array<{ fileName: string; relPath: string; sha256: string; addedBy: { username: string }; target: unknown }>;
      matrices: Array<{ code: string; versions: Array<{ number: number; cells: unknown }> }>;
      events: Array<{ type: string }>;
    };
    expect(salvo.attachments).toHaveLength(1);
    expect(salvo.attachments[0]!.relPath).toBe(
      `politica-pj/mtz-limite-pj/v1/${path.basename(stored)}`,
    );
    expect(salvo.attachments[0]!.target).toEqual({
      kind: 'VERSION',
      matrixId: expect.any(String),
      versionNumber: 1,
    });
    expect(salvo.events.some((event) => event.type === 'EVIDENCE_ATTACHED')).toBe(true);
    // A versão publicada é byte a byte a mesma: `attachments` vive fora do snapshot.
    const versaoAntes = antes.matrices.find((m) => m.code === 'MTZ_LIMITE_PJ')!.versions[0];
    const versaoDepois = salvo.matrices.find((m) => m.code === 'MTZ_LIMITE_PJ')!.versions[0];
    expect(versaoDepois).toEqual(versaoAntes);

    // 4. reabrir a aba: o anexo continua listado, com quem/quando
    await page.reload();
    await goToPublishedPJ(page);
    await expect(versionSection(page).getByTestId('evidence-item')).toContainText('DB 513 - Ajuste.docx');
    await expect(versionSection(page).getByTestId('evidence-item')).toContainText('DB que originou a política');

    // 5. abrir o arquivo pela aplicação: hash conferido, bytes originais
    const download = await Promise.all([
      page.waitForEvent('download'),
      versionSection(page).getByRole('button', { name: /^Abrir/ }).click(),
    ]).then(([event]) => event);
    expect(download.suggestedFilename()).toBe(path.basename(stored));
    const baixado = await download.path();
    expect(readFileSync(baixado, 'utf-8')).toBe(DOCX_CONTENT);

    // 6. alguém troca o arquivo no disco: a aplicação denuncia, não entrega
    writeFileSync(stored, 'conteudo trocado por fora', 'utf-8');
    await versionSection(page).getByRole('button', { name: /^Abrir/ }).click();
    // `.first()`: o aviso aparece no toast e, de novo, na região `aria-live`.
    await expect(page.getByText('Não foi possível abrir a evidência').first()).toBeVisible();
    await expect(page.getByText(/não confere com o hash registrado/).first()).toBeVisible();
    await expect(page.getByText(/_evidencias/).first()).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test('desanexar move para a lixeira só depois de salvar, e desfazer não toca no arquivo', async ({
    page,
  }) => {
    await openPublishedPJ(page, server);

    const section = versionSection(page);
    await section.getByLabel('Arquivo da evidência').setInputFiles(uploadPath);
    await expect(section.getByTestId('evidence-item')).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('save-status')).toHaveText('Salvo');
    const stored = onlyFileIn(versionFolder(server));

    // Desanexar tira o vínculo — e o arquivo continua exatamente onde estava.
    await section.getByRole('button', { name: /^Desanexar/ }).click();
    await expect(page.getByText(/_lixeira/)).toBeVisible();
    await page.getByRole('button', { name: 'Desanexar', exact: true }).click();
    await expect(section.getByTestId('evidence-item')).toHaveCount(0);
    expect(existsSync(stored)).toBe(true);

    // Desfazer devolve o vínculo sem que nada tenha se mexido no disco.
    await page.keyboard.press('Control+z');
    await expect(section.getByTestId('evidence-item')).toBeVisible();
    expect(existsSync(stored)).toBe(true);

    // Agora desanexar **e salvar**: aí sim o arquivo vai para a lixeira, inteiro.
    await section.getByRole('button', { name: /^Desanexar/ }).click();
    await page.getByRole('button', { name: 'Desanexar', exact: true }).click();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('save-status')).toHaveText('Salvo');

    const naLixeira = path.join(
      server.dataDir,
      '_evidencias',
      '_lixeira',
      'politica-pj',
      'mtz-limite-pj',
      'v1',
      path.basename(stored),
    );
    await expect.poll(() => existsSync(naLixeira), { timeout: 5000 }).toBe(true);
    expect(existsSync(stored)).toBe(false);
    expect(readFileSync(naLixeira, 'utf-8')).toBe(DOCX_CONTENT);
  });
});
