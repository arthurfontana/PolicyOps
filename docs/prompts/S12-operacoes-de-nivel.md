# Sessão 12 — Operações de nível nos eixos

**Modelo: `Opus`** · **Depende de:** S11

---

> **Por que Opus:** adicionar ou remover um nível reescreve a estrutura de um grid inteiro, criando e destruindo células em massa. Feito errado, apaga trabalho do usuário em silêncio. É a operação mais destrutiva que a ferramenta oferece, e precisa de preview, inverso completo e auditoria reconstruível.

## Prompt

> Você está implementando a Sessão 12 do Policy Matrix Studio — as operações de nível.
>
> **Leia antes de começar:** `docs/04-eixos-aninhados.md` §5 por inteiro (as três operações, com suas políticas de conteúdo), `docs/07-ux-e-editor.md` §7 e §8, e `docs/08-camada-de-comandos.md` §3 (comandos de eixo). As funções puras `addLevel`, `removeLevel` e `reorderLevels` **já existem desde a S03** — esta sessão as embrulha em comandos e constrói a interface.
>
> ### O caso de uso
> Uma matriz PJ nasce como `Segmento × Score`. Meses depois, o time precisa detalhar por faixa de faturamento dentro de cada segmento. Isso é adicionar um nível — e as 18 células existentes precisam virar 48 sem que ninguém refaça o trabalho.
>
> ### Objetivo
> Adicionar, remover, reordenar e suprimir, sempre com preview antes e desfazer depois.
>
> ### Escopo
>
> #### 1. Comandos — `src/core/versioning/axis-commands.ts`
> Os seis comandos de `docs/08-camada-de-comandos.md` §3, seção Eixos:
> `axis/addLevel`, `axis/removeLevel`, `axis/reorderLevels`, `axis/suppressTuples`, `axis/restoreTuples` (`axis/resnapshot` fica para a S16).
>
> Todos:
> - chamam `assertEditable` **primeiro**, sempre — só rodam em `DRAFT`;
> - guardam no `inverse` **todas** as células afetadas, para que desfazer restaure integralmente;
> - gravam no payload do evento o conteúdo descartado, **íntegro**, de forma que seja reconstruível manualmente a partir da auditoria;
> - revalidam I16 (teto de 6.000) depois da operação.
>
> Políticas, conforme §5:
> - `addLevel`: `REPLICATE` (padrão) copia o conteúdo da célula para todas as descendentes; `CLEAR` deixa as novas vazias.
> - `removeLevel`: `KEEP_IF_UNANIMOUS` (padrão) preserva quando todas as células do grupo são idênticas e **esvazia** quando divergem; `KEEP_FIRST` toma a primeira na ordem do grid. O padrão é o conservador porque perder informação em silêncio é o pior desfecho.
> - `reorderLevels`: remapeia as chaves permutando os códigos. Como a compatibilidade é direcional, o conjunto de tuplas **pode** mudar — nesse caso a operação reporta o delta e a interface exige confirmação.
> - Remover o único nível de um eixo falha com `AXIS_NEEDS_ONE_LEVEL`.
>
> #### 2. Interface — construtor de eixos no inspector
> O `axis-builder` da S09 passa a ser editável em rascunhos. Toda alteração abre um **diálogo de preview** antes de aplicar:
>
> **Adicionar nível**
> - escolha da variável e da profundidade (mais externo / mais interno / entre dois);
> - preview: *"20 combinações viram 60. 240 células viram 720."*;
> - escolha de `REPLICATE` / `CLEAR`, com explicação em português do efeito de cada uma e indicação de qual é a recomendada;
> - se `CLEAR`, avisar que o rascunho ficará bloqueado para publicação até as novas serem preenchidas.
>
> **Remover nível**
> - preview: *"60 combinações viram 20. 40 células serão descartadas."*;
> - escolha de política, com a contagem de grupos divergentes destacada: *"12 grupos têm conteúdo divergente e ficarão vazios"*;
> - confirmação exigindo digitar o nome da variável quando houver descarte.
>
> **Reordenar**
> - se o conjunto de tuplas não mudar: aplica direto, avisando que só a ordem visual muda;
> - se mudar: preview com as tuplas que entram e saem, e confirmação.
>
> Em todos: preview visual do grid resultante (miniatura), com as novas combinações hachuradas e as que saem riscadas em vermelho.
>
> #### 3. Supressão manual — `docs/07-ux-e-editor.md` §8
> Com combinações selecionadas, ação "Marcar como inexistente": somem do grid, deixam de contar como pendentes, e aparecem numa lista "3 combinações suprimidas" com botão de restaurar. Aviso sugerindo criar uma regra de compatibilidade na biblioteca se o padrão se repetir.
>
> #### 4. Após aplicar
> Toast com resumo; seleção automática das combinações novas; barra de pendências apontando quantas precisam ser preenchidas.
>
> ### Testes
> - `addLevel` com `REPLICATE`: conteúdo preservado em **todas** as descendentes — compare o mapa de células inteiro, não a contagem.
> - `addLevel` com `CLEAR`: novas ficam pendentes e a publicação passa a falhar com `UNSET_CELLS_REMAIN`.
> - `addLevel` na posição 0 (mais externo) e na última — ambos corretos, com a ordem de tuplas certa.
> - `addLevel` com regra de compatibilidade ativa gera menos combinações que o cartesiano — verifique o número exato.
> - `removeLevel` com `KEEP_IF_UNANIMOUS`: grupo unânime preserva, grupo divergente esvazia.
> - `removeLevel` com `KEEP_FIRST`: vence a primeira na ordem do grid.
> - Conteúdo descartado aparece **íntegro** no payload do evento.
> - `reorderLevels` sem mudança de conjunto preserva **todas** as células — compare o mapa inteiro.
> - `reorderLevels` com mudança de conjunto reporta o delta corretamente.
> - **Inverso de cada operação restaura o documento deep-equal ao original** — inclusive `addLevel`, `removeLevel` e supressão. Este é o teste que impede perda de trabalho.
> - Todas as operações falham com `VERSION_IMMUTABLE` em versão publicada.
> - Ultrapassar 6.000 combinações falha com `GRID_TOO_LARGE` e não altera nada.
> - E2E: abrir matriz PJ v1 → criar rascunho → adicionar nível `TEMPO_EMPRESA` no eixo X com `REPLICATE` → grid cresce de 48 para 192 células, todas preenchidas → desfazer → volta a 48 idêntico.
>
> ### Critérios de aceite
> - O cenário do E2E funciona ponta a ponta no navegador.
> - Nenhuma operação de nível é aplicada sem preview.
> - Desfazer restaura integralmente, incluindo remoção de nível.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes, tamanho no orçamento.
>
> ### Fora do escopo
> Reconciliação com a biblioteca (S16). Publicação (S13).
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push.
