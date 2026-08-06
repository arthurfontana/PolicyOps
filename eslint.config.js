import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: 'src/core/ é TypeScript puro — sem DOM/window (docs/02-arquitetura.md §3).',
        },
        {
          name: 'document',
          message: 'src/core/ é TypeScript puro — sem DOM/document (docs/02-arquitetura.md §3).',
        },
      ],
    },
  },
  {
    // Camada de comandos: pureza é critério de aceite (docs/08 §1, regra 1).
    // Hora e ids entram por `ctx`, e só por ele — o que torna os testes
    // determinísticos e o undo/redo reprodutível.
    files: [
      'src/core/command.ts',
      'src/core/queries.ts',
      'src/core/versioning/**/*.ts',
      'src/core/document/commands.ts',
    ],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'Comando é puro: a hora vem de `ctx.now()` (docs/08 §1).',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'Comando é puro: ids vêm de `ctx.newId()` (docs/08 §1).',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: '`new Date()` sem argumento é impuro — use `ctx.now()` (docs/08 §1).',
        },
        {
          selector: "CallExpression[callee.name='nanoid']",
          message: 'Gerar id direto é impuro — use `ctx.newId()` (docs/08 §1).',
        },
      ],
    },
  },
  {
    files: ['*.config.{js,ts}', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  prettierConfig,
);
