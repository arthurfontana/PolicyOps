# Sessão 10 — Engine de diff e tela de comparação

**Modelo recomendado: `Opus`**
**Depende de:** S09

---

> **Por que Opus:** o diff mistura estrutura (eixos que mudaram) com semântica de negócio ("célula aberta" ≠ "célula alterada"). Casar células entre versões com domínios diferentes, decidir o que é incomparável e produzir um resumo que faça sentido para quem escreve política de crédito exige julgamento, não transcrição.

## Prompt

> Você está implementando a Sessão 10 do Policy Matrix Studio — comparação entre versões.
>
> **Leia antes de começar:** `docs/04-regras-de-negocio.md` §5 por inteiro (é a especificação do diff, incluindo o resumo semântico) e `docs/05-ux-e-editor.md` §5 (a tela).
>
> ### Objetivo
> Selecionar duas versões e ver exatamente o que mudou — visualmente e em números que um analista de crédito entenda.
>
> ### Escopo
>
> #### 1. `src/server/services/diff-service.ts`
>
> `diffVersions(aId, bId)` onde A é a base (mais antiga) e B a comparada. Retorno:
>
> ```ts
> type VersionDiff = {
>   a: VersionRef; b: VersionRef;
>   comparable: boolean;
>   incomparableReason?: 'DIFFERENT_VARIABLES';
>   axes: { x: AxisDiff; y: AxisDiff };
>   cells: CellChange[];
>   summary: DiffSummary;
> };
> ```
>
> - **Diff de eixos** (§5.1): `variableChanged`, `pinChanged`, domínios adicionados/removidos/renomeados.
> - Se `variableChanged` em qualquer eixo → `comparable: false`, `cells: []`. A UI cai no modo lado a lado.
> - **Diff de células** (§5.2): casamento por `(xCode, yCode)`. `ADDED` / `REMOVED` / `MODIFIED`, com a lista de campos alterados. Células idênticas **não** entram no resultado.
> - Comparar versões de **matrizes diferentes** é permitido quando os eixos usam as mesmas variáveis (comparar PF × PJ é um caso de uso real).
> - Comparar uma versão consigo mesma devolve diff vazio e `comparable: true`.
>
> #### 2. Resumo semântico (§5.3) — a parte que dá valor
>
> ```ts
> type DiffSummary = {
>   cellsOpened: number;        // decisão passou de reprovadora para aprovadora
>   cellsClosed: number;        // passou de aprovadora para REPROVADO
>   cellsToManualReview: number;
>   offersChanged: number;
>   limitsIncreased: number;
>   limitsDecreased: number;
>   cellsAdded: number;
>   cellsRemoved: number;
>   notesChanged: number;
>   colorsChanged: number;
> };
> ```
>
> - "Aprovadora" é determinado pelo `code` do `CatalogItem` de decisão. Crie `src/lib/decision-semantics.ts` com `APPROVING_DECISION_CODES = ['APROVADO', 'EXCECAO']`, comentado como ponto de configuração futura. **Não** derive isso de cor nem de posição.
> - Limite efetivo = `limitOverride ?? limitItem.numericValue`. Comparar como Decimal, não como número de ponto flutuante. Célula que ganhou ou perdeu limite (de/para nulo) conta como aumentado/reduzido, respectivamente.
> - `offersChanged` não deve contar de novo células que já entraram como adicionadas ou removidas.
>
> Gere também `summaryText: string[]` — frases prontas em pt-BR ("12 células abertas", "8 células fechadas", "4 ofertas alteradas", "2 limites aumentados"), omitindo as métricas zeradas.
>
> #### 3. Desempenho
> Diff de duas versões 40×40 (1.600 células cada) em menos de 500 ms server-side, com **duas** queries no total. Carregue as células dos dois lados em lote e case em memória por chave — nada de consulta por célula. Escreva um teste de desempenho com dados sintéticos.
>
> #### 4. Tela — `/projects/[projectId]/matrices/[matrixId]/compare?a=&b=`
>
> Conforme `docs/05-ux-e-editor.md` §5:
> - Topo: dois seletores de versão (a mais antiga sempre à esquerda, independentemente da ordem escolhida) + cards do resumo semântico.
> - **Tab "Sobreposto"** (default): um grid, células alteradas com marca diagonal e badge do tipo; hover/clique mostra antes → depois lado a lado no inspector.
> - **Tab "Lado a lado"**: dois grids com scroll e hover sincronizados.
> - **Tab "Lista"**: tabela de mudanças com colunas coordenada / campo / antes / depois, filtrável por tipo de mudança e ordenável.
> - Legenda de diff: adicionada (azul), removida (vermelho tracejado), modificada (âmbar), inalterada (opacidade 40%).
> - Toggle "mostrar apenas alteradas".
> - Banner quando incomparável, explicando o motivo em pt-BR e forçando o modo lado a lado.
> - Reaproveite o `matrix-grid` da S06 acrescentando uma prop `diffOverlay` — **não duplique o componente de grid**.
>
> Ligue os botões "Comparar" da S09 a esta tela, com A e B pré-selecionados de forma sensata (rascunho × vigente; ou versão histórica × sua sucessora).
>
> #### 5. Integração com a publicação
> Substitua a contagem simples do diálogo de publicação da S09 pelo resumo semântico real, e grave-o no payload do evento `PUBLISHED` (`diffSummary`), conforme §7 das regras de negócio.
>
> #### 6. Testes
> - Cada métrica do resumo, isolada, com um caso positivo e um negativo.
> - Célula que mudou só a cor não conta como aberta/fechada.
> - Domínio adicionado no eixo produz `ADDED`, removido produz `REMOVED`.
> - Domínio renomeado (mesmo `code`, label diferente) **não** produz mudança de célula, apenas `relabeledDomains`.
> - Variável trocada → `comparable: false`.
> - Diff de uma versão consigo mesma é vazio.
> - Limites com `limitOverride` comparados corretamente contra o valor do catálogo.
> - Desempenho: 1.600 × 1.600 sob 500 ms e no máximo 2 queries.
> - E2E: comparar v1 × v2 da matriz do seed mostra exatamente as 3 células alteradas nos três modos.
>
> ### Critérios de aceite
> - Comparar as versões do seed produz o resumo correto nos três modos de visualização.
> - O resumo semântico usa a linguagem do negócio, não a do banco.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes.
>
> ### Fora do escopo
> Exportação do diff em CSV (S14) — deixe o botão desabilitado.
>
> ### Encerramento
> Commit descritivo e push.
