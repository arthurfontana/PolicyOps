import { test, expect } from '@playwright/test';
import path from 'node:path';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

/**
 * O épico Carga ponta a ponta (S22 + S24). Um teste só, porque o valor está
 * justamente na sequência: documento vazio → carga do recorte real → 18
 * matrizes criadas → publicar todas → alterar 5 células do arquivo → segunda
 * carga → exatamente 1 matriz alterada com 5 células, as outras 17 intocadas →
 * publicar → terceira carga do mesmo arquivo → "nenhuma alteração a aplicar".
 *
 * Cobre CT-01, CT-02, CT-12, CT-15 e CT-16 sobre o recorte de 231 linhas
 * (3 partições × 6 canais = 18 matrizes) em vez das 102 do arquivo inteiro:
 * a mecânica é a mesma, e os números grandes já estão cobertos pelos testes
 * de unidade e de desempenho.
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

/**
 * O arquivo da segunda carga: 5 células do canal Digital de uma mesma matriz
 * (G1 · Sem Risco) com outra oferta. As linhas 2 a 6 do recorte pertencem ao
 * mesmo par de partição, então mudar `OFERTA_DIGITAL` nelas produz uma única
 * matriz alterada com exatamente 5 células.
 */
function alteredCsv(): string {
  const original = readFileSync(RECORTE_PATH, 'utf8');
  const lines = original.split('\n');
  const header = lines[0]!.split(';');
  const digital = header.indexOf('OFERTA_DIGITAL');
  for (let line = 2; line <= 6; line++) {
    const fields = lines[line - 1]!.split(';');
    fields[digital] = fields[digital] === '0' ? '15' : '0';
    lines[line - 1] = fields.join(';');
  }
  const target = path.join(mkdtempSync(path.join(tmpdir(), 'policyops-e2e-')), 'CINEMINHA_ALTERADO.csv');
  writeFileSync(target, lines.join('\n'), 'utf8');
  return target;
}

