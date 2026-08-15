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
4. Monta cada `Axis`: copia os domínios para o snapshot de cada nível (só os campos de identidade — `groupingRanges`/`groupingDimensions` nunca entram no snapshot, ver `03-modelo-do-documento.md` §6.1), resolve as regras de compatibilidade **publicadas** aplicáveis e chama `generateTuples`.
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

**Consumidor novo (S25).** `src/core/import/structural.ts` reaproveita `computeResnapshot` —
nunca um segundo motor — para calcular o impacto de resolver uma matriz `STRUCTURAL` da carga
(`12-carga-de-matrizes.md` RN-06, §5). O comportamento deste módulo não muda: a carga só monta,
num documento de trabalho descartável, os mesmos comandos de biblioteca que a aplicação real
executaria, e lê o `ResnapshotPlan` resultante.

### 5.5 Matriz de propagação

| Ação na biblioteca | Versão publicada | Rascunho existente | Rascunhos futuros |
|---|---|---|---|
| Nova versão de variável | inalterada, sempre | inalterado; ganha badge | herdam o pin do publicado; badge |
| Nova versão de compatibilidade | inalterada, sempre | inalterado; ganha badge | idem |
| Item de catálogo renomeado | **reflete** o novo rótulo | reflete | reflete |
| Item de catálogo arquivado | continua exibindo, com marca | idem, e não pode ser atribuído a novas células | idem |

**Decisão deliberada:** rótulos de catálogo são referência viva, não snapshot. Renomear "Oferta 8" para "Oferta 8 — Renda Alta" muda a exibição em versões históricas. Isso é aceito porque é correção de nomenclatura. Mudar o **significado** exige criar item novo — e a interface diz isso ao lado do botão de editar.

### 5.6 Agrupamentos hierárquicos de faixas

Resolve o caso de modelo de score cujo corte numérico de cada faixa (R01…R20) varia conforme uma ou mais dimensões de negócio (Regional, Porte, Tipo de Empresa…), mas cujo **código** de faixa é o mesmo em todo lugar — é o mecanismo de normalização de risco entre agrupamentos. Generaliza o que a sessão 18 introduziu como um único nível fixo chamado "regional" para **N níveis dinâmicos**, com nome livre, nenhum deles obrigatoriamente chamado Regional. Ver `03-modelo-do-documento.md` §2 para o schema (`VariableVersion.groupingDimensions`, `Domain.groupingRanges`).

**Por que isso não é um eixo aninhado.** `AxisLevel` (`04-eixos-aninhados.md`) combina **variáveis distintas** numa matriz, produzindo colunas/linhas reais. `groupingDimensions` documenta **variações internas de uma única variável** — nunca produz coluna, nunca produz tupla, nunca é visível na matriz. Um caso real de Regional × Porte × Tipo de Empresa que hoje exigiria três variáveis (ou um eixo de 3 níveis) para representar cortes diferentes do mesmo score passa a ser uma variável só, com `groupingDimensions` de até 4 níveis documentando cada combinação. Se o objetivo é de fato criar colunas/linhas na matriz (o valor "aparece nos cineminhas"), a ferramenta certa continua sendo eixo aninhado — os dois mecanismos não se substituem.

**Editar.** `groupingDimensions` e `groupingRanges` são editados **junto** dos domínios, no mesmo `variable/saveDomains` (§5.6.1) — não existe comando separado para eles. Ligar/desligar `groupingDimensions` numa versão `DRAFT` é uma escolha binária: presente, todo domínio `RANGE` da versão usa `groupingRanges`; ausente, usa `rangeMin`/`rangeMax` como antes. Alternar o interruptor não converte valores automaticamente — o usuário parte de faixas vazias no modo para o qual mudou. Diferente da sessão 18, o número de níveis, seus nomes e suas opções não são digitados manualmente antes de usar a variável: o caminho principal é **colar uma tabela** (§5.6.2), que infere tudo — dimensões, opções e faixas — de uma vez.

#### 5.6.0 `boundaryMode` — limites inclusivo-inclusivo com passo 1

