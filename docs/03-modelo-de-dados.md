# Modelo de Dados

> O schema abaixo é **normativo e literal**. A Sessão 02 deve transcrevê-lo para `prisma/schema.prisma` sem inventar campos, sem renomear e sem "melhorar".

## 1. Diagrama conceitual

```
Project ──< Matrix ──< MatrixVersion ──< MatrixAxis ──< MatrixAxisDomain   (snapshot congelado)
                            │                 │
                            │                 └─ referencia (pin) → VariableVersion
                            ├──< MatrixCell
                            └──< MatrixVersionEvent          (auditoria)

Variable ──< VariableVersion ──< VariableDomain              (biblioteca viva)

CatalogItem  (OFFER | DECISION | LIMIT | TAG)                (biblioteca de conteúdo)

Template                                                     (ponto de partida)
```

**A regra que sustenta tudo:** `MatrixAxisDomain` é uma **cópia** de `VariableDomain`, não uma referência. `MatrixAxis.variableVersionId` guarda de onde a cópia veio (o "pin"). A biblioteca pode evoluir sem jamais alterar o que já foi publicado.

## 2. Schema Prisma

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─────────────────────────── Enums ───────────────────────────

enum UserRole {
  VIEWER
  EDITOR
  ADMIN
}

/// ORDINAL     : domínios com ordem semântica (R1..R6)
/// CATEGORICAL : domínios sem ordem (Sem/Baixo/Médio/Alto tratados como rótulos)
/// RANGE       : faixas numéricas contíguas (renda, tempo de empresa)
/// BOOLEAN     : exatamente dois domínios
enum VariableType {
  ORDINAL
  CATEGORICAL
  RANGE
  BOOLEAN
}

enum VariableVersionState {
  DRAFT
  PUBLISHED
  SUPERSEDED
}

enum CatalogKind {
  OFFER
  DECISION
  LIMIT
  TAG
}

/// DRAFT      : editável, no máximo 1 por matriz
/// PUBLISHED  : vigente, exatamente 0 ou 1 por matriz, imutável
/// SUPERSEDED : já foi vigente, imutável, consultável pelo histórico
/// ARCHIVED   : rascunho descartado ou versão retirada
enum MatrixVersionState {
  DRAFT
  PUBLISHED
  SUPERSEDED
  ARCHIVED
}

enum AxisRole {
  X
  Y
}

enum MatrixEventType {
  DRAFT_CREATED
  DRAFT_DISCARDED
  CELLS_UPDATED
  AXIS_RESNAPSHOTTED
  PUBLISHED
  SUPERSEDED
  NOTE_ADDED
}

// ─────────────────────────── Usuários ───────────────────────────

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  role         UserRole @default(EDITOR)
  archivedAt   DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  createdVersions   MatrixVersion[] @relation("VersionCreatedBy")
  publishedVersions MatrixVersion[] @relation("VersionPublishedBy")
  events            MatrixVersionEvent[]
}

// ─────────────────── Biblioteca de Variáveis ───────────────────

model Variable {
  id          String       @id @default(cuid())
  code        String       @unique          // SCORE_HVI3
  name        String                        // Score HVI3
  description String?
  type        VariableType
  archivedAt  DateTime?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  versions VariableVersion[]
  axes     MatrixAxis[]
  templatesX Template[] @relation("TemplateVariableX")
  templatesY Template[] @relation("TemplateVariableY")

  @@index([archivedAt])
}

model VariableVersion {
  id            String               @id @default(cuid())
  variableId    String
  versionNumber Int
  state         VariableVersionState @default(DRAFT)
  notes         String?
  publishedAt   DateTime?
  createdAt     DateTime             @default(now())
  updatedAt     DateTime             @updatedAt

  variable Variable         @relation(fields: [variableId], references: [id], onDelete: Cascade)
  domains  VariableDomain[]
  axes     MatrixAxis[]

  @@unique([variableId, versionNumber])
  @@index([variableId, state])
}

