import { test, expect } from '@playwright/test';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 22 — assistente de carga (passos 1–4 + plano somente leitura).
 * Critério de aceite ponta a ponta: abrir documento vazio → carregar o
 * recorte do CINEMINHA → mapear as 12 colunas → criar a biblioteca pelo
 * passo 3 → chegar ao passo 5 e ver as matrizes novas do recorte.
 *
 * O documento parte só com `SCORE_HVI3` publicada (R01–R20) — a variável de
 * eixo X que já existe de verdade — para exercitar o passo 3 montando o
 * resto da biblioteca a partir do arquivo (US-04): `MODELO_ADICIONAL`,
 * `FAIXA_MODELO_ADICIONAL`, a compatibilidade entre elas e o catálogo de
 * ofertas/decisões/tags.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;
const RECORTE_PATH = path.resolve(import.meta.dirname, '..', 'fixtures', 'cineminha-recorte.csv');

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

test('carga do recorte CINEMINHA: arquivo → colunas → biblioteca → conteúdo → plano', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill('Teste E2E S22');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByPlaceholder('Nome do documento').fill('Carga CINEMINHA');
  await page.getByRole('button', { name: 'Novo', exact: true }).click();

  // Projeto de destino.
  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: 'Novo projeto' }).first().click();
  await page.getByLabel('Código').fill('POLITICA_B2C');
  await page.getByLabel('Nome').fill('Política B2C');
  await page.getByRole('button', { name: 'Criar projeto' }).click();

  // SCORE_HVI3 — a variável de eixo X que já existe de verdade (R01–R20).
  await page.getByRole('button', { name: 'Variáveis' }).click();
  await page.getByRole('button', { name: 'Nova variável' }).first().click();
  await page.getByLabel('Código').fill('SCORE_HVI3');
  await page.getByLabel('Nome').fill('Score HVI3');
  await page.getByRole('button', { name: 'Criar variável' }).click();

  await expect(page.getByText('Domínios da versão 1')).toBeVisible();
  await page.getByRole('button', { name: 'Colar tabela' }).click();
  const scoreDomains = ['Domínio', ...Array.from({ length: 20 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`)].join(
    '\n',
  );
  await page.getByLabel('Tabela de domínios colada').fill(scoreDomains);
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByLabel('Tabela de domínios colada')).not.toBeVisible();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Domínios salvos').first()).toBeVisible();
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Versão 1 publicada').first()).toBeVisible();

  // Abre o assistente pelo cabeçalho da lista de matrizes do projeto.
  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: 'Política B2C', exact: true }).click();
  await page.getByRole('button', { name: 'Carregar tabela' }).click();
  await expect(page.getByRole('heading', { name: 'Carga de matrizes' })).toBeVisible();

  // Passo 1 — arquivo real, pelo seletor de arquivo.
  await page.setInputFiles('input[type="file"]', RECORTE_PATH);
  await expect(page.getByText('231 linhas · 12 colunas')).toBeVisible();
  await page.getByRole('button', { name: 'Avançar' }).click();

  // Passo 2 — colunas.
  await page.getByLabel('Projeto de destino').click();
  await page.getByRole('option', { name: 'Política B2C' }).click();

  async function setRole(column: string, role: string) {
    await page.getByLabel(`Papel de ${column}`, { exact: true }).click();
    await page.getByRole('option', { name: role, exact: true }).click();
  }

  await setRole('CLUSTER_GRUPO', 'Partição');
  await setRole('CEP_RISCO', 'Partição');

  await setRole('MOD_PRC', 'Eixo X');
  await page.getByLabel('Variável de MOD_PRC').click();
  await page.getByRole('option', { name: 'SCORE_HVI3' }).click();

  await setRole('DS_MOD_ADC', 'Eixo Y');
  await page.getByLabel('Variável de DS_MOD_ADC').click();
  await page.getByRole('option', { name: 'Nova variável' }).click();
  await page.getByRole('dialog').getByLabel('Código').fill('MODELO_ADICIONAL');
  await page.getByRole('dialog').getByLabel('Nome').fill('Modelo adicional');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar variável' }).click();

  await setRole('MOD_ADC', 'Eixo Y');
  await page.getByLabel('Nível de MOD_ADC').fill('1');
  await page.getByLabel('Variável de MOD_ADC').click();
  await page.getByRole('option', { name: 'Nova variável' }).click();
  await page.getByRole('dialog').getByLabel('Código').fill('FAIXA_MODELO_ADICIONAL');
  await page.getByRole('dialog').getByLabel('Nome').fill('Faixa do modelo adicional');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar variável' }).click();

  const OFFER_COLUMNS = ['OFERTA', 'OFERTA_GERAL', 'OFERTA_DIGITAL', 'OFERTA_URA', 'OFERTA_PAP', 'OFERTA_OUTBOUND'];
  for (const column of OFFER_COLUMNS) {
    await setRole(column, 'Valor');
  }

  await page.getByRole('button', { name: 'Desdobrar' }).click();
  for (const column of OFFER_COLUMNS) {
    await page.getByLabel(`Incluir ${column} no desdobramento`).click();
  }

  await page.getByLabel('Padrão de código').fill('MTZ_{CLUSTER_GRUPO}_{CEP_RISCO}_{CANAL}');
  await page.getByLabel('Padrão de nome').fill('{CLUSTER_GRUPO} {CEP_RISCO} {CANAL}');

  await expect(page.getByText(/18 matrizes/)).toBeVisible();
  await page.getByRole('button', { name: 'Avançar' }).click();

  // Passo 3 (primeira passada) — domínios, compatibilidade e catálogo de
  // ofertas. Decisão e tags ainda não existem (dependem do passo 4).
  await expect(page.getByRole('heading', { name: 'MODELO_ADICIONAL', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'FAIXA_MODELO_ADICIONAL', exact: true })).toBeVisible();
  // Três lacunas de domínio: SCORE_HVI3 (falta R99 — o arquivo traz score
  // "sem fallback"), MODELO_ADICIONAL e FAIXA_MODELO_ADICIONAL. Resolve todas
  // clicando até não sobrar nenhum botão "Criar domínios pendentes".
  while ((await page.getByRole('button', { name: /Criar domínios pendentes/ }).count()) > 0) {
    await page.getByRole('button', { name: /Criar domínios pendentes/ }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Criar e publicar' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }

  await page.getByRole('button', { name: 'Criar mapa do arquivo' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar e publicar' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await page.getByRole('button', { name: /Criar todos/ }).click();

  await expect(page.getByRole('button', { name: 'Avançar' })).toBeEnabled();
  await page.getByRole('button', { name: 'Avançar' }).click();

  // Passo 4 — conteúdo: uma regra de oferta "0" → Reprovado, e o otherwise.
  await expect(page.getByText('Regras de decisão')).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar regra' }).click();
  await page.getByLabel('0', { exact: true }).check();
  await page.getByLabel('Decisão da regra 1').click();
  // O catálogo de decisão ainda não existe — cria a partir do passo 3, então
  // volta aqui. Antes disso, garante o "otherwise" pendente também.

  // Volta ao passo 3: agora que as regras de decisão e as tags do perfil já
  // existem, as pendências de catálogo (DECISION e TAG) aparecem.
  await page.getByRole('button', { name: 'Biblioteca' }).click();
  await expect(page.getByText('Catálogo · Decisões')).toBeVisible();
  await page.getByRole('button', { name: /Criar todos/ }).first().click();
  await expect(page.getByText('Catálogo · Tags')).toBeVisible();
  await page.getByRole('button', { name: /Criar todos/ }).first().click();

  await page.getByRole('button', { name: 'Conteúdo' }).click();
  await page.getByLabel('Decisão da regra 1').click();
  await page.getByRole('option', { name: 'Reprovado' }).click();
  await page.getByLabel('Decisão padrão (otherwise)').click();
  await page.getByRole('option', { name: 'Aprovado' }).click();

  await page.getByRole('button', { name: 'Avançar' }).click();

  // Passo 5 — plano, somente leitura: 18 matrizes novas (3 partições × 6 canais).
  await expect(page.getByText('18 novas')).toBeVisible();
  await expect(page.getByText('A aplicação da carga chega na próxima sessão.')).toBeVisible();
  await expect(page.getByText('O plano está bloqueado')).not.toBeVisible();

  expect(pageErrors).toEqual([]);
});
