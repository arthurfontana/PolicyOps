import { snapshotDomains } from '../axes/domain-snapshot';
import { decodeCellKey, encodeCellKey } from '../axes/paths';
import {
  assertGridFits,
  collectPublishedCompatibility,
  generateTuples,
  MAX_COMBINATIONS,
} from '../axes/tuples';
import { diffCells } from '../diff/cells';
import { buildLimitCatalog, summarizeChanges } from '../diff/semantics';
import { EMPTY_DIFF_SUMMARY, type CellChange, type DiffSummary } from '../diff/types';
import type {
  Axis,
  Cell,
  Domain,
  Matrix,
  MatrixVersion,
  PolicyOpsDocument,
} from '../document/schema';
import { hashText, hashValue, stableStringify } from './hash';
import { hasBlockingIssue, importIssue, type ImportIssue } from './issues';
import { computeLibraryGaps, type LibraryGap } from './library-gaps';
import type { ImportTable } from './parse-table';
import {
  axisColumns,
  renderTemplate,
  tagsForKey,
  validateProfile,
  validateProfileAgainstHeader,
  type DocumentWithProfiles,
  type ImportProfile,
} from './profile';
import { resolveImport, type ResolvedMatrixKey, type ResolvedRow } from './resolve';

/**
 * O plano da carga — docs/12-carga-de-matrizes.md §5.4 e §5.5.
 *
 * `planImport` é **dry-run puro** (RN-13): lê o documento, o arquivo e o
 * perfil, e devolve, matriz por matriz, o que aconteceria. Não grava nada, não
 * cria rascunho e não toca na biblioteca — quem aplica é `import/apply` (S24),
 * e ele recalcula o plano antes de escrever (RN-14, DEC-CARGA-010).
 *
 * A comparação de células **não é reescrita aqui**: sai de `src/core/diff/`,
 * exatamente a mesma usada pela tela de comparação, para que "alterada" no
 * plano e "alterada" no diff signifiquem a mesma coisa (RN-03).
 */

export type MatrixPlanStatus =
  | 'NEW'
  | 'CHANGED'
  | 'UNCHANGED'
  | 'STRUCTURAL'
  | 'ABSENT_IN_FILE'
  | 'BLOCKED';

/** Tupla que o arquivo traz e o eixo da matriz não tem (RN-06). */
export type UnknownTuple = { path: string; role: 'X' | 'Y'; lines: number[] };

export type MatrixPlan = {
  key: string;
  code: string;
  name: string;
  tags: string[];
  status: MatrixPlanStatus;
  /** Por que `BLOCKED` ou `STRUCTURAL`. */
  reason?: string;
  matrixId?: string;
  baseVersionId?: string;
  baseVersionNumber?: number;
  /** Combinações efetivas, já sem as suprimidas. */
  combinations: number;
  /** Tuplas suprimidas por RN-21 — só em `NEW`, com `suppressUnobserved`. */
  suppressedCombinations: number;
  changes: CellChange[];
  summary: DiffSummary;
  /** Combinações do grid sem linha no arquivo (RN-07). */
  missingCombinations: string[];
  unknownTuples: UnknownTuple[];
  /**
   * Os eixos que a matriz **nova** teria, já com as tuplas efetivas e as
   * `manualSuppressions` de RN-21 — só em `NEW`. Em matriz existente os eixos
   * são os da versão-base, que a carga nunca altera (RN-01).
   */
  axes?: { x: PlannedAxis; y: PlannedAxis };
};

/** Um nível do eixo projetado: o pin da versão publicada e o snapshot de domínios. */
export type PlannedAxisLevel = {
  variableId: string;
  variableVersionId: string;
  label: string;
  domains: Domain[];
};

export type PlannedAxis = {
  role: 'X' | 'Y';
  levels: PlannedAxisLevel[];
  /** Tuplas efetivas, já sem as suprimidas. */
  tuples: string[];
  /** RN-21: tuplas que o arquivo não observa, marcadas como inexistentes. */
  manualSuppressions: string[];
  /** `CompatibilityVersion.id` usadas — alimenta `derivedFrom`. */
  compatibilityVersionIds: string[];
};

