# Modelo do Documento

> Normativo e literal. O arquivo `.json` é o banco de dados do produto: ele precisa ser legível por um humano, validável por Zod e estável entre versões da aplicação.

## 1. Estrutura de topo

```ts
type PolicyOpsDocument = {
  schemaVersion: 4;                // 1 até a sessão 18; migrado na leitura (§10)
  meta: DocumentMeta;
  variables: Variable[];
  compatibility: CompatibilityRule[];
  catalog: CatalogItem[];
  projects: Project[];
  matrices: Matrix[];
  templates: Template[];
  importProfiles: ImportProfile[];  // perfis de carga (§9)
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
  kind: 'DECISION' | 'OFFER' | 'LIMIT' | 'TAG';
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
  archivedAt?: string;
  createdAt: string;
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
  | 'ACL_CHANGED';
```

`IMPORT_RUN` é o evento de nível de documento que registra uma carga inteira (arquivo, hash,
perfil e totais por estado). Os rascunhos e patches que ela produz carregam o mesmo
`importRunId` no próprio payload — é o que permite ir de qualquer célula de volta ao arquivo que
a originou (`12-carga-de-matrizes.md` US-10).

`events` é append-only e ordenado por `at`. Teto de **5.000 eventos**; ao ultrapassar, os mais antigos são consolidados num único evento de resumo (sessão S16).

## 9. Invariantes

Garantidas por `src/core/document/validate.ts` e cobertas por teste. Validadas **na leitura do arquivo** e **antes de todo salvamento** — exceto I8, I9, I19, I24 e a unicidade de código de domínio de I18, que são avisos não bloqueantes (nota após a tabela).

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

**I19 é deliberadamente mais fraca que a antiga regra de completude regional.** Não existe invariante exigindo que todo domínio `RANGE` tenha uma entrada em `groupingRanges` para toda combinação possível de opções — hierarquias reais são assimétricas (nem toda Regional tem MEI, por exemplo), e forçar o preenchimento de combinações que não existem no negócio seria pior do que não validar nada. O editor de domínios (`07-ux-e-editor.md` §11) ainda **avisa** (não bloqueia) quando um `path` usado por alguns domínios está ausente por completo de outros — o caso provável de "esqueci de colar uma linha" — mas isso é um aviso de UX, não uma falha de I19.

**I24 é aviso, não erro, pelo mesmo motivo do "documento externo" de `14-plataforma-local.md` §6**: uma ACL populada sem nenhum `ADMIN` não pode travar quem abre o arquivo fora do controle da aplicação — `resolveRole` (`src/core/document/roles.ts`) trata esse caso como modo aberto (todo mundo `PUBLISHER`) na hora de resolver o papel efetivo, e `checkI24` só avisa que a lista está nesse estado.

**I8, I9, I19 e a unicidade de código de domínio de I18 (dentro de `version.domains`) são avisos não bloqueantes, não invariantes garantidas.** `checkI8`, `checkI9` e `checkI19` (e a checagem de código duplicado de domínio dentro de `checkI18`) produzem `ValidationIssue` com `severity: 'WARNING'` em vez de `'ERROR'` — não derrubam `validateDocument().ok`, então não impedem `variable/saveDomains`, `variable/publish` nem a gravação do arquivo (`prepareSave`, `06-persistencia-e-concorrencia.md` §4). Um documento salvo pode ter uma variável `BOOLEAN` com número errado de domínios, faixas `RANGE` não contíguas ou sobrepostas, ou um agrupamento com `path` inválido — a interface continua avisando em tempo real (`07-ux-e-editor.md` §11), mas quem decide se aquilo é aceitável é quem edita a política, não a aplicação. O restante de I18 (código de variável, de regra de compatibilidade, de item de catálogo, de projeto, de matriz, de template) continua `ERROR` — são identificadores referenciados em todo o documento, fora do escopo desta mudança.

Falha de invariante na leitura **não descarta o arquivo**: a aplicação abre em modo de recuperação, lista os problemas em português (agrupados por gravidade — erros e avisos) e oferece as correções possíveis (§10).

## 10. Versionamento do schema e migração

`schemaVersion` no topo. `src/core/document/migrate.ts` aplica migrações em cadeia (`1 → 2 → 3 → 4`) ao abrir um arquivo mais antigo, e recusa arquivos mais novos que a aplicação, com a mensagem: *"Este arquivo foi salvo por uma versão mais nova do PolicyOps. Atualize o PolicyOps.html."*

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
