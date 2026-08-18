import { changeRequestProjectIds } from '../document/change-requests';
import type {
  ChangeRequest,
  ComponentVersion,
  Matrix,
  MatrixVersion,
  PolicyComponent,
  PolicyOpsDocument,
  Release,
} from '../document/schema';
import { getComponentEffectiveVersion, getEffectiveVersion } from '../queries';

/**
 * Fotografia da política inteira numa data — docs/14-governanca-de-alteracoes.md
 * §4 (US-GOV-07), docs/05-regras-de-negocio.md §6.2.
 *
 * A fotografia tem **duas fontes** (DEC-GOV-002): a versão vigente de cada
 * componente documentado e a versão vigente de cada matriz. Este módulo não
 * reimplementa nenhuma das duas — chama `getComponentEffectiveVersion` e
 * `getEffectiveVersion` (`src/core/queries.ts`) e compõe o resultado na ordem
 * de leitura da árvore. Toda a regra de vigência continua morando lá; o que
 * mora aqui é a **composição** e as regras de presença que só existem quando
 * se olha a política como um todo (arquivamento, seção pura, matriz sem
 * espelho).
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
// #region: tipos-da-fotografia

/**
 * O que o nó era naquela data:
 *
 * - `EFFECTIVE` — tinha versão vigente (de componente ou de matriz);
 * - `ABSENT` — é conteúdo, mas não havia versão vigente: a regra ainda não
 *   existia, ou a matriz ainda não tinha sido publicada. Não é erro (§6) e é
 *   exatamente o "inexistente/desativado" que a US-GOV-07 pede;
 * - `STRUCTURE` — seção pura (I29): pasta de leitura, sem versão nenhuma. Não
 *   é "sem política vigente" e nunca entra nos contadores nem na comparação.
 */
export type PolicySnapshotStatus = 'EFFECTIVE' | 'ABSENT' | 'STRUCTURE';

/** `COMPONENT` cobre os cinco tipos versionáveis; `MATRIX` cobre espelho e matriz órfã. */
export type PolicySnapshotNodeKind = 'COMPONENT' | 'MATRIX';

export type PolicySnapshotNode = {
  /**
   * Identidade estável da linha entre duas fotografias. É o id do componente
   * — inclusive no espelho de matriz, que é o nó da árvore — e
   * `matrix:<matrixId>` na matriz sem espelho, que não tem componente para
   * emprestar id.
   */
  key: string;
  kind: PolicySnapshotNodeKind;
  status: PolicySnapshotStatus;
  /** `null` só na matriz sem componente espelho. */
  component: PolicyComponent | null;
  /** Ancestrais na árvore, da raiz até o pai. Vazio na raiz e na matriz órfã. */
  ancestors: PolicyComponent[];
  /** Ancestral mais próximo de `type: 'SECTION'` — o agrupamento da comparação. `null` = raiz do projeto. */
  section: PolicyComponent | null;
  /** 1-based, como `componentDepth`. A matriz órfã é raiz (1). */
  depth: number;
  /** Versão vigente do componente. Sempre `null` em `kind: 'MATRIX'` (I27). */
  version: ComponentVersion | null;
  /** Só em `kind: 'MATRIX'`. */
  matrix: Matrix | null;
  /** Versão vigente da matriz em `at`. Só em `kind: 'MATRIX'`. */
  matrixVersion: MatrixVersion | null;
};

export type PolicySnapshotCounts = {
  /** `effectiveComponents + effectiveMatrices` — o "componentes vigentes" da US-GOV-07. */
  effective: number;
  effectiveComponents: number;
  effectiveMatrices: number;
  /** Conteúdo sem versão vigente naquela data. */
  absent: number;
  /** Seções puras (I29) — estrutura, nunca vigência. */
  structure: number;
  /** Quantas das matrizes do projeto entraram sem espelho na árvore. */
  orphanMatrices: number;
};

