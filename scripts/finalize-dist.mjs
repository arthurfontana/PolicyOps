// Renomeia a saída padrão do Vite (dist/index.html) para o artefato final
// dist/PolicyOps.html, conforme docs/02-arquitetura.md §1 e §4.
import { rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const distDir = path.resolve(import.meta.dirname, '..', 'dist');
const source = path.join(distDir, 'index.html');
const target = path.join(distDir, 'PolicyOps.html');

if (!existsSync(source)) {
  console.error(`[finalize-dist] ${source} não existe. O build do Vite falhou?`);
  process.exit(1);
}

if (existsSync(target)) {
  await rm(target);
}

await rename(source, target);
console.log(`[finalize-dist] ${path.relative(process.cwd(), target)} pronto.`);
