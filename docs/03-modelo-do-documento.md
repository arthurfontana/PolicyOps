# Modelo do Documento

> Normativo e literal. O arquivo `.json` é o banco de dados do produto: ele precisa ser legível por um humano, validável por Zod e estável entre versões da aplicação.

## 1. Estrutura de topo

```ts
type PolicyOpsDocument = {
  schemaVersion: 5;                // 1 até a sessão 18; migrado na leitura (§10)
  meta: DocumentMeta;
  variables: Variable[];
  compatibility: CompatibilityRule[];
  catalog: CatalogItem[];
  projects: Project[];
  matrices: Matrix[];
  templates: Template[];
  importProfiles: ImportProfile[];   // perfis de carga (§9)
  components: PolicyComponent[];     // árvore de política, achatada (§12)
  changeRequests: ChangeRequest[];   // solicitações de alteração — "DB" (§13)
  releases: Release[];               // releases (§13)
  attachments?: Attachment[];        // evidências e imagens embutidas (§8.1) — ausente quando não há nenhuma
  events: DocEvent[];
};

type DocumentMeta = {
  id: string;               // nanoid do workspace, imutável
  name: string;             // "Políticas de Crédito — Cartões"
  description?: string;
  revision: number;         // incrementa a cada salvamento; base da detecção de conflito
  savedAt: string | null;   // ISO 8601 UTC
  savedBy: string | null;   // nome informado pelo usuário
  appVersion: string;       // versão do PolicyOps.html que salvou
  createdAt: string;
  acl?: Acl;                 // papéis de acesso — ausente = modo aberto (sessão 29, §9, I23/I24)
};

/** Papéis de acesso do documento — `14-plataforma-local.md` §6, ADR-003. */
type Role = 'READER' | 'EDITOR' | 'PUBLISHER' | 'ADMIN';

type Acl = {
  users: Array<{ username: string; role: Role }>;
  defaultRole: 'READER' | 'EDITOR';   // papel de quem não está na lista
};
```

Convenções gerais:

- **Todo id** é `nanoid(12)`.
- **Toda data** é string ISO 8601 em UTC (`2026-08-05T14:32:00.000Z`).
- **Todo decimal** é string (`"2000.00"`). Nunca `number`.
- **Todo código** (`code`) casa `^[A-Z0-9_]+$`, é único no seu escopo e **imutável após a criação**.
- Campos opcionais são **omitidos** quando vazios, não gravados como `null`. Isso mantém o arquivo pequeno e legível.
- Arrays de entidades são ordenados por `position` quando a ordem importa; senão, por `createdAt`.

> **Onde ficam as seções do épico Governança.** O `schemaVersion: 5` (sessão 32a) acrescentou dois
> domínios inteiros — **§12 Componentes de política** e **§13 Entidades de governança** —, e eles
> entraram **no fim deste documento**, depois de §11, em vez de no meio. É deliberado: inserir §9
> ou §10 no meio renumeraria as invariantes, a migração e o documento de exemplo, que são citados
> por número em dezenas de pontos do repositório e do código. A numeração fora de ordem custa uma
> nota; a renumeração custaria uma varredura em tudo.

## 2. Biblioteca de Variáveis

```ts
type Variable = {
  id: string;
  code: string;                    // SCORE_HVI3
  name: string;                    // "Score HVI3"
  description?: string;
  type: 'ORDINAL' | 'CATEGORICAL' | 'RANGE' | 'BOOLEAN';
  archivedAt?: string;
  createdAt: string;
  versions: VariableVersion[];     // ordenadas por number
};

type VariableVersion = {
  id: string;
  number: number;                  // 1, 2, 3…
  state: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
  notes?: string;
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  publishedBy?: string;
  domains: Domain[];               // ordenados por position
  // apenas quando type = RANGE, e opcional mesmo assim; 1 a 4 níveis
  groupingDimensions?: GroupingDimension[];
  // apenas quando type = RANGE, e opcional mesmo assim; default INCLUSIVE_INTEGER
  boundaryMode?: 'HALF_OPEN' | 'INCLUSIVE_INTEGER';
};

// Presença de groupingDimensions muda a leitura de TODOS os domínios RANGE
// da versão: eles passam a usar `groupingRanges` em vez de `rangeMin`/`rangeMax`.
// É um interruptor por versão, não por domínio — nunca mistura os dois modos.
//
// boundaryMode é outro interruptor por versão (independente de
// groupingDimensions, vale tanto para rangeMin/rangeMax quanto para
// groupingRanges): ausente ou 'INCLUSIVE_INTEGER' é [mín, máx] com passo 1 —
// os valores precisam ser inteiros, e I9 exige atual.máx + 1 == próxima.mín.
// Resolve faixas coladas direto do Excel no formato fechado-fechado (ex.:
// 0–357, 358–437) sem o usuário precisar reescrever o máximo de cada faixa
// para repetir o mínimo da seguinte. 'HALF_OPEN' é o [mín, máx) clássico —
// I9 exige atual.máx == próxima.mín — e é opt-in explícito, para faixas
// decimais ou que tocam exatamente no limite.
//
// Em ambos os boundaryMode, a sequência por position pode crescer ou
// decrescer (cortes de score às vezes vêm "melhor faixa primeiro": R01 com
// a faixa mais alta, R20 com a mais baixa) — I9 detecta a direção pelo
// primeiro par de mínimos distintos e valida a contiguidade nesse sentido.
//

// GroupingDimension generaliza o que até a sessão 18 era só "regional":
// em vez de um único nível fixo, a variável pode declarar de 1 a 4 níveis
// de agrupamento, com nome e opções livres (Regional, Porte, Tipo de
// Empresa, Canal, Produto…). O teto é 4, não os 3 de `AxisLevel` (I13) —
// os dois limites são independentes por design, porque agrupamento nunca
// vira eixo nem tupla (ver §6.1): o custo de mais um nível aqui é só
// leitura da tabela pelo usuário, não combinatória de matriz.
type GroupingDimension = {
  code: string;                    // REGIONAL, PORTE, TIPO_EMPRESA… único entre os níveis da versão
  label: string;                   // rótulo de exibição — "Regional", "Porte da empresa"
  options: GroupingOption[];       // ao menos 1; ordem = ordem de exibição nas colunas
};

type GroupingOption = {
  code: string;                    // SP, MEI, NAO_MEI_1_SOCIO… único dentro do seu nível
  label: string;                   // rótulo de exibição
};

type Domain = {
  code: string;                    // R1
  label: string;                   // "R1 — Risco muito baixo"
  shortLabel?: string;             // "R1" — usado no cabeçalho do grid
  position: number;                // 0-based, sem buracos
  color?: string;                  // #RRGGBB
  // apenas quando type = RANGE e a versão NÃO declara groupingDimensions
  rangeMin?: string;               // decimal como string
  rangeMax?: string;
  minInclusive?: boolean;          // default true
  maxInclusive?: boolean;          // default false
  isCatchAll?: boolean;            // "acima de X" / "demais casos"
  // apenas quando type = RANGE e a versão DECLARA groupingDimensions
  groupingRanges?: GroupingRange[];
};

// path tem o mesmo comprimento de VariableVersion.groupingDimensions, na
// mesma ordem — path[i] é sempre um GroupingOption.code válido do nível i.
// Não existe uma entrada para cada combinação possível de opções: só para
// as combinações que o usuário efetivamente definiu (ver I19). É o que
// permite modelar hierarquias assimétricas — nem toda Regional tem MEI,
// por exemplo — sem forçar o preenchimento de combinações que não existem
// no negócio.
type GroupingRange = {
  path: string[];                  // um código por nível de groupingDimensions
  min: string;                     // decimal como string
  max?: string;                    // ausente quando o domínio é isCatchAll
  minInclusive?: boolean;          // default true
  maxInclusive?: boolean;          // default false
};
```

