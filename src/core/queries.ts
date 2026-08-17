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
  ComponentReviewStatus,
  ComponentVersion,
  DefaultForUnlisted,
  Domain,
  DocEvent,
  Matrix,
  MatrixVersion,
  MatrixVersionState,
  PolicyComponent,
  PolicyComponentType,
  PolicyOpsDocument,
  Project,
  Template,
  Variable,
  VariableType,
  VariableVersion,
} from './document/schema';
import { listChildren } from './document/components';
import { getAxisStaleness, type AxisStaleness } from './reconcile/stale';
import { previewTemplate } from './templates/preview';
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
// #region: vigencia-docs-05-6

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
// Linha do tempo de vigência — docs/07-ux-e-editor.md §10, docs/prompts/S15
// ---------------------------------------------------------------------------
// #region: linha-do-tempo-de-vigencia-docs-07-ux-e-editor-md-10-docs-prompts-s15

export type TimelineSegment = {
  versionId: string;
  number: number;
  state: 'PUBLISHED' | 'SUPERSEDED';
  effectiveFrom: string;
  /** `null`: ainda vigente (ou agendada, sem sucessora ainda) — a faixa desenha até "agora". */
  effectiveTo: string | null;
  publishedBy?: string;
};

/**
 * Os segmentos de vigência da matriz, em ordem cronológica — um por versão
 * que já teve `effectiveFrom` (`PUBLISHED` ou `SUPERSEDED`; rascunho e
 * descartada nunca vigoraram). É a base da faixa de linha do tempo por
 * matriz (docs/07 §10): largura proporcional à duração, um segmento por
 * versão publicada.
 */
export function getMatrixTimeline(matrix: Matrix): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  for (const version of matrix.versions) {
    if (version.state !== 'PUBLISHED' && version.state !== 'SUPERSEDED') continue;
    if (version.effectiveFrom === undefined) continue;
    const segment: TimelineSegment = {
      versionId: version.id,
      number: version.number,
      state: version.state,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo ?? null,
    };
    if (version.publishedBy !== undefined) segment.publishedBy = version.publishedBy;
    segments.push(segment);
  }
  return segments.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

// ---------------------------------------------------------------------------
// Histórico e auditoria
// ---------------------------------------------------------------------------
// #region: historico-e-auditoria

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
// #region: defasagem-de-eixo-docs-05-5-2

/**
 * A detecção vive em `src/core/reconcile/stale.ts` (S16): é regra de
 * reconciliação, não consulta de leitura. Reexportada aqui porque a interface
 * já a consome por `@/core/queries` desde a S12 — um único ponto de entrada
 * para o que a tela precisa saber sobre uma versão.
 */
export {
  getAxisStaleness,
  getDraftsAdoptingRule,
  getDraftsAdoptingVariable,
  getStaleAxes,
  reasonsForLevel,
  reasonsForRules,
  type AxisStaleness,
  type StaleAxisEntry,
  type StaleReason,
  type StaleReasonKind,
} from './reconcile/stale';

/** A versão `PUBLISHED` vigente da matriz, se houver — I2 garante no máximo uma. */
export function getPublishedVersion(matrix: Matrix): MatrixVersion | null {
  return matrix.versions.find((version) => version.state === 'PUBLISHED') ?? null;
}

/** O rascunho aberto da matriz, se houver — I1 garante no máximo um. */
export function getOpenDraft(matrix: Matrix): MatrixVersion | null {
  return matrix.versions.find((version) => version.state === 'DRAFT') ?? null;
}

/**
 * A versão que "SUPERSEDED" imediatamente antes de `version` — quem ela
 * substituiu ao ser publicada. Usada como alvo padrão de "Comparar" quando a
 * própria versão é a vigente (ou uma agendada) e não há vigente distinta
 * dela mesma para comparar.
 */
