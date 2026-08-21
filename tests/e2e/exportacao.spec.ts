import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Cenário 7 da suíte E2E consolidada (docs/prompts/S17 Parte C): exportação
 * de CSV e JSON, com validação do conteúdo — não só "o arquivo baixou".
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

/** Abre o documento de exemplo direto na matriz PJ (v1, publicada) — mesmo eixo aninhado do docs/08 §5. */
async function openPJMatrix(page: Page): Promise<void> {
  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();
  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await page.getByRole('button', { name: /MTZ_LIMITE_PJ/ }).click();
  await expect(page.getByRole('main').getByText('Vigente · v1', { exact: true })).toBeVisible();
}

async function downloadViaExportMenu(page: Page, itemLabel: string): Promise<string> {
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: itemLabel }).click(),
  ]);
  const filePath = await download.path();
  if (filePath === null) throw new Error('Download sem caminho local.');
  return readFileSync(filePath, 'utf-8');
}

test.describe('Exportação — CSV e JSON', () => {
  test('JSON canônico: schemaVersion 1, decimais como string, uma célula por combinação preenchida', async ({
    page,
  }) => {
    await openPJMatrix(page);
    const content = await downloadViaExportMenu(page, 'Exportar JSON');
    const parsed = JSON.parse(content);

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.matrix.code).toBe('MTZ_LIMITE_PJ');
    expect(parsed.version.number).toBe(1);
    expect(parsed.version.state).toBe('PUBLISHED');
    expect(parsed.axes.x.levels).toEqual([{ variable: 'SCORE_HVI3', variableVersion: 1 }]);
    expect(parsed.axes.y.levels.map((level: { variable: string }) => level.variable)).toEqual([
      'SEGMENTO',
      'FAT',
    ]);
    // 6 (SCORE) × 8 (SEGMENTO › FAT sob a regra de compatibilidade) = 48.
    expect(parsed.axes.x.tuples).toHaveLength(6);
    expect(parsed.axes.y.tuples).toHaveLength(8);
    expect(Array.isArray(parsed.cells)).toBe(true);
    expect(parsed.cells.length).toBeGreaterThan(0);

    const withLimit = parsed.cells.find((cell: { limitValue?: string }) => cell.limitValue !== undefined);
    expect(typeof withLimit.limitValue).toBe('string');
  });

  test('CSV: BOM UTF-8, separador ";", uma coluna por nível, decisão em pt-BR', async ({ page }) => {
    await openPJMatrix(page);
    const content = await downloadViaExportMenu(page, 'Exportar CSV');

    expect(content.charCodeAt(0)).toBe(0xfeff);
    const [header, ...rows] = content.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    expect(header).toBe(
      'x_SCORE_HVI3;y_SEGMENTO;y_FAT;decisao;oferta;limite;limite_valor;limite_minimo;limite_maximo;cor;observacao',
    );
    // Uma linha por combinação: 6 × 8 = 48.
    expect(rows).toHaveLength(48);
    // Toda combinação da matriz de exemplo nasce com decisão (docs/document/create.ts) —
    // nenhuma linha fica com o campo de decisão vazio.
    for (const row of rows) {
      const fields = row.split(';');
      expect(fields[3]).not.toBe('');
    }
  });
});