Interruptor por versão (`VariableVersion.boundaryMode`, independente de `groupingDimensions` — vale tanto para `rangeMin`/`rangeMax` quanto para `groupingRanges`), ausente ou `'INCLUSIVE_INTEGER'` é `[mín, máx]` com passo 1 — o default da aplicação, pensado para cortes de score que vêm do Excel já fechado-fechado (`R20: 0–357`, `R19: 358–437`, …): os valores são validados como inteiros, e a contiguidade (I9) exige `atual.máx + 1 == próxima.mín`. `'HALF_OPEN'` é o `[mín, máx)` clássico — I9 exige `atual.máx == próxima.mín` — e é opt-in explícito, para faixas decimais ou que tocam exatamente no limite.

Documentos que já tinham `boundaryMode: 'HALF_OPEN'` gravado explicitamente continuam se comportando como antes — só o significado de **ausência** do campo mudou (de `HALF_OPEN` para `INCLUSIVE_INTEGER`); o campo continua ligado variável por variável, como o interruptor de agrupamento.

**Direção da sequência (I9).** A contiguidade lê as faixas na ordem de `position` — que pode crescer (`rangeMin`/`min` aumentando a cada domínio seguinte, o caso de sempre) ou decrescer (cortes de score que o negócio lista "melhor faixa primeiro", ex.: `R01: 704–999`, `R02: 685–703`, …, `R20: 5–454`). A direção é detectada automaticamente pelo primeiro par de mínimos distintos por `position` — cada domínio ainda expõe seu próprio `rangeMin`/`rangeMax` (ou `GroupingRange.min`/`max`) normalmente, e o par de fronteira comparado por I9 (`atual.máx [+1] == próxima.mín`) se ajusta ao sentido detectado. Não há campo novo no schema nem escolha manual — o usuário cola/ordena os domínios como já faz sentido para o negócio, em qualquer um dos dois sentidos.

`INCLUSIVE_INTEGER` é também o modo que sustenta a **continuidade automática** (§5.6.2): como o padrão da aplicação passa a ser não expor os checkboxes "mín. inclusivo"/"máx. inclusivo" na edição normal, o comportamento assumido é sempre `[mín, máx]` com passo 1 — o usuário só vê os checkboxes, e só precisa pensar em `boundaryMode`, ao entrar explicitamente nas "opções avançadas" do editor de domínios (`07-ux-e-editor.md` §11), para o caso raro de faixas decimais.

#### 5.6.1 `variable/saveDomains` — entrada estendida

```ts
input: {
  variableId: string;
  versionId: string;
  domains: Domain[];
  groupingDimensions?: GroupingDimension[];   // ausente = variável não usa agrupamento
  boundaryMode?: 'HALF_OPEN' | 'INCLUSIVE_INTEGER';   // ausente = INCLUSIVE_INTEGER (§5.6.0)
}
```

Continua substituindo o conjunto inteiro (domínios, agrupamentos **e** `boundaryMode`), só em `DRAFT` (`VARIABLE_VERSION_IMMUTABLE` senão), e roda `validateDomains` antes de gravar — agora ciente de `groupingDimensions` (I9, I19) e de `boundaryMode` (I9):

- sem `groupingDimensions`: validação igual à de hoje;
- com `groupingDimensions`: estrutura válida por I19 — 1 a 4 níveis (`TOO_MANY_GROUPING_LEVELS` acima disso), `code` de nível único (`GROUPING_DIMENSION_CODE_DUPLICATE`), `code` de opção único dentro do próprio nível (`GROUPING_OPTION_CODE_DUPLICATE`), todo `path` de `groupingRanges` com o comprimento certo e apontando para opções existentes (`GROUPING_PATH_INVALID`); dentro de **cada `path` distinto** presente nos dados (não em toda combinação possível — ver I19 em `03-modelo-do-documento.md` §9), a mesma regra de contiguidade/sobreposição/catch-all de hoje, aplicada independentemente (`RANGE_GROUPING_NOT_CONTIGUOUS`, com `{ path, domainCode }` no `details`);
- com `boundaryMode: 'INCLUSIVE_INTEGER'` (com ou sem `groupingDimensions`): mínimo/máximo de cada faixa precisam ser inteiros (mesmo código de erro que a contiguidade, `RANGE_NOT_CONTIGUOUS`/`RANGE_GROUPING_NOT_CONTIGUOUS`, mensagem específica), e a contiguidade compara `atual.máx + 1` com `próxima.mín` em vez de igualdade direta.