**Por que isso fica na variável, não na matriz.** `code`, `label`, `shortLabel`, `position` e `color` são a **identidade** da faixa — é o que a matriz referencia, e R01 é o mesmo R01 em qualquer combinação de agrupamento. `groupingRanges` é só o **threshold numérico** que cada combinação (ex.: São Paulo × MEI) usa para classificar um score bruto em R01 — informação de governança da variável, nunca uma dimensão do grid. Um documento com `groupingDimensions` continua tendo, por matriz, o mesmo número de colunas/linhas que teria sem ele: a diferença fica só na biblioteca. Isso vale mesmo quando os agrupamentos representam a mesma dimensão de negócio que hoje existe como variável separada num eixo (ex.: Segmento) — o uso pretendido de `groupingDimensions` é documentar **variações do corte de uma única variável**, não substituir a composição de variáveis distintas em eixos aninhados (`04-eixos-aninhados.md`); as duas coisas são mecanismos independentes e não competem entre si.

## 3. Biblioteca de Compatibilidade

Declara, para um par ordenado de variáveis, quais domínios do filho existem sob cada domínio do pai.

```ts
type CompatibilityRule = {
  id: string;
  code: string;                    // SEG_X_FATURAMENTO
  name: string;                    // "Segmento × Faixa de Faturamento"
  description?: string;
  parentVariableId: string;
  childVariableId: string;
  archivedAt?: string;
  createdAt: string;
  versions: CompatibilityVersion[];
};

type CompatibilityVersion = {
  id: string;
  number: number;
  state: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
  notes?: string;
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  publishedBy?: string;
  // versões de variável usadas para escrever o mapa (rastreabilidade)
  parentVariableVersionId: string;
  childVariableVersionId: string;
  // domínio do pai → domínios permitidos do filho
  allow: Record<string, string[]>;
  // o que fazer com domínios do pai ausentes de `allow`
  defaultForUnlisted: 'ALL' | 'NONE';   // default 'ALL'
};
```

Exemplo:

```json
{
  "code": "SEG_X_FATURAMENTO",
  "parentVariableId": "…SEGMENTO",
  "childVariableId": "…FAT",
  "versions": [{
    "number": 1, "state": "PUBLISHED",
    "allow": {
      "VAREJO":    ["ATE_100K", "100K_500K", "500K_1M"],
      "ATACADO":   ["500K_1M", "1M_10M", "ACIMA_10M"],
      "CORPORATE": ["1M_10M", "ACIMA_10M"]
    },
    "defaultForUnlisted": "NONE"
  }]
}
```

**Só existe uma regra publicada por par (parent, child)** — invariante I12. Criar uma segunda para o mesmo par é erro `COMPATIBILITY_PAIR_DUPLICATE`.

## 4. Biblioteca de Conteúdo

```ts
type CatalogItem = {
  id: string;
  kind: 'DECISION' | 'OFFER' | 'LIMIT' | 'TAG'
      | 'MOTIVATOR' | 'IMPACT_CATEGORY';  // dois últimos: schema 5, motivadores e impactos do DB (§13)
  code: string;                    // APROVADO / OFERTA_8 / LIM_2000
  label: string;
  description?: string;
  color?: string;
  numericValue?: string;           // obrigatório quando kind = LIMIT
  group?: string;                  // apenas kind = TAG: faceta de filtro ("Canal", "Cluster")
  position: number;
  archivedAt?: string;
  createdAt: string;
};
```

`code` é único **dentro do `kind`**; o mesmo código em kinds diferentes é permitido.

`group` só tem significado em `kind: 'TAG'`: é o rótulo da faceta pela qual as tags são agrupadas
no filtro de matrizes (`07-ux-e-editor.md` §15). Texto livre, comparado como está; tag sem grupo
cai na faceta "Sem grupo". Em qualquer outro kind o campo é ignorado.

## 5. Projetos e Matrizes

```ts
type Project = {
  id: string;
  code: string;                    // POLITICA_PJ
  name: string;
  description?: string;
  position: number;
  foundationEffectiveFrom?: string;  // vigência da fundação (RN-GOV-09) — schema 5
  factoryTemplate?: FactoryTemplate; // boilerplate do Pacote para a Fábrica — schema 5
  archivedAt?: string;
  createdAt: string;
};

/** Boilerplate fixo dos DBs, editável uma vez por política (`14-governanca-de-alteracoes.md` §8). */
type FactoryTemplate = {
  boilerplate: RichDoc;
  contacts?: Array<{ name: string; role?: string; email?: string }>;
};

type Matrix = {
  id: string;
  projectId: string;
  code: string;                    // MTZ_LIMITE_PJ — único dentro do projeto
  name: string;
  description?: string;
  tags?: string[];                 // codes de CatalogItem de kind TAG, sem repetição
  archivedAt?: string;
  createdAt: string;
  versions: MatrixVersion[];       // ordenadas por number
};
```

`tags` é a classificação livre da matriz — o que torna navegável um projeto com uma centena de
matrizes (`13-decisoes.md` DEC-CARGA-003). Cada entrada é o `code` de um `CatalogItem` de kind
`TAG`; a ordem não tem significado, e o campo é omitido quando vazio. Tag arquivada continua
listada na matriz que a tem, apenas sai dos filtros. A carga de matrizes aplica tags
automaticamente a partir das colunas de partição (`12-carga-de-matrizes.md` §5.4), sempre
acrescentando — nunca removendo o que foi marcado à mão.

## 6. Versão de matriz — o coração

```ts
type MatrixVersion = {
  id: string;
  number: number;
  state: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'ARCHIVED';
  notes?: string;
  baseVersionId?: string;          // de qual versão este rascunho derivou
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  publishedBy?: string;
  effectiveFrom?: string;          // definido na publicação
  effectiveTo?: string;            // preenchido quando uma versão mais nova publica
  archivedAt?: string;

  axes: { x: Axis; y: Axis };
  cells: Record<string, Cell>;     // chave = `${xPath}::${yPath}`
};
```

