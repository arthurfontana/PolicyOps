import { z } from 'zod';
import { DELIMITERS, type DelimitedFormat, type Delimiter } from '../import/parse-table';

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

// Mensagens de erro do Zod em pt-BR para o que não for coberto por
// `.regex(..., mensagem)` explícito (ex.: tipo errado, enum inválido).
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') {
        return { message: 'Campo obrigatório ausente.' };
      }
      return { message: `Tipo inválido: esperado ${issue.expected}, recebido ${issue.received}.` };
    case z.ZodIssueCode.invalid_enum_value:
      return {
        message: `Valor inválido: "${String(ctx.data)}" não está entre as opções permitidas (${issue.options.join(', ')}).`,
      };
    case z.ZodIssueCode.invalid_literal:
      return { message: `Valor inválido: esperado ${JSON.stringify(issue.expected)}.` };
    case z.ZodIssueCode.too_small:
      return { message: `Valor muito pequeno (mínimo: ${issue.minimum}).` };
    case z.ZodIssueCode.too_big:
      return { message: `Valor muito grande (máximo: ${issue.maximum}).` };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `Campos não reconhecidos neste escopo: ${issue.keys.join(', ')}.` };
    default:
      return { message: ctx.defaultError };
  }
});

// ---------------------------------------------------------------------------
// Primitivos
// ---------------------------------------------------------------------------

/** `code` casa `^[A-Z0-9_]+$` — nunca contém `|` nem `:`, separadores de caminho (docs/04-eixos-aninhados.md §2). */
export const CODE_REGEX = /^[A-Z0-9_]+$/;
/** Toda data é ISO 8601 em UTC, no formato produzido por `Date.prototype.toISOString()`. */
export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Todo decimal é string, nunca `number`. */
export const DECIMAL_REGEX = /^-?\d+(\.\d+)?$/;
/** Subconjunto de `DECIMAL_REGEX` sem parte fracionária — usado por `boundaryMode: 'INCLUSIVE_INTEGER'` (docs/03 §2). */
export const INTEGER_REGEX = /^-?\d+$/;
export const COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
/** Todo id é `nanoid(12)`: alfabeto padrão do nanoid, comprimento 12. */
export const NANOID_REGEX = /^[A-Za-z0-9_-]{12}$/;

export const idSchema = z.string().regex(NANOID_REGEX, 'id inválido: esperado nanoid(12).');
export const codeSchema = z
  .string()
  .regex(CODE_REGEX, 'code deve casar ^[A-Z0-9_]+$ — sem "|" nem ":", que são separadores de caminho.');
export const isoDateSchema = z.string().regex(ISO_DATE_REGEX, 'data deve ser ISO 8601 UTC.');
export const decimalSchema = z.string().regex(DECIMAL_REGEX, 'decimal deve ser uma string numérica.');
export const colorSchema = z.string().regex(COLOR_REGEX, 'cor deve casar #RRGGBB.');

// ---------------------------------------------------------------------------
// §2 Biblioteca de Variáveis
// ---------------------------------------------------------------------------

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

export type CatalogItemKind = 'DECISION' | 'OFFER' | 'LIMIT' | 'TAG';
export const CatalogItemKindSchema: z.ZodType<CatalogItemKind> = z.enum([
  'DECISION',
  'OFFER',
  'LIMIT',
  'TAG',
]);

