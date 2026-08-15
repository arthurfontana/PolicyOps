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
      coverage: {
        provider: 'v8',
        include: ['src/core/**/*.ts'],
        reporter: ['text', 'text-summary'],
        // docs/02-arquitetura.md §9: 85% em src/core/, 100% em axes/.
        thresholds: {
          lines: 85,
          branches: 85,
          functions: 85,
          statements: 85,
          'src/core/versioning/**/*.ts': {
            lines: 100,
            branches: 100,
            functions: 100,
            statements: 100,
          },
          'src/core/axes/**/*.ts': {
            lines: 100,
            branches: 100,
            functions: 100,
            statements: 100,
          },
          // docs/12-carga-de-matrizes.md §5: o motor da carga compara 40.000
          // células, e um falso negativo apaga a evidência de que a política
          // mudou — mesma exigência de axes/ e versioning/.
          'src/core/import/**/*.ts': {
            lines: 100,
            branches: 100,
            functions: 100,
            statements: 100,
          },
          // Governança de alterações (S32b): o grafo de estados, o
          // congelamento dos itens e a composição de release decidem o que
          // pode ser publicado — um ramo não exercitado aqui é uma transição
          // que ninguém testou (docs/14 §5, RN-GOV-01).
          'src/core/document/cr-workflow.ts': {
            lines: 100,
            branches: 100,
            functions: 100,
            statements: 100,
          },
          'src/core/document/change-requests.ts': {
            lines: 100,
            branches: 100,
            functions: 100,
            statements: 100,
          },
          'src/core/document/releases.ts': {
            lines: 100,
            branches: 100,
            functions: 100,
            statements: 100,
          },
        },
      },
    },
  }),
);
