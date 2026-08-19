import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sessão 41 — a árvore da política é a barra lateral e as ações de tela vivem
 * na barra de ferramentas (docs/07-ux-e-editor.md §2, §2.1, §17.1; DEC-UX-001,
 * DEC-UX-003, DEC-UX-005). Cobre CT-UX-01, CT-UX-03 e CT-UX-05 do §21.
 */
const DIST_PATH = path.resolve(import.meta.dirname, '..', '..', 'dist', 'PolicyOps.html');
const FILE_URL = pathToFileURL(DIST_PATH).href;

test.beforeAll(() => {
  if (!existsSync(DIST_PATH)) {
    throw new Error(`dist/PolicyOps.html não existe em ${DIST_PATH}. Rode "pnpm build" antes do E2E.`);
  }
});

async function abrirProjetoDeExemplo(page: import('@playwright/test').Page, nome: string) {
  await page.goto(FILE_URL);
  await page.getByLabel('Nome').fill(nome);
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Exemplo' }).click();

  await page.getByRole('button', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: /Política PJ/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Política PJ' })).toBeVisible();
}

/** Cria um nó de estrutura pela barra de ferramentas, no alvo corrente. */
async function novaSecao(page: import('@playwright/test').Page, nome: string) {
  await page.getByRole('button', { name: 'Nova seção' }).click();
  await page.getByLabel('Nome do novo componente').fill(nome);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); // descarta a caixa encadeada
}

test('CT-UX-01: o projeto aberto mostra uma árvore só, na barra lateral, com todos os níveis', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await abrirProjetoDeExemplo(page, 'Teste E2E Navegação');

  // --- 4 níveis: cada um nasce filho do anterior, com Tab antes de gravar ---
  await novaSecao(page, 'Nível 1');
  for (const nome of ['Nível 2', 'Nível 3', 'Nível 4']) {
    await page.getByTestId(`tree-node-NIVEL_${Number(nome.slice(-1)) - 1}`).click();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.getByLabel('Nome do novo componente').fill(nome);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
  }

  // A árvore está dentro da navegação, e é a única da tela.
  const navegacao = page.getByRole('navigation', { name: 'Navegação principal' });
  await expect(navegacao.getByTestId('policy-tree')).toBeVisible();
  await expect(page.getByTestId('policy-tree')).toHaveCount(1);
  await expect(page.getByRole('tree', { name: 'Árvore da política' })).toHaveCount(1);

  // Todos os níveis, expansíveis: recolher tudo esconde do nível 2 para baixo.
  for (const code of ['NIVEL_1', 'NIVEL_2', 'NIVEL_3', 'NIVEL_4']) {
    await expect(page.getByTestId(`tree-node-${code}`)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Recolher tudo' }).click();
  await expect(page.getByTestId('tree-node-NIVEL_1')).toBeVisible();
  await expect(page.getByTestId('tree-node-NIVEL_2')).toHaveCount(0);

  await page.getByRole('button', { name: 'Expandir tudo' }).click();
  await expect(page.getByTestId('tree-node-NIVEL_4')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('CT-UX-03: Enter num nó cria irmão em edição, e o chip de alvo acompanha a seleção', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await abrirProjetoDeExemplo(page, 'Teste E2E Alvo');

  const alvo = page.getByTestId('policy-toolbar-target');
  await expect(alvo).toHaveText('em: raiz da política');

  await novaSecao(page, 'CMA');
  const cma = page.getByTestId('tree-node-CMA');
  await cma.click();
  await expect(alvo).toHaveText('em: CMA');

  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Nome do novo componente')).toBeVisible();
  await page.getByLabel('Nome do novo componente').fill('Fraude');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  // Irmão de CMA, na raiz — a mesma semântica que o botão da barra usa.
  const fraude = page.getByTestId('tree-node-FRAUDE');
  await expect(fraude).toBeVisible();
  await fraude.click();
  await expect(alvo).toHaveText('em: Fraude');

  // Busca e filtro vivem na barra: filtrar mantém o ancestral visível.
  await cma.click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.getByLabel('Nome do novo componente').fill('Bloqueios');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  await page.getByLabel('Buscar na árvore').fill('Bloqueios');
  await expect(page.getByTestId('tree-node-BLOQUEIOS')).toBeVisible();
  await expect(page.getByTestId('tree-node-CMA')).toBeVisible(); // ancestral, esmaecido
  await expect(page.getByTestId('tree-node-FRAUDE')).toHaveCount(0);
  await page.getByLabel('Buscar na árvore').fill('');

  expect(pageErrors).toEqual([]);
});

test('CT-UX-05: a largura da navegação é arrastável, respeita os limites e sobrevive ao reload', async ({
  page,
}) => {
  await abrirProjetoDeExemplo(page, 'Teste E2E Largura');

  const navegacao = page.getByRole('navigation', { name: 'Navegação principal' });
  const alca = page.getByTestId('sidebar-resize-handle');

  expect((await navegacao.boundingBox())!.width).toBe(288);

  // Arrastar a borda até ~420px.
  const box = (await alca.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 132, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  expect((await navegacao.boundingBox())!.width).toBe(420);

  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
  expect((await page.getByRole('navigation', { name: 'Navegação principal' }).boundingBox())!.width).toBe(420);

  // Arrastar muito além do máximo para em 480; muito aquém do mínimo, em 248.
  const alcaDepois = page.getByTestId('sidebar-resize-handle');
  const box2 = (await alcaDepois.boundingBox())!;
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width / 2 + 400, box2.y + box2.height / 2, { steps: 8 });
  await page.mouse.up();
  expect((await page.getByRole('navigation', { name: 'Navegação principal' }).boundingBox())!.width).toBe(480);

  const box3 = (await page.getByTestId('sidebar-resize-handle').boundingBox())!;
  await page.mouse.move(box3.x + box3.width / 2, box3.y + box3.height / 2);
  await page.mouse.down();
  await page.mouse.move(box3.x + box3.width / 2 - 500, box3.y + box3.height / 2, { steps: 8 });
  await page.mouse.up();
  expect((await page.getByRole('navigation', { name: 'Navegação principal' }).boundingBox())!.width).toBe(248);

  // Duplo clique na alça volta ao padrão; as setas movem 16px com foco nela.
  await page.getByTestId('sidebar-resize-handle').dblclick();
  expect((await page.getByRole('navigation', { name: 'Navegação principal' }).boundingBox())!.width).toBe(288);

  await page.getByTestId('sidebar-resize-handle').focus();
  await page.keyboard.press('ArrowRight');
  expect((await page.getByRole('navigation', { name: 'Navegação principal' }).boundingBox())!.width).toBe(304);
  await page.keyboard.press('ArrowLeft');
  expect((await page.getByRole('navigation', { name: 'Navegação principal' }).boundingBox())!.width).toBe(288);
});
