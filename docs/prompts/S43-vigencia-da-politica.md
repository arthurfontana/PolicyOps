# Sessão 43 — Vigência: a política inteira em qualquer data

**Modelo:** `Opus` · **Depende de:** S41, S42 · **Épico/Marco:** Experiência (M13)

> **Por que Opus:** a sessão remove um estado (o modo fotografia da árvore) que hoje atravessa
> árvore, página do componente e comparação, e reconstrói a mesma leitura numa tela nova sobre
> `getPolicyAt`. Perder uma das leituras de borda (seção pura como `estrutura`, arquivado que
> permanece, matriz sem espelho) é regressão de auditoria, que não aparece em teste superficial.

## Prompt

> Você está implementando a Sessão 43 do PolicyOps — a consulta histórica vira tela: a de Vigência
> passa a mostrar a política inteira na data escolhida, e a árvore da barra lateral volta a ser
> sempre o presente.
>
> **Leia antes de começar:** `docs/07-ux-e-editor.md` §10 (a tela), §20.1–§20.3 (o que muda de
> lugar) e §21 (US-UX-04, CT-UX-04); DEC-UX-004 em `docs/13-decisoes.md`;
> `docs/05-regras-de-negocio.md` §6.2–§6.3 (as regras de vigência, que **não** mudam). Código:
> `src/core/timeline/policy-at.ts` (pronto, S39), `src/components/timeline/TimelineScreen.tsx`,
> `src/components/compare/PolicyCompareScreen.tsx`, `src/components/tree/`, `src/store/ui-store.ts`.
>
> ### Estado atual
> `getPolicyAt` e `diffPolicySnapshots` já respondem "a política inteira em uma data" e "o que
> mudou entre duas" (S39). Na interface, porém, a fotografia é um **estado da árvore**
> (`ui-store.componentTree.snapshotDate`): a árvore congela, os botões somem, o menu do nó
> desaparece e a página do componente entra em somente leitura. A tela de Vigência mostra só
> matrizes.
>
> ### Objetivo
> Responder "qual era a política vigente em 15/05?" — regras, listas, variáveis e matrizes — numa
> tela de consulta, sem congelar a tela em que se edita.
>
> ### Escopo
> 1. **Tela de Vigência com três abas sobre a mesma data** (§10): **Estrutura** (padrão),
>    **Matrizes** (o conteúdo atual da tela, intacto) e **Portfólio**. A aba Estrutura desenha a
>    árvore do projeto na data a partir de `getPolicyAt`, com `v{n}`, "sem política vigente em
>    dd/mm/aaaa" e `estrutura` (I29), e some com o que não existia na data — reaproveite o
>    componente de nó da árvore em modo leitura, não duplique a renderização.
> 2. **Leitura do nó selecionado**: painel ao lado com o payload campo a campo e a especificação
>    rica **daquela versão**, somente leitura, com o banner de versão histórica e marca d'água
>    (§10). Nó `MATRIX` abre o grid da versão vigente na data, com o mesmo banner.
> 3. **"Abrir no editor (hoje)"** em qualquer nó: leva ao mesmo componente na tela da política,
>    fora da consulta.
> 4. **Remoção do modo fotografia da árvore** (DEC-UX-004): sai `componentTree.snapshotDate` e todo
>    o `readOnly` derivado dele na árvore e na página do componente; entra `ui-store.policyAtDate`
>    (data da tela de Vigência) com a ação que os saltos usam. Os dois saltos existentes passam a
>    abrir a Vigência na data: a faixa de vigência da página do componente (§20.2) e os atalhos
>    "Ver a política em …" da tela de comparação (§20.3).
> 5. **Barra de ferramentas** (§2.1): seletor de data com os atalhos (Hoje · Início do mês · 30/90
>    dias · Início do ano), seletor de projeto, busca e `Filtrar (n)`, e **"Comparar com outra
>    data"**, que abre a comparação com a data atual já preenchida de um lado.
>
> ### Testes
> Unitários: a aba Estrutura sobre uma fixture com as quatro leituras (versão vigente, sem versão
> vigente, seção pura, matriz sem espelho) na mesma data; nó que não existia na data ausente da
> árvore; arquivado depois da data presente. E2E: CT-UX-04 (salto da faixa de vigência → tela de
> Vigência na data, árvore lateral seguindo editável no presente). Migre os testes da S39 que
> exercitavam o modo fotografia da árvore — a cobertura das leituras não pode encolher, só mudar de
> tela. Desempenho: abrir a data com 300 componentes e 102 matrizes em < 500 ms (o mesmo orçamento
> da S39).
>
> ### Critérios de aceite
> - Escolher 15/05 na tela de Vigência mostra a estrutura inteira do projeto naquele dia, incluindo
>   regras e listas, e o conteúdo da versão vigente ao selecionar um nó.
> - A árvore da barra lateral continua editável enquanto a consulta está aberta.
> - Nenhum caminho da aplicação ainda coloca a árvore em modo somente leitura por data.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes e
>   `dist/PolicyOps.html` atualizado no commit.
>
> ### Fora do escopo
> Editar na consulta histórica (o caminho é "Abrir no editor (hoje)"), exportar a consulta ou a
> comparação, indicadores/analytics de mudança. Nada em `src/core/` precisa mudar — se você achar
> que precisa, **pare e pergunte**.
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/07-ux-e-editor.md` §10/§20, `docs/14-governanca-de-alteracoes.md` §4
> (US-GOV-07, onde a leitura passa a viver), `docs/13-decisoes.md` se alguma decisão aparecer, a
> linha da S43 em `docs/09-roadmap-de-entregas.md` e `docs/prompts/README.md`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → **pare e pergunte**.
> Sem dependência nova.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
