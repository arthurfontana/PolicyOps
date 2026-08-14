# Sessão 32a — Núcleo de componentes de política e schema 5

**Modelo:** `Opus` · **Depende de:** S29 (schema 4) · **Épico/Marco:** Governança (M10)
· **Trilha antecipada:** 1 de 3 (32a → 33a → 33b) — **Lote 1: Fundação**

> **Por que Opus:** esta sessão desenha o schema e as invariantes de árvore (I23/I24) que todas as
> demais sessões do épico herdam. Erro de modelagem aqui — árvore cíclica aceita, versão publicada
> mutável, `position` com buraco — corrompe dados históricos em silêncio: o mesmo perfil de risco
> das S03/S12/S16.

> **Por que 32a e 32b:** a trilha antecipada existe para o produto ser avaliado com a política real
> dentro e não com dados de exemplo (DEC-GOV-010). Para a árvore rodar bastam **componentes e
> versões**; `ChangeRequest`, `Release`, o grafo de 12 estados e o congelamento (I25) não
> participam dela e foram para a **S32b**, que continua sendo pré-requisito da S35. O
> `schemaVersion: 5` **não** foi dividido: ele fecha inteiro aqui, numa única migração 4→5, para
> não existir uma segunda migração depois.

> **Revisão de UX e hierarquia (DEC-GOV-011/012/013), fechada em 2026-08-14 — antes desta sessão.**
> O modelo de `PolicyComponent` ganhou quatro ajustes aditivos que **precisam entrar aqui**, porque
> depois desta sessão custariam uma migração 5→6: `tags?` no componente, `versions` opcional em
> `SECTION` (I27), `variableId?` em `POLICY_VARIABLE` e a regra de contenção explícita. Também
> entram no schema, sem consumidor ainda, `Project.foundationEffectiveFrom?` (RN-GOV-09, usada pela
> S33b) e `Project.factoryTemplate?` (S38). O que foi **adiado** — ordem de execução, `sectionKind`,
> nó de referência, numeração de origem do Word — está em `docs/14` §3.6: **não implemente nada
> disso**, nem "já que estou aqui".

## Prompt

