# Contratos de API

Escrita via **Server Actions** (`src/server/actions/`), leitura via **Server Components** chamando services diretamente. Route Handlers em `src/app/api/` existem apenas para: export de arquivos, e a API de leitura pública interna (§4).

Toda action segue o mesmo formato:

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: DomainErrorCode; message: string; details?: unknown };
```

E o mesmo esqueleto:

```ts
export async function nomeDaAction(input: unknown): Promise<ActionResult<Saida>> {
  return withAction(async () => {
    const user = await requireRole('EDITOR');
    const data = schemaDaAction.parse(input);
    const result = await algumService.faz(data, user);
    revalidatePath(`/projects/${data.projectId}`);
    return result;
  });
}
```

`withAction` captura `DomainError` e `ZodError` e converte para `{ ok: false }`. Nunca deixa exceção vazar para o cliente.

## 1. Actions por domínio

### Variáveis (`variable-actions.ts`)

| Action | Papel | Entrada | Saída |
|--------|-------|---------|-------|
| `createVariable` | EDITOR | `{ code, name, type, description? }` | `{ variableId, versionId }` (cria v1 DRAFT vazia) |
| `updateVariableMeta` | EDITOR | `{ variableId, name?, description? }` | `{ variableId }` |
| `createVariableDraft` | EDITOR | `{ variableId }` | `{ versionId }` |
| `saveVariableDomains` | EDITOR | `{ versionId, domains: DomainInput[] }` | `{ versionId }` (substitui o conjunto inteiro) |
| `publishVariableVersion` | EDITOR | `{ versionId, notes? }` | `{ versionId, versionNumber }` |
| `discardVariableDraft` | EDITOR | `{ versionId }` | `{ ok }` |
| `archiveVariable` | ADMIN | `{ variableId }` | `{ ok }` — falha se em uso em versão vigente |

`DomainInput`: `{ code, label, shortLabel?, position, color?, rangeMin?, rangeMax?, minInclusive?, maxInclusive?, isCatchAll? }`.

### Catálogo (`catalog-actions.ts`)

| Action | Papel | Entrada |
|--------|-------|---------|
| `createCatalogItem` | EDITOR | `{ kind, code, label, description?, color?, numericValue? }` |
| `updateCatalogItem` | EDITOR | `{ id, label?, description?, color?, numericValue?, position? }` |
| `archiveCatalogItem` | EDITOR | `{ id }` |
| `reorderCatalogItems` | EDITOR | `{ kind, orderedIds: string[] }` |

### Projetos e matrizes (`matrix-actions.ts`)

| Action | Papel | Entrada | Saída |
|--------|-------|---------|-------|
| `createProject` | EDITOR | `{ slug, name, description? }` | `{ projectId }` |
| `updateProject` | EDITOR | `{ projectId, name?, description? }` | `{ projectId }` |
| `archiveProject` | ADMIN | `{ projectId }` | `{ ok }` |
| `createMatrix` | EDITOR | `{ projectId, code, name, description?, xVariableId, yVariableId }` | `{ matrixId, versionId }` |
| `createMatrixFromTemplate` | EDITOR | `{ projectId, code, name, templateId }` | `{ matrixId, versionId, skippedRules }` |
| `updateMatrixMeta` | EDITOR | `{ matrixId, name?, description? }` | `{ matrixId }` |
| `archiveMatrix` | ADMIN | `{ matrixId }` | `{ ok }` |

### Versões (`version-actions.ts`)

| Action | Papel | Entrada | Saída |
|--------|-------|---------|-------|
| `createDraft` | EDITOR | `{ matrixId }` | `{ versionId, versionNumber }` |
| `applyCellPatch` | EDITOR | `{ versionId, patch: CellPatch }` | `{ updatedCount, invert: CellPatch }` |
| `publishDraft` | EDITOR | `{ versionId, effectiveFrom?, notes? }` | `{ versionId, versionNumber, effectiveFrom, diffSummary }` |
| `discardDraft` | EDITOR | `{ versionId }` | `{ ok }` |
| `addVersionNote` | EDITOR | `{ versionId, text }` | `{ eventId }` |

`applyCellPatch` **retorna o patch inverso** — é o que alimenta o undo do cliente sem cálculo duplicado.

### Reconciliação (`reconcile-actions.ts`)

| Action | Papel | Entrada | Saída |
|--------|-------|---------|-------|
| `previewResnapshot` | VIEWER | `{ versionId, role }` | `ResnapshotPlan` |
| `applyResnapshot` | EDITOR | `{ versionId, role }` | `{ plan, newCellCount, droppedCellCount }` |

### Templates (`template-actions.ts`)

`createTemplate`, `updateTemplate`, `archiveTemplate`, `previewTemplate({ templateId })` → grid resultante sem gravar.

## 2. Funções de leitura (services chamados por Server Components)

| Função | Retorno |
|--------|---------|
| `getMatrixVersionForEditor(versionId)` | versão + eixos + snapshots ordenados + todas as células + catálogo relevante + flags de defasagem. **Uma única query montada**, não N+1 |
| `listMatrixVersions(matrixId)` | histórico com estados, vigências, autores e resumo de eventos |
| `getVersionTimeline(versionId)` | eventos de auditoria ordenados |
| `diffVersions(aId, bId)` | `VersionDiff` (ver `04-regras-de-negocio.md` §5) |
| `getEffectiveVersion(matrixId, at)` | versão vigente na data ou `null` |
| `getPortfolioAt(projectId, at)` | lista de matrizes com a versão vigente |
| `listVariables({ search?, type? })` | variáveis + contagem de uso |
| `getVariableUsage(variableId)` | matrizes/versões que pinam cada versão |

## 3. Formato do payload do editor

```ts
type EditorPayload = {
  matrix:  { id, code, name, projectId, projectName };
  version: { id, versionNumber, state, notes, effectiveFrom, effectiveTo,
             createdBy, publishedBy, isEditable: boolean };
  axes: {
    x: AxisPayload;
    y: AxisPayload;
  };
  cells: Array<{
    x: string; y: string;
    decisionItemId: string | null;
    offerItemId: string | null;
    limitItemId: string | null;
    limitOverride: string | null;
    colorOverride: string | null;
    note: string | null;
    attributes: Record<string, unknown>;
    isUnset: boolean;
  }>;
  catalog: { decisions: CatalogItemDTO[]; offers: CatalogItemDTO[]; limits: CatalogItemDTO[] };
  stats: { total: number; filled: number; unset: number; byDecision: Record<string, number> };
};

