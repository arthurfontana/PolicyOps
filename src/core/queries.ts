import { allCombinations, countPending as countPendingIn, listPending } from './axes/combinations';
import { computeHeaderLayout, type HeaderRow } from './axes/header-layout';
import type {
  Axis,
  AxisRole,
  CatalogItem,
  CatalogItemKind,
  Cell,
  CompatibilityRule,
  CompatibilityVersion,
  DefaultForUnlisted,
  Domain,
  DocEvent,
  Matrix,
  MatrixVersion,
  MatrixVersionState,
  PolicyOpsDocument,
  Project,
  Variable,
  VariableType,
  VariableVersion,
} from './document/schema';
import { locateMatrix, locateVersion } from './versioning/lifecycle';

/**
 * Consultas puras — docs/08-camada-de-comandos.md §4.
 *
 * São funções de leitura chamadas direto pelos componentes: não passam por
 * comando, não alteram nada, não têm efeito colateral.
 *
 * `diffVersions` fica de fora: o motor de diff é `src/core/diff/` (S14).
 */

// ---------------------------------------------------------------------------
// Vigência — docs/05 §6
// ---------------------------------------------------------------------------

/**
 * Versão vigente em `at`: intervalo **semiaberto** `[effectiveFrom, effectiveTo)`.
 * Na data exata da troca vale a versão nova. Sem resultado significa "não havia
 * política vigente nessa data" — não é erro.
 *
 * A consulta é sempre pelo intervalo, **nunca** pelo estado: é o que faz uma
 * publicação agendada continuar correta (a versão fica `PUBLISHED` com
 * `effectiveFrom` no futuro, e até lá a anterior segue vigente).
 */
export function getEffectiveVersion(
  doc: PolicyOpsDocument,
  matrixId: string,
  at: Date,
): MatrixVersion | null {
  const { matrix } = locateMatrix(doc, matrixId);
  const instant = at.toISOString();
  for (const version of matrix.versions) {
    if (version.state !== 'PUBLISHED' && version.state !== 'SUPERSEDED') continue;
    if (version.effectiveFrom === undefined || version.effectiveFrom > instant) continue;
    if (version.effectiveTo !== undefined && version.effectiveTo <= instant) continue;
    return version;
  }
  return null;
}

export type PortfolioEntry = { matrix: Matrix; version: MatrixVersion | null };

/** As matrizes de um projeto com a versão vigente de cada uma em `at`. */
export function getPortfolioAt(
  doc: PolicyOpsDocument,
  projectId: string,
  at: Date,
): PortfolioEntry[] {
  return doc.matrices
    .filter((matrix) => matrix.projectId === projectId)
    .map((matrix) => ({ matrix, version: getEffectiveVersion(doc, matrix.id, at) }));
}

// ---------------------------------------------------------------------------
// Histórico e auditoria
// ---------------------------------------------------------------------------

export type MatrixVersionSummary = {
  id: string;
  number: number;
  state: MatrixVersionState;
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  publishedBy?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  archivedAt?: string;
  notes?: string;
  baseVersionId?: string;
  combinations: number;
  filledCells: number;
  pendingCells: number;
};

/** Histórico da matriz, da versão mais recente para a mais antiga. */
export function listMatrixVersions(
  doc: PolicyOpsDocument,
  matrixId: string,
): MatrixVersionSummary[] {
  const { matrix } = locateMatrix(doc, matrixId);
  return [...matrix.versions]
    .sort((a, b) => b.number - a.number)
    .map((version) => {
      const summary: MatrixVersionSummary = {
        id: version.id,
        number: version.number,
        state: version.state,
        createdAt: version.createdAt,
        createdBy: version.createdBy,
        combinations: allCombinations(version).length,
        filledCells: Object.keys(version.cells).length,
        pendingCells: countPendingIn(version),
      };
      if (version.publishedAt !== undefined) summary.publishedAt = version.publishedAt;
      if (version.publishedBy !== undefined) summary.publishedBy = version.publishedBy;
      if (version.effectiveFrom !== undefined) summary.effectiveFrom = version.effectiveFrom;
      if (version.effectiveTo !== undefined) summary.effectiveTo = version.effectiveTo;
      if (version.archivedAt !== undefined) summary.archivedAt = version.archivedAt;
      if (version.notes !== undefined) summary.notes = version.notes;
      if (version.baseVersionId !== undefined) summary.baseVersionId = version.baseVersionId;
      return summary;
    });
}