model VariableDomain {
  id                String  @id @default(cuid())
  variableVersionId String
  code              String                    // R1
  label             String                    // "R1 — Risco muito baixo"
  shortLabel        String?                   // usado no cabeçalho do grid
  position          Int                       // ordem de exibição, 0-based
  color             String?                   // #RRGGBB opcional
  // preenchidos apenas quando VariableType = RANGE
  rangeMin          Decimal? @db.Decimal(18, 4)
  rangeMax          Decimal? @db.Decimal(18, 4)
  minInclusive      Boolean  @default(true)
  maxInclusive      Boolean  @default(false)
  isCatchAll        Boolean  @default(false)  // "acima de X" / "demais casos"

  version VariableVersion @relation(fields: [variableVersionId], references: [id], onDelete: Cascade)

  @@unique([variableVersionId, code])
  @@index([variableVersionId, position])
}

// ─────────────────── Biblioteca de Conteúdo ───────────────────

model CatalogItem {
  id           String      @id @default(cuid())
  kind         CatalogKind
  code         String                              // OFERTA_8 / APROVADO / LIM_2000
  label        String                              // "Oferta 8"
  description  String?
  color        String?                             // #RRGGBB
  numericValue Decimal?    @db.Decimal(14, 2)      // obrigatório quando kind = LIMIT
  position     Int         @default(0)
  archivedAt   DateTime?
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  cellsAsDecision MatrixCell[] @relation("CellDecision")
  cellsAsOffer    MatrixCell[] @relation("CellOffer")
  cellsAsLimit    MatrixCell[] @relation("CellLimit")
  templateDecision Template[]  @relation("TemplateDecision")
  templateOffer    Template[]  @relation("TemplateOffer")
  templateLimit    Template[]  @relation("TemplateLimit")

  @@unique([kind, code])
  @@index([kind, archivedAt])
}

// ─────────────────────── Projetos e Matrizes ───────────────────────

model Project {
  id          String    @id @default(cuid())
  slug        String    @unique
  name        String                   // "Política PF"
  description String?
  archivedAt  DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  matrices Matrix[]

  @@index([archivedAt])
}

model Matrix {
  id          String    @id @default(cuid())
  projectId   String
  code        String                   // MTZ_LIMITE_PF
  name        String                   // "Matriz de Limite PF"
  description String?
  archivedAt  DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  project  Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  versions MatrixVersion[]

  @@unique([projectId, code])
  @@index([projectId, archivedAt])
}

model MatrixVersion {
  id            String             @id @default(cuid())
  matrixId      String
  versionNumber Int
  state         MatrixVersionState @default(DRAFT)
  notes         String?            // changelog escrito pelo autor
  baseVersionId String?            // versão da qual este rascunho foi derivado

  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  publishedById String?
  publishedAt   DateTime?
  /// Vigência. effectiveFrom é definido na publicação (default = publishedAt).
  /// effectiveTo é preenchido quando uma versão mais nova é publicada.
  effectiveFrom DateTime?
  effectiveTo   DateTime?
  archivedAt    DateTime?

  matrix      Matrix         @relation(fields: [matrixId], references: [id], onDelete: Cascade)
  createdBy   User           @relation("VersionCreatedBy", fields: [createdById], references: [id])
  publishedBy User?          @relation("VersionPublishedBy", fields: [publishedById], references: [id])
  baseVersion MatrixVersion? @relation("VersionLineage", fields: [baseVersionId], references: [id])
  derived     MatrixVersion[] @relation("VersionLineage")

  axes   MatrixAxis[]
  cells  MatrixCell[]
  events MatrixVersionEvent[]

  @@unique([matrixId, versionNumber])
  @@index([matrixId, state])
  @@index([matrixId, effectiveFrom, effectiveTo])
}

/// Eixo da versão. Guarda o "pin": de qual VariableVersion o snapshot foi tirado.
model MatrixAxis {
  id                String   @id @default(cuid())
  matrixVersionId   String
  role              AxisRole
  variableId        String
  variableVersionId String                  // o pin
  label             String                  // rótulo exibido; default = Variable.name
  createdAt         DateTime @default(now())

  matrixVersion   MatrixVersion   @relation(fields: [matrixVersionId], references: [id], onDelete: Cascade)
  variable        Variable        @relation(fields: [variableId], references: [id])
  variableVersion VariableVersion @relation(fields: [variableVersionId], references: [id])
  domains         MatrixAxisDomain[]

  @@unique([matrixVersionId, role])
  @@index([variableVersionId])
}

