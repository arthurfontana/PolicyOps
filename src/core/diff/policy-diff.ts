import type {
  ComponentVersion,
  Matrix,
  MatrixVersion,
  PolicyComponent,
  PolicyOpsDocument,
} from '../document/schema';
import { diffRichDoc, type RichDocDiff } from '../richdoc/diff';
import {
  getPolicyAt,
  snapshotNodeIndex,
  type PolicySnapshot,
  type PolicySnapshotNode,
} from '../timeline/policy-at';
import { diffComponentPayloads, type ComponentPayloadDiff } from './component-payload';
import { diffVersionPair } from './versions';
import type { DiffSummary, VersionRef } from './types';

/**
 * Comparação da política inteira entre duas datas — docs/14-governanca-de-alteracoes.md
 * §4 (US-GOV-08), docs/07-ux-e-editor.md §20.
 *
 * Recebe duas fotografias (`src/core/timeline/policy-at.ts`) e responde "o que
 * mudou entre elas", casando os nós pela chave da fotografia. Não reimplementa
 * nenhum dos três motores de diff que já existem — chama
 * `diffComponentPayloads` (campo a campo, S36), `diffRichDoc` (por bloco, S34)
 * e `diffVersionPair` (matriz, S14) e guarda deles **só o resumo**: a
 * comparação da política é a resposta de auditoria "o que mudou", e quem
 * quiser célula a célula abre a tela de comparação de versões.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
// #region: tipos-da-comparacao

export type PolicyChangeKind = 'ADDED' | 'REMOVED' | 'CHANGED';

/** O resumo do diff de matriz que a comparação de política carrega (§4.3, sem as células). */
export type PolicyMatrixChange = {
  a: VersionRef | null;
  b: VersionRef | null;
  comparable: boolean;
  summary: DiffSummary;
  /** Frases prontas em pt-BR, já sem as métricas zeradas. */
  summaryText: string[];
  cellsChanged: number;
};

export type PolicyNodeChange = {
  /** A chave da fotografia — id do componente, ou `matrix:<id>` na matriz sem espelho. */
  key: string;
  kind: PolicyChangeKind;
  nodeKind: 'COMPONENT' | 'MATRIX';
  /** O componente do lado mais recente disponível (B quando existe, senão A). */
  component: PolicyComponent | null;
  matrix: Matrix | null;
  /** Seção que agrupa (a de B quando existe), `null` = raiz do projeto. */
  section: PolicyComponent | null;
  before: ComponentVersion | null;
  after: ComponentVersion | null;
  beforeMatrixVersion: MatrixVersion | null;
  afterMatrixVersion: MatrixVersion | null;
  /** Só em `nodeKind: 'COMPONENT'`. */
  payload: ComponentPayloadDiff | null;
  /** Só em `nodeKind: 'COMPONENT'`; `null` quando nenhum dos dois lados tem `spec`. */
  spec: RichDocDiff | null;
  /** Só em `nodeKind: 'MATRIX'` e só quando as duas pontas têm versão. */
  matrixDiff: PolicyMatrixChange | null;
};

export type PolicySectionGroup = {
  /** `null` = mudanças penduradas na raiz do projeto. */
  section: PolicyComponent | null;
  /** Rótulo pronto: nome da seção, ou "Raiz do projeto". */
  label: string;
  changes: PolicyNodeChange[];
  totals: PolicyDiffTotals;
};

export type PolicyDiffTotals = {
  added: number;
  removed: number;
  changed: number;
  /** `added + removed + changed`. */
  total: number;
};

export type PolicyDiff = {
  projectId: string;
  /** Instantes das duas fotografias, em ISO 8601. A é a base (a mais antiga). */
  a: string;
  b: string;
  /** Ordem de leitura da árvore de B, com os removidos na posição que tinham em A. */
  changes: PolicyNodeChange[];
  /** As mesmas mudanças agrupadas pela seção da árvore que as contém. */
  groups: PolicySectionGroup[];
  totals: PolicyDiffTotals;
  hasChanges: boolean;
};

export const ROOT_SECTION_LABEL = 'Raiz do projeto';

// ---------------------------------------------------------------------------
// Comparação
// ---------------------------------------------------------------------------
// #region: comparacao-de-politica

