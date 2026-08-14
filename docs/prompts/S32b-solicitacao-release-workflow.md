# Sessão 32b — Solicitação de Alteração, release e workflow (núcleo)

**Modelo:** `Opus` · **Depende de:** S32a · **Épico/Marco:** Governança (M11)
· **Executar antes de:** S35

> **Por que Opus:** o grafo de 12 estados, o congelamento pós-aprovação (I25) e a unicidade de
> codes (I26) são as regras que a S36 usa para publicar de forma atômica. Item de DB apontando
> rascunho órfão, ou escopo alterado depois da aprovação, corrompe a trilha de governança em
> silêncio — o perfil de risco que justificou Opus na S32a.

> **Por que existe:** esta sessão é a segunda metade da antiga S32. A carga inicial da política
> (S40) foi antecipada (DEC-GOV-010) e não depende de nada daqui, então o que só a S35 consome
> saiu do caminho crítico. **Não é sessão opcional**: sem ela a S35 não tem comandos para chamar.

## Prompt

> Você está implementando a Sessão 32b do PolicyOps — o núcleo (sem tela) das Solicitações de
> Alteração (DB), das releases e do workflow que as governa.
>
> **Leia antes de começar:** `docs/14-governanca-de-alteracoes.md` §3.3 (DB), §3.4 (release), §5
> (grafo — normativo), §6 (RN-GOV-01/02/03/04, I25, I26); `docs/03-modelo-do-documento.md`
> (schema 5, fechado na S32a); `docs/08-camada-de-comandos.md`; DEC-GOV-003, 004, 008, 010.
>
> ### Estado atual
> A S32a entregou `schemaVersion: 5` com `ChangeRequest`, `ChangeRequestItem`, `Release`,
> `Attachment` e `RichDoc` **já declarados no schema Zod e migrados**, mas sem nenhum comando,
> validação de workflow ou invariante própria — as coleções existem vazias. Componentes e versões
> de componente têm comandos com inverso e ciclo de vida completo. O catálogo `E-GOV-01..06`
> existe em `errors.ts`, com os erros de workflow ainda não disparados por ninguém.
>
> ### Objetivo
> O documento sabe representar e validar uma Solicitação de Alteração ao longo do workflow, com
> itens, aprovações e releases — tudo por comandos com inverso e coberto por testes. Publicar
> continua sendo a S36.
>
> ### Escopo
> 1. **Invariantes** em `validate.ts`: I25 (DB com status ≥ `APPROVED` tem itens imutáveis;
>    `draftVersionId` de um item aponta rascunho cujo `changeRequestId` é o próprio DB) e I26
>    (`ChangeRequest.code` e `Release.code` únicos no documento e imutáveis após criação). Ligue os
>    erros `E-GOV-01..04` do catálogo criado na S32a.
> 2. **Comandos de DB**: `changeRequest/create`, `/update`, `/addItem`, `/removeItem`,
>    `/updateItem`, `/cancel`, todos com inverso exato. `addItem`/`removeItem` respeitam RN-GOV-02
>    (um componente não aparece duas vezes no mesmo DB) e o congelamento de I25.
> 3. **Workflow**: `changeRequest/transition` validando **exclusivamente** o grafo do §5
>    (RN-GOV-01) e gravando evento com autor e data; `SUBMITTED` exige ≥1 motivador, ≥1 item com
>    `proposedSummary` e vigência proposta (RN-GOV-03, `E-GOV-03`). `PUBLISHED` é inalcançável por
>    este comando — só a publicação da S36 chega lá.
> 4. **Aprovações**: `changeRequest/approve|return|reject` gravando `{by, at, decision, comment}`
>    em `approvals`; devolução exige comentário. **Aprovar não publica nada** (RN-GOV-04): nenhuma
>    versão muda de estado.
> 5. **Releases**: CRUD de `Release` (`release/create`, `/update`, `/cancel`), vínculo
>    `ChangeRequest.releaseId` e as validações **estáticas** de composição (quais DBs estão prontos
>    para entrar numa release). A publicação em lote e o rebase são a S36.
>
> ### Testes
> `tests/unit/` espelhando os módulos novos, 100% de cobertura. Cobrir: todas as transições válidas
> e uma amostra exaustiva das inválidas → `E-GOV-01`; RN-GOV-03 item a item; CT-GOV-02 (aprovar não
> publica) e CT-GOV-04 (item congelado após aprovação, e a devolução por `CHANGES_REQUESTED`
> reabrindo a edição sem perder o histórico de aprovação); inverso de cada comando; I25/I26
> violadas → erro certo.
>
> ### Critérios de aceite
> - O caminho `DRAFT → SUBMITTED → IN_REVIEW → APPROVED` do CT-GOV-01 roda por comandos, sem tela.
> - Nenhuma transição fora do grafo passa; `PUBLISHED` não é atingível por `transition`.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes; 1,5 MB ok;
>   `dist/PolicyOps.html` atualizado no commit.
>
> ### Fora do escopo
> Qualquer tela (S35), vínculo com rascunhos na publicação, congelamento aplicado na publicação e
> rebase (S36), publicação em lote de release (S37), pacote (S38).
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/05-regras-de-negocio.md` §9 (erros E-GOV ligados),
> `docs/08-camada-de-comandos.md` (comandos novos), `docs/14-governanca-de-alteracoes.md` (§3.3,
> §3.4 e §5 marcados como fechados), `docs/13-decisoes.md` se houver decisão nova, e a linha da
> S32b em `docs/09`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → pare e pergunte.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