test('épico Carga: primeira carga, publicação, segunda carga seletiva e terceira sem alteração', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  // O item de projeto na barra lateral ganha um badge de contagem de matrizes
  // assim que o projeto deixa de estar vazio (docs/07-ux-e-editor.md §"Na
  // barra lateral"), o que muda o nome acessível do botão de "Política B2C"
  // para "Política B2C 18" — por isso o seletor não usa `exact` e fica preso
  // à navegação, onde o nome é inequívoco mesmo com o badge.
  const sidebar = page.getByRole('navigation', { name: 'Navegação principal' });
  function politicaB2cNav() {
    return sidebar.getByRole('button', { name: 'Política B2C' });
  }

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
  await politicaB2cNav().click();
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

  // Passo 4 — conteúdo: uma regra de oferta "0" → Reprovado, e o otherwise →
  // Aprovado. O catálogo de decisão ainda não existe — "Novo código de
  // decisão…" cria o item de catálogo ali mesmo e já seleciona a regra.
  await expect(page.getByText('Regras de decisão')).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar regra' }).click();
  await page.getByLabel('0', { exact: true }).check();

  await page.getByLabel('Decisão da regra 1').click();
  await page.getByRole('option', { name: 'Novo código de decisão' }).click();
  await page.getByRole('dialog').getByLabel('Código').fill('REPROVADO');
  await page.getByRole('dialog').getByLabel('Rótulo').fill('Reprovado');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar' }).click();

  await page.getByLabel('Decisão padrão (otherwise)').click();
  await page.getByRole('option', { name: 'Novo código de decisão' }).click();
  await page.getByRole('dialog').getByLabel('Código').fill('APROVADO');
  await page.getByRole('dialog').getByLabel('Rótulo').fill('Aprovado');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar' }).click();

  // Volta ao passo 3: agora que as tags do perfil existem (preenchidas
  // automaticamente ao visitar o passo 4), a pendência de catálogo TAG
  // aparece. O rótulo do passo se repete na barra lateral, então o seletor
  // fica preso ao stepper.
  const stepper = page.getByRole('list', { name: 'Passos da carga' });
  await stepper.getByRole('button', { name: 'Biblioteca' }).click();
  await expect(page.getByText('Catálogo · Tags')).toBeVisible();
  await page.getByRole('button', { name: /Criar todos/ }).click();

  await stepper.getByRole('button', { name: 'Conteúdo' }).click();
  await expect(page.getByText('Regras de decisão')).toBeVisible();

  await page.getByRole('button', { name: 'Avançar' }).click();

  // ---------------------------------------------------------------------
  // Passo 5 — o plano: 18 matrizes novas (3 partições × 6 canais).
  // ---------------------------------------------------------------------
  await expect(page.getByText('18 novas', { exact: true })).toBeVisible();
  await expect(page.getByText('O plano está bloqueado')).not.toBeVisible();
  await expect(page.getByTestId('plan-selected-count')).toHaveText('18 de 18 selecionadas');

  // ---------------------------------------------------------------------
  // Passo 6 — aplicar. Nada é publicado aqui (RN-10).
  // ---------------------------------------------------------------------
  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByLabel('Nota da carga').fill('Primeira carga do recorte CINEMINHA');
  await expect(page.getByTestId('apply-summary')).toContainText('cria 18 matrizes');
  await expect(page.getByTestId('apply-summary')).toContainText('Não publica nada');
  await page.getByTestId('apply-import').click();

  const report = page.getByTestId('import-report');
  await expect(report).toBeVisible();
  await expect(report.getByText('18 matrizes criadas')).toBeVisible();
  await expect(report.getByText('18 rascunhos a revisar')).toBeVisible();

  // US-08 — salva o perfil, para a segunda carga reconhecer o cabeçalho.
  await report.getByLabel('Código').fill('CARGA_CINEMINHA');
  await report.getByLabel('Nome').fill('Carga do cineminha');
  await page.getByTestId('save-profile').click();
  await expect(page.getByText('Perfil gravado.')).toBeVisible();

  // ---------------------------------------------------------------------
  // Fila de revisão — CT-15 e CT-16: publicável na sequência, sem ajuste.
  // ---------------------------------------------------------------------
  await page.getByTestId('open-review-queue').click();
  await expect(page.getByRole('heading', { name: 'Fila de revisão da carga' })).toBeVisible();

  const marcarRevisado = page.getByRole('button', { name: 'Marcar como revisado' });
  await expect(marcarRevisado).toHaveCount(18);
  for (let index = 17; index >= 0; index--) {
    await marcarRevisado.nth(index).click();
  }
  await page.getByTestId('publish-reviewed').click();
  await expect(page.getByText('Todos os rascunhos desta carga já foram publicados ou descartados.')).toBeVisible();

  // ---------------------------------------------------------------------
  // Segunda carga — 5 células alteradas numa matriz só (CT-02).
  // ---------------------------------------------------------------------
  await page.getByRole('button', { name: 'Projetos' }).click();
  await politicaB2cNav().click();
  await page.getByRole('button', { name: 'Carregar tabela' }).click();
  await page.setInputFiles('input[type="file"]', alteredCsv());

  // RN-19: o cabeçalho é idêntico ao do perfil salvo, então ele é reconhecido
  // e o atalho leva direto ao plano.
  await expect(page.getByText(/Perfil.*reconhecido pelo cabeçalho/)).toBeVisible();
  await page.getByRole('button', { name: 'Ir direto ao plano' }).click();

  await expect(page.getByText('1 alteradas', { exact: true })).toBeVisible();
  await expect(page.getByText('17 inalteradas', { exact: true })).toBeVisible();
  await expect(page.getByText('5 células no total')).toBeVisible();
  await expect(page.getByTestId('plan-selected-count')).toHaveText('1 de 1 selecionadas');

  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByLabel('Nota da carga').fill('Segunda carga: cinco células do canal Digital');
  await expect(page.getByTestId('apply-summary')).toContainText('cria 1 rascunho');
  await page.getByTestId('apply-import').click();
  await expect(page.getByTestId('import-report').getByText('1 rascunhos a revisar')).toBeVisible();

  // Só uma matriz recebeu rascunho — as outras 17 seguem intocadas.
  await page.getByTestId('open-review-queue').click();
  await expect(page.getByRole('button', { name: 'Marcar como revisado' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Marcar como revisado' }).click();
  await page.getByTestId('publish-reviewed').click();
  await expect(page.getByText('Todos os rascunhos desta carga já foram publicados ou descartados.')).toBeVisible();

  // ---------------------------------------------------------------------
  // Terceira carga, do mesmo arquivo alterado — CT-01: nada a aplicar.
  // ---------------------------------------------------------------------
  await page.getByRole('button', { name: 'Projetos' }).click();
  await politicaB2cNav().click();
  await page.getByRole('button', { name: 'Carregar tabela' }).click();
  await page.setInputFiles('input[type="file"]', alteredCsv());
  await page.getByRole('button', { name: 'Ir direto ao plano' }).click();

  await expect(page.getByText('18 inalteradas', { exact: true })).toBeVisible();
  await expect(page.getByText('0 células no total')).toBeVisible();
  await expect(page.getByTestId('plan-selected-count')).toHaveText('0 de 0 selecionadas');
  // "Avançar" desabilitado é o "nenhuma alteração a aplicar" do critério de aceite.
  await expect(page.getByRole('button', { name: 'Avançar' })).toBeDisabled();

  expect(pageErrors).toEqual([]);
});
