# Governança de Alterações de Política (épico GOV)

> **Estado**: 🚧 Em andamento — **S32a entregue** (núcleo de componentes e `schemaVersion: 5`),
> **S32b entregue** (DB, release e workflow, sem tela), **S33a entregue** (árvore como tela do
> projeto, US-GOV-01 ✅ parcial — CRUD estrutural, busca, filtros e ergonomia de volume),
> **S33b entregue** (US-GOV-01 ✅ completa e US-GOV-02 ✅ — payload por tipo, ciclo de vida na
> tela, vigência da fundação e "Publicar pendentes", entrada em volume por colagem), **S40
> entregue** (US-GOV-09 ✅ — carga por recorte: Markdown → árvore, com revisão e undo total), **S34
> entregue** (`RichDoc`, editor de blocos próprio, plugado na página do componente) e **S35
> entregue** (US-GOV-03 ✅/US-GOV-04 ✅/US-GOV-10 ✅ — tela do DB, workflow de 12 estados, fila de
> aprovação e painel de pendências, docs/07 §19) e **S36 entregue** (US-GOV-05 ✅ parcial — vínculo
> item ↔ rascunho, congelamento de ponta a ponta, publicação atômica do DB com vigência e rebase
> explícito; a publicação **por release** é a S37) e **S37 entregue** (US-GOV-05 ✅ completa — CRUD
> de release, vínculo DB ≥ APPROVED, `release/publish` em lote reaproveitando `changeRequest/publish`
> — DEC-GOV-008 —, telas de release e da timeline do Diário de Bordo, US-GOV-08 parcial) e **S38
> entregue** (US-GOV-06 ✅ — gerador puro `buildFactoryPackage` §8, disponível a partir de `APPROVED`
> e sempre regenerado — RN-GOV-08 —, HTML de impressão e Markdown, `factoryTemplate` editável nas
> configurações do projeto, §12 pergunta 3 fechada) e **S39 entregue** (US-GOV-07 ✅ e US-GOV-08 ✅
> completas — fotografia da política inteira em qualquer data, comparação data × data e
> release × release, consulta histórica da política inteira na tela de Vigência, docs/07 §10 e §20,
> docs/05 §6.2–6.3) · **DECs relacionadas**:
> DEC-GOV-001 a DEC-GOV-040 em [`13-decisoes.md`](13-decisoes.md) · Normativo para as sessões do
> épico; os contratos de schema fecham na S32a e passam a viver em
> [`03-modelo-do-documento.md`](03-modelo-do-documento.md).
>
> **Ordem de execução (DEC-GOV-010, revista pela DEC-GOV-012)**: o objetivo da trilha antecipada
> continua o mesmo — ter a política real dentro da ferramenta antes de investir no resto do épico —
> mas o caminho mudou: a primeira versão da política é construída **à mão, de forma incremental**
> (seção a seção, regra a regra), e não por uma carga de tudo de uma vez. A antiga S33 virou
> **S33a** (árvore e esqueleto) + **S33b** (cadastro e versionamento de regras), e a carga por
> Markdown (§9, S40) passou a ser **opcional e por recorte**, decidida depois do primeiro uso real —
> e, uma vez decidida, entregue.
>
> ```
> 32a → 33a → 33b ✅ → ⟨ponto de parada: você constrói a política as-is e a gente ajusta a rota⟩
>   → 40 ✅ (opcional, por recorte) → 34 ✅ → 32b ✅ → 35 ✅ → 36 ✅ → 37 ✅/38 ✅ → 39 ✅
> ```
>
> O que só o Diário de Bordo consome (DB, release, grafo de estados, I25/I26) saiu da antiga S32 e
> virou a **S32b**, pré-requisito da S35. A S35 é quem dá tela a esse núcleo — nenhum comando novo,
> só a integração com `richdoc/` (extensão de `RichDocTarget`, prevista desde a S34) e as consultas
> de listagem/pendências que faltavam em `src/core/document/change-requests.ts`.

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
> **porquê** de cada decisão, preservado; quando os dois divergirem, **vale o docs/03**.
>
> ✅ **§3.3, §3.4 e §5 estão FECHADOS (sessão 32b).** O schema das duas entidades já tinha entrado na
> S32a (uma migração só, DEC-GOV-010); a S32b ligou os **comandos** de DB e de release
> ([`08-camada-de-comandos.md`](08-camada-de-comandos.md) §3), o **workflow** do §5 e as invariantes
> **I30/I31** ([`03-modelo-do-documento.md`](03-modelo-do-documento.md) §9). Publicar continua fora:
> é a S36. §3.6 fecha o que ficou de fora do modelo.

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

### 3.3 Solicitação de Alteração (DB) ✅ fechada na S32b (schema na S32a)

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

#### O vínculo item ↔ rascunho ✅ fechado na S36

Comandos em `src/core/document/cr-drafts.ts` (`08-camada-de-comandos.md` §3), tela em
`07-ux-e-editor.md` §19.5. Cinco regras, todas verificadas em tempo de comando:

1. **Vincular cria ou adota.** `changeRequest/linkDraft` cria o rascunho quando ele não existe
   (`componentVersion/createDraft` para componente, `version/createDraft` para matriz) ou **adota**
   o que o analista já tinha começado — nunca um segundo rascunho, porque I29/I1 permitem um só por
   componente/matriz. Ao adotar um rascunho de componente, o `changeRequestId` dele passa a apontar
   o DB (I30).
2. **Um rascunho pertence a no máximo um DB.** Em componente o vínculo é bilateral e a checagem
   olha os dois lados; em matriz, que não tem o campo de volta (DEC-GOV-002), a exclusividade é
   conferida varrendo os itens dos demais DBs. Violar é `INVALID_INPUT` com o código do outro DB.
3. **`baseVersionId` é preenchido no vínculo** quando ainda estiver vazio: é ele que a detecção de
   base desatualizada compara na hora de publicar (RN-GOV-02).
4. **Desvincular não descarta.** `changeRequest/unlinkDraft` solta o vínculo e devolve o rascunho ao
   componente (limpando o `changeRequestId`); descartar junto é o parâmetro explícito
   `discardDraft`, que a interface só liga depois de a pessoa marcar a caixa no diálogo.