### 6.1 Eixo

```ts
type Axis = {
  role: 'X' | 'Y';
  levels: AxisLevel[];             // do mais externo (0) ao mais interno; 1 a 3
  tuples: string[];                // SNAPSHOT: combinações válidas, já ordenadas
  manualSuppressions?: string[];   // caminhos removidos manualmente nesta versão
  derivedFrom: {
    compatibilityVersionIds: string[];   // regras usadas para gerar `tuples`
  };
};

type AxisLevel = {
  id: string;
  variableId: string;
  variableVersionId: string;       // o pin
  label: string;                   // rótulo exibido; default = Variable.name
  domains: Domain[];               // SNAPSHOT congelado, cópia de VariableVersion.domains
};
```

**Domínios com `groupingRanges` entram no snapshot sem esse campo.** `matrix/create`, `axis/addLevel` e `axis/resnapshot` copiam de `VariableVersion.domains` apenas os campos de identidade (`code`, `label`, `shortLabel`, `position`, `color`, `isCatchAll`, e `rangeMin`/`rangeMax` quando existirem) — nunca `groupingRanges` nem `groupingDimensions`. É o mecanismo que garante, no schema, que a matriz nunca carrega os agrupamentos hierárquicos da variável: o snapshot de uma variável com 20 faixas × 9 regionais × 3 portes tem o mesmo tamanho que teria sem agrupamento nenhum.

**`tuples` é o snapshot definitivo da estrutura do eixo.** É uma lista de caminhos, cada um com tantos códigos quantos forem os níveis, separados por `|`:

```json
"tuples": [
  "VAREJO|ATE_100K", "VAREJO|100K_500K", "VAREJO|500K_1M",
  "ATACADO|500K_1M", "ATACADO|1M_10M", "ATACADO|ACIMA_10M",
  "CORPORATE|1M_10M", "CORPORATE|ACIMA_10M"
]
```

Gerado a partir dos domínios e das regras de compatibilidade no momento em que o rascunho é criado — e **nunca regenerado sozinho depois**. Regenerar é uma ação explícita do usuário (reconciliação, `06-regras-de-negocio.md` §5).

Um eixo de 1 nível tem tuplas de um código só (`"R1"`, `"R2"`, …) — o caso simples é o caso geral com `levels.length === 1`.

### 6.2 Célula

```ts
type Cell = {
  decision?: string;               // CatalogItem.code de kind DECISION
  offer?: string;                  // code de kind OFFER
  limit?: string;                  // code de kind LIMIT
  limitOverride?: string;          // decimal; sobrepõe numericValue do catálogo
  color?: string;                  // #RRGGBB; sobrepõe a cor da decisão
  note?: string;
  attrs?: Record<string, string | number | boolean>;
};
```

**Células vazias não são gravadas.** Uma chave ausente de `cells` significa "não preenchida" (`isUnset`). O conjunto de células possíveis é sempre derivado de `axes.x.tuples × axes.y.tuples` — nunca materializado no arquivo.

Consequências: o arquivo fica pequeno, uma matriz recém-criada tem `"cells": {}`, e o cálculo de pendências é `xTuples.length * yTuples.length - Object.keys(cells).filter(temDecisão).length`.

Referências ao catálogo são por **`code`**, não por id — o código é imutável, e isso mantém o arquivo legível.

## 7. Templates

```ts
type Template = {
  id: string;
  code: string;
  name: string;
  description?: string;
  axes: {
    x: { levels: Array<{ variableId: string; label?: string }> };
    y: { levels: Array<{ variableId: string; label?: string }> };
  };
  defaults?: { decision?: string; offer?: string; limit?: string };
  seedRules: SeedRule[];
  archivedAt?: string;
  createdAt: string;
};

type SeedRule = {
  when: { x?: PathMatcher; y?: PathMatcher };
  set: { decision?: string; offer?: string; limit?: string; color?: string };
};

// Casa caminhos por prefixo de nível. `null` em um nível = qualquer valor.
// Ex.: ["VAREJO", null] casa todas as faixas de faturamento do Varejo.
type PathMatcher = Array<string | null>;
```

Templates referenciam **variáveis**, não versões: ao instanciar, usam as versões publicadas do momento.

## 7.1 Perfis de carga

Um `ImportProfile` grava como uma tabela externa (a extração do sistema de origem) se traduz em
matrizes deste documento: o papel de cada coluna, o de-para de cada valor, as regras de decisão,
as tags e os padrões de código e nome. É o que faz a carga seguinte ser "abrir o arquivo, olhar o
plano, publicar" em vez de remontar o mapeamento (`12-carga-de-matrizes.md` US-08).

```ts
type ImportProfile = {
  id: string;
  code: string;                    // CARGA_CINEMINHA — ^[A-Z0-9_]+$, único no documento
  name: string;
  description?: string;
  createdAt: string;
  updatedAt?: string;
  format: DelimitedFormat;         // separador, linha de cabeçalho, BOM
  signature: string[];             // cabeçalho reconhecido, na ordem — igualdade exata
  projectId: string;               // onde as matrizes nascem
  columns: ColumnMapping[];        // um por coluna do arquivo
  unpivot?: UnpivotDimension;      // desdobra colunas de valor em matrizes
  codeTemplate: string;            // MTZ_{CLUSTER_GRUPO}_{CEP_RISCO}_{CANAL}
  nameTemplate: string;
  decisionRules: DecisionRule[];   // a última é sempre `otherwise`
  tagRules: TagRule[];
  missingRowPolicy: 'KEEP' | 'CLEAR';
  suppressUnobserved: boolean;     // matriz nova nasce sem as tuplas que o arquivo não traz (RN-21)
};
```

Os tipos auxiliares (`DelimitedFormat`, `ColumnMapping`, `UnpivotDimension`, `DecisionRule`,
`TagRule`) estão em `12-carga-de-matrizes.md` §5.4 — este documento não os duplica.

O perfil é **configuração, não histórico**: editá-lo não altera nenhuma carga já aplicada, e
apagá-lo não invalida matriz nenhuma. O rastro de cada carga vive nos eventos `IMPORT_RUN` (§8).

## 8. Auditoria