#### 5.6.2 Importação genérica de tabela colada

Substitui a colagem específica de regional da sessão 18 por uma funcionalidade **genérica da Biblioteca de Variáveis**: qualquer tipo de variável (`RANGE`, `CATEGORICAL`, `ORDINAL`, `BOOLEAN`), com ou sem agrupamento, importa domínios colando uma tabela — inclusive só para atualizar cores de domínios existentes (o caso "colei uma tabela Domínio + RGB por cima de uma variável que já tinha as faixas certas").

`parseDomainTable(text)` — função **pura** em `src/core/library/domain-import.ts` (substitui `regional-import.ts`), sem comando associado: traduz texto em `{ domains, groupingDimensions, columns, warnings, errors }`, onde `columns` registra quais campos (`min`, `max`, `color`, agrupamento) estavam de fato presentes no cabeçalho colado — é o que orienta o merge de §5.6.3. Nada é gravado no documento por esta função; quem grava é `saveDomains`, depois de `mergeImportedDomains` (mesmo arquivo) combinar o resultado com os domínios já existentes na tela.

**Contrato de colagem — tabela tidy, uma linha por combinação** (o usuário cola direto do Excel, TSV com tabulação como separador de coluna):

1. **Linha 1 é cabeçalho, sempre obrigatória.** Colunas reconhecidas por nome, sem diferenciar maiúsculas/acentos: `Domínio` (aceita também `Código`) é a **âncora obrigatória**; `Mínimo` (aceita `Min`/`Mín`) e `Máximo` (aceita `Max`/`Máx`) só são obrigatórias quando `type = RANGE` — se ausentes do cabeçalho, a colagem não toca em faixas, só em identidade/cor (ver item 6); `Cor` (aceita `RGB`/`Hex`) é sempre opcional. Qualquer coluna à **esquerda** de `Domínio` que não bata com um nome reconhecido é uma **coluna de agrupamento**, na ordem em que aparece — de 0 a 4 colunas (I19). Cabeçalho sem a coluna `Domínio`, ou mais de 4 colunas de agrupamento → `DOMAIN_TABLE_PARSE_ERROR`.
2. **Cada linha seguinte é uma combinação**: valor de cada coluna de agrupamento (se houver), domínio, faixa (se as colunas existirem) e cor (se a coluna existir). Número de colunas de dado inconsistente com o cabeçalho → `DOMAIN_TABLE_PARSE_ERROR`, sem gravar nada.
3. **`Domínio`**: mesmo formato de hoje — texto livre; `code` é o trecho antes do primeiro `" - "` (ou `–`/`—`), maiúsculo, validado contra `^[A-Z0-9_]+$`; sem separador, o texto inteiro vira `code` e `label`.
4. **`Cor`**: aceita `#RRGGBB` ou `R G B` / `R, G, B` (0–255, como no relatório de risco colado direto de uma planilha de cores) — convertida para `#RRGGBB` internamente.
5. **Colunas de agrupamento**: o texto de cada célula vira o `code` da `GroupingOption` daquele nível (normalizado: maiúsculo, sem acento, espaço vira `_`); o cabeçalho da coluna vira o `label` da `GroupingDimension`; a ordem das opções dentro de cada nível é a ordem de primeira aparição do valor na tabela.
6. **Identidade e cor por domínio**: capturadas na **primeira linha** em que o `code` aparece. Se uma linha posterior trouxer uma cor diferente e não vazia para o mesmo `code`, é **aviso**, não erro — mantém a primeira. `position` de cada domínio = ordem da primeira aparição do `code` na tabela colada; pode ser ajustada depois no editor (drag), como qualquer variável.
7. **Sem colunas de agrupamento** (0 antes de `Domínio`): cada `code` deve aparecer em no máximo uma linha — repetição sem uma dimensão para diferenciar é `DOMAIN_TABLE_PARSE_ERROR`. Quando `Mínimo`/`Máximo` estão no cabeçalho, o resultado alimenta `rangeMin`/`rangeMax` diretamente.
8. **Com 1+ colunas de agrupamento**: quando `Mínimo`/`Máximo` estão no cabeçalho, o resultado alimenta `groupingRanges` — uma entrada por `(path, domínio)`. Célula de `Mínimo`/`Máximo` vazia numa linha com agrupamento é **aviso**: a combinação fica incompleta e não entra no resultado pronto, o usuário completa manualmente ou recola.
9. **A colagem em si nunca valida contiguidade** — só extrai os dados. É `saveDomains` (via `validateDomains`, §5.6.1) que decide se o resultado é contíguo, respeitando o `boundaryMode` corrente da versão (§5.6.0). Por isso uma tabela colada no formato fechado-fechado original do Excel (`0-357`, `358-437`, …) passa sem ajuste manual quando `boundaryMode: 'INCLUSIVE_INTEGER'` já está ligado antes de colar.

