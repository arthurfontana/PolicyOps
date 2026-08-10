# Sessão 24 — Aplicação da Carga e Versionamento Seletivo

**Modelo: `Opus`** · **Depende de:** S22, S23 · **Épico: Carga · Marco M6**

> **Por que Opus:** é o comando que escreve em lote sobre dezenas de matrizes de uma vez, com
> tudo-ou-nada como requisito, undo íntegro e a regra que dá sentido ao épico inteiro — matriz
> inalterada não recebe rascunho. Errar aqui corrompe o lastro histórico em silêncio ou grava
> metade de um lote, exatamente o perfil que justificou Opus em 04/05/16.

---

## Prompt

> Você está implementando a Sessão 24 do Policy Matrix Studio — a aplicação da carga: os passos 5
> e 6 do assistente, o comando `import/apply`, a fila de revisão e o perfil salvo. É a sessão que
> fecha o marco M6.
>
> **Leia antes de começar:** `docs/12-carga-de-matrizes.md` §2 (US-05 a US-08, US-10), §3 (todos
> os CTs), §4 (RN-01 a RN-20), §5.4, §5.5 e §6; `docs/05-regras-de-negocio.md` §1 (ciclo de vida)
> e §10; `docs/08-camada-de-comandos.md` §1 e a seção Carga de matrizes; `docs/13-decisoes.md`
> DEC-CARGA-005, 006, 009 e 010. Não tome decisão de arquitetura fora do documentado — **pare e
> pergunte**.
>
> ### Estado atual
> A S21 entregou o motor (`planImport` classificando 102 matrizes, testado com o CSV real). A S22
> entregou os passos 1–4 do assistente e o passo 5 somente-leitura. A S23 entregou
> `importProfiles` no documento, `Matrix.tags`, `matrix/setTags` e o filtro por facetas. Nada
> ainda cria matriz ou rascunho a partir de um arquivo.
>
> ### Objetivo
> O usuário revisa o plano, escolhe o que aplicar, e a carga cria as matrizes novas e um rascunho
> **só** nas matrizes que mudaram — nada é publicado, e o que veio idêntico não é tocado.
>
> ### Escopo
>
> #### 1. Comando `import/apply` — `src/core/import/apply.ts`
> Entrada e saída conforme `docs/12` §5.4. Ordem obrigatória (a regra 4 de
> `docs/08-camada-de-comandos.md` §1 — validar antes de tocar):
> 1. recalcula `planImport` sobre o documento corrente e compara com `planHash`; divergiu →
>    `IMPORT_PLAN_STALE`, **nada gravado** (RN-14, CT-11);
> 2. valida a seleção: só `NEW` e `CHANGED` são aplicáveis (`IMPORT_STRUCTURE_DIVERGED`,
>    `IMPORT_TARGET_HAS_DRAFT`, `IMPORT_NOTHING_TO_APPLY`);
> 3. para cada `NEW`: `matrix/create` com os eixos do perfil, tags do perfil, `axis/suppressTuples`
>    para as tuplas não observadas (RN-21, DEC-CARGA-011) e o patch de células na v1 `DRAFT`;
> 4. para cada `CHANGED`: `version/createDraft` a partir da publicada e **um patch com apenas as
>    células que mudam** — não reescreva o grid inteiro;
> 5. tags: sempre `add`, nunca `remove` (RN-12);
> 6. eventos: um `IMPORT_RUN` no documento e `importRunId` no payload de cada `MATRIX_CREATED`,
>    `DRAFT_CREATED` e `CELLS_UPDATED` produzidos.
>
> Reaproveite os comandos existentes de `src/core/versioning/` e `src/core/document/commands.ts`
> compondo-os — não duplique a lógica de criação de matriz nem de patch. O inverso do comando
> descarta os rascunhos e remove as matrizes criadas, restaurando o documento anterior; teste o
> round-trip. Matriz `UNCHANGED` não pode aparecer em **nenhum** evento (RN-02, CT-01, CT-02).
>
> #### 2. Passo 5 — plano interativo
> Evolui a lista somente-leitura da S22: seleção por matriz e em massa por estado, filtros por
> estado e por tag, ordenação por células alteradas, busca por código, e expansão que abre o diff
> completo no `CompareView` existente (`docs/07-ux-e-editor.md` §9) dentro de um painel do
> assistente. Inalteradas recolhidas por padrão, com contagem. Estados `STRUCTURAL`, `BLOCKED` e
> `ABSENT_IN_FILE` aparecem com o motivo e a ação sugerida, não selecionáveis.
>
> #### 3. Passo 6 — aplicar
> Nota da carga (mínimo 10 caracteres, é o padrão da nota de cada publicação futura), resumo em
> números do que vai acontecer ("cria 2 rascunhos; não publica nada"), e a ação. Ao concluir:
> relatório com o que foi criado e o atalho para a fila de revisão. Oferece **"Salvar como
> perfil"** (`importProfile/save`) com código e nome; se o perfil veio reconhecido pelo cabeçalho,
> oferece atualizar o existente.
>
> #### 4. Fila de revisão
> `DraftsScreen` ganha filtro por `importRunId` e, por item: resumo semântico, "Ver diff",
> "Marcar como revisado" (estado de interface, no `ui-store` — **não** é campo do documento) e
> "Publicar". Botão de lote "Publicar revisados" que chama `version/publish` item a item com a
> nota da carga, para no primeiro erro e informa o que foi publicado. Rascunho de carga exibe a
> origem no inspector: *"Criado pela carga CINEMINHA_20260708 em 10/08/2026"*.
>
> #### 5. Reconhecimento de perfil
> No passo 1, `matchImportProfile` reconhece o cabeçalho e o assistente oferece ir direto ao
> plano, informando o perfil aplicado; cabeçalho diferente mostra a diferença coluna a coluna e
> exige confirmação para seguir no mapeamento manual (RN-19, CT-12).
>
> ### Testes
> - Unitários de `import/apply`: **CT-01** (segunda carga idêntica não cria rascunho nenhum),
>   **CT-02** (só a alterada é versionada; as outras 101 sem evento), **CT-10** (matriz com
>   rascunho aberto fica bloqueada), **CT-11** (plano obsoleto falha sem gravar), **CT-14**
>   (aplicação parcial por seleção), **CT-13** (tags acrescentadas não apagam manuais).
> - Inverso: aplicar e desfazer devolve o documento estruturalmente idêntico ao anterior.
> - Atomicidade: erro no meio do lote (por exemplo, catálogo faltando na décima matriz) não deixa
>   nenhuma das nove anteriores gravada.
> - Componente: seleção em massa por estado; expansão do diff; passo 6 com seleção vazia
>   desabilitado.
> - E2E completo do épico: documento vazio → carga do recorte real → 102 matrizes criadas →
>   publicar todas → alterar 5 células do arquivo → segunda carga → **exatamente 1 matriz
>   alterada** com 5 células, as outras 101 intocadas → publicar → terceira carga do mesmo
>   arquivo → "nenhuma alteração a aplicar". Cobre **CT-15**.
> - Desempenho: `import/apply` de 102 matrizes em menos de 2 s.
>
> ### Critérios de aceite
> - Carregar o mesmo arquivo duas vezes: na segunda, zero rascunhos, zero eventos de matriz, e a
>   mensagem "nenhuma alteração a aplicar".
> - Uma célula alterada no arquivo produz um rascunho, numa matriz, com uma célula alterada.
> - Toda matriz criada pela carga nasce com **zero combinações pendentes** e é publicável na
>   sequência, sem nenhum ajuste manual de eixo (CT-16).
> - Nenhuma versão é publicada pelo assistente, em nenhum caminho.
> - Um documento carregado, salvo e reaberto passa na validação com `schemaVersion: 3` e
>   `importProfiles` preenchido.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes,
>   orçamento de 1,5 MB respeitado, `dist/PolicyOps.html` atualizado.
>
> ### Fora do escopo
> Resolver estrutura divergente (S25): matriz `STRUCTURAL` continua listada e não aplicável.
> Reverter uma carga inteira depois de salva — o undo cobre a sessão aberta, e cada rascunho é
> descartável pelo fluxo normal (`docs/12` §7).
>
> ### Atualização da documentação (obrigatório)
> `docs/12-carga-de-matrizes.md` (§2, §5 e §6 refletindo o que foi implementado, e o estado da
> página passa a ✅ nas partes entregues), `docs/07-ux-e-editor.md` §14,
> `docs/08-camada-de-comandos.md`, `docs/13-decisoes.md` para decisões novas, e a linha da sessão
> 24 e o marco M6 em `docs/09-roadmap-de-entregas.md`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Sem dependência nova. `src/core/` puro. Decisão não
> coberta pela documentação: **pare e pergunte**.
>
> ### Encerramento
> Commit descritivo na branch de trabalho, com `dist/PolicyOps.html` atualizado, e push.