export type CatalogItem = {
  id: string;
  kind: CatalogItemKind;
  code: string;
  label: string;
  description?: string;
  color?: string;
  numericValue?: string;
  /** Apenas `kind: 'TAG'`: faceta de filtro ("Canal", "Cluster") — docs/03 §4. */
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
// §5 Projetos e Matrizes
// ---------------------------------------------------------------------------

export type Project = {
  id: string;
  code: string;
  name: string;
  description?: string;
  position: number;
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
    archivedAt: isoDateSchema.optional(),
    createdAt: isoDateSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// §6 Versão de matriz
// ---------------------------------------------------------------------------

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
  /** Codes de `CatalogItem` de kind `TAG`, sem repetição (I20) — docs/03 §5. */
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
// §7.1 Perfis de carga
// ---------------------------------------------------------------------------

/**
 * O `ImportProfile` mora aqui porque é **parte do documento** (docs/03 §7.1):
 * `PolicyOpsDocumentSchema` precisa dele em tempo de inicialização de módulo, e
 * mantê-lo em `src/core/import/profile.ts` — que importa `codeSchema` e
 * companhia daqui — fecharia um ciclo de import com TDZ nas constantes Zod.
 * `profile.ts` continua sendo a porta de entrada do motor de carga: ele
 * reexporta estes tipos e é o dono de `validateProfile`, da normalização de
 * valores e da leitura do perfil. Os tipos auxiliares estão em docs/12 §5.4.
 */

export type ColumnRole = 'PARTITION' | 'AXIS' | 'VALUE' | 'CHECK' | 'IGNORE';
export type ValueField = 'offer' | 'limit' | 'note' | `attr:${string}`;
export type MissingRowPolicy = 'KEEP' | 'CLEAR';

export type ColumnMapping = {
  /** Nome exato no cabeçalho. */
  column: string;
  role: ColumnRole;
  axis?: { role: 'X' | 'Y'; level: number; variableId: string };
  value?: { field: ValueField };
  check?: { expected: string };
  /** Valor do arquivo → `code` (domínio ou item de catálogo). */
  valueMap?: Record<string, string>;
  /** Valores cujas linhas são descartadas, com aviso. */
  ignoredValues?: string[];
};

export type UnpivotDimension = {
  code: string;
  label: string;
  options: Array<{ column: string; code: string; label: string }>;
};

export type DecisionRule =
  | { when: { field: 'offer'; equals: string[] }; setDecision: string }
  | { otherwise: string };

export type TagRule = {
  source: 'PARTITION' | 'UNPIVOT' | 'FIXED';
  column?: string;
  group: string;
  codePrefix?: string;
  code?: string;
};

export type ImportProfile = {
  id: string;
  code: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt?: string;
  format: DelimitedFormat;
  /** Cabeçalho reconhecido, na ordem (RN-19). */
  signature: string[];
  projectId: string;
  columns: ColumnMapping[];
  unpivot?: UnpivotDimension;
  codeTemplate: string;
  nameTemplate: string;
  decisionRules: DecisionRule[];
  tagRules: TagRule[];
  missingRowPolicy: MissingRowPolicy;
  /** Só vale em matriz nova (RN-21). */
  suppressUnobserved: boolean;
};

export const DelimitedFormatSchema: z.ZodType<DelimitedFormat> = z
  .object({
    delimiter: z.enum([...DELIMITERS] as [Delimiter, ...Delimiter[]]),
    headerRow: z.number().int().positive(),
    hasBom: z.boolean(),
    trimValues: z.boolean(),
  })
  .strict();

const ValueFieldSchema: z.ZodType<ValueField> = z.union([
  z.literal('offer'),
  z.literal('limit'),
  z.literal('note'),
  z.string().regex(/^attr:.+$/, 'campo de valor deve ser offer, limit, note ou attr:<nome>.'),
]) as z.ZodType<ValueField>;

export const ColumnMappingSchema: z.ZodType<ColumnMapping> = z
  .object({
    column: z.string().min(1),
    role: z.enum(['PARTITION', 'AXIS', 'VALUE', 'CHECK', 'IGNORE']),
    axis: z
      .object({
        role: z.enum(['X', 'Y']),
        level: z.number().int().nonnegative(),
        variableId: idSchema,
      })
      .strict()
      .optional(),
    value: z.object({ field: ValueFieldSchema }).strict().optional(),
    check: z.object({ expected: z.string() }).strict().optional(),
    valueMap: z.record(z.string(), z.string()).optional(),
    ignoredValues: z.array(z.string()).optional(),
  })
  .strict();

export const UnpivotDimensionSchema: z.ZodType<UnpivotDimension> = z
  .object({
    code: codeSchema,
    label: z.string().min(1),
    options: z.array(
      z.object({ column: z.string().min(1), code: codeSchema, label: z.string().min(1) }).strict(),
    ),
  })
  .strict();

export const DecisionRuleSchema: z.ZodType<DecisionRule> = z.union([
  z
    .object({
      when: z.object({ field: z.literal('offer'), equals: z.array(z.string()) }).strict(),
      setDecision: codeSchema,
    })
    .strict(),
  z.object({ otherwise: codeSchema }).strict(),
]);

export const TagRuleSchema: z.ZodType<TagRule> = z
  .object({
    source: z.enum(['PARTITION', 'UNPIVOT', 'FIXED']),
    column: z.string().min(1).optional(),
    group: z.string().min(1),
    codePrefix: z
      .string()
      .regex(/^[A-Z0-9_]*$/, 'o prefixo de tag só aceita A-Z, 0-9 e "_".')
      .optional(),
    code: codeSchema.optional(),
  })
  .strict();

export const ImportProfileSchema: z.ZodType<ImportProfile> = z
  .object({
    id: idSchema,
    code: codeSchema,
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema.optional(),
    format: DelimitedFormatSchema,
    signature: z.array(z.string().min(1)),
    projectId: idSchema,
    columns: z.array(ColumnMappingSchema),
    unpivot: UnpivotDimensionSchema.optional(),
    codeTemplate: z.string().min(1),
    nameTemplate: z.string().min(1),
    decisionRules: z.array(DecisionRuleSchema),
    tagRules: z.array(TagRuleSchema),
    missingRowPolicy: z.enum(['KEEP', 'CLEAR']),
    suppressUnobserved: z.boolean(),
  })
  .strict();

// ---------------------------------------------------------------------------
// §8 Auditoria
// ---------------------------------------------------------------------------

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
  // Carga de matrizes — docs/03 §8 e docs/12 §5.6.
  'IMPORT_RUN',
  'IMPORT_PROFILE_SAVED',
  'MATRIX_TAGGED',
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
      })
      .strict(),
    summary: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// §1 Estrutura de topo
// ---------------------------------------------------------------------------

export type DocumentMeta = {
  id: string;
  name: string;
  description?: string;
  revision: number;
  savedAt: string | null;
  savedBy: string | null;
  appVersion: string;
  createdAt: string;
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
  })
  .strict();

export type PolicyOpsDocument = {
  schemaVersion: 3;
  meta: DocumentMeta;
  variables: Variable[];
  compatibility: CompatibilityRule[];
  catalog: CatalogItem[];
  projects: Project[];
  matrices: Matrix[];
  templates: Template[];
  /** Perfis de carga (docs/03 §7.1). */
  importProfiles: ImportProfile[];
  events: DocEvent[];
};

/**
 * 3 desde a sessão 23 — `importProfiles` no topo, `Matrix.tags` e
 * `CatalogItem.group` (docs/03 §10, migração 2 → 3 em `migrate.ts`, puramente
 * aditiva). A 1 → 2 da sessão 20 continua sendo a única não-aditiva do produto.
 */
export const CURRENT_SCHEMA_VERSION = 3 as const;

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
    importProfiles: z.array(ImportProfileSchema),
    events: z.array(DocEventSchema),
  })
  .strict();