export type ImportPlanTotals = {
  new: number;
  changed: number;
  unchanged: number;
  structural: number;
  absentInFile: number;
  blocked: number;
  cellsChanged: number;
};

export type ImportPlan = {
  /** Documento + arquivo + perfil (RN-14). */
  planHash: string;
  profileCode: string;
  source: { fileName?: string; rowCount: number; contentHash: string };
  matrices: MatrixPlan[];
  libraryGaps: LibraryGap[];
  totals: ImportPlanTotals;
  issues: ImportIssue[];
};

export type PlanImportOptions = {
  fileName?: string;
  /**
   * Hash do **texto** do arquivo (RN-20), quando o chamador ainda o tem. Sem
   * ele, o hash sai da tabela já lida, que é a mesma informação em forma
   * canônica.
   */
  contentHash?: string;
};

// ---------------------------------------------------------------------------
// Eixos projetados para a matriz nova
// ---------------------------------------------------------------------------

/**
 * Os eixos que uma matriz **nova** teria: versões publicadas das variáveis do
 * perfil, domínios congelados e as regras de compatibilidade publicadas — o
 * mesmo caminho de `matrix/create` (docs/05 §1.1), sem criar nada. Antes da
 * supressão de RN-21, que é por matriz.
 *
 * Exportada porque a criação da matriz (S24) precisa exatamente destes eixos:
 * recalcular a projeção em outro lugar seria uma segunda verdade sobre o que a
 * carga monta.
 */
export function projectImportAxes(
  doc: PolicyOpsDocument,
  profile: ImportProfile,
): { x: PlannedAxis; y: PlannedAxis } {
  return { x: projectAxis(doc, profile, 'X'), y: projectAxis(doc, profile, 'Y') };
}

function projectAxis(doc: PolicyOpsDocument, profile: ImportProfile, role: 'X' | 'Y'): PlannedAxis {
  const levels: PlannedAxisLevel[] = axisColumns(profile, role).map((column) => {
    const variableId = column.axis!.variableId;
    const variable = doc.variables.find((candidate) => candidate.id === variableId);
    const published = variable?.versions.find((version) => version.state === 'PUBLISHED');
    if (variable === undefined || published === undefined) {
      throw new PlanBlocked(
        `A variável do eixo ${role} usada pela coluna "${column.column}" não tem versão publicada.`,
      );
    }
    return {
      variableId,
      variableVersionId: published.id,
      label: variable.name,
      domains: snapshotDomains(published.domains),
    };
  });
  const generated = generateTuples({
    levels: levels.map((level) => ({ variableId: level.variableId, domains: level.domains })),
    compatibility: collectPublishedCompatibility(doc.compatibility),
  });
  return {
    role,
    levels,
    tuples: generated.tuples,
    manualSuppressions: [],
    compatibilityVersionIds: generated.usedRuleIds,
  };
}

/** Erro interno que vira `BLOCKED` com motivo, nunca exceção para fora do plano. */
class PlanBlocked extends Error {}

function syntheticAxis(role: 'X' | 'Y', tuples: string[]): Axis {
  return { role, levels: [], tuples, derivedFrom: { compatibilityVersionIds: [] } };
}

function syntheticVersion(x: Axis, y: Axis, cells: Record<string, Cell>): MatrixVersion {
  return {
    id: 'PLANNED00000',
    number: 1,
    state: 'DRAFT',
    createdAt: '1970-01-01T00:00:00.000Z',
    createdBy: 'plano',
    axes: { x, y },
    cells,
  };
}

// ---------------------------------------------------------------------------
// Agrupamento das linhas resolvidas
// ---------------------------------------------------------------------------

