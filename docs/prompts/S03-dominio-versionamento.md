# Sessão 03 — Camada de domínio: versionamento e snapshot

**Modelo recomendado: `Opus`**
**Depende de:** S02
**Marco:** o coração do sistema

---

> **Por que Opus:** esta sessão implementa as invariantes que impedem corrupção silenciosa de dados históricos. Um erro aqui não quebra a aplicação — ele destrói o lastro das políticas publicadas meses depois, sem aviso. É a sessão de maior custo de erro do projeto.

## Prompt

> Você está implementando a Sessão 03 do Policy Matrix Studio — a camada de domínio.
>
> **Leia por inteiro, antes de escrever código:** `docs/02-especificacao-tecnica.md`, `docs/03-modelo-de-dados.md` e, com atenção especial, `docs/04-regras-de-negocio.md`. As seções §1 (ciclo de vida), §2 (patch de células) e §7 (auditoria) são a especificação literal do que você vai construir.
>
> ### Objetivo
> Implementar toda a lógica de versionamento, snapshot e edição de células como serviços puros e exaustivamente testados. **Nenhuma UI nesta sessão.** Ao final, a aplicação não muda visualmente — mas passa a ter fundação correta.
>
> ### Escopo
>
> #### 1. `src/server/services/snapshot-service.ts`
> - `snapshotAxis(tx, { matrixVersionId, role, variableVersionId, label })` — copia `VariableDomain` → `MatrixAxisDomain`, preservando `code`, `label`, `shortLabel`, `position`, `color` e todos os campos de faixa, gravando `sourceDomainId`.
> - `cloneAxes(tx, fromVersionId, toVersionId)` — clona eixos e snapshots mantendo o mesmo pin.
> - `generateCartesianCells(tx, versionId, defaults?)` — cria o produto cartesiano dos snapshots.
> - `cloneCells(tx, fromVersionId, toVersionId)` — clone integral, preservando todos os atributos e `isUnset`.
>
> #### 2. `src/server/services/version-service.ts`
> Implemente exatamente as regras de `docs/04-regras-de-negocio.md` §1:
> - `createMatrix(input, actor)` — §1.1, incluindo a resolução da `VariableVersion` PUBLISHED e o erro `VARIABLE_HAS_NO_PUBLISHED_VERSION`.
> - `createDraftFrom(matrixId, actor)` — §1.2. O clone **não** atualiza pins automaticamente.
> - `publishDraft(versionId, { effectiveFrom?, notes? }, actor)` — §1.3, com as cinco validações **na ordem especificada** e os quatro efeitos transacionais. Publicação retroativa é rejeitada; agendamento futuro é permitido.
> - `discardDraft(versionId, actor)` — §1.4. O número de versão é queimado, nunca reutilizado.
> - `assertVersionEditable(tx, versionId)` — §1.5. **Esta é a guarda mais importante do sistema.** Toda função que escreve em cells/axes/axisDomains chama esta antes de qualquer coisa.
>
> Tudo em `prisma.$transaction`. Toda operação registra o evento de auditoria correspondente com o payload de §7 e um `summary` em pt-BR.
>
> #### 3. `src/server/services/cell-service.ts`
> - `applyCellPatch(versionId, patch, actor)` conforme §2:
>   - semântica de três estados por campo: **ausente** = não mexe, `null` = limpa, valor = define;
>   - recálculo de `isUnset` (fica `false` quando `decisionItemId` está preenchido);
>   - merge raso em `attributes`, com `null` removendo a chave;
>   - todas as validações de §2.2, incluindo `CATALOG_KIND_MISMATCH` e o teto de 2.000 coordenadas;
>   - retorno inclui o **patch inverso** (`invert`), calculado a partir do estado anterior — é isso que alimenta o undo do cliente na Sessão 08. Ele precisa reconstruir fielmente o estado anterior, inclusive campos que eram `null`;
>   - um evento `CELLS_UPDATED` por patch, com before/after limitado a 500 células (acima disso, só contagem e campos).
>
> #### 4. `src/server/services/timeline-service.ts`
> - `getEffectiveVersion(matrixId, at)` com o intervalo semiaberto `[from, to)` de §6.
> - `getPortfolioAt(projectId, at)`.
> - `getVersionTimeline(versionId)`.
>
> #### 5. `src/server/services/query-service.ts`
> - `getMatrixVersionForEditor(versionId)` devolvendo o `EditorPayload` **exato** de `docs/06-api.md` §3: array plano de células, decimais como string, `isStale` calculado por eixo. Uma consulta montada — sem N+1. Escreva um teste que conte as queries emitidas.
> - `listMatrixVersions(matrixId)`.
>
> #### 6. Server Actions
> `src/server/actions/version-actions.ts` e `matrix-actions.ts`, cobrindo as actions de `docs/06-api.md` §1 que pertencem a estes services (`createMatrix`, `createDraft`, `applyCellPatch`, `publishDraft`, `discardDraft`, `addVersionNote`, e o CRUD de projeto). Cada uma: `withAction` → `requireRole` → parse Zod → service → `revalidatePath`. **Zero regra de negócio dentro da action.**
>
> Schemas Zod em `src/lib/schemas/`, reaproveitáveis pelos formulários das sessões seguintes.
>
> ### Testes — obrigatoriamente 100% de cobertura em `version-service` e `cell-service`
>
> Cubra, no mínimo, um teste por item:
> - I1: criar dois rascunhos para a mesma matriz falha com `DRAFT_ALREADY_EXISTS`.
> - I2: publicar com outra versão vigente supersede a anterior, e nunca há duas PUBLISHED.
> - I3: `applyCellPatch` em versão PUBLISHED falha com `VERSION_IMMUTABLE`. Idem SUPERSEDED. **Teste isso para cada função que escreve.**
> - I4: após três publicações, os intervalos de vigência são contíguos e não se sobrepõem; `getEffectiveVersion` devolve a versão certa para datas antes, durante e exatamente no instante de cada troca.
> - I5: o conjunto de células é exatamente o cartesiano dos snapshots.
> - I6: publicar com célula `isUnset` falha com `UNSET_CELLS_REMAIN` e a lista de coordenadas pendentes.
> - Snapshot: publicar uma nova versão da variável **não altera** nenhuma matriz existente — nem publicada, nem rascunho. Este é o teste mais importante do projeto; escreva-o de forma explícita e comentada.
> - Patch: os três estados por campo; `isUnset` recalculado; `invert` aplicado sobre o resultado restaura o estado original **byte a byte** (teste com round-trip sobre um conjunto misto de células cheias e vazias).
> - `discardDraft` queima o número de versão.
> - Publicação retroativa rejeitada; agendada aceita e a consulta de vigência continua correta.
>
> ### Critérios de aceite
> - Todos os testes acima passam; cobertura de `version-service`, `cell-service` e `snapshot-service` em 100% de linhas e branches.
> - `getMatrixVersionForEditor` da matriz de exemplo do seed devolve payload conforme o contrato, com 24 células.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes.
>
> ### Fora do escopo
> Qualquer componente React. Diff (S10). Resnapshot (S12). Variáveis e catálogo (S04/S05).
>
> ### Se algo estiver ambíguo
> Pare e pergunte. Não invente regra de versionamento — a especificação foi escrita para não deixar essa decisão em aberto.
>
> ### Encerramento
> Commit descritivo e push.
