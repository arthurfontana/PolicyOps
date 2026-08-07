# Regras de Negócio

> Documento normativo. Tudo aqui vive em `src/core/` como função pura sobre o documento. Cada regra tem teste unitário obrigatório.

## 0. Forma dos comandos

Toda mutação do documento é um **comando puro**:

```ts
type CommandResult<T = void> =
  | { ok: true; document: PolicyOpsDocument; data: T; events: DocEvent[]; inverse: Command }
  | { ok: false; error: DomainError };
```

O comando **não muta** o documento recebido: devolve um novo (Immer cuida da estrutura compartilhada). Devolve também o **comando inverso**, que é o que alimenta o undo. Nenhum comando escreve em disco — persistência é outra camada.

## 1. Ciclo de vida da versão de matriz

```
     criar matriz                        publicar
          │                                  │
          ▼                                  ▼
      v1 DRAFT ────────────────────────► v1 PUBLISHED
                                             │
                       criar rascunho ◄──────┤
                              │              │
                              ▼              │
                         v2 DRAFT            │
                              │              │
                         publicar            │
                              ▼              ▼
                         v2 PUBLISHED   v1 SUPERSEDED
```

`ARCHIVED` é terminal e só se alcança de `DRAFT` (rascunho descartado).

### 1.1 `createMatrix(doc, input, actor)`

```ts
input: {
  projectId: string; code: string; name: string; description?: string;
  x: { levels: Array<{ variableId: string; label?: string }> };
  y: { levels: Array<{ variableId: string; label?: string }> };
  templateId?: string;
}
```

1. Valida unicidade de `code` no projeto (`DUPLICATE_CODE`).
2. Para cada nível, resolve a `VariableVersion` **PUBLISHED** da variável → senão `VARIABLE_HAS_NO_PUBLISHED_VERSION`.
3. Valida I13 e I14 (1–3 níveis, sem variável repetida no eixo nem entre eixos).
4. Monta cada `Axis`: copia os domínios para o snapshot de cada nível (só os campos de identidade — `regionalRanges`/`regionalDimension` nunca entram no snapshot, ver `03-modelo-do-documento.md` §6.1), resolve as regras de compatibilidade **publicadas** aplicáveis e chama `generateTuples`.
5. Valida I16 (teto de 6.000 combinações).
6. Cria `MatrixVersion` v1 em `DRAFT` com `cells: {}` — nenhuma célula é materializada.
7. Se veio de template, aplica defaults e `seedRules` (§8).
8. Eventos `MATRIX_CREATED` e `DRAFT_CREATED`.

### 1.2 `createDraftFrom(doc, matrixId, actor, { baseVersionId? })`

1. Base = `baseVersionId` informado, ou a versão `PUBLISHED`. Sem nenhuma das duas → `NO_VERSION_TO_DERIVE`.
2. Se já houver `DRAFT` → `DRAFT_ALREADY_EXISTS`. A interface oferece abrir o existente ou descartá-lo.
3. `number = max(number das versões da matriz) + 1`.
4. **Clona integralmente**: eixos (mesmos pins, mesmos snapshots de domínio, **mesmas tuplas**), supressões manuais e o mapa de células inteiro.
5. `baseVersionId` = id da base.
6. Evento `DRAFT_CREATED` com `{ baseVersionNumber }`.

O clone **não** atualiza pins nem regenera tuplas. Adotar evolução da biblioteca é sempre ato explícito (§5).

Permitir derivar de uma versão `SUPERSEDED` é o que implementa "restaurar versão antiga como rascunho".

### 1.3 `publishDraft(doc, versionId, { effectiveFrom?, notes }, actor)`

Validações, nesta ordem:

| Checagem | Erro |
|---|---|
| versão está em `DRAFT` | `VERSION_NOT_DRAFT` |
| `notes` com ao menos 10 caracteres | `NOTES_REQUIRED` |
| zero combinações pendentes | `UNSET_CELLS_REMAIN` (com a lista de coordenadas) |
| toda chave de `cells` é válida (I5) | `CELL_GRID_INCONSISTENT` |
| toda referência a catálogo existe (I17) | `CATALOG_REF_MISSING` |
| `effectiveFrom` ≥ agora e > `effectiveFrom` da vigente | `EFFECTIVE_DATE_INVALID` |

