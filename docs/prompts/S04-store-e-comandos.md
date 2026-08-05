# Sessão 04 — Store, comandos e undo/redo

**Modelo: `Opus`** · **Depende de:** S02 (S03 recomendado antes)

---

> **Por que Opus:** o command pattern com inverso é o que garante que nada se perca. Um inverso mal calculado destrói dados na hora em que o usuário aperta Ctrl+Z — e ele confia que aquilo é seguro. Além disso, esta sessão fixa as invariantes de versionamento, que são imutáveis depois de publicadas.

## Prompt

> Você está implementando a Sessão 04 do Policy Matrix Studio — a camada de comandos.
>
> **Leia antes de começar:** `docs/08-camada-de-comandos.md` por inteiro e `docs/05-regras-de-negocio.md` §0, §1 e §2. As cinco regras invioláveis de §1 do primeiro documento comandam todo o desenho.
>
> ### Objetivo
> Toda mutação do documento passa a ser um comando puro, inversível e auditado, com pilha de undo/redo funcionando. Nenhuma tela nova nesta sessão.
>
> ### Escopo
>
> #### 1. Infraestrutura — `src/core/command.ts`
> O tipo `Command`, `CommandResult` e `Ctx` de `docs/08-camada-de-comandos.md` §1. As cinco regras:
> 1. **Puro** — sem `Date.now()`, sem `Math.random()`, sem `window`; tudo vem de `ctx`. É o que torna os testes determinísticos, e é inegociável.
> 2. **Imutável** — devolve documento novo (use Immer); nunca muta o recebido. Teste que o original permanece intacto após cada comando.
> 3. **Inversível** — devolve o `inverse`. Comandos sem inverso natural (`version/publish`, `version/discardDraft`) devolvem um inverso que falha explicitamente com uma mensagem clara.
> 4. **Valida antes de tocar** — nenhum estado parcial em caso de erro.
> 5. **Registra** — todo comando produz seus `DocEvent`, com `summary` em frase pronta pt-BR.
>
> #### 2. Ciclo de vida — `src/core/versioning/lifecycle.ts`
> Implemente `docs/05-regras-de-negocio.md` §1 exatamente:
> - `matrix/create` (§1.1) — resolve versões PUBLISHED das variáveis de cada nível, monta os eixos com snapshot e `generateTuples`, valida I13/I14/I16, cria v1 DRAFT com `cells: {}`;
> - `version/createDraft` (§1.2) — clone integral, incluindo tuplas e supressões; aceita `baseVersionId` explícito (é o que implementa "restaurar versão histórica");
> - `version/publish` (§1.3) — as **seis validações na ordem especificada** e os quatro efeitos;
> - `version/discardDraft` (§1.4) — queima o número da versão;
> - **`assertEditable`** (§1.5) — chamado por **todo** comando que toca `axes` ou `cells`. É a guarda mais importante do sistema.
>
> Publicação retroativa é rejeitada; agendada é aceita.
>
> #### 3. Células — `src/core/versioning/cells.ts`
> `version/applyCellPatch` conforme §2:
> - semântica de três estados por campo: ausente = não mexe, `null` = limpa, valor = define;
> - célula que fica sem nenhum campo é **removida** do mapa (não vira objeto vazio);
> - `attrs` com merge raso, `null` removendo a chave;
> - todas as validações de §2.2;
> - o **patch inverso** reconstrói o estado anterior campo a campo, inclusive campos que estavam ausentes (viram `null` no inverso);
> - evento `CELLS_UPDATED` com before/after limitado a 500 células.
>
> #### 4. Store — `src/store/document-store.ts`
> Zustand conforme `docs/08-camada-de-comandos.md` §2:
> - `dispatch` executa, substitui o documento, empilha, limpa o redo, marca `dirty`;
> - pilha de **100**;
> - erro não altera o documento e não empilha;
> - `undo`/`redo` aplicam o comando guardado — e o resultado deles também é um comando dispatchado (gera evento próprio, o que é intencional e deve estar documentado na interface);
> - `version/publish` limpa a pilha de undo daquela versão.
>
> #### 5. Consultas — `src/core/queries.ts`
> As funções de leitura de `docs/08-camada-de-comandos.md` §4. `getEditorView` é a mais importante: devolve tudo que o grid precisa (eixos, layout de cabeçalhos via S03, células, catálogo, estatísticas, defasagem) e é **memoizada por `(versionId, referência do documento)`**. Recalcular o layout a cada render de célula é o erro de desempenho mais provável do projeto — evite-o desde já e escreva um teste que conte quantas vezes o cálculo roda.
>
> #### 6. Comandos restantes
> Implemente também os comandos de projeto e os de metadados de matriz (`docs/08-camada-de-comandos.md` §3). Os de biblioteca ficam para S06–S08; os de eixo, para S12.
>
> ### Testes — 100% em `versioning/`
>
> - **I3 é sagrado**: para **cada** comando que escreve, um teste provando que ele falha com `VERSION_IMMUTABLE` em versão PUBLISHED, SUPERSEDED e ARCHIVED.
> - I1: dois rascunhos na mesma matriz → `DRAFT_ALREADY_EXISTS`.
> - I2: publicar supersede a anterior; nunca há duas PUBLISHED.
> - I4: após três publicações, os intervalos são contíguos e sem sobreposição; a versão certa é encontrada antes, durante e **no instante exato** de cada troca.
> - I6: publicar com pendência → `UNSET_CELLS_REMAIN` com a lista de coordenadas.
> - **Snapshot**: publicar nova versão de variável **não altera** nenhuma matriz — nem publicada, nem rascunho. Este é o teste mais importante do projeto; escreva-o explícito e comentado.
> - **Patch**: as 3 semânticas por campo; célula esvaziada some do mapa; `attrs` com merge e remoção.
> - **Round-trip do inverso**: aplicar um patch misto sobre 10 células (algumas cheias, algumas ausentes), aplicar o inverso, e verificar que o documento resultante é **deep-equal** ao original. Não compare contagens — compare o objeto inteiro.
> - **Pureza**: o mesmo comando com o mesmo `ctx` produz resultado idêntico, e o documento de entrada não é mutado.
> - Undo/redo: 10 operações, desfazer todas, refazer todas, documento idêntico ao final.
> - `discardDraft` queima o número.
>
> ### Critérios de aceite
> - Cobertura 100% em `src/core/versioning/`.
> - O round-trip do inverso passa com documento deep-equal.
> - Nenhum comando usa `Date.now()`, `Math.random()` ou `window` — verifique com uma regra de lint própria.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes, tamanho no orçamento.
>
> ### Fora do escopo
> Persistência em arquivo (S05). Telas. Comandos de eixo (S12) e de biblioteca (S06–S08).
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push.
