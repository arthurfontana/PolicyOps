import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Bundle único de produção, sem redistribuição em separado — os banners de
  // licença das dependências (`@license`) não precisam sobreviver à
  // minificação para caber no orçamento de 1 MB (docs/02 §2).
  esbuild: {
    legalComments: 'none',
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    // Baseline real do produto (docs/02 §7): Chromium 110+, Firefox e Safari
    // 16.4+. Alvo explícito evita downleveling/polyfill que esses navegadores
    // não precisam — o interpretador já entende a sintaxe nativa.
    target: ['chrome110', 'firefox115', 'safari16'],
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