**Exemplo — o caso real de Regional × Porte:**

```
Regional	Porte	Domínio	Mínimo	Máximo
São Paulo	MEI	R1	0	357
São Paulo	MEI	R2	358	420
São Paulo	Não MEI	R1	0	340
Sul	MEI	R1	0	360
```

Produz `groupingDimensions` com 2 níveis (`REGIONAL` com opções `SAO_PAULO`/`SUL` na ordem de aparição, `PORTE` com `MEI`/`NAO_MEI`) e `groupingRanges` só para as combinações que de fato aparecem na tabela — sem exigir que "Sul" tenha uma linha para "Não MEI" (I19, §5.6).

**Exemplo — só atualizar cores** (formato do relatório de risco colado pelo usuário: um domínio já existente por linha, sem tocar faixa):

```
Risco	RGB
R20	255 0 0
R19	255 32 32
```

Sem `Mínimo`/`Máximo` no cabeçalho, o merge (§5.6.3) preserva as faixas já salvas de R20/R19 e só substitui a cor.

#### 5.6.3 Preservação de atributos existentes ao recolar

Regra que evita o usuário perder trabalho manual (cor, principalmente) sempre que o `code` de um domínio colado já existe na variável: `mergeImportedDomains(existingDomains, parsed)` — função **pura** no mesmo `domain-import.ts` — decide, campo a campo, **só a partir das colunas que a colagem trouxe** (`parsed.columns`, item 1 de §5.6.2):

- `label`/`shortLabel`: sempre vêm da colagem (a coluna `Domínio` é a âncora obrigatória, está sempre presente) — recolar sempre atualiza o rótulo.
- `color`: só é sobrescrita se a coluna `Cor` estava presente nesta colagem; senão, herda a cor do domínio existente de mesmo `code`, se houver.
- `rangeMin`/`rangeMax`/`groupingRanges`: só são sobrescritos se `Mínimo`/`Máximo` estavam presentes; senão, herdam os valores existentes.
- Domínio colado sem correspondência de `code` na lista atual: entra como novo, só com os campos que a colagem de fato trouxe.

O resultado do merge é o que aparece no editor para revisão — nada é gravado até o usuário confirmar `saveDomains` (mesmo fluxo de sempre). **Isso resolve tanto "dupliquei uma variável e perdi as cores" quanto "recolei a tabela de score e perdi as cores"**: em ambos os casos, o domínio de destino já tinha `color`, e a colagem/duplicação que não menciona cor explicitamente nunca a apaga.

#### 5.6.4 Paletas de cor

Complementa a seleção manual de `color` com três mecanismos, nenhum deles exigindo `groupingDimensions`:

- **Paletas pré-definidas.** `src/lib/color-palettes.ts` exporta `ColorPalette[]` — dados estáticos, não fazem parte do documento. Duas paletas oficiais nesta versão (valores fornecidos pelo usuário, §5.6.4.1): `RISCO_R01_R20` (escala de 20 pontos) e `RISCO_SIMPLIFICADO` (5 classificações: Baixíssimo, Baixo, Médio, Alto, Altíssimo). Cada entrada casa por `code` **ou** `label` do domínio, normalizado (maiúsculo, sem acento) — a escala R01-R20 casa tanto `R1` quanto `R01` (regex tolerante a zero à esquerda), a simplificada casa o texto exato das 5 classificações.
- **Aplicar paleta** — ação no editor de domínios: usuário escolhe uma paleta, o sistema aplica `color` a todo domínio cujo `code`/`label` bater, mostra quantos bateram (`"18 de 20 domínios coloridos"`), e deixa os que não bateram como estavam. É uma alteração local no editor, como qualquer edição de domínio — só grava ao confirmar `saveDomains`.
- **Sugestão automática.** Ao criar domínios novos (digitando ou via §5.6.2) sem `color` explícita, se o `code`/`label` bater com uma paleta oficial, o campo já nasce preenchido com a cor sugerida — continua sendo um campo comum, o usuário sobrescreve quando quiser. Cor vinda explicitamente da colagem (coluna `Cor`) sempre vence a sugestão.
- **Importar tabela de cores.** É só um caso particular de §5.6.2 — colar `Domínio` + `Cor` sem `Mínimo`/`Máximo` aplica cores a domínios existentes pelo mesmo mecanismo de merge (§5.6.3), sem exigir uma paleta nomeada.

Paletas customizadas e salvas pelo usuário (além das duas oficiais) ficam **fora do escopo** desta evolução — `ColorPalette[]` é uma lista estática hoje; se no futuro o usuário quiser definir e reutilizar as próprias paletas, isso exige um novo campo no documento (persistência) e é uma decisão de arquitetura própria, não implícita nesta sessão.

##### 5.6.4.1 Paleta oficial `RISCO_R01_R20`

| Domínio | RGB | Domínio | RGB |
|---|---|---|---|
| R01 | `0,255,42` | R11 | `255,186,64` |
| R02 | `36,255,72` | R12 | `255,162,0` |
| R03 | `72,255,102` | R13 | `255,224,224` |
| R04 | `108,255,132` | R14 | `255,192,192` |
| R05 | `144,255,162` | R15 | `255,160,160` |
| R06 | `180,255,192` | R16 | `255,128,128` |
| R07 | `216,255,222` | R17 | `255,96,96` |
| R08 | `240,255,246` | R18 | `255,64,64` |
| R09 | `255,234,192` | R19 | `255,32,32` |
| R10 | `255,210,128` | R20 | `255,0,0` |

##### 5.6.4.2 Paleta oficial `RISCO_SIMPLIFICADO`

| Classificação | RGB |
|---|---|
| Baixíssimo | `0,255,42` |
| Baixo | `240,255,246` |
| Médio | `255,162,0` |
| Alto | `255,128,128` |
| Altíssimo | `255,0,0` |

#### 5.6.5 Duplicar variável

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

Cria uma `Variable` nova (novo `id`, novo `code`) com `type` igual ao da origem e uma v1 `DRAFT` cujos `domains` e `groupingDimensions` são cópia integral da versão de origem, **incluindo `color`** — `structuredClone`, sem regenerar nem descartar nenhum campo de domínio. A variável de origem não é tocada, e nada liga as duas depois — é ponto de partida, não vínculo. Sem evento próprio, mesmo padrão de `variable/create`.

**Por que isso substitui "criar 9 variáveis regionais" (ou 3 variáveis de Regional × Porte).** Com `groupingDimensions`, um único `variable/saveDomains` (ou uma colagem) preenche todas as combinações de uma vez dentro de uma variável só; `variable/duplicate` só entra em cena quando o usuário quer de fato uma variável nova e distinta (HVI1 → HVI2), não para replicar a mesma faixa por agrupamento.

## 6. Consulta por data de vigência

```ts
getEffectiveVersion(doc, matrixId, at: Date): MatrixVersion | null
```

