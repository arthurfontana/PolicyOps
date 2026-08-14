# Governança de Alterações de Política (épico GOV)

> **Estado**: 🔮 Planejado (sessões S32–S40) · **DECs relacionadas**: DEC-GOV-001 a DEC-GOV-009
> em [`13-decisoes.md`](13-decisoes.md) · Normativo para as sessões do épico; os contratos de
> schema fecham na S32 e passam a viver em [`03-modelo-do-documento.md`](03-modelo-do-documento.md).

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

## 3. Conceitos e modelo (rascunho normativo — fecha na S32)

### 3.1 Política, componente e hierarquia

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
  origin?: { source: string; locator?: string };   // "Filtros e Critérios B2C, p. 10"
  reviewStatus: 'STRUCTURED' | 'VALIDATED' | 'PENDING_REVIEW' | 'HISTORICAL_SOURCE';
  archivedAt?: string;
  createdAt: string;
  versions: ComponentVersion[];         // vazio para SECTION e MATRIX
};
```

- A árvore reflete o **modelo de negócio** (como no sumário do *Filtros e Critérios B2C*), não a
  implementação do motor. `SECTION` é nó estrutural sem versões próprias.
- `MATRIX` é um **espelho**: nome, vigência e histórico vêm da `Matrix` referenciada; o nó só dá
  lugar na árvore e participa da fotografia histórica.
- O teto de profundidade da árvore é **6 níveis** (suficiente para o documento real analisado, que
  usa 4); alerta a partir de 300 componentes por projeto, teto 1.000.

### 3.2 Versão de componente

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

### 3.3 Solicitação de Alteração (DB)

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

### 3.4 Release

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

### 3.5 Novas coleções no documento

`schemaVersion: 5` (o épico Plataforma ocupa a 4 com `meta.acl`, S29), migração 4→5 **puramente
aditiva**: `components: []`, `changeRequests: []`, `releases: []`, e novos kinds de catálogo
(`MOTIVATOR`, `IMPACT_CATEGORY`). Nenhum campo existente muda de forma. Nota de migração em
`03-modelo-do-documento.md` §10 (S32).

## 4. Histórias de usuário

### US-GOV-01 — Estruturar a política como árvore
**Como** analista, **quero** cadastrar os componentes da política numa hierarquia navegável
**para** que o estado vigente de cada regra viva na ferramenta, não num Word.

- Criar/renomear/mover/arquivar componentes de todos os tipos do §3.1; mover valida ciclo (I24).
- Componente `MATRIX` é criado apontando uma matriz existente do mesmo projeto; o nó exibe estado
  e vigência da matriz sem duplicá-los.
- Árvore com expandir/recolher, busca por nome/código e contagem por seção.

### US-GOV-02 — Cadastrar e versionar uma regra
**Como** analista, **quero** registrar a regra com campos estruturados (§3.2) e documentação livre
**para** que "comportamento atual" seja consulta, não redação.

- Ciclo rascunho → publicar com `effectiveFrom` obrigatório; nunca sobrescrita destrutiva.
- Timeline da regra: toda versão com intervalo de vigência, autor, DB de origem (quando houver).
- Publicação direta (sem DB) permitida, mas marcada como tal na timeline (RN-GOV-07).

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

### US-GOV-09 — Carga inicial da política
**Como** analista, **quero** importar a documentação existente para a árvore **para** não
recadastrar centenas de regras à mão. Detalhe no §9.

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
- **I23** — Componente `MATRIX` tem `matrixId` válido, do mesmo projeto, e `versions: []`; nenhum
  outro tipo tem `matrixId`. Uma matriz é referenciada por no máximo um componente.
- **I24** — A árvore é acíclica; `parentId` aponta componente do mesmo projeto; `position` sem
  buracos entre irmãos; profundidade ≤ 6.
- **I25** — DB com status ≥ `APPROVED` tem itens imutáveis; `draftVersionId` de um item aponta
  rascunho cujo `changeRequestId` é o próprio DB.
- **I26** — `ChangeRequest.code` e `Release.code` são únicos no documento e imutáveis após
  criação (mesma regra dos demais `code`).

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

> ⚠️ **Nome já ocupado (S30).** `attachments` no topo do documento e o tipo `Attachment` passaram
> a existir na sessão 30 com outro significado: o vínculo com o acervo de evidências
> `_evidencias/` (`03-modelo-do-documento.md` §8.1, `14-plataforma-local.md` §7) — arquivo na
> pasta de rede, não base64 no `.json`. A sessão que implementar o editor rico precisa escolher
> outro nome para a coleção de imagens (`images`? `inlineAssets`?) **ou** decidir explicitamente
> unificar as duas ideias numa coleção só com discriminador; o que não pode é reusar o nome sem
> decidir. Ponto a fechar antes da S34, junto das perguntas abertas do §12.

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

## 9. Carga inicial da política

Zero rede em runtime ⇒ a conversão de Word/PDF **não acontece dentro da ferramenta**
(DEC-GOV-007). O fluxo é:

1. Fora da ferramenta, o usuário converte o documento em **Markdown estruturado** (manualmente ou
   com IA — um prompt de conversão pronto acompanha a documentação da funcionalidade).
2. Na ferramenta: **Importar → Identificar → Revisar → Confirmar**. Headings viram a hierarquia
   (`#`/`##`… → SECTION), blocos com marcadores convencionados viram componentes tipados:

   ```markdown
   ### Dívida Acima de R$ 5.000            <!-- vira RULE -->
   Bloqueia o cliente com dívida ≥ R$ 5.000…
   > Definição técnica: Aging > 0 e Valor >= 5000
   > Reason code: DV01
   > Fonte: Filtros e Critérios B2C, p. 10
   ```
3. Tela de revisão mostra a árvore proposta com tipo inferido editável; nada entra sem confirmar.
4. Todo componente importado nasce com `origin` preenchido e `reviewStatus: 'PENDING_REVIEW'`;
   promover a `VALIDATED` é ação explícita. A primeira versão nasce `PUBLISHED` com
   `effectiveFrom` informado na carga (a política já vigia) — mesma filosofia da carga de
   matrizes.
5. Reimportação do mesmo arquivo identifica componentes por `code` e propõe apenas diferenças —
   escopo da fase 2 do épico; a fase 1 só bloqueia duplicata de `code` (`E-GOV-06`).

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

1. **Numeração dos DBs** — seguir a sequência atual da área (DB-520 em diante) ou reiniciar?
   Proposta: campo livre com sugestão sequencial a partir do maior número existente. (S35)
2. **Papéis** — vale a pena um cadastro leve de pessoas (nome + papel declarado) para preencher a
   fila do gestor, ou o nome livre atual basta? Proposta: nome livre + papel escolhido por sessão
   de uso, sem cadastro. (S35)
3. **Boilerplate do pacote** — o checklist Serasa muda com frequência? Se sim, versionar o
   `factoryTemplate` como as demais entidades; proposta atual é campo simples editável. (S38)
4. **Vigência retroativa** — publicar com `effectiveFrom` no passado é permitido nas matrizes;
   manter igual para componentes? Proposta: sim, com aviso. (S36)
