# Eixos Aninhados

> A parte mais nova e mais delicada do produto. Tudo aqui vive em `src/core/axes/` como TypeScript puro, com 100% de cobertura de teste.

## 1. Vocabulário

| Termo | Significado |
|---|---|
| **Nível** (`AxisLevel`) | Uma variável dentro de um eixo. `SEGMENTO` é o nível 0, `FAT` é o nível 1 |
| **Caminho** (`path`) | Um código por nível, separados por `\|`: `"VAREJO\|500K_1M"` |
| **Tupla** | Um caminho **válido**, presente em `axis.tuples` |
| **Chave de célula** | `"${xPath}::${yPath}"` |
| **Combinação** | Um par (tupla de X, tupla de Y) — uma célula do grid |

Limites: **1 a 3 níveis por eixo**, **6.000 combinações por versão** (alerta em 1.500).

## 2. Codificação de caminhos — `src/core/axes/paths.ts`

```ts
const LEVEL_SEP = '|';
const AXIS_SEP  = '::';

encodePath(codes: string[]): string          // ['VAREJO','500K_1M'] → 'VAREJO|500K_1M'
decodePath(path: string): string[]
encodeCellKey(xPath: string, yPath: string): string
decodeCellKey(key: string): { xPath: string; yPath: string }
pathPrefix(path: string, levels: number): string
isDescendantOf(path: string, prefix: string): boolean
```

Como `code` casa `^[A-Z0-9_]+$`, nem `|` nem `:` podem aparecer num código — a codificação é injetiva sem escape. **Valide isso na criação do domínio**, senão a garantia se perde. Teste explícito.

## 3. Geração de tuplas — `src/core/axes/tuples.ts`

```ts
generateTuples(input: {
  levels: Array<{ variableId: string; domains: Domain[] }>;
  compatibility: CompatibilityVersion[];   // regras publicadas relevantes
  manualSuppressions?: string[];
}): { tuples: string[]; usedRuleIds: string[]; warnings: TupleWarning[] };
```

Algoritmo:

```
tuples ← [[]]
para cada nível i, de 0 a n-1:
    próximo ← []
    para cada caminho parcial t em tuples:
        permitidos ← domínios do nível i, ordenados por position
        se i > 0:
            regra ← regra publicada para (variável do nível i-1, variável do nível i)
            se regra existe:
                lista ← regra.allow[ t[i-1] ]
                se lista definida:  permitidos ← permitidos ∩ lista
                senão:              permitidos ← regra.defaultForUnlisted === 'ALL' ? permitidos : ∅
        para cada d em permitidos:
            próximo.push([...t, d.code])
    tuples ← próximo
resultado ← tuples.map(encodePath).filter(p => p ∉ manualSuppressions)
```

**Ordem das tuplas**: a produzida pelo algoritmo — nível 0 varrendo por `position`, e dentro dele o nível 1 por `position`, e assim por diante. É a ordem visual do grid, e é determinística. Nunca reordene depois.

Regras de compatibilidade são aplicadas apenas **entre níveis adjacentes** (i-1 → i). Limitação consciente; ver §5.4.

### 3.1 Avisos (`TupleWarning`)

Não são erros — a geração continua, e a interface mostra o aviso ao usuário:

| Código | Situação |
|---|---|
| `PARENT_HAS_NO_CHILDREN` | Um domínio do nível pai ficou sem nenhum filho permitido e sumiu do grid |
| `RULE_REFERENCES_UNKNOWN_DOMAIN` | A regra cita um código que não existe mais na versão pinada da variável |
| `NO_RULE_FOR_PAIR` | Não há regra para o par; o produto cartesiano completo foi usado |
| `SUPPRESSION_NOT_APPLICABLE` | Uma supressão manual aponta para um caminho que já não existe |
| `LARGE_GRID` | Passou de 1.500 combinações |

### 3.2 Erros

| Código | Situação |
|---|---|
| `NO_VALID_TUPLES` | O eixo ficou sem nenhuma tupla — configuração impossível |
| `GRID_TOO_LARGE` | Passou de 6.000 combinações |
| `TOO_MANY_LEVELS` | Mais de 3 níveis |
| `DUPLICATE_VARIABLE_IN_AXIS` | A mesma variável em dois níveis do mesmo eixo |
| `VARIABLE_ON_BOTH_AXES` | A mesma variável em X e em Y |

