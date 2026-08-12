# Decisões (ADRs e DECs)

> Catálogo do **porquê**. Os documentos normativos (`02` a `12`) descrevem como o sistema é; as
> decisões abaixo explicam por que ficou assim. Decisão nunca se apaga nem se reescreve: decisão
> revertida ganha uma DEC nova com o campo **Substitui** apontando a antiga.

Prefixos em uso: `ADR-` para decisões globais de arquitetura, `DEC-<ÉPICO>-` para decisões de um
domínio funcional (`CARGA` = carga de matrizes, `12-carga-de-matrizes.md`).

---

## DEC-CARGA-001: uma matriz por canal de venda

| Campo | Conteúdo |
|---|---|
| **Decisão** | Cada linha da tabela de origem produz **uma matriz por coluna de oferta** (teto, geral, digital, URA, PAP, outbound): 17 partições × 6 canais = 102 matrizes, cada uma com o grid enxuto de 21 × até 27. |
| **Data / gatilho** | 2026-08-10, análise do `CINEMINHA_20260708.csv` para a carga inicial. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §1, §5.3 |

**Contexto.** Uma célula do PolicyOps guarda uma oferta só, e a extração traz seis valores por
combinação de perfil. As alternativas eram: (a) canal como nível do eixo X, produzindo 17 matrizes
de 126 colunas; (b) uma matriz por canal, produzindo 102 matrizes enxutas; (c) guardar só o teto na
célula e os cinco canais em `attrs`.

**Justificativa.**

- Os canais não são derivados: verificado nos dados que só 34% das linhas têm os seis valores
  iguais, e que a URA fica zerada em 51% das linhas contra 25% do digital. O canal carrega decisão
  de política de verdade, então precisa ser dado de primeira classe — o que elimina (c), onde o
  canal não aparece no grid, não entra na legenda e o diff só sabe dizer "attrs mudou".
- O grid de cada matriz continua sendo o "cineminha" que a área já lê hoje (21 × até 27), em vez
  de um grid de 126 colunas com seis blocos quase idênticos — o que elimina (a).
- Versionamento por canal é a granularidade mais fina possível de lastro: "em julho mudou só o
  digital do G4 Risco Alto" é uma frase que a linha do tempo passa a produzir sozinha.

**Trade-off aceito.** 102 matrizes num projeto só, e uma carga que pode criar dezenas de rascunhos
de uma vez. Mitigado por tags e filtro (DEC-CARGA-003) e pela fila de revisão (DEC-CARGA-005).

---

## DEC-CARGA-002: um projeto só, com código composto

| Campo | Conteúdo |
|---|---|
| **Decisão** | As 102 matrizes vivem no projeto existente `POLITICA_B2C`, com código composto pelas colunas de partição e pelo canal (`MTZ_G4_RISCO_ALTO_DIGITAL`), gerado por padrão com marcadores. |
| **Data / gatilho** | 2026-08-10, mesma discussão de DEC-CARGA-001. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §5.4 (`codeTemplate`), §6.1 |

**Contexto.** Com 102 matrizes, a alternativa era quebrar em projetos (um por canal, ou um por
cluster) para dar navegação.

**Justificativa.**

- Projeto é a unidade de portfólio e de vigência (`getPortfolioAt`); quebrar por canal daria uma
  navegação boa mas fixaria **uma** hierarquia, e a área precisa cortar por canal, por cluster e
  por risco conforme a pergunta.
- Tags resolvem a navegação em N dimensões sem congelar nenhuma (DEC-CARGA-003).
- Mantém a política B2C inteira como um portfólio único, que é como ela é aprovada.

**Trade-off aceito.** Lista de 102 itens na barra lateral e portfólio de 102 cards na tela de
vigência — só toleráveis porque o filtro por tag existe.

---

## DEC-CARGA-003: tags de matriz com grupo, no catálogo

| Campo | Conteúdo |
|---|---|
| **Decisão** | Matrizes ganham `tags: string[]`, referenciando `CatalogItem` de kind `TAG`, que passa a ter `group?: string`. O usuário cria tags livremente enquanto cadastra; a busca filtra por facetas de grupo. |
| **Data / gatilho** | 2026-08-10, pedido explícito do usuário ao escolher projeto único. |
| **Páginas afetadas** | `03-modelo-do-documento.md` §4, §5, §9; `07-ux-e-editor.md` §15; `12-carga-de-matrizes.md` US-09 |

**Justificativa.**

- O kind `TAG` já existe no catálogo desde a S08 — reaproveitá-lo dá rótulo, cor, arquivamento e
  renomeação de graça, em vez de inventar um registro paralelo de tags livres.
- `group` transforma uma lista plana em facetas (`Canal: Digital` **e** `Cluster: G4`), que é a
  forma como a pergunta real é feita.
- A carga preenche as tags a partir das colunas de partição e da dimensão desdobrada, então as 102
  matrizes nascem classificadas sem trabalho manual.

**Trade-off aceito.** Tags são referência viva (renomear muda a exibição em toda parte, inclusive
no histórico) — a mesma decisão já tomada para os demais itens de catálogo
(`05-regras-de-negocio.md` §5.5).