export type PolicySnapshot = {
  projectId: string;
  /** O instante consultado, em ISO 8601. */
  at: string;
  /** Ordem de leitura da árvore (profundidade, por `position`); matrizes sem espelho no fim. */
  nodes: PolicySnapshotNode[];
  counts: PolicySnapshotCounts;
};

// ---------------------------------------------------------------------------
// Fotografia
// ---------------------------------------------------------------------------
// #region: fotografia-da-politica

/**
 * Um nó existe na fotografia enquanto não tiver sido arquivado — e o
 * arquivamento vale **daquele instante em diante**: em toda data anterior o
 * componente (ou a matriz) continua na fotografia, com a versão que vigorava.
 * É o que separa "arquivar" de "apagar a história".
 */
function existsAt(archivedAt: string | undefined, atIso: string): boolean {
  return archivedAt === undefined || atIso < archivedAt;
}

function statusOf(node: {
  kind: PolicySnapshotNodeKind;
  component: PolicyComponent | null;
  version: ComponentVersion | null;
  matrixVersion: MatrixVersion | null;
}): PolicySnapshotStatus {
  if (node.kind === 'MATRIX') return node.matrixVersion === null ? 'ABSENT' : 'EFFECTIVE';
  // Seção pura (I29): estrutura, não conteúdo — nunca "sem política vigente".
  // A checagem é `SECTION` **sem versão nenhuma**, não "sem versão vigente":
  // uma seção documentada tem vigência como qualquer outra, e uma regra ainda
  // não documentada é conteúdo em branco, não pasta.
  if (node.component?.type === 'SECTION' && node.component.versions.length === 0) return 'STRUCTURE';
  return node.version === null ? 'ABSENT' : 'EFFECTIVE';
}

/**
 * A política do projeto em `at`, nó a nó.
 *
 * Regras de borda, todas explícitas porque nenhuma delas aparece em teste
 * superficial:
 *
 * - **vigência é semiaberta** `[effectiveFrom, effectiveTo)` — na data exata da
 *   troca já vale a versão nova, e uma versão `PUBLISHED` com `effectiveFrom`
 *   no futuro **não** vige (publicação agendada, docs/05 §6);
 * - **arquivar não reescreve o passado** — o nó arquivado some das fotografias
 *   a partir de `archivedAt` e permanece em todas as anteriores;
 * - **presença é vigência, nunca `createdAt`** — cadastrar hoje uma regra que
 *   vigora desde março (vigência retroativa, RN-GOV-09) a coloca na fotografia
 *   de março, que é o ponto de ter fundação retroativa;
 * - **seção pura é estrutura** (I29): entra como `STRUCTURE`, fora dos
 *   contadores e da comparação, para que uma pasta nunca apareça como regra
 *   que caducou;
 * - **matriz sem espelho na árvore não some** (DEC-GOV-039): entra ao final,
 *   como nó de raiz sem componente. A árvore de componentes é opcional e
 *   incremental; a fotografia da política é a resposta de auditoria e precisa
 *   valer mesmo num projeto que só tem matrizes.
 */