5. **Item `CREATE` cria componente e rascunho juntos.** `changeRequest/createComponentItem` compõe
   `component/create` + `changeRequest/addItem` + `changeRequest/linkDraft` numa transação só, com
   um desfazer só. Fazer isso em três comandos separados deixaria — depois de um `Ctrl+Z` no
   primeiro — um item de DB apontando um componente que não existe mais, o que quebra I30.

Depois da publicação (§6, RN-GOV-05), `draftVersionId` **continua apontando a mesma versão**, que
agora está `PUBLISHED`: é ele o lastro entre o que foi aprovado e o que entrou em vigor. A exigência
de I30 se inverte nesse ponto — num DB `PUBLISHED`, item ainda em rascunho é que é erro
(`03-modelo-do-documento.md` §9, I30).

### 3.4 Release ✅ fechada na S32b (schema na S32a)

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

> ✅ **Publicação em lote fechada na S37** (`release/publish`, DEC-GOV-008). Entrar numa release exige
> CR **≥ APPROVED** (DEC-GOV-037) — antes disso "agrupar numa subida" não corresponde a nada decidido;
> sair continua livre até o CR fechar. Tela em `docs/07-ux-e-editor.md` §19.6.

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

### US-GOV-01 — Estruturar a política como árvore ✅ (S33a + S33b)
**Como** analista, **quero** cadastrar os componentes da política numa hierarquia navegável
**para** que o estado vigente de cada regra viva na ferramenta, não num Word.