> Você está implementando a Sessão 32a do PolicyOps — o núcleo do modelo de componentes de
> política (`schemaVersion: 5`). Sessão **sem tela**: só `src/core/`, schema, comandos e testes.
>
> **Leia antes de começar:** `docs/14-governanca-de-alteracoes.md` §3 (modelo, **incluindo §3.6 —
> o que está adiado**), §6 (RNs e invariantes); `docs/03-modelo-do-documento.md` §1 e §10
> (convenções e migração); `docs/08-camada-de-comandos.md` (command pattern e inversos);
> DEC-GOV-001, 002, 003, 009, 010, **011, 012, 013**.
>
> ### Estado atual
> O documento está em `schemaVersion: 4` (S29, épico Plataforma: `meta.acl`), com
> `Matrix`/`MatrixVersion` versionadas por `src/core/versioning/lifecycle.ts`, migração em
> `src/core/document/migrate.ts` e comandos com inverso em `src/core/`. Não existe nada de
> componentes, DBs ou releases.
>
> ### Objetivo
> O documento sabe representar a política como árvore de componentes versionados — validado por
> Zod, migrado de v4 e coberto por testes —, com o schema das entidades de governança (DB, release,
> anexo, `RichDoc`) já declarado para que não exista uma segunda migração adiante.
>
> ### Escopo
> 1. **Schema 5 inteiro** em `src/core/document/schema.ts`: `PolicyComponent` (com `tags?`,
>    `variableId?` e `versions` opcional em `SECTION`), `ComponentVersion`
>    (payloads discriminados por tipo), `ChangeRequest`, `ChangeRequestItem`, `Release`,
>    `Attachment`, `RichDoc`/`Block`, kinds de catálogo `MOTIVATOR` e `IMPACT_CATEGORY`, e os dois
>    campos opcionais novos de `Project`: `foundationEffectiveFrom?` (RN-GOV-09) e
>    `factoryTemplate?`. Contratos exatamente como `docs/14` §3; divergência necessária →
>    **pare e pergunte**. Migração 4→5
>    puramente aditiva em `migrate.ts` (`components: []`, `changeRequests: []`, `releases: []`,
>    `attachments: []`), testada com documento v4 real e com a cadeia 1→2→3→4→5.
>    As entidades de governança entram **como schema e nada mais** — sem comandos, sem validação de
>    workflow, sem tela (isso é a S32b).
> 2. **Invariantes de árvore** em `validate.ts`: I23 (MATRIX espelho — `matrixId` válido do mesmo
>    projeto, `versions: []`, **sem filhos**, no máximo um componente por matriz; e
>    `POLICY_VARIABLE` com `variableId` opcional apontando `Variable` existente, no máximo um
>    componente por variável), I24 (árvore acíclica, `parentId`
>    do mesmo projeto, `position` sem buracos entre irmãos, profundidade ≤ 6, `tags` referenciando
>    `CatalogItem` de kind `TAG` sem repetição) e a **unicidade e
>    imutabilidade de `PolicyComponent.code` dentro do projeto** (`docs/14` §3.1), que entra em I24
>    e é o que a carga por recorte (S40) usa para bloquear duplicata com `E-GOV-06`. **I27**: seção
>    pode ter versões, e quando tem, segue o mesmo ciclo das demais. I25 e I26 (congelamento do DB e
>    codes de DB/release) ficam para a S32b.
>    Catálogo de erros `E-GOV-01..06` escrito inteiro em `errors.ts`/`error-messages.ts` (é só
>    texto, no padrão do §9 de `docs/05`); aqui só os de componente/carga são disparados.
> 3. **Comandos de árvore** (`component/create`, `component/update`, `component/move`,
>    `component/archive`, `component/setReviewStatus`) com inverso exato; `component/move` valida
>    ciclo e reindexa `position`.
> 4. **Ciclo de versão de componente** (`componentVersion/createDraft`, `/update`, `/publish`,
>    `/discardDraft`) espelhando a semântica de `versioning/lifecycle.ts` — publicar exige
>    `effectiveFrom`, marca a anterior `SUPERSEDED` com `effectiveTo`, e é irreversível (I3).
>    Reutilize os helpers existentes onde couber; não duplique regra que já existe. O campo
>    `changeRequestId` da versão é aceito e preservado, mas nada nesta sessão o preenche.
> 5. **Serialização e merge**: `serialize.ts` canonicaliza as coleções novas e o merge de
>    documentos (S17) não perde componentes — mesmo alcance mínimo adotado na S23 para
>    `importProfiles`/`tags`.
>
> ### Testes
> `tests/unit/` espelhando os módulos novos, 100% de cobertura no que entrar em `versioning`-like.
> Cobrir: migração (documento v4 real + cadeia completa), cada invariante violada → erro certo,
> inverso de cada comando, ciclo de vida completo de uma versão de componente, e o round-trip
> salvar → abrir → salvar sem diferença canônica. Fixture nova `tests/fixtures/` com uma
> mini-política **no formato do documento real**: uma seção de capítulo com versão própria
> ("Visão Geral"), duas seções temáticas puras (sem versões), 3 regras com reason code, 1
> componente MATRIX apontando matriz existente e 1 `POLICY_VARIABLE` espelhando uma variável da
> Biblioteca. Cobrir também: seção com e sem versões; `MATRIX` com filho → erro; duas matrizes
> apontadas pelo mesmo nó e dois nós na mesma matriz → erro; `tags` com code inexistente → erro.
>
> ### Critérios de aceite
> - Documento v4 real abre, migra para v5 e re-salva canonicamente.
> - I23/I24 e a unicidade de `code` testadas; comandos com inverso exato.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes; orçamento de 1,5 MB ok;
>   `dist/PolicyOps.html` atualizado no commit.
>
> ### Fora do escopo
> Comandos e validações de `ChangeRequest`/`Release`, grafo de estados, aprovações e I25/I26
> (**S32b**); qualquer tela (S33a/S33b/S35), editor rico funcional (S34), publicação via
> DB/release (S36), pacote (S38), fotografia histórica (S39), carga por recorte (S40). E tudo o
> que `docs/14` §3.6 lista como adiado: **nenhum** modelo de ordem de execução, `sectionKind`, nó
> de referência ou numeração de origem — nem "só o campo, para depois".
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/03-modelo-do-documento.md` (schema 5 completo + nota de migração §10),
> `docs/05-regras-de-negocio.md` §9 (erros E-GOV), `docs/08-camada-de-comandos.md` (comandos
> novos), `docs/14-governanca-de-alteracoes.md` (marcar §3.1/§3.2/§3.5 como fechados, apontando
> docs/03), `docs/13-decisoes.md` (decisões tomadas na sessão) e a linha da S32a em `docs/09`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → pare e pergunte.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