/**
 * Compara a política do projeto entre duas datas. `aAt` é a base (a mais
 * antiga) — quem chama decide a ordem, como em `diffVersions` (§4.4);
 * `orderPolicyDates` existe para a tela não ter de decidir sozinha.
 */
export function diffPolicyAt(
  doc: PolicyOpsDocument,
  projectId: string,
  aAt: Date,
  bAt: Date,
): PolicyDiff {
  return diffPolicySnapshots(doc, getPolicyAt(doc, projectId, aAt), getPolicyAt(doc, projectId, bAt));
}

/** As duas datas em ordem: a mais antiga sempre à esquerda (docs/07 §20). */
export function orderPolicyDates(first: Date, second: Date): { a: Date; b: Date } {
  return first.getTime() <= second.getTime() ? { a: first, b: second } : { a: second, b: first };
}

/**
 * O núcleo: casa os nós das duas fotografias pela chave.
 *
 * - nó com versão vigente só em B → `ADDED` (a regra passou a existir, ou o
 *   componente nasceu no intervalo);
 * - nó com versão vigente só em A → `REMOVED` (arquivado, ou a vigência
 *   terminou sem sucessora);
 * - versões diferentes dos dois lados → `CHANGED`, com o diff detalhado;
 * - mesma versão, ou ausente nos dois lados → não entra: um diff de auditoria
 *   que lista o que **não** mudou não responde nada.
 *
 * Seção pura (`STRUCTURE`, I29) nunca entra: ela não tem versão e portanto não
 * tem como mudar — renomear uma pasta não é uma alteração de política.
 */
export function diffPolicySnapshots(
  doc: PolicyOpsDocument,
  a: PolicySnapshot,
  b: PolicySnapshot,
): PolicyDiff {
  const inA = snapshotNodeIndex(a);
  const inB = snapshotNodeIndex(b);
  const changes: PolicyNodeChange[] = [];

  // A ordem de saída é a de B (a leitura da política mais nova); o que só
  // existe em A entra logo depois do nó que o precedia lá — mesmo alinhamento
  // que o diff de `RichDoc` usa entre dois documentos (S34).
  const positionInA = new Map(a.nodes.map((node, index) => [node.key, index] as const));
  const emitted = new Set<string>();
  for (const node of b.nodes) {
    for (const removed of removedBefore(a, inB, positionInA.get(node.key), emitted)) {
      const change = compare(doc, removed, null);
      if (change !== null) changes.push(change);
    }
    emitted.add(node.key);
    const change = compare(doc, inA.get(node.key) ?? null, node);
    if (change !== null) changes.push(change);
  }
  for (const node of a.nodes) {
    if (emitted.has(node.key) || inB.has(node.key)) continue;
    emitted.add(node.key);
    const change = compare(doc, node, null);
    if (change !== null) changes.push(change);
  }

  return {
    projectId: b.projectId,
    a: a.at,
    b: b.at,
    changes,
    groups: groupBySection(changes),
    totals: totalsOf(changes),
    hasChanges: changes.length > 0,
  };
}

/** Nós que existiam em A logo antes de `index` e sumiram em B — devolvidos na posição que tinham. */
function removedBefore(
  a: PolicySnapshot,
  inB: Map<string, PolicySnapshotNode>,
  index: number | undefined,
  emitted: Set<string>,
): PolicySnapshotNode[] {
  if (index === undefined) return [];
  const pending: PolicySnapshotNode[] = [];
  for (let i = index - 1; i >= 0; i--) {
    const candidate = a.nodes[i]!;
    if (inB.has(candidate.key) || emitted.has(candidate.key)) break;
    pending.unshift(candidate);
  }
  for (const node of pending) emitted.add(node.key);
  return pending;
}

function effectiveVersionOf(node: PolicySnapshotNode | null): ComponentVersion | null {
  return node === null ? null : node.version;
}

function effectiveMatrixVersionOf(node: PolicySnapshotNode | null): MatrixVersion | null {
  return node === null ? null : node.matrixVersion;
}