```ts
type DocEvent = {
  id: string;
  at: string;
  actor: string;
  type: DocEventType;
  scope: {
    projectId?: string; matrixId?: string; versionId?: string;
    variableId?: string; compatibilityId?: string;
    componentId?: string; componentVersionId?: string;      // schema 5, S32a
    changeRequestId?: string; releaseId?: string;           // schema 5, S32b
  };
  summary: string;                 // frase pronta em pt-BR para a timeline
  payload?: Record<string, unknown>;
};

type DocEventType =
  | 'DOCUMENT_CREATED' | 'DOCUMENT_MERGED'
  | 'MATRIX_CREATED'   | 'DRAFT_CREATED' | 'DRAFT_DISCARDED'
  | 'CELLS_UPDATED'    | 'AXIS_LEVEL_ADDED' | 'AXIS_LEVEL_REMOVED'
  | 'AXIS_LEVEL_REORDERED' | 'AXIS_RESNAPSHOTTED' | 'TUPLES_SUPPRESSED'
  | 'VERSION_PUBLISHED' | 'VERSION_SUPERSEDED' | 'NOTE_ADDED'
  | 'VARIABLE_PUBLISHED' | 'COMPATIBILITY_PUBLISHED'
  | 'CATALOG_CHANGED'
  | 'IMPORT_RUN' | 'IMPORT_PROFILE_SAVED' | 'MATRIX_TAGGED'
  | 'ACL_CHANGED'
  | 'EVIDENCE_ATTACHED' | 'EVIDENCE_DETACHED'
  // schema 5, S32a — árvore de política (DEC-GOV-018)
  | 'COMPONENT_CREATED' | 'COMPONENT_UPDATED' | 'COMPONENT_MOVED' | 'COMPONENT_ARCHIVED'
  | 'COMPONENT_DRAFT_CREATED' | 'COMPONENT_DRAFT_DISCARDED'
  | 'COMPONENT_VERSION_PUBLISHED' | 'COMPONENT_VERSION_SUPERSEDED'
  // schema 5, S32b — governança (DEC-GOV-019)
  | 'CR_CREATED' | 'CR_UPDATED' | 'CR_ITEM_CHANGED' | 'CR_TRANSITIONED' | 'CR_DECIDED'
  | 'RELEASE_CREATED' | 'RELEASE_UPDATED' | 'RELEASE_CANCELLED';
```

Os cinco tipos `CR_*` são os únicos que **não** entram em `doc.events`: eles são gravados na trilha
do próprio DB (`ChangeRequest.events`, §13), que é append-only pela mesma mecânica desta seção
(DEC-GOV-019). Os de release vão para `doc.events` normalmente — `Release` não tem trilha própria.

`IMPORT_RUN` é o evento de nível de documento que registra uma carga inteira (arquivo, hash,
perfil e totais por estado). Os rascunhos e patches que ela produz carregam o mesmo
`importRunId` no próprio payload — é o que permite ir de qualquer célula de volta ao arquivo que
a originou (`12-carga-de-matrizes.md` US-10).

`events` é append-only e ordenado por `at`. Teto de **5.000 eventos**; ao ultrapassar, os mais antigos são consolidados num único evento de resumo (sessão S16).

## 8.1 Evidências anexadas (sessão 30)

O **arquivo** vive no acervo `_evidencias/` da pasta de rede, navegável no Explorer; o documento
guarda só o **vínculo** — quem, quando, onde no acervo, e com que hash (`14-plataforma-local.md`
§7, ADR-004). Nada de conteúdo de arquivo entra no `.json`.

```ts
type Attachment = EvidenceAttachment | InlineImageAttachment;   // discriminado por `kind` — schema 5

type EvidenceAttachment = {
  kind: 'EVIDENCE';
  id: string;                 // nanoid(12) — gerado pelo servidor no POST /api/evidences
  fileName: string;           // nome original, preservado no disco
  relPath: string;            // caminho dentro de _evidencias/, com "/": projeto/matriz/v12/AAAA-MM-DD_nome
  sha256: string;             // hash calculado na cópia; conferido a cada download
  bytes: number;
  addedBy: { username: string; displayName?: string };
  addedAt: string;            // ISO 8601 UTC
  note?: string;
  target:                     // a que a evidência está presa (I25)
    | { kind: 'PROJECT'; projectId: string }
    | { kind: 'MATRIX'; matrixId: string }
    | { kind: 'VERSION'; matrixId: string; versionNumber: number };
};

/** Imagem embutida num `RichDoc` (§12) — base64 no próprio .json, teto de 300 KB (`E-GOV-05`). */
type InlineImageAttachment = {
  kind: 'INLINE_IMAGE';
  id: string;
  fileName: string;
  mimeType: string;           // image/png, image/jpeg, image/webp…
  data: string;               // base64, sem o prefixo "data:"
  bytes: number;
  width?: number;
  height?: number;
  addedBy: { username: string; displayName?: string };
  addedAt: string;
  note?: string;
};
```

**Uma coleção, dois tipos de anexo (schema 5, DEC-GOV-015).** O nome `Attachment` foi criado na
sessão 30 para o vínculo com o acervo `_evidencias/`, e `14-governanca-de-alteracoes.md` §7 previa
o mesmo nome para as imagens do editor rico. Em vez de duas coleções com nomes parecidos, elas
convivem em `attachments` separadas por `kind`: as duas são "arquivo pendurado no documento", e o
que muda é onde o byte mora — `EVIDENCE` aponta o acervo na pasta de rede (o arquivo existe fora do
`.json`, ADR-004), `INLINE_IMAGE` carrega o conteúdo em `data`. I25 e I26 só se aplicam ao primeiro:
imagem embutida não tem alvo nem caminho no acervo.

- A lista é **append-only por alvo**: anexo novo entra no fim. Anexar a uma versão publicada é
  permitido e **não** fere I3 — `attachments` vive fora do snapshot da versão, como os eventos.
- `target` de versão guarda o **número**, não o `versionId`: é o número que aparece na pasta
  (`v12`) e que uma pessoa reconhece no Explorer sem a aplicação aberta.
- Desanexar remove a entrada daqui; o arquivo só vai para `_evidencias/_lixeira/` depois do
  salvamento seguinte (`14-plataforma-local.md` §7) — nunca antes, senão desfazer dependeria de
  um arquivo que já se moveu.
- `attachments` é omitido quando não há nenhum anexo (convenção de §1).

## 9. Invariantes

Garantidas por `src/core/document/validate.ts` e cobertas por teste. Validadas **na leitura do arquivo** e **antes de todo salvamento** — exceto I8, I9, I19, I24 e a unicidade de código de domínio de I18, que são avisos não bloqueantes (nota após a tabela).

**Numeração de I27–I31 (sessões 32a/32b, DEC-GOV-014).** `14-governanca-de-alteracoes.md` §6 escreveu
estas invariantes como I23, I24, I27, I25 e I26, antes de I23–I26 serem ocupadas pela ACL (S29) e pelas
evidências (S30). A correspondência é: docs/14 I23 → **I27**, docs/14 I24 → **I28**, docs/14 I27 →
**I29** (S32a); docs/14 I25 → **I30**, docs/14 I26 → **I31** (S32b).

