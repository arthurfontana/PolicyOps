# Camada de Comandos

> Substitui o que seria uma API HTTP. Como não há servidor, o contrato é interno: entre `src/store/` e `src/core/`.

## 1. Contrato

```ts
type Command<I = unknown, O = void> = {
  type: string;
  input: I;
  run(doc: PolicyOpsDocument, ctx: Ctx): CommandResult<O>;
};

type Ctx = { actor: string; now: () => Date; newId: () => string };

type CommandResult<O> =
  | { ok: true; document: PolicyOpsDocument; data: O; events: DocEvent[]; inverse: Command }
  | { ok: false; error: DomainError };
```

Regras invioláveis:

1. **Puro.** Sem `Date.now()`, sem `Math.random()`, sem `window` — tudo vem de `ctx`. É o que torna os testes determinísticos.
2. **Imutável.** Devolve documento novo; nunca muta o recebido.
3. **Inversível.** Todo comando que altera dados devolve o `inverse`. Comandos sem inverso natural (publicar) devolvem um inverso que falha explicitamente, e a interface desabilita o undo neles.
4. **Valida antes de tocar.** Nenhum estado parcial em caso de erro.
5. **Registra.** Todo comando produz seus `DocEvent`.

## 2. Store — `src/store/document-store.ts`

```ts
type DocumentStore = {
  document: PolicyOpsDocument | null;
  dirty: boolean;
  undoStack: Array<{ command: Command; inverse: Command; label: string }>;
  redoStack: Array<{ command: Command; inverse: Command; label: string }>;

  dispatch<O>(command: Command<unknown, O>): CommandResult<O>;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
};
```

- `dispatch` executa, substitui o documento, empilha em `undoStack`, limpa `redoStack`, marca `dirty` e dispara o autosave.
- Profundidade da pilha: **100**. Em memória, não custa quase nada.
- A pilha é limpa ao trocar de documento e **ao salvar? Não** — o undo continua disponível após salvar; o que muda é que desfazer volta a marcar `dirty`.
- Erro de comando **não** altera o documento e não empilha nada.
- Publicar limpa a pilha de undo daquela versão, e a interface avisa antes.

## 3. Catálogo de comandos

### Documento
| Comando | Entrada |
|---|---|
| `document/create` | `{ name }` |
| `document/rename` | `{ name, description? }` |
| `document/merge` | `{ theirs, resolutions }` |

### Biblioteca de variáveis
| Comando | Entrada |
|---|---|
| `variable/create` | `{ code, name, type, description? }` |
| `variable/updateMeta` | `{ variableId, name?, description? }` |
| `variable/createDraft` | `{ variableId }` |
| `variable/saveDomains` | `{ variableId, versionId, domains, groupingDimensions?, boundaryMode? }` — `groupingDimensions` só para `RANGE` (`05-regras-de-negocio.md` §5.6.1) |
| `variable/publish` | `{ variableId, versionId, notes? }` |
| `variable/discardDraft` | `{ variableId, versionId }` |
| `variable/archive` | `{ variableId }` — falha se em uso por versão publicada |
| `variable/duplicate` | `{ sourceVariableId, sourceVersionId, code, name, description? }` — cria variável nova com v1 `DRAFT` copiando domínios (cor inclusive) e `groupingDimensions` da origem (§5.6.5) |

### Biblioteca de compatibilidade
| Comando | Entrada |
|---|---|
| `compat/create` | `{ code, name, parentVariableId, childVariableId }` |
| `compat/createDraft` | `{ ruleId }` |
| `compat/saveMap` | `{ ruleId, versionId, allow, defaultForUnlisted }` |
| `compat/publish` | `{ ruleId, versionId, notes? }` |
| `compat/discardDraft` | `{ ruleId, versionId }` |
| `compat/archive` | `{ ruleId }` |

### Catálogo
| Comando | Entrada |
|---|---|
| `catalog/create` | `{ kind, code, label, description?, color?, numericValue?, group? }` — `group` só tem efeito em `kind: 'TAG'` |
| `catalog/update` | `{ id, label?, description?, color?, numericValue?, group? }` — idem |
| `catalog/archive` | `{ id }` |
| `catalog/reorder` | `{ kind, orderedIds }` |