Efeitos:

1. `effectiveFrom` = informado ou agora.
2. Versão vigente atual, se houver: `state = SUPERSEDED`, `effectiveTo = effectiveFrom` da nova.
3. Rascunho: `state = PUBLISHED`, `publishedAt`, `publishedBy`, sem `effectiveTo`.
4. Eventos `VERSION_SUPERSEDED` e `VERSION_PUBLISHED` (este com `diffSummary` calculado contra a anterior — §4).

**Publicação retroativa é proibida.** Agendamento futuro é permitido: a versão fica `PUBLISHED` com `effectiveFrom` no futuro, e a consulta de vigência continua correta porque é sempre baseada no intervalo, nunca no estado.

### 1.4 `discardDraft(doc, versionId, actor)`

`state = ARCHIVED`, `archivedAt`, evento `DRAFT_DISCARDED`. O `number` **é queimado** — a próxima versão pula. Intencional: número de versão nunca se reutiliza.

### 1.5 Imutabilidade

`assertEditable(version)` lança `VERSION_IMMUTABLE` se o estado não for `DRAFT`. **Todo** comando que toca `axes` ou `cells` chama isso antes de qualquer coisa. É a guarda mais importante do sistema.

## 2. Edição de células

### 2.1 Patch

```ts
type CellPatch = {
  coords: Array<{ xPath: string; yPath: string }>;
  set: {
    decision?: string | null;
    offer?: string | null;
    limit?: string | null;
    limitOverride?: string | null;
    color?: string | null;
    note?: string | null;
    attrs?: Record<string, unknown>;
  };
};
```

Semântica de três estados por campo: **chave ausente** = não mexe; **`null`** = limpa; **valor** = define. É isso que permite "atribuir Oferta 8 a 50 células" sem tocar nas decisões delas.

- Célula que fica sem nenhum campo preenchido é **removida** do mapa `cells` (não fica um objeto vazio).
- `attrs` faz merge raso; chave com `null` remove a chave.
- Pendência é derivada (`!cell?.decision`), nunca armazenada.

### 2.2 Validações

- Toda coordenada deve estar em `tuples` dos dois eixos → `INVALID_COORD`.
- `decision`/`offer`/`limit` devem existir no catálogo com o kind certo e não arquivados → `CATALOG_KIND_MISMATCH` / `CATALOG_ITEM_ARCHIVED`.
- `color` casa `^#[0-9A-Fa-f]{6}$`.
- `limitOverride` é decimal positivo.
- Teto de 6.000 coordenadas por patch → `PATCH_TOO_LARGE`.

### 2.3 Inverso e auditoria

O comando devolve o patch inverso reconstruindo o estado anterior campo a campo, inclusive campos que estavam ausentes (viram `null` no inverso). Round-trip é testado.

Um evento `CELLS_UPDATED` por patch, com `{ cellCount, fields, before, after }`. Acima de 500 células, grava só contagem e campos — o documento não pode virar um log.

## 3. Cor da célula

Prioridade, do mais forte ao mais fraco:

1. `cell.color`
2. cor do `CatalogItem` da decisão
3. cor do `CatalogItem` da oferta
4. cinza neutro `#E5E7EB` (preenchida, sem cor)
5. hachura diagonal + `#F3F4F6` quando pendente

Texto: preto se a luminância relativa do fundo > 0,55; branco caso contrário. A célula sempre exibe o rótulo curto da decisão — cor nunca é o único portador de informação.

## 4. Diff entre versões

`diffVersions(doc, aId, bId)` — A é a base (mais antiga), B a comparada.

### 4.1 Diff de eixos

```ts
type AxisDiff = {
  role: 'X' | 'Y';
  levelsChanged: boolean;                                   // mudou a pilha de variáveis
  levels: Array<{ index: number; variableId: string;
                  pinChanged?: { from: number; to: number };
                  addedDomains: string[]; removedDomains: string[];
                  relabeled: Array<{ code: string; from: string; to: string }> }>;
  addedTuples: string[];
  removedTuples: string[];
  reorderedTuples: boolean;
};
```