function compare(
  doc: PolicyOpsDocument,
  before: PolicySnapshotNode | null,
  after: PolicySnapshotNode | null,
): PolicyNodeChange | null {
  const anchor = after ?? before;
  if (anchor === null) return null;

  const beforeVersion = effectiveVersionOf(before);
  const afterVersion = effectiveVersionOf(after);
  const beforeMatrixVersion = effectiveMatrixVersionOf(before);
  const afterMatrixVersion = effectiveMatrixVersionOf(after);

  // Seção pura e conteúdo ausente caem no mesmo lugar: sem versão dos dois
  // lados não há alteração de política para relatar.
  const hadContent = beforeVersion !== null || beforeMatrixVersion !== null;
  const hasContent = afterVersion !== null || afterMatrixVersion !== null;
  if (!hadContent && !hasContent) return null;

  const kind: PolicyChangeKind = !hadContent ? 'ADDED' : !hasContent ? 'REMOVED' : 'CHANGED';
  if (
    kind === 'CHANGED' &&
    beforeVersion?.id === afterVersion?.id &&
    beforeMatrixVersion?.id === afterMatrixVersion?.id
  ) {
    return null;
  }

  const change: PolicyNodeChange = {
    key: anchor.key,
    kind,
    nodeKind: anchor.kind,
    component: anchor.component,
    matrix: anchor.matrix,
    section: anchor.section,
    before: beforeVersion,
    after: afterVersion,
    beforeMatrixVersion,
    afterMatrixVersion,
    payload: null,
    spec: null,
    matrixDiff: null,
  };

  if (anchor.kind === 'COMPONENT') {
    change.payload = diffComponentPayloads(beforeVersion?.payload, afterVersion?.payload);
    if (beforeVersion?.spec !== undefined || afterVersion?.spec !== undefined) {
      change.spec = diffRichDoc(beforeVersion?.spec, afterVersion?.spec);
    }
    return change;
  }

  const matrixA = before?.matrix ?? null;
  const matrixB = after?.matrix ?? anchor.matrix;
  if (beforeMatrixVersion !== null && afterMatrixVersion !== null && matrixA !== null && matrixB !== null) {
    const diff = diffVersionPair(
      { a: doc, b: doc },
      { matrix: matrixA, version: beforeMatrixVersion },
      { matrix: matrixB, version: afterMatrixVersion },
    );
    change.matrixDiff = {
      a: diff.a,
      b: diff.b,
      comparable: diff.comparable,
      summary: diff.summary,
      summaryText: diff.summaryText,
      cellsChanged: diff.cells.length,
    };
  }
  return change;
}

// ---------------------------------------------------------------------------
// Agregação por seção
// ---------------------------------------------------------------------------
// #region: agregacao-por-secao

/**
 * Agrupa pela **seção mais próxima** que contém o nó (não pelo pai direto):
 * uma regra dentro de outra regra pertence, para quem lê o resumo, ao capítulo
 * em que as duas estão. Mudança pendurada na raiz do projeto — ou matriz sem
 * espelho — vai para o grupo `null`, sempre no fim.
 */
export function groupBySection(changes: PolicyNodeChange[]): PolicySectionGroup[] {
  const groups: PolicySectionGroup[] = [];
  const byId = new Map<string, PolicySectionGroup>();

  for (const change of changes) {
    const id = change.section?.id ?? '';
    let group = byId.get(id);
    if (group === undefined) {
      group = {
        section: change.section,
        label: change.section?.name ?? ROOT_SECTION_LABEL,
        changes: [],
        totals: { added: 0, removed: 0, changed: 0, total: 0 },
      };
      byId.set(id, group);
      groups.push(group);
    }
    group.changes.push(change);
  }

  for (const group of groups) group.totals = totalsOf(group.changes);
  return groups.sort((a, b) => (a.section === null ? 1 : 0) - (b.section === null ? 1 : 0));
}

function totalsOf(changes: PolicyNodeChange[]): PolicyDiffTotals {
  const totals: PolicyDiffTotals = { added: 0, removed: 0, changed: 0, total: changes.length };
  for (const change of changes) {
    if (change.kind === 'ADDED') totals.added += 1;
    else if (change.kind === 'REMOVED') totals.removed += 1;
    else totals.changed += 1;
  }
  return totals;
}
