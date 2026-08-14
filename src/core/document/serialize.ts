import type {
  Acl,
  AclEntry,
  Axis,
  AxisLevel,
  CatalogItem,
  Cell,
  CompatibilityRule,
  CompatibilityVersion,
  Domain,
  DocEvent,
  DocumentMeta,
  Matrix,
  MatrixVersion,
  PolicyOpsDocument,
  Project,
  SeedRule,
  Template,
  Variable,
  VariableVersion,
} from './schema';

/**
 * `serialize` / `deserialize` / `hashDocument` — docs/03-modelo-do-documento.md
 * §1: JSON legível, chaves em ordem estável, campos vazios omitidos (nunca
 * `null`). A ordem é imposta por `canonicalizeDocument`, independente da
 * ordem de inserção de quem construiu o objeto — não dependemos de que
 * cada comando (Sessão 04+) construa os literais na ordem "certa".
 */

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

function sortedRecord<V>(record: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = record[key] as V;
  }
  return out;
}

/** Ordena recursivamente as chaves de um valor JSON arbitrário (usado só em `DocEvent.payload`). */
function deepSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepSortKeys);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = deepSortKeys(record[key]);
    }
    return out;
  }
  return value;
}

const DOMAIN_KEYS = [
  'code',
  'label',
  'shortLabel',
  'position',
  'color',
  'rangeMin',
  'rangeMax',
  'minInclusive',
  'maxInclusive',
  'isCatchAll',
  'groupingRanges',
] as const;
function canonicalDomain(d: Domain): Domain {
  return pick(d, DOMAIN_KEYS);
}

const VARIABLE_VERSION_KEYS = [
  'id',
  'number',
  'state',
  'notes',
  'createdAt',
  'createdBy',
  'publishedAt',
  'publishedBy',
  'domains',
  'groupingDimensions',
  'boundaryMode',
] as const;
function canonicalVariableVersion(v: VariableVersion): VariableVersion {
  return { ...pick(v, VARIABLE_VERSION_KEYS), domains: v.domains.map(canonicalDomain) };
}

const VARIABLE_KEYS = ['id', 'code', 'name', 'description', 'type', 'archivedAt', 'createdAt', 'versions'] as const;
function canonicalVariable(v: Variable): Variable {
  return { ...pick(v, VARIABLE_KEYS), versions: v.versions.map(canonicalVariableVersion) };
}

const COMPATIBILITY_VERSION_KEYS = [
  'id',
  'number',
  'state',
  'notes',
  'createdAt',
  'createdBy',
  'publishedAt',
  'publishedBy',
  'parentVariableVersionId',
  'childVariableVersionId',
  'allow',
  'defaultForUnlisted',
] as const;
function canonicalCompatibilityVersion(v: CompatibilityVersion): CompatibilityVersion {
  return { ...pick(v, COMPATIBILITY_VERSION_KEYS), allow: sortedRecord(v.allow) };
}

const COMPATIBILITY_RULE_KEYS = [
  'id',
  'code',
  'name',
  'description',
  'parentVariableId',
  'childVariableId',
  'archivedAt',
  'createdAt',
  'versions',
] as const;
function canonicalCompatibilityRule(r: CompatibilityRule): CompatibilityRule {
  return { ...pick(r, COMPATIBILITY_RULE_KEYS), versions: r.versions.map(canonicalCompatibilityVersion) };
}

const CATALOG_ITEM_KEYS = [
  'id',
  'kind',
  'code',
  'label',
  'description',
  'color',
  'numericValue',
  'group',
  'position',
  'archivedAt',
  'createdAt',
] as const;
function canonicalCatalogItem(item: CatalogItem): CatalogItem {
  return pick(item, CATALOG_ITEM_KEYS);
}

const PROJECT_KEYS = ['id', 'code', 'name', 'description', 'position', 'archivedAt', 'createdAt'] as const;
function canonicalProject(p: Project): Project {
  return pick(p, PROJECT_KEYS);
}

const AXIS_LEVEL_KEYS = ['id', 'variableId', 'variableVersionId', 'label', 'domains'] as const;
function canonicalAxisLevel(l: AxisLevel): AxisLevel {
  return { ...pick(l, AXIS_LEVEL_KEYS), domains: l.domains.map(canonicalDomain) };
}

const AXIS_KEYS = ['role', 'levels', 'tuples', 'manualSuppressions', 'derivedFrom'] as const;
function canonicalAxis(axis: Axis): Axis {
  return {
    ...pick(axis, AXIS_KEYS),
    levels: axis.levels.map(canonicalAxisLevel),
    derivedFrom: pick(axis.derivedFrom, ['compatibilityVersionIds'] as const),
  };
}

const CELL_KEYS = ['decision', 'offer', 'limit', 'limitOverride', 'color', 'note', 'attrs'] as const;
function canonicalCell(cell: Cell): Cell {
  const picked = pick(cell, CELL_KEYS);
  if (picked.attrs) picked.attrs = sortedRecord(picked.attrs);
  return picked;
}