---

## DEC-CARGA-004: decisão derivada da oferta, com a oferta preservada

| Campo | Conteúdo |
|---|---|
| **Decisão** | A célula carregada recebe as duas coisas: `offer` com o item de catálogo do valor lido (inclusive `OFERTA_0`) e `decision` derivada por tabela de regras do perfil (`OFERTA_0 → REPROVADO`, demais → `APROVADO`). |
| **Data / gatilho** | 2026-08-10; a extração não tem coluna de decisão e I6 exige decisão em toda célula para publicar. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` US-05, CT-08, RN-11 |

**Justificativa.**

- Guardar o valor da oferta como decisão misturaria dois conceitos e mataria o resumo semântico do
  diff, que classifica decisões em aprovadoras e reprovadoras (`05-regras-de-negocio.md` §4.3).
- Guardar só a decisão perderia o valor da oferta, que é o que a célula precisa exibir.
- Com os dois campos, a comparação entre cargas passa a dizer "8 células fechadas, 4 ofertas
  alteradas" sem nenhum trabalho extra.

**Trade-off aceito.** A regra de derivação é configuração do perfil, não invariante: mudar a regra
entre duas cargas produz diferença de decisão sem que nenhuma oferta tenha mudado. Por isso a
tabela de regras é exibida no passo 4 e gravada no perfil, dentro do documento.

---

## DEC-CARGA-005: a carga para no rascunho

| Campo | Conteúdo |
|---|---|
| **Decisão** | A carga nunca publica. Cria matriz nova em `DRAFT` e rascunho v(n+1) nas alteradas, e entrega uma fila de revisão onde a publicação é feita item a item (ou em lote, só dos revisados). |
| **Data / gatilho** | 2026-08-10, escolha explícita do usuário: "o usuário precisa revisar cada um deles para aprovar a publicação". |
| **Páginas afetadas** | `12-carga-de-matrizes.md` US-07, RN-10, §6.2 |

**Justificativa.**

- Política de crédito em vigor sem revisão humana é o pior modo de falha do produto.
- Publicar exige nota de ao menos 10 caracteres e vigência (`05-regras-de-negocio.md` §1.3) —
  decisões que pertencem a quem revisa, não ao arquivo.
- O rascunho já é o lugar natural: ele existe, tem diff, tem descarte, e a tela de Rascunhos já
  lista tudo o que está pendente.

**Trade-off aceito.** Uma carga com 30 matrizes alteradas exige 30 revisões. Mitigado pelo lote
"publicar revisados" e pelo fato de que, na prática, a maioria das matrizes vem inalterada
(DEC-CARGA-006).

---

## DEC-CARGA-006: matriz inalterada não recebe rascunho

| Campo | Conteúdo |
|---|---|
| **Decisão** | Matriz cujo conteúdo é idêntico ao da versão publicada não recebe rascunho, versão nem evento. A carga é seletiva por natureza, e a segunda carga do mesmo arquivo produz zero alterações. |
| **Data / gatilho** | 2026-08-10, requisito central do usuário: "somente para aqueles que realmente alterar… não que toda carga sempre crie novos e percamos o lastro". |
| **Páginas afetadas** | `12-carga-de-matrizes.md` RN-02, RN-05, CT-01, CT-02 |

**Justificativa.**

- É o que faz a linha do tempo de cada matriz significar alguma coisa: uma versão nova passa a ser
  evidência de mudança real, não subproduto do calendário.
- Torna a idempotência testável (CT-01), e idempotência é a única forma barata de provar que o
  motor de comparação está correto.
- Reduz o crescimento do arquivo: sem isso, cada carga mensal acrescentaria ~2,5 MB de células
  duplicadas.

**Trade-off aceito.** Não existe registro de "a carga passou por aqui e nada mudou" na matriz — só
no evento `IMPORT_RUN` do documento, que guarda o total de inalteradas. É deliberado: o evento fica
no documento, não em 99 matrizes.

---

## DEC-CARGA-007: o perfil de carga mora no documento

| Campo | Conteúdo |
|---|---|
| **Decisão** | O mapeamento (papéis de coluna, de-para de valores, regras de decisão, tags, padrões de código) é gravado em `importProfiles`, no topo do documento, elevando `schemaVersion` para 3 com migração 2→3. |
| **Data / gatilho** | 2026-08-10, escolha do usuário entre documento, arquivo separado e `localStorage`. |
| **Páginas afetadas** | `03-modelo-do-documento.md` §7.1, §9, §10; `12-carga-de-matrizes.md` US-08 |

**Justificativa.**

- O perfil **é** documentação: ele registra como a tabela corporativa se traduz no modelo de
  política. Guardá-lo fora do documento espalha a verdade em dois lugares.
- Viaja com o `.json` no SharePoint: qualquer pessoa do time faz a carga seguinte sem remontar o
  mapeamento, que é o requisito de "processo reutilizável".
- `localStorage` seria por máquina e por navegador; arquivo separado seria mais um artefato para
  perder e para versionar à parte.

**Trade-off aceito.** Uma migração de schema a mais e algumas dezenas de KB no documento.

---

## DEC-CARGA-008: o arquivo pode montar a biblioteca, mas em passo explícito

| Campo | Conteúdo |
|---|---|
| **Decisão** | O assistente propõe variáveis, domínios, itens de catálogo e o mapa de compatibilidade deduzidos do arquivo, mas isso é um passo próprio, revisável e anterior; a aplicação de células **nunca** cria entidade de biblioteca. |
| **Data / gatilho** | 2026-08-10; o `CINEMINHA` traz 28 domínios de faixa e o mapa de compatibilidade completo, e digitá-los à mão seria a maior parte do custo da carga inicial. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` US-04, RN-17 |