- ✅ Criar/renomear/mover/arquivar/**duplicar** componentes de todos os tipos do §3.1; mover e
  duplicar validam ciclo e profundidade (I28) — `component/move`, `component/duplicate`.
- ✅ Componente `MATRIX` é criado apontando uma matriz existente do mesmo projeto (seletor com
  busca e filtro por tag); o nó exibe estado e vigência da matriz sem duplicá-los, e navega para o
  grid. As matrizes **já estão no documento** (épico Carga, S21–25): a árvore não as cria nem as
  importa — ela indica **onde na política** cada uma entra.
- ✅ Árvore com expandir/recolher, busca por nome/código, contagem por seção, filtro por
  `reviewStatus`/tipo e filtro por faceta (`tags`, §3.1) preservando ancestrais.
- ✅ **A construção da primeira versão da política é manual e incremental** (DEC-GOV-012): montar o
  esqueleto de seções, pendurar as matrizes, e só então cadastrar as regras. A ergonomia de
  digitação em volume (`Enter`/`Tab`/`Ctrl+D`) está na árvore desde a S33a —
  `07-ux-e-editor.md` §17.3.
- ✅ **S33b**: cadastrar e versionar o *conteúdo* de cada nó (payload por tipo, ciclo
  rascunho/publicar, timeline, vigência da fundação) — ver US-GOV-02. `RichDoc`/`spec` continua
  placeholder somente leitura até a S34.

### US-GOV-02 — Cadastrar e versionar uma regra ✅ (S33b)
**Como** analista, **quero** registrar a regra com campos estruturados (§3.2) e documentação livre
**para** que "comportamento atual" seja consulta, não redação.

- ✅ Ciclo rascunho → publicar com `effectiveFrom` obrigatório; nunca sobrescrita destrutiva
  (`ComponentInspector`, `componentVersion/createDraft`/`update`/`publish`/`discardDraft`).
  Formulário por tipo (`ComponentPayloadFields`) cobre os cinco payloads do §3.2;
  `POLICY_VARIABLE` com `variableId` mostra a variável espelhada (nome, domínios da versão
  publicada) sem duplicá-la, com link direto para a Biblioteca. Seção sem versões continua pasta
  pura (I29); a ação secundária "Documentar esta seção" cria a v1 e ela passa a ter texto,
  vigência e timeline como qualquer outra.
- ✅ Timeline da regra: toda versão com intervalo de vigência e autor, no padrão visual da timeline
  de matriz (`MatrixTimelineBar` reaproveitado, `getComponentTimeline`); DB de origem aparece
  quando existir (`changeRequestId`) — nenhum DB é criado antes da S35, então esse campo ainda não
  tem exemplo real.
- ✅ Publicação direta (sem DB) permitida, marcada como tal na timeline (RN-GOV-07) — o aviso
  aparece no diálogo de publicação individual e, uma vez só por lote (não por item), no diálogo de
  "Publicar pendentes".
- ✅ **Caminho curto da fundação** (RN-GOV-09): `Project.foundationEffectiveFrom`, editável nas
  propriedades do projeto (`CreateProjectDialog`), sugere a vigência da primeira publicação de
  cada componente e a vigência padrão do lote; "Publicar pendentes" (`PublishPendingComponentsDialog`,
  comando `componentVersion/publishPending`) lista os rascunhos abertos do projeto, permite
  desmarcar item a item, e publica o restante **tudo ou nada** (RN-GOV-05) — mesma filosofia da
  carga de matrizes e do §9 passo 4.
- ✅ Entrada em volume: criar irmão sem sair do teclado (S33a) e colar um bloco de texto no formato
  do documento real (parágrafo de negócio + `Definição técnica:` + `Observação:`) reconhecido por
  prefixo de linha, com preview antes de aplicar (`recognizeRulePaste`,
  `src/core/versioning/rule-paste.ts`) — sem parser de Markdown. Duplicar componente (`Ctrl/Cmd+D`,
  S33a) já copia o payload da versão mais recente como rascunho 1 da cópia.

### US-GOV-03 — Criar uma Solicitação de Alteração ✅ (S35)
**Como** analista, **quero** criar um DB selecionando componentes na árvore **para** que o "hoje"
venha preenchido automaticamente da versão vigente.

- ✅ Fluxo: motivadores → componentes (1..N) → tipo de alteração por item → atual × proposto →
  impactos → critérios de aceite → testes → vigência proposta → submeter — tela única
  (`ChangeRequestDetail`), sem wizard: a ordem do fluxo é a ordem vertical da tela (docs/07 §19.2).
- ✅ Ao adicionar um item, `currentSummary` é preenchido da versão vigente (editável,
  `getComponentCurrentSummary`); para item sem versão vigente (`CREATE` é o caso típico), o "hoje" é
  "não existe".
- ✅ Um DB pode misturar tipos de componente (regra + reason code + matriz), como o DB-519 real —
  `AddChangeRequestItemDialog` não filtra por tipo.

### US-GOV-04 — Aprovar, devolver ou rejeitar ✅ (S35)
**Como** gestor, **quero** uma fila de solicitações submetidas com comparação atual × proposto
**para** decidir com contexto e deixar a decisão registrada.

- ✅ Fila filtra por status, prioridade, projeto e componente; abre a especificação completa — é a
  mesma lista de DBs (`ChangeRequestsScreen`, docs/07 §19.1), filtrada para `SUBMITTED`/`IN_REVIEW`,
  não uma tela própria: qualquer DB nesse filtro já abre com atual × proposto por item e as três
  ações de decisão.
- ✅ Decisão grava `{by, at, decision, comment}`; devolução exige comentário — `DecisionDialog`
  desabilita o botão de confirmar até haver texto quando a decisão é `RETURNED` (docs/07 §19.3).
  **Atual × proposto nesta sessão é texto a texto** (`ChangeRequestItemRow`); diff rico por bloco é
  a S36, reusando `RichDocDiffView` (§18.5) para `spec`.
- Aprovação **não** publica nada (RN-GOV-04) — o status segue para desenvolvimento.

### US-GOV-05 — Publicar com vigência e release ✅ (S36 + S37)
**Como** analista, **quero** agrupar DBs aprovados numa release e publicá-la **para** que as novas
versões entrem em vigor na data definida, de forma atômica.

- ✅ **DB sem release publica individualmente** (`changeRequest/publish`, S36) — e é este o mecanismo
  que a release vai reutilizar em lote: publicar a release é rodar o mesmo plano para N DBs.
- ✅ Publicar valida **todos** os itens antes de escrever qualquer coisa (rascunho presente e ainda
  em rascunho, status na fila de publicação, vigência definida e coerente com a vigente de cada
  item); falha em qualquer um aborta tudo com `E-GOV-04` e a lista completa (RN-GOV-05).
- ✅ A publicação aplica o `effectiveFrom` do DB em **componentes e matrizes juntos**, numa operação
  atômica no padrão de `import/apply` — publicação parcial é impossível por construção, não por
  disciplina (DEC-GOV-034).
- ✅ Base desatualizada exige **rebase explícito**: rever o comparativo contra a nova vigente e
  reconfirmar item a item (`E-GOV-02`, RN-GOV-02). Nunca silencioso.
- ✅ **S37**: release lista seus DBs com **status conjunto** derivado deles (`deriveReleaseJointStatus`
  — `EMPTY`/`IN_PROGRESS`/`READY`/`PUBLISHED`/`CANCELLED`, sobre `assessReleaseComposition` já pronta
  desde a S32b) e publica em lote (`release/publish`, `ReleaseDetail`/`PublishReleaseDialog`, docs/07
  §19.6). Entrar numa release exige CR ≥ `APPROVED` (DEC-GOV-037); sair continua livre até fechar.

### US-GOV-06 — Gerar o Pacote para a Fábrica ✅ (S38)
**Como** analista, **quero** gerar o documento de especificação no padrão atual dos DBs **para**
nunca mais montar o Word na mão.

- ✅ Um clique produz HTML imprimível e Markdown com: identificação, registro de versão, contatos,
  boilerplate do projeto (checklist Serasa, comunicados — template editável, §8), contexto, atual ×
  proposto por componente, impactos, critérios de aceite, testes, vigência e anexos —
  `buildFactoryPackage` (`src/core/export/factory-package.ts`, puro) monta a estrutura nessa ordem
  exata; `factory-package-html.ts`/`factory-package-markdown.ts` renderizam. HTML abre numa janela
  dedicada (`src/lib/print-window.ts`) com imagens embutidas em base64 e quebra de página entre
  seções; Markdown referencia imagem por nome de anexo com um aviso, sem embutir bytes.
- ✅ Gerável a partir de `APPROVED` (`isFactoryPackageAvailable`, mesma ordem de
  `isChangeRequestFrozen`); regenerável a qualquer momento — o pacote nunca é gravado no documento
  (RN-GOV-08), só construído sob demanda a cada clique em "Gerar pacote" (DB) ou "Gerar pacotes"
  (lote, na release, só para os DBs ≥ `APPROVED`).
- ✅ `Project.factoryTemplate` (boilerplate `RichDoc` + contatos) editável em "Editar projeto":
  boilerplate pelo `RichDocEditor` de sempre, sobre um alvo novo de `RichDocTarget`
  (`PROJECT_FACTORY_BOILERPLATE`); contatos num editor de linhas simples
  (`FactoryContactsEditor`, nome/papel/e-mail livres — "Solicitante"/"Interessado" são valores de
  `role`, não um vocabulário fechado). O documento de exemplo semeia "Política PF" com um
  boilerplate representativo do checklist Serasa (não uma transcrição literal dos Words 513/515/519,
  que não fazem parte do repositório).

### US-GOV-07 — Consultar a política em qualquer data ✅ (S39)
**Como** analista, **quero** selecionar uma data e ver a política inteira como estava **para**
responder auditoria sem arqueologia.

- ✅ A fotografia combina componentes (versão vigente na data) e matrizes (mecanismo já existente,
  DEC-GOV-002): `getPolicyAt` (`src/core/timeline/policy-at.ts`), regras de borda e os três estados
  do nó (`EFFECTIVE`/`ABSENT`/`STRUCTURE`) em [`05-regras-de-negocio.md`](05-regras-de-negocio.md)
  §6.2. Componente sem versão vigente na data aparece como "sem política vigente"; seção pura
  aparece como estrutura (I29), nunca como regra que caducou; matriz sem espelho na árvore entra
  como nó de raiz (DEC-GOV-039).
- ✅ Contadores do período (`getPolicyPeriodCounters`): componentes e matrizes vigentes no fim do
  período, DBs publicados no período (pela vigência) e DBs em andamento.
- ✅ Na tela: a **tela de Vigência** mostra a estrutura inteira do projeto na data escolhida, em
  somente leitura, e a página do componente salta para ela pela faixa de vigência ("ver a política
  inteira nesta data") — docs/07 §10 e §20.1–20.2, DEC-UX-004.

### US-GOV-08 — Comparar e acompanhar a evolução ✅ (S37 + S39)
**Como** gestor, **quero** comparar regra antes × depois, política em duas datas e o conteúdo de
uma release **para** enxergar o que mudou.

- ✅ **S37**: Timeline do Diário de Bordo — DBs publicados em ordem cronológica de vigência, com
  componentes afetados e link para o DB e a release (`ChangeRequestTimelineScreen`,
  `getChangeRequestTimeline`, docs/07 §19.7).
- ✅ **S39**: comparação da política inteira entre duas pontas (`diffPolicySnapshots`,
  `src/core/diff/policy-diff.ts`, docs/05 §6.3): componentes adicionados/removidos/alterados com
  diff de payload campo a campo e de `spec` por bloco (§7), matrizes com o resumo do diff existente,
  tudo agregado por seção da árvore. A tela (docs/07 §20.3) tem dois modos: **data × data** e
  **release × release**, este usando as fotografias imediatamente antes e depois da vigência da
  release (DEC-GOV-040).
- Fora do épico: exportar a comparação e indicadores/analytics de mudança (§11).

### US-GOV-09 — Carga da política por recorte (opcional) ✅ (S40)
**Como** analista, **quero** subir um capítulo já convertido em Markdown dentro de uma seção que
eu escolhi **para** acelerar a digitação quando ela for o gargalo — sem ser obrigado a importar a
política inteira de uma vez. Detalhe no §9.

- ✅ Parser dedicado, puro e sem lib de Markdown (`parseMarkdownPolicy`,
  `src/core/import/markdown-policy.ts`): headings viram hierarquia de `SECTION`, blocos com os dez
  marcadores (`> Tipo:`…`> Notas:`) viram componente tipado com payload e `origin`; nunca lança —
  Markdown malformado vira `ImportIssue` de aviso (DEC-GOV-025).
- ✅ Assistente de três passos (`MarkdownImportDialog`, diálogo lançado da árvore — DEC-GOV-027):
  destino (seção escolhida ou raiz do projeto) + colar texto/selecionar arquivo → revisão da árvore
  proposta (tipo editável por linha, excluir item leva a subárvore junto, duplicata de `code`
  bloqueia com `E-GOV-06` apontando o componente existente) → confirmação com `effectiveFrom`
  sugerido pela fundação do projeto (RN-GOV-09) e resumo.
- ✅ Aplicação atômica por comandos existentes (`component/importMarkdown`,
  `src/core/import/markdown-apply.ts`): `component/create` + primeira versão `PUBLISHED` direto com
  `reviewStatus: PENDING_REVIEW`, em lote, com desfazer total dedicado (CT-GOV-05, DEC-GOV-026 —
  publicar é irreversível por natureza, então o undo do lote não compõe os inversos genéricos como
  `import/apply` faz).

### US-GOV-10 — Pendências ao abrir ✅ (S35)
**Como** gestor, **quero** ver ao abrir o documento o que espera minha ação **para** que o fluxo
ande sem notificações externas (que não existem sem servidor).

- ✅ Painel "Pendências" (`ChangeRequestPendingPanel`, na tela do documento — docs/07 §19.4):
  submetidos aguardando revisão, devolvidos ao autor, aprovados sem release. Filtrável por "meu
  nome" (`requestedBy`/`owner`/autor de uma decisão) — texto fixo no painel deixa explícito que
  isso é filtro de conveniência, não controle de acesso (DEC-GOV-004).
- "Releases com data próxima/vencida" continua fora do painel: a tela de release existe desde a S37
  (`ReleasesScreen`/`ReleaseDetail`, docs/07 §19.6, com `plannedDate` editável e listado), mas o
  painel de pendências ainda não lê/agrupa por ela — não fazia parte do escopo declarado da S37
  (CRUD, vínculo, publicação em lote e timeline). Revisitar quando o painel precisar mostrar mais que
  a fila de DBs (fora do escopo declarado até aqui).

## 5. Workflow da Solicitação (RN-GOV-01) ✅ fechado na S32b

Estados e transições permitidas — qualquer outra transição é erro `E-GOV-01`:

```
DRAFT → SUBMITTED → IN_REVIEW → { CHANGES_REQUESTED → DRAFT | APPROVED | REJECTED }
APPROVED → IN_DEVELOPMENT → IN_VALIDATION → READY_FOR_RELEASE → SCHEDULED → PUBLISHED
Qualquer estado exceto PUBLISHED → CANCELLED
```

- `SUBMITTED` exige: ≥1 motivador, ≥1 item com `proposedSummary`, vigência proposta (RN-GOV-03).
- `CHANGES_REQUESTED` devolve a edição ao autor; o histórico de aprovação anterior permanece.
- A partir de `APPROVED`, itens **e rascunhos vinculados** ficam **congelados** (I25): mudar o
  escopo exige voltar a `DRAFT` via `CHANGES_REQUESTED` ou criar novo DB.
- `PUBLISHED` é terminal e só é atingido pela publicação (individual — `changeRequest/publish`, S36
  — ou por release, S37), nunca por mudança manual de status.

### 5.1 Como o grafo virou código (S32b)

`src/core/document/cr-workflow.ts` transcreve o grafo acima **literalmente**, e
`changeRequest/transition` não valida mais nada além dele — com a única exigência que o próprio §5
impõe, a RN-GOV-03 ao entrar em `SUBMITTED`. Quatro leituras que o texto deixava implícitas:

1. **`PUBLISHED` é inalcançável por `transition`.** A aresta `SCHEDULED → PUBLISHED` existe no
  grafo, e é a publicação da S36 (`changeRequest/publish`) que a percorre; pedir a transição
  manualmente é `E-GOV-01`. Publicar é aceito a partir de **`READY_FOR_RELEASE`** — os dois estados
  de `RELEASE_READY_STATUSES` (§3.4): `SCHEDULED` é o DB que já tem data marcada numa release, e
  exigir a passagem por ele antes de publicar um DB **sem** release seria burocracia sem release
  para agendar.
2. **`CANCELLED` é terminal.** "Qualquer estado exceto `PUBLISHED` → `CANCELLED`" descreve as
  arestas *de entrada*; cancelar de novo o que já está cancelado é `E-GOV-01`, não um no-op.
3. **"status ≥ `APPROVED`" (I25/I30) é a ordem de `CrStatus`** como declarada em
  `03-modelo-do-documento.md` §13 — que é a ordem em que este §5 lista os estados. Ela inclui
  `REJECTED` e `CANCELLED` no congelamento, o que é o comportamento desejado: DB fechado não tem
  escopo reaberto, vira DB novo.
4. **Aprovar, devolver e rejeitar são as arestas de `IN_REVIEW`** — `changeRequest/approve`,
  `/return` e `/reject` fazem a transição **e** gravam `{by, at, decision, comment}` em `approvals`
  (US-GOV-04). `transition` também alcança esses três estados, e nesse caminho não há decisão
  registrada; a interface (S35) usa sempre os comandos de decisão.

> ⚠️ **Uma ambiguidade do texto acima, resolvida em favor do grafo (DEC-GOV-020).** O terceiro
> bullet do §5 diz que mudar escopo depois de `APPROVED` "exige voltar a `DRAFT` via
> `CHANGES_REQUESTED`", e o CT-GOV-04 repete a ideia — mas o grafo **não tem** a aresta
> `APPROVED → CHANGES_REQUESTED`: de `APPROVED` só se vai para `IN_DEVELOPMENT` ou `CANCELLED`. A
> S32b implementou o **grafo**, que é o normativo, e a devolução por `CHANGES_REQUESTED` continua
> valendo a partir de `IN_REVIEW` — reabrindo a edição e preservando o histórico de aprovação, que
> é o que o CT-GOV-04 verifica. Depois de aprovado, o caminho para mudar escopo é a segunda metade
> do próprio bullet: **criar um DB novo** (ou cancelar). Se o uso real mostrar que reabrir um DB
> aprovado é necessário, o que muda é o grafo deste §5 — uma linha aqui e uma no
> `CR_TRANSITIONS` —, não a arquitetura.

## 6. Regras de negócio e invariantes

- **RN-GOV-01** — Transições de status seguem exclusivamente o grafo do §5; toda transição grava
  evento com autor e data. Violação: `E-GOV-01`.
- **RN-GOV-02** ✅ **completa na S36** — Um DB tem 1..N itens; um componente não pode aparecer duas
  vezes no mesmo DB; dois DBs abertos (status < APPROVED não conta) podem tocar o mesmo componente,
  mas a publicação do segundo exige rebase explícito se a versão base mudou (`E-GOV-02`, mesma
  filosofia da detecção de conflito de salvamento). **Como o rebase acontece**: `changeRequest/publish`
  compara `item.baseVersionId` com a versão vigente **no instante da publicação**; divergiu, recusa
  com `E-GOV-02` e não escreve nada. A tela mostra o comparativo do rascunho contra a **nova**
  vigente (não contra a base declarada — é essa a pergunta) e libera uma caixa de reconfirmação por
  componente; publicar de novo passa os `componentId` reconfirmados, e a reconfirmação vale só para
  aquela chamada. Reconfirmar **não** reescreve o rascunho: o conteúdo proposto é publicado como
  está, por cima da nova vigente.
- **RN-GOV-03** — Submeter exige motivador, itens completos e vigência proposta. `E-GOV-03`.
- **RN-GOV-04** — **Aprovação não é publicação.** Aprovar apenas move o status; nenhuma versão
  muda de estado. A UI diz isso explicitamente.
- **RN-GOV-05** ✅ **completa** (S36 para o DB individual, S37 para a release) — Publicação (de DB
  ou de release) é atômica: valida todos os rascunhos vinculados, aplica `effectiveFrom`, publica
  tudo ou nada. `E-GOV-04` com a lista de pendências. **A release** (`release/publish`) roda a mesma
  publicação de DB uma vez por CR pronto, dentro de uma única transação (DEC-GOV-008): pendência de
  qualquer CR aborta a release inteira, e cada CR mantém a sua própria `proposedEffectiveDate` — não
  existe vigência única de release. O que a S36 fecha para o DB individual, item a item:
  - **quem publica versão**: item `UPDATE`, `CREATE` ou `DOC_ONLY` **com rascunho vinculado**;
  - **quem não publica versão, mas faz efeito**: `DEACTIVATE` arquiva o componente e `REACTIVATE` o
    desarquiva, na mesma transação (`component/archive` / o interno que o desfaz);
  - **quem não faz nada**: `MOVE` — a árvore já foi movida quando o analista a moveu; e
    `DOC_ONLY`/`DEACTIVATE`/`REACTIVATE` sem rascunho. O diálogo de publicação diz isso em uma linha
    por item, para ninguém procurar um efeito que não existe;
  - **a vigência é a do DB** (`proposedEffectiveDate`), a mesma para todos os itens — não há data
    por item, e mudá-la é editar o DB;
  - **`PUBLISHED` é atingido só por aqui** (§5), e publicar é irreversível: o inverso é o comando
    que falha com mensagem clara, como em `version/publish`.
- **RN-GOV-06** — Nunca sobrescrita destrutiva: publicar versão N marca N−1 como `SUPERSEDED` com
  `effectiveTo = effectiveFrom(N)`; toda versão permanece consultável.
- **RN-GOV-07** — Publicação direta de componente (sem DB) é permitida e carimbada como
  `"publicação direta"` na timeline — governança incentiva, não tranca (DEC-GOV-004).
- **RN-GOV-08** — Pacote para a Fábrica é sempre **derivado** dos dados do DB no momento da
  geração; não existe cópia editável do pacote dentro da ferramenta.
- **RN-GOV-09** ✅ **implementada na S33b** — A **vigência da fundação** é um campo do projeto,
  opcional (`Project.foundationEffectiveFrom`, editável em "Editar projeto"), usado como sugestão
  de `effectiveFrom` no diálogo de publicação da primeira versão de um componente e como vigência
  padrão do lote em "Publicar pendentes" (`PublishPendingComponentsDialog`) — sempre editável, nos
  dois casos, antes de confirmar. Não é um estado do documento nem um modo. Publicar em lote é o
  comando `componentVersion/publishPending`, que segue a RN-GOV-05 (tudo ou nada) validando o lote
  inteiro antes de escrever qualquer versão (DEC-GOV-023).
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
- **I25** ✅ **completa na S36** — DB com status ≥ `APPROVED` tem itens imutáveis; `draftVersionId` de
  um item aponta rascunho cujo `changeRequestId` é o próprio DB. **O congelamento alcança o
  rascunho, não só o item** (`src/core/document/cr-freeze.ts`): a partir de `APPROVED`, editar
  payload, especificação, células ou eixos de um rascunho vinculado é `E-GOV-01`, e descartá-lo
  também. O que **não** é barrado é publicar aquele rascunho por fora do DB — isso continua sendo
  publicação direta (RN-GOV-07), e a consequência aparece na hora certa: o item passa a apontar uma
  versão que não é mais rascunho, e a publicação do DB recusa com `E-GOV-04` em vez de escrever por
  cima (DEC-GOV-034). `CHANGES_REQUESTED` reabre tudo, item e rascunho, preservando o histórico de
  aprovação.
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
> | I25 (itens do DB congelados) | **I30** | S32b ✅ |
> | I26 (`code` de DB e de release) | **I31** | S32b ✅ |
>
> A imutabilidade de `PolicyComponent.code` é garantia de **comando** (`component/update` não aceita
> `code`), não de documento parado: I28 confere só a unicidade. O mesmo vale para o `code` de DB e de
> release (I31) e para o **congelamento** de I30: um documento em repouso não sabe se o item mudou
> depois da aprovação, então quem garante isso é `assertItemsEditable`, e I30 confere a parte
> estrutural (um componente por DB, referências válidas, rascunho apontando de volta).
>
> **Quem implementa o quê**: I27, I28 e I29 entraram na **S32a** (a árvore depende delas); RN-GOV-09
> ✅ **S33b** (o campo do projeto entrou no schema já na S32a); I30 e I31, na **S32b**, junto dos
> comandos de DB e release que as tornam alcançáveis. O catálogo `E-GOV-01..06` foi escrito inteiro
> na S32a (`05-regras-de-negocio.md` §9.1 traz a correspondência com os códigos do `DomainError`);
> a S32b ligou `E-GOV-01` e `E-GOV-03`, e deixou `E-GOV-02`/`E-GOV-04` para a S36 — os dois só
> acontecem no ato de publicar. O que a S32b entrega no lugar deles é a avaliação **estática** de
> composição da release (`assessReleaseComposition`), que já lista a base defasada e o item sem
> rascunho como pendência tipada.
>
> **RN-GOV-06 e vigência retroativa**: publicar versão de componente **aceita** data no passado, ao
> contrário das matrizes. É o que a RN-GOV-09 exige — a fundação cadastra regras que já vigoram — e
> fecha a pergunta 4 do §12 para componentes (`03-modelo-do-documento.md` §12.1). **Na publicação do
> DB (S36) cada entidade mantém a sua regra** (DEC-GOV-035): um DB só de componentes publica com
> vigência retroativa; um DB com item de **matriz** e vigência no passado é recusado antes de
> escrever qualquer coisa, com a pendência tipada `ITEM_EFFECTIVE_DATE_RETROACTIVE` dentro de
> `E-GOV-04` — a saída é ajustar a vigência ou tirar a matriz do escopo. A ordem continua valendo
> para os dois: a vigência nova precisa começar depois da vigente de cada item
> (`ITEM_EFFECTIVE_DATE_ORDER`).
>
> **Os dois erros que faltavam ganharam emissor na S36**: `E-GOV-02` (`CR_BASE_VERSION_STALE`) e
> `E-GOV-04` (`RELEASE_PUBLISH_BLOCKED`) são lançados por `changeRequest/publish`, que lê a
> avaliação estática de `assessChangeRequestReadiness` (S32b) e a transforma em `DomainError` —
> exatamente como `05-regras-de-negocio.md` §9.1 previa. A mesma avaliação, agora com o instante da
> publicação, é o que a tela pinta **antes** de o usuário clicar
> (`preflightChangeRequestPublish`).

## 7. Editor rico de especificação (`RichDoc`) ✅ entregue (S34)

Editor de **blocos próprios**, sem dependência nova (DEC-GOV-005). Entregue na S34: núcleo puro em
`src/core/richdoc/` (operações com inverso, sanitização do colar, diff por bloco), componentes em
`src/components/richdoc/` e um `contentEditable` **por linha**. Interações e atalhos:
[`07-ux-e-editor.md`](07-ux-e-editor.md) §18.

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
  Remover o bloco de imagem apaga o anexo **quando ele fica órfão**, na mesma transação, com
  inverso exato (DEC-GOV-031).
- Diff de `RichDoc` é **por bloco** (id estável): adicionado/removido/alterado — sem diff
  intra-texto na fase 1. A S34 acrescentou **movimento** ao vocabulário: bloco com o mesmo id e o
  mesmo conteúdo em ordem relativa diferente é `MOVED`, não remoção + adição (DEC-GOV-029).
- Colar do Word/Excel: texto vira parágrafos; tabela HTML vira bloco `table`. **Estrutura sobrevive,
  formatação não** — negrito, cor, fonte e `class=Mso*` são descartados, e o parser é próprio (sem
  `DOMParser`, porque `src/core/` é TypeScript puro) — DEC-GOV-030. Lista do Word (parágrafo que
  começa com `·`) é reconhecida como `bulletList`, e TSV de várias colunas vira tabela. Sem imagens
  no colar (limitação aceita; anexar é explícito).
- Edição é comando: **uma tecla, um comando** (`richdoc/apply`), com coalescência na pilha de undo
  para que um `Ctrl+Z` desfaça o parágrafo inteiro (DEC-GOV-028, `08-camada-de-comandos.md` §2).
  Nada de texto pendurado em estado de componente esperando um "salvar" — é o que sustenta o
  "nada do que digitar se perde".

## 8. Pacote para a Fábrica ✅ fechado na S38

- O `Project` ganha `factoryTemplate?: { boilerplate: RichDoc; contacts?: {...} }` — o conteúdo
  fixo dos DBs atuais (checklist Serasa, comunicados, boas práticas) editável uma vez por
  política. `factoryTemplate` é um **campo simples**, não versionado (§12 pergunta 3): o pacote em
  si nunca é uma cópia gravada (RN-GOV-08 já garante isso), então não existe pacote histórico cujo
  boilerplate precisasse ser reconstituído como estava — regenerar sempre lê o `factoryTemplate`
  **atual**.
- O pacote gerado segue a ordem do DB atual: capa/identificação → registro de versão → contatos →
  boilerplate → contexto e objetivo → escopo (por item: componente, hoje, proposto) → impactos →
  critérios de aceite → testes → vigência → anexos.
- Formatos: **HTML imprimível** (janela de impressão, mesma técnica do export atual) e
  **Markdown** (`.md` baixado). Export `.docx` fica explicitamente fora (dependência nova e
  orçamento — DEC-GOV-006); o caminho para Word é imprimir em PDF ou colar o HTML.

## 9. Carga da política por recorte (opcional — S40) ✅ entregue

> **A carga não é o caminho primário, e não é a primeira coisa a executar** (DEC-GOV-012). A
> primeira versão da política é construída à mão pela árvore (S33a/S33b). Esta seção descreve um
> **acelerador opcional**, decidido depois do primeiro uso real: quando o gargalo for digitação —
> e não a decisão sobre o que é seção e o que é regra —, o mesmo documento convertido em Markdown
> pode ser subido **em recortes**, um capítulo de cada vez, dentro da seção que o usuário escolher.
> Entregue na S40 como `MarkdownImportDialog` (diálogo lançado da árvore, DEC-GOV-027), sobre o
> parser puro `src/core/import/markdown-policy.ts` e o comando atômico
> `component/importMarkdown` (`src/core/import/markdown-apply.ts`).

Zero rede em runtime ⇒ a conversão de Word/PDF **não acontece dentro da ferramenta**
(DEC-GOV-007). O fluxo é:

1. Fora da ferramenta, o usuário converte o documento em **Markdown estruturado** (manualmente ou
   com IA — o prompt de conversão pronto vive em [`10-guia-do-usuario.md`](10-guia-do-usuario.md)
   §11). O arquivo pode ser convertido inteiro de uma vez e usado aos pedaços: **recortar e colar
   um capítulo por vez é o uso esperado**, não uma degradação do fluxo.
2. Na ferramenta: **destino + colar/selecionar arquivo → revisão → confirmação** (três passos,
   `MarkdownImportDialog`) — **o destino** é o que esta sessão acrescenta ao desenho original: a
   importação entra sob a seção selecionada na árvore (ou na raiz do projeto), de modo que um
   recorte que começa em `### Dívida Acima de R$ 5.000` caiba embaixo da seção
   `Bloqueios por Dívida` que já existe. O nível do heading mais alto do recorte vira o primeiro
   nível abaixo do destino; a profundidade resultante respeita I28 (≤ 6) e o passo de revisão
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
3. Tela de revisão mostra a árvore proposta com tipo inferido editável por linha e a opção de
   excluir um item (leva a subárvore dele junto); nada entra sem confirmar.
4. Todo componente importado nasce com `origin` preenchido e `reviewStatus: 'PENDING_REVIEW'`;
   promover a `VALIDATED` é ação explícita. A primeira versão nasce `PUBLISHED` com
   `effectiveFrom` informado na carga (a política já vigia) — mesma filosofia da carga de
   matrizes.
5. Reimportação do mesmo arquivo identifica componentes por `code` e propõe apenas diferenças —
   escopo da fase 2 do épico; a fase 1 só bloqueia duplicata de `code` (`E-GOV-06`). Com a
   importação por recorte, esse bloqueio deixa de ser detalhe: é ele que impede o mesmo capítulo
   de entrar duas vezes quando o usuário perde a conta de onde parou.

### 9.1 Prompt de conversão ✅ movido para `10-guia-do-usuario.md`

O passo 1 não depende de nada implementado dentro da ferramenta: **converter o Word acontece fora
dela** (DEC-GOV-007). O prompt de conversão pronto — que gera exatamente o formato que
`parseMarkdownPolicy` aceita, sem divergência — e a anatomia do documento real que ele transcreve
vivem em [`10-guia-do-usuario.md`](10-guia-do-usuario.md) §10, junto do resto do fluxo de carga
(onde colar, como revisar, o que a confirmação faz). Ele serve tanto como fonte para digitar à mão
(S33b, colando bloco a bloco) quanto para a importação por recorte (S40).

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
✅ **Completo na S36** (`tests/e2e/diario-de-bordo.spec.ts` de ponta a ponta pela tela, mais
`tests/unit/core/document/cr-publish.test.ts` no núcleo): DRAFT → … → READY_FOR_RELEASE →
**PUBLISHED**, com o rascunho vinculado, a v2 em vigor em 2026-09-01 carregando
`changeRequestId = DB-515`, a v1 `SUPERSEDED` com `effectiveTo` casando, e a consulta por data
devolvendo v1 em 2026-08-15 e v2 em 2026-09-02. ✅ **A parte final também pela fotografia da política
inteira na S39** (`tests/unit/core/timeline/policy-at.test.ts`): `getPolicyAt` em 2026-08-15 traz a
Goodlist com v1 e em 2026-09-02 com v2, junto do resto do projeto.

### CT-GOV-02 — Aprovação não publica (cobre US-04, RN-GOV-04)
```gherkin
Dado   um DB SUBMITTED com rascunho vinculado
Quando o gestor aprova
Então  o status vira APPROVED, o rascunho permanece DRAFT
  E    a versão vigente do componente não mudou
```
✅ **Coberto pela tela desde a S35** (mesmo spec do CT-GOV-01 acima): depois de aprovar, o item
continua congelado mas visível, o banner de RN-GOV-04 aparece na tela, e o documento salvo confirma
que a versão publicada da Goodlist continua só a v1 — nenhuma v2 nasceu.

### CT-GOV-03 — Publicação atômica de release (cobre US-05, RN-GOV-05)
```gherkin
Dado   a release 2026.09.01 com DB-515 (rascunho pronto) e DB-519 (item sem rascunho)
Quando o usuário publica a release
Então  a operação falha com E-GOV-04 listando a pendência do DB-519
  E    nenhuma versão de nenhum DB foi publicada
```
✅ **Coberto no caso individual desde a S36** (`cr-publish.test.ts`): um DB com dois itens, um deles
sem rascunho, falha com `E-GOV-04` apontando o item pendente, e o item que **estava** pronto continua
sem publicar. Um segundo teste prova a atomicidade contra falha no meio do lote: com o segundo item
quebrado (matriz com célula pendente, I6), o documento sai byte a byte igual ao que entrou.

✅ **Coberto no caso da release (N DBs) na S37** (`release-publish.test.ts`), com o cenário exato do
Gherkin acima — DB-515 pronto e DB-519 com item sem rascunho, a release inteira falha com
`RELEASE_PUBLISH_BLOCKED` (`E-GOV-04`) apontando `DB_519`, e a Goodlist do DB-515 continua na v1. A
mesma injeção de I6 no meio do lote (matriz do segundo DB perde uma decisão de célula depois de tudo
pronto) prova a atomicidade da release: `release/publish` chama `changeRequest/publish` por DB dentro
de um `Run`/`step` só (DEC-GOV-008), e o documento sai byte a byte igual ao que entrou quando o
segundo DB falha. Um terceiro teste publica 2 DBs de vigências distintas com sucesso e confere que
cada versão carrega o `effectiveFrom` do seu próprio DB — não existe vigência única de release. E2E
em `tests/e2e/release-e-timeline.spec.ts`: release "2026.09.01 — DB-515, DB-519" criada, publicada e
visível na timeline (§25 da especificação de origem).

### CT-GOV-04 — Item congelado após aprovação (cobre RN-GOV-01, I25)
```gherkin
Dado   um DB APPROVED
Quando o autor tenta alterar o proposedSummary de um item
Então  a operação falha com E-GOV-01
  E    devolver para CHANGES_REQUESTED reabre a edição preservando o histórico de aprovação
```
✅ **Completo na S36** (`cr-drafts.test.ts`): além do item, o **rascunho vinculado** é testado nas
quatro portas de edição — payload, especificação rica, células e eixos de matriz, e descarte —, todas
recusando com `E-GOV-01`; a devolução por `CHANGES_REQUESTED` reabre e as `approvals` anteriores
continuam lá. Devolver **a partir de** `APPROVED` continua fora do grafo (DEC-GOV-020).

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
✅ **Coberto na S36** (`cr-publish.test.ts`). Como `MatrixVersion` não tem `changeRequestId`
(DEC-GOV-002), o vínculo com o DB na timeline da matriz é o **carimbo no evento** de publicação
(`changeRequestId`/`changeRequestCode` no payload de `VERSION_PUBLISHED`/`VERSION_SUPERSEDED`) —
mesma técnica do `importRunId` de `import/apply`. A nota da publicação da matriz, que
`version/publish` exige com ao menos 10 caracteres, é derivada do DB (`Publicado pelo DB_515 — …`),
nunca pedida de novo ao usuário.

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

> **Fechadas na implementação da S35** (DEC-GOV-032):
>
> 1. **Numeração dos DBs** — a proposta foi implementada como estava: campo livre (`code`), com
>    sugestão sequencial a partir do maior `DB_<n>` já existente no documento
>    (`suggestNextChangeRequestCode`), sempre editável antes de confirmar a criação — inclusive para
>    "reiniciar" a numeração da área ou seguir de onde a lista em Word parou, basta digitar por
>    cima da sugestão. Não há reserva nem trava de sequência: dois documentos que nunca se tocaram
>    podem sugerir o mesmo número, e é o `code` único no documento (I31) que resolve colisão na hora
>    de confirmar.
> 2. **Papéis** — resolvida a favor do "nome livre basta", e mais: nem um cadastro leve chegou a ser
>    necessário, porque a resposta já estava implementada desde a S32b sem que este documento
>    tivesse sido atualizado para registrá-la (`08-camada-de-comandos.md` §6 — "aprovar um DB é
>    `EDITOR`, não `PUBLISHER`"). Todo o workflow do DB, aprovação incluída, usa o mesmo mecanismo
>    de identidade do resto do produto (`savedBy`, ADR-003): o carimbo em `approvals[].by` é o nome
>    digitado (ou o login capturado pelo servidor local), sem papel específico de "aprovador" no
>    motor de `src/core/document/roles.ts`. A tela (`ChangeRequestPendingPanel`, docs/07 §19.4)
>    declara isso explicitamente para que ninguém suponha um controle de acesso que não existe
>    (DEC-GOV-004).

1. ~~**Numeração dos DBs**~~ ✅ fechada acima.
2. ~~**Papéis**~~ ✅ fechada acima.
3. ~~**Boilerplate do pacote**~~ ✅ fechada na S38 — **campo simples editável**, não versionado.
   Confirmada com o usuário antes de implementar (a pergunta estava aberta, e o prompt da S38 exigia
   parar e perguntar): como o pacote gerado nunca é uma cópia gravada (RN-GOV-08 — sempre derivado,
   regenerado a cada clique), não existe "pacote histórico" cujo boilerplate precisasse ficar
   congelado no formato de quando foi gerado. Versionar o `factoryTemplate` resolveria um problema
   que não existe hoje e abriria escopo novo (schema de histórico, comandos, tela) sem nenhum ADR/DEC
   prevendo isso. Se o checklist Serasa via a mudar com frequência **e** existir a necessidade real
   de saber qual boilerplate valia num pacote gerado no passado, isso volta à mesa como sessão
   própria — não é o caso hoje, com um único template por projeto.
4. ~~**Vigência retroativa**~~ ✅ fechada na S36 — ver a nota do §6: **sim** para componente (é o que
   a RN-GOV-09 exige), **não** para matriz (docs/05 §1.3 continua valendo), e a publicação do DB
   avisa antes, na revisão, em vez de descobrir no meio do lote (DEC-GOV-035).

