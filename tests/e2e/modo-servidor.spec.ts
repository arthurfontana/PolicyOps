import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { requireBuild, startServer, type RunningServer } from './helpers/local-server';

/**
 * Modo `SERVER` (Sessão 27) — docs/14-plataforma-local.md §4, §5 e §8,
 * docs/06-persistencia-e-concorrencia.md §1, §2 e §5.
 *
 * Diferente dos outros E2E (que abrem `dist/PolicyOps.html` por `file://` ou
 * simulam a File System Access API), este sobe o **servidor de verdade** da
 * S26 (`server/policyops_server.py`) contra uma pasta temporária e navega até
 * o endereço com `?t=` que ele imprime — o mesmo que o launcher da S28 vai
 * abrir. É o único jeito de testar de ponta a ponta que o front realmente
 * fala com o servidor local pela API, não com um "disco" simulado.
 *
 * O conflito é simulado gravando direto no arquivo em disco por fora do
 * navegador — exatamente "outra pessoa salvando pelo próprio servidor dela",
 * sem precisar de um segundo processo.
 */

test.beforeAll(requireBuild);

function readDocument(server: RunningServer): { meta: { name: string; revision: number; savedBy: string } } & Record<string, unknown> {
  return JSON.parse(readFileSync(server.documentPath, 'utf-8'));
}

/** A outra pessoa salvou por cima, pelo próprio servidor dela — a mesma pasta de rede. */
function simulateRemoteSave(server: RunningServer): void {
  const doc = readDocument(server) as {
    meta: { revision: number; savedBy: string; savedAt: string };
    projects: unknown[];
  };
  doc.meta.revision += 5;
  doc.meta.savedBy = 'Beatriz';
  doc.meta.savedAt = '2026-08-05T12:00:00.000Z';
  doc.projects.push({
    id: 'projBeatriz1',
    code: 'POLITICA_AUTO',
    name: 'Política Auto',
    position: doc.projects.length,
    createdAt: '2026-08-05T11:00:00.000Z',
  });
  writeFileSync(server.documentPath, JSON.stringify(doc, null, 2));
}

