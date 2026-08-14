import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CURRENT_SCHEMA_VERSION } from '../../src/core/document/schema';

/**
 * Conflito de salvamento e merge — docs/06-persistencia-e-concorrencia.md §5 e §7.
 *
 * O merge só acontece no modo `FULL`, e é ele que relê o arquivo antes de
 * gravar. `showOpenFilePicker` abre um seletor **nativo**, fora da página, que
 * nenhuma automação dirige — então o que este teste injeta, antes de o
 * aplicativo carregar, é uma File System Access API falsa sobre um "disco" em
 * memória. A aplicação não sabe da diferença: ela só conhece a interface do
 * adapter (§2).
 *
 * Isso é o que permite **simular o arquivo remoto alterado**: escrever no
 * disco falso por fora é exatamente a outra pessoa salvando às 10h05.
 */

const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;
const FILE_NAME = 'politicas.json';

type FakeDisk = {
  read: (name: string) => string | null;
  write: (name: string, text: string) => void;
  writes: (name: string) => number;
};

declare global {
  interface Window {
    __disk: FakeDisk;
  }
}

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

/** File System Access API falsa, instalada antes de qualquer script da página. */
async function installFakeFileSystem(page: Page): Promise<void> {
  await page.addInitScript((fileName: string) => {
    const disk = new Map<string, string>();
    const writeCount = new Map<string, number>();

    function makeHandle(name: string) {
      return {
        kind: 'file' as const,
        name,
        async getFile() {
          return new File([new TextEncoder().encode(disk.get(name) ?? '')], name, {
            type: 'application/json',
          });
        },
        async createWritable() {
          const chunks: BlobPart[] = [];
          return {
            async write(data: BlobPart) {
              chunks.push(data);
            },
            async close() {
              disk.set(name, await new Blob(chunks).text());
              writeCount.set(name, (writeCount.get(name) ?? 0) + 1);
            },
          };
        },
        async isSameEntry(other: { name?: string }) {
          return other?.name === name;
        },
      };
    }

    window.__disk = {
      read: (name) => disk.get(name) ?? null,
      write: (name, text) => {
        disk.set(name, text);
      },
      writes: (name) => writeCount.get(name) ?? 0,
    };

    // Sempre o mesmo arquivo: o teste precisa saber onde a aplicação gravou.
    const picker = () => Promise.resolve(makeHandle(fileName));
    Object.assign(window, {
      showOpenFilePicker: () => picker().then((handle) => [handle]),
      showSaveFilePicker: picker,
    });
    // §1: o modo FULL exige contexto seguro e origem **não** opaca. Uma página
    // `file://` tem origem opaca; aqui ela é fingida, para exercitar o modo
    // que só existe quando o arquivo está numa biblioteca https.
    Object.defineProperty(window, 'origin', {
      configurable: true,
      get: () => 'https://policyops.test',
    });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => true });
  }, FILE_NAME);
}

async function identify(page: Page, name = 'Ana') {
  await page.getByLabel('Nome').fill(name);
  await page.getByRole('button', { name: 'Começar' }).click();
  await expect(page.getByRole('heading', { name: /identificado/i })).not.toBeVisible();
}

function readDisk(page: Page) {
  return page.evaluate((name) => window.__disk.read(name), FILE_NAME);
}

/** A outra pessoa salvou por cima: um projeto novo, revisão maior, outro autor. */
async function simulateRemoteSave(page: Page) {
  await page.evaluate((name) => {
    const doc = JSON.parse(window.__disk.read(name) ?? '{}');
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
    window.__disk.write(name, JSON.stringify(doc, null, 2));
  }, FILE_NAME);
}

