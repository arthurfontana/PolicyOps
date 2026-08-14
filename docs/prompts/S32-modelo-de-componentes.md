# Sessão 32 — Modelo de componentes de política e schema 5

**Modelo:** `Opus` · **Depende de:** S29 (schema 4) · **Épico/Marco:** Governança (M10)

> **Por que Opus:** esta sessão desenha o schema e as invariantes (I23–I26) que todas as demais
> sessões do épico herdam. Erro de modelagem aqui — árvore cíclica aceita, versão publicada
> mutável, item de DB apontando rascunho órfão — corrompe dados históricos em silêncio: o mesmo
> perfil de risco das S03/S12/S16.

## Prompt

> Você está implementando a Sessão 32 do PolicyOps — modelo de componentes de política,
> solicitações de alteração e releases (`schemaVersion: 5`). Sessão **sem tela**: só `src/core/`,
> schema, comandos e testes.
>
> **Leia antes de começar:** `docs/14-governanca-de-alteracoes.md` §3 (modelo), §5 (workflow),
> §6 (RNs e invariantes); `docs/03-modelo-do-documento.md` §1 e §10 (convenções e migração);
> `docs/08-camada-de-comandos.md` (command pattern e inversos); DEC-GOV-001, 002, 003, 009.
>
> ### Estado atual
> O documento está em `schemaVersion: 4` (S29, épico Plataforma: `meta.acl`), com
> `Matrix`/`MatrixVersion` versionadas por `src/core/versioning/lifecycle.ts`, migração em
> `src/core/document/migrate.ts` e comandos com inverso em `src/core/`. Não existe nada de
> componentes, DBs ou releases.
>
> ### Objetivo
> O documento sabe representar a política como árvore de componentes versionados, solicitações de
> alteração com workflow e releases — validado por Zod, migrado de v4 e coberto por testes.
>
> ### Escopo
> 1. **Schema 5** em `src/core/document/schema.ts`: `PolicyComponent`, `ComponentVersion` (payloads
>    discriminados por tipo), `ChangeRequest`, `ChangeRequestItem`, `Release`, `Attachment`,
>    `RichDoc`/`Block` (só o schema — o editor é a S34), kinds de catálogo `MOTIVATOR` e
>    `IMPACT_CATEGORY`. Contratos exatamente como `docs/14` §3; divergência necessária → **pare e
>    pergunte**. Migração 4→5 puramente aditiva em `migrate.ts`, testada com documento v4 real e
>    com a cadeia 1→2→3→4→5.
> 2. **Invariantes** em `validate.ts`: I23 (MATRIX espelho), I24 (árvore acíclica, position sem
>    buracos, profundidade ≤ 6), I25 (DB ≥ APPROVED congelado; rascunho vinculado pertence ao DB),
>    I26 (unicidade/imutabilidade de codes). Catálogo de erros `E-GOV-01..06` em `errors.ts` e
>    `error-messages.ts`, no padrão do §9 de `docs/05`.
> 3. **Comandos de árvore** (`component/create`, `component/update`, `component/move`,
>    `component/archive`, `component/setReviewStatus`) com inverso exato; `component/move` valida
>    ciclo e reindexa `position`.
> 4. **Ciclo de versão de componente** (`componentVersion/createDraft`, `/update`, `/publish`,
>    `/discardDraft`) espelhando a semântica de `versioning/lifecycle.ts` — publicar exige
>    `effectiveFrom`, marca a anterior `SUPERSEDED` com `effectiveTo`, e é irreversível (I3).
>    Reutilize os helpers existentes onde couber; não duplique regra que já existe.
> 5. **Comandos de DB e release**: CRUD de `ChangeRequest` e `Release`, `changeRequest/transition`
>    validando o grafo do §5 (RN-GOV-01) e gravando evento, `changeRequest/addItem`/`removeItem`
>    (RN-GOV-02), `changeRequest/approve|return|reject` gravando em `approvals`. A publicação
>    (individual/lote) é a S36 — aqui só o estado e as validações estáticas.
>
> ### Testes
> `tests/unit/` espelhando os módulos novos, 100% de cobertura no que entrar em `versioning`-like.
> Cobrir: migração (documento v4 real + cadeia completa), cada invariante violada → erro certo,
> todas as transições válidas e uma amostra exaustiva das inválidas, inverso de cada comando,
> CT-GOV-04 (congelamento). Fixture nova `tests/fixtures/` com uma mini-política (2 seções,
> 3 regras, 1 componente MATRIX).
>
> ### Critérios de aceite
> - Documento v4 real abre, migra para v5 e re-salva canonicamente (serialize estendido).
> - Todas as invariantes e transições testadas; comandos com inverso exato.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes; orçamento de 1,5 MB ok;
>   `dist/PolicyOps.html` atualizado no commit.
>
> ### Fora do escopo
> Qualquer tela (S33/S35), editor rico funcional (S34), publicação via DB/release (S36), pacote
> (S38), fotografia histórica (S39), import (S40).
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/03-modelo-do-documento.md` (schema 5 completo + nota de migração §10),
> `docs/05-regras-de-negocio.md` §9 (erros E-GOV), `docs/08-camada-de-comandos.md` (comandos
> novos), `docs/14-governanca-de-alteracoes.md` (marcar §3 como fechado, apontando docs/03),
> `docs/13-decisoes.md` (decisões tomadas na sessão) e a linha da S32 em `docs/09`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → pare e pergunte.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