Se `levelsChanged` (variáveis diferentes ou em ordem diferente) em qualquer eixo → **estruturalmente incomparável**: `comparable: false`, sem diff de células, e a interface mostra os dois grids lado a lado.

Mudança apenas no conjunto de tuplas (por compatibilidade ou supressão) **não** torna incomparável — vira tupla adicionada/removida.

### 4.2 Diff de células

Chave: `xPath::yPath`.

```ts
type CellChange =
  | { kind: 'ADDED';    key: string; after: Cell }
  | { kind: 'REMOVED';  key: string; before: Cell }
  | { kind: 'MODIFIED'; key: string; before: Cell; after: Cell;
      fields: Array<'decision'|'offer'|'limit'|'color'|'note'|'attrs'> };
```

`ADDED` cobre dois casos que a interface distingue: combinação nova (tupla nova) e combinação que existia mas estava vazia. Marque com `reason: 'NEW_TUPLE' | 'WAS_EMPTY'`.

Células idênticas não entram no resultado.

### 4.3 Resumo semântico

| Métrica | Definição |
|---|---|
| `cellsOpened` | decisão passou de reprovadora para aprovadora |
| `cellsClosed` | decisão passou de aprovadora para `REPROVADO` |
| `cellsToManualReview` | decisão passou para `ANALISE_MANUAL` |
| `offersChanged` | `offer` mudou (excluindo adicionadas/removidas) |
| `limitsIncreased` / `limitsDecreased` | comparação do limite efetivo (`limitOverride ?? numericValue` do catálogo), em Decimal |
| `combinationsAdded` / `combinationsRemoved` | por mudança estrutural do eixo |
| `notesChanged`, `colorsChanged` | — |

"Aprovadora" vem do `code` da decisão: `APPROVING_DECISION_CODES = ['APROVADO', 'EXCECAO']`, em `src/core/diff/semantics.ts`, comentado como ponto de configuração futura. Nunca derive de cor nem de posição.

`summaryText: string[]` produz as frases prontas em pt-BR, omitindo métricas zeradas.

### 4.4 Comparações permitidas

- Duas versões da mesma matriz: sempre.
- Versões de **matrizes diferentes**: permitido quando as pilhas de variáveis dos eixos coincidem (comparar PF × PJ é caso de uso real).
- Uma versão consigo mesma: diff vazio, `comparable: true`.

## 5. Evolução da biblioteca e reconciliação

O mecanismo que preserva o lastro.

### 5.1 Versionar

`createVariableDraft` / `createCompatibilityDraft` clonam a versão publicada em `DRAFT`. O usuário edita. `publish…` valida as invariantes e promove; a anterior vira `SUPERSEDED`.

**Nada acontece com as matrizes.** Elas seguem com os pins antigos e as tuplas congeladas. É o comportamento correto.

### 5.2 Detecção de defasagem

Um eixo está defasado quando **qualquer** uma destas for verdadeira:

- algum `level.variableVersionId` aponta para versão que não é mais `PUBLISHED`;
- alguma regra em `derivedFrom.compatibilityVersionIds` não é mais `PUBLISHED`;
- passou a existir uma regra publicada para um par adjacente que não tinha regra quando as tuplas foram geradas.

O badge de defasagem aparece **apenas em versões `DRAFT`**. Em publicadas e históricas não aparece — elas são registro, não pendência.

### 5.3 `previewResnapshot(doc, versionId, role)`

Não grava nada. Recalcula o que o eixo seria hoje e compara com o snapshot:

```ts
type ResnapshotPlan = {
  role: 'X' | 'Y';
  levels: Array<{ index: number; variableCode: string;
                  from: number; to: number;              // números de versão
                  addedDomains: string[]; removedDomains: string[];
                  relabeled: Array<{ code: string; from: string; to: string }>;
                  reordered: boolean }>;
  compatibility: Array<{ ruleCode: string; from: number | null; to: number }>;
  addedTuples: string[];
  removedTuples: string[];
  newCombinations: number;        // células a preencher
  droppedCombinations: number;    // células a excluir
  droppedCells: Array<{ key: string; cell: Cell }>;
  warnings: TupleWarning[];
};
```

Se nada estiver defasado → `AXIS_NOT_STALE`.

### 5.4 `applyResnapshot(doc, versionId, role, actor)`