Retorna a versão com `state ∈ {PUBLISHED, SUPERSEDED}` cujo intervalo semiaberto `[effectiveFrom, effectiveTo)` contém `at`. Na data exata da troca, vale a versão nova. Sem resultado = a matriz não existia naquela data → a interface mostra "sem política vigente em dd/mm/aaaa", não um erro.

`getPortfolioAt(doc, projectId, at)` faz o mesmo para todas as matrizes do projeto.

### 6.1 Vigência de componente de política (épico Governança, S32a/S33b)

Mesmo mecanismo do §6, aplicado a `PolicyComponent`/`ComponentVersion`
(`14-governanca-de-alteracoes.md` §3.2, normativo — este bloco é o espelho de leitura):

```ts
getComponentEffectiveVersion(component: PolicyComponent, at: Date): ComponentVersion | null
getComponentTimeline(component: PolicyComponent): TimelineSegment[]
listComponentsEffectiveAt(doc, projectId, at: Date): Array<{ component; version: ComponentVersion | null }>
```

- Mesmo intervalo semiaberto `[effectiveFrom, effectiveTo)`, mesma regra de "sem resultado não é
  erro". `MATRIX` nunca tem versão própria (I27) e fica de fora — sua vigência é a da matriz,
  já coberta por `getEffectiveVersion`/`getPortfolioAt`.
- **Diferença do §6, ditada por I29**: `SECTION` sem nenhuma versão (pasta pura) **nunca** entra em
  `listComponentsEffectiveAt` — nem com `version: null`. Uma matriz sem versão vigente numa data
  aparece na tela como "sem política vigente" porque ela é sempre conteúdo; uma seção pura é
  estrutura, e misturar as duas faria toda seção-pasta parecer uma regra que caducou. A checagem é
  `component.versions.length > 0`, não o resultado da busca por data.
- Publicar aceita vigência **retroativa** (RN-GOV-09, `14-governanca-de-alteracoes.md` §6) — ao
  contrário de `publishVersion` de matriz, que não valida isso porque a UI de matriz não oferece
  data no passado. É o caminho da fundação: cadastrar ~100 regras que já vigoram desde antes de a
  ferramenta existir.
- Publicação em lote (`componentVersion/publishPending`, §17.4 de `07-ux-e-editor.md`) é atômica: o
  comando valida a vigência e o payload de todo o lote contra o documento original antes de
  escrever qualquer versão — um item inválido no meio do lote não deixa os anteriores publicados
  pela metade (RN-GOV-05).

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
| `IMPORT_RUN` | `{ importRunId, profileCode, fileName?, contentHash, rowCount, created, changed, unchanged, skipped, structural, blocked }` |
| `IMPORT_PROFILE_SAVED` | `{ code, name, columnCount }` |
| `MATRIX_TAGGED` | `{ matrixId, added, removed }` |

