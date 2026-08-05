# Regras de Negócio

> Documento normativo. Cada regra aqui tem um teste unitário correspondente obrigatório.

## 1. Ciclo de vida da versão de matriz

```
        criar matriz                     publicar
             │                               │
             ▼                               ▼
         v1 DRAFT ─────────────────────► v1 PUBLISHED
                                             │
                      criar rascunho ◄───────┤
                             │               │
                             ▼               │
                        v2 DRAFT             │
                             │               │
                        publicar             │
                             ▼               ▼
                        v2 PUBLISHED    v1 SUPERSEDED
```

Estados: `DRAFT` → `PUBLISHED` → `SUPERSEDED`. `ARCHIVED` é terminal e só se alcança de `DRAFT` (rascunho descartado).

### 1.1 `createMatrix(projectId, code, name, xVariableId, yVariableId, templateId?)`

1. Valida unicidade de `code` no projeto.
2. Resolve a `VariableVersion` **PUBLISHED** de cada variável. Se alguma variável não tiver versão publicada → erro `VARIABLE_HAS_NO_PUBLISHED_VERSION`.
3. Cria `MatrixVersion` v1 em `DRAFT`, `baseVersionId = null`.
4. Cria os dois `MatrixAxis` com o pin (`variableVersionId`) e **copia** todos os `VariableDomain` para `MatrixAxisDomain`.
5. Gera o produto cartesiano de células: `|X| × |Y|` registros com `isUnset = true` (ou pré-preenchidos pelo template — §8).
6. Registra evento `DRAFT_CREATED`.

Tudo numa transação.

### 1.2 `createDraftFrom(matrixId)`

1. Exige que exista uma versão `PUBLISHED`; senão erro `NO_PUBLISHED_VERSION_TO_DERIVE`.
2. Se já existir `DRAFT` → erro `DRAFT_ALREADY_EXISTS` (a UI deve oferecer "abrir rascunho existente" ou "descartar e recriar").
3. `versionNumber = max(versionNumber da matriz) + 1`.
4. **Clona integralmente** a versão publicada: axes (mantendo o mesmo pin), axisDomains, cells (todos os atributos, `isUnset` preservado como estava — normalmente `false`).
5. `baseVersionId` = id da versão publicada.
6. Registra `DRAFT_CREATED` com payload `{ baseVersionNumber }`.

O clone **não** atualiza automaticamente para versões novas de variável. A atualização é sempre um ato explícito do usuário (§4).

### 1.3 `publishDraft(versionId, { effectiveFrom?, notes })`

Validações, nesta ordem:

| Checagem | Erro |
|----------|------|
| versão está em `DRAFT` | `VERSION_NOT_DRAFT` |
| zero células com `isUnset = true` | `UNSET_CELLS_REMAIN` (retorna a lista de coordenadas) |
| células cobrem exatamente o cartesiano dos snapshots | `CELL_GRID_INCONSISTENT` |
| `effectiveFrom` (se informado) > `effectiveFrom` da versão vigente | `EFFECTIVE_DATE_NOT_AFTER_CURRENT` |
| ator tem papel EDITOR ou ADMIN | `FORBIDDEN` |

Efeitos, em transação:

1. `effectiveFrom` = valor informado ou `now()`.
2. Versão vigente atual (se houver): `state = SUPERSEDED`, `effectiveTo = effectiveFrom` da nova.
3. Rascunho: `state = PUBLISHED`, `publishedAt = now()`, `publishedById = ator`, `effectiveTo = null`.
4. Eventos `SUPERSEDED` (na antiga) e `PUBLISHED` (na nova, com resumo do diff calculado contra a antiga — §5).

**Publicação retroativa não é permitida no MVP.** `effectiveFrom` no passado é rejeitado. Agendamento futuro é permitido: se `effectiveFrom > now()`, a versão fica `PUBLISHED` mas a consulta de vigência por data continua correta, pois é sempre baseada no intervalo, nunca no estado.

### 1.4 `discardDraft(versionId)`

`state = ARCHIVED`, `archivedAt = now()`, evento `DRAFT_DISCARDED`. Nada é apagado fisicamente; o `versionNumber` **é queimado** (a próxima versão pula o número). Isso é intencional: o número de versão nunca é reutilizado.