export function getPrecedingVersion(matrix: Matrix, version: MatrixVersion): MatrixVersion | null {
  if (version.effectiveFrom === undefined) return null;
  return (
    matrix.versions.find(
      (candidate) => candidate.state === 'SUPERSEDED' && candidate.effectiveTo === version.effectiveFrom,
    ) ?? null
  );
}

/**
 * O par pré-selecionado da tela de comparação (docs/07 §9), quando ninguém
 * escolheu ainda: o rascunho contra a vigente da primeira matriz que tiver as
 * duas — o caso de uso central — ou, na falta disso, as duas versões mais
 * recentes de alguma matriz. `null` quando o documento não tem dois pontos de
 * comparação. `aId` é sempre a base.
 */
export function defaultComparePair(
  doc: PolicyOpsDocument,
): { aId: string; bId: string } | null {
  for (const matrix of doc.matrices) {
    const draft = getOpenDraft(matrix);
    const published = getPublishedVersion(matrix);
    if (draft !== null && published !== null) return { aId: published.id, bId: draft.id };
  }
  for (const matrix of doc.matrices) {
    const byNumber = [...matrix.versions].sort((a, b) => b.number - a.number);
    if (byNumber.length >= 2) return { aId: byNumber[1]!.id, bId: byNumber[0]!.id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tela de rascunhos — docs/prompts/S13-ciclo-de-vida.md item 5
// ---------------------------------------------------------------------------
// #region: tela-de-rascunhos-docs-prompts-s13-ciclo-de-vida-md-item-5

export type OpenDraftEntry = {
  matrix: Matrix;
  project: Project | null;
  version: MatrixVersion;
  pendingCells: number;
};

/** Todos os rascunhos abertos de todos os projetos — a tela `/drafts`. */
export function listOpenDrafts(doc: PolicyOpsDocument): OpenDraftEntry[] {
  const entries: OpenDraftEntry[] = [];
  for (const matrix of doc.matrices) {
    const draft = getOpenDraft(matrix);
    if (draft === null) continue;
    entries.push({
      matrix,
      project: doc.projects.find((candidate) => candidate.id === matrix.projectId) ?? null,
      version: draft,
      pendingCells: countPendingIn(draft),
    });
  }
  return entries.sort((a, b) => b.version.createdAt.localeCompare(a.version.createdAt));
}

// ---------------------------------------------------------------------------
// Navegação de projeto → matriz → versão — docs/09 S09
// ---------------------------------------------------------------------------
// #region: navegacao-de-projeto-matriz-versao-docs-09-s09

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
// Tags e filtro de matrizes — docs/07-ux-e-editor.md §15, docs/03 §4/§5
// ---------------------------------------------------------------------------
// #region: tags-e-filtro-de-matrizes-docs-07-ux-e-editor-md-15-docs-03-4-5

export type TagFacetOption = {
  code: string;
  label: string;
  color?: string;
  /** Sobre o conjunto de matrizes **antes** do filtro do próprio grupo (comportamento padrão de faceta). */
  count: number;
};

export type TagFacetGroup = {
  /** `"Sem grupo"` quando o `CatalogItem` de kind TAG não declara `group` (docs/03 §4). */
  group: string;
  options: TagFacetOption[];
};

export type ListMatricesFilter = {
  projectId?: string;
  /** Codes de `CatalogItem` de kind TAG, de qualquer grupo — agrupados internamente para aplicar OU dentro do grupo e E entre grupos. */
  tags?: string[];
  search?: string;
};

export type ListMatricesResult = {
  matrices: Matrix[];
  facets: TagFacetGroup[];
};

const UNGROUPED_TAG_LABEL = 'Sem grupo';

/**
 * Matrizes filtradas por projeto, busca textual e facetas de tag: **OU**
 * dentro do mesmo grupo (`Canal: Digital` ou `URA`), **E** entre grupos
 * diferentes (`Canal: Digital` **e** `Cluster: G4`) — docs/07 §15. Tag
 * arquivada nunca entra em `facets` (some do filtro), mas uma matriz que já a
 * tem continua no resultado normalmente — arquivar não altera matriz nenhuma.
 *
 * `facets[].options[].count` é sempre calculado sobre o conjunto que passou
 * em todos os filtros **exceto** o do próprio grupo — é o que faz o número
 * ao lado de cada tag responder "quantas eu teria se marcasse esta,
 * mantendo as outras facetas", em vez de refletir o filtro já aplicado.
 */
export function listMatrices(doc: PolicyOpsDocument, filter: ListMatricesFilter = {}): ListMatricesResult {
  const { projectId, tags = [], search } = filter;

  const activeTagItems = doc.catalog.filter((item) => item.kind === 'TAG' && item.archivedAt === undefined);
  const groupOfCode = new Map(activeTagItems.map((item) => [item.code, item.group ?? UNGROUPED_TAG_LABEL]));

  const selectedByGroup = new Map<string, Set<string>>();
  for (const code of tags) {
    const group = groupOfCode.get(code) ?? UNGROUPED_TAG_LABEL;
    const set = selectedByGroup.get(group) ?? new Set<string>();
    set.add(code);
    selectedByGroup.set(group, set);
  }

  const searchLower = search?.trim().toLowerCase();

  function passesScope(matrix: Matrix): boolean {
    if (matrix.archivedAt !== undefined) return false;
    if (projectId !== undefined && matrix.projectId !== projectId) return false;
    if (searchLower !== undefined && searchLower.length > 0) {
      const haystack = `${matrix.code} ${matrix.name}`.toLowerCase();
      if (!haystack.includes(searchLower)) return false;
    }
    return true;
  }

  function passesTagGroups(matrix: Matrix, exceptGroup: string | null): boolean {
    const matrixTags = matrix.tags ?? [];
    for (const [group, codes] of selectedByGroup) {
      if (group === exceptGroup) continue;
      if (!matrixTags.some((code) => codes.has(code))) return false;
    }
    return true;
  }

  const inScope = doc.matrices.filter(passesScope);
  const matrices = inScope.filter((matrix) => passesTagGroups(matrix, null));

  const itemsByGroup = new Map<string, CatalogItem[]>();
  for (const item of activeTagItems) {
    const group = item.group ?? UNGROUPED_TAG_LABEL;
    const list = itemsByGroup.get(group) ?? [];
    list.push(item);
    itemsByGroup.set(group, list);
  }

  const facets: TagFacetGroup[] = [...itemsByGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, items]) => {
      const scoped = inScope.filter((matrix) => passesTagGroups(matrix, group));
      const options = items
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((item) => {
          const option: TagFacetOption = {
            code: item.code,
            label: item.label,
            count: scoped.filter((matrix) => (matrix.tags ?? []).includes(item.code)).length,
          };
          if (item.color !== undefined) option.color = item.color;
          return option;
        });
      return { group, options };
    });

  return { matrices, facets };
}

// ---------------------------------------------------------------------------
// Biblioteca de variáveis
// ---------------------------------------------------------------------------
// #region: biblioteca-de-variaveis

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
// #region: biblioteca-de-compatibilidade-docs-08-4-docs-07-11

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
// #region: get-editor-view-tudo-que-o-grid-precisa-calculado-uma-vez-so

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
    // Kinds do épico Governança (schema 5): não têm uso no grid, mas o mapa é
    // total por kind e um item solto sem entrada aqui estouraria em runtime.
    MOTIVATOR: {},
    IMPACT_CATEGORY: {},
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

// ---------------------------------------------------------------------------
// Templates — docs/07-ux-e-editor.md §11, docs/prompts/S17 Parte A
// ---------------------------------------------------------------------------
// #region: templates-docs-07-ux-e-editor-md-11-docs-prompts-s17-parte-a

export type TemplateSummary = {
  template: Template;
  /** `null` quando o preview falha (ex.: variável sem versão publicada) — a lista mostra o aviso. */
  combinations: number | null;
  filledCount: number | null;
  pendingCount: number | null;
  error: string | null;
};

/** Lista de templates com o preview atual — docs/07 §11. */
export function listTemplates(
  doc: PolicyOpsDocument,
  filter: { includeArchived?: boolean } = {},
): TemplateSummary[] {
  return doc.templates
    .filter((template) => filter.includeArchived === true || template.archivedAt === undefined)
    .map((template) => {
      try {
        const preview = previewTemplate(doc, template.id);
        return {
          template,
          combinations: preview.combinations,
          filledCount: preview.filledCount,
          pendingCount: preview.pendingCount,
          error: null,
        };
      } catch (error) {
        return {
          template,
          combinations: null,
          filledCount: null,
          pendingCount: null,
          error: error instanceof Error ? error.message : 'Não foi possível gerar o preview deste template.',
        };
      }
    });
}

// ---------------------------------------------------------------------------
// Carga de matrizes — origem dos rascunhos (docs/12 §6.2, US-10)
// ---------------------------------------------------------------------------
// #region: carga-de-matrizes-origem-dos-rascunhos-docs-12-6-2-us-10

/** Uma rodada de carga, lida do evento `IMPORT_RUN` que a registrou. */
export type ImportRunSummary = {
  importRunId: string;
  profileCode: string;
  fileName: string | null;
  /** A nota da carga — vira a nota padrão de cada publicação da fila (US-07). */
  notes: string;
  at: string;
  actor: string;
  summary: string;
};

function importRunOf(event: DocEvent): ImportRunSummary | null {
  const payload = event.payload;
  if (payload === undefined) return null;
  const importRunId = payload.importRunId;
  if (typeof importRunId !== 'string') return null;
  return {
    importRunId,
    profileCode: typeof payload.profileCode === 'string' ? payload.profileCode : '',
    fileName: typeof payload.fileName === 'string' ? payload.fileName : null,
    notes: typeof payload.notes === 'string' ? payload.notes : '',
    at: event.at,
    actor: event.actor,
    summary: event.summary,
  };
}

/** As cargas aplicadas neste documento, da mais recente para a mais antiga. */
export function listImportRuns(doc: PolicyOpsDocument): ImportRunSummary[] {
  const runs: ImportRunSummary[] = [];
  for (const event of doc.events) {
    if (event.type !== 'IMPORT_RUN') continue;
    const run = importRunOf(event);
    if (run !== null) runs.push(run);
  }
  return runs.reverse();
}

/**
 * A carga que criou este rascunho, ou `null` se ele nasceu à mão. Sai do
 * `importRunId` que `import/apply` carimba no `DRAFT_CREATED` da versão
 * (docs/12 US-10) — é o que faz o rascunho exibir "Criado pela carga
 * CINEMINHA_20260708 em 10/08/2026" mesmo depois de fechar o assistente.
 */
export function getImportOrigin(doc: PolicyOpsDocument, versionId: string): ImportRunSummary | null {
  let importRunId: string | undefined;
  for (const event of doc.events) {
    if (event.type !== 'DRAFT_CREATED' || event.scope.versionId !== versionId) continue;
    const candidate = event.payload?.importRunId;
    if (typeof candidate === 'string') importRunId = candidate;
  }
  if (importRunId === undefined) return null;
  return listImportRuns(doc).find((run) => run.importRunId === importRunId) ?? null;
}

// ---------------------------------------------------------------------------
// Árvore de política — docs/07-ux-e-editor.md §17, docs/14-governanca-de-alteracoes.md §3.1
// ---------------------------------------------------------------------------
// #region: arvore-de-politica-docs-07-17

/** Caminho da raiz até o nó, inclusive — o breadcrumb clicável do topo do conteúdo (docs/07 §17.1). */
export function componentPath(doc: PolicyOpsDocument, componentId: string): PolicyComponent[] {
  const byId = new Map(doc.components.map((component) => [component.id, component]));
  const path: PolicyComponent[] = [];
  const seen = new Set<string>();
  let current = byId.get(componentId);
  while (current !== undefined && !seen.has(current.id)) {
    path.unshift(current);
    seen.add(current.id);
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return path;
}

/** Matrizes do projeto ainda sem nó `MATRIX` na árvore (I27) — o universo do seletor do §17.2. */
export function listUnmirroredMatrices(doc: PolicyOpsDocument, projectId: string): Matrix[] {
  const mirrored = new Set(
    doc.components
      .filter((component) => component.matrixId !== undefined)
      .map((component) => component.matrixId!),
  );
  return doc.matrices.filter(
    (matrix) =>
      matrix.projectId === projectId && matrix.archivedAt === undefined && !mirrored.has(matrix.id),
  );
}

export type ComponentTreeFilter = {
  search?: string;
  types?: PolicyComponentType[];
  reviewStatuses?: ComponentReviewStatus[];
  /** Codes de `CatalogItem` kind TAG — mesma semântica OU-no-grupo/E-entre-grupos de `listMatrices` (docs/07 §15). */
  tags?: string[];
};

export type ComponentTreeFilterResult = {
  /** Nós que passam em todos os filtros. */
  matchedIds: Set<string>;
  /** `matchedIds` mais todos os ancestrais — o painel mostra esses a mais esmaecidos (docs/07 §17.1). */
  visibleIds: Set<string>;
  facets: TagFacetGroup[];
};

const NO_COMPONENT_FILTER: ComponentTreeFilter = {};

/**
 * Filtra a árvore de um projeto por busca, tipo, `reviewStatus` e faceta de
 * tag, devolvendo também os ancestrais dos nós que sobraram — ao contrário
 * de `listMatrices`, que devolve uma lista plana, aqui o filtro **não**
 * achata a árvore (docs/07 §17.1): quem renderiza decide mostrar
 * `visibleIds \ matchedIds` esmaecido.
 */
export function filterComponentTree(
  doc: PolicyOpsDocument,
  projectId: string,
  filter: ComponentTreeFilter = NO_COMPONENT_FILTER,
): ComponentTreeFilterResult {
  const { search, types, reviewStatuses, tags = [] } = filter;
  const inProject = doc.components.filter(
    (component) => component.projectId === projectId && component.archivedAt === undefined,
  );

  const activeTagItems = doc.catalog.filter((item) => item.kind === 'TAG' && item.archivedAt === undefined);
  const groupOfCode = new Map(activeTagItems.map((item) => [item.code, item.group ?? UNGROUPED_TAG_LABEL]));
  const selectedByGroup = new Map<string, Set<string>>();
  for (const code of tags) {
    const group = groupOfCode.get(code) ?? UNGROUPED_TAG_LABEL;
    const set = selectedByGroup.get(group) ?? new Set<string>();
    set.add(code);
    selectedByGroup.set(group, set);
  }

  const searchLower = search?.trim().toLowerCase();
  const typeSet = types === undefined || types.length === 0 ? null : new Set(types);
  const statusSet =
    reviewStatuses === undefined || reviewStatuses.length === 0 ? null : new Set(reviewStatuses);

  function passesTagGroups(component: PolicyComponent, exceptGroup: string | null): boolean {
    const componentTags = component.tags ?? [];
    for (const [group, codes] of selectedByGroup) {
      if (group === exceptGroup) continue;
      if (!componentTags.some((code) => codes.has(code))) return false;
    }
    return true;
  }

  function passesScope(component: PolicyComponent): boolean {
    if (typeSet !== null && !typeSet.has(component.type)) return false;
    if (statusSet !== null && !statusSet.has(component.reviewStatus)) return false;
    if (searchLower !== undefined && searchLower.length > 0) {
      const haystack = `${component.code} ${component.name}`.toLowerCase();
      if (!haystack.includes(searchLower)) return false;
    }
    return true;
  }

  const inScope = inProject.filter(passesScope);
  const matched = inScope.filter((component) => passesTagGroups(component, null));
  const matchedIds = new Set(matched.map((component) => component.id));

  const byId = new Map(inProject.map((component) => [component.id, component]));
  const visibleIds = new Set<string>();
  for (const component of matched) {
    let current: PolicyComponent | undefined = component;
    while (current !== undefined && !visibleIds.has(current.id)) {
      visibleIds.add(current.id);
      current = current.parentId === undefined ? undefined : byId.get(current.parentId);
    }
  }

  const itemsByGroup = new Map<string, CatalogItem[]>();
  for (const item of activeTagItems) {
    const group = item.group ?? UNGROUPED_TAG_LABEL;
    const list = itemsByGroup.get(group) ?? [];
    list.push(item);
    itemsByGroup.set(group, list);
  }
  const facets: TagFacetGroup[] = [...itemsByGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, items]) => {
      const scoped = inScope.filter((component) => passesTagGroups(component, group));
      const options = items
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((item) => {
          const option: TagFacetOption = {
            code: item.code,
            label: item.label,
            count: scoped.filter((component) => (component.tags ?? []).includes(item.code)).length,
          };
          if (item.color !== undefined) option.color = item.color;
          return option;
        });
      return { group, options };
    });

  return { matchedIds, visibleIds, facets };
}