/** Auditoria da versão, em ordem cronológica (`events` já é append-only). */
export function getVersionEvents(doc: PolicyOpsDocument, versionId: string): DocEvent[] {
  return doc.events.filter((event) => event.scope.versionId === versionId);
}

/** Combinações sem decisão nesta versão. */
export function countPending(doc: PolicyOpsDocument, versionId: string): number {
  const { version } = locateVersion(doc, versionId);
  return countPendingIn(version);
}

// ---------------------------------------------------------------------------
// Defasagem de eixo — docs/05 §5.2
// ---------------------------------------------------------------------------

export type StaleReasonKind = 'LEVEL_PIN_OUTDATED' | 'RULE_OUTDATED' | 'NEW_RULE_AVAILABLE';

export type StaleReason = {
  kind: StaleReasonKind;
  /** Frase pronta em pt-BR. */
  message: string;
  levelIndex?: number;
  variableCode?: string;
  ruleCode?: string;
};

export type AxisStaleness = { role: AxisRole; stale: boolean; reasons: StaleReason[] };

function publishedCompatibilityFor(
  rules: CompatibilityRule[],
  parentVariableId: string,
  childVariableId: string,
): { rule: CompatibilityRule; versionId: string } | undefined {
  for (const rule of rules) {
    if (rule.archivedAt !== undefined) continue;
    if (rule.parentVariableId !== parentVariableId) continue;
    if (rule.childVariableId !== childVariableId) continue;
    const version = rule.versions.find((candidate) => candidate.state === 'PUBLISHED');
    if (version !== undefined) return { rule, versionId: version.id };
  }
  return undefined;
}

/**
 * Um eixo está defasado quando qualquer uma destas for verdadeira (§5.2):
 * um pin de variável não aponta mais para uma versão `PUBLISHED`; uma regra
 * usada para gerar as tuplas não está mais `PUBLISHED`; ou passou a existir
 * regra publicada para um par adjacente que não tinha regra na geração.
 */
export function getAxisStaleness(doc: PolicyOpsDocument, axis: Axis): AxisStaleness {
  const reasons: StaleReason[] = [];

  axis.levels.forEach((level, levelIndex) => {
    const variable = doc.variables.find((candidate) => candidate.id === level.variableId);
    const pinned = variable?.versions.find(
      (candidate) => candidate.id === level.variableVersionId,
    );
    if (pinned === undefined || pinned.state !== 'PUBLISHED') {
      reasons.push({
        kind: 'LEVEL_PIN_OUTDATED',
        levelIndex,
        variableCode: variable === undefined ? level.label : variable.code,
        message: `O nível ${levelIndex + 1} usa uma versão de "${level.label}" que não é mais a publicada.`,
      });
    }
  });

  // Regras usadas na geração das tuplas que já não estão publicadas.
  const usedRuleIds = new Set<string>();
  for (const versionId of axis.derivedFrom.compatibilityVersionIds) {
    const rule = doc.compatibility.find((candidate) =>
      candidate.versions.some((version) => version.id === versionId),
    );
    const version = rule?.versions.find((candidate) => candidate.id === versionId);
    if (rule !== undefined) usedRuleIds.add(rule.id);
    if (version === undefined || version.state !== 'PUBLISHED') {
      reasons.push({
        kind: 'RULE_OUTDATED',
        ruleCode: rule === undefined ? versionId : rule.code,
        message:
          rule === undefined
            ? 'Uma regra de compatibilidade usada por este eixo não existe mais.'
            : `A regra "${rule.code}" tem uma versão mais nova publicada que a usada por este eixo.`,
      });
    }
  }

  // Regra publicada que passou a existir para um par adjacente sem regra.
  for (let index = 1; index < axis.levels.length; index++) {
    const parent = axis.levels[index - 1]!;
    const child = axis.levels[index]!;
    const found = publishedCompatibilityFor(doc.compatibility, parent.variableId, child.variableId);
    if (found === undefined || usedRuleIds.has(found.rule.id)) continue;
    reasons.push({
      kind: 'NEW_RULE_AVAILABLE',
      levelIndex: index,
      ruleCode: found.rule.code,
      message: `Passou a existir a regra "${found.rule.code}" entre os níveis ${index} e ${index + 1}, ainda não aplicada neste eixo.`,
    });
  }

  return { role: axis.role, stale: reasons.length > 0, reasons };
}