type Group = {
  key: ResolvedMatrixKey;
  rows: ResolvedRow[];
  cells: Record<string, Cell>;
  observed: { X: Set<string>; Y: Set<string> };
};

function groupRows(keys: readonly ResolvedMatrixKey[], rows: readonly ResolvedRow[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const key of keys) {
    groups.set(key.key, {
      key,
      rows: [],
      cells: {},
      observed: { X: new Set(), Y: new Set() },
    });
  }
  for (const row of rows) {
    const group = groups.get(row.matrixKey)!;
    group.rows.push(row);
    group.cells[encodeCellKey(row.xPath, row.yPath)] = row.cell;
    group.observed.X.add(row.xPath);
    group.observed.Y.add(row.yPath);
  }
  return groups;
}

/** As linhas do arquivo que produziram cada tupla desconhecida (CT-03). */
function unknownTuplesOf(group: Group, valid: { X: Set<string>; Y: Set<string> }): UnknownTuple[] {
  const found = new Map<string, UnknownTuple>();
  for (const role of ['X', 'Y'] as const) {
    for (const path of group.observed[role]) {
      if (valid[role].has(path)) continue;
      found.set(`${role}|${path}`, { path, role, lines: [] });
    }
  }
  if (found.size === 0) return [];
  for (const row of group.rows) {
    found.get(`X|${row.xPath}`)?.lines.push(row.source.line);
    found.get(`Y|${row.yPath}`)?.lines.push(row.source.line);
  }
  return [...found.values()];
}

/** Combinações do grid que o arquivo não citou (RN-07). */
function missingCombinationsOf(
  xTuples: readonly string[],
  yTuples: readonly string[],
  cells: Record<string, Cell>,
): string[] {
  const missing: string[] = [];
  for (const x of xTuples) {
    for (const y of yTuples) {
      const key = encodeCellKey(x, y);
      if (cells[key] === undefined) missing.push(key);
    }
  }
  return missing;
}

// ---------------------------------------------------------------------------
// planImport
// ---------------------------------------------------------------------------

const EMPTY_TOTALS: ImportPlanTotals = {
  new: 0,
  changed: 0,
  unchanged: 0,
  structural: 0,
  absentInFile: 0,
  blocked: 0,
  cellsChanged: 0,
};