**Justificativa.**

- O arquivo já contém a informação: os pares (modelo adicional, faixa) que aparecem nele **são** o
  mapa de compatibilidade, e os valores distintos de cada coluna de eixo são os domínios.
- Separar o passo mantém a biblioteca sob controle de quem edita a política: nada nasce sem alguém
  ver a lista.
- Usar os comandos normais (`variable/*`, `compat/*`, `catalog/*`) evita um caminho privilegiado de
  escrita que escaparia das invariantes e da auditoria.

**Trade-off aceito.** A carga inicial tem um passo a mais. Nas cargas seguintes ele desaparece
sozinho, porque não há pendência.

---

## DEC-CARGA-009: divergência estrutural bloqueia a matriz inteira

| Campo | Conteúdo |
|---|---|
| **Decisão** | Quando o arquivo traz uma combinação que não existe nos eixos da matriz, a matriz inteira fica `ESTRUTURA DIVERGENTE` e é ignorada pela aplicação — nunca aplicada em parte. A resolução assistida (S25, `src/core/import/structural.ts` + `apply-structural.ts`) automatiza o **caminho de biblioteca e o resnapshot** — nunca a aplicação de célula em si, que continua pela carga normal na passada seguinte. Ver DEC-CARGA-017. |
| **Data / gatilho** | 2026-08-10, desenho do plano de carga. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` RN-06, CT-03, §7 |

**Justificativa.**

- `tuples` é snapshot congelado e só muda por ato explícito do usuário
  (`05-regras-de-negocio.md` §5); a carga não é esse ato.
- Aplicar as células que "cabem" e descartar as que não cabem deixaria a matriz num estado que
  ninguém pediu e que o diff não explica.
- Bloquear por matriz, e não a carga inteira, mantém as outras 101 aplicáveis.

**Trade-off aceito.** Enquanto a S25 não existir, uma faixa nova exige o caminho manual: publicar
nova versão da variável, criar rascunho, adotar (`axis/resnapshot`) e recarregar.

---

## DEC-CARGA-010: o plano é recalculado na aplicação

| Campo | Conteúdo |
|---|---|
| **Decisão** | `import/apply` recebe o `planHash` do plano revisado, recalcula o plano sobre o documento corrente e falha com `IMPORT_PLAN_STALE` se divergir — sem gravar nada. |
| **Data / gatilho** | 2026-08-10, desenho do comando; o documento pode mudar entre a revisão e a confirmação (undo, outra edição, recuperação de buffer). |
| **Páginas afetadas** | `12-carga-de-matrizes.md` RN-14, CT-11, §5.4 |

**Justificativa.**

- Comando é puro e valida antes de tocar (`08-camada-de-comandos.md` §1): aplicar um plano
  calculado contra outro estado violaria essa regra na prática, ainda que não na assinatura.
- O mesmo raciocínio já existe na persistência, com detecção de conflito por revisão
  (`06-persistencia-e-concorrencia.md` §5).

**Trade-off aceito.** O plano é calculado duas vezes; a menos de 1 s para 102 matrizes, é barato
diante do risco de sobrescrever trabalho alheio.

---

## DEC-CARGA-011: matriz nova suprime o que o arquivo não observa

| Campo | Conteúdo |
|---|---|
| **Decisão** | Ao **criar** uma matriz, a carga marca como suprimidas (`axis.manualSuppressions`) as tuplas de eixo que o arquivo não traz em nenhuma linha. Em matriz já existente isso nunca acontece: ausência de linha segue `missingRowPolicy`. |
| **Data / gatilho** | 2026-08-10; ao dimensionar os eixos do caso real, o produto de eixos gerou 110 tuplas em Y para cineminhas que usam 21 ou 22. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` RN-21, CT-16, §5.4; `04-eixos-aninhados.md` §5.4 (o mecanismo) |

**Contexto.** A variável do nível externo do eixo Y é uma só para todas as matrizes — seis modelos
adicionais no caso real —, mas cada cineminha usa um ou dois deles. Sem supressão, cada matriz
nasceria com centenas de combinações pendentes que jamais seriam preenchidas, e I6 impediria a
publicação para sempre. As alternativas eram: uma variável de modelo por cluster, ou uma regra de
compatibilidade que dependesse da partição.

**Justificativa.**

- Supressão manual é o mecanismo que a arquitetura já criou para exatamente isso
  (`04-eixos-aninhados.md` §5.4): explícita, visível na interface como "88 combinações
  suprimidas", restaurável e auditada.