export function getPolicyAt(doc: PolicyOpsDocument, projectId: string, at: Date): PolicySnapshot {
  const atIso = at.toISOString();
  const nodes: PolicySnapshotNode[] = [];

  const childrenByParent = new Map<string, PolicyComponent[]>();
  for (const component of doc.components) {
    if (component.projectId !== projectId) continue;
    const key = component.parentId ?? '';
    const siblings = childrenByParent.get(key);
    if (siblings === undefined) childrenByParent.set(key, [component]);
    else siblings.push(component);
  }
  for (const siblings of childrenByParent.values()) siblings.sort((a, b) => a.position - b.position);

  const matrixById = new Map(doc.matrices.map((matrix) => [matrix.id, matrix] as const));
  const mirroredMatrixIds = new Set<string>();

  function visit(parentId: string, ancestors: PolicyComponent[], section: PolicyComponent | null): void {
    for (const component of childrenByParent.get(parentId) ?? []) {
      // Arquivado não some da árvore de trás: some das fotografias daqui para a
      // frente — e leva a subárvore junto, como o arquivamento já faz na tela.
      // O espelho arquivado também deixa de espelhar: a matriz volta a entrar
      // pela porta da matriz órfã, em vez de sumir da fotografia com o nó.
      if (!existsAt(component.archivedAt, atIso)) continue;
      if (component.type === 'MATRIX' && component.matrixId !== undefined) {
        mirroredMatrixIds.add(component.matrixId);
      }

      const matrix =
        component.type === 'MATRIX' && component.matrixId !== undefined
          ? (matrixById.get(component.matrixId) ?? null)
          : null;
      // Matriz arquivada segue a mesma regra do componente arquivado: sai das
      // fotografias a partir de `archivedAt`, e o espelho sai com ela.
      if (matrix !== null && !existsAt(matrix.archivedAt, atIso)) continue;

      const node: PolicySnapshotNode = {
        key: component.id,
        kind: component.type === 'MATRIX' ? 'MATRIX' : 'COMPONENT',
        status: 'ABSENT',
        component,
        ancestors,
        section,
        depth: ancestors.length + 1,
        version: component.type === 'MATRIX' ? null : getComponentEffectiveVersion(component, at),
        matrix,
        matrixVersion: matrix === null ? null : getEffectiveVersion(doc, matrix.id, at),
      };
      node.status = statusOf(node);
      nodes.push(node);

      visit(
        component.id,
        [...ancestors, component],
        component.type === 'SECTION' ? component : section,
      );
    }
  }

  visit('', [], null);

  let orphanMatrices = 0;
  for (const matrix of doc.matrices) {
    if (matrix.projectId !== projectId) continue;
    if (mirroredMatrixIds.has(matrix.id)) continue;
    if (!existsAt(matrix.archivedAt, atIso)) continue;
    orphanMatrices += 1;
    const matrixVersion = getEffectiveVersion(doc, matrix.id, at);
    nodes.push({
      key: orphanMatrixKey(matrix.id),
      kind: 'MATRIX',
      status: matrixVersion === null ? 'ABSENT' : 'EFFECTIVE',
      component: null,
      ancestors: [],
      section: null,
      depth: 1,
      version: null,
      matrix,
      matrixVersion,
    });
  }

  return { projectId, at: atIso, nodes, counts: countNodes(nodes, orphanMatrices) };
}

/** A chave de fotografia de uma matriz que nenhum componente espelha. */
export function orphanMatrixKey(matrixId: string): string {
  return `matrix:${matrixId}`;
}

function countNodes(nodes: PolicySnapshotNode[], orphanMatrices: number): PolicySnapshotCounts {
  const counts: PolicySnapshotCounts = {
    effective: 0,
    effectiveComponents: 0,
    effectiveMatrices: 0,
    absent: 0,
    structure: 0,
    orphanMatrices,
  };
  for (const node of nodes) {
    if (node.status === 'STRUCTURE') counts.structure += 1;
    else if (node.status === 'ABSENT') counts.absent += 1;
    else if (node.kind === 'MATRIX') counts.effectiveMatrices += 1;
    else counts.effectiveComponents += 1;
  }
  counts.effective = counts.effectiveComponents + counts.effectiveMatrices;
  return counts;
}

/** O nó de uma fotografia pela chave — o que a comparação usa para casar os dois lados. */
export function snapshotNodeIndex(snapshot: PolicySnapshot): Map<string, PolicySnapshotNode> {
  return new Map(snapshot.nodes.map((node) => [node.key, node] as const));
}

// ---------------------------------------------------------------------------
// Contadores do período — US-GOV-07
// ---------------------------------------------------------------------------
// #region: contadores-do-periodo

