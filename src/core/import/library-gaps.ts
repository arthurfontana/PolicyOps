import { COLOR_PALETTES, suggestPaletteColors } from '../../lib/color-palettes';
import {
  CODE_REGEX,
  type CatalogItemKind,
  type Domain,
  type PolicyOpsDocument,
  type Variable,
  type VariableVersion,
} from '../document/schema';
import {
  axisColumns,
  columnsWithRole,
  isIgnoredValue,
  mapColumnValue,
  tagsForKey,
  type ColumnMapping,
  type ImportProfile,
} from './profile';
import type { ImportTable } from './parse-table';

/**
 * O que falta na biblioteca para a carga rodar — docs/12-carga-de-matrizes.md
 * US-04 e §5.4.
 *
 * **Só descreve** (RN-17, DEC-CARGA-008): a aplicação de células nunca cria
 * variável, domínio ou item de catálogo. O passo 3 do assistente mostra esta
 * lista, o usuário revisa item a item, e a criação sai pelos comandos normais
 * da biblioteca — não há caminho privilegiado de escrita.
 */

export type DomainsGap = {
  kind: 'DOMAINS';
  variableId: string;
  variableCode: string;
  variableName: string;
  /** Coluna do arquivo que alimenta o nível. */
  column: string;
  axis: 'X' | 'Y';
  level: number;
  /** A variável não tem nenhuma versão publicada — tudo nela falta. */
  variablePublished: boolean;
  /** Domínios faltantes, com rótulo original do arquivo e cor sugerida. */
  domains: Domain[];
};

export type CatalogGap = {
  kind: 'CATALOG';
  catalogKind: CatalogItemKind;
  items: Array<{ code: string; label: string }>;
};

export type CompatibilityGap = {
  kind: 'COMPATIBILITY';
  parentVariableId: string;
  parentVariableCode: string;
  childVariableId: string;
  childVariableCode: string;
  axis: 'X' | 'Y';
  /** Já existe regra publicada para o par — o mapa abaixo só a completa. */
  exists: boolean;
  /** Formato de `CompatibilityVersion.allow` (docs/03 §3). */
  allow: Record<string, string[]>;
  defaultForUnlisted: 'NONE';
  /** Pares observados no arquivo que a regra atual não permite. */
  missingPairs: Array<[string, string]>;
};

export type LibraryGap = DomainsGap | CatalogGap | CompatibilityGap;

// ---------------------------------------------------------------------------
// Leitura dos valores distintos do arquivo
// ---------------------------------------------------------------------------

/** Valor distinto de uma coluna: o `code` mapeado e o texto original. */
type DistinctValue = { code: string; label: string };

type ColumnReader = {
  mapping: ColumnMapping;
  index: number;
  values: Map<string, DistinctValue>;
};

function reader(mapping: ColumnMapping, header: readonly string[]): ColumnReader {
  return { mapping, index: header.indexOf(mapping.column), values: new Map() };
}

/** O que uma passada pelo arquivo produz: valores distintos, tuplas de eixo e partições. */
type FileSummary = {
  /** Caminhos distintos observados por eixo, um código por nível. */
  axisPaths: { X: string[][]; Y: string[][] };
  /** Combinações distintas de partição, com o `code` de cada coluna. */
  partitions: Array<Record<string, string>>;
};

/**
 * Percorre o arquivo uma única vez, acumulando os valores distintos de cada
 * coluna interessante, as tuplas de eixo e as combinações de partição — tudo
 * bounded pelo que o arquivo de fato traz, e não pelo produto do que ele
 * poderia trazer. Linha descartada por `ignoredValues` não contribui: ignorar
 * um valor é dizer "isso não existe na política", e criar o domínio dele seria
 * o contrário disso.
 */
