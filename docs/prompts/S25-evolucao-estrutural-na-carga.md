# Sessão 25 — Evolução Estrutural na Carga

**Modelo: `Opus`** · **Depende de:** S24 · **Épico: Carga · Pós-M6**

> **Por que Opus:** faz um arquivo externo disparar evolução de biblioteca e de eixo já publicado
> — nova versão de variável, nova versão de compatibilidade e resnapshot com casamento de células
> por caminho. É o território de `docs/05` §5, onde errar apaga conteúdo de célula em silêncio;
> mesmo perfil de risco da sessão 16.

---

## Prompt

> Você está implementando a Sessão 25 do Policy Matrix Studio — a resolução assistida de
> divergência estrutural na carga: quando o arquivo traz uma faixa, um modelo ou uma combinação
> que a matriz ainda não conhece.
>
> **Leia antes de começar:** `docs/12-carga-de-matrizes.md` RN-06, CT-03 e §7 (esta sessão é
> nomeada lá como o que sai do escopo da S24); `docs/05-regras-de-negocio.md` §5 inteiro
> (evolução da biblioteca, defasagem, `previewResnapshot`, `applyResnapshot`);
> `docs/04-eixos-aninhados.md` §3 e §5; `docs/13-decisoes.md` DEC-CARGA-009. Não tome decisão de
> arquitetura fora do documentado — **pare e pergunte**.
>
> ### Estado atual
> A carga funciona ponta a ponta (S21–S24) e classifica como `STRUCTURAL` toda matriz cujo
> arquivo traz tupla inexistente no eixo, ignorando-a na aplicação. Resolver isso hoje exige o
> caminho manual: publicar nova versão da variável, criar rascunho, `axis/resnapshot`, recarregar.
> `previewResnapshot`/`applyResnapshot` existem e são testados desde a S16.
>
> ### Objetivo
> Transformar o caminho manual de quatro etapas num plano revisável dentro do assistente: o
> usuário vê o que precisa mudar na biblioteca e na estrutura da matriz, confirma, e a carga
> segue.
>
> ### Escopo
>
> #### 1. Plano estrutural — `src/core/import/structural.ts`
> `planStructuralChanges(doc, plan)` → `StructuralPlan[]`, um por matriz `STRUCTURAL`,
> descrevendo em ordem: domínios a acrescentar em cada variável de eixo (com a versão de origem),
> alterações no mapa de compatibilidade deduzidas do arquivo, e o `ResnapshotPlan` resultante
> (reaproveite `previewResnapshot` — não escreva um segundo motor), com `newCombinations`,
> `droppedCombinations` e as células que sairiam. Função pura, sem escrita.
>
> #### 2. Aplicação — `import/applyStructural`
> Comando que executa, para as matrizes selecionadas e nesta ordem: `variable/createDraft` +
> `saveDomains` + `publish` para os domínios novos; `compat/createDraft` + `saveMap` + `publish`
> quando o mapa mudou; `version/createDraft` na matriz; `axis/resnapshot`. Tudo-ou-nada, com
> inverso íntegro. Nunca remove domínio nem tupla: **divergência de subtração** (o arquivo deixou
> de trazer uma faixa) é aviso, não ação — a faixa continua no eixo, e as células dela seguem
> pela política `missingRowPolicy` (RN-07).
>
> #### 3. Interface
> No passo 5, matriz `STRUCTURAL` ganha a ação "Resolver estrutura", que abre um painel com o
> plano em três blocos (biblioteca · compatibilidade · eixo), o impacto em número de combinações
> e a lista das células que seriam perdidas. Confirmar aplica e reclassifica a matriz no plano
> (vira `CHANGED` ou `UNCHANGED`), sem sair do assistente. Ação em lote para todas as
> `STRUCTURAL` que compartilham a mesma mudança de biblioteca.
>
> ### Testes
> - Faixa nova (`R26`) num modelo existente: variável ganha v2 com o domínio novo, compatibilidade
>   ganha a entrada, o eixo é resnapshotado, as células antigas são preservadas **integralmente**
>   (compare o mapa inteiro, não a contagem) e as combinações novas ficam pendentes até a carga
>   preenchê-las.
> - Modelo adicional novo no nível 0 do eixo Y: dois níveis afetados na mesma operação.
> - Divergência de subtração: nada é removido, só avisa.
> - Erro no meio do lote não deixa variável publicada sem o resnapshot correspondente.
> - Inverso: aplicar e desfazer devolve documento estruturalmente idêntico, inclusive as versões
>   de variável criadas.
> - Reclassificação: depois de resolver, a mesma carga aplica a matriz normalmente e a segunda
>   passada volta `UNCHANGED` (a idempotência de CT-01 continua valendo).
>
> ### Critérios de aceite
> - Um arquivo com uma faixa nova numa das 102 matrizes é carregado do início ao fim sem sair do
>   assistente e sem passo manual na biblioteca.
> - Nenhuma célula existente é perdida em qualquer caminho de resolução estrutural.
> - Matrizes que não divergem não são afetadas pela resolução de outra.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes,
>   orçamento de 1,5 MB respeitado, `dist/PolicyOps.html` atualizado.
>
> ### Fora do escopo
> Remover domínios ou tuplas pela carga; alterar a pilha de níveis de um eixo (variável nova num
> eixo continua sendo operação manual de `axis/addLevel`); publicar qualquer versão de matriz —
> a carga continua parando no rascunho (RN-10).
>
> ### Atualização da documentação (obrigatório)
> `docs/12-carga-de-matrizes.md` (RN-06 e §7 deixam de listar isso como fora do escopo; §5 ganha
> os contratos novos), `docs/05-regras-de-negocio.md` §5 se o comportamento de resnapshot mudar,
> `docs/13-decisoes.md` (DEC nova registrando o que a resolução automática faz e o que
> deliberadamente não faz), e a linha da sessão 25 em `docs/09-roadmap-de-entregas.md`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Sem dependência nova. `src/core/` puro. Decisão não
> coberta pela documentação: **pare e pergunte**.
>
> ### Encerramento
> Commit descritivo na branch de trabalho, com `dist/PolicyOps.html` atualizado, e push.