export type PolicyPeriodCounters = {
  from: string;
  to: string;
  /** Vigentes **no fim** do período: um contador de estoque, não de fluxo. */
  effectiveComponents: number;
  effectiveMatrices: number;
  /** DBs do projeto **publicados** com vigência dentro do período (inclusive nas duas pontas). */
  publishedChangeRequests: number;
  /** DBs do projeto ainda vivos — nem publicados, nem rejeitados, nem cancelados. */
  inFlightChangeRequests: number;
};

const CLOSED_CR_STATUSES = new Set(['PUBLISHED', 'REJECTED', 'CANCELLED']);

/**
 * Os três números do cabeçalho da consulta por data (US-GOV-07): o que está
 * vigente, o que mudou no período e o que ainda está para mudar.
 *
 * "Publicado no período" é medido pela **vigência** (`proposedEffectiveDate`),
 * não pela data em que alguém clicou em publicar: é a vigência que responde
 * "o que valia", e é ela que a timeline do DB já usa como régua (S37).
 */
export function getPolicyPeriodCounters(
  doc: PolicyOpsDocument,
  projectId: string,
  from: Date,
  to: Date,
): PolicyPeriodCounters {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const counts = getPolicyAt(doc, projectId, to).counts;

  let publishedChangeRequests = 0;
  let inFlightChangeRequests = 0;
  for (const cr of doc.changeRequests) {
    if (!changeRequestProjectIds(doc, cr).has(projectId)) continue;
    if (cr.status === 'PUBLISHED') {
      const effective = cr.proposedEffectiveDate;
      if (effective !== undefined && effective >= fromIso && effective <= toIso) {
        publishedChangeRequests += 1;
      }
      continue;
    }
    if (!CLOSED_CR_STATUSES.has(cr.status)) inFlightChangeRequests += 1;
  }

  return {
    from: fromIso,
    to: toIso,
    effectiveComponents: counts.effectiveComponents,
    effectiveMatrices: counts.effectiveMatrices,
    publishedChangeRequests,
    inFlightChangeRequests,
  };
}

// ---------------------------------------------------------------------------
// Janela de comparação de uma release — US-GOV-08
// ---------------------------------------------------------------------------
// #region: janela-de-comparacao-de-release

export type ReleaseSnapshotWindow = {
  release: Release;
  /** Instante da fotografia "antes": 1 ms antes da primeira vigência da release. */
  before: Date;
  /** Instante da fotografia "depois": a última vigência da release. */
  after: Date;
  /** Os DBs publicados da release, na ordem de vigência. */
  changeRequests: ChangeRequest[];
};

/**
 * As duas datas que comparam uma release com o que havia antes dela.
 *
 * A régua é a **vigência dos DBs da release**, não `release.publishedAt`: uma
 * release pode ser publicada hoje com DBs que só entram em vigor no dia 1º
 * (DEC-GOV-035 — cada DB mantém a sua vigência), e comparar em torno do clique
 * mostraria uma release que "não mudou nada". A janela vai de 1 ms antes da
 * primeira vigência até a última: com o intervalo semiaberto, isso é
 * exatamente "a política sem esta release" × "a política com ela inteira".
 *
 * Devolve `null` quando não há o que comparar: release inexistente, ou sem
 * nenhum DB publicado com vigência.
 */
export function getReleaseSnapshotWindow(
  doc: PolicyOpsDocument,
  releaseId: string,
): ReleaseSnapshotWindow | null {
  const release = doc.releases.find((candidate) => candidate.id === releaseId);
  if (release === undefined) return null;

  const changeRequests = doc.changeRequests
    .filter((cr) => cr.releaseId === releaseId)
    .filter((cr) => cr.status === 'PUBLISHED' && cr.proposedEffectiveDate !== undefined)
    .sort((a, b) => a.proposedEffectiveDate!.localeCompare(b.proposedEffectiveDate!));
  if (changeRequests.length === 0) return null;

  const first = new Date(changeRequests[0]!.proposedEffectiveDate!).getTime();
  const last = new Date(changeRequests[changeRequests.length - 1]!.proposedEffectiveDate!).getTime();
  return { release, before: new Date(first - 1), after: new Date(last), changeRequests };
}
