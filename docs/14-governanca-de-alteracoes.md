# Governança de Alterações de Política (épico GOV)

> **Estado**: 🚧 Em andamento — **S32a entregue** (núcleo de componentes e `schemaVersion: 5`);
> S32b, S33a, S33b, S34–S40 planejadas · **DECs relacionadas**:
> DEC-GOV-001 a DEC-GOV-013 em [`13-decisoes.md`](13-decisoes.md) · Normativo para as sessões do
> épico; os contratos de schema fecham na S32a e passam a viver em
> [`03-modelo-do-documento.md`](03-modelo-do-documento.md).
>
> **Ordem de execução (DEC-GOV-010, revista pela DEC-GOV-012)**: o objetivo da trilha antecipada
> continua o mesmo — ter a política real dentro da ferramenta antes de investir no resto do épico —
> mas o caminho mudou: a primeira versão da política é construída **à mão, de forma incremental**
> (seção a seção, regra a regra), e não por uma carga de tudo de uma vez. A antiga S33 virou
> **S33a** (árvore e esqueleto) + **S33b** (cadastro e versionamento de regras), e a carga por
> Markdown (§9, S40) passou a ser **opcional e por recorte**, decidida depois do primeiro uso real.
>
> ```
> 32a → 33a → 33b → ⟨você constrói a política as-is e a gente ajusta a rota⟩
>   → 40 (opcional, por recorte) → 34 → 32b → 35 → 36 → 37/38 → 39
> ```
>
> O que só o Diário de Bordo consome (DB, release, grafo de estados, I25/I26) saiu da antiga S32 e
> virou a **S32b**, pré-requisito da S35.

## 1. Contexto e problema