export function planImport(
  doc: DocumentWithProfiles,
  table: ImportTable,
  profile: ImportProfile,
  opts: PlanImportOptions = {},
): ImportPlan {
  const contentHash = opts.contentHash ?? hashTable(table);
  const source = {
    ...(opts.fileName === undefined ? {} : { fileName: opts.fileName }),
    rowCount: table.rows.length,
    contentHash,
  };

  const issues: ImportIssue[] = [
    ...validateProfile(doc, profile),
    ...validateProfileAgainstHeader(profile, table.header),
  ];
  if (hasBlockingIssue(issues)) {
    return blockedPlan(profile, source, issues, []);
  }

  const resolved = resolveImport(doc, table, profile);
  issues.push(...resolved.issues);
  const libraryGaps = computeLibraryGaps(doc, table, profile);
  if (hasBlockingIssue(issues)) {
    return blockedPlan(profile, source, issues, libraryGaps);
  }

  const groups = groupRows(resolved.keys, resolved.rows);
  const limits = buildLimitCatalog(doc);
  const inProject = doc.matrices.filter((matrix) => matrix.projectId === profile.projectId);
  const projectMatrices = inProject.filter((matrix) => matrix.archivedAt === undefined);
  // A busca por código inclui as arquivadas: o código continua ocupado no
  // projeto (docs/05 §1.1), e criar uma matriz nova por cima falharia.
  const byCode = new Map(inProject.map((matrix) => [matrix.code, matrix]));

  const matrices: MatrixPlan[] = [];
  const codeOwner = new Map<string, string>();
  const cited = new Set<string>();

  // A projeção dos eixos é a mesma para toda matriz nova desta carga — os
  // níveis vêm do perfil, não da chave. Calculada uma vez, e só se preciso.
  let projected: { x: PlannedAxis; y: PlannedAxis } | PlanBlocked | undefined;
  const projection = (): { x: PlannedAxis; y: PlannedAxis } | PlanBlocked => {
    if (projected === undefined) {
      try {
        projected = projectImportAxes(doc, profile);
      } catch (error) {
        // Toda falha aqui é falha de biblioteca — variável sem versão
        // publicada, eixo sem nenhuma tupla válida, nível sem domínio — e
        // bloqueia as matrizes novas desta carga, não a carga inteira
        // (DEC-CARGA-009).
        projected = new PlanBlocked((error as Error).message);
      }
    }
    return projected;
  };

  for (const group of groups.values()) {
    const code = renderTemplate(profile.codeTemplate, group.key.values);
    const owner = codeOwner.get(code);
    if (owner !== undefined) {
      issues.push(
        importIssue(
          'IMPORT_PROFILE_INVALID',
          `O padrão de código "${profile.codeTemplate}" gera o mesmo código "${code}" para as chaves "${owner}" e "${group.key.key}".`,
          { details: { code, keys: [owner, group.key.key] } },
        ),
      );
      continue;
    }
    codeOwner.set(code, group.key.key);

    const plan = planForGroup(profile, group, {
      code,
      name: renderTemplate(profile.nameTemplate, group.key.labels),
      existing: byCode.get(code),
      limits,
      issues,
      projection,
    });
    if (plan.matrixId !== undefined) cited.add(plan.matrixId);
    matrices.push(plan);
  }

  if (hasBlockingIssue(issues)) {
    return blockedPlan(profile, source, issues, libraryGaps);
  }

  // RN-09: matriz existente e ausente do arquivo é listada e não é tocada.
  for (const matrix of projectMatrices) {
    if (cited.has(matrix.id)) continue;
    const version = effectiveVersion(matrix);
    matrices.push({
      key: matrix.code,
      code: matrix.code,
      name: matrix.name,
      tags: [],
      status: 'ABSENT_IN_FILE',
      matrixId: matrix.id,
      ...(version === undefined
        ? {}
        : { baseVersionId: version.id, baseVersionNumber: version.number }),
      combinations:
        version === undefined ? 0 : version.axes.x.tuples.length * version.axes.y.tuples.length,
      suppressedCombinations: 0,
      changes: [],
      summary: { ...EMPTY_DIFF_SUMMARY },
      missingCombinations: [],
      unknownTuples: [],
    });
  }

  const totals = { ...EMPTY_TOTALS };
  for (const plan of matrices) {
    if (plan.status === 'NEW') totals.new += 1;
    else if (plan.status === 'CHANGED') totals.changed += 1;
    else if (plan.status === 'UNCHANGED') totals.unchanged += 1;
    else if (plan.status === 'STRUCTURAL') totals.structural += 1;
    else if (plan.status === 'ABSENT_IN_FILE') totals.absentInFile += 1;
    else totals.blocked += 1;
    totals.cellsChanged += plan.changes.length;
  }

  return {
    planHash: computePlanHash(profile, source, matrices),
    profileCode: profile.code,
    source,
    matrices,
    libraryGaps,
    totals,
    issues,
  };
}

type GroupContext = {
  code: string;
  name: string;
  existing: Matrix | undefined;
  limits: ReturnType<typeof buildLimitCatalog>;
  issues: ImportIssue[];
  /** Projeção compartilhada dos eixos, ou o motivo de ela não existir. */
  projection: () => { x: PlannedAxis; y: PlannedAxis } | PlanBlocked;
};

function planForGroup(profile: ImportProfile, group: Group, ctx: GroupContext): MatrixPlan {
  const base: MatrixPlan = {
    key: group.key.key,
    code: ctx.code,
    name: ctx.name,
    tags: tagsForKey(profile, group.key.values),
    status: 'NEW',
    combinations: 0,
    suppressedCombinations: 0,
    changes: [],
    summary: { ...EMPTY_DIFF_SUMMARY },
    missingCombinations: [],
    unknownTuples: [],
  };

  return ctx.existing === undefined
    ? planNewMatrix(profile, group, ctx, base)
    : planExistingMatrix(profile, group, ctx, base, ctx.existing);
}

