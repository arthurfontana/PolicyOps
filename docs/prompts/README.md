# Prompts de Execução

Um arquivo por sessão. Abra uma conversa nova do Claude Code na raiz do repositório, selecione o modelo indicado com `/model`, e cole o conteúdo do arquivo inteiro.

| # | Arquivo | Modelo | Tema |
|---|---|---|---|
| 01 | [S01-scaffold.md](S01-scaffold.md) | `Sonnet` | Vite → arquivo único, shell, tema |
| 02 | [S02-documento.md](S02-documento.md) | `Sonnet` | Schema Zod, validação, exemplo, migração |
| 03 | [S03-eixos-aninhados.md](S03-eixos-aninhados.md) | `Opus` | Tuplas, compatibilidade, cabeçalhos |
| 04 | [S04-store-e-comandos.md](S04-store-e-comandos.md) | `Opus` | Command pattern, undo/redo |
| 05 | [S05-persistencia.md](S05-persistencia.md) | `Opus` | Abrir, salvar, conflito, autosave, lock |
| 06 | [S06-biblioteca-variaveis.md](S06-biblioteca-variaveis.md) | `Sonnet` | Biblioteca de Variáveis |
| 07 | [S07-biblioteca-compatibilidade.md](S07-biblioteca-compatibilidade.md) | `Sonnet` | Biblioteca de Compatibilidade |
| 08 | [S08-biblioteca-conteudo.md](S08-biblioteca-conteudo.md) | `Haiku` | Catálogo de ofertas/decisões/limites |
| 09 | [S09-grid-e-matrizes.md](S09-grid-e-matrizes.md) | `Sonnet` | Projetos, matrizes, grid aninhado |
| 10 | [S10-selecao.md](S10-selecao.md) | `Opus` | Engine de seleção hierárquica |
| 11 | [S11-inspector-e-edicao-massa.md](S11-inspector-e-edicao-massa.md) | `Sonnet` | Inspector e edição em massa |
| 12 | [S12-operacoes-de-nivel.md](S12-operacoes-de-nivel.md) | `Opus` | Adicionar/remover/reordenar nível |
| 13 | [S13-ciclo-de-vida.md](S13-ciclo-de-vida.md) | `Sonnet` | Rascunho, publicação, histórico |
| 14 | [S14-diff-e-comparacao.md](S14-diff-e-comparacao.md) | `Opus` | Diff e tela de comparação |
| 15 | [S15-vigencia-por-data.md](S15-vigencia-por-data.md) | `Sonnet` | Vigência, linha do tempo, portfólio |
| 16 | [S16-reconciliacao.md](S16-reconciliacao.md) | `Opus` | Evolução da biblioteca e resnapshot |
| 17 | [S17-templates-merge-export.md](S17-templates-merge-export.md) | `Opus` | Templates, merge, export, polimento |

## Regras válidas para todas as sessões

Repetidas dentro de cada prompt; ficam aqui como referência.

1. Ler `docs/02-arquitetura.md`, `docs/03-modelo-do-documento.md` e `docs/05-regras-de-negocio.md` antes de escrever código.
2. Não tomar decisões de arquitetura fora do que está documentado — **parar e perguntar**.
3. Não adicionar dependências fora da lista de `docs/02-arquitetura.md` §2 sem perguntar.
4. **`src/core/` é TypeScript puro**: sem React, sem Zustand, sem DOM, sem `window`.
5. **Zero requisições de rede** em tempo de execução. Sem CDN, sem fontes web, sem `eval`.
6. Escopo é escopo: não implementar sessões futuras "já que estou aqui".
7. Terminar com `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, o orçamento de 1 MB respeitado, e **`dist/PolicyOps.html` atualizado no commit**.
8. Commitar na branch de trabalho e fazer push.
