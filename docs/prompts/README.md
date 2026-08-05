# Prompts de Execução

Um arquivo por sessão. Abra uma sessão nova do Claude Code na raiz do repositório, selecione o modelo indicado com `/model`, e cole o conteúdo do arquivo inteiro.

| # | Arquivo | Modelo | Tema |
|---|---------|--------|------|
| 01 | [S01-scaffold.md](S01-scaffold.md) | `Sonnet` | Scaffold, auth, CI |
| 02 | [S02-schema-e-seed.md](S02-schema-e-seed.md) | `Sonnet` | Prisma, migrations, seed |
| 03 | [S03-dominio-versionamento.md](S03-dominio-versionamento.md) | `Opus` | Services de versão e snapshot |
| 04 | [S04-biblioteca-variaveis.md](S04-biblioteca-variaveis.md) | `Sonnet` | Biblioteca de Variáveis |
| 05 | [S05-biblioteca-conteudo.md](S05-biblioteca-conteudo.md) | `Haiku` | Catálogo de ofertas/decisões/limites |
| 06 | [S06-projetos-e-matrizes.md](S06-projetos-e-matrizes.md) | `Sonnet` | Projetos, criação de matriz, grid read-only |
| 07 | [S07-grid-e-selecao.md](S07-grid-e-selecao.md) | `Opus` | Grid do editor e engine de seleção |
| 08 | [S08-inspector-e-edicao-massa.md](S08-inspector-e-edicao-massa.md) | `Opus` | Inspector, edição em massa, undo/redo |
| 09 | [S09-fluxo-de-versionamento.md](S09-fluxo-de-versionamento.md) | `Sonnet` | Rascunho, publicação, histórico |
| 10 | [S10-diff-e-comparacao.md](S10-diff-e-comparacao.md) | `Opus` | Diff engine e tela de comparação |
| 11 | [S11-vigencia-por-data.md](S11-vigencia-por-data.md) | `Sonnet` | Consulta vigente em qualquer data |
| 12 | [S12-reconciliacao-variaveis.md](S12-reconciliacao-variaveis.md) | `Opus` | Evolução de variáveis e resnapshot |
| 13 | [S13-templates.md](S13-templates.md) | `Sonnet` | Templates e seed rules |
| 14 | [S14-export-e-polimento.md](S14-export-e-polimento.md) | `Haiku` | Export, acabamento, E2E |

## Regras válidas para todas as sessões

Estas regras estão repetidas dentro de cada prompt; ficam aqui como referência.

1. Ler `docs/02-especificacao-tecnica.md`, `docs/03-modelo-de-dados.md` e `docs/04-regras-de-negocio.md` antes de escrever código.
2. Não tomar decisões de arquitetura não cobertas pela documentação — **parar e perguntar**.
3. Não adicionar dependências fora da lista da especificação sem perguntar.
4. Regra de negócio vive em `src/server/services/`. Nunca em componente React, nunca em Server Action.
5. Escopo é escopo: não implementar sessões futuras "já que estou aqui".
6. Terminar com `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes.
7. Commitar na branch de trabalho com mensagem descritiva e fazer push.