function planNewMatrix(
  profile: ImportProfile,
  group: Group,
  ctx: GroupContext,
  base: MatrixPlan,
): MatrixPlan {
  const projected = ctx.projection();
  if (projected instanceof PlanBlocked) {
    return { ...base, status: 'BLOCKED', reason: projected.message };
  }
  const { x, y } = projected;

  const valid = { X: new Set(x.tuples), Y: new Set(y.tuples) };
  const unknownTuples = unknownTuplesOf(group, valid);
  if (unknownTuples.length > 0) {
    return {
      ...base,
      status: 'STRUCTURAL',
      reason: structuralReason(unknownTuples),
      unknownTuples,
    };
  }

  // RN-21: numa matriz nova, tupla que o arquivo não observa nasce suprimida.
  // Tupla parcialmente observada nunca é suprimida (DEC-CARGA-011).
  const suppress = profile.suppressUnobserved;
  const xTuples = suppress ? x.tuples.filter((path) => group.observed.X.has(path)) : x.tuples;
  const yTuples = suppress ? y.tuples.filter((path) => group.observed.Y.has(path)) : y.tuples;
  const suppressed = x.tuples.length - xTuples.length + (y.tuples.length - yTuples.length);
  const combinations = xTuples.length * yTuples.length;

  try {
    assertGridFits(combinations);
  } catch {
    return {
      ...base,
      status: 'BLOCKED',
      reason: `A matriz nova teria ${combinations} combinações; o teto é ${MAX_COMBINATIONS} (I16).`,
      combinations,
      suppressedCombinations: suppressed,
    };
  }

  if (suppressed > 0) {
    ctx.issues.push(
      importIssue(
        'IMPORT_TUPLES_SUPPRESSED',
        `${ctx.code}: ${suppressed} combinações marcadas como inexistentes — o arquivo não traz nenhuma linha para elas.`,
        { details: { code: ctx.code, suppressed } },
      ),
    );
  }

  const axisX = syntheticAxis('X', xTuples);
  const axisY = syntheticAxis('Y', yTuples);
  const empty = syntheticVersion(axisX, axisY, {});
  const filled = syntheticVersion(axisX, axisY, gridCells(group.cells, valid, xTuples, yTuples));
  const changes = diffCells(empty, filled);
  const missing = missingCombinationsOf(xTuples, yTuples, filled.cells);
  if (missing.length > 0) {
    ctx.issues.push(missingIssue(ctx.code, missing.length, 'KEEP'));
  }

  return {
    ...base,
    status: 'NEW',
    combinations,
    suppressedCombinations: suppressed,
    changes,
    summary: summarizeChanges(changes, { before: ctx.limits, after: ctx.limits }, {
      combinationsAdded: combinations,
      combinationsRemoved: 0,
    }),
    missingCombinations: missing,
    axes: {
      x: { ...x, tuples: xTuples, manualSuppressions: suppressionsOf(x.tuples, xTuples) },
      y: { ...y, tuples: yTuples, manualSuppressions: suppressionsOf(y.tuples, yTuples) },
    },
  };
}

/** As tuplas que ficaram de fora do grid efetivo — `manualSuppressions` (RN-21). */
function suppressionsOf(all: readonly string[], effective: readonly string[]): string[] {
  if (all.length === effective.length) return [];
  const kept = new Set(effective);
  return all.filter((path) => !kept.has(path));
}