### Projetos e matrizes
| Comando | Entrada |
|---|---|
| `project/create` · `project/update` · `project/archive` | — |
| `matrix/create` | `{ projectId, code, name, x, y, templateId? }` |
| `matrix/updateMeta` | `{ matrixId, name?, description? }` |
| `matrix/setTags` | `{ matrixId, add?: string[], remove?: string[] }` — codes de `CatalogItem` de kind `TAG`; idempotente, valida I20 |
| `matrix/archive` | `{ matrixId }` |

### Carga de matrizes
| Comando | Entrada | Inverso |
|---|---|---|
| `import/apply` | `{ profile, table, fileName?, planHash, selectedKeys, restoreKeys?, notes }` — aplica o plano revisado: cria matrizes novas e rascunhos só nas alteradas, e desarquiva as matrizes de `restoreKeys` antes de tudo (`12-carga-de-matrizes.md` §5.4, DEC-CARGA-018) | descartar os rascunhos e matrizes criados, e rearquivar as restauradas |
| `importProfile/save` | `{ profile }` — cria ou atualiza pelo `code` | restaura o perfil anterior |
| `importProfile/delete` | `{ profileId }` | recria o perfil |

`import/apply` é o único comando do catálogo que produz **vários** eventos de matrizes diferentes numa transação só. Ele valida tudo antes de tocar no documento (§1, regra 4): recalcula o plano, compara com `planHash` e falha inteiro em caso de divergência (`IMPORT_PLAN_STALE`) — nunca aplica metade do lote.

Ele não reimplementa nada: **compõe** os comandos acima sobre um documento de trabalho, na ordem `matrix/create` → `axis/suppressTuples` → `version/applyCellPatches` → `matrix/setTags` para cada matriz nova, e `version/createDraft` → `version/applyCellPatches` → `matrix/setTags` para cada alterada — com um passo extra à frente, para a matriz arquivada de `restoreKeys`: desarquiva (mesmo comando interno que `matrix/archive` desfaz) antes de qualquer um dos passos acima (DEC-CARGA-018). Uma matriz arquivada e restaurada que **nunca** teve versão publicada segue o caminho de matriz nova, mas trocando `matrix/create` pelo comando interno `version/_createWithoutBase` (mesma projeção de eixos frescos de `matrix/create`, sem criar um `Matrix` novo — o código já está reservado) — nunca `version/createDraft`, que exige uma versão existente para derivar (DEC-CARGA-019). A atomicidade sai da imutabilidade (§1, regra 2): um `DomainError` no meio do lote propaga para fora de `execute`, e o documento **recebido** é devolvido intocado. Saída: `{ importRunId, createdMatrices, createdDrafts, ignoredByUser, restoredMatrices }`. O `importRunId` é carimbado no payload de todo `MATRIX_CREATED`, `DRAFT_CREATED` e `CELLS_UPDATED` da rodada, e um evento `IMPORT_RUN` registra o perfil, o arquivo, o hash, as contagens por estado (inclusive quantas matrizes foram restauradas) e a nota da carga.

`import/apply` **nunca publica** (RN-10): o inverso descarta os rascunhos criados e remove as matrizes criadas, na ordem contrária, e o log de eventos não é rebobinado — ele é append-only (§2).

### Versões
| Comando | Entrada | Inverso |
|---|---|---|
| `version/createDraft` | `{ matrixId, baseVersionId? }` | descartar o rascunho criado |
| `version/applyCellPatch` | `{ versionId, patch }` | patch inverso |
| `version/publish` | `{ versionId, effectiveFrom?, notes }` | **sem inverso** |
| `version/discardDraft` | `{ versionId }` | **sem inverso** |
| `version/addNote` | `{ versionId, text }` | — |

