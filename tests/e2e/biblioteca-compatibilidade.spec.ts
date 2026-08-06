import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 07 — Biblioteca de Compatibilidade. Critério de aceite E2E: criar a
 * regra SEG_X_FATURAMENTO do zero — a partir de um documento em branco, sem
 * usar o documento de exemplo (que já traz essa regra publicada e bloquearia
 * uma segunda pelo par via I12) — publicar, e ver o preview com as 8 tuplas
 * esperadas de docs/03-modelo-do-documento.md §3.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

async function createPublishedVariable(
  page: Page,
  input: { code: string; name: string; domains: Array<{ code: string; label: string }> },
) {
  await page.getByRole('button', { name: 'Variáveis' }).click();
  await expect(page.getByRole('heading', { name: 'Biblioteca › Variáveis' })).toBeVisible();

  await page.getByRole('button', { name: 'Nova variável' }).first().click();
  await page.getByLabel('Código').fill(input.code);
  await page.getByLabel('Nome').fill(input.name);
  await page.getByRole('button', { name: 'Criar variável' }).click();

  await expect(page.getByText(`Domínios da versão 1`)).toBeVisible();

  for (const [index, domain] of input.domains.entries()) {
    await page.getByRole('button', { name: 'Adicionar domínio' }).click();
    const row = page.getByTestId('domain-row').nth(index);
    await row.getByLabel('Código').fill(domain.code);
    await row.getByLabel('Rótulo', { exact: true }).fill(domain.label);
  }

  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Domínios salvos').first()).toBeVisible();

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Versão 1 publicada').first()).toBeVisible();

  await page.getByRole('button', { name: 'Voltar à lista de variáveis' }).click();
}

test('cria a regra SEG_X_FATURAMENTO do zero, publica, e o preview mostra as 8 tuplas esperadas', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByLabel('Como chamar o documento').fill('Teste Compatibilidade');
  await page.getByRole('button', { name: 'Novo' }).click();
  await expect(page.getByRole('heading', { name: 'Teste Compatibilidade' })).toBeVisible();

  await createPublishedVariable(page, {
    code: 'SEGMENTO',
    name: 'Segmento',
    domains: [
      { code: 'VAREJO', label: 'Varejo' },
      { code: 'ATACADO', label: 'Atacado' },
      { code: 'CORPORATE', label: 'Corporate' },
    ],
  });

  await createPublishedVariable(page, {
    code: 'FAT',
    name: 'Faixa de Faturamento',
    domains: [
      { code: 'ATE_100K', label: 'Até 100 mil' },
      { code: '100K_500K', label: '100 mil a 500 mil' },
      { code: '500K_1M', label: '500 mil a 1 milhão' },
      { code: '1M_10M', label: '1 milhão a 10 milhões' },
      { code: 'ACIMA_10M', label: 'Acima de 10 milhões' },
    ],
  });

  await page.getByRole('button', { name: 'Compatibilidade' }).click();
  await expect(page.getByRole('heading', { name: 'Biblioteca › Compatibilidade' })).toBeVisible();

  await page.getByRole('button', { name: 'Nova regra' }).first().click();
  await page.getByLabel('Código').fill('SEG_X_FATURAMENTO');
  await page.getByLabel('Nome').fill('Segmento × Faixa de Faturamento');

  const combos = page.getByRole('combobox');
  await combos.nth(0).click();
  await page.getByRole('option', { name: /^Segmento/ }).click();
  await combos.nth(1).click();
  await page.getByRole('option', { name: /^Faixa de Faturamento/ }).click();

  await page.getByRole('button', { name: 'Criar regra' }).click();

  // defaultForUnlisted parte como ALL (todas as 15 combinações nascem
  // marcadas); troca para NONE primeiro para partir de um grid vazio, e então
  // marca só as 8 combinações do exemplo de docs/03 §3.
  await expect(page.getByText('15 de 15 combinações válidas')).toBeVisible();
  await page.getByRole('combobox').last().click();
  await page.getByRole('option', { name: 'Não libera nenhum (NONE)' }).click();
  await expect(page.getByText('0 de 15 combinações válidas')).toBeVisible();

  const allow: Record<string, string[]> = {
    Varejo: ['Até 100 mil', '100 mil a 500 mil', '500 mil a 1 milhão'],
    Atacado: ['500 mil a 1 milhão', '1 milhão a 10 milhões', 'Acima de 10 milhões'],
    Corporate: ['1 milhão a 10 milhões', 'Acima de 10 milhões'],
  };
  for (const [parentLabel, childLabels] of Object.entries(allow)) {
    for (const childLabel of childLabels) {
      const checkbox = page.getByRole('checkbox', { name: `${parentLabel} → ${childLabel}`, exact: true });
      await checkbox.click();
      await expect(checkbox).toBeChecked();
    }
  }

  await expect(page.getByText('8 de 15 combinações válidas')).toBeVisible();

  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Mapa salvo').first()).toBeVisible();

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Versão 1 publicada').first()).toBeVisible();
  await expect(page.getByText('Vigente').first()).toBeVisible();

  await expect(page.getByText('Preview do eixo resultante — 8 tupla(s)')).toBeVisible();
  const expectedTuples = [
    'Varejo → Até 100 mil',
    'Varejo → 100 mil a 500 mil',
    'Varejo → 500 mil a 1 milhão',
    'Atacado → 500 mil a 1 milhão',
    'Atacado → 1 milhão a 10 milhões',
    'Atacado → Acima de 10 milhões',
    'Corporate → 1 milhão a 10 milhões',
    'Corporate → Acima de 10 milhões',
  ];
  for (const tuple of expectedTuples) {
    await expect(page.getByText(tuple, { exact: true })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Voltar à lista de compatibilidade' }).click();
  const row = page.getByRole('button', { name: /Segmento × Faixa de Faturamento/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('8 de 15 combinações válidas (v1)')).toBeVisible();
  await expect(row.getByText('rascunho aberto')).not.toBeVisible();

  expect(pageErrors).toEqual([]);
});
