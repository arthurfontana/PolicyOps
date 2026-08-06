// Garante que dist/PolicyOps.html não tem nenhuma referência de rede em
// tempo de execução (docs/02-arquitetura.md §2, item 4 do prompt da S01).
//
// Nota sobre o allowlist abaixo: builds de produção do React 19 embutem, no
// próprio JS, (1) URIs de namespace XML/SVG/MathML usados em chamadas de
// createElementNS/setAttributeNS (ex.: "http://www.w3.org/2000/svg") e
// (2) o link do decodificador de erros do React ("https://react.dev/errors/NNN"),
// que só aparece dentro do texto de uma mensagem de erro minificada. O
// Tailwind CSS v4 embute de forma semelhante um comentário de licença fixo
// ("/*! tailwindcss ... | https://tailwindcss.com */") no topo do CSS gerado.
// Nenhuma dessas três famílias de string é buscada pela página — são apenas
// texto. Um scan ingênuo por "http://"/"https://" reprovaria qualquer build
// de produção com a stack decidida em docs/02, então essas três, e só elas,
// são explicitamente permitidas. Qualquer outra ocorrência de http(s)://
// reprova o build.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const target = path.resolve(import.meta.dirname, '..', 'dist', 'PolicyOps.html');

let html;
try {
  html = readFileSync(target, 'utf-8');
} catch {
  console.error(`[check-selfcontained] Não encontrei ${target}. Rode "pnpm build" antes.`);
  process.exit(1);
}

const violations = [];

const TAG_PATTERNS = [
  { name: '<script src=', regex: /<script\b[^>]*\ssrc\s*=/i },
  {
    name: '<link rel="stylesheet" href=',
    regex: /<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*\bhref\s*=/i,
  },
  { name: '@import url(', regex: /@import\s+url\(/i },
  { name: 'eval(', regex: /\beval\s*\(/ },
  { name: 'new Function(', regex: /\bnew\s+Function\s*\(/ },
];

for (const { name, regex } of TAG_PATTERNS) {
  const match = html.match(regex);
  if (match) {
    violations.push(`padrão proibido "${name}" encontrado: ...${match[0].slice(0, 80)}...`);
  }
}

const INERT_URL_PREFIXES = ['http://www.w3.org/', 'https://react.dev/errors/', 'https://tailwindcss.com'];

const urlMatches = html.matchAll(/https?:\/\/[^\s"'()<>]+/g);
const offendingUrls = new Set();
for (const [url] of urlMatches) {
  const isInert = INERT_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
  if (!isInert) {
    offendingUrls.add(url);
  }
}

for (const url of offendingUrls) {
  violations.push(`referência externa encontrada: ${url}`);
}

if (violations.length > 0) {
  console.error('[check-selfcontained] Falhou — o HTML não é autocontido:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log('[check-selfcontained] Nenhuma referência externa encontrada. OK.');