### Eixos
| Comando | Entrada | Inverso |
|---|---|---|
| `axis/addLevel` | `{ versionId, role, variableId, position, onExisting }` | remover o nível, restaurando células |
| `axis/removeLevel` | `{ versionId, role, levelIndex, onCollapse }` | readicionar com as células do payload |
| `axis/reorderLevels` | `{ versionId, role, from, to }` | reordenação inversa |
| `axis/resnapshot` | `{ versionId, role }` | restaura snapshot e células anteriores |
| `axis/suppressTuples` | `{ versionId, role, paths }` | restaurar tuplas e células |
| `axis/restoreTuples` | `{ versionId, role, paths }` | suprimir de novo |

Comandos de eixo guardam no inverso **todas** as células afetadas — é o que permite desfazer uma remoção de nível sem perda.

### Templates
`template/create` · `template/update` · `template/archive` · `template/instantiate`

### Componentes de política (schema 5, sessão 32a)
| Comando | Entrada | Inverso |
|---|---|---|
| `component/create` | `{ projectId, code, name, type, parentId?, matrixId?, variableId?, tags?, origin?, reviewStatus? }` — entra no fim dos irmãos; valida I27/I28 e recusa `code` repetido com `COMPONENT_CODE_DUPLICATE` (`E-GOV-06`) | remover o nó criado e reindexar os irmãos; recusa se ele já ganhou filho ou versão |
| `component/update` | `{ componentId, name?, tags?, origin?, variableId? }` — três estados nos opcionais (ausente = não mexe, `null` = apaga). **Não aceita `code` nem `type`** | o próprio comando com os valores anteriores |
| `component/move` | `{ componentId, parentId?, position? }` — `parentId: null` vira raiz; valida ciclo e profundidade (contando a altura da subárvore) e reindexa origem e destino | mover de volta ao pai e à posição de origem |
| `component/archive` | `{ componentId }` | `component/_setArchived` com o carimbo anterior |
| `component/setReviewStatus` | `{ componentId, reviewStatus }` — promover a `VALIDATED` é ação explícita, nunca efeito de editar | o próprio comando com o estado anterior |

### Versões de componente (schema 5, sessão 32a)
| Comando | Entrada | Inverso |
|---|---|---|
| `componentVersion/createDraft` | `{ componentId, baseVersionId?, payload?, spec?, changeRequestId? }` — clona a publicada vigente; `payload` é obrigatório na primeira versão e vence a base quando os dois vêm | apagar o rascunho criado |
| `componentVersion/update` | `{ versionId, payload?, spec?, changeRequestId? }` — só em rascunho (`VERSION_IMMUTABLE`) | o próprio comando com os valores anteriores |
| `componentVersion/publish` | `{ versionId, effectiveFrom }` — vigência **obrigatória** e podendo ser retroativa (RN-GOV-09) | **sem inverso** |
| `componentVersion/discardDraft` | `{ versionId }` — remove a versão da lista | restaura o rascunho na mesma posição |

Três diferenças em relação aos comandos de matriz, todas ditadas pelo contrato de
`03-modelo-do-documento.md` §12.1 — e nenhuma por conveniência:

1. `componentVersion/publish` **exige** `effectiveFrom` (em matriz ele é opcional e cai em "agora")
   e **aceita data retroativa**, que é o caminho da fundação da política (RN-GOV-09). A ordem
   continua valendo: a vigência nova precisa começar depois da vigente (`EFFECTIVE_DATE_INVALID`).
2. `componentVersion/publish` **não pede nota** — quem carrega o "por quê" é o DB (`changeRequestId`)
   ou a marca de publicação direta na timeline (RN-GOV-07).
3. `componentVersion/discardDraft` **tem inverso**: sem estado `ARCHIVED` no contrato, a versão sai
   inteira da lista e o número volta a ficar livre, então desfazer é devolver o mesmo registro.

Nenhum comando desta sessão escreve `changeRequests` ou `releases`: `changeRequestId` é aceito e
preservado, e quem o preenche é a S32b.

### Papéis
| Comando | Entrada | Inverso |
|---|---|---|
| `acl/set` | `{ acl: Acl \| null }` — substitui `meta.acl` inteira; `null` volta ao modo aberto. Recusa (`ACL_REQUIRES_ADMIN`) se a lista resultante tiver `users` não vazio sem nenhum `ADMIN` | o próprio comando com a ACL anterior |