Só em `DRAFT`. Passos:

1. `assertEditable`.
2. Atualiza `variableVersionId` e o snapshot de domínios de cada nível.
3. Regenera `tuples` com as regras publicadas atuais, preservando `manualSuppressions` ainda aplicáveis.
4. Atualiza `derivedFrom.compatibilityVersionIds`.
5. Células cujas tuplas sobreviveram são **preservadas integralmente**, casadas por caminho.
6. Combinações novas ficam ausentes de `cells` → contam como pendentes.
7. Combinações que sumiram têm as células removidas, com o conteúdo **integral** no payload do evento.
8. Evento `AXIS_RESNAPSHOTTED` com o plano aplicado.

Depois disso, I6 bloqueia a publicação até as novas combinações serem preenchidas. É exatamente o comportamento pedido: o usuário decide como tratar as células novas.

**Casos de borda tratados explicitamente:**

- domínio removido e outro criado com o mesmo `code` → substituição: célula nasce vazia, não herda;
- renomear domínio (mesmo `code`) → célula preservada, rótulo atualizado, não é mudança de conteúdo;
- reordenar domínios → células preservadas, ordem das tuplas muda;
- regra de compatibilidade que passa a excluir combinações → vira `removedTuples`;
- regra que passa a incluir → `addedTuples`, pendentes;
- resnapshot de X e depois de Y, em sequência, sem recarregar.

### 5.5 Matriz de propagação

| Ação na biblioteca | Versão publicada | Rascunho existente | Rascunhos futuros |
|---|---|---|---|
| Nova versão de variável | inalterada, sempre | inalterado; ganha badge | herdam o pin do publicado; badge |
| Nova versão de compatibilidade | inalterada, sempre | inalterado; ganha badge | idem |
| Item de catálogo renomeado | **reflete** o novo rótulo | reflete | reflete |
| Item de catálogo arquivado | continua exibindo, com marca | idem, e não pode ser atribuído a novas células | idem |

**Decisão deliberada:** rótulos de catálogo são referência viva, não snapshot. Renomear "Oferta 8" para "Oferta 8 — Renda Alta" muda a exibição em versões históricas. Isso é aceito porque é correção de nomenclatura. Mudar o **significado** exige criar item novo — e a interface diz isso ao lado do botão de editar.

### 5.6 Dimensão regional de faixas

Resolve o caso de modelo de score cujo corte numérico de cada faixa (R01…R20) varia por regional, mas cujo **código** de faixa é o mesmo em todo lugar — é o mecanismo de normalização de risco entre regionais. Ver `03-modelo-do-documento.md` §2 para o schema (`VariableVersion.regionalDimension`, `Domain.regionalRanges`).

**Editar.** `regionalDimension` e `regionalRanges` são editados **junto** dos domínios, no mesmo `variable/saveDomains` (§5.6.1) — não existe comando separado para eles. Ligar/desligar `regionalDimension` numa versão `DRAFT` é uma escolha binária: ligado, todo domínio `RANGE` da versão usa `regionalRanges`; desligado, usa `rangeMin`/`rangeMax` como antes. Alternar o interruptor não converte valores automaticamente — o usuário parte de faixas vazias no modo para o qual mudou.

#### 5.6.1 `variable/saveDomains` — entrada estendida

```ts
input: {
  variableId: string;
  versionId: string;
  domains: Domain[];
  regionalDimension?: RegionalDimension;   // ausente = variável não usa regional
}
```

Continua substituindo o conjunto inteiro (domínios **e** dimensão regional), só em `DRAFT` (`VARIABLE_VERSION_IMMUTABLE` senão), e roda `validateDomains` antes de gravar — agora ciente de `regionalDimension` (I9, I19):

- sem `regionalDimension`: validação igual à de hoje;
- com `regionalDimension`: `regions` não pode ser vazio nem ter `code` repetido (`REGIONAL_CODE_DUPLICATE`); para cada domínio `RANGE`, precisa haver uma entrada em `regionalRanges` para cada `region.code` (`RANGE_REGIONAL_INCOMPLETE` apontando o domínio e o regional faltante); dentro de **cada** regional, a mesma regra de contiguidade/sobreposição/catch-all de hoje, aplicada independentemente coluna a coluna (`RANGE_REGIONAL_NOT_CONTIGUOUS`, com `{ regionCode, domainCode }` no `details`).