/** Anchors dos dois primeiros níveis da árvore (docs/07 §17.1) — o que a sidebar mostra sob o projeto. */
export type SidebarTreeAnchors = {
  level1: PolicyComponent[];
  level2ByParent: Map<string, PolicyComponent[]>;
};

export function sidebarTreeAnchors(doc: PolicyOpsDocument, projectId: string): SidebarTreeAnchors {
  const level1 = listChildren(doc, projectId, undefined).filter(
    (component) => component.archivedAt === undefined,
  );
  const level2ByParent = new Map<string, PolicyComponent[]>();
  for (const parent of level1) {
    level2ByParent.set(
      parent.id,
      listChildren(doc, projectId, parent.id).filter((component) => component.archivedAt === undefined),
    );
  }
  return { level1, level2ByParent };
}

// ---------------------------------------------------------------------------
// Vigência e linha do tempo de componente — docs/07 §10/§17.5,
// docs/14-governanca-de-alteracoes.md §3.2, RN-GOV-06, I29
// ---------------------------------------------------------------------------
// #region: vigencia-e-linha-do-tempo-de-componente

/**
 * Os segmentos de vigência do componente, no mesmo formato de
 * `getMatrixTimeline` — é o que alimenta `MatrixTimelineBar` (docs/07 §10)
 * também para a timeline do inspector de componente (§17.5). `MATRIX` nunca
 * tem versão própria (I27) e devolve sempre `[]`.
 */
