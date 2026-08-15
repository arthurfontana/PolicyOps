import { z } from 'zod';
import { ImportProfileSchema, type ImportProfile } from '../import/profile';
import {
  CODE_REGEX,
  COLOR_REGEX,
  DECIMAL_REGEX,
  INTEGER_REGEX,
  ISO_DATE_REGEX,
  NANOID_REGEX,
  codeSchema,
  colorSchema,
  decimalSchema,
  idSchema,
  isoDateSchema,
} from './primitives';

/**
 * Tipos e schemas Zod do documento PolicyOps. Transcrição literal de
 * docs/03-modelo-do-documento.md §1–§8 — não renomear campos, não trocar
 * tipos, não adicionar campos que "fariam sentido". Qualquer divergência
 * em relação ao documento normativo é bug deste arquivo, não do documento.
 *
 * Cada `type` é a transcrição literal; o `Schema` correspondente é anotado
 * com `z.ZodType<Type>` para que o compilador denuncie qualquer divergência
 * entre os dois.
 */

// ---------------------------------------------------------------------------
// Primitivos — definidos em ./primitives (ver o comentário lá sobre o ciclo
// com import/profile.ts) e reexportados aqui: todo o resto do código
// continua importando de '@/core/document/schema' sem mudança nenhuma.
// ---------------------------------------------------------------------------
// #region: primitivos-definidos-em-primitives-ver-o-comentario-la-sobre-o-ciclo

export {
  CODE_REGEX,
  COLOR_REGEX,
  DECIMAL_REGEX,
  INTEGER_REGEX,
  ISO_DATE_REGEX,
  NANOID_REGEX,
  codeSchema,
  colorSchema,
  decimalSchema,
  idSchema,
  isoDateSchema,
};
export type { ImportProfile };

// ---------------------------------------------------------------------------
// §2 Biblioteca de Variáveis
// ---------------------------------------------------------------------------
// #region: 2-biblioteca-de-variaveis

export type VariableType = 'ORDINAL' | 'CATEGORICAL' | 'RANGE' | 'BOOLEAN';
export const VariableTypeSchema: z.ZodType<VariableType> = z.enum([
  'ORDINAL',
  'CATEGORICAL',
  'RANGE',
  'BOOLEAN',
]);

export type LifecycleState3 = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
export const LifecycleState3Schema: z.ZodType<LifecycleState3> = z.enum([
  'DRAFT',
  'PUBLISHED',
  'SUPERSEDED',
]);

/**
 * Threshold numérico de uma faixa RANGE para **uma combinação** de opções de
 * agrupamento (docs/03 §2). `path` tem o mesmo comprimento de
 * `VariableVersion.groupingDimensions`, na mesma ordem — `path[i]` é sempre
 * um `GroupingOption.code` válido do nível `i`. Não existe uma entrada para
 * cada combinação possível: só para as que o usuário efetivamente definiu
 * (I19), que é o que permite hierarquias assimétricas.
 */
export type GroupingRange = {
  path: string[];
  min: string;
  max?: string;
  minInclusive?: boolean;
  maxInclusive?: boolean;
};

export const GroupingRangeSchema: z.ZodType<GroupingRange> = z
  .object({
    path: z.array(codeSchema),
    min: decimalSchema,
    max: decimalSchema.optional(),
    minInclusive: z.boolean().optional(),
    maxInclusive: z.boolean().optional(),
  })
  .strict();

export type Domain = {
  code: string;
  label: string;
  shortLabel?: string;
  position: number;
  color?: string;
  rangeMin?: string;
  rangeMax?: string;
  minInclusive?: boolean;
  maxInclusive?: boolean;
  isCatchAll?: boolean;
  groupingRanges?: GroupingRange[];
};

export const DomainSchema: z.ZodType<Domain> = z
  .object({
    code: codeSchema,
    label: z.string().min(1),
    shortLabel: z.string().min(1).optional(),
    position: z.number().int().nonnegative(),
    color: colorSchema.optional(),
    rangeMin: decimalSchema.optional(),
    rangeMax: decimalSchema.optional(),
    minInclusive: z.boolean().optional(),
    maxInclusive: z.boolean().optional(),
    isCatchAll: z.boolean().optional(),
    groupingRanges: z.array(GroupingRangeSchema).optional(),
  })
  .strict();

/**
 * Como os limites de uma faixa RANGE são lidos — por versão, nunca por
 * domínio (docs/03 §2). `INCLUSIVE_INTEGER` (default, ausência = este modo) é
 * `[mín, máx]` com passo 1: a contiguidade exige `atual.máx + 1 ==
 * próxima.mín`, e os valores são validados como inteiros. `HALF_OPEN` é o
 * `[mín, máx)` clássico, com `atual.máx == próxima.mín` — opt-in explícito
 * para faixas decimais ou que tocam exatamente no limite.
 */
export type BoundaryMode = 'HALF_OPEN' | 'INCLUSIVE_INTEGER';
export const BoundaryModeSchema: z.ZodType<BoundaryMode> = z.enum(['HALF_OPEN', 'INCLUSIVE_INTEGER']);

/** Uma opção de um nível de agrupamento (SP, MEI, NAO_MEI_1_SOCIO…), única dentro do nível (docs/03 §2). */
export type GroupingOption = {
  code: string;
  label: string;
};

export const GroupingOptionSchema: z.ZodType<GroupingOption> = z
  .object({
    code: codeSchema,
    label: z.string().min(1),
  })
  .strict();

/**
 * Um nível de agrupamento de negócio (Regional, Porte, Tipo de Empresa…) —
 * generaliza o "regional" fixo da sessão 18. `code` é único entre os níveis
 * da versão; `options` tem ao menos uma entrada, com `code` único dentro do
 * próprio nível (I19). Nunca vira eixo de matriz (docs/03 §2, docs/05 §5.6).
 */
export type GroupingDimension = {
  code: string;
  label: string;
  options: GroupingOption[];
};

export const GroupingDimensionSchema: z.ZodType<GroupingDimension> = z
  .object({
    code: codeSchema,
    label: z.string().min(1),
    options: z.array(GroupingOptionSchema),
  })
  .strict();

export type VariableVersion = {
  id: string;
  number: number;
  state: LifecycleState3;
  notes?: string;
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  publishedBy?: string;
  domains: Domain[];
  /** Ausente = variável não usa agrupamento; presente, de 1 a 4 níveis (I19). */
  groupingDimensions?: GroupingDimension[];
  /** Ausente = `INCLUSIVE_INTEGER` (default — docs/03 §2). */
  boundaryMode?: BoundaryMode;
};

