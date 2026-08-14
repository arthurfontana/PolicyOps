// Baixa as wheels Windows x64 das dependências do servidor local + transitivas, para
// server/wheels/ — a contingência offline do instalar.bat quando o índice pip corporativo
// está bloqueado (docs/14-plataforma-local.md §9, ADR-005).
//
// As wheels NÃO são commitadas (tamanho) — rode este script antes de publicar o pacote
// (`pnpm build:plataforma`) numa máquina com acesso à internet, e ele deixa tudo pronto em
// server/wheels/. server/requirements.txt é a lista fechada e pinada por versão (ADR-005);
// este script só resolve e baixa, nunca decide o que instalar.
//
// Uso: node scripts/fetch-wheels.mjs [--python-versions 3.9,3.10,3.11,3.12,3.13]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const requirementsPath = path.join(repoRoot, 'server', 'requirements.txt');
const wheelsDir = path.join(repoRoot, 'server', 'wheels');

// Python é bem versionado no parque corporativo — pydantic-core (dependência transitiva de
// fastapi via pydantic) publica uma wheel binária por versão menor de Python, então uma única
// chamada de "pip download" não cobre todo mundo. Cobrir esta faixa é a única forma de garantir
// que instalar.bat funcione com pip bloqueado em qualquer uma dessas versões. Ajuste conforme o
// parque evoluir.
const DEFAULT_PYTHON_VERSIONS = ['3.9', '3.10', '3.11', '3.12', '3.13'];
const PLATFORM = 'win_amd64';

function parsePythonVersionsArg(argv) {
  const flagIndex = argv.indexOf('--python-versions');
  if (flagIndex === -1) return DEFAULT_PYTHON_VERSIONS;
  const raw = argv[flagIndex + 1];
  if (!raw) {
    console.error('[fetch-wheels] --python-versions precisa de uma lista, ex.: 3.9,3.10');
    process.exit(1);
  }
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
}

function readRequirements() {
  const raw = readFileSync(requirementsPath, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function findPip() {
  for (const candidate of [['python3'], ['python'], ['py', '-3']]) {
    const probe = spawnSync(candidate[0], [...candidate.slice(1), '-m', 'pip', '--version'], {
      stdio: 'ignore',
    });
    if (probe.status === 0) return candidate;
  }
  return null;
}

function main() {
  const pythonVersions = parsePythonVersionsArg(process.argv.slice(2));
  const requirements = readRequirements();

  if (requirements.length === 0) {
    console.error(`[fetch-wheels] ${requirementsPath} não tem nenhuma dependência para baixar.`);
    process.exit(1);
  }

  const pip = findPip();
  if (!pip) {
    console.error(
      '[fetch-wheels] Não encontrei um Python com pip nesta máquina (tentei python3, python, py -3). ' +
        'Instale Python para rodar este script — ele só é necessário para preparar o pacote, não para ' +
        'quem usa o PolicyOps.'
    );
    process.exit(1);
  }

  mkdirSync(wheelsDir, { recursive: true });

  console.log(`[fetch-wheels] Dependências: ${requirements.join(', ')}`);
  console.log(`[fetch-wheels] Versões de Python: ${pythonVersions.join(', ')}`);
  console.log(`[fetch-wheels] Destino: ${path.relative(repoRoot, wheelsDir)}`);
  console.log('');

  let algumaVersaoFuncionou = false;

  for (const pythonVersion of pythonVersions) {
    const abi = 'cp' + pythonVersion.replace('.', '');
    const args = [
      ...pip.slice(1),
      '-m',
      'pip',
      'download',
      ...requirements,
      '--dest',
      wheelsDir,
      '--platform',
      PLATFORM,
      '--python-version',
      pythonVersion,
      '--implementation',
      'cp',
      '--abi',
      abi,
      '--only-binary=:all:',
    ];
    console.log(`[fetch-wheels] Python ${pythonVersion} (${abi})...`);
    const result = spawnSync(pip[0], args, { stdio: 'inherit' });
    if (result.status === 0) {
      algumaVersaoFuncionou = true;
    } else {
      console.warn(
        `[fetch-wheels] Falhou para Python ${pythonVersion} — seguindo para as próximas versões.`
      );
    }
    console.log('');
  }

  if (!algumaVersaoFuncionou) {
    console.error(
      '[fetch-wheels] Não consegui baixar as wheels para nenhuma versão de Python. Confira a ' +
        'conexão com a internet e tente de novo.'
    );
    process.exit(1);
  }

  const arquivos = readdirSync(wheelsDir).filter((f) => f.endsWith('.whl'));
  console.log(`[fetch-wheels] Pronto: ${arquivos.length} wheel(s) em ${path.relative(repoRoot, wheelsDir)}.`);
}

if (!existsSync(requirementsPath)) {
  console.error(`[fetch-wheels] Não encontrei ${requirementsPath}.`);
  process.exit(1);
}

main();