**Três invariantes desta faixa têm uma metade que o documento parado não consegue provar**, e em
todas o padrão é o mesmo: a garantia é de **comando**, e a invariante confere o que sobra.
A imutabilidade de `PolicyComponent.code` (docs/14 junta a I24) é de `component/update`, que não
aceita `code` — I28 confere só a unicidade. A imutabilidade de `ChangeRequest.code`/`Release.code`
é de `changeRequest/update` e `release/update` — I31 confere só a unicidade. E o **congelamento dos
itens do DB a partir de `APPROVED`** é de `assertItemsEditable`
(`src/core/document/cr-workflow.ts`, `E-GOV-01`): um documento em repouso não sabe se o item mudou
depois da aprovação, então I30 confere a parte estrutural (RN-GOV-02, referências e o vínculo de
volta do rascunho).

I25 e I26 são `ERROR` sem correção automática: um vínculo de evidência quebrado aponta para um arquivo real na pasta, e escolher entre "remover o vínculo" e "corrigir o alvo" é decisão de quem opera, não da aplicação (o modo de recuperação lista o problema com o caminho do anexo).

| # | Invariante |
|---|---|
| I1 | No máximo uma `MatrixVersion` em `DRAFT` por matriz |
| I2 | No máximo uma `MatrixVersion` em `PUBLISHED` por matriz |
| I3 | Versão `PUBLISHED`, `SUPERSEDED` ou `ARCHIVED` é imutável — nenhum comando pode alterá-la |
| I4 | Intervalos `[effectiveFrom, effectiveTo)` de uma matriz não se sobrepõem nem deixam buracos |
| I5 | Toda chave de `cells` decompõe em `xPath::yPath` presentes em `axes.x.tuples` e `axes.y.tuples` |
| I6 | Publicar exige zero combinações sem `decision` |
| I7 | `CatalogItem` de kind `LIMIT` tem `numericValue` |
| I8 | `BOOLEAN` tem exatamente 2 domínios; demais tipos, ao menos 2 |
| I9 | `RANGE` sem `groupingDimensions`: faixas contíguas, sem sobreposição, ordenadas por `position`, usando `rangeMin`/`rangeMax`; no máximo um `isCatchAll`, e ele é o último. `RANGE` **com** `groupingDimensions`: a mesma regra de contiguidade/sobreposição/catch-all vale **independentemente para cada `path` distinto** presente em `domains[].groupingRanges` — não para toda combinação possível de opções, só para as que o usuário efetivamente definiu (ver I19). Em ambos os casos, a contiguidade lê `boundaryMode` da versão: `INCLUSIVE_INTEGER` (default) exige valores inteiros e `atual.máx + 1 == próxima.mín`; `HALF_OPEN` exige `atual.máx == próxima.mín`. A ordem por `position` pode ser crescente ou decrescente — a direção é detectada pelo primeiro par de mínimos distintos e aplicada à sequência inteira (ou a cada `path`, com `groupingDimensions`) |
| I10 | `VariableVersion` / `CompatibilityVersion` publicada é imutável |
| I11 | No máximo uma versão `DRAFT` e uma `PUBLISHED` por variável e por regra de compatibilidade |
| I12 | Uma única regra de compatibilidade publicada por par (parent, child) |
| I13 | `axes.*.levels` tem de 1 a 3 elementos, sem variável repetida no mesmo eixo |
| I14 | Nenhuma variável aparece nos dois eixos da mesma versão |
| I15 | `tuples` não tem duplicatas, e todo código de cada caminho existe nos domínios do nível correspondente |
| I16 | `xTuples.length * yTuples.length ≤ 6.000` |
| I17 | Toda referência a catálogo em `cells` aponta para um `code` existente do kind correto |
| I18 | Todo `code` é único no seu escopo |
| I19 | Se `groupingDimensions` está presente: 1 a 4 níveis; `code` único entre os níveis da versão; cada nível tem `options` não vazio com `code` único dentro do próprio nível; todo `GroupingRange.path` tem o mesmo comprimento de `groupingDimensions` e cada `path[i]` existe em `groupingDimensions[i].options` |
| I20 | Toda entrada de `Matrix.tags` aponta para um `CatalogItem` existente de kind `TAG`, e não há repetição dentro da mesma matriz |
| I21 | `ImportProfile.code` é único no documento; `projectId` aponta para projeto existente; `columns` tem ao menos uma coluna `PARTITION` e ao menos um nível de eixo em cada eixo, com níveis contíguos a partir de 0; `decisionRules` termina com exatamente uma regra `otherwise` |
| I22 | Todo `variableId` referenciado por `ImportProfile.columns[].axis` aponta para variável existente |
| I23 | Se `meta.acl` está presente, todo `username` de `acl.users` é único na lista |
| I24 | Se `meta.acl` está presente com `users` não vazio, ao menos um `AclEntry` tem `role: 'ADMIN'` (aviso não bloqueante — nota após a tabela) |
| I25 | O `target` de toda evidência aponta para entidade existente: projeto, matriz, ou número de versão existente naquela matriz |
| I26 | `relPath` e `sha256` de toda evidência são não vazios, e `relPath` é único no documento |
| I27 | Componente `MATRIX` tem `matrixId` válido, do **mesmo projeto**, `versions: []` e nenhum filho; nenhum outro tipo tem `matrixId`, e uma matriz é referenciada por no máximo um componente. Componente `POLICY_VARIABLE` pode ter `variableId`, que precisa apontar `Variable` existente; nenhum outro tipo tem `variableId`, e uma variável é espelhada por no máximo um componente |
| I28 | A árvore de componentes é acíclica; `projectId` e `parentId` apontam entidades existentes, e o pai é do mesmo projeto; `position` é 0-based e sem buracos **entre irmãos**; profundidade ≤ 6; `PolicyComponent.code` é único no projeto; todo `code` em `tags` referencia `CatalogItem` de kind `TAG` existente, sem repetição no mesmo componente |
| I29 | Versões de componente seguem o mesmo ciclo das matrizes, **inclusive em `SECTION`**: no máximo uma `DRAFT` e uma `PUBLISHED`; publicada/substituída carrega `publishedAt`, `publishedBy` e `effectiveFrom`; substituída tem `effectiveTo`; rascunho não tem vigência; a cadeia `[effectiveFrom, effectiveTo)` não se sobrepõe nem deixa buraco; e o `payload.kind` casa com o tipo do componente (`SECTION` usa `OTHER`) |
| I30 | Itens do DB: um componente aparece **uma vez só** por `ChangeRequest` (RN-GOV-02); `componentId` aponta componente existente; `baseVersionId` e `draftVersionId` apontam versão daquele componente (ou daquela matriz, no espelho `MATRIX`); o `draftVersionId` está em `DRAFT` e, quando é versão de componente, tem `changeRequestId` igual ao DB. A **imutabilidade dos itens a partir de `APPROVED`** é garantia de comando (`assertItemsEditable`, `E-GOV-01`), não de documento parado — nota abaixo |
| I31 | `ChangeRequest.code` e `Release.code` são únicos no documento. A imutabilidade é garantia de comando: nem `changeRequest/update` nem `release/update` aceitam `code` |

