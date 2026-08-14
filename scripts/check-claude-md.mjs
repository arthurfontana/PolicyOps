// Guard mecânico (Sessão S31, ADR-006): CLAUDE.md é carregado inteiro em toda
// sessão do Claude Code — falha o build se ele voltar a crescer sem controle.
// Padrão copiado do AppCreditoSimulador (mesma metodologia). Contrato de poda
// e spillover: seção "Documentação em camadas" do próprio CLAUDE.md.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MAX_LINES = 450;
const target = path.resolve(import.meta.dirname, '..', 'CLAUDE.md');

const content = readFileSync(target, 'utf8');
const lineCount = content.split('\n').length;

if (lineCount > MAX_LINES) {
  console.error(
    `[check-claude-md] CLAUDE.md tem ${lineCount} linhas (limite: ${MAX_LINES}).\n` +
      'Antes de adicionar mais conteúdo: pode uma seção que virou "detalhe" para ' +
      'docs/01..14 (normativo) ou docs/claude/ (implementação) e deixe só o ' +
      'ponteiro na tabela "Onde vive o quê". Nunca apague informação para caber.'
  );
  process.exit(1);
}

console.log(`[check-claude-md] CLAUDE.md: ${lineCount}/${MAX_LINES} linhas.`);