- Uma variável de modelo por cluster multiplicaria a biblioteca por sete e quebraria a
  comparabilidade entre cineminhas, que é o que permite comparar o mesmo canal entre clusters.
- Compatibilidade é por par de variáveis, não por matriz — "quais modelos existem neste
  cineminha" é informação da matriz, não da biblioteca. Colocá-la numa regra global seria mentir
  sobre o significado da regra.

**Trade-off aceito.** Matrizes nascem com uma lista de supressões relativamente longa (83 a 108
tuplas), e o alerta de `04-eixos-aninhados.md` §5.4 — "se o escape hatch começar a ser usado em
escala, reabra o desenho" — passa a valer com uma ressalva registrada aqui: neste caso o uso em
escala é esperado e correto, porque a assimetria é por matriz, não por regra.

---

## DEC-CARGA-012: severidade no problema, e o plano bloqueia por inteiro ou por matriz

| Campo | Conteúdo |
|---|---|
| **Decisão** | `ImportIssue` carrega `severity` derivada do código: os códigos de §5.8 são `ERROR` e bloqueiam o plano inteiro (`matrices: []`); os códigos de aviso descrevem o que a carga fez e, no máximo, bloqueiam **uma** matriz, que sai `BLOCKED` com `reason`. |
| **Data / gatilho** | 2026-08-11, S21: o plano tem uma única lista `issues`, e a interface precisa saber o que impede de avançar sem interpretar código por código. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §5.4, §5.5, §5.8 |

**Contexto.** `parseDelimitedTable` devolve `warnings` e `errors` separados, mas `ImportPlan` tem
uma lista só. Sem severidade explícita, a tela teria de manter a sua própria tabela de "o que é
grave", que sairia do lugar na primeira mudança do motor. Faltava também vocabulário para o que a
carga faz e precisa dizer — conferência divergente, linha ignorada, combinação sem linha, tuplas
suprimidas —, que não é erro nenhum.

**Justificativa.**

- Severidade é propriedade do **código**, não da situação: o mesmo `IMPORT_UNMAPPED_VALUE` sempre
  bloqueia, sempre pelo mesmo motivo (RN-16). Derivá-la em `issues.ts` mantém uma única verdade.
- Plano com erro não classifica matriz alguma: "nenhuma matriz do plano é aplicável" (CT-05) fica
  verdadeiro por construção, sem um campo `applicable` por linha que alguém pudesse esquecer de
  checar.
- Problema de uma matriz continua sendo de uma matriz (DEC-CARGA-009): rascunho aberto, grid acima
  do teto ou falta de versão-base viram `BLOCKED` com aviso, e as outras 101 seguem aplicáveis.

**Trade-off aceito.** Um erro num canto do arquivo esconde o plano inteiro — inclusive as matrizes
que estavam perfeitas. É o comportamento que o assistente quer no passo 3 (resolver a pendência
antes de ver o plano), e o custo é recalcular o plano depois da correção, que leva menos de 1 s.

---

## DEC-CARGA-013: o plano descreve os eixos da matriz nova

| Campo | Conteúdo |
|---|---|
| **Decisão** | `MatrixPlan.axes` traz, só nas matrizes `NEW`, os eixos projetados: pins de versão de variável, snapshot de domínios, tuplas efetivas e `manualSuppressions`. `projectImportAxes(doc, profile)` expõe a mesma projeção sem a supressão por matriz. |
| **Data / gatilho** | 2026-08-11, S21: RN-21 fala em tuplas suprimidas, e `suppressedCombinations` (um número) não diz **quais**. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §5.4, CT-16 |

**Contexto.** A aplicação (S24) precisa criar a matriz com exatamente os eixos que o plano
prometeu, e o plano precisa poder ser revisado — "88 combinações marcadas como inexistentes" só é
auditável se der para ver quais são.

**Justificativa.**

- Uma projeção só: se a S24 recalculasse os eixos por conta própria, passariam a existir duas
  respostas para "como esta matriz nasce", e elas divergiriam no primeiro `variable/publish` entre
  o plano e a aplicação.
- A projeção é por **perfil**, não por matriz: os níveis vêm das colunas de eixo, então ela é
  calculada uma vez por carga e compartilhada pelas 102 linhas do plano. Só o recorte de tuplas
  muda de matriz para matriz.
- Matriz existente não ganha `axes`: os eixos dela são os da versão publicada, que a carga nunca
  altera (RN-01).

**Trade-off aceito.** O plano fica maior — cada matriz nova carrega a lista de supressões. Em
troca, `import/apply` vira uma transcrição do plano revisado, sem decisão nova na hora de gravar.

---

## DEC-CARGA-014: quatro ajustes do assistente descobertos ao implementar a S22

| Campo | Conteúdo |
|---|---|
| **Decisão** | Quatro decisões de implementação, pequenas mas não óbvias a partir dos documentos anteriores, tomadas ao construir o assistente (`src/components/import/`): (1) drop-zone própria por passo, não o `DropTarget` global; (2) o passo 2 não pode exigir que os eixos já estejam publicados; (3) o diff do plano não embute `CompareView`; (4) o código de decisão nasce no próprio passo 4. |
| **Data / gatilho** | 2026-08-11, S22 — cada uma apareceu como um bloqueio real ao rodar o assistente ponta a ponta contra o recorte do CINEMINHA. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §6.1.1, `07-ux-e-editor.md` §14 |