function readFile(
  table: ImportTable,
  profile: ImportProfile,
  readers: ColumnReader[],
): FileSummary {
  const ignorable = profile.columns
    .filter((mapping) => mapping.ignoredValues !== undefined && mapping.ignoredValues.length > 0)
    .map((mapping) => ({ mapping, index: table.header.indexOf(mapping.column) }));

  const byRole = {
    X: readers.filter((entry) => entry.mapping.role === 'AXIS' && entry.mapping.axis!.role === 'X'),
    Y: readers.filter((entry) => entry.mapping.role === 'AXIS' && entry.mapping.axis!.role === 'Y'),
  };
  const partitionReaders = readers.filter((entry) => entry.mapping.role === 'PARTITION');

  const axisPaths: { X: string[][]; Y: string[][] } = { X: [], Y: [] };
  const seenPaths = { X: new Set<string>(), Y: new Set<string>() };
  const partitions: Array<Record<string, string>> = [];
  const seenPartitions = new Set<string>();

  const codeOf = (entry: ColumnReader, row: string[]): string => {
    const raw = (row[entry.index] ?? '').trim();
    const known = entry.values.get(raw);
    if (known !== undefined) return known.code;
    const code = mapColumnValue(entry.mapping, raw);
    if (raw !== '') entry.values.set(raw, { code, label: raw });
    return code;
  };

  for (const row of table.rows) {
    const ignored = ignorable.some(
      (entry) => entry.index >= 0 && isIgnoredValue(entry.mapping, row[entry.index] ?? ''),
    );
    if (ignored) continue;

    for (const role of ['X', 'Y'] as const) {
      const codes = byRole[role].map((entry) => codeOf(entry, row));
      const signature = codes.join('|');
      if (codes.length === 0 || seenPaths[role].has(signature)) continue;
      seenPaths[role].add(signature);
      axisPaths[role].push(codes);
    }

    const combo: Record<string, string> = {};
    for (const entry of partitionReaders) combo[entry.mapping.column] = codeOf(entry, row);
    const signature = Object.values(combo).join('|');
    if (!seenPartitions.has(signature)) {
      seenPartitions.add(signature);
      partitions.push(combo);
    }

    for (const entry of readers) {
      if (entry.index < 0 || entry.mapping.role === 'AXIS' || entry.mapping.role === 'PARTITION') {
        continue;
      }
      const raw = (row[entry.index] ?? '').trim();
      if (raw === '' || entry.values.has(raw)) continue;
      entry.values.set(raw, { code: mapColumnValue(entry.mapping, raw), label: raw });
    }
  }

  return { axisPaths, partitions };
}

/** Cor sugerida pela paleta oficial, sem sobrescrever cor já definida. */
function withSuggestedColors(domains: Domain[]): Domain[] {
  let result = domains;
  for (const palette of COLOR_PALETTES) {
    const suggested = suggestPaletteColors(result, palette.id);
    result = result.map((domain, index) =>
      domain.color === undefined ? suggested[index]! : domain,
    );
  }
  return result;
}

function publishedVersion(variable: Variable | undefined): VariableVersion | undefined {
  return variable?.versions.find((version) => version.state === 'PUBLISHED');
}

// ---------------------------------------------------------------------------
// computeLibraryGaps
// ---------------------------------------------------------------------------

export function computeLibraryGaps(
  doc: PolicyOpsDocument,
  table: ImportTable,
  profile: ImportProfile,
): LibraryGap[] {
  const axisReaders = (['X', 'Y'] as const).flatMap((role) =>
    axisColumns(profile, role).map((mapping) => reader(mapping, table.header)),
  );
  const valueReaders = columnsWithRole(profile, 'VALUE')
    .filter((mapping) => mapping.value?.field === 'offer' || mapping.value?.field === 'limit')
    .map((mapping) => reader(mapping, table.header));
  const partitionReaders = columnsWithRole(profile, 'PARTITION').map((mapping) =>
    reader(mapping, table.header),
  );

  const summary = readFile(table, profile, [...axisReaders, ...valueReaders, ...partitionReaders]);
  const gaps: LibraryGap[] = [];

  // 1. Domínios faltantes por variável de eixo.
  const byVariable = new Map<string, DomainsGap>();
  for (const entry of axisReaders) {
    const variableId = entry.mapping.axis!.variableId;
    const variable = doc.variables.find((candidate) => candidate.id === variableId);
    const published = publishedVersion(variable);
    const existing = new Set((published?.domains ?? []).map((domain) => domain.code));
    const missing: Domain[] = [];
    let position = published?.domains.length ?? 0;
    for (const value of entry.values.values()) {
      if (!CODE_REGEX.test(value.code) || existing.has(value.code)) continue;
      existing.add(value.code);
      missing.push({ code: value.code, label: value.label, position: position++ });
    }
    if (missing.length === 0) continue;
    const gap: DomainsGap = {
      kind: 'DOMAINS',
      variableId,
      variableCode: variable?.code ?? '',
      variableName: variable?.name ?? '',
      column: entry.mapping.column,
      axis: entry.mapping.axis!.role,
      level: entry.mapping.axis!.level,
      variablePublished: published !== undefined,
      domains: withSuggestedColors(missing),
    };
    const already = byVariable.get(variableId);
    if (already === undefined) {
      byVariable.set(variableId, gap);
      gaps.push(gap);
    } else {
      already.domains = withSuggestedColors([...already.domains, ...gap.domains]);
    }
  }

  // 2. Itens de catálogo faltantes por kind.
  const catalogGaps = new Map<CatalogItemKind, Map<string, string>>();
  const addCatalog = (kind: CatalogItemKind, code: string, label: string): void => {
    if (!CODE_REGEX.test(code)) return;
    if (doc.catalog.some((item) => item.kind === kind && item.code === code)) return;
    const bucket = catalogGaps.get(kind) ?? new Map<string, string>();
    if (!bucket.has(code)) bucket.set(code, label);
    catalogGaps.set(kind, bucket);
  };

  for (const entry of valueReaders) {
    const kind: CatalogItemKind = entry.mapping.value!.field === 'offer' ? 'OFFER' : 'LIMIT';
    for (const value of entry.values.values()) addCatalog(kind, value.code, value.label);
  }
  for (const rule of profile.decisionRules) {
    const code = 'otherwise' in rule ? rule.otherwise : rule.setDecision;
    addCatalog('DECISION', code, code);
  }
  for (const tag of tagsFromFile(profile, summary.partitions)) addCatalog('TAG', tag, tag);

  for (const [kind, bucket] of catalogGaps) {
    gaps.push({
      kind: 'CATALOG',
      catalogKind: kind,
      items: [...bucket].map(([code, label]) => ({ code, label })),
    });
  }

  // 3. Mapa de compatibilidade deduzido dos pares adjacentes do arquivo.
  for (const role of ['X', 'Y'] as const) {
    const levels = axisReaders.filter((entry) => entry.mapping.axis!.role === role);
    for (let index = 1; index < levels.length; index++) {
      const gap = compatibilityGap(doc, summary.axisPaths[role], index, levels);
      if (gap !== undefined) gaps.push(gap);
    }
  }

  return gaps;
}

