# Sessão 44 — Fluxo do dia a dia: teclado, pendências e densidade

**Modelo:** `Sonnet` · **Depende de:** S41, S42, S43 · **Épico/Marco:** Experiência (M13)

> **Por que Sonnet:** polimento de interação sobre um layout já fechado nas três sessões
> anteriores — nenhum comando novo, nenhuma regra de negócio, nenhum schema. O risco é ergonômico,
> não de corrupção, e cada item tem critério de aceite binário.

## Prompt

> Você está implementando a Sessão 44 do PolicyOps — o acabamento do novo layout para quem usa a
> ferramenta o dia inteiro.
>
> **Leia antes de começar:** `docs/07-ux-e-editor.md` §2.1 (barra e atalhos), §12 (estados vazios e
> ajuda), §17.1/§17.3 (árvore e cadastro em volume), §17.5 (página do componente) e §21 (US-UX-03).
>
> ### Estado atual
> A árvore é a barra lateral (S41), o componente é uma página no centro (S42) e a consulta
> histórica é a tela de Vigência (S43). O que falta é o que faz diferença em quem cadastra ou
> revisa dezenas de itens por dia: percorrer a árvore sem mouse, achar o que está pendente e não
> carregar texto redundante na tela.
>
> ### Objetivo
> Cadastrar, revisar e publicar em volume sem tirar as mãos do teclado.
>
> ### Escopo
> 1. **Navegação por teclado na árvore**: `↑`/`↓` entre nós visíveis, `→`/`←` expandir/recolher (e
>    saltar para o pai quando já recolhido), `Home`/`End`, digitação rápida salta para o nó cujo
>    nome começa pelas letras digitadas. Foco visível com `roving tabindex`, papéis ARIA
>    (`tree`/`treeitem`/`aria-level`/`aria-expanded`) corretos. `Enter`, `F2`, `Ctrl+D` e `Delete`
>    (arquivar, com confirmação) continuam valendo sobre o nó em foco.
> 2. **Pendências**: contador na barra de ferramentas (`n pendentes`) somando componentes com
>    rascunho aberto ou `reviewStatus = PENDING_REVIEW`, e **"Ir para o próximo pendente"**
>    (`Ctrl+Shift+N`) que seleciona o próximo na ordem da árvore, expandindo o que precisar.
>    Clicar no contador abre o diálogo de "Publicar pendentes" já existente.
> 3. **Densidade**: retire o texto redundante da página do componente e da árvore (contagens que
>    repetem o que a própria lista mostra, o aviso "0 itens filhos", o rodapé fixo de ordem de
>    leitura — que virou `title`/ajuda na S41), e revise os estados vazios de §12 para as telas
>    novas: projeto sem componentes, filtro sem resultado, consulta histórica sem nada na data.
> 4. **Diálogo de atalhos** (§12): passa a listar a barra de ferramentas, a navegação da árvore, a
>    página do componente (`Alt+↑`/`Alt+↓`) e as pendências — agrupado por região da tela.
> 5. **E2E de volume**: criar cinco regras irmãs só pelo teclado, preencher a descrição de negócio
>    de cada uma, publicar as cinco pelo diálogo de pendentes, e conferir a árvore ao final.
>
> ### Testes
> Unitários da navegação (bordas: primeiro/último nó visível, `←` no nó raiz recolhido, digitação
> rápida sem correspondência) e do "próximo pendente" (nenhum pendente → ação desabilitada; último
> pendente → volta ao primeiro, sem laço infinito). E2E do item 5 e do diálogo de atalhos.
> Acessibilidade: a árvore navegável só por teclado, com `aria-level` correto em 4 níveis.
>
> ### Critérios de aceite
> - Criar e nomear cinco regras irmãs sem tocar no mouse, e publicá-las em lote.
> - `Ctrl+Shift+N` percorre todos os pendentes do projeto e para quando não há mais nenhum.
> - Nenhuma tela nova sem estado vazio próprio.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes e
>   `dist/PolicyOps.html` atualizado no commit.
>
> ### Fora do escopo
> Paleta de comandos `Ctrl+K` (avaliar depois do uso real das S41–S44), migrar as demais telas para
> a barra de ferramentas, e qualquer mudança de regra de negócio.
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/07-ux-e-editor.md` §12/§17.1/§21, `docs/10-guia-do-usuario.md` (atalhos e o
> fluxo de cadastro em volume), a linha da S44 em `docs/09-roadmap-de-entregas.md` e
> `docs/prompts/README.md`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → **pare e pergunte**.
> Sem dependência nova.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