Os eventos produzidos **dentro** de uma carga (`MATRIX_CREATED`, `DRAFT_CREATED`, `CELLS_UPDATED`) carregam `importRunId` no próprio payload, além dos campos de sempre. É o que liga cada célula ao arquivo que a originou (`12-carga-de-matrizes.md` US-10).

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
DOMAIN_TABLE_PARSE_ERROR,
IMPORT_PARSE_ERROR, IMPORT_PROFILE_INVALID, IMPORT_PROFILE_DUPLICATE,
IMPORT_UNMAPPED_VALUE, IMPORT_DUPLICATE_KEY, IMPORT_STRUCTURE_DIVERGED,
IMPORT_PLAN_STALE, IMPORT_NOTHING_TO_APPLY, IMPORT_TARGET_HAS_DRAFT,
IMPORT_TARGET_ARCHIVED,
TAG_NOT_FOUND
```

Mais os do épico Plataforma (`14-plataforma-local.md`): `ROLE_REQUIRED` e `ACL_REQUIRES_ADMIN` (papéis, §6, sessão 29), `EVIDENCE_NOT_FOUND` e `EVIDENCE_DUPLICATE_PATH` (evidências, §7, sessão 30).

### 9.1 Épico Governança — o catálogo `E-GOV` (sessão 32a)

`14-governanca-de-alteracoes.md` §6 nomeia os erros do épico como `E-GOV-01..06`. Esses rótulos são
de leitura do documento normativo; no código eles são códigos simbólicos, como todos os outros. A
correspondência é esta, e o catálogo entrou **inteiro** na S32a; a S32b ligou os comandos de DB e
release e, com eles, os erros de workflow:

| Rótulo | `DomainErrorCode` | Quando acontece | Emissor |
|---|---|---|---|
| `E-GOV-01` | `CR_TRANSITION_INVALID` | Transição de status fora do grafo de §5 de `docs/14`, ou tentativa de mexer em item de DB já congelado (I30) | **S32b** ✅ |
| `E-GOV-02` | `CR_BASE_VERSION_STALE` | A versão vigente do componente mudou depois que o item foi escrito: publicar exige rebase explícito (RN-GOV-02) | S36 (a S32b só **avalia**, ver abaixo) |
| `E-GOV-03` | `CR_INCOMPLETE` | Submeter sem motivador, sem item com `proposedSummary` ou sem vigência proposta (RN-GOV-03) | **S32b** ✅ |
| `E-GOV-04` | `RELEASE_PUBLISH_BLOCKED` | Publicação de DB ou release abortada inteira por pendência em algum item (RN-GOV-05) — nada é publicado | S36 (a S32b entrega a lista de pendências) |
| `E-GOV-05` | `ATTACHMENT_TOO_LARGE` | Imagem embutida acima do teto de 300 KB (`03-modelo-do-documento.md` §8.1) | S34 |
| `E-GOV-06` | `COMPONENT_CODE_DUPLICATE` | `PolicyComponent.code` repetido no mesmo projeto (I28). É o que a carga por recorte usa para impedir o mesmo capítulo de entrar duas vezes | **S32a** ✅ |

**Os dois que continuam sem emissor são os dois que dependem de publicar.** `E-GOV-02` e `E-GOV-04`
só fazem sentido no momento em que alguém manda publicar, e publicar é a S36/S37. O que a S32b
entrega no lugar é a **avaliação estática**: `assessReleaseComposition` (`src/core/document/releases.ts`)
devolve, sem lançar nada, a lista tipada de pendências de cada DB da release — inclusive
`ITEM_BASE_STALE` (a base defasada de `E-GOV-02`) e `ITEM_WITHOUT_DRAFT` (a pendência de
`E-GOV-04`). A S36 lê essa lista e a transforma no `DomainError` correspondente.

**O que a S32b reusa do catálogo geral**, em vez de inventar código novo: `DUPLICATE_CODE` (`code`
de DB ou de release repetido — I31), `CATALOG_REF_MISSING` (motivador ou categoria de impacto fora
do catálogo, mesma regra de `Matrix.tags`), `NOT_FOUND` (DB, release, componente, versão base ou
rascunho inexistente), `VERSION_NOT_DRAFT` (item vinculado a versão que não é mais rascunho) e
`INVALID_INPUT` (texto em branco, data fora do ISO, devolução sem comentário, e o componente
repetido no mesmo DB da RN-GOV-02 — que é regra de entrada, não de workflow).

Fora do catálogo `E-GOV`, a árvore de componentes acrescenta **um** código próprio:
`COMPONENT_TREE_INVALID`, a recusa em tempo de comando do que I27/I28 garantem no documento parado —
ciclo em `component/move`, profundidade acima de 6 níveis, filho pendurado num `MATRIX`, espelho de
matriz ou de variável já ocupado. Os demais erros dos comandos de componente reusam o catálogo que
já existia: `NOT_FOUND`, `INVALID_INPUT`, `TAG_NOT_FOUND`, `DRAFT_ALREADY_EXISTS`,
`NO_VERSION_TO_DERIVE`, `VERSION_NOT_DRAFT`, `VERSION_IMMUTABLE` e `EFFECTIVE_DATE_INVALID` — o
ciclo de vida do componente é o das matrizes, e recusar com códigos diferentes seria inventar
vocabulário para a mesma regra.

Os dez últimos do bloco acima pertencem à carga de matrizes; quando cada um acontece e o que o usuário faz a respeito está em `12-carga-de-matrizes.md` §5.8.

`RANGE_REGIONAL_INCOMPLETE`, `RANGE_REGIONAL_NOT_CONTIGUOUS`, `REGIONAL_CODE_DUPLICATE` e `REGIONAL_IMPORT_PARSE_ERROR` (sessão 18) são removidos na sessão 20 — substituídos pelos códigos genéricos acima. `RANGE_REGIONAL_INCOMPLETE` não tem substituto direto: a completude por combinação deixou de ser invariante (`03-modelo-do-documento.md` §9, nota após I19) e virou aviso não bloqueante na interface, não um `DomainError`.

`INVALID_DOMAIN_SET`, `RANGE_NOT_CONTIGUOUS`, `BOOLEAN_NEEDS_TWO_DOMAINS`, `RANGE_GROUPING_NOT_CONTIGUOUS`, `GROUPING_DIMENSION_CODE_DUPLICATE`, `GROUPING_OPTION_CODE_DUPLICATE`, `GROUPING_PATH_INVALID` e `TOO_MANY_GROUPING_LEVELS` também saem do catálogo: `variable/saveDomains` e `variable/publish` não chamam mais `assertValidDomains`, então nenhum desses códigos é lançado como `DomainError`. A forma/contiguidade/agrupamento de domínios (I8, I9, I18, I19) virou aviso não bloqueante em dois lugares — nunca uma exceção:

- `validateDomains` (`src/core/library/validate-domains.ts`), a mesma função pura de antes, continua devolvendo `DomainValidationIssue[]` em tempo real para a interface (§5.6.1) — só que agora ninguém embrulha o primeiro problema numa `DomainError`;
- `checkI8`, `checkI9`, `checkI19` e a checagem de código de domínio de `checkI18` (`src/core/document/validate.ts`) produzem `ValidationIssue` com `severity: 'WARNING'` em vez de `'ERROR'` — não derrubam `validateDocument().ok`, então também não bloqueiam `prepareSave` (`06-persistencia-e-concorrencia.md` §4). Salvar um documento com faixa não contígua, `BOOLEAN` com número errado de domínios ou `path` de agrupamento inválido passa a ser possível; o modo de recuperação (`03-modelo-do-documento.md` §9, §10) lista esses avisos junto com os erros de verdade, agrupados por gravidade.

Cada código tem mensagem pt-BR em `src/core/error-messages.ts`. A interface nunca exibe o código cru. Um teste percorre o enum e falha se faltar mensagem.

## 10. Carga de matrizes

Trazer uma tabela externa (extração do sistema de origem) para dentro do documento, e mantê-la atualizada ao longo do tempo, é um domínio próprio: as regras (RN-01 a RN-20), os contratos do motor e o assistente estão em **[`12-carga-de-matrizes.md`](12-carga-de-matrizes.md)**. Três regras dali têm efeito sobre tudo o que este documento define e são repetidas aqui por serem transversais:

1. **A carga nunca altera versão publicada** (RN-01). Ela cria matriz nova, cria rascunho e escreve células dentro de rascunho — sempre pelos mesmos comandos de §1 e §2, nunca por um caminho privilegiado. I3 continua sendo a guarda.
2. **Matriz cujo conteúdo veio idêntico não recebe rascunho, versão nem evento** (RN-02). É o que preserva o significado da linha do tempo: versão nova passa a ser evidência de mudança, não subproduto do calendário. Consequência testável: aplicar o mesmo arquivo duas vezes produz zero alterações na segunda (RN-05).
3. **A carga não publica** (RN-10). Publicar continua exigindo nota, vigência e zero pendências (§1.3), por decisão de quem revisa.

`variable/*`, `compat/*` e `catalog/*` também são os comandos usados quando o assistente monta a biblioteca a partir do arquivo (`12-carga-de-matrizes.md` US-04) — a carga não cria entidade de biblioteca por fora deles.
