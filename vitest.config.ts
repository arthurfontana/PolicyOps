import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      // Ambiente padrão é 'node': testes de src/core/ rodam sem DOM disponível,
      // o que denuncia qualquer uso acidental de window/document ali (regra
      // arquitetural de docs/02-arquitetura.md §3). Testes de componentes
      // declaram `// @vitest-environment jsdom` no topo do arquivo.
      environment: 'node',
      setupFiles: ['./tests/unit/setup.ts'],
      include: ['tests/unit/**/*.test.{ts,tsx}'],
      css: false,
    },
  }),
);