/// SNAPSHOT congelado do domínio. Cópia, não referência.
model MatrixAxisDomain {
  id             String  @id @default(cuid())
  axisId         String
  sourceDomainId String?                    // rastreabilidade; pode apontar p/ registro removido
  code           String
  label          String
  shortLabel     String?
  position       Int
  color          String?
  rangeMin       Decimal? @db.Decimal(18, 4)
  rangeMax       Decimal? @db.Decimal(18, 4)
  minInclusive   Boolean  @default(true)
  maxInclusive   Boolean  @default(false)
  isCatchAll     Boolean  @default(false)

  axis MatrixAxis @relation(fields: [axisId], references: [id], onDelete: Cascade)

  @@unique([axisId, code])
  @@index([axisId, position])
}

/// Uma célula por cruzamento (xCode, yCode). xCode/yCode referenciam
/// MatrixAxisDomain.code do snapshot — nunca a biblioteca viva.
model MatrixCell {
  id              String @id @default(cuid())
  matrixVersionId String
  xCode           String
  yCode           String

  decisionItemId String?
  offerItemId    String?
  limitItemId    String?
  /// Sobrepõe CatalogItem.numericValue quando o limite é excepcional nesta célula.
  limitOverride  Decimal? @db.Decimal(14, 2)

  colorOverride String?
  note          String?
  /// Atributos extras livres. Chaves em snake_case. Não usar para regra de negócio.
  attributes    Json     @default("{}")

  /// true = célula existe mas ainda não foi preenchida (nasceu de evolução de
  /// variável ou de matriz recém-criada). Bloqueia publicação.
  isUnset Boolean @default(true)

  updatedAt DateTime @updatedAt

  matrixVersion MatrixVersion @relation(fields: [matrixVersionId], references: [id], onDelete: Cascade)
  decisionItem  CatalogItem?  @relation("CellDecision", fields: [decisionItemId], references: [id])
  offerItem     CatalogItem?  @relation("CellOffer", fields: [offerItemId], references: [id])
  limitItem     CatalogItem?  @relation("CellLimit", fields: [limitItemId], references: [id])

  @@unique([matrixVersionId, xCode, yCode])
  @@index([matrixVersionId])
  @@index([matrixVersionId, isUnset])
}

/// Trilha de auditoria imutável.
model MatrixVersionEvent {
  id              String          @id @default(cuid())
  matrixVersionId String
  type            MatrixEventType
  /// Payload por tipo — ver 04-regras-de-negocio.md §7
  payload         Json            @default("{}")
  summary         String                          // frase pronta em pt-BR para a timeline
  actorId         String?
  createdAt       DateTime        @default(now())

  matrixVersion MatrixVersion @relation(fields: [matrixVersionId], references: [id], onDelete: Cascade)
  actor         User?         @relation(fields: [actorId], references: [id])

  @@index([matrixVersionId, createdAt])
}

// ─────────────────────────── Templates ───────────────────────────