test.describe('modo SERVER — sessão 27', () => {
  let server: RunningServer;

  test.beforeEach(async () => {
    server = await startServer();
  });

  test.afterEach(async () => {
    await server.stop();
    rmSync(server.dataDir, { recursive: true, force: true });
  });

  test('abre direto da pasta, sem seletor nem diálogo de identificação — e o modo é SERVER', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await page.goto(server.url);

    // Sem seletor, sem "como você quer ser identificado?" (docs/02 §6):
    // o documento da pasta abre sozinho.
    await expect(
      page.getByRole('heading', { name: 'Documento de exemplo — Políticas de Crédito' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /identificado/i })).not.toBeVisible();
    await expect(page.getByTestId('storage-mode')).toHaveText('SERVER');
    await expect(page.getByTestId('save-status')).toHaveText('Salvo');

    // O token some da barra de endereço (docs/14 §5) — nunca fica ali para
    // sobreviver num histórico ou ser colado por engano.
    expect(page.url()).not.toContain('?t=');

    expect(pageErrors).toEqual([]);
  });

  test('editar → salvar → reabrir devolve o mesmo estado, sem nenhum download', async ({ page }) => {
    const downloads: string[] = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));

    await page.goto(server.url);
    await expect(page.getByRole('heading', { name: /Documento de exemplo/ })).toBeVisible();

    // 1. editar
    await page.getByLabel('Nome do documento').fill('Políticas E2E — Servidor');
    await page.getByRole('button', { name: 'Renomear' }).click();
    await expect(page.getByRole('heading', { name: 'Políticas E2E — Servidor' })).toBeVisible();

    // 2. salvar — direto no arquivo da pasta, sem seletor nem baixar nada
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveText('Salvo');

    const onDisk = readDocument(server);
    expect(onDisk.meta.name).toBe('Políticas E2E — Servidor');
    expect(onDisk.meta.revision).toBe(1);

    // 3. reabrir — recarregar a aba: sem `?t=` na URL, o token vem do
    // sessionStorage e o documento da pasta reabre sozinho de novo.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Políticas E2E — Servidor' })).toBeVisible();
    await expect(page.getByTestId('save-status')).toHaveText('Salvo');
    await expect(page.getByRole('contentinfo').getByText('revisão 1')).toBeVisible();

    expect(downloads).toEqual([]);
  });

  test('conflito simulado (gravação externa no arquivo) → mesclar → salvar', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await page.goto(server.url);
    await expect(page.getByRole('heading', { name: /Documento de exemplo/ })).toBeVisible();

    // 1. editar e salvar, para ter uma base conhecida
    await page.getByLabel('Nome do documento').fill('Políticas E2E');
    await page.getByRole('button', { name: 'Renomear' }).click();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveText('Salvo');

    // 2. outra pessoa grava por cima, pelo próprio servidor dela
    simulateRemoteSave(server);

    // 3. editar de novo (fica "dirty") e salvar → conflito, nada gravado
    const beforeConflict = readFileSync(server.documentPath, 'utf-8');
    await page.getByLabel('Nome do documento').fill('Políticas E2E (minha edição)');
    await page.getByRole('button', { name: 'Renomear' }).click();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Conflito ao salvar' })).toBeVisible();
    await expect(page.getByText('Beatriz salvou este arquivo', { exact: false })).toBeVisible();
    expect(readFileSync(server.documentPath, 'utf-8')).toBe(beforeConflict);

    // 4. mesclar
    await page.getByRole('button', { name: 'Mesclar' }).click();
    await expect(page.getByRole('heading', { name: 'Mesclar com politicas.json' })).toBeVisible();
    await expect(page.getByTestId('merge-applied')).toContainText('Política Auto');

    const conflict = page.getByTestId('merge-conflict');
    await expect(conflict).toHaveCount(1);
    await conflict.getByRole('radio', { name: /Manter o meu/ }).check();

    // 5. confirmar — grava a mesclagem no servidor
    await page.getByTestId('merge-confirm').click();
    await expect(page.getByTestId('save-status')).toHaveText('Salvo');
    await expect(page.getByRole('heading', { name: 'Mesclar com', exact: false })).not.toBeVisible();

    const saved = readDocument(server) as {
      meta: { name: string; savedBy: string; revision: number };
      projects: Array<{ code: string }>;
      events: Array<{ type: string; summary: string; payload?: { remoteSavedBy?: string } }>;
    };
    // O trabalho dos dois lados sobreviveu…
    expect(saved.meta.name).toBe('Políticas E2E (minha edição)');
    expect(saved.projects.some((project) => project.code === 'POLITICA_AUTO')).toBe(true);
    // …a revisão continua de onde o arquivo estava, e o merge ficou no histórico.
    const merged = saved.events.filter((event) => event.type === 'DOCUMENT_MERGED');
    expect(merged).toHaveLength(1);
    expect(merged[0]!.payload?.remoteSavedBy).toBe('Beatriz');

    expect(pageErrors).toEqual([]);
  });

  test('servidor caiu no meio da edição: salvar vira erro claro, sem travar a aplicação', async ({ page }) => {
    await page.goto(server.url);
    await expect(page.getByRole('heading', { name: /Documento de exemplo/ })).toBeVisible();

    await page.getByLabel('Nome do documento').fill('Vai falhar');
    await page.getByRole('button', { name: 'Renomear' }).click();

    await server.stop();

    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByText('servidor local', { exact: false })).toBeVisible();
  });
});

test.describe('modo SERVER — pasta sem documento ainda (bootstrap)', () => {
  let server: RunningServer;

  test.beforeEach(async () => {
    server = await startServer({ seed: false });
  });

  test.afterEach(async () => {
    await server.stop();
    rmSync(server.dataDir, { recursive: true, force: true });
  });

  test('sem politicas.json na pasta, a tela inicial aparece e "Exemplo" cria o arquivo ao salvar', async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(server.url);

    await expect(page.getByRole('heading', { name: 'Policy Matrix Studio' })).toBeVisible();
    await expect(page.getByTestId('mode-headline')).toHaveText(
      'Modo servidor — conectado à pasta de rede pelo servidor local',
    );

    await page.getByRole('button', { name: 'Exemplo' }).click();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveText('Salvo');

    expect(existsSync(server.documentPath)).toBe(true);
  });
});