export function getComponentTimeline(component: PolicyComponent): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  for (const version of component.versions) {
    if (version.state !== 'PUBLISHED' && version.state !== 'SUPERSEDED') continue;
    if (version.effectiveFrom === undefined) continue;
    const segment: TimelineSegment = {
      versionId: version.id,
      number: version.number,
      state: version.state,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo ?? null,
    };
    if (version.publishedBy !== undefined) segment.publishedBy = version.publishedBy;
    segments.push(segment);
  }
  return segments.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/**
 * A versão vigente do componente em `at` (intervalo semiaberto
 * `[effectiveFrom, effectiveTo)`, mesma semântica de `getEffectiveVersion`
 * para matriz). Componente sem nenhuma versão (seção pura, I29) devolve
 * sempre `null` — é estrutura, não conteúdo, e nunca é "sem política
 * vigente".
 */
export function getComponentEffectiveVersion(component: PolicyComponent, at: Date): ComponentVersion | null {
  if (component.versions.length === 0) return null;
  const atIso = at.toISOString();
  return (
    component.versions.find(
      (version) =>
        (version.state === 'PUBLISHED' || version.state === 'SUPERSEDED') &&
        version.effectiveFrom !== undefined &&
        atIso >= version.effectiveFrom &&
        (version.effectiveTo === undefined || atIso < version.effectiveTo),
    ) ?? null
  );
}