## 4. Layout do cabeçalho — `src/core/axes/header-layout.ts`

```ts
computeHeaderLayout(axis: Axis): HeaderRow[];

type HeaderRow = { level: number; cells: HeaderCell[] };
type HeaderCell = {
  code: string;
  label: string;
  shortLabel?: string;
  color?: string;
  path: string;        // prefixo até este nível — é a chave de seleção
  span: number;        // quantas tuplas este cabeçalho cobre
  startIndex: number;  // índice da primeira tupla coberta
};
```

Algoritmo, **derivado das tuplas** (nunca do produto cartesiano teórico):

```
para cada nível i:
    percorre axis.tuples em ordem
    agrupa tuplas CONSECUTIVAS que compartilham o prefixo de i+1 códigos
    cada grupo vira um HeaderCell com span = tamanho do grupo,
      path = o prefixo, startIndex = índice da primeira tupla do grupo
```

Derivar dos dados é o que faz o layout ficar correto de graça quando há supressão: se Varejo tem 3 faixas e Atacado tem 3, os cabeçalhos de nível 0 nascem com span 3 e 3 — sem nenhum caso especial.

O último nível sempre produz cabeçalhos com `span = 1`.

## 5. Operações sobre níveis — `src/core/axes/levels.ts`

Todas só funcionam em versão `DRAFT` (I3) e todas registram evento de auditoria.

### 5.1 Adicionar nível

```ts
addLevel(version, role, { variableId, position, onExisting }): Result
// position: em qual profundidade inserir (0 = mais externo)
// onExisting: 'REPLICATE' | 'CLEAR'
```

Cada tupla existente se desdobra em N novas (uma por domínio permitido do novo nível). O que acontece com o conteúdo das células:

- **`REPLICATE`** (padrão): cada célula existente é copiada para todas as suas novas descendentes. O usuário sai de um grid preenchido para outro grid preenchido, e refina só onde precisa. É quase sempre o que se quer.
- **`CLEAR`**: as novas combinações nascem vazias e o rascunho fica bloqueado para publicação até serem preenchidas.

Preview obrigatório antes de aplicar: "20 combinações viram 60; 240 células viram 720".

### 5.2 Remover nível

```ts
removeLevel(version, role, levelIndex, { onCollapse }): Result
// onCollapse: 'KEEP_FIRST' | 'KEEP_IF_UNANIMOUS'
```

Várias tuplas colapsam em uma. Duas políticas:

- **`KEEP_FIRST`**: vence o conteúdo da primeira tupla do grupo (na ordem do grid).
- **`KEEP_IF_UNANIMOUS`** (padrão): se todas as células do grupo forem idênticas, mantém; se divergirem, a célula resultante nasce **vazia** e entra na contagem de pendências.

`KEEP_IF_UNANIMOUS` é o padrão porque perder informação em silêncio é o pior desfecho possível. O preview informa quantas colapsam com divergência.

O conteúdo descartado vai **integralmente** para o payload do evento — precisa ser reconstruível a partir da auditoria.

Remover o único nível de um eixo é proibido (`AXIS_NEEDS_ONE_LEVEL`).

### 5.3 Reordenar níveis

```ts
reorderLevels(version, role, fromIndex, toIndex): Result
```

Trocar `[SEGMENTO, FAT]` por `[FAT, SEGMENTO]` **não perde nenhuma célula**: o conjunto de combinações é o mesmo, só muda a ordem dos códigos no caminho e a ordem de exibição. A implementação remapeia cada chave de célula permutando os códigos, e regenera `tuples` na nova ordem.

Atenção: a compatibilidade é direcional (pai → filho). Ao reordenar, a regra aplicável muda — pode ser que não exista regra para o novo par, ou que exista uma inversa. Recalcule `tuples` e compare: **se o conjunto de tuplas mudar, é reordenação com perda** e o usuário precisa confirmar, com o preview do que sai e do que entra.

### 5.4 Limitação consciente