**(1) `FileDropZone` própria, não o `DropTarget` global.** O `DropTarget` de `02-arquitetura.md`
escuta `drop` em `window` inteiro e sempre chama `openDroppedFile`, que tenta abrir o arquivo
solto **como documento**. Um `.csv` da extração não é um documento — reaproveitar o componente
global faria o shell tentar interpretar o cineminha como um `.json` inválido. A drop-zone do passo
1 é local ao elemento e chama `stopPropagation` no `drop`, para o evento não subir até o listener
global. "Reaproveitar `DropTarget`" (texto da sessão) vale como reaproveitar o padrão visual e de
interação — borda tracejada, overlay "solte o arquivo" —, não a instância que abre documentos.

**(2) O passo 2 não pode travar em "variável de eixo sem versão publicada".** Numa carga inicial,
as variáveis de eixo mapeadas no próprio passo 2 (via "+ Nova variável") nascem sem domínio nem
publicação — só o passo 3 resolve isso. Se o cálculo de tamanho de grid (I16) exigisse a
publicação para responder, o passo 2 nunca teria "Avançar" liberado numa carga inicial, e não
haveria como chegar ao passo 3 para publicar. `checkGridSize` por isso devolve um terceiro estado,
`PENDING` (distinto de `OK` e `OVER`), que não bloqueia — o teto de 6.000 continua sendo aplicado
de verdade por `planImport` no passo 5, que é quem tem autoridade sobre I16 (RN-18).

**(3) O passo 5 não embute `CompareView` no diff de uma matriz.** `CompareView` (`07-ux-e-editor.md`
§9) compara duas versões que já existem no documento. Uma matriz `NEW` do plano não tem nenhuma —
"antes" e "depois" teriam que ser sintetizados só para a tela, dobrando a lógica que `plan.ts` já
resolveu internamente (`syntheticVersion`, não exportado). Expandir uma matriz no passo 5 lista
`plan.changes` diretamente (célula, campo, antes/depois), que é exatamente o resultado que
`planImport` já calculou via `src/core/diff/` — sem reconstruir nada.

**(4) O código de decisão nasce no passo 4, não é uma lacuna do passo 3.** Diferente de domínio,
oferta ou compatibilidade — que vêm de valores **do arquivo** —, a decisão é uma classificação que
o perfil impõe (`decisionRules`, DEC-CARGA-004): o arquivo não traz nenhuma coluna "decisão", então
não há como o passo 3 propor `APROVADO`/`REPROVADO` a partir de dados observados. E como
`decisionRules` só existe depois que o usuário o preenche no passo 4, um código de decisão
referenciado ali só apareceria como lacuna do passo 3 numa segunda visita — um usuário que nunca
volta ao passo 3 depois do passo 4 ficaria sem meio de criar o item. O select de decisão do passo 4
ganha "Novo código de decisão…", que despacha `catalog/create` ali mesmo e já seleciona a regra —
tags continuam vindo do passo 3 (kind `TAG`), porque são derivadas de valores observados
(partição/desdobramento), o mesmo caso dos domínios e ofertas.

**Trade-off aceito.** Nenhuma das quatro altera contrato do motor da S21 nem invariante do
documento — são só onde, na composição de tela, cada responsabilidade fica. Registradas juntas
porque nenhuma seria óbvia de prever sem montar o assistente inteiro e rodá-lo contra um arquivo
real.

## DEC-CARGA-015: o passo 5 volta a usar `CompareView`, sobre um documento descartável

| Campo | Conteúdo |
|---|---|
| **Decisão** | Expandir "Ver diff" numa matriz do plano abre o `CompareView` de `07-ux-e-editor.md` §9 dentro do assistente. O par de versões que ele exige é montado por `src/components/import/plan-preview.ts`: um documento **descartável**, em memória, com uma matriz sintética de duas versões — o "antes" (a publicada, ou o grid vazio numa matriz nova) e o "depois" (o mesmo grid com as células da carga aplicadas). Substitui o item (3) de DEC-CARGA-014; a lista direta de `plan.changes` continua existindo como a expansão rápida da linha. |
| **Data / gatilho** | 2026-08-11, S24 — a S22 tinha decidido contra por custo, e a S24 pede o `CompareView` explicitamente. |
| **Alternativas** | (a) manter só a lista de `plan.changes` — barata, mas a revisão de um grid de 567 combinações lida célula a célula numa lista é ilegível, e era justamente a tela que já existia para isso que se estava recusando a usar; (b) exportar `syntheticVersion` de `plan.ts` e montar a `EditorView` à mão no componente — duplicaria a construção de `EditorView`, que tem cabeçalho aninhado, catálogo e estatísticas. |
| **Por quê** | O custo estimado na S22 estava errado, e o erro tinha uma causa identificável: assumiu-se que faltava *tela*, quando o que faltava era só o **par de versões**. `CompareView` já é componente de apresentação puro — nasceu assim para servir também ao diálogo de conflito, onde uma das pontas vem de um documento que nem está aberto (`06-persistencia-e-concorrencia.md` §5). Montar o par é uma função de trinta linhas que reusa `getEditorView` e `diffVersions` sem tocar em nenhuma das duas. E o documento descartável não é um risco novo: ele nunca é despachado, nunca chega ao store, e as funções que o leem são as mesmas funções puras de leitura de sempre. |
| **Custo aceito** | Um documento a mais em memória por diff aberto (`{ ...doc, matrices: [uma] }` — cópia rasa, o custo real é o das células daquela matriz), e um `PlanPreview` que precisa ser mantido em sintonia com `MatrixPlan` se `plan.ts` mudar a forma de `axes`/`changes`. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §6.1.2, `07-ux-e-editor.md` §14, `13-decisoes.md` DEC-CARGA-014 (item 3 superado) |