/** As tags que a carga aplicaria, a partir das partições observadas e do desdobramento. */
function tagsFromFile(
  profile: ImportProfile,
  partitions: ReadonlyArray<Record<string, string>>,
): string[] {
  const codes = new Set<string>();
  const unpivot = profile.unpivot;
  for (const combo of partitions) {
    if (unpivot === undefined) {
      for (const code of tagsForKey(profile, combo)) codes.add(code);
      continue;
    }
    for (const option of unpivot.options) {
      for (const code of tagsForKey(profile, { ...combo, [unpivot.code]: option.code })) {
        codes.add(code);
      }
    }
  }
  return [...codes];
}

function compatibilityGap(
  doc: PolicyOpsDocument,
  paths: ReadonlyArray<readonly string[]>,
  index: number,
  levels: readonly ColumnReader[],
): CompatibilityGap | undefined {
  const parent = levels[index - 1]!;
  const child = levels[index]!;
  const parentVariableId = parent.mapping.axis!.variableId;
  const childVariableId = child.mapping.axis!.variableId;

  const observed = new Map<string, Set<string>>();
  for (const path of paths) {
    // Todo caminho tem um código por nível: `readFile` os monta juntos.
    const parentCode = path[index - 1]!;
    const childCode = path[index]!;
    if (!CODE_REGEX.test(parentCode) || !CODE_REGEX.test(childCode)) continue;
    const bucket = observed.get(parentCode) ?? new Set<string>();
    bucket.add(childCode);
    observed.set(parentCode, bucket);
  }
  if (observed.size === 0) return undefined;

  // Ordena os filhos pela posição do domínio na variável, quando ela existe —
  // o mapa proposto sai na mesma ordem em que o grid vai exibi-los.
  const childVariable = doc.variables.find((candidate) => candidate.id === childVariableId);
  const order = new Map(
    (publishedVersion(childVariable)?.domains ?? []).map((domain) => [domain.code, domain.position]),
  );
  const allow: Record<string, string[]> = {};
  for (const [parentCode, children] of observed) {
    allow[parentCode] = [...children].sort(
      (a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  const rule = doc.compatibility.find(
    (candidate) =>
      candidate.archivedAt === undefined &&
      candidate.parentVariableId === parentVariableId &&
      candidate.childVariableId === childVariableId &&
      candidate.versions.some((version) => version.state === 'PUBLISHED'),
  );
  const published = rule?.versions.find((version) => version.state === 'PUBLISHED');

  const missingPairs: Array<[string, string]> = [];
  if (published !== undefined) {
    for (const [parentCode, children] of Object.entries(allow)) {
      const allowed = published.allow[parentCode];
      for (const childCode of children) {
        if (allowed === undefined) {
          if (published.defaultForUnlisted === 'NONE') missingPairs.push([parentCode, childCode]);
          continue;
        }
        if (!allowed.includes(childCode)) missingPairs.push([parentCode, childCode]);
      }
    }
    if (missingPairs.length === 0) return undefined;
  }

  const parentVariable = doc.variables.find((candidate) => candidate.id === parentVariableId);
  return {
    kind: 'COMPATIBILITY',
    parentVariableId,
    parentVariableCode: parentVariable?.code ?? '',
    childVariableId,
    childVariableCode: childVariable?.code ?? '',
    axis: parent.mapping.axis!.role,
    exists: published !== undefined,
    allow,
    defaultForUnlisted: 'NONE',
    missingPairs,
  };
}
