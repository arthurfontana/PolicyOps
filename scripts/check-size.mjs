// Falha se dist/PolicyOps.html ultrapassar o orçamento de 1,5 MB
// (docs/02-arquitetura.md §2, "Restrições absolutas do bundle").
import { statSync } from 'node:fs';
import path from 'node:path';

const BUDGET_BYTES = 1.5 * 1024 * 1024;
const target = path.resolve(import.meta.dirname, '..', 'dist', 'PolicyOps.html');

let size;
try {
  size = statSync(target).size;
} catch {
  console.error(`[check-size] Não encontrei ${target}. Rode "pnpm build" antes.`);
  process.exit(1);
}

const kb = (size / 1024).toFixed(1);
const budgetKb = (BUDGET_BYTES / 1024).toFixed(0);

if (size > BUDGET_BYTES) {
  console.error(`[check-size] dist/PolicyOps.html tem ${kb} KB, acima do orçamento de ${budgetKb} KB.`);
  process.exit(1);
}

console.log(`[check-size] dist/PolicyOps.html: ${kb} KB (orçamento: ${budgetKb} KB). OK.`);