## DEC-CARGA-016: "revisado" é estado de interface, não campo do documento

| Campo | Conteúdo |
|---|---|
| **Decisão** | A marca "revisado" da fila de revisão vive em `ui-store` (`reviewedVersionIds`), junto com o filtro por `importRunId`. Não é campo de `MatrixVersion`, não entra no `.json` e não sobrevive a recarregar a aplicação. |
| **Data / gatilho** | 2026-08-11, S24, US-07. |
| **Alternativas** | Um `reviewedAt`/`reviewedBy` na `MatrixVersion`, ou um evento `DRAFT_REVIEWED`. |
| **Por quê** | "Revisado" é uma marca de trabalho em andamento de uma pessoa numa sessão — o equivalente a riscar itens de uma lista enquanto se confere. O fato durável que o documento precisa registrar já existe e é outro: a **publicação**, com nota, autor e data. Gravar "revisado" no documento criaria um segundo estado de aprovação que ninguém consulta depois, sujeito a ficar mentindo (revisado por quem, contra qual conteúdo, se o rascunho mudou desde então?) — e I3/§8 não têm lugar para um campo mutável dessa natureza numa versão. Perder a marca ao recarregar é o comportamento certo: o que sobreviveu é o rascunho, e revisar de novo é barato. |
| **Custo aceito** | Quem fecha a aba no meio da revisão de 102 rascunhos remarca o que já tinha conferido. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §6.2, `07-ux-e-editor.md` §14 |

---

## DEC-CARGA-017: a resolução estrutural automatiza a biblioteca e o resnapshot, nunca a célula

