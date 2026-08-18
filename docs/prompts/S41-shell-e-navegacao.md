# Sessão 41 — Shell: barra de ferramentas contextual e a árvore na barra lateral

**Modelo:** `Opus` · **Depende de:** S33b, S40 · **Épico/Marco:** Experiência (M13)

> **Por que Opus:** não é tela nova — é mover comportamento já testado (criação por teclado com
> `Enter`/`Tab`, drag-and-drop com três posições de soltura, filtro que preserva ancestrais,
> renomear em linha) de um painel de 935 linhas para outra região do shell **sem perder nenhum
> caso**. O modo de falha é regressão silenciosa em interação, que teste superficial não pega, e o
> arquivo tocado é dos maiores do front.

## Prompt

> Você está implementando a Sessão 41 do PolicyOps — a reforma de navegação: a árvore da política
> passa a ser a barra lateral, e as ações de tela passam a viver numa barra de ferramentas
> contextual.
>
> **Leia antes de começar:** `docs/07-ux-e-editor.md` §2 (shell), §2.1 (barra de ferramentas),
> §17.1 (onde a árvore vive), §17.3–§17.4 e §17.6 (ações que migram) e §21 (US-UX/CT-UX);
> DEC-UX-001, DEC-UX-003 e DEC-UX-005 em `docs/13-decisoes.md`. Código: `src/components/shell/`
> (`Shell.tsx`, `Sidebar.tsx`), `src/components/tree/PolicyTree.tsx`,
> `src/components/projects/ProjectDetail.tsx`, `src/store/ui-store.ts`.
>
> ### Estado atual
> A árvore vive num painel fixo de 360px dentro de `ProjectDetail` (`PolicyTree`), com barra de
> ações, seletor "ver como em…", busca e três faixas de filtro no topo — ~230px de altura antes do
> primeiro nó. A sidebar (248px fixos) mostra projetos e as âncoras de dois níveis
> (`sidebarTreeAnchors`). O resultado são duas listas hierárquicas na mesma tela e um centro
> espremido.
>
> ### Objetivo
> Navegar a política inteira numa lista só, com largura ajustável, e disparar as ações da tela por
> uma barra de ferramentas no topo — com o centro recebendo de volta a largura que os dois painéis
> consumiam.
>
> ### Escopo
> 1. **Slot de barra de ferramentas no shell** (`src/components/shell/Toolbar.tsx`): o `Shell`
>    renderiza um contêiner de 40px abaixo do cabeçalho e expõe `ToolbarPortal` — um componente que
>    a tela ativa usa para injetar seus itens via `createPortal` (sem guardar `ReactNode` em
>    Zustand, sem dependência nova). Ordem dos grupos, colapso em `⋯ Mais` abaixo de ~1100px e
>    regra "só o que a tela faz" conforme §2.1. Tela que não usa o portal não renderiza a faixa.
> 2. **Sidebar redimensionável** (§2, DEC-UX-005): alça de 4px na borda direita, intervalo
>    248–480px, padrão 288px, duplo clique restaura o padrão, `←`/`→` movem 16px com a alça em
>    foco, persistência em `localStorage` sob `policyops.sidebarWidth` com validação do intervalo
>    na leitura. `[` continua colapsando.
> 3. **A árvore vira a sidebar** (§17.1): `PolicyTree` passa a ser renderizado dentro de
>    `Sidebar`, sob o projeto aberto, com **todos** os níveis; `sidebarTreeAnchors` e o painel de
>    360px de `ProjectDetail` são removidos (a função de `queries.ts` sai junto se ninguém mais a
>    usar). **Preserve integralmente**: criação por `Enter` com `Tab`/`Shift+Tab` de nível,
>    renomear (`F2`/duplo clique), `Ctrl+D`, drag-and-drop antes/depois/dentro, menu `⋯` (que ganha
>    **Nova regra** e **Arquivar**), badges, contagem de descendentes e `⚠` de revisão pendente. O
>    `code` do nó só aparece a partir de 340px de largura da sidebar. Acrescente `Recolher tudo` /
>    `Expandir tudo` no cabeçalho do projeto e `Alt+clique` no chevron para a subárvore inteira.
> 4. **Busca e filtros migram para a barra** (§2.1): campo de busca + botão `Filtrar (n)` com
>    popover contendo os chips de tipo, `reviewStatus` e tag (`TagFilterBar` reaproveitado) e
>    "Limpar filtros". O comportamento de filtro (ancestrais visíveis e esmaecidos) não muda.
> 5. **Ações da política na barra**: Nova seção · Nova regra · Pendurar matriz · Carregar Markdown ·
>    Publicar pendentes (n), mais o chip de alvo `em: <caminho do nó selecionado>` (clicar rola a
>    árvore até ele; sem seleção, `em: raiz da política`). Criação sem nó selecionado cria na raiz;
>    com nó selecionado, cria **irmão** dele — mesma semântica do `Enter` na árvore.
> 6. **A nota de ordem de leitura** (§17.1) sai do rodapé do painel e vai para o `title` do
>    cabeçalho do projeto e para o diálogo de atalhos.
>
> ### Testes
> Unitários dos comportamentos movidos (criação por teclado com reparenting, filtro preservando
> ancestrais, alvo da criação com e sem seleção) e da largura persistida (valor fora do intervalo,
> valor corrompido → padrão). E2E: CT-UX-01, CT-UX-03 e CT-UX-05 de `docs/07` §21. Ajuste os testes
> existentes que apontam para `data-testid="policy-tree"` dentro de `ProjectDetail` — o seletor
> continua existindo, o lugar dele muda.
>
> ### Critérios de aceite
> - Abrir um projeto mostra **uma** árvore na tela, na barra lateral, com todos os níveis.
> - Nenhuma ação que existia na barra do painel ou no menu `⋯` sumiu: todas estão na barra de
>   ferramentas ou no menu do nó.
> - A largura da navegação sobrevive ao recarregamento; os limites 248/480 são respeitados.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes e
>   `dist/PolicyOps.html` atualizado no commit.
>
> ### Fora do escopo
> A página do componente no centro → S42 (nesta sessão o `ComponentInspector` continua como está,
> à direita). A tela de Vigência e a remoção do modo fotografia → S43 (o seletor "ver como em…"
> continua funcionando; ponha-o na barra de ferramentas junto das demais ações da política).
> Navegação por teclado dentro da árvore e "próximo pendente" → S44. Migrar outras telas para a
> barra de ferramentas → a sessão que tocar cada tela.
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/07-ux-e-editor.md` §2/§2.1/§17.1 (ajustados ao que foi construído),
> `docs/13-decisoes.md` (DEC nova se alguma decisão aparecer no caminho), a linha da S41 em
> `docs/09-roadmap-de-entregas.md` e `docs/prompts/README.md`, e o ponteiro do `CLAUDE.md` se o
> domínio mudar de arquivo.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta pela documentação →
> **pare e pergunte**. Sem dependência nova.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
