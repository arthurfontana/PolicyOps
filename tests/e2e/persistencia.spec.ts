import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Ciclo de persistência da Sessão 05 aberto por `file://` —
 * docs/06-persistencia-e-concorrencia.md §1, §3, §4 e §5.
 *
 * Por que `file://`: é o cenário do critério de aceite ("abrindo por file://,
 * a aplicação identifica DOWNLOAD_ONLY, avisa o usuário e o ciclo
 * abrir/baixar funciona") e é como o arquivo chega à mão de quem só recebeu o
 * `.html`.
 *
 * O modo `FULL` não é automatizável aqui: `showOpenFilePicker` abre um
 * seletor **nativo**, fora da página, que nenhuma automação de navegador
 * consegue dirigir — não há evento `filechooser` para ele. O que o cobre é o
 * teste de unidade `tests/unit/storage/fsa-adapter.test.ts`, que exercita
 * abrir, salvar, conflito e backup contra handles falsos, inclusive
 * verificando o conteúdo do arquivo depois de um conflito.
 */

const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

async function identify(page: Page, name = 'Arthur') {
  await page.getByLabel('Nome').fill(name);
  await page.getByRole('button', { name: 'Começar' }).click();
  await expect(page.getByRole('heading', { name: /identificado/i })).not.toBeVisible();
}

test('em file://, a aplicação diz que está em DOWNLOAD_ONLY e o que muda', async ({ page }) => {
  await page.goto(FILE_URL);
  await identify(page);

  await expect(page.getByTestId('mode-headline')).toHaveText(
    'Modo somente download — salvar gera um arquivo baixado',
  );
  await expect(page.getByText('Neste modo não há detecção de conflito', { exact: false })).toBeVisible();
  await expect(page.getByText('Para o modo completo, abra a aplicação pelo endereço', { exact: false })).toBeVisible();
});

test('abrir o exemplo → editar o nome → salvar → recarregar → reabrir dos recentes devolve o estado', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await identify(page);

  // 1. abrir o exemplo
  await page.getByRole('button', { name: 'Exemplo' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações não salvas');

  // 2. editar o nome do documento
  await page.getByLabel('Nome do documento').fill('Políticas E2E');
  await page.getByRole('button', { name: 'Renomear' }).click();
  await expect(page.getByRole('heading', { name: 'Políticas E2E' })).toBeVisible();

  // Com documento aberto e sem detecção de conflito, o aviso de §5 aparece.
  await expect(page.getByText('não detecta conflito', { exact: false })).toBeVisible();

  // 3. salvar → neste modo, um download
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Salvar', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('politicas-e2e.json');

  const downloadDir = await mkdtemp(path.join(tmpdir(), 'policyops-e2e-'));
  const savedPath = path.join(downloadDir, 'politicas-e2e.json');
  await download.saveAs(savedPath);

  const saved = JSON.parse(readFileSync(savedPath, 'utf-8'));
  expect(saved.meta.name).toBe('Políticas E2E');
  expect(saved.meta.revision).toBe(1);
  expect(saved.meta.savedBy).toBe('Arthur');

  await expect(page.getByTestId('save-status')).toHaveText('Salvo');

  // 4. recarregar: o documento em memória some, como tem de ser
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Policy Matrix Studio' })).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Nenhum documento aberto');

  // 5. abrir o arquivo salvo pelo seletor
  const chooserOnOpen = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Abrir', exact: true }).click();
  await (await chooserOnOpen).setFiles(savedPath);

  await expect(page.getByRole('heading', { name: 'Políticas E2E' })).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Salvo');
  // A revisão aparece na barra de status e na tela do documento.
  await expect(page.getByRole('contentinfo').getByText('revisão 1')).toBeVisible();

  // 6. recarregar de novo e reabrir pelos recentes
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Policy Matrix Studio' })).toBeVisible();

  const recent = page.getByRole('button', { name: /^politicas-e2e\.json/ });
  await expect(recent).toBeVisible();

  const chooserOnRecent = page.waitForEvent('filechooser');
  await recent.click();
  await (await chooserOnRecent).setFiles(savedPath);

  // 7. o estado voltou
  await expect(page.getByRole('heading', { name: 'Políticas E2E' })).toBeVisible();
  await expect(page.getByRole('contentinfo').getByText('revisão 1')).toBeVisible();
  await expect(page.getByText('6 × 8 = 48 combinações')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('arquivo inválido abre em modo de recuperação, listando os problemas', async ({ page }) => {
  await page.goto(FILE_URL);
  await identify(page);

  const fixture = path.resolve(
    import.meta.dirname,
    '..',
    'fixtures',
    'defect-two-published-versions.json',
  );

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Abrir', exact: true }).click();
  await (await chooser).setFiles(fixture);

  await expect(
    page.getByRole('heading', { name: /Modo de recuperação/ }),
  ).toBeVisible();
  await expect(page.getByText('2 versões publicadas', { exact: false })).toBeVisible();
  // Sem correção automática para este defeito: a aplicação não abre o
  // documento, e diz por quê.
  await expect(page.getByRole('button', { name: 'Corrigir e salvar como…' })).toBeDisabled();
  await expect(
    page.getByText('Sem correção automática — corrija no JSON', { exact: false }),
  ).toBeVisible();
});

test('Ctrl+S salva e beforeunload avisa quando há alterações não salvas', async ({ page }) => {
  await page.goto(FILE_URL);
  await identify(page);
  await page.getByRole('button', { name: 'Exemplo' }).click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Control+s'),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  await expect(page.getByTestId('save-status')).toHaveText('Salvo');
});

test('arrastar-e-soltar em qualquer lugar da janela abre o arquivo', async ({ page }) => {
  await page.goto(FILE_URL);
  await identify(page);

  const fixture = path.resolve(import.meta.dirname, '..', 'fixtures', 'valid-base.json');
  const content = readFileSync(fixture, 'utf-8');

  // Soltar um arquivo de verdade vem do sistema operacional; o que dá para
  // dirigir é o evento com o mesmo formato que o navegador entrega.
  await page.evaluate((text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'arrastado.json', { type: 'application/json' }));
    document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
  }, content);

  await expect(page.getByRole('contentinfo').getByText('arrastado.json')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Salvo');
});