#### 5.6.2 Importar tabela colada

Resolve o problema de digitar 20 faixas × 9 regionais × 2 números campo a campo. `parseRegionalRangeTable(text, regions)` — função **pura** em `src/core/library/regional-import.ts`, sem comando associado: só traduz texto em `{ domains, warnings, errors }`, que o usuário revisa na tela antes de virarem entrada de `saveDomains`. Nada é gravado no documento por esta função.

**Contrato de colagem** (o usuário cola direto do Excel, TSV com tabulação como separador de coluna):

1. **Linha 1** — um código de regional por bloco de colunas. Célula de Excel mesclada vira, ao colar, a primeira coluna do bloco preenchida e as demais vazias: o parser faz *carry-forward* (repete o último valor não vazio) para reconstruir o regional de cada coluna.
2. **Linha 2** — `MIN` / `MAX` (case-insensitive, aceita `Mín`/`Máx`) alternado, uma marca por coluna de dado.
3. **Linhas seguintes** — uma por domínio. Primeira coluna é o texto completo do domínio (ex.: `R20 - Altíssimo`); vira `label` verbatim, e `code` é o trecho antes do primeiro `" - "` (ou `–`/`—`), maiúsculo, validado contra `^[A-Z0-9_]+$` — falha em `REGIONAL_IMPORT_PARSE_ERROR` se não bater. As colunas seguintes são os pares min/max de cada regional, na ordem da linha 1/2.
4. `position` de cada domínio = ordem das linhas na colagem. A ordem pode ser ajustada depois no editor de domínios (drag), como qualquer variável.
5. Todo domínio precisa ter valor para todo regional presente no cabeçalho — célula vazia é aviso, não erro: o domínio some da lista pronta e o usuário completa manualmente ou recola.
6. Número de colunas de dado inconsistente com o cabeçalho, ou header ausente/incompleto → `REGIONAL_IMPORT_PARSE_ERROR`, sem gravar nada.

O resultado alimenta `regionalDimension.regions` (na ordem da linha 1) e `domains[].regionalRanges` — o usuário ainda passa pela validação normal de `saveDomains` antes de poder publicar.

#### 5.6.3 Duplicar variável

Resolve "criar a partir desta" na tela de nova variável — não é exclusivo de `RANGE`, mas é o que evita recriar a estrutura de HVI1 para desenhar HVI2.

```ts
variable/duplicate: {
  sourceVariableId: string;
  sourceVersionId: string;    // qual versão da origem copiar
  code: string;               // da variável nova, único (DUPLICATE_CODE senão)
  name: string;
  description?: string;
}
```

Cria uma `Variable` nova (novo `id`, novo `code`) com `type` igual ao da origem e uma v1 `DRAFT` cujos `domains` e `regionalDimension` são cópia integral da versão de origem (novos `id`s de domínio se existirem, mesmos `code`/`label`/`position`/`color`/faixas). A variável de origem não é tocada, e nada liga as duas depois — é ponto de partida, não vínculo. Sem evento próprio, mesmo padrão de `variable/create`.

**Por que isso substitui "criar 9 variáveis regionais".** Com `regionalDimension`, um único `variable/saveDomains` (ou uma colagem) preenche as 9 regionais de uma vez dentro de uma variável só; `variable/duplicate` só entra em cena quando o usuário quer de fato uma variável nova e distinta (HVI1 → HVI2), não para replicar a mesma faixa por regional.

## 6. Consulta por data de vigência

```ts
getEffectiveVersion(doc, matrixId, at: Date): MatrixVersion | null
```

Retorna a versão com `state ∈ {PUBLISHED, SUPERSEDED}` cujo intervalo semiaberto `[effectiveFrom, effectiveTo)` contém `at`. Na data exata da troca, vale a versão nova. Sem resultado = a matriz não existia naquela data → a interface mostra "sem política vigente em dd/mm/aaaa", não um erro.

`getPortfolioAt(doc, projectId, at)` faz o mesmo para todas as matrizes do projeto.

## 7. Payloads dos eventos