function planExistingMatrix(
  profile: ImportProfile,
  group: Group,
  ctx: GroupContext,
  base: MatrixPlan,
  matrix: Matrix,
): MatrixPlan {
  const withMatrix: MatrixPlan = { ...base, matrixId: matrix.id };
  if (matrix.archivedAt !== undefined) {
    return {
      ...withMatrix,
      status: 'BLOCKED',
      reason: 'Já existe uma matriz arquivada com este código no projeto — restaure-a ou mude o padrão de código.',
    };
  }
  const published = matrix.versions.find((version) => version.state === 'PUBLISHED');
  if (published === undefined) {
    ctx.issues.push(
      importIssue(
        'IMPORT_NO_BASE_VERSION',
        `${ctx.code}: não há versão publicada para comparar — publique a matriz antes de recarregá-la.`,
        { details: { code: ctx.code } },
      ),
    );
    return {
      ...withMatrix,
      status: 'BLOCKED',
      reason: 'A matriz não tem versão publicada para servir de base à comparação.',
    };
  }

  const withBase: MatrixPlan = {
    ...withMatrix,
    baseVersionId: published.id,
    baseVersionNumber: published.number,
    combinations: published.axes.x.tuples.length * published.axes.y.tuples.length,
  };

  const valid = { X: new Set(published.axes.x.tuples), Y: new Set(published.axes.y.tuples) };
  const unknownTuples = unknownTuplesOf(group, valid);
  if (unknownTuples.length > 0) {
    // RN-06: a matriz inteira fica divergente; a carga nunca aplica parte dela.
    return {
      ...withBase,
      status: 'STRUCTURAL',
      reason: structuralReason(unknownTuples),
      unknownTuples,
    };
  }

  // RN-15: I1 permite um rascunho por matriz — recarregar por cima seria
  // `DRAFT_ALREADY_EXISTS` no meio do lote.
  if (matrix.versions.some((version) => version.state === 'DRAFT')) {
    return {
      ...withBase,
      status: 'BLOCKED',
      reason: 'Já existe um rascunho aberto nesta matriz — publique-o ou descarte-o antes de recarregar.',
    };
  }

  const observed = gridCells(group.cells, valid, published.axes.x.tuples, published.axes.y.tuples);
  const missing = missingCombinationsOf(
    published.axes.x.tuples,
    published.axes.y.tuples,
    observed,
  );
  if (missing.length > 0) {
    ctx.issues.push(missingIssue(ctx.code, missing.length, profile.missingRowPolicy));
  }

  const candidate = syntheticVersion(published.axes.x, published.axes.y, mergeCells(published.cells, observed, profile.missingRowPolicy));
  const changes = diffCells(published, candidate);
  return {
    ...withBase,
    status: changes.length === 0 ? 'UNCHANGED' : 'CHANGED',
    changes,
    summary: summarizeChanges(changes, { before: ctx.limits, after: ctx.limits }, {
      combinationsAdded: 0,
      combinationsRemoved: 0,
    }),
    missingCombinations: missing,
  };
}

/** As células observadas que caem dentro do grid informado (I5). */
function gridCells(
  cells: Record<string, Cell>,
  valid: { X: Set<string>; Y: Set<string> },
  xTuples: readonly string[],
  yTuples: readonly string[],
): Record<string, Cell> {
  // `xTuples` é sempre `valid.X` inteiro ou um subconjunto dele (a supressão de
  // RN-21 filtra a mesma lista, e I15 proíbe tupla repetida): mesmo tamanho
  // significa mesmo conjunto, e aí o `Set` já pronto serve.
  const x = xTuples.length === valid.X.size ? valid.X : new Set(xTuples);
  const y = yTuples.length === valid.Y.size ? valid.Y : new Set(yTuples);
  const inside: Record<string, Cell> = {};
  for (const [key, cell] of Object.entries(cells)) {
    const { xPath, yPath } = decodeCellKey(key);
    if (x.has(xPath) && y.has(yPath)) inside[key] = cell;
  }
  return inside;
}