**I19 é deliberadamente mais fraca que a antiga regra de completude regional.** Não existe invariante exigindo que todo domínio `RANGE` tenha uma entrada em `groupingRanges` para toda combinação possível de opções — hierarquias reais são assimétricas (nem toda Regional tem MEI, por exemplo), e forçar o preenchimento de combinações que não existem no negócio seria pior do que não validar nada. O editor de domínios (`07-ux-e-editor.md` §11) ainda **avisa** (não bloqueia) quando um `path` usado por alguns domínios está ausente por completo de outros — o caso provável de "esqueci de colar uma linha" — mas isso é um aviso de UX, não uma falha de I19.

**I24 é aviso, não erro, pelo mesmo motivo do "documento externo" de `14-plataforma-local.md` §6**: uma ACL populada sem nenhum `ADMIN` não pode travar quem abre o arquivo fora do controle da aplicação — `resolveRole` (`src/core/document/roles.ts`) trata esse caso como modo aberto (todo mundo `PUBLISHER`) na hora de resolver o papel efetivo, e `checkI24` só avisa que a lista está nesse estado.

**I8, I9, I19 e a unicidade de código de domínio de I18 (dentro de `version.domains`) são avisos não bloqueantes, não invariantes garantidas.** `checkI8`, `checkI9` e `checkI19` (e a checagem de código duplicado de domínio dentro de `checkI18`) produzem `ValidationIssue` com `severity: 'WARNING'` em vez de `'ERROR'` — não derrubam `validateDocument().ok`, então não impedem `variable/saveDomains`, `variable/publish` nem a gravação do arquivo (`prepareSave`, `06-persistencia-e-concorrencia.md` §4). Um documento salvo pode ter uma variável `BOOLEAN` com número errado de domínios, faixas `RANGE` não contíguas ou sobrepostas, ou um agrupamento com `path` inválido — a interface continua avisando em tempo real (`07-ux-e-editor.md` §11), mas quem decide se aquilo é aceitável é quem edita a política, não a aplicação. O restante de I18 (código de variável, de regra de compatibilidade, de item de catálogo, de projeto, de matriz, de template) continua `ERROR` — são identificadores referenciados em todo o documento, fora do escopo desta mudança.

Falha de invariante na leitura **não descarta o arquivo**: a aplicação abre em modo de recuperação, lista os problemas em português (agrupados por gravidade — erros e avisos) e oferece as correções possíveis (§10).

## 10. Versionamento do schema e migração

`schemaVersion` no topo. `src/core/document/migrate.ts` aplica migrações em cadeia (`1 → 2 → 3 → 4 → 5`) ao abrir um arquivo mais antigo, e recusa arquivos mais novos que a aplicação, com a mensagem: *"Este arquivo foi salvo por uma versão mais nova do PolicyOps. Atualize o PolicyOps.html."*

Migrações são funções puras, testadas com fixtures reais em `tests/fixtures/`.

**Migração 1 → 2 (sessão 20): generalização de `regionalDimension` em `groupingDimensions`.** Diferente das mudanças anteriores (campos novos e opcionais, sem necessidade de migração), esta é uma **renomeação com mudança de forma** — `Domain.regionalRanges` era `Record<string, RegionalRange>` (uma entrada por regional), e `Domain.groupingRanges` é `GroupingRange[]` (cada entrada carrega o próprio `path`). Por isso exige migração explícita, não é compatível por omissão. Para toda `VariableVersion` com `regionalDimension` presente:

- `groupingDimensions = [{ code: 'REGIONAL', label: 'Regional', options: regionalDimension.regions }]` — um único nível, preservando os `RegionalOption` existentes tal como estavam;
- para cada domínio, `groupingRanges = Object.entries(domain.regionalRanges).map(([regionCode, r]) => ({ path: [regionCode], ...r }))`;
- os campos `regionalDimension` e `regionalRanges` são removidos do documento migrado.

Documentos sem `regionalDimension` em nenhuma variável passam por `schemaVersion: 2` sem qualquer alteração de conteúdo. Testado com a fixture real que já existia para `regionalDimension` (S18), comparando o documento migrado contra o formato novo esperado.

**Migração 2 → 3 (sessão 23): perfis de carga e tags de matriz.** Puramente aditiva — nenhum campo existente muda de forma ou de significado:

- `importProfiles = []` no topo do documento;
- `Matrix.tags` permanece **ausente** em toda matriz existente (é opcional e omitido quando vazio, §1);
- `CatalogItem.group` permanece ausente em todo item existente.

Um documento `schemaVersion: 2` migrado e reserializado difere do original apenas pelo campo `importProfiles: []` e pelo número de versão. A migração é testada com as fixtures reais das sessões anteriores, comparando o resto do documento por igualdade estrutural.

**Migração 3 → 4 (sessão 29): `meta.acl?`.** A mais simples de todas: aditiva a ponto de **não escrever nenhum campo**. `meta.acl` é opcional, e sua ausência **é** o estado migrado — "modo aberto" (`14-plataforma-local.md` §6). A migração só troca o número de `schemaVersion`; todo o resto do documento fica byte a byte igual. Testada com `sample-document.json` como estava antes desta sessão (`tests/fixtures/v3-document.json`).

**`attachments?` (sessão 30) não muda o `schemaVersion`: continua 4.** É o caso que o parágrafo da migração 1 → 2 já registra — "campos novos e opcionais, sem necessidade de migração": um documento `schemaVersion: 4` sem anexos já é um documento 4 válido, e a ausência do campo é o estado correto. Não há migração 4 → 4, e nenhum documento existente muda de um byte.

**Migração 4 → 5 (sessão 32a): componentes de política e entidades de governança.** Aditiva, com
uma exceção deliberada em campo existente. O que ela faz:

- `components = []`, `changeRequests = []` e `releases = []` no topo do documento;
- em cada entrada de `attachments` (quando houver), acrescenta `kind: 'EVIDENCE'` — o discriminador
  novo da coleção (§8.1). Todo anexo já gravado é evidência, então o valor é conhecido sem
  ambiguidade, e nenhum outro campo é tocado;
- `Project.foundationEffectiveFrom`, `Project.factoryTemplate`, `PolicyComponent.tags` e os kinds de
  catálogo `MOTIVATOR`/`IMPACT_CATEGORY` são opcionais e ficam **ausentes** em todo registro
  existente — nada a migrar neles (§1).

O `schemaVersion: 5` fecha inteiro numa migração só, incluindo `ChangeRequest`, `Release` e
`RichDoc`, que nenhum comando escreve até a S32b/S34 — é o que evita uma segunda migração adiante
(DEC-GOV-010). Testada com `tests/fixtures/v4-document.json` (o `sample-document.json` de antes
desta sessão) e com a cadeia completa 1 → 2 → 3 → 4 → 5 a partir de `regional-v1-document.json`.