A área de Políticas de Crédito solicita alterações à fábrica por documentos Word ("DB — Diário de
Bordo"). Três DBs reais analisados (DB 513, DB 515, DB 519) mostram o padrão:

- ~70% do documento é **boilerplate fixo** (registro de alterações, lista de comunicados, checklist
  Serasa de desenvolvimento/DET/pós-produção) repetido manualmente em cada DB;
- o conteúdo de negócio varia de uma frase ("ajustar cortes do cineminha Digital do G7") a uma
  especificação com contexto, objetivo e escopo — **sem padrão entre autores**;
- o estado atual da regra é reescrito de memória ou omitido ("Hoje, a Goodlist está apenas
  aprovando quem está nela…"), sem vínculo com a documentação vigente;
- não há como responder "qual regra valia em março, quem pediu a mudança e quem aprovou" sem
  arqueologia de e-mails.

Ao mesmo tempo, a documentação vigente da política (ex.: *Filtros e Critérios de Crédito B2C*) é
rica e hierárquica — Decisões Soberanas, Regras Duras, Segmentação, Cineminhas, Pós-Modelo, Mesa,
Variáveis, Reason Codes, Listas — mas vive em Word, fora do PolicyOps, que hoje versiona apenas as
matrizes.

**O épico GOV conecta as duas pontas**: o estado vigente da política inteira (não só matrizes) e o
processo de alteração dessa política — especificação, aprovação, publicação e histórico.

## 2. O que o épico adiciona (e o que preserva)

A partir deste épico, o produto passa a ter três pilares:

1. **Política como árvore de componentes** — a hierarquia de negócio (seções, regras, listas,
   reason codes, variáveis de política, matrizes) navegável, versionada e consultável em qualquer
   data, com o mesmo mecanismo de vigência das matrizes.
2. **Solicitação de Alteração (DB) estruturada** — o DB deixa de ser um Word e vira uma entidade:
   motivadores, componentes afetados, estado atual × proposto, critérios de aceite, testes,
   vigência, workflow de aprovação e trilha completa.
3. **Release e Pacote para a Fábrica** — solicitações aprovadas agrupam-se em releases; o
   documento enviado à fábrica (no formato dos DBs atuais, boilerplate incluído) é **gerado**, não
   redigitado.

Princípios que o épico **não** altera (restrições de [`01-visao-e-escopo.md`](01-visao-e-escopo.md)
e [`02-arquitetura.md`](02-arquitetura.md)):

- Um único `PolicyOps.html` autocontido; zero servidor, zero banco, zero rede em runtime.
- Sem login: o workflow é **governança processual, não autenticação** (DEC-GOV-004). Papéis são
  declarativos; o carimbo é o nome informado, como já ocorre em `savedBy` e na auditoria.
- Matriz continua entidade de primeira classe: o épico **não** reversiona matrizes em paralelo —
  o nó da árvore do tipo `MATRIX` referencia a matriz existente (DEC-GOV-002, invariante I23).
- `src/core/` puro, comandos com inverso, documento validado por Zod, migração aditiva de schema.

## 3. Conceitos e modelo

> ✅ **§3.1, §3.2 e §3.5 estão FECHADOS (sessão 32a).** O contrato de `PolicyComponent`,
> `ComponentVersion`, dos payloads e das coleções novas do documento passou a viver em
> **[`03-modelo-do-documento.md`](03-modelo-do-documento.md) §12** (componentes) e **§13**
> (entidades de governança), com a nota de migração 4 → 5 no §10 de lá. O que segue aqui é o
> **porquê** de cada decisão, preservado; quando os dois divergirem, **vale o docs/03**. §3.3 e §3.4
> também já estão declaradas no schema (é uma migração só, DEC-GOV-010), mas os comandos, o workflow
> e I30/I31 continuam sendo da S32b. §3.6 fecha o que ficou de fora.

### 3.1 Política, componente e hierarquia ✅ fechada na S32a

> Contrato normativo: **[`03-modelo-do-documento.md`](03-modelo-do-documento.md) §12**. O bloco
> abaixo é o rascunho original, mantido pelo raciocínio que o acompanha.

`Project` (já existente) é a Política ("Política B2C"). O documento ganha:

```ts
type PolicyComponent = {
  id: string;
  projectId: string;
  parentId?: string;                    // ausente = raiz da árvore do projeto
  position: number;                     // ordem entre irmãos, 0-based sem buracos
  code: string;                         // REGRA_DIVIDA_5000 — único no projeto, imutável
  name: string;                         // "Dívida Acima de R$ 5.000"
  type: 'SECTION' | 'RULE' | 'MATRIX' | 'LIST' | 'REASON_CODE' | 'POLICY_VARIABLE' | 'OTHER';
  matrixId?: string;                    // obrigatório e exclusivo de type MATRIX (I23)
  variableId?: string;                  // só type POLICY_VARIABLE: espelho da Biblioteca (I23)
  tags?: string[];                      // codes de CatalogItem kind TAG — facetas (DEC-GOV-011)
  origin?: { source: string; locator?: string };   // "Filtros e Critérios B2C, p. 10"
  reviewStatus: 'STRUCTURED' | 'VALIDATED' | 'PENDING_REVIEW' | 'HISTORICAL_SOURCE';
  archivedAt?: string;
  createdAt: string;
  versions: ComponentVersion[];         // sempre vazio em MATRIX; opcional em SECTION
};
```

- A árvore reflete o **modelo de negócio** (como no sumário do *Filtros e Critérios B2C*), não a
  implementação do motor — e **não é ordem de execução** (§3.6).
- `SECTION` é nó estrutural. Seção **sem** versões é uma pasta pura; seção **com** versões é um
  bloco de política com definição, vigência e histórico próprios — é onde vive a "Visão Geral" de
  um capítulo (`4.2 Regras Duras`, no documento real), que muda com o tempo e precisa de lastro.
  O usuário decide nó a nó; o caso comum é a pasta pura (DEC-GOV-011).
- `MATRIX` é um **espelho** e é sempre **folha**: nome, vigência e histórico vêm da `Matrix`
  referenciada; o nó só dá lugar na árvore e participa da fotografia histórica. Um nó aponta
  **uma** matriz — um capítulo como "Canal Digital" é uma `SECTION` com N nós `MATRIX` filhos, um
  por matriz já existente no projeto (DEC-GOV-011).
- `POLICY_VARIABLE` é espelho da Biblioteca de Variáveis quando `variableId` estiver preenchido —
  as faixas R01–R20, HVI3/HVI4 e BHV do Anexo A do documento real **já são** `Variable` com
  `groupingDimensions` (`03-modelo-do-documento.md` §2), e não podem virar uma segunda cópia
  versionada. Sem `variableId`, o tipo cobre variável de política que não é eixo de matriz.
- **Contenção**: `SECTION` contém qualquer tipo; `RULE`, `LIST`, `REASON_CODE`, `POLICY_VARIABLE`
  e `OTHER` **podem** ter filhos (sub-regras existem no documento real); `MATRIX` nunca tem.
- **Facetas**: `tags` é o mesmo mecanismo de `Matrix.tags` (`03-modelo-do-documento.md` §5,
  DEC-CARGA-003), com os mesmos grupos de faceta. A árvore diz **onde a coisa mora**; a faceta diz
  **como ela é achada** (`Cluster: G1`, `Canal: Digital`, `Risco CEP: Alto`). Uma hierarquia só
  não representa uma política que é escolhida por grupo × canal × risco geográfico ao mesmo tempo.
- O teto de profundidade da árvore é **6 níveis** (suficiente para o documento real analisado, que
  usa 4); alerta a partir de 300 componentes por projeto, teto 1.000. O documento real tem 16
  títulos de nível 1, 36 de nível 2 e 49 de nível 3 (~101 nós) — mais os nós das matrizes já
  importadas.

### 3.2 Versão de componente ✅ fechada na S32a

> Contrato normativo: **[`03-modelo-do-documento.md`](03-modelo-do-documento.md) §12.1 e §12.2**.
> Lá está a diferença que a implementação impôs: `ComponentVersion` não tem `ARCHIVED`, o `payload`
> é discriminado por `kind`, e `SECTION` usa `OtherPayload`.

Reutiliza o ciclo `DRAFT → PUBLISHED → SUPERSEDED` das matrizes, com vigência:

```ts
type ComponentVersion = {
  id: string;
  number: number;
  state: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
  effectiveFrom?: string;               // obrigatório ao publicar
  effectiveTo?: string;                 // preenchido quando substituída
  createdAt: string; createdBy: string;
  publishedAt?: string; publishedBy?: string;
  changeRequestId?: string;             // DB que originou (ausente = edição direta, RN-GOV-07)
  payload: RulePayload | ListPayload | ReasonCodePayload | PolicyVariablePayload | OtherPayload;
  spec?: RichDoc;                       // documentação livre (editor rico, §7)
};

type RulePayload = {
  businessDescription: string;          // linguagem de negócio
  technicalDefinition?: string;         // "Aging > 0 e Valor >= 5000"
  inputs?: string[];                    // variáveis/dados usados
  conditions?: string;                  // condições de ativação
  outcome?: string;                     // Aprovar / Reprovar / Derivar p/ Mesa / Continuar…
  reasonCodes?: string[];               // códigos, ex. DV01
  dependencies?: string[];              // codes de outros componentes
  notes?: string;
};
```

Os demais payloads são estruturas mínimas (lista: nome/finalidade/campos; reason code:
código/decisão/mensagem; variável de política: nome técnico/origem/domínio descritivo). Todos os
campos além de `businessDescription` são opcionais — a carga inicial raramente terá tudo (§9).

### 3.3 Solicitação de Alteração (DB) — schema declarado na S32a, comandos na S32b

> Contrato normativo: **[`03-modelo-do-documento.md`](03-modelo-do-documento.md) §13**.

```ts
type ChangeRequest = {
  id: string;
  code: string;                         // "DB-519" — sequencial sugerido, editável, único
  title: string;
  status: CrStatus;                     // §5, RN-GOV-01
  motivators: string[];                 // catálogo (kind MOTIVATOR) + texto livre em evidence
  motivationText?: RichDoc;             // evidência, problema, objetivo
  requestedBy: string; owner?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  items: ChangeRequestItem[];           // 1..N componentes afetados (RN-GOV-02)
  spec?: RichDoc;                       // especificação livre (editor rico)
  acceptanceCriteria: { given: string; when?: string; then: string }[];
  testScenarios: { kind: string; description: string }[];
  impacts: { category: string; description?: string }[];
  proposedEffectiveDate?: string;       // obrigatória para submeter (RN-GOV-03)
  releaseId?: string;
  approvals: { by: string; at: string; decision: 'APPROVED' | 'RETURNED' | 'REJECTED'; comment?: string }[];
  events: DocEvent[];                   // trilha própria, mesma mecânica da auditoria atual
  createdAt: string;
};

type ChangeRequestItem = {
  componentId: string;
  changeType: 'UPDATE' | 'CREATE' | 'DEACTIVATE' | 'REACTIVATE' | 'MOVE' | 'DOC_ONLY';
  baseVersionId?: string;               // versão vigente no momento da criação do item
  draftVersionId?: string;              // rascunho proposto (UPDATE/CREATE) — I25
  currentSummary?: string;              // "Hoje": preenchido automaticamente da versão vigente
  proposedSummary: string;              // "Proposto": obrigatório
};
```

Para itens sobre componentes `MATRIX`, `draftVersionId` aponta um rascunho da **matriz** — o
mecanismo de rascunho existente, sem duplicação.

### 3.4 Release — schema declarado na S32a, comandos na S32b

> Contrato normativo: **[`03-modelo-do-documento.md`](03-modelo-do-documento.md) §13**.

```ts
type Release = {
  id: string;
  code: string;                         // "2026.09.01"
  name?: string;
  plannedDate?: string;
  status: 'PLANNED' | 'IN_DEVELOPMENT' | 'PUBLISHED' | 'CANCELLED';
  publishedAt?: string; publishedBy?: string;
  notes?: string;
  createdAt: string;
};
```

Uma release agrupa CRs (`ChangeRequest.releaseId`). Publicar a release publica, numa operação
atômica, os rascunhos vinculados de todos os CRs `READY_FOR_RELEASE`/`SCHEDULED` dela, com a
vigência de cada CR (RN-GOV-05).

### 3.5 Novas coleções no documento ✅ fechada na S32a

> Contrato normativo: **[`03-modelo-do-documento.md`](03-modelo-do-documento.md) §1** (estrutura de
> topo) e **§10** (nota da migração 4 → 5, com a exceção do discriminador `kind` dos anexos).

`schemaVersion: 5` (o épico Plataforma ocupa a 4 com `meta.acl`, S29), migração 4→5 **puramente
aditiva**: `components: []`, `changeRequests: []`, `releases: []`, `attachments: []`, e novos kinds
de catálogo (`MOTIVATOR`, `IMPACT_CATEGORY`). Nenhum campo existente muda de forma. Nota de
migração em `03-modelo-do-documento.md` §10 (S32a).

`Project` ganha dois campos opcionais, ambos declarados na S32a e consumidos depois:
`foundationEffectiveFrom?: string` (a vigência da fundação, RN-GOV-09, usada pela S33b) e
`factoryTemplate?` (§8, usado pela S38).

O schema **não** acompanha a divisão S32a/S32b: as entidades de DB, release e anexo entram
declaradas e migradas já na S32a, mesmo sem comando nenhum que as escreva, para que exista uma
única migração 4→5 (DEC-GOV-010). A S32b só liga comandos e invariantes sobre uma forma de
documento que já é a definitiva.

### 3.6 O que **não** entra no modelo agora (adiado com registro)

Quatro coisas foram consideradas na revisão de UX e hierarquia e **deliberadamente adiadas**
(DEC-GOV-012). Nenhuma é "esquecida": todas voltam à mesa depois que a política as-is estiver
dentro da ferramenta, quando existir uso real para decidir.

| Adiado | Por quê | Quando revisitar |
|---|---|---|
| **Ordem de execução / fluxo do motor** | O documento real se declara sequencial e depois se contradiz em quatro pontos: na segmentação *"prevalece a última condição avaliada"*; o cineminha é escolhido por `grupo × canal × risco de CEP` (despacho, não sequência); "Grupo Controle" é avaliado em 4.1 **e** em 4.8; e a Derivação para Mesa vale *"para qualquer decisão automática"*. Modelar isso como lista ordenada mente; modelar como grafo é meio caminho para virar motor de decisão, que é fora de escopo (`01-visao-e-escopo.md` §7). O `outcome` da regra já distingue "termina aqui" de "continua" — o documento tem uma regra literalmente chamada *"Segue para o Modelo de Crédito"* com reason code `CO00 — Continue`. | Depois da S33b, com a política dentro |
| **Vocabulário tipado de seção (`sectionKind`)** | A ideia é boa (CMA, Política de Grupo, Cineminha como tipos de seção com ícone e layout próprios), mas o Anexo E do documento real usa outra convenção inteira (`I) a) b)`), o que sugere esperar o uso antes de fixar qualquer vocabulário. Enquanto isso, faceta (`tags`) cobre o caso. | Depois da S33a |
| **Referências não-donas** (o mesmo componente citado em dois lugares) | Caso real e frequente ("Grupo Controle" em 4.1 e 4.8; "Origem em Sistema Legado" em 4.1 e 4.2 com o mesmo `NG01`), mas o próprio documento resolve com uma frase de remissão. Na S33a isso é um link no inspector, não um nó — nó-alias duplicaria a contagem da fotografia histórica e criaria a pergunta "editei qual?". | Se o link do inspector não bastar |
| **Numeração de origem do Word** (`4.1`, `4.6`) | É estruturação do Word, não fato da política — e o documento real pula de 4.3 para 4.6. `origin.locator` já guarda a procedência de forma opcional, sem virar identidade nem ordenação. | Não previsto |

A ambiguidade que a ordem de execução deixa em aberto é resolvida na interface, não no modelo: a
árvore declara explicitamente que sua ordem é **de leitura**, e que a sequência de avaliação do
motor está descrita no texto de cada componente (`07-ux-e-editor.md` §17).

## 4. Histórias de usuário

### US-GOV-01 — Estruturar a política como árvore
**Como** analista, **quero** cadastrar os componentes da política numa hierarquia navegável
**para** que o estado vigente de cada regra viva na ferramenta, não num Word.

- Criar/renomear/mover/arquivar componentes de todos os tipos do §3.1; mover valida ciclo (I24).
- Componente `MATRIX` é criado apontando uma matriz existente do mesmo projeto; o nó exibe estado
  e vigência da matriz sem duplicá-los. As matrizes **já estão no documento** (épico Carga, S21–25):
  a árvore não as cria nem as importa — ela indica **onde na política** cada uma entra.
- Árvore com expandir/recolher, busca por nome/código, contagem por seção, filtro por
  `reviewStatus`/tipo e filtro por faceta (`tags`, §3.1).
- **A construção da primeira versão da política é manual e incremental** (DEC-GOV-012): montar o
  esqueleto de seções, pendurar as matrizes, e só então cadastrar as regras. Isso faz da ergonomia
  de digitação em volume um requisito, não um detalhe — ver US-GOV-02 e `07-ux-e-editor.md` §17.

### US-GOV-02 — Cadastrar e versionar uma regra
**Como** analista, **quero** registrar a regra com campos estruturados (§3.2) e documentação livre
**para** que "comportamento atual" seja consulta, não redação.

- Ciclo rascunho → publicar com `effectiveFrom` obrigatório; nunca sobrescrita destrutiva.
- Timeline da regra: toda versão com intervalo de vigência, autor, DB de origem (quando houver).
- Publicação direta (sem DB) permitida, mas marcada como tal na timeline (RN-GOV-07).
- **Caminho curto da fundação** (RN-GOV-09): cadastrar ~100 regras que já vigoram não pode custar
  ~100 publicações individuais. O projeto declara uma **vigência da fundação** (uma data, uma
  vez), a primeira versão de cada componente nasce apontando para ela, e "publicar pendentes"
  publica em lote com essa data — mesma filosofia da carga de matrizes e do §9 passo 4.
- Entrada em volume: duplicar componente, criar irmão sem sair do teclado, e colar um bloco de
  texto no formato do documento real (parágrafo de negócio + `Definição técnica:` + `Observação:`)
  reconhecido por prefixo de linha, sem parser de Markdown.

### US-GOV-03 — Criar uma Solicitação de Alteração
**Como** analista, **quero** criar um DB selecionando componentes na árvore **para** que o "hoje"
venha preenchido automaticamente da versão vigente.

- Fluxo: motivadores → componentes (1..N) → tipo de alteração por item → atual × proposto →
  impactos → critérios de aceite → testes → vigência proposta → submeter.
- Ao adicionar um item, `currentSummary` é preenchido da versão vigente (editável); para item
  `CREATE`, o "hoje" é "não existe".
- Um DB pode misturar tipos de componente (regra + reason code + matriz), como o DB-519 real.

### US-GOV-04 — Aprovar, devolver ou rejeitar
**Como** gestor, **quero** uma fila de solicitações submetidas com comparação atual × proposto
**para** decidir com contexto e deixar a decisão registrada.

- Fila filtra por status, prioridade, projeto e componente; abre a especificação completa.
- Decisão grava `{by, at, decision, comment}`; devolução exige comentário.
- Aprovação **não** publica nada (RN-GOV-04) — o status segue para desenvolvimento.

### US-GOV-05 — Publicar com vigência e release
**Como** analista, **quero** agrupar DBs aprovados numa release e publicá-la **para** que as novas
versões entrem em vigor na data definida, de forma atômica.

- Release lista seus DBs com status conjunto; publicar valida que todo item tem rascunho pronto.
- Publicação aplica `effectiveFrom` de cada CR; falha em qualquer item aborta tudo (RN-GOV-05).
- DB sem release pode ser publicado individualmente pelo mesmo mecanismo.

### US-GOV-06 — Gerar o Pacote para a Fábrica
**Como** analista, **quero** gerar o documento de especificação no padrão atual dos DBs **para**
nunca mais montar o Word na mão.

- Um clique produz HTML imprimível e Markdown com: identificação, boilerplate do projeto
  (checklist Serasa, comunicados — template editável, §8), contexto, atual × proposto por
  componente, impactos, critérios de aceite, testes, vigência e anexos.
- Gerável a partir de `APPROVED`; regenerável a qualquer momento (o documento é derivado, nunca
  editado à parte).

### US-GOV-07 — Consultar a política em qualquer data
**Como** analista, **quero** selecionar uma data e ver a política inteira como estava **para**
responder auditoria sem arqueologia.

- A fotografia combina componentes (versão vigente na data) e matrizes (mecanismo já existente);
  componentes sem versão vigente na data aparecem como inexistentes/desativados.
- Contadores do período: componentes vigentes, DBs publicados, DBs em andamento.

### US-GOV-08 — Comparar e acompanhar a evolução
**Como** gestor, **quero** comparar regra antes × depois, política em duas datas e o conteúdo de
uma release **para** enxergar o que mudou.

- Diff de payload campo a campo + diff de `spec` por bloco (§7); matrizes usam o diff existente.
- Timeline do Diário de Bordo: DBs publicados em ordem cronológica de vigência.

### US-GOV-09 — Carga da política por recorte (opcional)
**Como** analista, **quero** subir um capítulo já convertido em Markdown dentro de uma seção que
eu escolhi **para** acelerar a digitação quando ela for o gargalo — sem ser obrigado a importar a
política inteira de uma vez. Detalhe no §9.

### US-GOV-10 — Pendências ao abrir
**Como** gestor, **quero** ver ao abrir o documento o que espera minha ação **para** que o fluxo
ande sem notificações externas (que não existem sem servidor).

- Painel "Pendências": submetidos aguardando revisão, devolvidos ao autor, aprovados sem release,
  releases com data próxima/vencida. Filtrável por "meu nome".

## 5. Workflow da Solicitação (RN-GOV-01)

Estados e transições permitidas — qualquer outra transição é erro `E-GOV-01`:

```
DRAFT → SUBMITTED → IN_REVIEW → { CHANGES_REQUESTED → DRAFT | APPROVED | REJECTED }
APPROVED → IN_DEVELOPMENT → IN_VALIDATION → READY_FOR_RELEASE → SCHEDULED → PUBLISHED
Qualquer estado exceto PUBLISHED → CANCELLED
```

- `SUBMITTED` exige: ≥1 motivador, ≥1 item com `proposedSummary`, vigência proposta (RN-GOV-03).
- `CHANGES_REQUESTED` devolve a edição ao autor; o histórico de aprovação anterior permanece.
- A partir de `APPROVED`, itens ficam **congelados** (I25): mudar o escopo exige voltar a `DRAFT`
  via `CHANGES_REQUESTED` ou criar novo DB.
- `PUBLISHED` é terminal e só é atingido pela publicação (individual ou por release), nunca por
  mudança manual de status.

## 6. Regras de negócio e invariantes

- **RN-GOV-01** — Transições de status seguem exclusivamente o grafo do §5; toda transição grava
  evento com autor e data. Violação: `E-GOV-01`.
- **RN-GOV-02** — Um DB tem 1..N itens; um componente não pode aparecer duas vezes no mesmo DB;
  dois DBs abertos (status < APPROVED não conta) podem tocar o mesmo componente, mas a publicação
  do segundo exige rebase explícito se a versão base mudou (`E-GOV-02`, mesma filosofia da
  detecção de conflito de salvamento).
- **RN-GOV-03** — Submeter exige motivador, itens completos e vigência proposta. `E-GOV-03`.
- **RN-GOV-04** — **Aprovação não é publicação.** Aprovar apenas move o status; nenhuma versão
  muda de estado. A UI diz isso explicitamente.
- **RN-GOV-05** — Publicação (de DB ou de release) é atômica: valida todos os rascunhos
  vinculados, aplica `effectiveFrom`, publica tudo ou nada. `E-GOV-04` com a lista de pendências.
- **RN-GOV-06** — Nunca sobrescrita destrutiva: publicar versão N marca N−1 como `SUPERSEDED` com
  `effectiveTo = effectiveFrom(N)`; toda versão permanece consultável.
- **RN-GOV-07** — Publicação direta de componente (sem DB) é permitida e carimbada como
  `"publicação direta"` na timeline — governança incentiva, não tranca (DEC-GOV-004).
- **RN-GOV-08** — Pacote para a Fábrica é sempre **derivado** dos dados do DB no momento da
  geração; não existe cópia editável do pacote dentro da ferramenta.
- **RN-GOV-09** — A **vigência da fundação** é um campo do projeto, opcional, usado como
  `effectiveFrom` padrão da primeira versão de cada componente e pela publicação em lote dos
  pendentes. Não é um estado do documento nem um modo: é um valor padrão que o usuário pode
  sobrescrever em qualquer publicação. Publicar em lote segue a RN-GOV-05 (tudo ou nada).
- **I23** — Componente `MATRIX` tem `matrixId` válido, do mesmo projeto, `versions: []` e nenhum
  filho; nenhum outro tipo tem `matrixId`. Uma matriz é referenciada por no máximo um componente.
  Componente `POLICY_VARIABLE` pode ter `variableId`, que precisa apontar `Variable` existente;
  nenhum outro tipo tem `variableId`, e uma variável é espelhada por no máximo um componente.
- **I24** — A árvore é acíclica; `parentId` aponta componente do mesmo projeto; `position` sem
  buracos entre irmãos; profundidade ≤ 6; `PolicyComponent.code` único no projeto e imutável após
  a criação (§3.1) — é esta parte que a carga inicial usa para bloquear duplicata (`E-GOV-06`).
  Todo `code` em `tags` referencia `CatalogItem` de kind `TAG` existente, sem repetição no mesmo
  componente (mesma regra de `Matrix.tags`).
- **I27** — Versões em `SECTION` são permitidas e opcionais; quando existirem, seguem exatamente o
  mesmo ciclo e as mesmas regras das demais (RN-GOV-06). Seção sem versões nunca aparece como
  "sem política vigente" nas consultas por data — ela é estrutura, não conteúdo.
- **I25** — DB com status ≥ `APPROVED` tem itens imutáveis; `draftVersionId` de um item aponta
  rascunho cujo `changeRequestId` é o próprio DB.
- **I26** — `ChangeRequest.code` e `Release.code` são únicos no documento e imutáveis após
  criação (mesma regra dos demais `code`).

> **⚠️ Os números acima foram remapeados na S32a (DEC-GOV-014).** Quando este documento foi
> escrito, I23–I26 estavam livres; elas já tinham sido ocupadas pela ACL (S29) e pelas evidências
> (S30) em `03-modelo-do-documento.md` §9. A correspondência definitiva é:
>
> | Aqui | No schema (`03-modelo-do-documento.md` §9) | Sessão |
> |---|---|---|
> | I23 (MATRIX/POLICY_VARIABLE espelho) | **I27** | S32a ✅ |
> | I24 (árvore acíclica, `position`, profundidade, `code`, `tags`) | **I28** | S32a ✅ |
> | I27 (seção versionável, mesmo ciclo) | **I29** | S32a ✅ |
> | I25 (itens do DB congelados) | **I30** | S32b |
> | I26 (`code` de DB e de release) | **I31** | S32b |
>
> A imutabilidade de `PolicyComponent.code` é garantia de **comando** (`component/update` não aceita
> `code`), não de documento parado: I28 confere só a unicidade.
>
> **Quem implementa o quê**: I27, I28 e I29 entraram na **S32a** (a árvore depende delas); RN-GOV-09
> na **S33b** (o campo do projeto entrou no schema já na S32a); I30 e I31, na **S32b**, junto dos
> comandos de DB e release que as tornam alcançáveis. O catálogo `E-GOV-01..06` foi escrito inteiro
> na S32a (`05-regras-de-negocio.md` §9.1 traz a correspondência com os códigos do `DomainError`);
> os erros de workflow ficam sem emissor até a S32b.
>
> **RN-GOV-06 e vigência retroativa**: publicar versão de componente **aceita** data no passado, ao
> contrário das matrizes. É o que a RN-GOV-09 exige — a fundação cadastra regras que já vigoram — e
> fecha a pergunta 4 do §12 para componentes (`03-modelo-do-documento.md` §12.1).

## 7. Editor rico de especificação (`RichDoc`)

Editor de **blocos próprios**, sem dependência nova (DEC-GOV-005):

```ts
type RichDoc = { blocks: Block[] };
type Block =
  | { id: string; type: 'paragraph' | 'heading1' | 'heading2' | 'quote' | 'callout'; text: InlineText }
  | { id: string; type: 'bulletList' | 'numberList'; items: InlineText[] }
  | { id: string; type: 'table'; header: string[]; rows: string[][] }
  | { id: string; type: 'image'; attachmentId: string; caption?: string };
type InlineText = { text: string; marks?: ('bold' | 'italic' | 'code' | 'link')[]; href?: string }[];
```

> ✅ **Nome já ocupado (S30) — resolvido na S32a (DEC-GOV-015).** `attachments` e o tipo
> `Attachment` passaram a existir na sessão 30 com outro significado: o vínculo com o acervo de
> evidências `_evidencias/` (`03-modelo-do-documento.md` §8.1, `14-plataforma-local.md` §7) —
> arquivo na pasta de rede, não base64 no `.json`. A decisão foi **unificar numa coleção só com
> discriminador**: `Attachment = EvidenceAttachment | InlineImageAttachment`, separadas por `kind`.
> As duas são "arquivo pendurado no documento"; o que muda é onde o byte mora. O bloco `image` do
> `RichDoc` continua com `attachmentId`, apontando um `INLINE_IMAGE`. Contrato em
> `03-modelo-do-documento.md` §8.1.

- Imagens viram `Attachment` (coleção própria no documento): base64, redimensionadas no cliente
  para ≤ 1600px e re-encodadas; teto de **300 KB por imagem** e aviso quando os anexos passarem de
  **3 MB** no documento (o alvo de 10 MB do `.json` continua valendo). `E-GOV-05` acima do teto.
- Diff de `RichDoc` é **por bloco** (id estável): adicionado/removido/alterado — sem diff
  intra-texto na fase 1.
- Colar do Word/Excel: texto vira parágrafos; tabela HTML vira bloco `table`. Sem imagens no
  colar (limitação aceita; anexar é explícito).

## 8. Pacote para a Fábrica

- O `Project` ganha `factoryTemplate?: { boilerplate: RichDoc; contacts?: {...} }` — o conteúdo
  fixo dos DBs atuais (checklist Serasa, comunicados, boas práticas) editável uma vez por
  política.
- O pacote gerado segue a ordem do DB atual: capa/identificação → registro de versão → contatos →
  boilerplate → contexto e objetivo → escopo (por item: componente, hoje, proposto) → impactos →
  critérios de aceite → testes → vigência → anexos.
- Formatos: **HTML imprimível** (janela de impressão, mesma técnica do export atual) e
  **Markdown** (`.md` baixado). Export `.docx` fica explicitamente fora (dependência nova e
  orçamento — DEC-GOV-006); o caminho para Word é imprimir em PDF ou colar o HTML.

## 9. Carga da política por recorte (opcional — S40)

> **A carga não é o caminho primário, e não é a primeira coisa a executar** (DEC-GOV-012). A
> primeira versão da política é construída à mão pela árvore (S33a/S33b). Esta seção descreve um
> **acelerador opcional**, decidido depois do primeiro uso real: quando o gargalo for digitação —
> e não a decisão sobre o que é seção e o que é regra —, o mesmo documento convertido em Markdown
> pode ser subido **em recortes**, um capítulo de cada vez, dentro da seção que o usuário escolher.

Zero rede em runtime ⇒ a conversão de Word/PDF **não acontece dentro da ferramenta**
(DEC-GOV-007). O fluxo é:

1. Fora da ferramenta, o usuário converte o documento em **Markdown estruturado** (manualmente ou
   com IA — um prompt de conversão pronto acompanha a documentação da funcionalidade). O arquivo
   pode ser convertido inteiro de uma vez e usado aos pedaços: **recortar e colar um capítulo por
   vez é o uso esperado**, não uma degradação do fluxo.
2. Na ferramenta: **Importar → Identificar → Revisar → Confirmar**, com um passo a mais no início
   — **o destino**: a importação entra sob a seção selecionada na árvore (ou na raiz do projeto),
   de modo que um recorte que começa em `### Dívida Acima de R$ 5.000` caiba embaixo da seção
   `Bloqueios por Dívida` que já existe. O nível do heading mais alto do recorte vira o primeiro
   nível abaixo do destino; a profundidade resultante respeita I24 (≤ 6) e o passo de revisão
   avisa antes de estourar. Headings viram a hierarquia
   (`#`/`##`… → SECTION), blocos com marcadores convencionados viram componentes tipados:

   ```markdown
   ### Dívida Acima de R$ 5.000            <!-- vira RULE -->
   Bloqueia o cliente com dívida ≥ R$ 5.000…
   > Tipo: RULE
   > Código: REGRA_DIVIDA_5000
   > Definição técnica: Aging > 0 e Valor >= 5000
   > Reason code: DV01
   > Fonte: Filtros e Critérios B2C, p. 10
   ```

   Marcadores reconhecidos, todos opcionais: `> Tipo:` (vence a heurística), `> Código:` (na
   ausência, o `code` é derivado do nome — maiúsculas, sem acento, `_` no lugar de espaço, com
   sufixo numérico em caso de colisão), `> Definição técnica:`, `> Entradas:`, `> Condições:`,
   `> Resultado:`, `> Reason code:`, `> Dependências:`, `> Fonte:` (vira `origin`), `> Notas:`.
   O texto solto abaixo do heading vira `businessDescription`; nada vira `spec`/`RichDoc` na carga.
3. Tela de revisão mostra a árvore proposta com tipo inferido editável; nada entra sem confirmar.
4. Todo componente importado nasce com `origin` preenchido e `reviewStatus: 'PENDING_REVIEW'`;
   promover a `VALIDATED` é ação explícita. A primeira versão nasce `PUBLISHED` com
   `effectiveFrom` informado na carga (a política já vigia) — mesma filosofia da carga de
   matrizes.
5. Reimportação do mesmo arquivo identifica componentes por `code` e propõe apenas diferenças —
   escopo da fase 2 do épico; a fase 1 só bloqueia duplicata de `code` (`E-GOV-06`). Com a
   importação por recorte, esse bloqueio deixa de ser detalhe: é ele que impede o mesmo capítulo
   de entrar duas vezes quando o usuário perde a conta de onde parou.

### 9.1 Prompt de conversão (rascunho — fecha na S40, em `10-guia-do-usuario.md`)

O passo 1 não depende de nada implementado: **converter o Word já é possível hoje**. Cole o prompt
abaixo numa IA externa junto com o documento de política, confira o resultado, e guarde o `.md` —
ele serve tanto como fonte para digitar à mão (S33b, colando bloco a bloco) quanto para a
importação por recorte (S40), se ela for construída.

O documento real (*Filtros e Critérios de Crédito B2C*) tem uma anatomia constante que o prompt
apenas transcreve, sem inventar estrutura:

| No Word | Vira |
|---|---|
| Título 1 (`4.2 Regras Duras e Prevenção a Fraude`) | `SECTION` |
| Título 2 (`Bloqueios por Dívida`, `Prevenção a Fraude`) | `SECTION` — agrupamento temático, sem semântica de processo |
| Título 3 (`Dívida Acima de R$ 5.000`) | `RULE` |
| parágrafo solto abaixo do título | `businessDescription` |
| `Definição técnica: …` | `technicalDefinition` |
| `Observação: Reason code DV01 — reprovado, Oferta = 0.` | `reasonCodes` + `outcome` + `notes` |
| Anexos A/C/D (faixas, reason codes, listas) | **não viram componentes** — são Biblioteca de Variáveis e catálogo (§3.1) |

```text
Converta o documento de política de crédito em anexo para Markdown estruturado, seguindo
exatamente estas regras:

1. A hierarquia do documento vira hierarquia de headings (#, ##, ###, ####), no máximo 6 níveis.
   Um heading que só agrupa outros é uma seção; não invente seções que não existem no documento.
2. Cada regra, lista, reason code ou variável de política vira um heading próprio, seguido de um
   parágrafo em linguagem de negócio descrevendo o que ela faz hoje (o comportamento vigente).
3. Logo abaixo desse parágrafo, acrescente as linhas de marcador que o documento sustentar —
   nunca invente conteúdo, omita o marcador se a informação não estiver no documento:
   > Tipo: SECTION | RULE | LIST | REASON_CODE | POLICY_VARIABLE | OTHER
   > Código: IDENTIFICADOR_EM_MAIUSCULAS_COM_UNDERLINE
   > Definição técnica: a condição como aparece no documento
   > Entradas: variáveis ou campos usados, separados por vírgula
   > Condições: quando a regra é avaliada
   > Resultado: Aprovar | Reprovar | Derivar para Mesa | Continuar | ...
   > Reason code: códigos citados, separados por vírgula
   > Dependências: códigos de outros itens deste mesmo documento
   > Fonte: nome do documento e página/seção de origem
   > Notas: qualquer ressalva relevante
4. Matrizes e tabelas de corte NÃO devem virar tabelas Markdown: crie o heading com
   "> Tipo: OTHER" e descreva em uma frase o que a tabela decide, citando a fonte. As matrizes
   entram na ferramenta por outro caminho.
5. Não resuma nem reescreva a política: preserve os números, os nomes e os termos do documento.
   Se algum trecho estiver ambíguo, mantenha o texto original e acrescente "> Notas: revisar".
6. Quando o documento trouxer um parágrafo iniciado por "Definição técnica:", use-o em
   "> Definição técnica:". Quando trouxer "Observação:", distribua o conteúdo: os códigos citados
   em "> Reason code:", o veredito (Aprovado/Negado/Continue/Derivar) em "> Resultado:", e o
   restante da frase em "> Notas:".
7. Anexos de catálogo (faixas de score por regional, catálogo de reason codes, catálogo de listas)
   NÃO devem virar headings de componente: eles já existem na ferramenta como Biblioteca de
   Variáveis e catálogo. Ignore-os na conversão e mencione ao final quais anexos você ignorou.
8. Saída: um único bloco de Markdown, sem comentários seus antes ou depois. Mantenha os capítulos
   em blocos claramente separados — o arquivo será usado em recortes, um capítulo por vez.
```

O `.md` gerado é revisado por humano antes da carga — a tela de revisão do passo 3 é a segunda
barreira, não a primeira.

## 10. Cenários de teste (seleção — as sessões detalham os demais)

### CT-GOV-01 — DB de goodlist ponta a ponta (cobre US-03/04/05; caso real DB 515)
```gherkin
Dado   o componente RULE "Goodlist" publicado v1 ("aprova sempre que estiver na lista")
Quando o analista cria o DB-515 com item UPDATE sobre "Goodlist",
       proposedSummary "aprova só se valor do pedido ≤ limite em lista",
       vigência 2026-09-01, e submete
  E    o gestor aprova
  E    o DB avança até READY_FOR_RELEASE e é publicado
Então  "Goodlist" tem v2 PUBLISHED com effectiveFrom 2026-09-01 e changeRequestId = DB-515
  E    v1 está SUPERSEDED com effectiveTo 2026-09-01
  E    a consulta da política em 2026-08-15 mostra v1; em 2026-09-02, v2
```

### CT-GOV-02 — Aprovação não publica (cobre US-04, RN-GOV-04)
```gherkin
Dado   um DB SUBMITTED com rascunho vinculado
Quando o gestor aprova
Então  o status vira APPROVED, o rascunho permanece DRAFT
  E    a versão vigente do componente não mudou
```

### CT-GOV-03 — Publicação atômica de release (cobre US-05, RN-GOV-05)
```gherkin
Dado   a release 2026.09.01 com DB-515 (rascunho pronto) e DB-519 (item sem rascunho)
Quando o usuário publica a release
Então  a operação falha com E-GOV-04 listando a pendência do DB-519
  E    nenhuma versão de nenhum DB foi publicada
```

### CT-GOV-04 — Item congelado após aprovação (cobre RN-GOV-01, I25)
```gherkin
Dado   um DB APPROVED
Quando o autor tenta alterar o proposedSummary de um item
Então  a operação falha com E-GOV-01
  E    devolver para CHANGES_REQUESTED reabre a edição preservando o histórico de aprovação
```

### CT-GOV-05 — Carga inicial preserva origem (cobre US-09)
```gherkin
Dado   um Markdown com 3 seções e 12 regras com blocos "Fonte:"
Quando o usuário importa, revisa e confirma
Então  existem 3 SECTION e 12 RULE com origin preenchido e reviewStatus PENDING_REVIEW
  E    cada primeira versão está PUBLISHED com o effectiveFrom informado na carga
  E    desfazer (undo) remove a carga inteira
```

### CT-GOV-06 — DB multi-componente com matriz (cobre US-03, DEC-GOV-002)
```gherkin
Dado   um DB com um item RULE e um item MATRIX (rascunho da matriz vinculado)
Quando o DB é publicado com vigência 2026-09-01
Então  a versão da regra e a versão da matriz publicam juntas, ambas com a mesma vigência
  E    a timeline da matriz aponta o DB como origem
```

## 11. Fora do escopo do épico

- Autenticação, permissões reais, assinatura digital de aprovação (sem servidor não existe
  segurança — apenas governança processual; DEC-GOV-004).
- Notificações push/e-mail — substituídas pelo painel de pendências (US-GOV-10).
- Conversão de Word/PDF dentro da ferramenta e qualquer uso de IA em runtime (DEC-GOV-007).
- Export `.docx` do pacote (DEC-GOV-006).
- Acompanhamento do desenvolvimento na fábrica além do status do DB (sem integração).
- Diff intra-texto de blocos; reimportação incremental da carga inicial (fase 2).
- Simulador de decisão.

## 12. Perguntas abertas (fechar antes das sessões correspondentes)

> **Fechadas na revisão de UX e hierarquia de 2026-08-14** (DEC-GOV-011/012/013), antes da S32a:
> facetas em componente (**sim**), seção versionável (**sim, opcional**), `POLICY_VARIABLE` como
> espelho da Biblioteca (**sim**), um nó `MATRIX` por matriz (**sim** — "Canal Digital" é seção com
> N filhos), divisão da S33 em S33a/S33b (**sim**), construção manual incremental no lugar da
> carga na trilha antecipada (**sim**), carga por recorte com destino (**sim, opcional, S40**).
> O que foi **adiado com registro** está em §3.6.

1. **Numeração dos DBs** — seguir a sequência atual da área (DB-520 em diante) ou reiniciar?
   Proposta: campo livre com sugestão sequencial a partir do maior número existente. (S35)
2. **Papéis** — vale a pena um cadastro leve de pessoas (nome + papel declarado) para preencher a
   fila do gestor, ou o nome livre atual basta? Proposta: nome livre + papel escolhido por sessão
   de uso, sem cadastro. (S35)
3. **Boilerplate do pacote** — o checklist Serasa muda com frequência? Se sim, versionar o
   `factoryTemplate` como as demais entidades; proposta atual é campo simples editável. (S38)
4. **Vigência retroativa** — publicar com `effectiveFrom` no passado é permitido nas matrizes;
   manter igual para componentes? Proposta: sim, com aviso. (S36)