const MATRIX_VERSION_KEYS = [
  'id',
  'number',
  'state',
  'notes',
  'baseVersionId',
  'createdAt',
  'createdBy',
  'publishedAt',
  'publishedBy',
  'effectiveFrom',
  'effectiveTo',
  'archivedAt',
  'axes',
  'cells',
] as const;
function canonicalMatrixVersion(v: MatrixVersion): MatrixVersion {
  const cells: Record<string, Cell> = {};
  for (const key of Object.keys(v.cells).sort()) {
    cells[key] = canonicalCell(v.cells[key]!);
  }
  return {
    ...pick(v, MATRIX_VERSION_KEYS),
    axes: { x: canonicalAxis(v.axes.x), y: canonicalAxis(v.axes.y) },
    cells,
  };
}

const MATRIX_KEYS = [
  'id',
  'projectId',
  'code',
  'name',
  'description',
  'tags',
  'archivedAt',
  'createdAt',
  'versions',
] as const;
function canonicalMatrix(m: Matrix): Matrix {
  return { ...pick(m, MATRIX_KEYS), versions: m.versions.map(canonicalMatrixVersion) };
}

function canonicalSeedRule(rule: SeedRule): SeedRule {
  return {
    when: pick(rule.when, ['x', 'y'] as const),
    set: pick(rule.set, ['decision', 'offer', 'limit', 'color'] as const),
  };
}

const TEMPLATE_KEYS = [
  'id',
  'code',
  'name',
  'description',
  'axes',
  'defaults',
  'seedRules',
  'archivedAt',
  'createdAt',
] as const;
function canonicalTemplate(t: Template): Template {
  return {
    ...pick(t, TEMPLATE_KEYS),
    axes: {
      x: { levels: t.axes.x.levels.map((l) => pick(l, ['variableId', 'label'] as const)) },
      y: { levels: t.axes.y.levels.map((l) => pick(l, ['variableId', 'label'] as const)) },
    },
    defaults: t.defaults ? pick(t.defaults, ['decision', 'offer', 'limit'] as const) : undefined,
    seedRules: t.seedRules.map(canonicalSeedRule),
  };
}

const DOC_EVENT_KEYS = ['id', 'at', 'actor', 'type', 'scope', 'summary', 'payload'] as const;
function canonicalDocEvent(e: DocEvent): DocEvent {
  return {
    ...pick(e, DOC_EVENT_KEYS),
    scope: pick(e.scope, ['projectId', 'matrixId', 'versionId', 'variableId', 'compatibilityId'] as const),
    payload: e.payload ? (deepSortKeys(e.payload) as Record<string, unknown>) : undefined,
  };
}

const ACL_ENTRY_KEYS = ['username', 'role'] as const;
function canonicalAclEntry(entry: AclEntry): AclEntry {
  return pick(entry, ACL_ENTRY_KEYS);
}

const ACL_KEYS = ['users', 'defaultRole'] as const;
function canonicalAcl(acl: Acl): Acl {
  return { ...pick(acl, ACL_KEYS), users: acl.users.map(canonicalAclEntry) };
}

const DOCUMENT_META_KEYS = [
  'id',
  'name',
  'description',
  'revision',
  'savedAt',
  'savedBy',
  'appVersion',
  'createdAt',
  'acl',
] as const;
function canonicalDocumentMeta(meta: DocumentMeta): DocumentMeta {
  const picked = pick(meta, DOCUMENT_META_KEYS);
  if (picked.acl) picked.acl = canonicalAcl(picked.acl);
  return picked;
}

const DOCUMENT_KEYS = [
  'schemaVersion',
  'meta',
  'variables',
  'compatibility',
  'catalog',
  'projects',
  'matrices',
  'templates',
  'importProfiles',
  'events',
] as const;

export function canonicalizeDocument(doc: PolicyOpsDocument): PolicyOpsDocument {
  return {
    ...pick(doc, DOCUMENT_KEYS),
    meta: canonicalDocumentMeta(doc.meta),
    variables: doc.variables.map(canonicalVariable),
    compatibility: doc.compatibility.map(canonicalCompatibilityRule),
    catalog: doc.catalog.map(canonicalCatalogItem),
    projects: doc.projects.map(canonicalProject),
    matrices: doc.matrices.map(canonicalMatrix),
    templates: doc.templates.map(canonicalTemplate),
    // `ImportProfile` não passa por picker próprio — vem do comando/UI já com
    // os campos exatos do schema (`.strict()` no Zod garante isso); só o
    // pass-through evita perder o campo, sem reordenar as chaves internas.
    importProfiles: doc.importProfiles,
    events: doc.events.map(canonicalDocEvent),
  };
}

/** `JSON.stringify` com indentação 2, chaves em ordem estável, campos vazios omitidos. */
export function serialize(doc: PolicyOpsDocument): string {
  return JSON.stringify(canonicalizeDocument(doc), null, 2);
}

export function deserialize(text: string): unknown {
  return JSON.parse(text);
}

/** SHA-256 via `crypto.subtle`, em hexadecimal. */
export async function hashDocument(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
