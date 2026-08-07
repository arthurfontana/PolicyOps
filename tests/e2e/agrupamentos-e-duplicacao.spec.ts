import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 20 — Agrupamentos hierárquicos de faixas e duplicação de variável.
 * Critério de aceite E2E (docs/prompts/S20): criar variável RANGE, colar a
 * tabela de exemplo de Regional × Porte (sem configurar nada antes), salvar e
 * publicar; usar essa variável num eixo de matriz e conferir que o número de
 * tuplas independe do agrupamento; duplicar a variável e conferir que
 * agrupamentos, faixas e cores sobrevivem.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

/**
 * Regional × Porte, combinações assimétricas (Sul só tem MEI) e contígua em
 * HALF_OPEN — o modo padrão, sem passar por "Opções avançadas".
 */
const REGIONAL_PORTE_TABLE = [
  ['Regional', 'Porte', 'Domínio', 'Mínimo', 'Máximo', 'Cor'].join('\t'),
  ['São Paulo', 'MEI', 'R1 - Baixo', '0', '100', '#00FF2A'].join('\t'),
  ['São Paulo', 'MEI', 'R2 - Medio', '100', '200', '#FFA200'].join('\t'),
  ['São Paulo', 'MEI', 'R3 - Alto', '200', '999', '#FF0000'].join('\t'),
  ['São Paulo', 'Não MEI', 'R1 - Baixo', '0', '90', '#00FF2A'].join('\t'),
  ['São Paulo', 'Não MEI', 'R2 - Medio', '90', '180', '#FFA200'].join('\t'),
  ['São Paulo', 'Não MEI', 'R3 - Alto', '180', '999', '#FF0000'].join('\t'),
  ['Sul', 'MEI', 'R1 - Baixo', '0', '110', '#00FF2A'].join('\t'),
  ['Sul', 'MEI', 'R2 - Medio', '110', '220', '#FFA200'].join('\t'),
  ['Sul', 'MEI', 'R3 - Alto', '220', '999', '#FF0000'].join('\t'),
].join('\n');

test('cria variável RANGE com agrupamentos colando tabela, publica, usa num eixo e duplica', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E Agrupamentos');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();
  await expect(page.getByRole('heading', { name: 'Documento de exemplo — Políticas de Crédito' })).toBeVisible();

  await page.getByRole('button', { name: 'Variáveis' }).click();
  await expect(page.getByRole('heading', { name: 'Biblioteca › Variáveis' })).toBeVisible();

  await page.getByRole('button', { name: 'Nova variável' }).click();
  await page.getByLabel('Código').fill('HVI_AGRUPADO');
  await page.getByLabel('Nome').fill('HVI Agrupado');
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Faixa' }).click();
  await page.getByRole('button', { name: 'Criar variável' }).click();

  await expect(page.getByText('Domínios da versão 1')).toBeVisible();

  // Nenhuma configuração manual prévia: a colagem infere os dois níveis.
  await page.getByRole('button', { name: 'Colar tabela' }).click();
  await page.getByLabel('Tabela de domínios colada').fill(REGIONAL_PORTE_TABLE);
  await page.getByRole('button', { name: 'Aplicar' }).click();

  await expect(page.getByLabel('Tabela de domínios colada')).not.toBeVisible();
  await expect(page.getByText(/não são contíguas/)).not.toBeVisible();

  // Dois níveis detectados e três caminhos — Sul não tem "Não MEI".
  await expect(page.getByTestId('grouping-dimension-row')).toHaveCount(2);
  await expect(page.getByLabel('Código do agrupamento').first()).toHaveValue('REGIONAL');
  await expect(page.getByTestId('grouping-path-group')).toHaveCount(3);
  await expect(page.getByLabel('Mínimo de R2 em SUL › MEI')).toHaveValue('110');

  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Domínios salvos').first()).toBeVisible();

  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Versão 1 publicada').first()).toBeVisible();

  await page.getByRole('button', { name: 'Voltar à lista de variáveis' }).click();
  const row = page.getByRole('button', { name: /HVI Agrupado/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('3 domínios (v1)')).toBeVisible();

  // A matriz não sabe que existe agrupamento: 3 domínios num eixo × 4 no
  // outro produz 12 combinações, exatamente como uma variável sem agrupamento.
  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await page.getByRole('button', { name: 'Nova matriz' }).click();
  const createDialog = page.getByRole('dialog');
  await createDialog.getByRole('button', { name: 'Começar do zero' }).click();
  await createDialog.getByLabel('Nome').fill('Matriz com variável agrupada');
  await createDialog.getByRole('button', { name: 'Avançar' }).click();

  await createDialog.getByRole('button', { name: 'Adicionar nível' }).nth(0).click();
  await createDialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: /HVI Agrupado/ }).click();

  await createDialog.getByRole('button', { name: 'Adicionar nível' }).nth(1).click();
  await createDialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: /Faixa de Renda/ }).click();

  await expect(createDialog.getByText('4 linhas × 3 colunas = 12 combinações')).toBeVisible();
  await createDialog.getByRole('button', { name: 'Criar matriz' }).click();

  await expect(page.locator('[role="gridcell"]')).toHaveCount(12);
  await expect(page.getByTestId('grid-counters')).toContainText('12 combinações');

  // Duplicar a variável a partir da tela de nova variável.
  await page.getByRole('button', { name: 'Variáveis' }).click();
  await page.getByRole('button', { name: 'Nova variável' }).click();
  await page.getByRole('button', { name: 'Ou crie a partir de uma variável existente' }).click();

  await page.getByRole('combobox', { name: 'Variável de origem' }).click();
  await page.getByRole('option', { name: /HVI_AGRUPADO/ }).click();
  await page.getByLabel('Código da nova variável').fill('HVI_AGRUPADO_2');
  await page.getByLabel('Nome').fill('HVI Agrupado 2');
  await page.getByRole('button', { name: 'Criar variável' }).click();

  // Caiu no detalhe da cópia, v1 em DRAFT: agrupamentos, faixas e cores intactos.
  await expect(page.getByText('Domínios da versão 1')).toBeVisible();
  await expect(page.getByText('Rascunho').first()).toBeVisible();
  await expect(page.getByText('3 domínio(s)')).toBeVisible();
  await expect(page.getByTestId('grouping-dimension-row')).toHaveCount(2);
  await expect(page.getByTestId('grouping-path-group')).toHaveCount(3);
  await expect(page.getByLabel('Mínimo de R2 em SAO_PAULO › NAO_MEI')).toHaveValue('90');
  await expect(page.getByLabel('Cor').first()).toHaveValue('#00ff2a');

  await page.getByRole('button', { name: 'Voltar à lista de variáveis' }).click();
  const originalRow = page.getByRole('button', { name: /^HVI Agrupado /, exact: false }).first();
  await expect(originalRow.getByText('3 domínios (v1)')).toBeVisible();

  expect(pageErrors).toEqual([]);
});
