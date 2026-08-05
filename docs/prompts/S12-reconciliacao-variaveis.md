# Sessão 12 — Reconciliação de evolução de variáveis

**Modelo recomendado: `Opus`**
**Depende de:** S09 (recomendado após S11)

---

> **Por que Opus:** é a operação que reescreve a estrutura de uma versão em andamento, criando e destruindo células. Feita errada, apaga trabalho do usuário ou — pior — corrompe o snapshot que garante o lastro histórico. É a segunda sessão de maior custo de erro, depois da S03.

## Prompt

> Você está implementando a Sessão 12 do Policy Matrix Studio — adoção de novas versões de variável dentro de uma matriz.
>
> **Leia antes de começar, com atenção máxima:** `docs/04-regras-de-negocio.md` §4 por inteiro (§4.2 detecção, §4.3 preview, §4.4 aplicação, §4.5 matriz de propagação) e `docs/01-visao-e-escopo.md` §4 (o porquê de tudo isso existir).
>
> ### O princípio que não pode ser violado
> Uma versão `PUBLISHED` ou `SUPERSEDED` **jamais** é tocada por esta funcionalidade. Nenhuma exceção, nenhum caso especial, nenhuma "correçãozinha". Se um caminho do seu código puder alterar o snapshot de uma versão publicada, o recurso está errado. Escreva o teste que prova isso antes de escrever a funcionalidade.
>
> ### Objetivo
> Quando a biblioteca ganha `R6`, permitir que um rascunho adote a nova versão da variável de forma explícita, controlada e reversível por descarte.
>
> ### Escopo
>
> #### 1. `src/server/services/reconcile-service.ts`
>
> **`previewResnapshot(versionId, role): ResnapshotPlan`** — §4.3. Não grava nada. Casa domínios por `code` entre o snapshot atual e a `VariableVersion` PUBLISHED da variável, classificando em adicionados / removidos / renomeados / reordenados, com `newCellCount` e `droppedCellCount`. Se o eixo não estiver defasado, erro `AXIS_NOT_STALE`.
>
> **`applyResnapshot(versionId, role, { onRemoved: 'delete' })`** — §4.4, em transação:
> 1. `assertVersionEditable` primeiro, sempre.
> 2. Atualiza `axis.variableVersionId` para o novo pin.
> 3. Recria `MatrixAxisDomain` a partir dos novos domínios, **preservando o `id` dos domínios cujo `code` já existia** (não delete-and-recreate cego — isso invalidaria rastreabilidade).
> 4. Domínios adicionados → cria as células do novo cruzamento com `isUnset = true`.
> 5. Domínios removidos → exclui as células correspondentes, gravando **todo** o conteúdo delas no payload do evento antes de excluir. É o único delete físico do sistema, e o dado precisa sobreviver na auditoria de forma que permita reconstrução manual.
> 6. Renomeados/reordenados → célula preservada, `label`/`position` atualizados.
> 7. Evento `AXIS_RESNAPSHOTTED` com o plano aplicado e as células excluídas.
>
> Depois disso, o rascunho fica bloqueado para publicação enquanto houver célula `isUnset` — a invariante I6 já cuida disso, e é exatamente o comportamento desejado ("o usuário decide como tratar as células novas").
>
> Casos de borda a tratar explicitamente:
> - remoção de domínio que zera uma dimensão inteira (nova versão da variável com menos de 2 domínios não deve nem existir — a S04 valida — mas defenda-se assim mesmo);
> - domínio removido **e** outro adicionado com o mesmo `code` (é substituição: trate como removido + adicionado, não como renomeado);
> - resnapshot de X e de Y em sequência, sem recarregar;
> - resnapshot aplicado a um eixo cuja variável foi arquivada.
>
> #### 2. Actions
> `src/server/actions/reconcile-actions.ts`: `previewResnapshot` (VIEWER) e `applyResnapshot` (EDITOR).
>
> #### 3. UI
>
> **Badge de defasagem** no inspector de propriedades da versão, ao lado do eixo, apenas em versões `DRAFT` (§4.2 — em versões publicadas o badge **não** aparece; elas são registro histórico, não pendência). Texto: "Variável desatualizada — v1 pinada, v2 disponível".
>
> **Diálogo de reconciliação**, abrindo o preview antes de qualquer gravação:
> - Título: "Atualizar Score HVI3 da v1 para a v2 neste rascunho".
> - Três blocos visuais: **Serão adicionados** (com aviso "gera 4 células novas que você precisará preencher"), **Serão removidos** (com aviso destacado "12 células serão excluídas — o conteúdo fica registrado na auditoria"), **Serão renomeados/reordenados** (sem impacto em conteúdo).
> - Preview do grid resultante com as novas células hachuradas e as que serão removidas riscadas em vermelho.
> - Confirmação exigindo digitar o nome da variável quando houver células a excluir.
> - Após aplicar: toast com resumo, seleção automática das células novas e a barra de pendências da S09 já apontando "4 células precisam ser preenchidas".
>
> **Tela de impacto na biblioteca** (`/library/variables/[id]`, painel Impacto da S04): passa a listar, além do uso, os rascunhos que podem adotar a nova versão, com link direto para o diálogo de reconciliação de cada um. Nada em lote — a adoção é sempre matriz a matriz, por decisão de produto.
>
> #### 4. Testes — este bloco é obrigatório e não pode ser reduzido
> - **O teste que prova o princípio:** publicar v2 de `SCORE_HVI3` com `R7`, aplicar resnapshot num rascunho, e verificar que a versão PUBLISHED da matriz mantém **exatamente** os 6 domínios e as 24 células originais, com todos os campos inalterados. Compare o registro inteiro, não só a contagem.
> - Tentar `applyResnapshot` numa versão PUBLISHED falha com `VERSION_IMMUTABLE`.
> - Domínio adicionado gera exatamente `|outro eixo|` células novas, todas `isUnset`.
> - Domínio removido exclui exatamente `|outro eixo|` células, e o payload do evento contém todos os campos de cada uma.
> - Domínio renomeado preserva a célula e seu conteúdo integralmente.
> - Reordenação preserva conteúdo e atualiza `position`.
> - `code` removido e recriado é tratado como substituição (célula nasce vazia, não herda).
> - Após resnapshot com adições, publicar falha com `UNSET_CELLS_REMAIN`; após preencher, publica.
> - Resnapshot em X e depois em Y na mesma versão funciona e produz o cartesiano correto.
> - `previewResnapshot` não grava nada (verifique contagens antes e depois).
> - E2E completo: adicionar R7 na biblioteca → publicar variável → abrir rascunho da matriz → badge aparece → reconciliar → 4 células novas hachuradas → preencher → publicar.
>
> ### Critérios de aceite
> - O cenário do E2E acima funciona ponta a ponta no navegador.
> - Nenhuma versão publicada é alterada em nenhum caminho de código.
> - O conteúdo das células excluídas é recuperável a partir da auditoria.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e && pnpm build` verdes.
>
> ### Fora do escopo
> Adoção em lote em várias matrizes. Opção `onRemoved: 'archive'` (o parâmetro existe na assinatura, mas só `'delete'` é implementado).
>
> ### Encerramento
> Commit descritivo e push.
