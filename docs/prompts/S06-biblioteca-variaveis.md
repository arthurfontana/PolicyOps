# Sessão 06 — Biblioteca de Variáveis

**Modelo: `Sonnet`** · **Depende de:** S04

---

## Prompt

> Você está implementando a Sessão 06 do Policy Matrix Studio — a Biblioteca de Variáveis.
>
> **Leia antes de começar:** `docs/05-regras-de-negocio.md` §5.1 e §9, `docs/07-ux-e-editor.md` §11 (bloco Variáveis) e `docs/08-camada-de-comandos.md` §3 (comandos de variável). Não tome decisões de arquitetura fora do documentado — se faltar algo, **pare e pergunte**.
>
> ### Objetivo
> CRUD completo de variáveis com domínios versionados, incluindo a visibilidade de impacto que impede o usuário de quebrar matrizes sem saber.
>
> ### Escopo
>
> #### 1. Comandos — `src/core/library/variables.ts`
> Os sete comandos de `docs/08-camada-de-comandos.md` §3, seguindo o contrato de comando da S04 (puro, imutável, inversível, valida antes, registra evento):
> `variable/create`, `variable/updateMeta`, `variable/createDraft`, `variable/saveDomains`, `variable/publish`, `variable/discardDraft`, `variable/archive`.
>
> - `variable/createDraft` clona a versão PUBLISHED em DRAFT; falha com `DRAFT_ALREADY_EXISTS` se já houver (I11).
> - `variable/saveDomains` substitui o conjunto inteiro; só em DRAFT, senão `VARIABLE_VERSION_IMMUTABLE` (I10).
> - `variable/publish` valida e promove; a anterior vira SUPERSEDED.
> - `variable/archive` falha se a variável estiver pinada por alguma versão **publicada** de matriz.
>
> #### 2. Validação de domínios — `src/core/library/validate-domains.ts`
> Função **pura** `validateDomains(type, domains)`, testável isoladamente e usada tanto no comando quanto na interface (validação em tempo real). Implementa I8, I9 e I18:
> - mínimo 2 domínios; exatamente 2 se `BOOLEAN`;
> - `code` único na versão, formato `^[A-Z0-9_]+$`, **sem `|` nem `:`**;
> - `position` sem buracos nem repetição (0..n-1);
> - se `RANGE`: `rangeMin`/`rangeMax` obrigatórios exceto no `isCatchAll`; faixas ordenadas por `position` **contíguas** (o `rangeMax` de uma é o `rangeMin` da seguinte) e não sobrepostas → `RANGE_NOT_CONTIGUOUS`; no máximo um `isCatchAll`, e ele é o último.
>
> Comparações de faixa em Decimal (`decimal.js-light`), nunca em ponto flutuante.
>
> #### 3. Consultas
> `listVariables(doc, { search?, type? })` com contagem de uso, e `getVariableUsage(doc, variableId)` — para cada versão, quais matrizes/versões a pinam, separando vigentes de rascunhos.
>
> #### 4. Interface — `/library/variables`
> - **Lista**: busca por nome/código, filtro por tipo. Por linha: nome, código, badge do tipo, nº de domínios da versão publicada, uso ("em 7 matrizes vigentes, 2 rascunhos"), badge se houver rascunho aberto. Estado vazio com ação primária.
> - **Detalhe**:
>   - metadados editáveis;
>   - timeline vertical de versões (número, estado, data, notas), com seleção da versão exibida;
>   - **editor de domínios** (habilitado só em DRAFT): tabela com reordenação por drag (`@dnd-kit/sortable` — única dependência nova autorizada), colunas código / rótulo / rótulo curto / cor, e para RANGE os campos mín / máx / inclusividade / catch-all;
>   - **validação em tempo real** da contiguidade enquanto o usuário digita, com mensagem inline apontando o par problemático — reaproveitando `validateDomains`;
>   - painel **Impacto** com as matrizes que usam a variável e o aviso literal:
>     > Publicar esta versão **não altera** nenhuma matriz já publicada. Rascunhos poderão adotar a nova versão manualmente.
>   - ações: Criar rascunho / Salvar / Publicar / Descartar, com confirmação nas duas últimas.
>
> ### Testes
> - `validateDomains` exaustivo: cada regra e cada erro, incluindo faixa com buraco, faixas sobrepostas, catch-all no meio, catch-all duplicado, BOOLEAN com 3 domínios, código com separador de caminho.
> - Publicar v2 de uma variável **não altera** nenhum snapshot de eixo existente — reverificação explícita da garantia da S04, agora pelo caminho real da biblioteca. Compare os documentos antes e depois nas matrizes.
> - `variable/archive` falha quando em uso por versão publicada, e passa quando só há uso em rascunho.
> - Componente: erro de contiguidade aparece sem recarregar e some ao corrigir.
> - E2E: criar variável RANGE com 4 faixas → publicar → ela aparece disponível para novas matrizes.
>
> ### Critérios de aceite
> - Criar rascunho de `SCORE_HVI3` adicionando `R7`, publicar, e verificar que `MTZ_LIMITE_PF` v1 continua com 6 colunas e 24 combinações.
> - Salvar faixas com buraco mostra erro claro em pt-BR e não grava.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, tamanho no orçamento.
>
> ### Fora do escopo
> Adotar a nova versão dentro de uma matriz — isso é a S16. Aqui a biblioteca evolui e **mostra** o impacto.
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push.