export type ComponentCurrentSummary = { version: ComponentVersion | null; summary: string };

/**
 * "Hoje" pronto para um item de DB (US-GOV-03, docs/14 §3.3):
 * `businessDescription` da versão vigente em `at` — o único campo que os
 * cinco payloads de `ComponentVersion` têm em comum (docs/03 §12.2). Sem
 * versão vigente, o "hoje" é a ausência mesma: o texto avisa e o chamador
 * decide se trata como `CREATE`.
 */
export function getComponentCurrentSummary(component: PolicyComponent, at: Date): ComponentCurrentSummary {
  const version = getComponentEffectiveVersion(component, at);
  if (version === null) return { version: null, summary: 'Não existe — sem versão vigente hoje.' };
  return { version, summary: version.payload.businessDescription };
}

export type ComponentEffectiveEntry = {
  component: PolicyComponent;
  /** `null` = sem versão vigente nesta data — só aparece para componente **documentável** (I29). */
  version: ComponentVersion | null;
};

/**
 * A política em `at`, por componente — a mesma pergunta de `getPortfolioAt`
 * para matriz, aplicada à árvore. `MATRIX` fica de fora (é espelho: sua
 * vigência é a da matriz, já coberta por `getPortfolioAt`) e **seção sem
 * nenhuma versão também fica de fora inteiramente** — ela é estrutura pura
 * (I29), e listá-la com `version: null` a faria aparecer como "sem política
 * vigente", que é exatamente o que I29 proíbe.
 */
