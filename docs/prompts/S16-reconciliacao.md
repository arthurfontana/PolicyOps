# Sessão 16 — Reconciliação da biblioteca

**Modelo: `Opus`** · **Depende de:** S13 (recomendado após S15)

---

> **Por que Opus:** é a operação que decide como a evolução da biblioteca entra numa matriz em andamento, criando e destruindo combinações. Feita errada, apaga trabalho do usuário ou — pior — corrompe o snapshot que garante o lastro histórico. É a segunda sessão de maior custo de erro, depois da S04.

## Prompt

> Você está implementando a Sessão 16 do Policy Matrix Studio — adoção de novas versões da biblioteca dentro de uma matriz.
>
> **Leia antes de começar, com atenção máxima:** `docs/05-regras-de-negocio.md` §5 por inteiro (§5.2 detecção, §5.3 preview, §5.4 aplicação, §5.5 propagação) e `docs/01-visao-e-escopo.md` §5 (o porquê de tudo isso existir).
>
> ### O princípio que não pode ser violado
> Uma versão `PUBLISHED` ou `SUPERSEDED` **jamais** é tocada por esta funcionalidade. Nenhuma exceção, nenhum caso especial, nenhuma "correçãozinha". Se um caminho do seu código puder alterar o snapshot de uma versão publicada, o recurso está errado. **Escreva o teste que prova isso antes de escrever a funcionalidade.**
>
> ### Objetivo
> Quando a biblioteca ganha `R7`, ou quando a regra Segmento × Faturamento passa a permitir Varejo até 5M, permitir que um rascunho adote a mudança de forma explícita, controlada e desfazível.
>
> ### Escopo
>
> #### 1. Detecção de defasagem — `src/core/reconcile/stale.ts`
> Conforme §5.2, um eixo está defasado quando **qualquer** uma for verdadeira:
> - algum `level.variableVersionId` aponta para versão que não é mais `PUBLISHED`;
> - alguma regra em `derivedFrom.compatibilityVersionIds` não é mais `PUBLISHED`;
> - **passou a existir** uma regra publicada para um par adjacente que não tinha regra quando as tuplas foram geradas.
>
> O terceiro caso é o mais fácil de esquecer e o mais surpreendente para o usuário — cubra-o com teste próprio.
>
> `getStaleAxes(doc)` lista todos os rascunhos com eixo defasado, para a tela de impacto e para a de rascunhos.
>
> #### 2. `previewResnapshot(doc, versionId, role)` — §5.3
> Não grava nada. Recalcula o que o eixo seria hoje e devolve o `ResnapshotPlan` completo: mudanças por nível (pin, domínios adicionados/removidos/renomeados/reordenados), mudanças de compatibilidade, tuplas que entram e saem, contagens, **as células que seriam descartadas na íntegra**, e os `TupleWarning`.
>
> Se nada estiver defasado → `AXIS_NOT_STALE`.
>
> #### 3. `axis/resnapshot` — §5.4
> Comando, no contrato da S04. Em ordem:
> 1. `assertEditable` — primeiro, sempre;
> 2. atualiza `variableVersionId` e o snapshot de domínios de cada nível;
> 3. regenera `tuples` com as regras publicadas atuais, preservando `manualSuppressions` ainda aplicáveis;
> 4. atualiza `derivedFrom.compatibilityVersionIds`;
> 5. células cujas tuplas sobreviveram são **preservadas integralmente**, casadas por caminho;
> 6. combinações novas ficam ausentes de `cells` → contam como pendentes;
> 7. combinações que sumiram têm as células removidas, com conteúdo **íntegro** no payload do evento;
> 8. evento `AXIS_RESNAPSHOTTED`;
> 9. `inverse` restaura snapshot, tuplas e células anteriores — desfazer precisa funcionar por completo.
>
> Depois disso, I6 bloqueia a publicação até as novas combinações serem preenchidas. É exatamente o comportamento desejado: **o usuário decide como tratar as células novas**.
>
> **Casos de borda de §5.4, todos tratados explicitamente:**
> - domínio removido e outro criado com o mesmo `code` → substituição: célula nasce vazia, não herda;
> - renomear domínio (mesmo `code`) → célula preservada, rótulo atualizado, não é mudança de conteúdo;
> - reordenar domínios → células preservadas, ordem das tuplas muda;
> - regra de compatibilidade que passa a **excluir** combinações → `removedTuples`;
> - regra que passa a **incluir** → `addedTuples`, pendentes;
> - regra que **passa a existir** onde não havia → normalmente reduz tuplas;
> - resnapshot de X e depois de Y em sequência, sem recarregar;
> - variável do nível arquivada desde o snapshot.
>
> #### 4. Interface
>
> **Badge de defasagem** no inspector, ao lado de cada nível e de cada par com regra, **apenas em versões `DRAFT`** (§5.2 — em publicadas o badge **não** aparece; elas são registro, não pendência). Texto explícito: *"Score HVI3 — v1 pinada, v2 disponível"* ou *"Regra Segmento × Faturamento — v1 pinada, v2 disponível"*.
>
> **Diálogo de reconciliação**, abrindo o preview antes de qualquer gravação:
> - título: *"Atualizar o eixo Y para as versões mais recentes da biblioteca"*;
> - blocos: **Mudanças por nível** (pin, domínios), **Mudanças de compatibilidade**, **Combinações que entram** (com aviso "gera 6 células novas que você precisará preencher"), **Combinações que saem** (com aviso destacado "12 células serão descartadas — o conteúdo fica registrado na auditoria");
> - preview do grid resultante com as novas hachuradas e as que saem riscadas em vermelho;
> - confirmação exigindo digitar o nome do eixo quando houver descarte;
> - após aplicar: toast com resumo, seleção automática das combinações novas, e a barra de pendências da S13 apontando quantas faltam.
>
> **Tela de impacto nas bibliotecas** (variáveis e compatibilidade): além do uso, listar os rascunhos que podem adotar a nova versão, com link direto para o diálogo de reconciliação de cada um. **Nada em lote** — a adoção é sempre matriz a matriz, por decisão de produto.
>
> ### Testes — este bloco é obrigatório e não pode ser reduzido
>
> - **O teste que prova o princípio:** publicar v2 de `SCORE_HVI3` com `R7`, aplicar resnapshot num rascunho, e verificar que a versão PUBLISHED da matriz mantém **exatamente** os mesmos domínios, tuplas e células, com todos os campos inalterados. Compare os objetos inteiros, não contagens. Comente o teste explicando por que ele existe.
> - O mesmo teste para uma nova versão de **regra de compatibilidade**.
> - `axis/resnapshot` em versão PUBLISHED falha com `VERSION_IMMUTABLE`.
> - Domínio adicionado gera exatamente `|tuplas do outro eixo|` combinações novas, todas pendentes.
> - Domínio removido descarta exatamente as combinações certas, e o payload do evento contém **todos** os campos de cada célula descartada.
> - Domínio renomeado preserva a célula integralmente.
> - Reordenação preserva conteúdo e muda a ordem das tuplas.
> - `code` removido e recriado é tratado como substituição.
> - Regra que passa a existir onde não havia é detectada como defasagem.
> - Após resnapshot com adições, publicar falha com `UNSET_CELLS_REMAIN`; após preencher, publica.
> - Resnapshot em X e depois em Y produz o conjunto de combinações correto.
> - `previewResnapshot` **não grava nada** — compare o documento antes e depois.
> - **Inverso restaura o documento deep-equal ao original.**
> - E2E completo: adicionar `R7` na biblioteca → publicar variável → abrir rascunho da matriz → badge aparece → reconciliar → combinações novas hachuradas → preencher → publicar.
> - E2E de compatibilidade: alterar a regra para Varejo aceitar `1M_10M` → publicar → reconciliar → 6 combinações novas aparecem.
>
> ### Critérios de aceite
> - Os dois cenários E2E funcionam ponta a ponta no navegador.
> - Nenhuma versão publicada é alterada em nenhum caminho de código.
> - O conteúdo das células descartadas é recuperável a partir da auditoria.
> - Desfazer um resnapshot restaura tudo.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes, tamanho no orçamento.
>
> ### Fora do escopo
> Adoção em lote em várias matrizes. Templates e merge (S17).
>
> ### Encerramento
> Commit com `dist/PolicyOps.html` atualizado, e push.
