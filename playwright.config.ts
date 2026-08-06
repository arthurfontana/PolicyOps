import { defineConfig } from '@playwright/test';

/**
 * O E2E abre dist/PolicyOps.html por file:// — é o cenário real de uso (o
 * arquivo publicado numa biblioteca do SharePoint, aberto por duplo clique).
 * Sem webServer: não há servidor nenhum a rodar.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    // Sem executablePath fixo: o Chromium é resolvido pelo Playwright a
    // partir de PLAYWRIGHT_BROWSERS_PATH (já configurado neste ambiente) ou,
    // no CI, do Chromium instalado por "playwright install --with-deps".
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
});
