# Sessão 23 — Tags de Matriz, Filtro e Schema 3

**Modelo: `Sonnet`** · **Depende de:** S20 (última migração de schema) · **Épico: Carga · Marco M6**

> **Por que Sonnet:** CRUD versionado e composição de tela sobre contrato fechado, com uma
> migração **puramente aditiva** — nenhum campo existente muda de forma ou de significado, que é
> justamente o que tornaria a migração cara e exigiria Opus (como na S20).

---

## Prompt

> Você está implementando a Sessão 23 do Policy Matrix Studio — tags de matriz com facetas de
> filtro, e a elevação do documento para `schemaVersion: 3`.
>
> **Leia antes de começar:** `docs/03-modelo-do-documento.md` §4 (`CatalogItem.group`), §5
> (`Matrix.tags`), §7.1 (`ImportProfile`), §9 (I20–I22) e §10 (migração 2→3);
> `docs/07-ux-e-editor.md` §15; `docs/08-camada-de-comandos.md` (`matrix/setTags`,
> `importProfile/save`, `importProfile/delete`, `listMatrices`); `docs/13-decisoes.md`
> DEC-CARGA-003 e DEC-CARGA-007. Não tome decisão de arquitetura fora do documentado — **pare e
> pergunte**.
>
> ### Estado atual
> O documento está em `schemaVersion: 2` desde a S20, e `migrate.ts` já aplica migrações em
> cadeia. O catálogo tem o kind `TAG` desde a S08, hoje usado apenas em `cell.attrs['tag']`
> (`src/core/library/catalog.ts`) — este uso **continua valendo, não o remova**. Matrizes não têm
> classificação nenhuma, e um projeto com 102 matrizes é uma lista rolável sem filtro.
>
> ### Objetivo
> Marcar matrizes com tags agrupadas e filtrar a lista por facetas; e o documento passa a guardar
> perfis de carga, prontos para a S24 usar.
>
> ### Escopo
>
> #### 1. Schema e migração — `src/core/document/`
> `schema.ts`: `Matrix.tags?: string[]`, `CatalogItem.group?: string`, `importProfiles:
> ImportProfile[]` no topo (o tipo `ImportProfile` já existe em `src/core/import/profile.ts`
> desde a S21 — **importe de lá, não redeclare**), `schemaVersion: 3`.
> `migrate.ts`: migração 2→3 conforme `docs/03` §10 — acrescenta `importProfiles: []` e nada
> mais. `validate.ts`: I20, I21 e I22 como `ERROR` (são integridade referencial, não forma de
> domínio — não caem na regra de aviso não bloqueante de I8/I9/I19).
>
> #### 2. Comandos — `src/core/library/catalog.ts` e `src/core/document/commands.ts`
> `matrix/setTags { matrixId, add?, remove? }`: idempotente (adicionar tag já presente não
> duplica, remover ausente não falha), valida I20, omite o campo quando a lista fica vazia,
> devolve inverso exato e emite `MATRIX_TAGGED` com `{ matrixId, added, removed }`.
> `catalog/create` e `catalog/update` passam a aceitar `group` (só tem efeito em kind `TAG`).
> `importProfile/save { profile }` (cria ou atualiza pelo `code`, `IMPORT_PROFILE_DUPLICATE` em
> colisão com outro id, evento `IMPORT_PROFILE_SAVED`) e `importProfile/delete { profileId }`.
>
> #### 3. Consulta — `src/core/queries.ts`
> `listMatrices(doc, { projectId?, tags?, search? })`: filtro por facetas — `OU` dentro do mesmo
> grupo de tags, `E` entre grupos diferentes (`docs/07` §15) —, com a contagem por tag calculada
> sobre o conjunto **antes** do filtro daquele grupo, que é o comportamento esperado de faceta.
>
> #### 4. Interface
> - Inspector da matriz: campo de tags com autocompletar sobre o catálogo (mostrando o grupo),
>   criação inline com seletor de grupo (ou grupo novo), e remoção por chip. Criar tag pelo
>   inspector cria o `CatalogItem`; remover da matriz **não** apaga o item.
> - Lista de matrizes: faixa de filtro com uma linha por grupo, contagem por tag, chips
>   removíveis e "limpar tudo". O filtro vive no `ui-store`, nunca no documento.
> - Barra lateral: contagem filtrada no projeto (`102 matrizes · 17 no filtro`) e os mesmos
>   chips, preservados ao navegar entre telas.
> - Tela de Conteúdo, aba `TAG`: coluna **Grupo** editável em linha; a contagem de uso passa a
>   somar matrizes marcadas além das células.
>
> ### Testes
> - `migrate`: documento v2 real de fixture migra para v3 acrescentando **somente**
>   `importProfiles: []` — comparação estrutural do resto; documento v1 continua migrando em
>   cadeia 1→2→3; documento v4 continua recusado com `DOCUMENT_SCHEMA_TOO_NEW`.
> - `matrix/setTags`: idempotência nos dois sentidos, inverso round-trip, I20 com tag inexistente,
>   campo omitido quando esvazia.
> - `listMatrices`: `OU` dentro do grupo, `E` entre grupos, tag arquivada fora das facetas mas
>   visível na matriz, busca combinada com filtro.
> - `importProfile/save`: criação, atualização pelo mesmo `code`, colisão de code com outro id.
> - Componente: criar tag inline pelo inspector; filtrar por duas facetas; limpar filtro.
> - Cobre **CT-13** de `docs/12-carga-de-matrizes.md` na parte que não depende da carga (tags
>   acrescentadas não removem as manuais).
>
> ### Critérios de aceite
> - Um documento salvo pela versão anterior abre, migra e volta a salvar sem perda — nenhum campo
>   além de `importProfiles` aparece no diff do `.json`.
> - Num projeto com 102 matrizes, filtrar `Canal: Digital` **e** `Cluster: G4` deixa exatamente as
>   matrizes que têm as duas tags.
> - Arquivar uma tag a esconde do filtro e do autocompletar sem alterar nenhuma matriz.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, orçamento de 1,5 MB
>   respeitado, `dist/PolicyOps.html` atualizado.
>
> ### Fora do escopo
> Aplicar tags automaticamente pela carga (S24), qualquer tela do assistente de carga, e
> hierarquia de tags (grupo é um rótulo plano, não uma árvore).
>
> ### Atualização da documentação (obrigatório)
> `docs/03-modelo-do-documento.md` (§4, §5, §7.1, §9, §10 — confirme que descrevem o que foi
> implementado), `docs/07-ux-e-editor.md` §15, `docs/08-camada-de-comandos.md`, `docs/13-decisoes.md`
> para decisões novas, e a linha da sessão 23 em `docs/09-roadmap-de-entregas.md`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Sem dependência nova. `src/core/` puro. Decisão não
> coberta pela documentação: **pare e pergunte**.
>
> ### Encerramento
> Commit descritivo na branch de trabalho, com `dist/PolicyOps.html` atualizado, e push.