| Campo | Conteúdo |
|---|---|
| **Decisão** | `import/applyStructural` (S25) resolve uma matriz `STRUCTURAL` executando, pelos comandos normais (RN-17): `variable/createDraft`+`saveDomains`+`publish` para os domínios que a variável ainda não tem, `compat/createDraft` (ou `compat/create`, se a regra não existir) +`saveMap`+`publish` para o mapa, `version/createDraft` na matriz e `axis/resnapshot` em cada eixo afetado. Tudo-ou-nada (o mesmo mecanismo de `import/apply`, §5.4). A combinação nova nasce **pendente** — sem célula —, exatamente como qualquer combinação nova de `axis/resnapshot` (`05-regras-de-negocio.md` §5.4): quem preenche o conteúdo é a carga normal (ou a edição manual), na passada seguinte. A resolução nunca remove domínio nem tupla, e nunca publica a matriz (RN-10) — ela para em rascunho, pronta para a fila de revisão de US-07. |
| **Data / gatilho** | 2026-08-11, S25. |
| **Como `planStructuralChanges` decide o que falta** | `resolveImport` só deixa passar, para uma coluna de eixo, um valor cujo código já é domínio **publicado** da variável (`IMPORT_UNMAPPED_VALUE` barra o resto e bloqueia o plano inteiro — RN-16). Por isso, na esteira normal do assistente (US-03/US-04 já resolvidos no passo 3), todo código que aparece em `MatrixPlan.unknownTuples` **já existe na biblioteca** quando o plano chega ao passo 5 — o caso comum de `STRUCTURAL` é a matriz **atrasada**: a combinação já existe na variável e no mapa de compatibilidade, só falta o resnapshot desta matriz específica. `deduceAxisChanges` (`structural.ts`) por isso decide "domínio novo" contra a versão **publicada atual** da variável, não contra o snapshot congelado da matriz — comparar contra o snapshot criaria um domínio "novo" que já existe e `variable/saveDomains` rejeitaria o código duplicado. O caminho de domínio genuinamente inédito continua implementado (é o que a sessão pede explicitamente, e cobre o caso de a variável ter evoluído por um caminho que não passou pelo passo 3), só não é o caminho mais frequente. |
| **Lote e biblioteca compartilhada** | Várias matrizes `STRUCTURAL` podem pedir exatamente a mesma mudança de biblioteca (as 6 matrizes de canal de uma partição, por exemplo). `mergeDomainChanges`/`mergeCompatibilityChanges` juntam os pedidos do lote selecionado por variável/par **antes** de aplicar, e `applyStructural` publica a variável e a regra **uma vez** para o lote inteiro — aplicar matriz a matriz chamaria `variable/createDraft` duas vezes para a mesma variável (`DRAFT_ALREADY_EXISTS`) ou tentaria recriar um domínio que a primeira matriz do lote já publicou. |
| **O que o "inverso íntegro" cobre** | O rascunho de cada matriz, o resnapshot e os rascunhos de variável/compatibilidade **enquanto ainda em rascunho** são revertidos pelo inverso normal de cada comando. A publicação da variável e da regra de compatibilidade são **irreversíveis por desenho em todo o PolicyOps** (I3 — `variable/publish` e `compat/publish` devolvem `irreversible(...)`, não um comando que desfaz). `applyStructural` não muda essa garantia: desfazer uma resolução já aplicada derruba o rascunho da matriz e o resnapshot, mas a biblioteca segue evoluída — o mesmo comportamento de qualquer outra publicação no sistema. Um "desfazer" que também rebaixasse a variável quebraria I3 (versão publicada é imutável) e reescreveria histórico que outra pessoa já pode ter lido. |
| **Fora do escopo (mantido)** | Remover domínio ou tupla pela carga; mudar a pilha de níveis de um eixo (`axis/addLevel` continua manual); publicar a matriz (RN-10) — a resolução termina em rascunho, como qualquer outra escrita da carga. Divergência de **subtração** (o arquivo deixou de trazer uma faixa) não é tocada pela resolução estrutural: a faixa continua no eixo e a célula segue `missingRowPolicy` (RN-07) na carga normal. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` RN-06, §5, §7; `05-regras-de-negocio.md` §5.4 |

---

## DEC-CARGA-018: a carga restaura uma matriz arquivada, por confirmação explícita — nunca sozinha

| Campo | Conteúdo |
|---|---|
| **Decisão** | Uma matriz arquivada mantém o código reservado no projeto (docs/05 §1.1) — isso não muda. O que muda é a saída: quando o código de uma matriz do plano bate com uma matriz arquivada, ela entra num estado próprio, `ARCHIVED` (antes era `BLOCKED` com o mesmo motivo de sempre — "restaure-a ou mude o padrão de código" — sem nenhum caminho de fato para restaurar). O passo 5 do assistente ganha um toggle por matriz, "Restaurar e aplicar", que nunca é marcado por seleção em massa. Confirmado — a chave entra em `restoreKeys`, um campo novo de `planImport`/`import/apply` — a matriz volta a ser comparada como qualquer matriz existente (`CHANGED`/`UNCHANGED`/`STRUCTURAL`/`BLOCKED` por outro motivo, na mesma ordem de sempre), e a aplicação desarquiva a matriz (mesmo comando interno que `matrix/archive` desfaz) antes de criar o rascunho — ou, se o conteúdo já bater, sem criar rascunho nenhum (RN-02 continua valendo). |
| **Data / gatilho** | 2026-08-12, usuário relatou que arquivar uma matriz e depois recarregar uma planilha com o mesmo código trava a carga em massa sem saída — a única forma de restaurar hoje é Ctrl+Z logo em seguida de arquivar (`ProjectDetail.tsx`, `MatrixScreen.tsx`), e quem carrega uma tabela meses depois já perdeu essa janela. |
| **Alternativas** | (a) um botão "Desarquivar" avulso na lista de matrizes do projeto — mais direto, mas o usuário pediu explicitamente a opção 2 (restaurar dentro do próprio fluxo de carga, sem tela separada); resolve também o caso mais comum, que é descobrir o problema já dentro do assistente; (b) a carga desarquivar sozinha, sem confirmação, sempre que o código bater — mais rápido, mas reviveria por engano qualquer matriz arquivada de propósito só porque uma planilha antiga com o mesmo código voltou a circular; rejeitada por isso. |
| **Por quê** | O código continuar reservado depois de arquivar é proposital (docs/05 §1.1, evita uma matriz nova nascer por cima do histórico de uma arquivada sem ninguém perceber). O problema não era essa regra — era não existir **nenhuma** saída dela fora do Ctrl+Z imediato. Resolver dentro do assistente, e não com um botão solto na lista de matrizes, mantém a restauração perto de onde a pessoa já está decidindo o que aplicar, com o diff da própria carga como contexto. A confirmação por matriz (nunca em massa) é a salvaguarda contra revivência acidental: `isApplicable` deliberadamente não inclui `ARCHIVED`, e mesmo uma matriz arquivada que virou `UNCHANGED` depois de restaurada exige o toggle marcado — sem ele, aplicar essa chave falha com `IMPORT_TARGET_ARCHIVED`, nunca desarquiva em silêncio. |
| **Custo aceito** | Um estado (`ARCHIVED`) e um campo (`archived`) a mais em `MatrixPlan`, e `restoreKeys` correndo em paralelo com `selectedKeys` em três lugares (`plan.ts`, `apply.ts`, `import-store.ts`) — par de conjuntos que precisa ficar sincronizado em vez de um só. Aceito porque misturar as duas seleções teria feito "marcar para aplicar" e "confirmar restaurar" a mesma caixa, exatamente o acoplamento que a confirmação explícita existe para evitar. Continua sem um jeito de desarquivar uma matriz **fora** de uma carga — quem quer restaurar sem ter uma planilha em mãos ainda depende do Ctrl+Z. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §5.4, §5.5, §5.8, US-05; `08-camada-de-comandos.md` §3 Carga de matrizes |

---

## DEC-CARGA-019: matriz arquivada e restaurada sem versão publicada vira NEW, não BLOCKED

| Campo | Conteúdo |
|---|---|
| **Decisão** | DEC-CARGA-018 devolve a matriz arquivada restaurada ao mesmo caminho de "matriz existente qualquer" — que, sem versão `PUBLISHED`, sempre travava em `BLOCKED` com "a matriz não tem versão publicada para servir de base à comparação" (`IMPORT_NO_BASE_VERSION`). Para uma matriz cujo único rascunho foi descartado **antes** de publicar (`version/discardDraft` queima o número e arquiva a versão, sem nunca ter passado por `PUBLISHED`), essa checagem nunca deixa de bloquear — restaurar não tem para onde ir, porque não existe versão nenhuma para `version/createDraft` derivar (`NO_VERSION_TO_DERIVE`). Agora, quando a matriz está arquivada **e** a chave está em `restoreKeys` **e** não há versão publicada, o plano deixa de checar "existe versão-base" e projeta eixos frescos a partir das versões publicadas atuais das variáveis — o mesmo caminho de `planNewMatrix`/`matrix/create` para uma matriz genuinamente nova —, com status `NEW` em vez de `BLOCKED`. A aplicação usa o comando interno novo `version/_createWithoutBase` (`src/core/versioning/lifecycle.ts`): mesma resolução de níveis e mesmas validações de `matrix/create` (I13, I14, I16), mas anexando a versão numerada `v(n+1)` à matriz **existente** (código já reservado) em vez de criar um `Matrix` novo — `version/createDraft` não serve porque sempre exige uma versão para clonar, mesmo arquivada. |
| **Data / gatilho** | 2026-08-12, mesmo dia de DEC-CARGA-018: o usuário seguiu exatamente o caminho que a decisão anterior abriu — arquivou as 4 matrizes G3 sem versão publicada (rascunho já descartado antes) pela tela de matriz, e recarregou o CSV. O plano mostrou `Arquivada` com "Restaurar e aplicar" (como esperado), mas ao marcar o toggle o status virava `Bloqueada` de novo com o mesmo motivo de sempre — a restauração não tinha nenhuma saída para esse caso, só para o caso (mais comum) de uma matriz que já foi publicada antes de ser arquivada. |
| **Alternativas** | (a) usar a versão `ARCHIVED` mais recente (a do rascunho descartado) como base do diff, via `version/createDraft({ baseVersionId })` — que já aceita derivar de qualquer versão, publicada ou não (é o mesmo mecanismo de "restaurar versão histórica" do §1.2); menor mudança (só `plan.ts`), reaproveita `applyChangedMatrix` sem tocar `lifecycle.ts`, mas herda eixos daquele rascunho tal como estavam no momento do descarte — se as variáveis dos eixos ganharam versão publicada nova depois disso, a matriz restaurada nasceria com eixos desatualizados, sem nenhum aviso. Rejeitada: perguntado ao usuário, a opção escolhida foi tratar como matriz nova de verdade. (b) a escolhida — projetar eixos do zero a partir das versões publicadas **atuais**, igual a uma matriz nova de fato; mais correto quando a biblioteca mudou entre o descarte e a restauração, ao custo de um comando novo em `lifecycle.ts` (`version/_createWithoutBase`) que duplica a resolução de níveis de `matrix/create` em vez de reaproveitar `version/createDraft`. |
| **Por quê** | O código reservado (docs/05 §1.1) nunca teve conteúdo publicado — não há "a versão anterior" para comparar nem para herdar eixos: é, na prática, a mesma pergunta que criar a matriz pela primeira vez, só que o código já existe. Tratar como matriz nova (opção b) mantém uma verdade só sobre "que eixos uma matriz teria hoje" — a mesma que `matrix/create` e `planNewMatrix` já respondem — em vez de deixar essa resposta depender de quando, meses atrás, alguém descartou um rascunho. `version/_createWithoutBase` não é comando de catálogo (mesmo espírito de `restoreArchivedMatrix`, DEC-CARGA-018): só `import/apply` compõe isto, e só para uma matriz `ARCHIVED` restaurada sem publicação alguma. |
| **Custo aceito** | Um comando interno a mais em `lifecycle.ts` que duplica a resolução de níveis/eixos de `matrix/create` (`resolveLevel`, `buildAxis`, as validações I13/I14/I16) em vez de reaproveitá-la — aceito porque `matrix/create` está amarrado a criar um `Matrix` novo (unicidade de código, `MATRIX_CREATED`), e forçar essa amarração a aceitar uma matriz já existente teria acoplado dois conceitos que hoje são independentes. `MatrixPlan.matrixId` definido numa entrada `status: 'NEW'` passa a significar "matriz restaurada sem publicação", não mais exclusivamente "matriz nova"; `apply.ts` decide entre `matrix/create` e `version/_createWithoutBase` checando esse campo. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §5.5 (tabela de status); `08-camada-de-comandos.md` §3 Carga de matrizes e Versões |