export type StaleAxisEntry = {
  matrixId: string;
  matrixCode: string;
  versionId: string;
  versionNumber: number;
  staleness: AxisStaleness;
};

/**
 * Todos os rascunhos com eixo defasado. Só `DRAFT`: em publicadas e históricas
 * a defasagem não é pendência, é registro (§5.2).
 */
export function getStaleAxes(doc: PolicyOpsDocument): StaleAxisEntry[] {
  const entries: StaleAxisEntry[] = [];
  for (const matrix of doc.matrices) {
    for (const version of matrix.versions) {
      if (version.state !== 'DRAFT') continue;
      for (const axis of [version.axes.x, version.axes.y]) {
        const staleness = getAxisStaleness(doc, axis);
        if (!staleness.stale) continue;
        entries.push({
          matrixId: matrix.id,
          matrixCode: matrix.code,
          versionId: version.id,
          versionNumber: version.number,
          staleness,
        });
      }
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Navegação de projeto → matriz → versão — docs/09 S09
// ---------------------------------------------------------------------------

/**
 * A versão que "abrir uma matriz" deve mostrar: a vigente; se não houver, o
 * rascunho; se não houver nenhuma das duas, `null` (estado vazio). I2
 * garante no máximo uma `PUBLISHED` e no máximo um `DRAFT` por matriz.
 */
export function resolveOpenVersion(matrix: Matrix): MatrixVersion | null {
  return (
    matrix.versions.find((version) => version.state === 'PUBLISHED') ??
    matrix.versions.find((version) => version.state === 'DRAFT') ??
    null
  );
}

/** Versão mais recente (maior `number`) — usada para exibir a estrutura de eixos na lista de matrizes. */
export function latestVersionOf(matrix: Matrix): MatrixVersion | null {
  if (matrix.versions.length === 0) return null;
  return [...matrix.versions].sort((a, b) => b.number - a.number)[0]!;
}

/** `"Score HVI3" × "Segmento › Faturamento"` — docs/07 §1, lista de matrizes do projeto. */
export function axisStructureLabel(axis: Axis): string {
  return axis.levels.map((level) => level.label).join(' › ');
}

export type ProjectMatrixSummary = {
  matrix: Matrix;
  version: MatrixVersion | null;
  xLabel: string;
  yLabel: string;
  publishedVersion: MatrixVersion | null;
  draftVersion: MatrixVersion | null;
};

export type ProjectSummary = {
  project: Project;
  matrixCount: number;
  openDraftCount: number;
};

/** Lista de projetos com contagens para a tela `/projects` (docs/07-ux-e-editor.md §1). */
export function listProjects(
  doc: PolicyOpsDocument,
  filter: { includeArchived?: boolean } = {},
): ProjectSummary[] {
  return doc.projects
    .filter((project) => filter.includeArchived === true || project.archivedAt === undefined)
    .sort((a, b) => a.position - b.position)
    .map((project) => {
      const matrices = doc.matrices.filter((matrix) => matrix.projectId === project.id);
      return {
        project,
        matrixCount: matrices.length,
        openDraftCount: matrices.filter((matrix) =>
          matrix.versions.some((version) => version.state === 'DRAFT'),
        ).length,
      };
    });
}

/** Matrizes de um projeto, com a estrutura de eixos e os badges de versão da lista de detalhe. */
export function listProjectMatrices(
  doc: PolicyOpsDocument,
  projectId: string,
): ProjectMatrixSummary[] {
  return doc.matrices
    .filter((matrix) => matrix.projectId === projectId && matrix.archivedAt === undefined)
    .map((matrix) => {
      const latest = latestVersionOf(matrix);
      return {
        matrix,
        version: latest,
        xLabel: latest === null ? '' : axisStructureLabel(latest.axes.x),
        yLabel: latest === null ? '' : axisStructureLabel(latest.axes.y),
        publishedVersion: matrix.versions.find((version) => version.state === 'PUBLISHED') ?? null,
        draftVersion: matrix.versions.find((version) => version.state === 'DRAFT') ?? null,
      };
    });
}

// ---------------------------------------------------------------------------
// Biblioteca de variáveis
// ---------------------------------------------------------------------------

export type VariableFilter = { search?: string; type?: VariableType; includeArchived?: boolean };

export type VariableSummary = {
  variable: Variable;
  publishedVersion: VariableVersion | null;
  draftVersion: VariableVersion | null;
  /** Níveis de eixo que pinam alguma versão desta variável. */
  usageCount: number;
  /** Matrizes distintas em que o pino está numa versão vigente (PUBLISHED). */
  publishedMatrixCount: number;
  /** Matrizes distintas em que o pino está num rascunho (DRAFT). */
  draftMatrixCount: number;
};

export type VariableUsageEntry = {
  matrixId: string;
  matrixCode: string;
  versionId: string;
  versionNumber: number;
  versionState: MatrixVersionState;
  role: AxisRole;
  levelIndex: number;
  variableVersionId: string;
  variableVersionNumber: number | null;
};

/** Quem pina cada versão desta variável — a base do "não dá para arquivar". */
export function getVariableUsage(
  doc: PolicyOpsDocument,
  variableId: string,
): VariableUsageEntry[] {
  const variable = doc.variables.find((candidate) => candidate.id === variableId);
  const entries: VariableUsageEntry[] = [];
  for (const matrix of doc.matrices) {
    for (const version of matrix.versions) {
      for (const axis of [version.axes.x, version.axes.y]) {
        axis.levels.forEach((level, levelIndex) => {
          if (level.variableId !== variableId) return;
          const pinned = variable?.versions.find(
            (candidate) => candidate.id === level.variableVersionId,
          );
          entries.push({
            matrixId: matrix.id,
            matrixCode: matrix.code,
            versionId: version.id,
            versionNumber: version.number,
            versionState: version.state,
            role: axis.role,
            levelIndex,
            variableVersionId: level.variableVersionId,
            variableVersionNumber: pinned === undefined ? null : pinned.number,
          });
        });
      }
    }
  }
  return entries;
}

export function listVariables(
  doc: PolicyOpsDocument,
  filter: VariableFilter = {},
): VariableSummary[] {
  const search = filter.search?.trim().toLowerCase();
  return doc.variables
    .filter((variable) => {
      if (variable.archivedAt !== undefined && filter.includeArchived !== true) return false;
      if (filter.type !== undefined && variable.type !== filter.type) return false;
      if (search === undefined || search.length === 0) return true;
      return (
        variable.code.toLowerCase().includes(search) || variable.name.toLowerCase().includes(search)
      );
    })
    .map((variable) => {
      const usage = getVariableUsage(doc, variable.id);
      return {
        variable,
        publishedVersion:
          variable.versions.find((version) => version.state === 'PUBLISHED') ?? null,
        draftVersion: variable.versions.find((version) => version.state === 'DRAFT') ?? null,
        usageCount: usage.length,
        publishedMatrixCount: new Set(
          usage.filter((entry) => entry.versionState === 'PUBLISHED').map((entry) => entry.matrixId),
        ).size,
        draftMatrixCount: new Set(
          usage.filter((entry) => entry.versionState === 'DRAFT').map((entry) => entry.matrixId),
        ).size,
      };
    });
}

// ---------------------------------------------------------------------------
// Biblioteca de compatibilidade — docs/08 §4, docs/07 §11
// ---------------------------------------------------------------------------

function variableVersionDomains(
  doc: PolicyOpsDocument,
  variableId: string,
  variableVersionId: string,
): Domain[] {
  const variable = doc.variables.find((candidate) => candidate.id === variableId);
  const version = variable?.versions.find((candidate) => candidate.id === variableVersionId);
  return version?.domains ?? [];
}

/** O que `countAllowedCombinations` precisa de uma `CompatibilityVersion` — nada além do mapa em si. */
export type CompatibilityMapLike = {
  allow: Record<string, string[]>;
  defaultForUnlisted: DefaultForUnlisted;
};

/** Quantas combinações do produto pai×filho o mapa desta versão libera, sobre o total. */
export function countAllowedCombinations(
  version: CompatibilityMapLike,
  parentDomains: Domain[],
  childDomains: Domain[],
): { valid: number; total: number } {
  const childCodes = new Set(childDomains.map((domain) => domain.code));
  let valid = 0;
  for (const parentDomain of parentDomains) {
    const allowed = version.allow[parentDomain.code];
    if (allowed === undefined) {
      valid += version.defaultForUnlisted === 'ALL' ? childDomains.length : 0;
    } else {
      valid += allowed.filter((code) => childCodes.has(code)).length;
    }
  }
  return { valid, total: parentDomains.length * childDomains.length };
}

export type CompatibilityUsageEntry = {
  matrixId: string;
  matrixCode: string;
  versionId: string;
  versionNumber: number;
  versionState: MatrixVersionState;
  role: AxisRole;
  compatibilityVersionId: string;
  compatibilityVersionNumber: number | null;
};

/** Quantos eixos de quantas matrizes derivaram tuplas a partir desta regra (qualquer versão dela). */
export function getCompatibilityUsage(
  doc: PolicyOpsDocument,
  ruleId: string,
): CompatibilityUsageEntry[] {
  const rule = doc.compatibility.find((candidate) => candidate.id === ruleId);
  if (rule === undefined) return [];
  const ownVersionIds = new Map(rule.versions.map((version) => [version.id, version.number]));

  const entries: CompatibilityUsageEntry[] = [];
  for (const matrix of doc.matrices) {
    for (const version of matrix.versions) {
      for (const axis of [version.axes.x, version.axes.y]) {
        for (const compatibilityVersionId of axis.derivedFrom.compatibilityVersionIds) {
          if (!ownVersionIds.has(compatibilityVersionId)) continue;
          entries.push({
            matrixId: matrix.id,
            matrixCode: matrix.code,
            versionId: version.id,
            versionNumber: version.number,
            versionState: version.state,
            role: axis.role,
            compatibilityVersionId,
            compatibilityVersionNumber: ownVersionIds.get(compatibilityVersionId) ?? null,
          });
        }
      }
    }
  }
  return entries;
}

export type CompatibilityFilter = { search?: string; includeArchived?: boolean };

export type CompatibilitySummary = {
  rule: CompatibilityRule;
  parentVariable: Variable | null;
  childVariable: Variable | null;
  publishedVersion: CompatibilityVersion | null;
  draftVersion: CompatibilityVersion | null;
  /** Combinações válidas / total, da versão publicada (ou do rascunho, na ausência dela). */
  validCombinations: number;
  totalCombinations: number;
  /** Eixos de matrizes que derivaram tuplas desta regra. */
  usageCount: number;
};

/** Lista de regras de compatibilidade com contagem de combinações e de uso (docs/07 §11). */
export function listCompatibilityRules(
  doc: PolicyOpsDocument,
  filter: CompatibilityFilter = {},
): CompatibilitySummary[] {
  const search = filter.search?.trim().toLowerCase();
  return doc.compatibility
    .filter((rule) => {
      if (rule.archivedAt !== undefined && filter.includeArchived !== true) return false;
      if (search === undefined || search.length === 0) return true;
      return rule.code.toLowerCase().includes(search) || rule.name.toLowerCase().includes(search);
    })
    .map((rule) => {
      const parentVariable = doc.variables.find((candidate) => candidate.id === rule.parentVariableId) ?? null;
      const childVariable = doc.variables.find((candidate) => candidate.id === rule.childVariableId) ?? null;
      const publishedVersion = rule.versions.find((version) => version.state === 'PUBLISHED') ?? null;
      const draftVersion = rule.versions.find((version) => version.state === 'DRAFT') ?? null;
      const displayed = publishedVersion ?? draftVersion;

      let validCombinations = 0;
      let totalCombinations = 0;
      if (displayed !== null) {
        const parentDomains = variableVersionDomains(
          doc,
          rule.parentVariableId,
          displayed.parentVariableVersionId,
        );
        const childDomains = variableVersionDomains(
          doc,
          rule.childVariableId,
          displayed.childVariableVersionId,
        );
        const counted = countAllowedCombinations(displayed, parentDomains, childDomains);
        validCombinations = counted.valid;
        totalCombinations = counted.total;
      }

      return {
        rule,
        parentVariable,
        childVariable,
        publishedVersion,
        draftVersion,
        validCombinations,
        totalCombinations,
        usageCount: getCompatibilityUsage(doc, rule.id).length,
      };
    });
}

export type ApplicableRule = { rule: CompatibilityRule; version: CompatibilityVersion };

/**
 * A regra publicada do par `(parentVariableId, childVariableId)`, ou `null`.
 * I12 garante no máximo uma — expõe para o construtor de eixos (S09) mostrar
 * "Regra X aplicada — 8 de 15 combinações válidas" ao lado de cada par
 * adjacente de níveis.
 */
export function getApplicableRule(
  doc: PolicyOpsDocument,
  parentVariableId: string,
  childVariableId: string,
): ApplicableRule | null {
  for (const rule of doc.compatibility) {
    if (rule.archivedAt !== undefined) continue;
    if (rule.parentVariableId !== parentVariableId) continue;
    if (rule.childVariableId !== childVariableId) continue;
    const version = rule.versions.find((candidate) => candidate.state === 'PUBLISHED');
    if (version !== undefined) return { rule, version };
  }
  return null;
}

// ---------------------------------------------------------------------------
// getEditorView — tudo que o grid precisa, calculado uma vez só
// ---------------------------------------------------------------------------

export type EditorAxisView = {
  axis: Axis;
  /** Uma linha de cabeçalho por nível, com os spans já calculados (S03). */
  headerRows: HeaderRow[];
  levelCount: number;
  tupleCount: number;
};

export type EditorStats = {
  combinations: number;
  filledCells: number;
  decidedCells: number;
  pendingCells: number;
};

export type EditorCatalog = {
  decisions: CatalogItem[];
  offers: CatalogItem[];
  limits: CatalogItem[];
  tags: CatalogItem[];
  /** Busca O(1) por `kind` e `code` — a célula referencia o catálogo por código. */
  byCode: Record<CatalogItemKind, Record<string, CatalogItem>>;
};

export type EditorView = {
  project: Project | null;
  matrix: Matrix;
  version: MatrixVersion;
  /** `false` em PUBLISHED, SUPERSEDED e ARCHIVED — a interface entra em modo leitura. */
  editable: boolean;
  x: EditorAxisView;
  y: EditorAxisView;
  cells: Record<string, Cell>;
  catalog: EditorCatalog;
  stats: EditorStats;
  /** Só em rascunho: o badge de defasagem não aparece em versão publicada (§5.2). */
  staleness: { x: AxisStaleness; y: AxisStaleness } | null;
};

function buildCatalog(catalog: CatalogItem[]): EditorCatalog {
  const byKind = (kind: CatalogItemKind): CatalogItem[] =>
    catalog.filter((item) => item.kind === kind).sort((a, b) => a.position - b.position);
  const byCode: Record<CatalogItemKind, Record<string, CatalogItem>> = {
    DECISION: {},
    OFFER: {},
    LIMIT: {},
    TAG: {},
  };
  for (const item of catalog) byCode[item.kind][item.code] = item;
  return {
    decisions: byKind('DECISION'),
    offers: byKind('OFFER'),
    limits: byKind('LIMIT'),
    tags: byKind('TAG'),
    byCode,
  };
}

function axisView(axis: Axis): EditorAxisView {
  return {
    axis,
    headerRows: computeHeaderLayout(axis),
    levelCount: axis.levels.length,
    tupleCount: axis.tuples.length,
  };
}

function computeEditorView(doc: PolicyOpsDocument, versionId: string): EditorView {
  const { matrix, version } = locateVersion(doc, versionId);
  const combinations = allCombinations(version).length;
  const pendingCells = listPending(version).length;
  const filledCells = Object.keys(version.cells).length;
  return {
    project: doc.projects.find((candidate) => candidate.id === matrix.projectId) ?? null,
    matrix,
    version,
    editable: version.state === 'DRAFT',
    x: axisView(version.axes.x),
    y: axisView(version.axes.y),
    cells: version.cells,
    catalog: buildCatalog(doc.catalog),
    stats: {
      combinations,
      filledCells,
      decidedCells: combinations - pendingCells,
      pendingCells,
    },
    staleness:
      version.state === 'DRAFT'
        ? {
            x: getAxisStaleness(doc, version.axes.x),
            y: getAxisStaleness(doc, version.axes.y),
          }
        : null,
  };
}

/**
 * Memoização por `(referência do documento, versionId)`.
 *
 * O `WeakMap` chaveado pelo documento é o que torna a invalidação automática e
 * exata: todo comando devolve um documento **novo** (Immer), então uma edição
 * troca a chave e o cache antigo é coletado junto com o documento antigo. Não
 * há revisão a incrementar nem cache a limpar na mão.
 */
const editorViewCache = new WeakMap<PolicyOpsDocument, Map<string, EditorView>>();

let editorViewComputations = 0;

/**
 * Tudo que o grid precisa: eixos, layout de cabeçalhos, células, catálogo,
 * estatísticas e defasagem.
 *
 * **Chame à vontade.** Recalcular o layout de cabeçalhos a cada render de
 * célula é o erro de desempenho mais provável do projeto (docs/08 §4); por
 * isso o resultado é memoizado e a mesma referência é devolvida enquanto o
 * documento não mudar.
 */
export function getEditorView(doc: PolicyOpsDocument, versionId: string): EditorView {
  let byVersion = editorViewCache.get(doc);
  if (byVersion === undefined) {
    byVersion = new Map<string, EditorView>();
    editorViewCache.set(doc, byVersion);
  }
  const cached = byVersion.get(versionId);
  if (cached !== undefined) return cached;

  const view = computeEditorView(doc, versionId);
  editorViewComputations += 1;
  byVersion.set(versionId, view);
  return view;
}

/**
 * Quantas vezes `getEditorView` realmente calculou (em vez de servir do cache).
 * Instrumentação — é o que o teste de memoização conta.
 */
export function getEditorViewComputations(): number {
  return editorViewComputations;
}

export function resetEditorViewComputations(): void {
  editorViewComputations = 0;
}