| Tipo | Payload |
|---|---|
| `MATRIX_CREATED` | `{ code, name, xLevels, yLevels, combinations }` |
| `DRAFT_CREATED` | `{ baseVersionNumber \| null, templateCode? }` |
| `DRAFT_DISCARDED` | `{ editedCells }` |
| `CELLS_UPDATED` | `{ cellCount, fields, before?, after? }` |
| `AXIS_LEVEL_ADDED` | `{ role, variableCode, position, mode, before, after }` |
| `AXIS_LEVEL_REMOVED` | `{ role, variableCode, mode, droppedCells }` |
| `AXIS_LEVEL_REORDERED` | `{ role, from, to, tuplesChanged }` |
| `AXIS_RESNAPSHOTTED` | `{ role, plan, droppedCells }` |
| `TUPLES_SUPPRESSED` | `{ role, paths, droppedCells }` |
| `VERSION_PUBLISHED` | `{ effectiveFrom, diffSummary }` |
| `VERSION_SUPERSEDED` | `{ byVersionNumber, effectiveTo }` |
| `VARIABLE_PUBLISHED` | `{ code, versionNumber, domainsAdded, domainsRemoved }` |
| `COMPATIBILITY_PUBLISHED` | `{ code, versionNumber }` |

`summary` é sempre frase pronta em pt-BR: *"Arthur alterou a oferta de 12 células"*. A timeline renderiza `summary`; o payload é detalhe expansível.

## 8. Templates

`instantiateTemplate(doc, { templateId, projectId, code, name }, actor)`:

1. Resolve as variáveis dos níveis e usa as versões **publicadas atuais** (não as de quando o template foi criado).
2. Chama `createMatrix`.
3. Aplica `defaults` a **todas** as combinações.
4. Aplica `seedRules` em ordem, **a última vencendo**.
5. Códigos inexistentes no snapshot são ignorados e devolvidos em `skippedRules` — a biblioteca pode ter evoluído.

`PathMatcher` casa por nível, com `null` significando "qualquer": `["VAREJO", null]` pega todas as faixas do Varejo. Matcher mais curto que o caminho casa por prefixo. `when` vazio atinge tudo.

## 9. Códigos de erro

`src/core/errors.ts` define `DomainError { code, message, details? }`. Catálogo estável:

```
NOT_FOUND, DUPLICATE_CODE, INVALID_INPUT,
VARIABLE_HAS_NO_PUBLISHED_VERSION, VARIABLE_VERSION_IMMUTABLE,
INVALID_DOMAIN_SET, RANGE_NOT_CONTIGUOUS, BOOLEAN_NEEDS_TWO_DOMAINS,
COMPATIBILITY_PAIR_DUPLICATE, COMPATIBILITY_VERSION_IMMUTABLE,
DRAFT_ALREADY_EXISTS, NO_VERSION_TO_DERIVE,
VERSION_NOT_DRAFT, VERSION_IMMUTABLE, NOTES_REQUIRED,
UNSET_CELLS_REMAIN, CELL_GRID_INCONSISTENT, INVALID_COORD,
CATALOG_KIND_MISMATCH, CATALOG_ITEM_ARCHIVED, CATALOG_REF_MISSING,
LIMIT_NEEDS_NUMERIC_VALUE, EFFECTIVE_DATE_INVALID, PATCH_TOO_LARGE,
TOO_MANY_LEVELS, DUPLICATE_VARIABLE_IN_AXIS, VARIABLE_ON_BOTH_AXES,
AXIS_NEEDS_ONE_LEVEL, NO_VALID_TUPLES, GRID_TOO_LARGE,
AXIS_NOT_STALE, VERSIONS_NOT_COMPARABLE,
DOCUMENT_SCHEMA_TOO_NEW, DOCUMENT_INVALID, SAVE_CONFLICT,
RANGE_REGIONAL_INCOMPLETE, RANGE_REGIONAL_NOT_CONTIGUOUS,
REGIONAL_CODE_DUPLICATE, REGIONAL_IMPORT_PARSE_ERROR
```

Cada código tem mensagem pt-BR em `src/core/error-messages.ts`. A interface nunca exibe o código cru. Um teste percorre o enum e falha se faltar mensagem.