Compatibilidade é sempre pairwise entre níveis adjacentes. Num eixo `[SEGMENTO, PORTE, FAT]`, existem as regras SEGMENTO→PORTE e PORTE→FAT, mas **não** é possível dizer "Varejo + Porte Médio permite faixas X, Y, mas Atacado + Porte Médio permite Y, Z".

Escape hatch: **supressão manual** (`axis.manualSuppressions`), que remove combinações específicas naquela versão da matriz. É explícita, aparece na interface como "3 combinações suprimidas manualmente" e entra na auditoria.

Se esse escape hatch começar a ser usado em escala, é sinal de que a regra pairwise não basta — e aí vale reabrir o desenho. Isso está registrado como risco conhecido, não como bug.

## 6. Célula, combinação e pendência

```ts
allCombinations(version): Array<{ xPath: string; yPath: string; key: string }>
countPending(version): number      // combinações sem `decision`
listPending(version, limit?): Array<{ xPath, yPath, key }>
```

Uma combinação está pendente quando `cells[key]?.decision` é indefinido. Combinações suprimidas **não** contam como pendentes — foi por isso que a supressão existe.

## 7. Seleção hierárquica

O caminho de um cabeçalho é o prefixo. Clicar no cabeçalho "Varejo" (nível 0) seleciona todas as tuplas que começam com `VAREJO`:

```ts
tuplesUnder(axis, prefixPath): string[]
coordsForHeader(version, role, prefixPath): CellCoord[]
```

Isso vale para qualquer nível: clicar em "Varejo" pega 3 linhas; clicar em "Varejo › 100k–500k" pega 1. É o que resolve o pedido de "selecionar tudo que é Varejo e reprovar".

## 8. Testes obrigatórios

`src/core/axes/` exige 100% de cobertura. No mínimo:

**paths.ts** — round-trip de encode/decode com 1, 2 e 3 níveis; código com `_` e dígitos; rejeição de código com separador.

**tuples.ts**
- 1 nível → tuplas = domínios na ordem de `position`;
- 2 níveis sem regra → produto cartesiano completo;
- 2 níveis com o mapa do exemplo → exatamente as 8 tuplas esperadas, na ordem esperada;
- `defaultForUnlisted: 'NONE'` com pai ausente do mapa → pai some, aviso `PARENT_HAS_NO_CHILDREN`;
- `defaultForUnlisted: 'ALL'` com pai ausente → todos os filhos;
- regra citando domínio inexistente → aviso, sem quebrar;
- 3 níveis com duas regras encadeadas;
- supressão manual removendo tupla existente e apontando para inexistente;
- `NO_VALID_TUPLES` quando o mapa zera tudo;
- `GRID_TOO_LARGE` no limite exato de 6.000 (e 5.999 passa).

**header-layout.ts**
- 1 nível → uma linha, todos com span 1;
- 2 níveis simétricos → spans corretos;
- **2 níveis com supressão assimétrica** (Varejo 3, Atacado 3, Corporate 2) → spans 3, 3, 2 e `startIndex` correto;
- 3 níveis;
- eixo com uma tupla só.

**levels.ts**
- `addLevel` com `REPLICATE` preserva conteúdo em todas as descendentes; contagem final correta;
- `addLevel` com `CLEAR` gera pendências e bloqueia publicação;
- `addLevel` em `position` 0 (mais externo) e no fim — ambos corretos;
- `removeLevel` com `KEEP_IF_UNANIMOUS`: grupo unânime preserva, grupo divergente esvazia;
- `removeLevel` com `KEEP_FIRST`: vence a primeira na ordem do grid;
- conteúdo descartado aparece íntegro no payload do evento;
- `reorderLevels` sem mudança de conjunto de tuplas preserva **todas** as células (compare o mapa inteiro, não a contagem);
- `reorderLevels` com mudança de conjunto exige confirmação e reporta o delta;
- remover o único nível falha;
- variável duplicada no eixo falha; variável nos dois eixos falha.

**Teste de propriedade** (recomendado, com `fast-check`): para qualquer configuração válida de níveis e regras, `computeHeaderLayout` produz, no último nível, exatamente `tuples.length` cabeçalhos, e a soma dos spans de cada nível é igual a `tuples.length`.