### 1.5 Imutabilidade

Qualquer service que altere `cells`, `axes` ou `axisDomains` deve chamar antes `assertVersionEditable(versionId)`, que lança `VERSION_IMMUTABLE` se o estado não for `DRAFT`. Esta é a guarda mais importante do sistema — teste dedicado obrigatório.

## 2. Edição de células

### 2.1 Operação de patch

A unidade de escrita é uma **operação em lote**:

```ts
type CellPatch = {
  coords: Array<{ x: string; y: string }>;
  set: {
    decisionItemId?: string | null;
    offerItemId?: string | null;
    limitItemId?: string | null;
    limitOverride?: string | null;   // decimal como string
    colorOverride?: string | null;
    note?: string | null;
    attributes?: Record<string, unknown>;
  };
};
```

Semântica: chave **ausente** = não mexe; chave com `null` = limpa. Isso permite "atribuir Oferta 8 a 50 células" sem tocar nas decisões delas.

`isUnset` é recalculado a cada patch: passa a `false` assim que `decisionItemId` estiver preenchido. A decisão é o campo mínimo obrigatório de uma célula — oferta e limite são opcionais.

`attributes` faz **merge raso**; chave com valor `null` remove a chave.

### 2.2 Validações

- Todas as coordenadas devem existir na versão → senão `CELL_NOT_FOUND`.
- `decisionItemId` deve apontar para `CatalogItem` de `kind = DECISION` e não arquivado. Idem para offer/limit → senão `CATALOG_KIND_MISMATCH`.
- `colorOverride` deve casar `^#[0-9A-Fa-f]{6}$`.
- Limite de 2.000 coordenadas por patch → senão `PATCH_TOO_LARGE`.

### 2.3 Auditoria

Cada patch aplicado gera **um** evento `CELLS_UPDATED` com payload:

```json
{ "cellCount": 12, "fields": ["offerItemId"], "before": [{"x":"R1","y":"SEM","offerItemId":"..."}], "after": [...] }
```

Guardar before/after apenas dos campos tocados, no máximo 500 células por evento (acima disso, gravar só a contagem e os campos).

## 3. Cor da célula

Prioridade de resolução, do mais forte ao mais fraco:

1. `cell.colorOverride`
2. `decisionItem.color`
3. `offerItem.color`
4. cinza neutro `#E5E7EB` (célula preenchida sem cor definida)
5. hachura diagonal + `#F3F4F6` quando `isUnset = true`

Cor do texto: preto se a luminância relativa do fundo > 0.55, senão branco (`src/lib/colors.ts`).

A célula sempre exibe o `shortLabel` da decisão além da cor — cor nunca é o único portador de informação.

## 4. Evolução de variáveis e reconciliação

Este é o mecanismo que preserva o lastro.

### 4.1 Versionar uma variável

`createVariableDraft(variableId)` clona a versão publicada em um `DRAFT`. O usuário edita domínios (adiciona R6, renomeia, reordena, remove). `publishVariableVersion` valida as invariantes I8/I9 e promove: nova versão vira `PUBLISHED`, anterior vira `SUPERSEDED`.

**Nada acontece com as matrizes.** Elas continuam apontando para o pin antigo. Isso é o comportamento correto e desejado.

### 4.2 Detecção de defasagem

Para qualquer `MatrixAxis`, o eixo está **defasado** quando:

```
axis.variableVersion.state != 'PUBLISHED'
```

A UI mostra o badge "variável desatualizada" apenas em versões `DRAFT`. Em versões publicadas ou superseded, o badge não aparece — elas são registro histórico, não pendência.

### 4.3 `previewResnapshot(versionId, axisRole)`

Retorna, sem gravar nada, o plano de reconciliação comparando o snapshot atual com os domínios da `VariableVersion` publicada, casando por `code`:

```ts
type ResnapshotPlan = {
  fromVersionNumber: number;
  toVersionNumber: number;
  addedDomains:    Array<{ code: string; label: string }>;   // gerarão células novas
  removedDomains:  Array<{ code: string; label: string; affectedCells: number }>;
  relabeledDomains: Array<{ code: string; from: string; to: string }>;
  reorderedDomains: Array<{ code: string; from: number; to: number }>;
  newCellCount: number;
  droppedCellCount: number;
};
```