export function listComponentsEffectiveAt(
  doc: PolicyOpsDocument,
  projectId: string,
  at: Date,
): ComponentEffectiveEntry[] {
  return doc.components
    .filter((component) => component.projectId === projectId && component.type !== 'MATRIX')
    .filter((component) => component.versions.length > 0)
    .map((component) => ({ component, version: getComponentEffectiveVersion(component, at) }));
}

// ---------------------------------------------------------------------------
// Rascunhos pendentes de componente — docs/07 §17.4, RN-GOV-09
// ---------------------------------------------------------------------------
// #region: rascunhos-pendentes-de-componente

export type PendingComponentVersion = {
  component: PolicyComponent;
  version: ComponentVersion;
};

/**
 * Todo componente do projeto com um rascunho em aberto (I29: no máximo um por
 * componente) — o universo de "Publicar pendentes" (docs/07 §17.4). Ordenado
 * pelo mesmo caminho de leitura da árvore, para que o lote apareça na ordem
 * em que o usuário digitou.
 */
export function listPendingComponentVersions(
  doc: PolicyOpsDocument,
  projectId: string,
): PendingComponentVersion[] {
  return doc.components
    .filter((component) => component.projectId === projectId && component.type !== 'MATRIX')
    .flatMap((component) => {
      const draft = component.versions.find((version) => version.state === 'DRAFT');
      return draft === undefined ? [] : [{ component, version: draft }];
    })
    .sort((a, b) => {
      const pathA = componentPath(doc, a.component.id).map((c) => c.position);
      const pathB = componentPath(doc, b.component.id).map((c) => c.position);
      const length = Math.min(pathA.length, pathB.length);
      for (let i = 0; i < length; i++) {
        if (pathA[i] !== pathB[i]) return pathA[i]! - pathB[i]!;
      }
      return pathA.length - pathB.length;
    });
}
