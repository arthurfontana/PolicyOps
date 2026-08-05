# Sessão 04 — Biblioteca de Variáveis

**Modelo recomendado: `Sonnet`**
**Depende de:** S03
**Marco:** M1 (junto com S05)

---

## Prompt

> Você está implementando a Sessão 04 do Policy Matrix Studio — a Biblioteca de Variáveis.
>
> **Leia antes de começar:** `docs/04-regras-de-negocio.md` §4.1 (versionamento de variável) e §9 (erros), `docs/05-ux-e-editor.md` §7.1 (UX da tela) e `docs/06-api.md` §1 (contrato das actions). Não tome decisões de arquitetura fora do que está escrito — se faltar algo, **pare e pergunte**.
>
> ### Objetivo
> CRUD completo de variáveis com domínios versionados, incluindo a visibilidade de impacto que impede o usuário de quebrar matrizes sem saber.
>
> ### Escopo
>
> #### 1. `src/server/services/variable-service.ts`
> - `createVariable({ code, name, type, description })` → cria a variável e a v1 em `DRAFT` (sem domínios).
> - `updateVariableMeta`.
> - `createVariableDraft(variableId)` → clona a versão PUBLISHED em DRAFT. Falha com `DRAFT_ALREADY_EXISTS` se já houver.
> - `saveVariableDomains(versionId, domains)` → substitui o conjunto inteiro. Só em versão DRAFT (senão `VARIABLE_VERSION_IMMUTABLE`).
> - `publishVariableVersion(versionId, notes)` → valida e promove; a anterior vira SUPERSEDED.
> - `discardVariableDraft(versionId)`.
> - `archiveVariable(variableId)` → falha se a variável estiver pinada por alguma versão PUBLISHED de matriz.
> - `listVariables({ search?, type? })` e `getVariableUsage(variableId)` → para cada versão da variável, quais matrizes/versões a pinam, separando vigentes de rascunhos.
>
> **Validações de domínio** (invariantes I8, I9 de `docs/03-modelo-de-dados.md` §3), numa função pura `validateDomains(type, domains)` testável isoladamente:
> - mínimo 2 domínios; exatamente 2 se `BOOLEAN`;
> - `code` único dentro da versão, formato `^[A-Z0-9_]+$`;
> - `position` sem buracos nem repetição (0..n-1);
> - se `RANGE`: `rangeMin`/`rangeMax` obrigatórios exceto no `isCatchAll`; faixas ordenadas por `position` devem ser **contíguas** (o `rangeMax` de uma é o `rangeMin` da seguinte) e não sobrepostas → `RANGE_NOT_CONTIGUOUS`; no máximo um `isCatchAll` e ele deve ser o último.
>
> #### 2. Actions
> `src/server/actions/variable-actions.ts` com todas as actions de `docs/06-api.md` §1, seção Variáveis. Papel EDITOR, exceto `archiveVariable` (ADMIN).
>
> #### 3. UI — `/library/variables`
> - **Lista**: busca por nome/código, filtro por tipo, e por linha: nome, código, badge do tipo, nº de domínios da versão publicada, contagem de uso ("em 7 matrizes vigentes, 2 rascunhos"), badge se houver rascunho aberto. Estado vazio com ação primária.
> - **Detalhe** `/library/variables/[id]`:
>   - cabeçalho com metadados editáveis;
>   - timeline vertical de versões (número, estado, data, notas), com seleção da versão exibida;
>   - **editor de domínios** (só habilitado em DRAFT): tabela com reordenação por drag (`@dnd-kit/sortable` — está autorizado a instalar apenas esta), colunas código / rótulo / rótulo curto / cor (color picker) e, para RANGE, mín / máx / inclusividade / catch-all;
>   - **validação em tempo real**: a contiguidade das faixas é verificada enquanto o usuário digita, com mensagem inline apontando o par problemático. Reaproveite `validateDomains` — a mesma função no cliente e no servidor;
>   - painel lateral "Impacto" com a lista de matrizes que usam a variável e o aviso literal:
>     > Publicar esta versão **não altera** nenhuma matriz já publicada. Rascunhos poderão adotar a nova versão manualmente.
>   - ações: Criar rascunho / Salvar / Publicar / Descartar, com confirmação em publicar e descartar.
>
> #### 4. Testes
> - Unitários exaustivos de `validateDomains`: cada regra, cada erro, incluindo faixas com buraco, faixas sobrepostas, catch-all no meio, boolean com 3 domínios.
> - Service: publicar v2 de uma variável não altera nenhum `MatrixAxisDomain` existente (re-verificação explícita da garantia da S03, agora pelo caminho real da biblioteca).
> - `archiveVariable` falha quando em uso por versão publicada.
> - Componente: o editor de domínios mostra erro de contiguidade sem recarregar.
>
> ### Critérios de aceite
> - Criar variável "Tempo de Relacionamento" (RANGE) com 4 faixas, publicar, e ela aparece disponível para novas matrizes.
> - Criar rascunho de `SCORE_HVI3` adicionando `R7`, publicar, e verificar no banco que a matriz de exemplo continua com 6 colunas.
> - Tentativa de salvar faixas com buraco mostra erro claro em pt-BR e não grava.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes.
>
> ### Fora do escopo
> Adotar a nova versão dentro de uma matriz (isso é a S12). Aqui a biblioteca apenas evolui e mostra o impacto.
>
> ### Encerramento
> Commit descritivo e push.
