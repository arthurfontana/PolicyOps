import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Carga da política por recorte (S40, docs/14-governanca-de-alteracoes.md §9,
 * docs/prompts/S40-carga-de-componentes.md): colar um capítulo em Markdown
 * dentro de uma seção escolhida → revisar → confirmar → árvore navegável.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

const MARKDOWN_SAMPLE = [
  '# Bloqueios por Dívida',
  'Visão geral do capítulo de bloqueios por dívida.',
  '> Tipo: SECTION',
  '',
  '### Dívida Acima de R$ 5.000',
  'Bloqueia o cliente com dívida em aberto igual ou superior a R$ 5.000.',
  '> Tipo: RULE',
  '> Definição técnica: Aging > 0 e Valor >= 5000',
  '> Reason code: DV01',
  '> Fonte: Filtros e Critérios B2C, p. 10',
].join('\n');

test('colar amostra → revisar → confirmar → árvore navegável', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E Carga Markdown');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Política PJ' })).toBeVisible();

  // --- Passo 1: destino (raiz) + colar o texto ---------------------------
  // "Carregar Markdown" é o quarto item de criação da barra de ferramentas
  // (§2.1): em janela estreita ele vive dentro do "⋯ Mais".
  const botaoDireto = page.getByRole('button', { name: 'Carregar Markdown' });
  if ((await botaoDireto.count()) === 0) {
    await page.getByRole('button', { name: '⋯ Mais' }).click();
    await page.getByRole('menuitem', { name: 'Carregar Markdown' }).click();
  } else {
    await botaoDireto.click();
  }
  await expect(page.getByRole('dialog', { name: 'Carregar Markdown' })).toBeVisible();
  await page.getByLabel('Texto em Markdown').fill(MARKDOWN_SAMPLE);
  await page.getByRole('button', { name: 'Avançar' }).click();

  // --- Passo 2: revisão — as duas linhas aparecem, nada bloqueado ---------
  await expect(page.getByText('2 de 2 linha(s) selecionada(s) para entrar.')).toBeVisible();
  await expect(page.getByText('Bloqueios por Dívida')).toBeVisible();
  await expect(page.getByText('Dívida Acima de R$ 5.000')).toBeVisible();
  await page.getByRole('button', { name: 'Avançar' }).click();

  // --- Passo 3: confirmação ------------------------------------------------
  await expect(page.getByLabel('Vigência da carga (obrigatória)')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar carga' }).click();
  await expect(page.getByText('2 componente(s) carregado(s) e publicado(s).')).toBeVisible();
  await page.getByRole('button', { name: 'Fechar' }).first().click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  // --- A árvore mostra os dois nós, navegáveis, com origem preservada ------
  const secao = page.getByTestId('tree-node-BLOQUEIOS_POR_DIVIDA');
  await expect(secao).toBeVisible();
  await secao.click();
  // `.first()` pegaria o chip de alvo da barra (§2.1) — aqui o que interessa
  // é o conteúdo do centro, do componente aberto pela árvore.
  await expect(page.getByRole('heading', { name: 'Bloqueios por Dívida' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Expandir Bloqueios por Dívida' }).click();

  const regra = page.getByTestId('tree-node-DIVIDA_ACIMA_DE_R_5_000');
  await expect(regra).toBeVisible();
  await regra.click();
  await expect(page.getByText(/Aguardando revisão/).first()).toBeVisible();

  expect(pageErrors, `Erros no console: ${pageErrors.join('\n')}`).toEqual([]);
});
