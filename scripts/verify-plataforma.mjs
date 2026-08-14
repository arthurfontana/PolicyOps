// Confere que dist/plataforma/ (gerado por "pnpm build:plataforma") está completo e publicável:
// todos os arquivos esperados existem, as wheels offline foram baixadas, e nenhum arquivo do
// pacote referencia um caminho absoluto da máquina que fez o build — docs/14-plataforma-local.md
// §2 e §9 (a pasta tem que funcionar do jeito que chega em qualquer máquina do time).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const outDir = path.join(repoRoot, 'dist', 'plataforma');

const REQUIRED_FILES = [
  'iniciar.bat',
  'instalar.bat',
  'PolicyOps.html',
  'LEIAME.txt',
  path.join('server', 'policyops_server.py'),
  path.join('server', 'launcher.py'),
  path.join('server', 'requirements.txt'),
];

const problems = [];

if (!existsSync(outDir)) {
  console.error(
    `[verify-plataforma] Não encontrei ${path.relative(repoRoot, outDir)}. Rode "pnpm build:plataforma" antes.`
  );
  process.exit(1);
}

for (const relPath of REQUIRED_FILES) {
  const full = path.join(outDir, relPath);
  if (!existsSync(full) || !statSync(full).isFile()) {
    problems.push(`arquivo esperado não existe: ${relPath}`);
  }
}

const wheelsDir = path.join(outDir, 'server', 'wheels');
const wheels = existsSync(wheelsDir) ? readdirSync(wheelsDir).filter((f) => f.endsWith('.whl')) : [];
if (wheels.length === 0) {
  problems.push(
    'server/wheels/ está vazia — sem contingência offline do pip. Rode "node scripts/fetch-wheels.mjs" ' +
      'antes de publicar.'
  );
}

// Nenhum arquivo de texto do pacote pode citar um caminho absoluto desta máquina de build —
// isso vazaria a estrutura de pastas de quem gerou o pacote e, em Windows, um caminho como
// "C:\Users\alguem\..." não existiria na máquina de quem instala.
const TEXT_EXTENSIONS = new Set(['.bat', '.py', '.txt']);
const SUSPECT_PATTERNS = [
  new RegExp(escapeRegExp(repoRoot), 'i'),
  /\/home\/[^/\s"']+/i,
  /\/root\/[^/\s"']*/i,
  /[A-Za-z]:\\Users\\[^\s"']+/i,
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, visit);
    } else {
      visit(full);
    }
  }
}

walk(outDir, (filePath) => {
  if (!TEXT_EXTENSIONS.has(path.extname(filePath))) return;
  const content = readFileSync(filePath, 'latin1');
  for (const pattern of SUSPECT_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      problems.push(
        `${path.relative(outDir, filePath)} referencia um caminho da máquina de build: "${match[0]}"`
      );
      break;
    }
  }
});

if (problems.length > 0) {
  console.error('[verify-plataforma] Pacote incompleto ou com problema:');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log(`[verify-plataforma] ${path.relative(repoRoot, outDir)}: ${wheels.length} wheel(s), OK.`);
