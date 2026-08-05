# Sessão 14 — Diff e comparação

**Modelo: `Opus`** · **Depende de:** S13

---

> **Por que Opus:** o diff mistura estrutura (eixos que mudaram de pilha, de domínios ou de tuplas) com semântica de negócio ("célula aberta" ≠ "célula alterada"). Decidir o que é comparável, casar células entre versões com estruturas diferentes e produzir um resumo que faça sentido para quem escreve política de crédito exige julgamento.

## Prompt

> Você está implementando a Sessão 14 do Policy Matrix Studio — comparação entre versões.
>
> **Leia antes de começar:** `docs/05-regras-de-negocio.md` §4 por inteiro (a especificação do diff, incluindo o resumo semântico) e `docs/07-ux-e-editor.md` §9 (a tela).
>
> ### Objetivo
> Selecionar duas versões e ver exatamente o que mudou — visualmente e em números que um analista de crédito entenda.
>
> ### Escopo
>
> #### 1. `src/core/diff/`
>
> `diffVersions(doc, aId, bId)` onde A é a base (mais antiga) e B a comparada:
>
> ```ts
> type VersionDiff = {
>   a: VersionRef; b: VersionRef;
>   comparable: boolean;
>   incomparableReason?: 'DIFFERENT_LEVELS';
>   axes: { x: AxisDiff; y: AxisDiff };
>   cells: CellChange[];
>   summary: DiffSummary;
>   summaryText: string[];
> };
> ```
>
> - **Diff de eixos** (§4.1): `levelsChanged`, mudanças de pin por nível, domínios adicionados/removidos/renomeados por nível, tuplas adicionadas/removidas, reordenação.
> - Se `levelsChanged` (pilha de variáveis diferente ou em ordem diferente) em qualquer eixo → `comparable: false`, sem diff de células.
> - **Mudança apenas no conjunto de tuplas** (por compatibilidade ou supressão) **não** torna incomparável — vira tupla adicionada/removida. Este é o caso mais comum e precisa funcionar bem.
> - **Diff de células** (§4.2): casamento por `xPath::yPath`. `ADDED` distingue `reason: 'NEW_TUPLE'` (combinação nova) de `'WAS_EMPTY'` (existia mas estava vazia) — a interface trata os dois de forma diferente.
> - Células idênticas não entram no resultado.
>
> #### 2. Resumo semântico (§4.3) — a parte que dá valor
>
> Todas as métricas de §4.3. Regras que não podem sair erradas:
> - "aprovadora" vem do `code` da decisão: `APPROVING_DECISION_CODES = ['APROVADO', 'EXCECAO']` em `src/core/diff/semantics.ts`, comentado como ponto de configuração futura. **Nunca** derive de cor nem de posição;
> - limite efetivo = `limitOverride ?? numericValue` do catálogo, comparado em **Decimal**, nunca em ponto flutuante. Célula que ganhou ou perdeu limite (de/para ausente) conta como aumentado/reduzido respectivamente;
> - `offersChanged` não conta de novo células já contadas como adicionadas ou removidas.
>
> `summaryText` produz as frases prontas em pt-BR ("12 células abertas", "8 células fechadas", "4 ofertas alteradas", "2 limites aumentados"), omitindo as zeradas.
>
> #### 3. Desempenho
> Diff de duas versões de 1.500 combinações em menos de 150 ms. Casamento em memória por chave, uma passada. Teste de desempenho com dados sintéticos.
>
> #### 4. Tela de comparação
> Conforme `docs/07-ux-e-editor.md` §9:
> - dois seletores de versão (a mais antiga sempre à esquerda, independentemente da ordem escolhida) + cards do resumo semântico;
> - **Sobreposto** (padrão): um grid, células alteradas com marca diagonal e badge do tipo; clicar mostra antes → depois no inspector;
> - **Lado a lado**: dois grids com rolagem e hover sincronizados — atenção aos cabeçalhos aninhados, que podem ter alturas diferentes entre as versões;
> - **Lista**: tabela filtrável por tipo de mudança e ordenável, com o caminho legível completo (`Varejo › 100k–500k × R3`);
> - legenda de diff: adicionada (azul), removida (vermelho tracejado), modificada (âmbar), inalterada (opacidade 40%);
> - toggle "mostrar apenas alteradas";
> - banner quando incomparável, explicando o motivo em pt-BR e forçando o modo lado a lado.
>
> **Reaproveite o componente de grid da S09 acrescentando uma prop `diffOverlay`. Não duplique o grid.**
>
> Ligue os botões "Comparar" da S13, com A e B pré-selecionados de forma sensata (rascunho × vigente, ou versão histórica × sua sucessora).
>
> #### 5. Duas integrações
> - **Publicação**: substitua a contagem simples do diálogo da S13 pelo resumo semântico real, e grave-o no payload do evento `VERSION_PUBLISHED`.
> - **Conflito de salvamento**: a S05 deixou a opção "Ver o que mudou" como lista textual. Agora ela usa esta tela, comparando as versões de matriz que diferem entre o documento local e o remoto. Faça a ligação.
>
> ### Testes
> - Cada métrica do resumo, isolada, com caso positivo e negativo.
> - Célula que mudou só a cor **não** conta como aberta/fechada.
> - Tupla adicionada por mudança de compatibilidade → `ADDED` com `reason: 'NEW_TUPLE'`; célula que estava vazia e foi preenchida → `ADDED` com `reason: 'WAS_EMPTY'`.
> - Domínio renomeado (mesmo `code`) **não** produz mudança de célula, só `relabeled`.
> - Pilha de variáveis diferente → `comparable: false`.
> - Nível adicionado num eixo → `comparable: false` (a pilha mudou).
> - Diff de uma versão consigo mesma é vazio e `comparable: true`.
> - Limites com `limitOverride` comparados corretamente contra o catálogo.
> - Desempenho: 1.500 × 1.500 sob 150 ms.
> - E2E: comparar v1 × v2 de `MTZ_LIMITE_PF` mostra exatamente as 3 células alteradas nos três modos.
>
> ### Critérios de aceite
> - O resumo semântico usa a linguagem do negócio, não a do modelo de dados.
> - Comparar versões com tuplas diferentes funciona e mostra as combinações que entraram e saíram.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes, tamanho no orçamento.
>
> ### Fora do escopo
> Exportação do diff (S17) — deixe o botão desabilitado. Merge de documentos (S17).
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push.