/**
 * O conteúdo que a matriz teria depois da carga.
 *
 * `KEEP` (padrão, RN-07) preserva o que o arquivo não menciona — inclusive os
 * campos que ele não carrega dentro de uma célula que ele **menciona**: uma
 * observação escrita à mão continua lá depois de a oferta ser recarregada.
 * `CLEAR` esvazia tudo o que o arquivo não traz.
 */
function mergeCells(
  current: Record<string, Cell>,
  observed: Record<string, Cell>,
  policy: 'KEEP' | 'CLEAR',
): Record<string, Cell> {
  if (policy === 'CLEAR') return { ...observed };
  const merged: Record<string, Cell> = { ...current };
  for (const [key, cell] of Object.entries(observed)) {
    const existing = merged[key];
    merged[key] = existing === undefined ? cell : { ...existing, ...cell };
  }
  return merged;
}

function structuralReason(unknown: readonly UnknownTuple[]): string {
  const sample = unknown
    .slice(0, 3)
    .map((entry) => `${entry.path} (eixo ${entry.role})`)
    .join(', ');
  return unknown.length <= 3
    ? `O arquivo traz combinações que não existem nos eixos desta matriz: ${sample}.`
    : `O arquivo traz ${unknown.length} combinações que não existem nos eixos desta matriz: ${sample}…`;
}

function missingIssue(code: string, count: number, policy: 'KEEP' | 'CLEAR'): ImportIssue {
  return importIssue(
    'IMPORT_MISSING_ROW',
    policy === 'KEEP'
      ? `${code}: ${count} combinações sem linha no arquivo — conteúdo atual preservado.`
      : `${code}: ${count} combinações sem linha no arquivo — células esvaziadas.`,
    { details: { code, count, policy } },
  );
}

function effectiveVersion(matrix: Matrix): MatrixVersion | undefined {
  return (
    matrix.versions.find((version) => version.state === 'PUBLISHED') ??
    matrix.versions[matrix.versions.length - 1]
  );
}

// ---------------------------------------------------------------------------
// Hashes
// ---------------------------------------------------------------------------

/** Separador de campo da forma canônica: US (0x1F), que nunca aparece numa célula. */
const FIELD_SEPARATOR = '\u001f';

/**
 * Hash do conteúdo a partir da tabela já lida: o mesmo conteúdo do arquivo em
 * forma canônica — campos separados por US, linhas por LF —, independente do
 * separador, do BOM e do estilo de quebra de linha do original. Quando o texto
 * do arquivo está à mão, o chamador passa `contentHash` e RN-20 vale
 * literalmente.
 */
export function hashTable(table: ImportTable): string {
  return hashText(
    [table.header, ...table.rows].map((row) => row.join(FIELD_SEPARATOR)).join('\n'),
  );
}

/**
 * `planHash` cobre o que faria o plano deixar de valer (RN-14): o perfil, o
 * conteúdo do arquivo e o **resultado** da leitura do documento — estado,
 * matriz e versão-base de cada linha do plano. Versão publicada é imutável
 * (I3), então o id da base já responde por todo o conteúdo comparado.
 */
function computePlanHash(
  profile: ImportProfile,
  source: ImportPlan['source'],
  matrices: readonly MatrixPlan[],
): string {
  return hashValue({
    profile: stableStringify(profile),
    content: source.contentHash,
    rowCount: source.rowCount,
    matrices: matrices.map((plan) => [
      plan.key,
      plan.code,
      plan.status,
      plan.matrixId ?? '',
      plan.baseVersionId ?? '',
      plan.combinations,
      plan.suppressedCombinations,
      plan.changes.length,
      plan.unknownTuples.length,
    ]),
  });
}

function blockedPlan(
  profile: ImportProfile,
  source: ImportPlan['source'],
  issues: ImportIssue[],
  libraryGaps: LibraryGap[],
): ImportPlan {
  return {
    planHash: computePlanHash(profile, source, []),
    profileCode: profile.code,
    source,
    matrices: [],
    libraryGaps,
    totals: { ...EMPTY_TOTALS },
    issues,
  };
}