`acl/set` gera `ACL_CHANGED` só quando `before` e `after` diferem (mesmo padrão de "nada mudou, sem evento" de `matrix/setTags`). Papel mínimo `ADMIN` — com a exceção estreita de §6 abaixo.

## 4. Consultas (puras, sem comando)

Funções de leitura em `src/core/`, chamadas direto pelos componentes:

| Função | Retorno |
|---|---|
| `getEditorView(doc, versionId)` | tudo que o grid precisa: eixos, layout de cabeçalhos, células, catálogo, estatísticas, defasagem |
| `listMatrixVersions(doc, matrixId)` | histórico com estados, vigências e autores |
| `getVersionEvents(doc, versionId)` | auditoria ordenada |
| `diffVersions(doc, aId, bId)` | `VersionDiff` |
| `getEffectiveVersion(doc, matrixId, at)` | versão vigente ou `null` |
| `getPortfolioAt(doc, projectId, at)` | matrizes com a versão vigente |
| `listVariables(doc, filtro)` | variáveis com contagem de uso |
| `getVariableUsage(doc, variableId)` | quem pina cada versão |
| `parseDomainTable(text)` | `{ domains, groupingDimensions, columns, warnings, errors }` — traduz texto colado (TSV, tabela tidy genérica) em domínios prontos para `variable/saveDomains`; não toca no documento (`05-regras-de-negocio.md` §5.6.2) |
| `mergeImportedDomains(existingDomains, parsed)` | `Domain[]` — combina o resultado de `parseDomainTable` com os domínios já existentes na tela, preservando campos que a colagem não trouxe coluna para atualizar (`05-regras-de-negocio.md` §5.6.3) |
| `suggestPaletteColors(domains, paletteId)` | `Domain[]` — aplica a cor de uma paleta oficial (`05-regras-de-negocio.md` §5.6.4) aos domínios cujo código/rótulo bate; não toca no documento |
| `getStaleAxes(doc)` | todos os rascunhos com eixo defasado |
| `countPending(doc, versionId)` | combinações sem decisão |
| `parseDelimitedTable(text, format?)` | `{ format, header, rows, warnings, errors }` — texto CSV/TSV em tabela, com detecção de separador, BOM e cabeçalho (`12-carga-de-matrizes.md` §5.4) |
| `resolveImport(doc, table, profile)` | `{ rows: ResolvedRow[]; issues }` — aplica o perfil: cada linha vira matriz de destino, `xPath`, `yPath` e célula |
| `planImport(doc, table, profile, opts?)` | `ImportPlan` — estado por matriz, diff de células e totais. **Dry-run puro**, não toca no documento |
| `nearestImportProfile(doc, header)` | `HeaderComparison \| undefined` — o perfil salvo mais próximo de um cabeçalho que nenhum reconheceu, com a diferença coluna a coluna (RN-19, CT-12). Nunca aplica perfil por semelhança |
| `listImportRuns(doc)` | `ImportRunSummary[]` — as cargas aplicadas, da mais recente para a mais antiga, lidas dos eventos `IMPORT_RUN` |
| `getImportOrigin(doc, versionId)` | `ImportRunSummary \| null` — a carga que criou aquele rascunho, ou `null` se ele nasceu à mão |
| `matchImportProfile(doc, header)` | `ImportProfile \| null` — perfil salvo cujo `signature` é idêntico ao cabeçalho lido |
| `listMatrices(doc, { projectId?, tags?, search? })` | `{ matrices, facets }` — matrizes filtradas por facetas de tag (`E` entre grupos, `OU` dentro do grupo) e, em `facets`, a contagem por tag calculada sobre o conjunto antes do filtro do próprio grupo (comportamento padrão de faceta); tag arquivada não aparece em `facets` |

`getEditorView` é memoizada por `(versionId, revisão do documento)` — recalcular o layout de cabeçalhos a cada render de célula é o erro de desempenho mais provável do projeto.

## 5. Formato canônico de exportação

Estável, versionado, base de uma futura importação:

```json
{
  "schemaVersion": 1,
  "matrix": { "code": "MTZ_LIMITE_PJ", "name": "Matriz de Limite PJ", "project": "POLITICA_PJ" },
  "version": { "number": 12, "state": "PUBLISHED",
               "effectiveFrom": "2026-03-01T00:00:00.000Z", "effectiveTo": null },
  "axes": {
    "x": { "levels": [{ "variable": "SCORE_HVI3", "variableVersion": 2 }],
           "tuples": ["R1", "R2"] },
    "y": { "levels": [{ "variable": "SEGMENTO", "variableVersion": 1 },
                      { "variable": "FAT", "variableVersion": 3 }],
           "tuples": ["VAREJO|ATE_100K", "VAREJO|100K_500K"] }
  },
  "cells": [
    { "x": "R1", "y": "VAREJO|ATE_100K", "decision": "APROVADO",
      "offer": "OFERTA_PREMIUM", "limit": "LIM_5000", "limitValue": "5000.00" }
  ]
}
```

**CSV**: uma linha por combinação, com **uma coluna por nível** de cada eixo — é o que torna o arquivo utilizável numa tabela dinâmica do Excel:

```
x_SCORE_HVI3;y_SEGMENTO;y_FAT;decisao;oferta;limite;limite_valor;cor;observacao
R1;Varejo;até 100k;Aprovado;Oferta Premium;LIM_5000;5000,00;#16A34A;
```

Separador `;`, decimal com vírgula, UTF-8 **com BOM** — sem isso o Excel em português abre errado.

## 6. Papéis mínimos por comando (gate do dispatcher, sessão 29)

`src/store/document-store.ts#dispatch` (não `execute`, nem `undo`/`redo` — ver a nota no fim desta
seção) checa o papel efetivo **antes** de rodar o comando: `resolveRole(document, identity.username)`
contra `minRoleForCommand(command.type)`, os dois em `src/core/document/roles.ts`
(`docs/14-plataforma-local.md` §6, ADR-003). Sem papel suficiente, `dispatch` devolve
`{ ok: false, error }` com `DomainError('ROLE_REQUIRED', …)` — o comando **nunca roda**, documento e
pilhas de undo ficam intocados, igual a qualquer outro erro de comando (§1 regra 4).

| Papel mínimo | Comandos |
|---|---|
| `EDITOR` (piso padrão) | Todo comando de rascunho, biblioteca (variáveis, compatibilidade, catálogo), tags, eixos, projetos, templates e perfis de carga — qualquer `command.type` fora das duas linhas abaixo |
| `PUBLISHER` | `version/publish`, `import/apply`, `matrix/archive`, `componentVersion/publish`, `component/archive` |
| `ADMIN` | `acl/set` |

Notas:

- **Comandos internos** (prefixo `_`, ex. `catalog/_removeCreated`) nunca são despachados pela
  interface — só aparecem como `inverse` de undo/redo, que chamam `execute` diretamente. Por isso o
  gate não precisa (e não tenta) classificá-los: `minRoleForCommand` de um tipo desconhecido cai no
  piso `EDITOR`, mas isso nunca é exercitado na prática.
- **Undo/redo não passam pelo gate.** Reaplicar o inverso de um comando que o próprio usuário já
  tinha permissão de disparar não deveria ficar bloqueado por uma ACL editada nesse meio-tempo — o
  gate é sobre o que entra pela interface, não sobre desfazer o que já entrou.
- **Bootstrap da ACL**: `acl/set` tem uma exceção estreita — em "modo aberto" (`isOpenMode(document)`,
  `14-plataforma-local.md` §6: ACL ausente, vazia, ou populada sem nenhum `ADMIN`), o gate libera
  `acl/set` mesmo com o papel efetivo em `PUBLISHER`. Sem isso, ninguém jamais poderia criar o
  primeiro `ADMIN` — "o controle liga quando um ADMIN é definido" precisa de alguém que ligue.
- O servidor local **não reavalia nada disto por comando** (ADR-002): `PUT /api/document` só recusa
  o caso grosso de papel efetivo `READER` (`14-plataforma-local.md` §4). A tabela acima é inteiramente
  responsabilidade do front.