### 4.4 `applyResnapshot(versionId, axisRole, { onRemoved })`

Só é permitido em versão `DRAFT`. Em transação:

1. Atualiza `axis.variableVersionId` para o novo pin.
2. Recria `MatrixAxisDomain` a partir dos novos domínios (mantendo `id` quando o `code` já existia, para não invalidar nada).
3. Para cada domínio **adicionado**: cria as células do novo cruzamento com `isUnset = true`.
4. Para cada domínio **removido**: as células correspondentes são **excluídas** e seu conteúdo vai integralmente para o payload do evento (é o único delete físico do sistema, e o dado sobrevive na auditoria).
5. Domínios renomeados/reordenados: célula preservada, label e position atualizados.
6. Evento `AXIS_RESNAPSHOTTED` com o plano aplicado.

`onRemoved` no MVP aceita apenas `'delete'`. O parâmetro existe para permitir `'archive'` numa fase futura sem quebrar a assinatura.

Após o resnapshot, o rascunho fica bloqueado para publicação até que todas as células novas sejam preenchidas (I6). É exatamente o comportamento pedido: "o usuário decide como tratar as novas células geradas".

### 4.5 Matriz de propagação

| Ação na biblioteca | Versão PUBLISHED da matriz | Rascunho existente | Rascunhos futuros |
|--------------------|---------------------------|--------------------|-------------------|
| Nova versão da variável publicada | inalterada, sempre | inalterado; ganha badge | herda o pin do publicado; badge |
| Item de catálogo renomeado | **reflete** o novo label | reflete | reflete |
| Item de catálogo arquivado | continua exibindo (com marca "arquivado") | idem, e não pode ser atribuído a novas células | idem |

**Nota deliberada:** rótulos de catálogo (oferta/decisão/limite) são referências vivas, não snapshot. Renomear "Oferta 8" para "Oferta 8 — Renda Alta" muda a exibição em versões antigas. Isso é aceito porque é uma correção de nomenclatura, não de política. Mudar o **significado** de uma oferta exige criar um item novo — isso deve estar escrito na UI, ao lado do botão de editar catálogo.

## 5. Diff entre versões

`diffVersions(versionAId, versionBId)` — A é a base (mais antiga), B a comparada.

### 5.1 Diff de eixos

```ts
type AxisDiff = {
  role: 'X' | 'Y';
  variableChanged: boolean;                 // trocou a variável inteira
  pinChanged: { from: number; to: number } | null;
  addedDomains: string[];
  removedDomains: string[];
  relabeledDomains: Array<{ code: string; from: string; to: string }>;
};
```

Se `variableChanged` for true em qualquer eixo, o diff de células é reportado como **estruturalmente incomparável**: mostra os dois grids lado a lado, sem tentar casar células.

### 5.2 Diff de células

Chave de casamento: `(xCode, yCode)`.

```ts
type CellChange =
  | { kind: 'ADDED';    x: string; y: string; after: CellSnapshot }
  | { kind: 'REMOVED';  x: string; y: string; before: CellSnapshot }
  | { kind: 'MODIFIED'; x: string; y: string; before: CellSnapshot; after: CellSnapshot;
      fields: Array<'decision' | 'offer' | 'limit' | 'color' | 'note'> };
```

Células idênticas não entram no resultado.

### 5.3 Resumo semântico

Além da contagem bruta, gerar o resumo que o usuário pediu:

| Métrica | Definição |
|---------|-----------|
| Células abertas | decisão mudou de não-aprovadora (`REPROVADO`) para `APROVADO` ou `EXCECAO` |
| Células fechadas | decisão mudou de aprovadora para `REPROVADO` |
| Enviadas para análise | decisão mudou para `ANALISE_MANUAL` |
| Ofertas alteradas | `offerItemId` mudou (ignorando as já contadas como adicionadas/removidas) |
| Limites aumentados / reduzidos | comparação do valor efetivo (`limitOverride ?? limitItem.numericValue`) |
| Células adicionadas / removidas | pela estrutura |

A classificação "aprovadora" vem do `code` do `CatalogItem` de decisão: `APROVADO` e `EXCECAO` contam como aprovadoras. Isso fica numa constante em `src/lib/decision-semantics.ts`, comentada como ponto de configuração futura.