A contrapartida é a de sempre nesse caso, e vale dita: um `PolicyOps.html` **anterior** à sessão 30 abre um documento com `attachments` em modo de recuperação (o schema é `.strict()`, então o campo desconhecido vira `ERROR` de `SCHEMA`) e perderia os vínculos se salvasse por cima. Evidências só existem no modo `SERVER`, onde todo mundo roda o mesmo `_app/` publicado pela TI (`14-plataforma-local.md` §9) — atualizar a aplicação é substituir aquela pasta, e é isso que mantém os dois lados na mesma versão.

## 11. Documento de exemplo

`src/core/document/create.ts` exporta `createSampleDocument()`, usado no botão "Explorar com dados de exemplo" da tela inicial e nos testes. Conteúdo:

**Variáveis** (todas com v1 `PUBLISHED`)

| code | name | type | domínios |
|---|---|---|---|
| `SCORE_HVI3` | Score HVI3 | ORDINAL | R1…R6 |
| `RESTRITIVO` | Restritivo Externo | CATEGORICAL | `SEM` · `BAIXO` · `MEDIO` · `ALTO` |
| `SEGMENTO` | Segmento | CATEGORICAL | `VAREJO` · `ATACADO` · `CORPORATE` |
| `FAT` | Faixa de Faturamento | RANGE | `ATE_100K` · `100K_500K` · `500K_1M` · `1M_10M` · `ACIMA_10M` (catchAll) |
| `FAIXA_RENDA` | Faixa de Renda | RANGE | `ATE_2K` · `2K_4K` · `4K_6K` · `ACIMA_6K` (catchAll) |
| `TEMPO_EMPRESA` | Tempo de Empresa | RANGE | `ATE_6M` · `6M_12M` · `1A_3A` · `ACIMA_3A` (catchAll) |

**Compatibilidade**: `SEG_X_FATURAMENTO` v1 `PUBLISHED`, com o mapa do §3.