type AxisPayload = {
  role: 'X' | 'Y';
  label: string;
  variable: { id, code, name, type };
  pinnedVersion: { id, versionNumber, state };
  isStale: boolean;                 // pinnedVersion.state !== 'PUBLISHED'
  domains: Array<{ code, label, shortLabel, position, color, rangeMin, rangeMax, isCatchAll }>;
};
```

Células são transmitidas como **array plano**, nunca matriz aninhada — a UI indexa por `"${x}::${y}"`.

Decimais viajam como **string** (`"2000.00"`), nunca `number`. Conversão para exibição na borda da UI.

## 4. Route Handlers

| Rota | Método | Descrição |
|------|--------|-----------|
| `/api/versions/[versionId]/export?format=csv\|json` | GET | Exporta a versão. CSV com uma linha por célula, JSON no formato canônico de intercâmbio |
| `/api/compare/export?a=&b=&format=csv` | GET | Exporta a lista de mudanças |
| `/api/matrices/[matrixId]/effective?at=ISO` | GET | JSON da versão vigente na data — endpoint pensado para consumo por scripts internos |
| `/api/health` | GET | `{ ok: true, db: 'up' }` |

Todos exigem sessão autenticada. Exportação PNG é feita no cliente (`html-to-image` sobre o nó do grid), não no servidor.

## 5. Formato canônico de intercâmbio (JSON)

Usado no export e será a base de uma futura importação. Estável — versionado por `schemaVersion`.

```json
{
  "schemaVersion": 1,
  "matrix": { "code": "MTZ_LIMITE_PF", "name": "Matriz de Limite PF", "project": "politica-pf" },
  "version": { "number": 12, "state": "PUBLISHED", "effectiveFrom": "2026-03-01T00:00:00Z", "effectiveTo": null },
  "axes": {
    "x": { "variable": "SCORE_HVI3", "variableVersion": 2,
           "domains": [{ "code": "R1", "label": "R1" }] },
    "y": { "variable": "RESTRITIVO", "variableVersion": 1,
           "domains": [{ "code": "SEM", "label": "Sem restritivo" }] }
  },
  "cells": [
    { "x": "R1", "y": "SEM", "decision": "APROVADO", "offer": "OFERTA_PREMIUM",
      "limit": "LIM_5000", "limitValue": "5000.00", "note": null }
  ]
}
```