model Template {
  id          String   @id @default(cuid())
  code        String   @unique
  name        String                       // "Matriz padrão PF"
  description String?
  xVariableId String
  yVariableId String
  /// Defaults aplicados a todas as células ao instanciar
  defaultDecisionItemId String?
  defaultOfferItemId    String?
  defaultLimitItemId    String?
  /// Regras opcionais de pré-preenchimento — ver 04-regras-de-negocio.md §8
  seedRules   Json     @default("[]")
  archivedAt  DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  xVariable Variable     @relation("TemplateVariableX", fields: [xVariableId], references: [id])
  yVariable Variable     @relation("TemplateVariableY", fields: [yVariableId], references: [id])
  decision  CatalogItem? @relation("TemplateDecision", fields: [defaultDecisionItemId], references: [id])
  offer     CatalogItem? @relation("TemplateOffer", fields: [defaultOfferItemId], references: [id])
  limit     CatalogItem? @relation("TemplateLimit", fields: [defaultLimitItemId], references: [id])
}
```

## 3. Invariantes que o banco não consegue expressar

Devem ser garantidas pelos services e cobertas por teste:

| # | Invariante |
|---|------------|
| I1 | No máximo **um** `MatrixVersion` com `state = DRAFT` por `matrixId` |
| I2 | No máximo **um** `MatrixVersion` com `state = PUBLISHED` por `matrixId` |
| I3 | Uma versão `PUBLISHED` ou `SUPERSEDED` é **imutável**: nenhum update em suas cells, axes ou axisDomains |
| I4 | Intervalos `[effectiveFrom, effectiveTo)` de um mesmo `matrixId` não se sobrepõem e não têm buracos entre publicações consecutivas |
| I5 | `MatrixCell` só existe para pares `(xCode, yCode)` presentes nos snapshots dos eixos daquela versão — nem a mais, nem a menos |
| I6 | Publicar exige zero células com `isUnset = true` |
| I7 | `CatalogItem.kind = LIMIT` exige `numericValue` não nulo |
| I8 | `VariableType = BOOLEAN` exige exatamente 2 domínios; demais tipos exigem ≥ 2 |
| I9 | `VariableType = RANGE` exige faixas contíguas, sem sobreposição, ordenadas por `position`; no máximo um `isCatchAll` e ele deve ser o último |
| I10 | Uma `VariableVersion` `PUBLISHED` é imutável; alterar domínios exige nova versão |

**Migrations adicionais obrigatórias** (SQL bruto, na mesma migration do schema):

```sql
CREATE UNIQUE INDEX "matrix_one_draft"     ON "MatrixVersion" ("matrixId") WHERE "state" = 'DRAFT';
CREATE UNIQUE INDEX "matrix_one_published" ON "MatrixVersion" ("matrixId") WHERE "state" = 'PUBLISHED';
CREATE UNIQUE INDEX "variable_one_draft"   ON "VariableVersion" ("variableId") WHERE "state" = 'DRAFT';
CREATE UNIQUE INDEX "variable_one_published" ON "VariableVersion" ("variableId") WHERE "state" = 'PUBLISHED';
```

## 4. Dados de seed

O seed (`prisma/seed.ts`) deve ser **idempotente** (upsert por chave natural) e criar:

**Usuários**
| email | nome | papel | senha |
|-------|------|-------|-------|
| admin@policyops.local | Admin | ADMIN | `policyops` |
| editor@policyops.local | Editor | EDITOR | `policyops` |
| viewer@policyops.local | Viewer | VIEWER | `policyops` |

**Variáveis** (todas com `VariableVersion` v1 `PUBLISHED`)

| code | name | type | domínios (code / label) |
|------|------|------|--------------------------|
| `SCORE_HVI3` | Score HVI3 | ORDINAL | R1…R6 |
| `RESTRITIVO` | Restritivo Externo | CATEGORICAL | `SEM` Sem restritivo · `BAIXO` Baixo · `MEDIO` Médio · `ALTO` Alto |
| `FAIXA_RENDA` | Faixa de Renda | RANGE | `ATE_2K` até R$ 2.000 [0,2000) · `2K_4K` [2000,4000) · `4K_6K` [4000,6000) · `ACIMA_6K` acima de R$ 6.000 (catchAll) |
| `TEMPO_EMPRESA` | Tempo de Empresa | RANGE | `ATE_6M` até 6 meses [0,6) · `6M_12M` [6,12) · `1A_3A` [12,36) · `ACIMA_3A` acima de 3 anos (catchAll) |

**Catálogo**

| kind | itens |
|------|-------|
| DECISION | `APROVADO` Aprovado (#16A34A) · `REPROVADO` Reprovado (#DC2626) · `ANALISE_MANUAL` Análise Manual (#F59E0B) · `EXCECAO` Exceção (#7C3AED) |
| OFFER | `OFERTA_1`…`OFERTA_3`, `OFERTA_PREMIUM`, `OFERTA_CONTROLE`, `OFERTA_POS` |
| LIMIT | `LIM_500` R$ 500 · `LIM_1000` · `LIM_2000` · `LIM_5000` (com `numericValue`) |

**Projetos**: `politica-pf` (Política PF) e `politica-pj` (Política PJ).

**Matriz de exemplo**: em Política PF, `MTZ_LIMITE_PF` "Matriz de Limite PF", eixo X = `SCORE_HVI3`, eixo Y = `RESTRITIVO`, com **v1 PUBLISHED** (24 células todas preenchidas) e **v2 DRAFT** derivada, com 3 células alteradas — para exercitar diff e comparação já no primeiro `pnpm dev`.
