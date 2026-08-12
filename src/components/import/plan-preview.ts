import { diffVersions } from '@/core/diff';
import type { VersionDiff } from '@/core/diff/types';
import type {
  Axis,
  Cell,
  Matrix,
  MatrixVersion,
  PolicyOpsDocument,
} from '@/core/document/schema';
import type { MatrixPlan, PlannedAxis } from '@/core/import/plan';
import { getEditorView, type EditorView } from '@/core/queries';

/**
 * O diff de uma matriz do plano, montado para o `CompareView` de
 * docs/07-ux-e-editor.md §9 — docs/13-decisoes.md DEC-CARGA-015.
 *
 * `CompareView` é componente de apresentação puro: pede um `VersionDiff` e
 * duas `EditorView`. O que faltava na S22 não era a tela, era o par de versões
 * — a matriz `NEW` do plano ainda não existe no documento, e o rascunho da
 * `CHANGED` também não (o plano é dry-run, RN-13).
 *
 * A saída é montar um documento **descartável**, em memória, com uma matriz
 * sintética de duas versões: o "antes" (a publicada, ou o grid vazio numa
 * matriz nova) e o "depois" (o mesmo grid com as células da carga aplicadas).
 * Nada disso é despachado nem chega perto do documento aberto: são as mesmas
 * funções de leitura (`getEditorView`, `diffVersions`) sobre uma cópia
 * isolada, e é isso que faz "alterada no plano" e "alterada no diff"
 * significarem literalmente a mesma coisa.
 */

/**
 * `NEW` e `CHANGED` entram na aplicação (docs/12 §5.5). Uma `UNCHANGED`
 * arquivada e restaurada também entra — o desarquivamento é a própria
 * mudança, mesmo sem diff de célula (DEC-CARGA-018).
 */
export function isApplicable(plan: MatrixPlan): boolean {
  if (plan.status === 'NEW' || plan.status === 'CHANGED') return true;
  return plan.status === 'UNCHANGED' && plan.archived === true;
}

export type PlanPreview = {
  diff: VersionDiff;
  beforeView: EditorView;
  afterView: EditorView;
  beforeLabel: string;
  afterLabel: string;
};

const PREVIEW_MATRIX_ID = 'PLANPREVMTX';
const BEFORE_VERSION_ID = 'PLANPREVBEF';
const AFTER_VERSION_ID = 'PLANPREVAFT';
const PREVIEW_AT = '1970-01-01T00:00:00.000Z';

function axisFromPlanned(planned: PlannedAxis, prefix: string): Axis {
  return {
    role: planned.role,
    levels: planned.levels.map((level, index) => ({
      id: `${prefix}L${index}`,
      variableId: level.variableId,
      variableVersionId: level.variableVersionId,
      label: level.label,
      domains: level.domains,
    })),
    tuples: planned.tuples,
    ...(planned.manualSuppressions.length > 0
      ? { manualSuppressions: planned.manualSuppressions }
      : {}),
    derivedFrom: { compatibilityVersionIds: planned.compatibilityVersionIds },
  };
}

function previewVersion(
  id: string,
  number: number,
  axes: { x: Axis; y: Axis },
  cells: Record<string, Cell>,
): MatrixVersion {
  return {
    id,
    number,
    state: 'DRAFT',
    createdAt: PREVIEW_AT,
    createdBy: 'plano',
    axes,
    cells,
  };
}

/** O conteúdo que a matriz teria depois da carga, a partir das mudanças do plano. */
function applyChanges(base: Record<string, Cell>, plan: MatrixPlan): Record<string, Cell> {
  const cells: Record<string, Cell> = { ...base };
  for (const change of plan.changes) {
    if (change.kind === 'REMOVED') delete cells[change.key];
    else cells[change.key] = change.after;
  }
  return cells;
}

/**
 * `null` quando não há o que comparar: matriz sem alteração, sem eixos
 * projetados (`STRUCTURAL`, `BLOCKED`) ou ausente do arquivo.
 */
export function buildPlanPreview(doc: PolicyOpsDocument, plan: MatrixPlan): PlanPreview | null {
  if (plan.status !== 'NEW' && plan.status !== 'CHANGED') return null;

  let axes: { x: Axis; y: Axis };
  let baseCells: Record<string, Cell>;
  let beforeLabel: string;

  if (plan.status === 'NEW') {
    if (plan.axes === undefined) return null;
    axes = { x: axisFromPlanned(plan.axes.x, 'X'), y: axisFromPlanned(plan.axes.y, 'Y') };
    baseCells = {};
    beforeLabel = 'Antes (matriz nova, grid vazio)';
  } else {
    const matrix = doc.matrices.find((candidate) => candidate.id === plan.matrixId);
    const published = matrix?.versions.find((version) => version.id === plan.baseVersionId);
    if (published === undefined) return null;
    axes = published.axes;
    baseCells = published.cells;
    beforeLabel = `Versão ${published.number} (vigente)`;
  }

  const before = previewVersion(BEFORE_VERSION_ID, 1, axes, baseCells);
  const after = previewVersion(AFTER_VERSION_ID, 2, axes, applyChanges(baseCells, plan));
  const matrix: Matrix = {
    id: PREVIEW_MATRIX_ID,
    projectId: '',
    code: plan.code,
    name: plan.name,
    createdAt: PREVIEW_AT,
    versions: [before, after],
  };

  // O documento descartável carrega o catálogo e as variáveis reais — é o que
  // faz o grid do preview mostrar rótulo e cor de verdade —, e só a matriz
  // sintética. `projects: []` é deliberado: o preview não pertence a projeto
  // nenhum, e `EditorView.project` fica `null`.
  const previewDoc: PolicyOpsDocument = { ...doc, projects: [], matrices: [matrix] };

  return {
    diff: diffVersions(previewDoc, BEFORE_VERSION_ID, AFTER_VERSION_ID),
    beforeView: getEditorView(previewDoc, BEFORE_VERSION_ID),
    afterView: getEditorView(previewDoc, AFTER_VERSION_ID),
    beforeLabel,
    afterLabel: 'Depois da carga (rascunho a criar)',
  };
}