export const VariableVersionSchema: z.ZodType<VariableVersion> = z
  .object({
    id: idSchema,
    number: z.number().int().positive(),
    state: LifecycleState3Schema,
    notes: z.string().min(1).optional(),
    createdAt: isoDateSchema,
    createdBy: z.string().min(1),
    publishedAt: isoDateSchema.optional(),
    publishedBy: z.string().min(1).optional(),
    domains: z.array(DomainSchema),
    groupingDimensions: z.array(GroupingDimensionSchema).optional(),
    boundaryMode: BoundaryModeSchema.optional(),
  })
  .strict();

export type Variable = {
  id: string;
  code: string;
  name: string;
  description?: string;
  type: VariableType;
  archivedAt?: string;
  createdAt: string;
  versions: VariableVersion[];
};

export const VariableSchema: z.ZodType<Variable> = z
  .object({
    id: idSchema,
    code: codeSchema,
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    type: VariableTypeSchema,
    archivedAt: isoDateSchema.optional(),
    createdAt: isoDateSchema,
    versions: z.array(VariableVersionSchema),
  })
  .strict();

// ---------------------------------------------------------------------------
// §3 Biblioteca de Compatibilidade
// ---------------------------------------------------------------------------
// #region: 3-biblioteca-de-compatibilidade

export type DefaultForUnlisted = 'ALL' | 'NONE';
export const DefaultForUnlistedSchema: z.ZodType<DefaultForUnlisted> = z.enum(['ALL', 'NONE']);

export type CompatibilityVersion = {
  id: string;
  number: number;
  state: LifecycleState3;
  notes?: string;
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  publishedBy?: string;
  parentVariableVersionId: string;
  childVariableVersionId: string;
  allow: Record<string, string[]>;
  defaultForUnlisted: DefaultForUnlisted;
};

export const CompatibilityVersionSchema: z.ZodType<CompatibilityVersion> = z
  .object({
    id: idSchema,
    number: z.number().int().positive(),
    state: LifecycleState3Schema,
    notes: z.string().min(1).optional(),
    createdAt: isoDateSchema,
    createdBy: z.string().min(1),
    publishedAt: isoDateSchema.optional(),
    publishedBy: z.string().min(1).optional(),
    parentVariableVersionId: idSchema,
    childVariableVersionId: idSchema,
    allow: z.record(z.string(), z.array(z.string())),
    defaultForUnlisted: DefaultForUnlistedSchema,
  })
  .strict();

export type CompatibilityRule = {
  id: string;
  code: string;
  name: string;
  description?: string;
  parentVariableId: string;
  childVariableId: string;
  archivedAt?: string;
  createdAt: string;
  versions: CompatibilityVersion[];
};

export const CompatibilityRuleSchema: z.ZodType<CompatibilityRule> = z
  .object({
    id: idSchema,
    code: codeSchema,
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    parentVariableId: idSchema,
    childVariableId: idSchema,
    archivedAt: isoDateSchema.optional(),
    createdAt: isoDateSchema,
    versions: z.array(CompatibilityVersionSchema),
  })
  .strict();

// ---------------------------------------------------------------------------
// §4 Biblioteca de Conteúdo
// ---------------------------------------------------------------------------
// #region: 4-biblioteca-de-conteudo

/**
 * `MOTIVATOR` e `IMPACT_CATEGORY` entram no schema 5 (docs/14-governanca-de-alteracoes.md
 * §3.5) para alimentar os campos `motivators` e `impacts` de `ChangeRequest`.
 * Como todo kind, eles só existem como item de catálogo — nenhum comando desta
 * sessão os escreve.
 */
export type CatalogItemKind =
  | 'DECISION'
  | 'OFFER'
  | 'LIMIT'
  | 'TAG'
  | 'MOTIVATOR'
  | 'IMPACT_CATEGORY';
export const CATALOG_ITEM_KINDS: readonly CatalogItemKind[] = [
  'DECISION',
  'OFFER',
  'LIMIT',
  'TAG',
  'MOTIVATOR',
  'IMPACT_CATEGORY',
];
export const CatalogItemKindSchema: z.ZodType<CatalogItemKind> = z.enum([
  'DECISION',
  'OFFER',
  'LIMIT',
  'TAG',
  'MOTIVATOR',
  'IMPACT_CATEGORY',
]);

export type CatalogItem = {
  id: string;
  kind: CatalogItemKind;
  code: string;
  label: string;
  description?: string;
  color?: string;
  numericValue?: string;
  /** Só tem efeito em `kind: 'TAG'` — faceta de filtro ("Canal", "Cluster"); ignorado nos demais kinds (docs/03 §4). */
  group?: string;
  position: number;
  archivedAt?: string;
  createdAt: string;
};

