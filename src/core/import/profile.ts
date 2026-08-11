import { z } from 'zod';
import { CODE_REGEX, codeSchema, idSchema, isoDateSchema } from '../document/schema';
import type { PolicyOpsDocument } from '../document/schema';
import { normalizeText } from '../library/text-normalize';
import { MAX_AXIS_LEVELS } from '../axes/tuples';
import { importIssue, type ImportIssue } from './issues';
import type { DelimitedFormat, Delimiter } from './parse-table';
import { DELIMITERS } from './parse-table';

/**
 * O perfil de carga — docs/12-carga-de-matrizes.md §5.4 e
 * docs/03-modelo-do-documento.md §7.1.
 *
 * O perfil é **configuração, não histórico**: ele diz como as colunas do
 * arquivo viram matriz, eixo e célula. A gravação dele dentro do documento
 * (`importProfiles`) entra na S23; aqui ele já é o contrato do motor, e o
 * documento é aceito com ou sem o campo — é o que permite planejar uma carga
 * antes de o `schemaVersion: 3` existir.
 */

// ---------------------------------------------------------------------------
// Tipos (§5.4)
// ---------------------------------------------------------------------------

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

/**
 * Documento com os perfis de carga. `importProfiles` só entra no schema na
 * S23; até lá o motor lê o campo quando ele existe e trata a ausência como
 * lista vazia.
 */
export type DocumentWithProfiles = PolicyOpsDocument & { importProfiles?: ImportProfile[] };

export function documentProfiles(doc: DocumentWithProfiles): ImportProfile[] {
  return doc.importProfiles ?? [];
}

// ---------------------------------------------------------------------------
// Zod (§5.4)
// ---------------------------------------------------------------------------

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
      .object({ role: z.enum(['X', 'Y']), level: z.number().int().nonnegative(), variableId: idSchema })
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
    codePrefix: z.string().regex(/^[A-Z0-9_]*$/, 'o prefixo de tag só aceita A-Z, 0-9 e "_".').optional(),
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
// Normalização de valores
// ---------------------------------------------------------------------------

/**
 * Prefixo de ordenação: uma ou duas letras/dígitos seguidas de `.` ou `)`.
 * `a.RISCO BAIXO` → `RISCO BAIXO`, `y. Sem Rest` → `Sem Rest`. O traço **não**
 * entra: em `G1 - BHV` ele separa duas partes do nome, não uma ordenação.
 */
const ORDERING_PREFIX = /^[A-Za-z0-9]{1,2}\s*[.)]\s*/;

/**
 * Texto do arquivo → `code` (§5.4): maiúsculas, sem acento, sem prefixo de
 * ordenação, espaço e pontuação viram `_`. O resultado casa `^[A-Z0-9_]+$`;
 * texto sem nenhum caractere aproveitável devolve `''`, e o chamador trata
 * como valor não mapeado (RN-16).
 */