**Catálogo**: 4 decisões (`APROVADO` #16A34A, `REPROVADO` #DC2626, `ANALISE_MANUAL` #F59E0B, `EXCECAO` #7C3AED), 6 ofertas, 4 limites com valor.

**Projetos**: `POLITICA_PF`, `POLITICA_PJ`.

**Matrizes**:

1. `MTZ_LIMITE_PF` (Política PF) — eixo X = `SCORE_HVI3` (1 nível), eixo Y = `RESTRITIVO` (1 nível). 24 combinações, todas preenchidas. **v1 `PUBLISHED`** com `effectiveFrom` há 90 dias, e **v2 `DRAFT`** derivada com exatamente 3 células alteradas — para exercitar o diff desde o primeiro uso.

2. `MTZ_LIMITE_PJ` (Política PJ) — eixo X = `SCORE_HVI3` (1 nível), **eixo Y = `SEGMENTO` › `FAT` (2 níveis)**, com a compatibilidade aplicada: 8 tuplas em Y (não 15) × 6 em X = 48 combinações, todas preenchidas. **v1 `PUBLISHED`**. É o caso que valida o aninhamento ponta a ponta.

**Templates**: "Matriz padrão PF" e "Limite PJ segmentado".

O documento de exemplo é gerado por código, não é um JSON fixo — assim ele nunca fica desatualizado em relação ao schema.

## 12. Componentes de política (schema 5)

> Contrato fechado na sessão 32a. `14-governanca-de-alteracoes.md` §3.1/§3.2 explica **por quê** a
> política vira uma árvore; esta seção é o **o quê**, e é ela que vale quando os dois divergirem.

A política inteira — não só as matrizes — vive numa árvore de componentes, gravada **plana** em
`components` e reconstruída por `parentId`. A ordem entre irmãos é `position`; a ordem da árvore é
**de leitura**, nunca de execução (`14-governanca-de-alteracoes.md` §3.6).

```ts
type PolicyComponent = {
  id: string;
  projectId: string;
  parentId?: string;                    // ausente = raiz da árvore do projeto
  position: number;                     // ordem entre irmãos, 0-based sem buracos (I28)
  code: string;                         // REGRA_DIVIDA_5000 — único no projeto, imutável
  name: string;                         // "Dívida Acima de R$ 5.000"
  type: 'SECTION' | 'RULE' | 'MATRIX' | 'LIST' | 'REASON_CODE' | 'POLICY_VARIABLE' | 'OTHER';
  matrixId?: string;                    // obrigatório e exclusivo de type MATRIX (I27)
  variableId?: string;                  // só type POLICY_VARIABLE: espelho da Biblioteca (I27)
  tags?: string[];                      // codes de CatalogItem kind TAG — facetas (I28)
  origin?: { source: string; locator?: string };   // "Filtros e Critérios B2C, p. 10"
  reviewStatus: 'STRUCTURED' | 'VALIDATED' | 'PENDING_REVIEW' | 'HISTORICAL_SOURCE';
  archivedAt?: string;
  createdAt: string;
  versions: ComponentVersion[];         // sempre vazio em MATRIX (I27); opcional em SECTION (I29)
};
```

- **`SECTION`** é nó estrutural. Sem versões, é pasta pura; com versões, é bloco de política com
  definição, vigência e histórico próprios — a "Visão Geral" de um capítulo. O caso comum é a pasta
  pura, e é o usuário que decide nó a nó (I29).
- **`MATRIX`** é espelho e sempre folha: nome, vigência e histórico vêm da `Matrix` referenciada. Um
  nó aponta **uma** matriz, e uma matriz é apontada por **um** nó (I27).
- **`POLICY_VARIABLE`** com `variableId` é espelho da Biblioteca de Variáveis — as faixas R01–R20,
  HVI3/HVI4 e BHV **já são** `Variable` (§2) e não viram uma segunda cópia versionada. Sem
  `variableId`, o tipo cobre variável de política que não é eixo de matriz.
- **Contenção**: `SECTION` contém qualquer tipo; `RULE`, `LIST`, `REASON_CODE`, `POLICY_VARIABLE` e
  `OTHER` podem ter filhos (sub-regras existem no documento real); `MATRIX` nunca tem.
- Teto de **6 níveis** de profundidade; alerta a partir de 300 componentes por projeto, teto 1.000.

### 12.1 Versão de componente

Mesmo ciclo `DRAFT → PUBLISHED → SUPERSEDED` das matrizes (`05-regras-de-negocio.md` §1), com
vigência. **Não há `ARCHIVED`**: descartar um rascunho o remove da lista, e por isso
`componentVersion/discardDraft` tem inverso (`08-camada-de-comandos.md` §3) — ao contrário do
descarte de rascunho de matriz, que queima o número.

```ts
type ComponentVersion = {
  id: string;
  number: number;
  state: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
  effectiveFrom?: string;               // obrigatório ao publicar; pode ser retroativo (RN-GOV-09)
  effectiveTo?: string;                 // preenchido quando substituída
  createdAt: string; createdBy: string;
  publishedAt?: string; publishedBy?: string;
  changeRequestId?: string;             // DB que originou (ausente = publicação direta, RN-GOV-07)
  payload: ComponentPayload;            // discriminado por `kind` (§12.2)
  spec?: RichDoc;                       // documentação livre (§12.3)
};
```

**Vigência retroativa é permitida em componente** (e proibida em matriz, `05-regras-de-negocio.md`
§1.3). Não é inconsistência: a fundação da política (RN-GOV-09) cadastra ~100 regras que **já
vigoram**, com a data em que a política entrou em vigor. O que continua valendo é a ordem — a
vigência nova precisa começar depois da vigente —, e é ela que impede a linha do tempo de se
sobrepor (I29).

### 12.2 Payload por tipo

`payload.kind` acompanha o `type` do componente, com uma exceção: **`SECTION` usa `OTHER`** — a
"Visão Geral" de um capítulo é exatamente o caso mínimo que `OtherPayload` cobre, e
`14-governanca-de-alteracoes.md` §3.2 enumera cinco payloads sem criar um de seção. `MATRIX` não tem
payload porque não tem versão.

```ts
type ComponentPayload =
  | RulePayload | ListPayload | ReasonCodePayload | PolicyVariablePayload | OtherPayload;

type RulePayload = {
  kind: 'RULE';
  businessDescription: string;          // linguagem de negócio — o único campo obrigatório
  technicalDefinition?: string;         // "Aging > 0 e Valor >= 5000"
  inputs?: string[];                    // variáveis/dados usados
  conditions?: string;                  // condições de ativação
  outcome?: string;                     // Aprovar / Reprovar / Derivar p/ Mesa / Continuar…
  reasonCodes?: string[];               // códigos citados, ex. DV01
  dependencies?: string[];              // codes de outros componentes
  notes?: string;
};

type ListPayload           = { kind: 'LIST';            businessDescription: string; purpose?: string; fields?: string[]; notes?: string };
type ReasonCodePayload     = { kind: 'REASON_CODE';     businessDescription: string; code?: string; decision?: string; message?: string; notes?: string };
type PolicyVariablePayload = { kind: 'POLICY_VARIABLE'; businessDescription: string; technicalName?: string; source?: string; domainDescription?: string; notes?: string };
type OtherPayload          = { kind: 'OTHER';           businessDescription: string; notes?: string };
```

Fora `businessDescription`, todo campo é opcional: a carga inicial raramente terá tudo
(`14-governanca-de-alteracoes.md` §9).

### 12.3 `RichDoc` — documentação livre em blocos

Editor de blocos próprios, sem dependência nova (DEC-GOV-005). Declarado inteiro na S32a; o editor
é da S34. `id` é estável por bloco — é o que torna o diff de `RichDoc` um diff **por bloco**.

```ts
type RichDoc = { blocks: Block[] };
type Block =
  | { id: string; type: 'paragraph' | 'heading1' | 'heading2' | 'quote' | 'callout'; text: InlineText }
  | { id: string; type: 'bulletList' | 'numberList'; items: InlineText[] }
  | { id: string; type: 'table'; header: string[]; rows: string[][] }
  | { id: string; type: 'image'; attachmentId: string; caption?: string };   // aponta InlineImageAttachment (§8.1)
type InlineText = { text: string; marks?: ('bold' | 'italic' | 'code' | 'link')[]; href?: string }[];
```

## 13. Entidades de governança (schema 5)

> **Declaradas na S32a, escritas na S32b.** A forma abaixo entrou no schema já na S32a, sem nenhum
> comando que a escrevesse, para que existisse uma **única** migração 4 → 5 (DEC-GOV-010). A **S32b**
> ligou os comandos (`08-camada-de-comandos.md` §3), o workflow do §5 de
> `14-governanca-de-alteracoes.md` e as invariantes **I30/I31** — sobre esta forma, sem alterá-la. O
> porquê de cada campo está em `14-governanca-de-alteracoes.md` §3.3/§3.4 e §5.
>
> **`ChangeRequest.code` casa `^[A-Z0-9_]+$`** como todo `code` do §1: o "DB-519" do Word entra como
> `DB_519`, e o hífen é coisa da apresentação. A única exceção do documento é `Release.code`
> (`2026.09.01`), explicada no fim desta seção.

```ts
type ChangeRequest = {
  id: string;
  code: string;                         // "DB_519" — único no documento e imutável (I31)
  title: string;
  status: CrStatus;                     // grafo de 12 estados — 14-governanca §5, RN-GOV-01
  motivators: string[];                 // codes de CatalogItem kind MOTIVATOR
  motivationText?: RichDoc;
  requestedBy: string; owner?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  items: ChangeRequestItem[];           // 1..N componentes afetados (RN-GOV-02)
  spec?: RichDoc;
  acceptanceCriteria: { given: string; when?: string; then: string }[];
  testScenarios: { kind: string; description: string }[];
  impacts: { category: string; description?: string }[];   // category = code de kind IMPACT_CATEGORY
  proposedEffectiveDate?: string;       // obrigatória para submeter (RN-GOV-03)
  releaseId?: string;
  approvals: { by: string; at: string; decision: 'APPROVED' | 'RETURNED' | 'REJECTED'; comment?: string }[];
  events: DocEvent[];                   // trilha própria, mesma mecânica da auditoria (§8)
  createdAt: string;
};

type ChangeRequestItem = {
  componentId: string;
  changeType: 'UPDATE' | 'CREATE' | 'DEACTIVATE' | 'REACTIVATE' | 'MOVE' | 'DOC_ONLY';
  baseVersionId?: string;               // versão vigente no momento da criação do item
  draftVersionId?: string;              // rascunho proposto (I30); em item MATRIX, da matriz
  currentSummary?: string;              // "Hoje": preenchido da versão vigente
  proposedSummary: string;              // "Proposto": obrigatório
};

type CrStatus =
  | 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED'
  | 'IN_DEVELOPMENT' | 'IN_VALIDATION' | 'READY_FOR_RELEASE' | 'SCHEDULED' | 'PUBLISHED' | 'CANCELLED';

type Release = {
  id: string;
  code: string;                         // "2026.09.01" — único e imutável (I31)
  name?: string;
  plannedDate?: string;
  status: 'PLANNED' | 'IN_DEVELOPMENT' | 'PUBLISHED' | 'CANCELLED';
  publishedAt?: string; publishedBy?: string;
  notes?: string;
  createdAt: string;
};
```

`Release.code` é a única exceção à regra de `code` do §1: `2026.09.01` tem ponto e **não** casa
`^[A-Z0-9_]+$`. É um rótulo de calendário, não um identificador de referência cruzada — nada aponta
uma release por código.