export const CatalogItemSchema: z.ZodType<CatalogItem> = z
  .object({
    id: idSchema,
    kind: CatalogItemKindSchema,
    code: codeSchema,
    label: z.string().min(1),
    description: z.string().min(1).optional(),
    color: colorSchema.optional(),
    numericValue: decimalSchema.optional(),
    group: z.string().min(1).optional(),
    position: z.number().int().nonnegative(),
    archivedAt: isoDateSchema.optional(),
    createdAt: isoDateSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// §4.1 RichDoc — documentação livre em blocos próprios
// (docs/14-governanca-de-alteracoes.md §7, DEC-GOV-005)
//
// Declarado inteiro na sessão 32a, sem editor: é o que permite `spec?` de
// `ComponentVersion`/`ChangeRequest` e `Project.factoryTemplate` existirem no
// schema 5 sem uma segunda migração quando a S34 construir o editor.
// ---------------------------------------------------------------------------
// #region: 4-1-rich-doc-documentacao-livre-em-blocos-proprios

export type InlineMark = 'bold' | 'italic' | 'code' | 'link';
export const InlineMarkSchema: z.ZodType<InlineMark> = z.enum(['bold', 'italic', 'code', 'link']);

/** Um parágrafo é uma sequência de trechos, cada um com suas marcas. */
export type InlineText = Array<{ text: string; marks?: InlineMark[]; href?: string }>;

export const InlineTextSchema: z.ZodType<InlineText> = z.array(
  z
    .object({
      text: z.string(),
      marks: z.array(InlineMarkSchema).optional(),
      href: z.string().min(1).optional(),
    })
    .strict(),
);

export type TextBlockType = 'paragraph' | 'heading1' | 'heading2' | 'quote' | 'callout';
export const TextBlockTypeSchema: z.ZodType<TextBlockType> = z.enum([
  'paragraph',
  'heading1',
  'heading2',
  'quote',
  'callout',
]);

/**
 * `id` é estável por bloco: é o que torna o diff de `RichDoc` um diff **por
 * bloco** (adicionado/removido/alterado), sem diff intra-texto (docs/14 §7).
 */
export type Block =
  | { id: string; type: TextBlockType; text: InlineText }
  | { id: string; type: 'bulletList' | 'numberList'; items: InlineText[] }
  | { id: string; type: 'table'; header: string[]; rows: string[][] }
  | { id: string; type: 'image'; attachmentId: string; caption?: string };

export const BlockSchema: z.ZodType<Block> = z.union([
  z.object({ id: idSchema, type: TextBlockTypeSchema, text: InlineTextSchema }).strict(),
  z
    .object({
      id: idSchema,
      type: z.enum(['bulletList', 'numberList']),
      items: z.array(InlineTextSchema),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal('table'),
      header: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal('image'),
      attachmentId: idSchema,
      caption: z.string().min(1).optional(),
    })
    .strict(),
]);

export type RichDoc = { blocks: Block[] };

export const RichDocSchema: z.ZodType<RichDoc> = z
  .object({ blocks: z.array(BlockSchema) })
  .strict();

// ---------------------------------------------------------------------------
// §5 Projetos e Matrizes
// ---------------------------------------------------------------------------
// #region: 5-projetos-e-matrizes

/**
 * Boilerplate do Pacote para a Fábrica (docs/14 §8, S38) — o conteúdo fixo dos
 * DBs atuais, editável uma vez por política. Declarado na S32a, consumido só
 * pela S38.
 */
export type FactoryTemplate = {
  boilerplate: RichDoc;
  contacts?: Array<{ name: string; role?: string; email?: string }>;
};

export const FactoryTemplateSchema: z.ZodType<FactoryTemplate> = z
  .object({
    boilerplate: RichDocSchema,
    contacts: z
      .array(
        z
          .object({
            name: z.string().min(1),
            role: z.string().min(1).optional(),
            email: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type Project = {
  id: string;
  code: string;
  name: string;
  description?: string;
  position: number;
  /**
   * Vigência da fundação (RN-GOV-09): `effectiveFrom` padrão da primeira versão
   * de cada componente e da publicação em lote dos pendentes. Declarado na
   * S32a, consumido pela S33b — não é estado nem modo, só um valor padrão.
   */
  foundationEffectiveFrom?: string;
  /** Boilerplate do Pacote para a Fábrica (docs/14 §8) — declarado na S32a, usado na S38. */
  factoryTemplate?: FactoryTemplate;
  archivedAt?: string;
  createdAt: string;
};

export const ProjectSchema: z.ZodType<Project> = z
  .object({
    id: idSchema,
    code: codeSchema,
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    position: z.number().int().nonnegative(),
    foundationEffectiveFrom: isoDateSchema.optional(),
    factoryTemplate: FactoryTemplateSchema.optional(),
    archivedAt: isoDateSchema.optional(),
    createdAt: isoDateSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// §6 Versão de matriz
// ---------------------------------------------------------------------------
// #region: 6-versao-de-matriz

export type AxisRole = 'X' | 'Y';
export const AxisRoleSchema: z.ZodType<AxisRole> = z.enum(['X', 'Y']);

export type AxisLevel = {
  id: string;
  variableId: string;
  variableVersionId: string;
  label: string;
  domains: Domain[];
};

export const AxisLevelSchema: z.ZodType<AxisLevel> = z
  .object({
    id: idSchema,
    variableId: idSchema,
    variableVersionId: idSchema,
    label: z.string().min(1),
    domains: z.array(DomainSchema),
  })
  .strict();

export type Axis = {
  role: AxisRole;
  levels: AxisLevel[];
  tuples: string[];
  manualSuppressions?: string[];
  derivedFrom: { compatibilityVersionIds: string[] };
};

export const AxisSchema: z.ZodType<Axis> = z
  .object({
    role: AxisRoleSchema,
    levels: z.array(AxisLevelSchema),
    tuples: z.array(z.string()),
    manualSuppressions: z.array(z.string()).optional(),
    derivedFrom: z
      .object({ compatibilityVersionIds: z.array(idSchema) })
      .strict(),
  })
  .strict();

/** Célula vazia não é gravada — chave ausente de `cells` significa "não preenchida". */
export type Cell = {
  decision?: string;
  offer?: string;
  limit?: string;
  limitOverride?: string;
  color?: string;
  note?: string;
  attrs?: Record<string, string | number | boolean>;
};

export const CellSchema: z.ZodType<Cell> = z
  .object({
    decision: codeSchema.optional(),
    offer: codeSchema.optional(),
    limit: codeSchema.optional(),
    limitOverride: decimalSchema.optional(),
    color: colorSchema.optional(),
    note: z.string().min(1).optional(),
    attrs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict()
  .refine((cell) => Object.keys(cell).length > 0, {
    message: 'Célula vazia não deve ser gravada — remova a chave de `cells` em vez de um objeto vazio.',
  });

export type MatrixVersionState = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'ARCHIVED';
export const MatrixVersionStateSchema: z.ZodType<MatrixVersionState> = z.enum([
  'DRAFT',
  'PUBLISHED',
  'SUPERSEDED',
  'ARCHIVED',
]);

export type MatrixVersion = {
  id: string;
  number: number;
  state: MatrixVersionState;
  notes?: string;
  baseVersionId?: string;
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  publishedBy?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  archivedAt?: string;
  axes: { x: Axis; y: Axis };
  cells: Record<string, Cell>;
};

export const MatrixVersionSchema: z.ZodType<MatrixVersion> = z
  .object({
    id: idSchema,
    number: z.number().int().positive(),
    state: MatrixVersionStateSchema,
    notes: z.string().min(1).optional(),
    baseVersionId: idSchema.optional(),
    createdAt: isoDateSchema,
    createdBy: z.string().min(1),
    publishedAt: isoDateSchema.optional(),
    publishedBy: z.string().min(1).optional(),
    effectiveFrom: isoDateSchema.optional(),
    effectiveTo: isoDateSchema.optional(),
    archivedAt: isoDateSchema.optional(),
    axes: z.object({ x: AxisSchema, y: AxisSchema }).strict(),
    cells: z.record(z.string(), CellSchema),
  })
  .strict();

export type Matrix = {
  id: string;
  projectId: string;
  code: string;
  name: string;
  description?: string;
  /** Codes de `CatalogItem` de kind `TAG`, sem repetição; omitido quando vazio (docs/03 §5). */
  tags?: string[];
  archivedAt?: string;
  createdAt: string;
  versions: MatrixVersion[];
};

export const MatrixSchema: z.ZodType<Matrix> = z
  .object({
    id: idSchema,
    projectId: idSchema,
    code: codeSchema,
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    tags: z.array(codeSchema).optional(),
    archivedAt: isoDateSchema.optional(),
    createdAt: isoDateSchema,
    versions: z.array(MatrixVersionSchema),
  })
  .strict();

// ---------------------------------------------------------------------------
// §7 Templates
// ---------------------------------------------------------------------------
// #region: 7-templates

/** Casa caminhos por prefixo de nível. `null` num nível = qualquer valor. */
export type PathMatcher = Array<string | null>;
export const PathMatcherSchema: z.ZodType<PathMatcher> = z.array(z.union([z.string(), z.null()]));

export type SeedRule = {
  when: { x?: PathMatcher; y?: PathMatcher };
  set: { decision?: string; offer?: string; limit?: string; color?: string };
};

export const SeedRuleSchema: z.ZodType<SeedRule> = z
  .object({
    when: z
      .object({
        x: PathMatcherSchema.optional(),
        y: PathMatcherSchema.optional(),
      })
      .strict(),
    set: z
      .object({
        decision: codeSchema.optional(),
        offer: codeSchema.optional(),
        limit: codeSchema.optional(),
        color: colorSchema.optional(),
      })
      .strict(),
  })
  .strict();

const TemplateAxisLevelRefSchema = z.object({ variableId: idSchema, label: z.string().min(1).optional() }).strict();

export type Template = {
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

export const TemplateSchema: z.ZodType<Template> = z
  .object({
    id: idSchema,
    code: codeSchema,
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    axes: z
      .object({
        x: z.object({ levels: z.array(TemplateAxisLevelRefSchema) }).strict(),
        y: z.object({ levels: z.array(TemplateAxisLevelRefSchema) }).strict(),
      })
      .strict(),
    defaults: z
      .object({
        decision: codeSchema.optional(),
        offer: codeSchema.optional(),
        limit: codeSchema.optional(),
      })
      .strict()
      .optional(),
    seedRules: z.array(SeedRuleSchema),
    archivedAt: isoDateSchema.optional(),
    createdAt: isoDateSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// §8 Auditoria
// ---------------------------------------------------------------------------
// #region: 8-auditoria

export const DOC_EVENT_TYPES = [
  'DOCUMENT_CREATED',
  'DOCUMENT_MERGED',
  'MATRIX_CREATED',
  'DRAFT_CREATED',
  'DRAFT_DISCARDED',
  'CELLS_UPDATED',
  'AXIS_LEVEL_ADDED',
  'AXIS_LEVEL_REMOVED',
  'AXIS_LEVEL_REORDERED',
  'AXIS_RESNAPSHOTTED',
  'TUPLES_SUPPRESSED',
  'VERSION_PUBLISHED',
  'VERSION_SUPERSEDED',
  'NOTE_ADDED',
  'VARIABLE_PUBLISHED',
  'COMPATIBILITY_PUBLISHED',
  'CATALOG_CHANGED',
  'IMPORT_RUN',
  'IMPORT_PROFILE_SAVED',
  'MATRIX_TAGGED',
  'ACL_CHANGED',
  'EVIDENCE_ATTACHED',
  'EVIDENCE_DETACHED',
  // Componentes de política (schema 5, sessão 32a) — docs/14 §3.1/§3.2. Sem
  // eles a timeline de uma regra (US-GOV-02) não teria lastro nenhum, ao
  // contrário de projeto/metadados de matriz, que não têm história própria.
  'COMPONENT_CREATED',
  'COMPONENT_UPDATED',
  'COMPONENT_MOVED',
  'COMPONENT_ARCHIVED',
  'COMPONENT_DRAFT_CREATED',
  'COMPONENT_DRAFT_DISCARDED',
  'COMPONENT_VERSION_PUBLISHED',
  'COMPONENT_VERSION_SUPERSEDED',
  // Carga da política por recorte (schema 5, sessão 40) — docs/14 §9. Um
  // evento por lote (não um por componente: esses já são cobertos pelos tipos
  // acima), com os `componentId` criados no payload — o fio que liga a árvore
  // ao recorte de Markdown que a originou.
  'COMPONENT_MARKDOWN_IMPORTED',
  // Governança de alterações (schema 5, sessão 32b) — docs/14 §3.3/§3.4 e §5.
  // Os cinco de `CR_*` são gravados na **trilha do próprio DB**
  // (`ChangeRequest.events`), não em `doc.events` (DEC-GOV-019); os de release
  // vão para `doc.events`, porque `Release` não tem trilha própria no schema.
  'CR_CREATED',
  'CR_UPDATED',
  'CR_ITEM_CHANGED',
  'CR_TRANSITIONED',
  'CR_DECIDED',
  'RELEASE_CREATED',
  'RELEASE_UPDATED',
  'RELEASE_CANCELLED',
] as const;

export type DocEventType = (typeof DOC_EVENT_TYPES)[number];
export const DocEventTypeSchema: z.ZodType<DocEventType> = z.enum(DOC_EVENT_TYPES);

export type DocEvent = {
  id: string;
  at: string;
  actor: string;
  type: DocEventType;
  scope: {
    projectId?: string;
    matrixId?: string;
    versionId?: string;
    variableId?: string;
    compatibilityId?: string;
    /** Componente de política (schema 5) — docs/14 §3.1. */
    componentId?: string;
    /** Versão de componente (schema 5) — o análogo de `versionId` para a árvore. */
    componentVersionId?: string;
    /** Solicitação de alteração — o "DB" (schema 5, sessão 32b). */
    changeRequestId?: string;
    /** Release (schema 5, sessão 32b). */
    releaseId?: string;
  };
  summary: string;
  payload?: Record<string, unknown>;
};

export const DocEventSchema: z.ZodType<DocEvent> = z
  .object({
    id: idSchema,
    at: isoDateSchema,
    actor: z.string().min(1),
    type: DocEventTypeSchema,
    scope: z
      .object({
        projectId: idSchema.optional(),
        matrixId: idSchema.optional(),
        versionId: idSchema.optional(),
        variableId: idSchema.optional(),
        compatibilityId: idSchema.optional(),
        componentId: idSchema.optional(),
        componentVersionId: idSchema.optional(),
        changeRequestId: idSchema.optional(),
        releaseId: idSchema.optional(),
      })
      .strict(),
    summary: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// §9 Evidências (docs/14-plataforma-local.md §7, ADR-004)
// ---------------------------------------------------------------------------
// #region: 9-evidencias

/**
 * A que a evidência está presa. `VERSION` guarda o **número** da versão, não o
 * `versionId`: o número é o que aparece na pasta do acervo (`v12`) e o que uma
 * pessoa reconhece no Explorer sem a aplicação aberta (ADR-004).
 */
export type AttachmentTarget =
  | { kind: 'PROJECT'; projectId: string }
  | { kind: 'MATRIX'; matrixId: string }
  | { kind: 'VERSION'; matrixId: string; versionNumber: number };

export const AttachmentTargetSchema: z.ZodType<AttachmentTarget> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PROJECT'), projectId: idSchema }).strict(),
  z.object({ kind: z.literal('MATRIX'), matrixId: idSchema }).strict(),
  z
    .object({
      kind: z.literal('VERSION'),
      matrixId: idSchema,
      versionNumber: z.number().int().positive(),
    })
    .strict(),
]);

const AttachedBySchema = z
  .object({ username: z.string().min(1), displayName: z.string().min(1).optional() })
  .strict();

/**
 * Um arquivo do acervo `_evidencias/` (docs/14-plataforma-local.md §7). O
 * documento é o **registro** do anexo — o servidor só toca arquivos (ADR-002):
 * `relPath` e `sha256` daqui são o que a aplicação manda para
 * `GET /api/evidences/{id}` conferir.
 *
 * Evidência é imutável: não existe "editar anexo" (anexa-se outro), e desanexar
 * tira o vínculo daqui sem apagar o arquivo do mundo.
 */
export type EvidenceAttachment = {
  kind: 'EVIDENCE';
  id: string;
  /** Nome original, como a pessoa mandou — preservado no disco (ADR-004). */
  fileName: string;
  /** Caminho relativo dentro de `_evidencias/`, com `/`: `politica-pf/mtz-limite-pf/v12/…`. */
  relPath: string;
  sha256: string;
  bytes: number;
  addedBy: { username: string; displayName?: string };
  addedAt: string;
  note?: string;
  target: AttachmentTarget;
};

const EvidenceAttachmentObject = z
  .object({
    kind: z.literal('EVIDENCE'),
    id: idSchema,
    fileName: z.string().min(1),
    relPath: z.string().min(1),
    sha256: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    addedBy: AttachedBySchema,
    addedAt: isoDateSchema,
    note: z.string().min(1).optional(),
    target: AttachmentTargetSchema,
  })
  .strict();

export const EvidenceAttachmentSchema: z.ZodType<EvidenceAttachment> = EvidenceAttachmentObject;

/**
 * Imagem embutida num `RichDoc` (docs/14-governanca-de-alteracoes.md §7, bloco
 * `image`): base64 no próprio `.json`, redimensionada no cliente para ≤ 1600px
 * e re-encodada, com teto de `INLINE_IMAGE_MAX_BYTES` por imagem
 * (`E-GOV-05` acima disso).
 *
 * Vive na **mesma** coleção `attachments` da evidência, discriminada por
 * `kind` — a decisão que docs/14 §7 deixou em aberto (o nome `Attachment` já
 * estava ocupado pela S30) foi unificar em vez de criar uma segunda coleção.
 * As duas coisas são "arquivo pendurado no documento"; o que muda é onde o byte
 * mora: `EVIDENCE` aponta o acervo na pasta de rede, `INLINE_IMAGE` carrega o
 * conteúdo em `data`.
 */
export type InlineImageAttachment = {
  kind: 'INLINE_IMAGE';
  id: string;
  fileName: string;
  /** `image/png`, `image/jpeg`, `image/webp`… */
  mimeType: string;
  /** Conteúdo em base64, **sem** o prefixo `data:` — a UI monta a data URI. */
  data: string;
  bytes: number;
  width?: number;
  height?: number;
  addedBy: { username: string; displayName?: string };
  addedAt: string;
  note?: string;
};

const InlineImageAttachmentObject = z
  .object({
    kind: z.literal('INLINE_IMAGE'),
    id: idSchema,
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    data: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    addedBy: AttachedBySchema,
    addedAt: isoDateSchema,
    note: z.string().min(1).optional(),
  })
  .strict();

export const InlineImageAttachmentSchema: z.ZodType<InlineImageAttachment> =
  InlineImageAttachmentObject;

/** Teto por imagem embutida (docs/14 §7) — `E-GOV-05` acima disso. */
export const INLINE_IMAGE_MAX_BYTES = 300 * 1024;

/** Aviso (não bloqueio) quando o total de imagens embutidas passa disso. */
export const INLINE_IMAGE_TOTAL_WARN_BYTES = 3 * 1024 * 1024;

export type Attachment = EvidenceAttachment | InlineImageAttachment;

export const AttachmentSchema: z.ZodType<Attachment> = z.discriminatedUnion('kind', [
  EvidenceAttachmentObject,
  InlineImageAttachmentObject,
]);

export function isEvidenceAttachment(attachment: Attachment): attachment is EvidenceAttachment {
  return attachment.kind === 'EVIDENCE';
}

// ---------------------------------------------------------------------------
// §12 Componentes de política (docs/14-governanca-de-alteracoes.md §3.1/§3.2)
// ---------------------------------------------------------------------------
// #region: 12-componentes-de-politica

export type PolicyComponentType =
  | 'SECTION'
  | 'RULE'
  | 'MATRIX'
  | 'LIST'
  | 'REASON_CODE'
  | 'POLICY_VARIABLE'
  | 'OTHER';

export const POLICY_COMPONENT_TYPES: readonly PolicyComponentType[] = [
  'SECTION',
  'RULE',
  'MATRIX',
  'LIST',
  'REASON_CODE',
  'POLICY_VARIABLE',
  'OTHER',
];

export const PolicyComponentTypeSchema: z.ZodType<PolicyComponentType> = z.enum([
  'SECTION',
  'RULE',
  'MATRIX',
  'LIST',
  'REASON_CODE',
  'POLICY_VARIABLE',
  'OTHER',
]);

export type ComponentReviewStatus =
  | 'STRUCTURED'
  | 'VALIDATED'
  | 'PENDING_REVIEW'
  | 'HISTORICAL_SOURCE';

export const COMPONENT_REVIEW_STATUSES: readonly ComponentReviewStatus[] = [
  'STRUCTURED',
  'VALIDATED',
  'PENDING_REVIEW',
  'HISTORICAL_SOURCE',
];

export const ComponentReviewStatusSchema: z.ZodType<ComponentReviewStatus> = z.enum([
  'STRUCTURED',
  'VALIDATED',
  'PENDING_REVIEW',
  'HISTORICAL_SOURCE',
]);

/** Procedência: "Filtros e Critérios B2C, p. 10". Nunca vira identidade nem ordenação (docs/14 §3.6). */
export type ComponentOrigin = { source: string; locator?: string };

export const ComponentOriginSchema: z.ZodType<ComponentOrigin> = z
  .object({ source: z.string().min(1), locator: z.string().min(1).optional() })
  .strict();

/**
 * Payload de uma versão de componente, discriminado por `kind` (docs/14 §3.2).
 *
 * O `kind` acompanha o `type` do componente dono, com **uma** exceção: `SECTION`
 * usa `OTHER` — docs/14 §3.2 enumera cinco payloads e não cria um de seção, e a
 * "Visão Geral" de um capítulo (I29) é exatamente o caso mínimo que
 * `OtherPayload` cobre. `MATRIX` nunca tem versão (I27), então não tem payload.
 *
 * Fora `businessDescription`, todo campo é opcional: a carga inicial raramente
 * terá tudo (docs/14 §9).
 */
export type RulePayload = {
  kind: 'RULE';
  /** Linguagem de negócio — o "o que essa regra faz hoje". */
  businessDescription: string;
  /** "Aging > 0 e Valor >= 5000". */
  technicalDefinition?: string;
  /** Variáveis/dados usados. */
  inputs?: string[];
  conditions?: string;
  /** Aprovar / Reprovar / Derivar p/ Mesa / Continuar… */
  outcome?: string;
  /** Códigos citados, ex. `DV01`. Texto livre: reason code é componente, não catálogo. */
  reasonCodes?: string[];
  /** `code` de outros componentes. */
  dependencies?: string[];
  notes?: string;
};

export type ListPayload = {
  kind: 'LIST';
  businessDescription: string;
  purpose?: string;
  fields?: string[];
  notes?: string;
};

export type ReasonCodePayload = {
  kind: 'REASON_CODE';
  businessDescription: string;
  code?: string;
  decision?: string;
  message?: string;
  notes?: string;
};

export type PolicyVariablePayload = {
  kind: 'POLICY_VARIABLE';
  businessDescription: string;
  technicalName?: string;
  source?: string;
  domainDescription?: string;
  notes?: string;
};

export type OtherPayload = {
  kind: 'OTHER';
  businessDescription: string;
  notes?: string;
};

export type ComponentPayload =
  | RulePayload
  | ListPayload
  | ReasonCodePayload
  | PolicyVariablePayload
  | OtherPayload;

export type ComponentPayloadKind = ComponentPayload['kind'];

const businessDescriptionSchema = z.string().min(1);

const RulePayloadObject = z
  .object({
    kind: z.literal('RULE'),
    businessDescription: businessDescriptionSchema,
    technicalDefinition: z.string().min(1).optional(),
    inputs: z.array(z.string().min(1)).optional(),
    conditions: z.string().min(1).optional(),
    outcome: z.string().min(1).optional(),
    reasonCodes: z.array(z.string().min(1)).optional(),
    dependencies: z.array(z.string().min(1)).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

const ListPayloadObject = z
  .object({
    kind: z.literal('LIST'),
    businessDescription: businessDescriptionSchema,
    purpose: z.string().min(1).optional(),
    fields: z.array(z.string().min(1)).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

const ReasonCodePayloadObject = z
  .object({
    kind: z.literal('REASON_CODE'),
    businessDescription: businessDescriptionSchema,
    code: z.string().min(1).optional(),
    decision: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

const PolicyVariablePayloadObject = z
  .object({
    kind: z.literal('POLICY_VARIABLE'),
    businessDescription: businessDescriptionSchema,
    technicalName: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    domainDescription: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

const OtherPayloadObject = z
  .object({
    kind: z.literal('OTHER'),
    businessDescription: businessDescriptionSchema,
    notes: z.string().min(1).optional(),
  })
  .strict();

export const ComponentPayloadSchema: z.ZodType<ComponentPayload> = z.discriminatedUnion('kind', [
  RulePayloadObject,
  ListPayloadObject,
  ReasonCodePayloadObject,
  PolicyVariablePayloadObject,
  OtherPayloadObject,
]);

/**
 * O `kind` de payload que cada tipo de componente aceita (I29). `MATRIX` não
 * aparece: componente espelho nunca tem versão (I27).
 */
export const PAYLOAD_KIND_BY_COMPONENT_TYPE: Record<
  Exclude<PolicyComponentType, 'MATRIX'>,
  ComponentPayloadKind
> = {
  SECTION: 'OTHER',
  RULE: 'RULE',
  LIST: 'LIST',
  REASON_CODE: 'REASON_CODE',
  POLICY_VARIABLE: 'POLICY_VARIABLE',
  OTHER: 'OTHER',
};

/**
 * Versão de componente — mesmo ciclo `DRAFT → PUBLISHED → SUPERSEDED` das
 * matrizes (docs/14 §3.2, RN-GOV-06). Ao contrário de `MatrixVersion`, não há
 * `ARCHIVED`: descartar um rascunho de componente o **remove** da lista, e por
 * isso `componentVersion/discardDraft` tem inverso (docs/08 §3).
 */
export type ComponentVersion = {
  id: string;
  number: number;
  state: LifecycleState3;
  /** Obrigatório ao publicar. */
  effectiveFrom?: string;
  /** Preenchido quando substituída. */
  effectiveTo?: string;
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  publishedBy?: string;
  /** DB que originou; ausente = edição direta (RN-GOV-07). Nada na S32a o preenche. */
  changeRequestId?: string;
  payload: ComponentPayload;
  /** Documentação livre (editor rico, S34). */
  spec?: RichDoc;
};

export const ComponentVersionSchema: z.ZodType<ComponentVersion> = z
  .object({
    id: idSchema,
    number: z.number().int().positive(),
    state: LifecycleState3Schema,
    effectiveFrom: isoDateSchema.optional(),
    effectiveTo: isoDateSchema.optional(),
    createdAt: isoDateSchema,
    createdBy: z.string().min(1),
    publishedAt: isoDateSchema.optional(),
    publishedBy: z.string().min(1).optional(),
    changeRequestId: idSchema.optional(),
    payload: ComponentPayloadSchema,
    spec: RichDocSchema.optional(),
  })
  .strict();

/** Teto de profundidade da árvore de componentes (I28, docs/14 §3.1). */
export const POLICY_COMPONENT_MAX_DEPTH = 6;

/** Alerta (não bloqueio) a partir daqui, por projeto — docs/14 §3.1. */
export const POLICY_COMPONENT_WARN_COUNT = 300;

/** Teto de componentes por projeto — docs/14 §3.1. */
export const POLICY_COMPONENT_MAX_COUNT = 1000;

/**
 * Um nó da árvore de política (docs/14 §3.1). A árvore reflete o **modelo de
 * negócio**, não a implementação do motor — e a ordem dela é de leitura, nunca
 * de execução (docs/14 §3.6).
 */
export type PolicyComponent = {
  id: string;
  projectId: string;
  /** Ausente = raiz da árvore do projeto. */
  parentId?: string;
  /** Ordem entre irmãos, 0-based e sem buracos (I28). */
  position: number;
  /** `REGRA_DIVIDA_5000` — único no projeto e imutável depois de criado (I28). */
  code: string;
  name: string;
  type: PolicyComponentType;
  /** Obrigatório e exclusivo de `type: 'MATRIX'` (I27). */
  matrixId?: string;
  /** Só em `POLICY_VARIABLE`: espelho da Biblioteca de Variáveis (I27). */
  variableId?: string;
  /** Codes de `CatalogItem` de kind `TAG` — facetas (I28, DEC-GOV-011). */
  tags?: string[];
  origin?: ComponentOrigin;
  reviewStatus: ComponentReviewStatus;
  archivedAt?: string;
  createdAt: string;
  /** Sempre vazio em `MATRIX` (I27); opcional em `SECTION` (I29). */
  versions: ComponentVersion[];
};

export const PolicyComponentSchema: z.ZodType<PolicyComponent> = z
  .object({
    id: idSchema,
    projectId: idSchema,
    parentId: idSchema.optional(),
    position: z.number().int().nonnegative(),
    code: codeSchema,
    name: z.string().min(1),
    type: PolicyComponentTypeSchema,
    matrixId: idSchema.optional(),
    variableId: idSchema.optional(),
    tags: z.array(codeSchema).optional(),
    origin: ComponentOriginSchema.optional(),
    reviewStatus: ComponentReviewStatusSchema,
    archivedAt: isoDateSchema.optional(),
    createdAt: isoDateSchema,
    versions: z.array(ComponentVersionSchema),
  })
  .strict();

// ---------------------------------------------------------------------------
// §13 Entidades de governança (docs/14-governanca-de-alteracoes.md §3.3/§3.4)
//
// Declaradas inteiras na S32a e **sem comando nenhum que as escreva**: o schema
// não acompanha a divisão S32a/S32b, para que exista uma única migração 4 → 5
// (DEC-GOV-010). A S32b liga comandos, workflow e I30/I31 sobre uma forma de
// documento que já é a definitiva.
// ---------------------------------------------------------------------------
// #region: 13-entidades-de-governanca

/** Grafo de estados do DB — docs/14 §5, RN-GOV-01. As transições são da S32b. */
export type CrStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'IN_DEVELOPMENT'
  | 'IN_VALIDATION'
  | 'READY_FOR_RELEASE'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'CANCELLED';

export const CR_STATUSES: readonly CrStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'IN_DEVELOPMENT',
  'IN_VALIDATION',
  'READY_FOR_RELEASE',
  'SCHEDULED',
  'PUBLISHED',
  'CANCELLED',
];

export const CrStatusSchema: z.ZodType<CrStatus> = z.enum([
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'IN_DEVELOPMENT',
  'IN_VALIDATION',
  'READY_FOR_RELEASE',
  'SCHEDULED',
  'PUBLISHED',
  'CANCELLED',
]);

export type ChangeRequestChangeType =
  | 'UPDATE'
  | 'CREATE'
  | 'DEACTIVATE'
  | 'REACTIVATE'
  | 'MOVE'
  | 'DOC_ONLY';

export const ChangeRequestChangeTypeSchema: z.ZodType<ChangeRequestChangeType> = z.enum([
  'UPDATE',
  'CREATE',
  'DEACTIVATE',
  'REACTIVATE',
  'MOVE',
  'DOC_ONLY',
]);

export type ChangeRequestItem = {
  componentId: string;
  changeType: ChangeRequestChangeType;
  /** Versão vigente no momento da criação do item. */
  baseVersionId?: string;
  /** Rascunho proposto (`UPDATE`/`CREATE`) — I30, S32b. Em item `MATRIX`, é rascunho da matriz. */
  draftVersionId?: string;
  /** "Hoje": preenchido automaticamente da versão vigente. */
  currentSummary?: string;
  /** "Proposto": obrigatório. */
  proposedSummary: string;
};

export const ChangeRequestItemSchema: z.ZodType<ChangeRequestItem> = z
  .object({
    componentId: idSchema,
    changeType: ChangeRequestChangeTypeSchema,
    baseVersionId: idSchema.optional(),
    draftVersionId: idSchema.optional(),
    currentSummary: z.string().min(1).optional(),
    proposedSummary: z.string().min(1),
  })
  .strict();

export type CrPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export const CrPrioritySchema: z.ZodType<CrPriority> = z.enum([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

export type CrApprovalDecision = 'APPROVED' | 'RETURNED' | 'REJECTED';
export const CrApprovalDecisionSchema: z.ZodType<CrApprovalDecision> = z.enum([
  'APPROVED',
  'RETURNED',
  'REJECTED',
]);

export type CrApproval = {
  by: string;
  at: string;
  decision: CrApprovalDecision;
  comment?: string;
};

export const CrApprovalSchema: z.ZodType<CrApproval> = z
  .object({
    by: z.string().min(1),
    at: isoDateSchema,
    decision: CrApprovalDecisionSchema,
    comment: z.string().min(1).optional(),
  })
  .strict();

export type CrAcceptanceCriterion = { given: string; when?: string; then: string };

export const CrAcceptanceCriterionSchema: z.ZodType<CrAcceptanceCriterion> = z
  .object({
    given: z.string().min(1),
    when: z.string().min(1).optional(),
    then: z.string().min(1),
  })
  .strict();

export type CrTestScenario = { kind: string; description: string };

export const CrTestScenarioSchema: z.ZodType<CrTestScenario> = z
  .object({ kind: z.string().min(1), description: z.string().min(1) })
  .strict();

export type CrImpact = { category: string; description?: string };

export const CrImpactSchema: z.ZodType<CrImpact> = z
  .object({ category: z.string().min(1), description: z.string().min(1).optional() })
  .strict();

/** Solicitação de Alteração — o "DB" (Diário de Bordo) estruturado, docs/14 §3.3. */
export type ChangeRequest = {
  id: string;
  /** "DB-519" — sequencial sugerido, editável, único no documento (I31, S32b). */
  code: string;
  title: string;
  status: CrStatus;
  /** Codes de `CatalogItem` de kind `MOTIVATOR`. */
  motivators: string[];
  motivationText?: RichDoc;
  requestedBy: string;
  owner?: string;
  priority?: CrPriority;
  /** 1..N componentes afetados (RN-GOV-02). */
  items: ChangeRequestItem[];
  spec?: RichDoc;
  acceptanceCriteria: CrAcceptanceCriterion[];
  testScenarios: CrTestScenario[];
  /** `category` é code de `CatalogItem` de kind `IMPACT_CATEGORY`. */
  impacts: CrImpact[];
  /** Obrigatória para submeter (RN-GOV-03). */
  proposedEffectiveDate?: string;
  releaseId?: string;
  approvals: CrApproval[];
  /** Trilha própria, mesma mecânica da auditoria do documento. */
  events: DocEvent[];
  createdAt: string;
};

export const ChangeRequestSchema: z.ZodType<ChangeRequest> = z
  .object({
    id: idSchema,
    code: codeSchema,
    title: z.string().min(1),
    status: CrStatusSchema,
    motivators: z.array(codeSchema),
    motivationText: RichDocSchema.optional(),
    requestedBy: z.string().min(1),
    owner: z.string().min(1).optional(),
    priority: CrPrioritySchema.optional(),
    items: z.array(ChangeRequestItemSchema),
    spec: RichDocSchema.optional(),
    acceptanceCriteria: z.array(CrAcceptanceCriterionSchema),
    testScenarios: z.array(CrTestScenarioSchema),
    impacts: z.array(CrImpactSchema),
    proposedEffectiveDate: isoDateSchema.optional(),
    releaseId: idSchema.optional(),
    approvals: z.array(CrApprovalSchema),
    events: z.array(z.lazy(() => DocEventSchema)),
    createdAt: isoDateSchema,
  })
  .strict();

export type ReleaseStatus = 'PLANNED' | 'IN_DEVELOPMENT' | 'PUBLISHED' | 'CANCELLED';
export const ReleaseStatusSchema: z.ZodType<ReleaseStatus> = z.enum([
  'PLANNED',
  'IN_DEVELOPMENT',
  'PUBLISHED',
  'CANCELLED',
]);

/** Agrupa CRs (`ChangeRequest.releaseId`) e publica os rascunhos deles em bloco (RN-GOV-05, S36). */
export type Release = {
  id: string;
  /** "2026.09.01" — único no documento e imutável (I31, S32b). */
  code: string;
  name?: string;
  plannedDate?: string;
  status: ReleaseStatus;
  publishedAt?: string;
  publishedBy?: string;
  notes?: string;
  createdAt: string;
};

export const ReleaseSchema: z.ZodType<Release> = z
  .object({
    id: idSchema,
    // `2026.09.01` tem ponto: `code` de release NÃO casa CODE_REGEX (docs/03 §1)
    // — é um rótulo de calendário, não um identificador de referência cruzada.
    code: z.string().min(1),
    name: z.string().min(1).optional(),
    plannedDate: isoDateSchema.optional(),
    status: ReleaseStatusSchema,
    publishedAt: isoDateSchema.optional(),
    publishedBy: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
    createdAt: isoDateSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// §1 Estrutura de topo
// ---------------------------------------------------------------------------
// #region: 1-estrutura-de-topo

/**
 * Papéis de acesso (docs/14-plataforma-local.md §6, ADR-003). Ordem crescente
 * de poder — `ROLE_RANK` em `./roles` depende desta ordem para comparação.
 */
export type Role = 'READER' | 'EDITOR' | 'PUBLISHER' | 'ADMIN';
export const ROLES: readonly Role[] = ['READER', 'EDITOR', 'PUBLISHER', 'ADMIN'];
export const RoleSchema: z.ZodType<Role> = z.enum(['READER', 'EDITOR', 'PUBLISHER', 'ADMIN']);

/** Papel de quem não está na lista — nunca `PUBLISHER`/`ADMIN` (docs/14 §6). */
export type DefaultRole = 'READER' | 'EDITOR';
export const DefaultRoleSchema: z.ZodType<DefaultRole> = z.enum(['READER', 'EDITOR']);

export type AclEntry = {
  username: string;
  role: Role;
};

export const AclEntrySchema: z.ZodType<AclEntry> = z
  .object({
    username: z.string().min(1),
    role: RoleSchema,
  })
  .strict();

/**
 * ACL do documento (`meta.acl?`, schemaVersion 4, docs/14 §6). Ausente ou com
 * `users` vazio = modo aberto: todo mundo é `PUBLISHER` (`resolveRole`, em
 * `./roles`).
 */
export type Acl = {
  users: AclEntry[];
  defaultRole: DefaultRole;
};

export const AclSchema: z.ZodType<Acl> = z
  .object({
    users: z.array(AclEntrySchema),
    defaultRole: DefaultRoleSchema,
  })
  .strict();

export type DocumentMeta = {
  id: string;
  name: string;
  description?: string;
  revision: number;
  savedAt: string | null;
  savedBy: string | null;
  appVersion: string;
  createdAt: string;
  /** Papéis de acesso — ausente = modo aberto (docs/14 §6). */
  acl?: Acl;
};

export const DocumentMetaSchema: z.ZodType<DocumentMeta> = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    revision: z.number().int().nonnegative(),
    savedAt: z.union([isoDateSchema, z.null()]),
    savedBy: z.union([z.string().min(1), z.null()]),
    appVersion: z.string().min(1),
    createdAt: isoDateSchema,
    acl: AclSchema.optional(),
  })
  .strict();

export type PolicyOpsDocument = {
  schemaVersion: 5;
  meta: DocumentMeta;
  variables: Variable[];
  compatibility: CompatibilityRule[];
  catalog: CatalogItem[];
  projects: Project[];
  matrices: Matrix[];
  templates: Template[];
  importProfiles: ImportProfile[];
  /** Árvore de política, achatada (§12) — plana no arquivo, hierárquica por `parentId`. */
  components: PolicyComponent[];
  /** Solicitações de alteração (§13) — declaradas na S32a, escritas a partir da S32b. */
  changeRequests: ChangeRequest[];
  /** Releases (§13) — declaradas na S32a, escritas a partir da S32b. */
  releases: Release[];
  /** Evidências e imagens embutidas (§9) — ausente quando não há nenhuma. */
  attachments?: Attachment[];
  events: DocEvent[];
};

/**
 * 5 desde a sessão 32a — núcleo do épico Governança
 * (`14-governanca-de-alteracoes.md` §3.5): `components`, `changeRequests` e
 * `releases` no topo, `Attachment` discriminado por `kind`, `PolicyComponent`/
 * `ComponentVersion`, `RichDoc`, kinds de catálogo `MOTIVATOR` e
 * `IMPACT_CATEGORY`, e dois campos opcionais em `Project`. Migração 4 → 5 em
 * `migrate.ts`; nota em `03-modelo-do-documento.md` §10.
 *
 * `ImportProfile` é importado de `../import/profile` (S21) em vez de
 * redeclarado aqui — ver o comentário em `./primitives` sobre o ciclo que essa
 * importação evita.
 */
export const CURRENT_SCHEMA_VERSION = 5 as const;

export const PolicyOpsDocumentSchema: z.ZodType<PolicyOpsDocument> = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    meta: DocumentMetaSchema,
    variables: z.array(VariableSchema),
    compatibility: z.array(CompatibilityRuleSchema),
    catalog: z.array(CatalogItemSchema),
    projects: z.array(ProjectSchema),
    matrices: z.array(MatrixSchema),
    templates: z.array(TemplateSchema),
    importProfiles: z.array(z.lazy(() => ImportProfileSchema)),
    components: z.array(PolicyComponentSchema),
    changeRequests: z.array(ChangeRequestSchema),
    releases: z.array(ReleaseSchema),
    attachments: z.array(AttachmentSchema).optional(),
    events: z.array(DocEventSchema),
  })
  .strict();