test('abrir, editar, arquivo alterado por fora, salvar, mesclar, revisar e confirmar', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await installFakeFileSystem(page);
  await page.goto(FILE_URL);
  await identify(page);

  // 1. modo completo: é o único em que existe detecção de conflito (§5)
  await expect(page.getByTestId('mode-headline')).toHaveText(
    'Modo completo — a aplicação grava direto no arquivo',
  );

  // 2. abrir o exemplo e gravar o arquivo de trabalho
  await page.getByRole('button', { name: 'Exemplo' }).click();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Salvo');
  expect(await readDisk(page)).toContain(`"schemaVersion": ${CURRENT_SCHEMA_VERSION}`);

  // 3. editar: renomeio o documento
  await page.getByLabel('Nome do documento').fill('Políticas E2E');
  await page.getByRole('button', { name: 'Renomear' }).click();
  await expect(page.getByRole('heading', { name: 'Políticas E2E' })).toBeVisible();

  // 4. simular a outra pessoa salvando o mesmo arquivo
  await simulateRemoteSave(page);

  // 5. salvar → conflito, e nada gravado
  const writesBefore = await page.evaluate((name) => window.__disk.writes(name), FILE_NAME);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Conflito ao salvar' })).toBeVisible();
  await expect(page.getByText('Beatriz salvou este arquivo', { exact: false })).toBeVisible();
  expect(await page.evaluate((name) => window.__disk.writes(name), FILE_NAME)).toBe(writesBefore);

  // 6. escolher mesclar → a tela de merge, com tudo à vista
  await page.getByRole('button', { name: 'Mesclar' }).click();
  await expect(page.getByRole('heading', { name: `Mesclar com ${FILE_NAME}` })).toBeVisible();

  // O que entra sozinho: o projeto que só existe no arquivo.
  await expect(page.getByTestId('merge-applied')).toContainText('Política Auto');
  await expect(page.getByTestId('merge-applied')).toContainText('entra por união');

  // 7. revisar a decisão: os dois lados renomearam o documento
  const conflict = page.getByTestId('merge-conflict');
  await expect(conflict).toHaveCount(1);
  await expect(conflict).toContainText('O documento');
  await expect(conflict).toContainText('Políticas E2E');
  await conflict.getByRole('radio', { name: /Manter o meu/ }).check();

  // Nada foi gravado até aqui.
  expect(await page.evaluate((name) => window.__disk.writes(name), FILE_NAME)).toBe(writesBefore);

  // 8. confirmar
  await page.getByTestId('merge-confirm').click();
  await expect(page.getByTestId('save-status')).toHaveText('Salvo');
  await expect(page.getByRole('heading', { name: 'Mesclar com', exact: false })).not.toBeVisible();

  const saved = JSON.parse((await readDisk(page)) ?? '{}');
  // O trabalho dos dois lados sobreviveu…
  expect(saved.meta.name).toBe('Políticas E2E');
  expect(saved.projects.some((project: { code: string }) => project.code === 'POLITICA_AUTO')).toBe(
    true,
  );
  // …a revisão continua de onde o arquivo estava, e o merge ficou no histórico.
  expect(saved.meta.revision).toBe(7);
  expect(saved.meta.savedBy).toBe('Ana');
  const merged = saved.events.filter((event: { type: string }) => event.type === 'DOCUMENT_MERGED');
  expect(merged).toHaveLength(1);
  expect(merged[0].summary).toContain('Ana mesclou o documento');
  expect(merged[0].payload.remoteSavedBy).toBe('Beatriz');

  // O projeto mesclado aparece na interface.
  await page.getByRole('button', { name: 'Projetos' }).click();
  await expect(page.getByText('POLITICA_AUTO')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('cancelar o merge não grava nada e devolve o documento como estava', async ({ page }) => {
  await installFakeFileSystem(page);
  await page.goto(FILE_URL);
  await identify(page);

  await page.getByRole('button', { name: 'Exemplo' }).click();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Salvo');

  await page.getByLabel('Nome do documento').fill('Políticas E2E');
  await page.getByRole('button', { name: 'Renomear' }).click();
  await simulateRemoteSave(page);

  const writesBefore = await page.evaluate((name) => window.__disk.writes(name), FILE_NAME);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.getByRole('button', { name: 'Mesclar' }).click();
  await expect(page.getByRole('heading', { name: `Mesclar com ${FILE_NAME}` })).toBeVisible();

  await page.getByRole('button', { name: 'Cancelar' }).click();

  await expect(page.getByRole('heading', { name: 'Políticas E2E' })).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações não salvas');
  expect(await page.evaluate((name) => window.__disk.writes(name), FILE_NAME)).toBe(writesBefore);
  const onDisk = JSON.parse((await readDisk(page)) ?? '{}');
  expect(onDisk.meta.savedBy).toBe('Beatriz');
});

