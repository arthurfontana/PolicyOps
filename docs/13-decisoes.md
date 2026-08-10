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
| **Decisão** | Quando o arquivo traz uma combinação que não existe nos eixos da matriz, a matriz inteira fica `ESTRUTURA DIVERGENTE` e é ignorada pela aplicação — nunca aplicada em parte. Resolver isso automaticamente (nova versão de variável + resnapshot) é a sessão S25. |
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