### 5.4 Regras de comparação

- Comparar duas versões de **matrizes diferentes** é permitido e útil (PF × PJ), desde que os eixos usem as mesmas variáveis. Senão, incomparável.
- Comparar uma versão consigo mesma retorna diff vazio.
- A ordem importa apenas para o rótulo "antes/depois"; a UI sempre coloca a mais antiga à esquerda.

## 6. Consulta por data de vigência

`getEffectiveVersion(matrixId, at: Date)`:

```sql
SELECT * FROM "MatrixVersion"
WHERE "matrixId" = $1
  AND "state" IN ('PUBLISHED','SUPERSEDED')
  AND "effectiveFrom" <= $2
  AND ("effectiveTo" IS NULL OR "effectiveTo" > $2)
```

Intervalo semiaberto `[from, to)` — na data exata da troca, vale a versão nova. Se não houver resultado, a matriz ainda não existia naquela data: retornar `null` e a UI mostra "sem política vigente em dd/mm/aaaa".

`getPortfolioAt(projectId, at)` faz o mesmo para todas as matrizes do projeto — é a tela "como estava a política inteira em tal data".

## 7. Payloads dos eventos de auditoria

| Tipo | Payload |
|------|---------|
| `DRAFT_CREATED` | `{ baseVersionNumber: number \| null, templateCode?: string }` |
| `DRAFT_DISCARDED` | `{}` |
| `CELLS_UPDATED` | `{ cellCount, fields[], before[], after[] }` (§2.3) |
| `AXIS_RESNAPSHOTTED` | `{ role, fromVersion, toVersion, plan: ResnapshotPlan, deletedCells: CellSnapshot[] }` |
| `PUBLISHED` | `{ effectiveFrom, diffSummary }` |
| `SUPERSEDED` | `{ byVersionNumber, effectiveTo }` |
| `NOTE_ADDED` | `{ text }` |

`summary` é sempre uma frase pronta em pt-BR, ex.: *"Editor alterou a oferta de 12 células"*. A timeline da UI renderiza `summary`; o payload é o detalhe expansível.

## 8. Templates

`instantiateTemplate(templateId, projectId, code, name)` cria a matriz usando `xVariableId`/`yVariableId` do template e aplica os defaults a **todas** as células.

`seedRules` é um array de regras opcionais aplicadas em ordem, a última vencendo:

```json
[
  { "when": { "x": ["R1","R2"] },              "set": { "decisionCode": "APROVADO" } },
  { "when": { "y": ["ALTO"] },                 "set": { "decisionCode": "REPROVADO" } },
  { "when": { "x": ["R1"], "y": ["SEM"] },     "set": { "offerCode": "OFERTA_PREMIUM" } }
]
```

`when` sem `x` significa "todos os X"; idem para `y`. Códigos que não existirem no snapshot são ignorados silenciosamente (a variável pode ter evoluído desde a criação do template) e reportados no resultado como `skippedRules`.

Células cobertas por alguma regra que defina decisão nascem com `isUnset = false`.

## 9. Códigos de erro

`src/lib/errors.ts` define `DomainError { code, message, details? }`. Catálogo estável:

```
FORBIDDEN, NOT_FOUND,
VARIABLE_HAS_NO_PUBLISHED_VERSION, VARIABLE_VERSION_IMMUTABLE,
INVALID_DOMAIN_SET, RANGE_NOT_CONTIGUOUS, BOOLEAN_NEEDS_TWO_DOMAINS,
DRAFT_ALREADY_EXISTS, NO_PUBLISHED_VERSION_TO_DERIVE,
VERSION_NOT_DRAFT, VERSION_IMMUTABLE,
UNSET_CELLS_REMAIN, CELL_GRID_INCONSISTENT, CELL_NOT_FOUND,
CATALOG_KIND_MISMATCH, CATALOG_ITEM_ARCHIVED, LIMIT_NEEDS_NUMERIC_VALUE,
EFFECTIVE_DATE_NOT_AFTER_CURRENT, PATCH_TOO_LARGE,
AXIS_NOT_STALE, VERSIONS_NOT_COMPARABLE,
DUPLICATE_CODE
```

Cada código tem uma mensagem pt-BR em `src/lib/error-messages.ts`. A UI nunca exibe o código cru.
