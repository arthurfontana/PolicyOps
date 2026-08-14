// Monta dist/plataforma/ — o pacote que a TI publica na pasta de rede (docs/14-plataforma-local.md
// §2 e §9): iniciar.bat, instalar.bat, PolicyOps.html e server/ (código + requirements.txt +
// wheels/ + LEIAME.txt de instalação). É exatamente o conteúdo de `_app/`.
//
// dist/PolicyOps.html continua sendo gerado por "pnpm build" e commitado como sempre;
// dist/plataforma/ não é commitado (ver .gitignore) — rode "pnpm build:plataforma" para gerar.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const htmlSource = path.join(distDir, 'PolicyOps.html');
const serverDir = path.join(repoRoot, 'server');
const wheelsDir = path.join(serverDir, 'wheels');

const outDir = path.join(distDir, 'plataforma');
const outServerDir = path.join(outDir, 'server');
const outWheelsDir = path.join(outServerDir, 'wheels');

const LEIAME = `Policy Matrix Studio - pacote de instalacao
=============================================

Esta pasta e a aplicacao inteira (a pasta "_app" de docs/11-operacao.md e
docs/14-plataforma-local.md). Publique-a dentro da pasta de rede do time, ao lado de
politicas.json, _backups/ e _evidencias/ (ela nao muda esses dados nem depende deles para
existir).

Como instalar (uma vez, em cada computador que for usar o PolicyOps)
----------------------------------------------------------------------
  1. De dois cliques em instalar.bat e espere terminar.
  2. No final ele mostra um resumo de que dependencias instalou e por qual caminho
     (indice pip online ou as copias locais em server\\wheels).

Como usar no dia a dia
----------------------------------------------------------------------
  De dois cliques em iniciar.bat. Uma janela abre, o navegador abre sozinho na aplicacao
  ja conectada a pasta de rede, e da para editar e salvar direto. Para encerrar, feche essa
  janela (ou Ctrl+C nela).

Se algo der errado
----------------------------------------------------------------------
  - iniciar.bat sem o instalar.bat ter rodado antes: ele avisa e nao faz nada — rode o
    instalar.bat primeiro.
  - Maquina sem Python nenhum: peca para a TI instalar o Python 3.9 ou mais novo e rode o
    instalar.bat de novo.
  - Em qualquer situacao, o arquivo PolicyOps.html continua abrindo sozinho por duplo
    clique, num modo mais limitado (sem salvar direto na pasta de rede) — e sempre
    funciona, mesmo sem Python instalado.

Atualizar esta pasta
----------------------------------------------------------------------
  Substitua o conteudo inteiro desta pasta pela versao nova (gerada de novo por
  "pnpm build:plataforma" no repositorio do projeto). Nunca mexa em politicas.json,
  _backups\\ ou _evidencias\\ — eles vivem fora desta pasta e uma atualizacao daqui nunca
  os toca. Veja docs/11-operacao.md secao 4 para o passo a passo completo.

Preparar este pacote (para quem publica, nao para quem usa)
----------------------------------------------------------------------
  As wheels offline de server\\wheels\\ nao sao geradas por este LEIAME — quem monta o
  pacote roda, no repositorio, numa maquina com internet:

    node scripts/fetch-wheels.mjs
    pnpm build:plataforma

  O primeiro comando baixa as wheels Windows x64 pinadas em server/requirements.txt; o
  segundo monta esta pasta inteira (incluindo as wheels baixadas).
`;

function ensureBuiltHtml() {
  if (!existsSync(htmlSource)) {
    console.error(
      `[build-plataforma] Não encontrei ${path.relative(repoRoot, htmlSource)}. Rode "pnpm build" antes.`
    );
    process.exit(1);
  }
}

function resetOutDir() {
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outServerDir, { recursive: true });
}

function copyAppShell() {
  cpSync(htmlSource, path.join(outDir, 'PolicyOps.html'));
  cpSync(path.join(serverDir, 'iniciar.bat'), path.join(outDir, 'iniciar.bat'));
  cpSync(path.join(serverDir, 'instalar.bat'), path.join(outDir, 'instalar.bat'));
  writeFileSync(path.join(outDir, 'LEIAME.txt'), LEIAME, 'utf-8');
}

function copyServerCode() {
  cpSync(path.join(serverDir, 'policyops_server.py'), path.join(outServerDir, 'policyops_server.py'));
  cpSync(path.join(serverDir, 'launcher.py'), path.join(outServerDir, 'launcher.py'));
  cpSync(path.join(serverDir, 'requirements.txt'), path.join(outServerDir, 'requirements.txt'));
}

function copyWheels() {
  mkdirSync(outWheelsDir, { recursive: true });
  const wheels = existsSync(wheelsDir) ? readdirSync(wheelsDir).filter((f) => f.endsWith('.whl')) : [];
  for (const wheel of wheels) {
    cpSync(path.join(wheelsDir, wheel), path.join(outWheelsDir, wheel));
  }
  if (wheels.length === 0) {
    console.warn(
      '[build-plataforma] server/wheels/ está vazia — o pacote sobe sem contingência offline do ' +
        'pip. Rode "node scripts/fetch-wheels.mjs" antes de publicar de verdade (instalar.bat ' +
        'ainda funciona com o índice pip liberado; só não tem plano B se ele estiver bloqueado).'
    );
  }
  return wheels.length;
}

ensureBuiltHtml();
resetOutDir();
copyAppShell();
copyServerCode();
const wheelCount = copyWheels();

console.log(`[build-plataforma] ${path.relative(repoRoot, outDir)} pronto (${wheelCount} wheel(s)).`);