export function normalizeValue(text: string): string {
  return normalizeText(text.replace(ORDERING_PREFIX, ''))
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Texto do arquivo → rótulo de exibição, usado por `nameTemplate`:
 * `c.RISCO ALTO` → `Risco Alto`, `G4` → `G4`. Palavra curta com dígito é
 * código (`G4`, `HVI3`) e fica como está; o resto vira capitalizado.
 */
export function humanizeValue(text: string): string {
  const withoutPrefix = text.replace(ORDERING_PREFIX, '').trim();
  return withoutPrefix
    .split(/\s+/)
    .map((word) => {
      if (/\d/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/** O `code` de um valor de coluna: o `valueMap` do perfil e, sem ele, a normalização. */
export function mapColumnValue(mapping: ColumnMapping, raw: string): string {
  const mapped = mapping.valueMap?.[raw];
  if (mapped !== undefined) return mapped;
  const trimmed = raw.trim();
  const byTrimmed = trimmed === raw ? undefined : mapping.valueMap?.[trimmed];
  return byTrimmed ?? normalizeValue(raw);
}

/** O valor está na lista de descarte da coluna? Compara texto cru e normalizado. */
export function isIgnoredValue(mapping: ColumnMapping, raw: string): boolean {
  const ignored = mapping.ignoredValues;
  if (ignored === undefined) return false;
  const normalized = normalizeValue(raw);
  return ignored.some((entry) => entry === raw || normalizeValue(entry) === normalized);
}

// ---------------------------------------------------------------------------
// Leitura do perfil
// ---------------------------------------------------------------------------

export function columnsWithRole(profile: ImportProfile, role: ColumnRole): ColumnMapping[] {
  return profile.columns.filter((column) => column.role === role);
}

/** Colunas de eixo de um papel, já ordenadas por nível (0 = mais externo). */
export function axisColumns(profile: ImportProfile, role: 'X' | 'Y'): ColumnMapping[] {
  return columnsWithRole(profile, 'AXIS')
    .filter((column) => column.axis?.role === role)
    .sort((a, b) => a.axis!.level - b.axis!.level);
}

/** Colunas de valor que **não** entram no desdobramento — alimentam toda célula da linha. */
export function sharedValueColumns(profile: ImportProfile): ColumnMapping[] {
  const unpivoted = new Set((profile.unpivot?.options ?? []).map((option) => option.column));
  return columnsWithRole(profile, 'VALUE').filter((column) => !unpivoted.has(column.column));
}

/** `MTZ_{CLUSTER_GRUPO}_{CANAL}` + valores → o texto final. Marcador sem valor vira `''`. */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([^{}]+)\}/g, (_match, key: string) => values[key] ?? '');
}

/** Os marcadores citados por um template, na ordem em que aparecem. */
export function templatePlaceholders(template: string): string[] {
  return [...template.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!);
}

/**
 * A decisão de uma célula a partir da oferta (RN-11, DEC-CARGA-004): a primeira
 * regra `when` que casa, e o `otherwise` como rede. Sem regra aplicável,
 * `undefined` — o que `validateProfile` já impede.
 */
export function decisionForOffer(rules: readonly DecisionRule[], offer: string | undefined): string | undefined {
  for (const rule of rules) {
    if ('otherwise' in rule) return rule.otherwise;
    if (offer !== undefined && rule.when.equals.includes(offer)) return rule.setDecision;
  }
  return undefined;
}

/** As tags de uma matriz a partir das `tagRules` e dos valores da chave (US-09). */
export function tagsForKey(profile: ImportProfile, values: Record<string, string>): string[] {
  const tags: string[] = [];
  for (const rule of profile.tagRules) {
    let value: string | undefined;
    if (rule.source === 'FIXED') value = rule.code;
    else if (rule.source === 'UNPIVOT') value = values[profile.unpivot?.code ?? ''];
    else value = rule.column === undefined ? undefined : values[rule.column];
    if (value === undefined || value === '') continue;
    const code = rule.source === 'FIXED' ? value : `${rule.codePrefix ?? ''}${value}`;
    if (!CODE_REGEX.test(code) || tags.includes(code)) continue;
    tags.push(code);
  }
  return tags;
}

// ---------------------------------------------------------------------------
// RN-19 — reconhecimento pelo cabeçalho
// ---------------------------------------------------------------------------

/**
 * O perfil salvo cujo `signature` é **idêntico** ao cabeçalho — mesmos nomes,
 * mesma ordem (RN-19). Semelhança não conta: mapear coluna errada por nome
 * parecido é exatamente o que a regra existe para evitar.
 */
export function matchImportProfile(
  doc: DocumentWithProfiles,
  header: readonly string[],
): ImportProfile | undefined {
  return documentProfiles(doc).find(
    (profile) =>
      profile.signature.length === header.length &&
      profile.signature.every((name, index) => name === header[index]),
  );
}

// ---------------------------------------------------------------------------
// I21 / I22 — validação
// ---------------------------------------------------------------------------

/** §5.2: de 1 a 4 colunas de partição. */
export const MAX_PARTITION_COLUMNS = 4;

function invalid(message: string, details?: Record<string, unknown>): ImportIssue {
  return importIssue('IMPORT_PROFILE_INVALID', message, details === undefined ? {} : { details });
}

function validateAxis(profile: ImportProfile, doc: PolicyOpsDocument, role: 'X' | 'Y'): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const columns = axisColumns(profile, role);
  if (columns.length === 0) {
    issues.push(invalid(`O perfil não declara nenhum nível para o eixo ${role}.`, { role }));
    return issues;
  }
  if (columns.length > MAX_AXIS_LEVELS) {
    issues.push(
      invalid(
        `O eixo ${role} tem ${columns.length} níveis; o máximo é ${MAX_AXIS_LEVELS} (I13).`,
        { role, levels: columns.length },
      ),
    );
  }
  columns.forEach((column, index) => {
    if (column.axis!.level !== index) {
      issues.push(
        invalid(
          `Os níveis do eixo ${role} precisam ser contíguos a partir de 0 — encontrei o nível ${column.axis!.level} na posição ${index}.`,
          { role, column: column.column, level: column.axis!.level },
        ),
      );
    }
  });
  const variableIds = columns.map((column) => column.axis!.variableId);
  for (const variableId of new Set(variableIds)) {
    if (doc.variables.some((variable) => variable.id === variableId)) continue;
    issues.push(
      invalid(`O eixo ${role} referencia uma variável que não existe neste documento (I22).`, {
        role,
        variableId,
      }),
    );
  }
  if (new Set(variableIds).size !== variableIds.length) {
    issues.push(invalid(`O eixo ${role} usa a mesma variável em dois níveis (I13).`, { role }));
  }
  return issues;
}

/**
 * I21 e I22 (docs/03 §9), mais as restrições de papel de §5.2. Devolve
 * `ImportIssue[]` em vez de lançar: o passo 2 do assistente mostra todos os
 * problemas de uma vez, e não o primeiro.
 */
export function validateProfile(doc: DocumentWithProfiles, profile: ImportProfile): ImportIssue[] {
  const parsed = ImportProfileSchema.safeParse(profile);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) =>
      invalid(
        `Perfil de carga inválido em "${issue.path.join('.') || 'raiz'}": ${issue.message}`,
        { path: issue.path.join('.') },
      ),
    );
  }

  const issues: ImportIssue[] = [];

  if (
    documentProfiles(doc).some(
      (candidate) => candidate.code === profile.code && candidate.id !== profile.id,
    )
  ) {
    issues.push(
      importIssue(
        'IMPORT_PROFILE_DUPLICATE',
        `Já existe um perfil de carga com o código "${profile.code}" neste documento.`,
        { details: { code: profile.code } },
      ),
    );
  }

  if (!doc.projects.some((project) => project.id === profile.projectId)) {
    issues.push(
      invalid('O perfil aponta para um projeto que não existe neste documento (I21).', {
        projectId: profile.projectId,
      }),
    );
  }

  const names = profile.columns.map((column) => column.column);
  for (const [index, name] of names.entries()) {
    if (names.indexOf(name) !== index) {
      issues.push(invalid(`A coluna "${name}" está mapeada duas vezes no perfil.`, { column: name }));
    }
  }

  const partitions = columnsWithRole(profile, 'PARTITION');
  if (partitions.length === 0) {
    issues.push(invalid('O perfil precisa de ao menos uma coluna de partição (I21).'));
  }
  if (partitions.length > MAX_PARTITION_COLUMNS) {
    issues.push(
      invalid(
        `O perfil tem ${partitions.length} colunas de partição; o máximo é ${MAX_PARTITION_COLUMNS}.`,
        { partitions: partitions.length },
      ),
    );
  }

  issues.push(...validateAxis(profile, doc, 'X'), ...validateAxis(profile, doc, 'Y'));

  const xVariables = new Set(axisColumns(profile, 'X').map((column) => column.axis!.variableId));
  for (const column of axisColumns(profile, 'Y')) {
    if (xVariables.has(column.axis!.variableId)) {
      issues.push(
        invalid('A mesma variável não pode aparecer nos dois eixos da matriz (I14).', {
          variableId: column.axis!.variableId,
        }),
      );
    }
  }

  for (const column of profile.columns) {
    if (column.role === 'AXIS' && column.axis === undefined) {
      issues.push(invalid(`A coluna "${column.column}" é de eixo mas não declara eixo e nível.`, { column: column.column }));
    }
    if (column.role === 'VALUE' && column.value === undefined) {
      issues.push(invalid(`A coluna "${column.column}" é de valor mas não declara o campo alvo.`, { column: column.column }));
    }
    if (column.role === 'CHECK' && column.check === undefined) {
      issues.push(invalid(`A coluna "${column.column}" é de conferência mas não declara o valor esperado.`, { column: column.column }));
    }
  }

  const values = columnsWithRole(profile, 'VALUE');
  if (values.length === 0) {
    issues.push(invalid('O perfil precisa de ao menos uma coluna de valor (§5.2).'));
  }

  const otherwiseCount = profile.decisionRules.filter((rule) => 'otherwise' in rule).length;
  if (otherwiseCount !== 1) {
    issues.push(
      invalid(
        `As regras de decisão precisam terminar com exatamente uma regra "otherwise" — encontrei ${otherwiseCount} (I21).`,
        { otherwiseCount },
      ),
    );
  } else if (!('otherwise' in profile.decisionRules[profile.decisionRules.length - 1]!)) {
    issues.push(invalid('A regra "otherwise" precisa ser a última das regras de decisão (I21).'));
  }

  const unpivot = profile.unpivot;
  if (unpivot !== undefined) {
    if (unpivot.options.length === 0) {
      issues.push(invalid('O desdobramento precisa de ao menos uma opção.', { unpivot: unpivot.code }));
    }
    const codes = new Set<string>();
    for (const option of unpivot.options) {
      if (codes.has(option.code)) {
        issues.push(invalid(`A opção "${option.code}" do desdobramento aparece duas vezes.`, { code: option.code }));
      }
      codes.add(option.code);
      const column = profile.columns.find((candidate) => candidate.column === option.column);
      if (column === undefined || column.role !== 'VALUE') {
        issues.push(
          invalid(
            `A opção "${option.code}" do desdobramento aponta para "${option.column}", que não é uma coluna de valor.`,
            { column: option.column },
          ),
        );
      }
    }
  }

  const knownPlaceholders = new Set<string>([
    ...partitions.map((column) => column.column),
    ...(unpivot === undefined ? [] : [unpivot.code]),
  ]);
  for (const template of [profile.codeTemplate, profile.nameTemplate]) {
    for (const placeholder of templatePlaceholders(template)) {
      if (knownPlaceholders.has(placeholder)) continue;
      issues.push(
        invalid(
          `O marcador "{${placeholder}}" de "${template}" não corresponde a nenhuma coluna de partição nem ao desdobramento.`,
          { placeholder },
        ),
      );
    }
  }
  if (!/^[A-Z0-9_{}]+$/.test(profile.codeTemplate)) {
    issues.push(
      invalid(
        `O padrão de código "${profile.codeTemplate}" produziria um código fora de ^[A-Z0-9_]+$.`,
        { codeTemplate: profile.codeTemplate },
      ),
    );
  }

  for (const rule of profile.tagRules) {
    if (rule.source === 'PARTITION') {
      if (!partitions.some((column) => column.column === rule.column)) {
        issues.push(
          invalid(`A regra de tag do grupo "${rule.group}" aponta para uma coluna que não é de partição.`, {
            column: rule.column,
          }),
        );
      }
    } else if (rule.source === 'UNPIVOT') {
      if (unpivot === undefined) {
        issues.push(
          invalid(`A regra de tag do grupo "${rule.group}" usa o desdobramento, que este perfil não declara.`, {
            group: rule.group,
          }),
        );
      }
    } else if (rule.code === undefined) {
      issues.push(invalid(`A regra de tag fixa do grupo "${rule.group}" não informa o código da tag.`, { group: rule.group }));
    }
  }

  return issues;
}

/** As colunas que o perfil mapeia e o arquivo não tem (§5.4). */
export function validateProfileAgainstHeader(
  profile: ImportProfile,
  header: readonly string[],
): ImportIssue[] {
  const present = new Set(header);
  const required = profile.columns.filter((column) => column.role !== 'IGNORE');
  return required
    .filter((column) => !present.has(column.column))
    .map((column) =>
      invalid(`A coluna "${column.column}", mapeada pelo perfil, não existe no arquivo.`, {
        column: column.column,
      }),
    );
}
