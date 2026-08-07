import { decodeCellKey } from '@/core/axes/paths';
import type { CellChange, CellChangeKind, DiffedCellField, VersionDiff } from '@/core/diff/types';
import type { Cell, MatrixVersionState, PolicyOpsDocument } from '@/core/document/schema';
import type { EditorAxisView, EditorCatalog, EditorView } from '@/core/queries';
import { readableTuple } from '@/lib/axis-labels';

/**
 * Tradução do diff para a tela — docs/07-ux-e-editor.md §9.
 *
 * Mora em `src/lib/` e não em `src/core/diff/`: são rótulos, cores e formatos
 * de exibição. O motor não conhece nenhum deles.
 */

export const DIFF_KIND_LABEL: Record<CellChangeKind, string> = {
  ADDED: 'Adicionada',
  REMOVED: 'Removida',
  MODIFIED: 'Modificada',
};

/** Cores da legenda de §9 — azul, vermelho tracejado e âmbar. */
export const DIFF_LEGEND: Array<{ kind: CellChangeKind | 'UNCHANGED'; label: string; swatch: string }> = [
  { kind: 'ADDED', label: 'Adicionada', swatch: 'border-2 border-blue-600 bg-blue-100 dark:bg-blue-900/40' },
  {
    kind: 'REMOVED',
    label: 'Removida',
    swatch: 'border-2 border-dashed border-red-600 bg-red-100 dark:bg-red-900/40',
  },
  {
    kind: 'MODIFIED',
    label: 'Modificada',
    swatch: 'border-2 border-amber-600 bg-amber-100 dark:bg-amber-900/40',
  },
  {
    kind: 'UNCHANGED',
    label: 'Inalterada',
    swatch: 'border border-neutral-300 bg-neutral-200 opacity-40 dark:border-neutral-700 dark:bg-neutral-700',
  },
];

export const CELL_FIELD_LABEL: Record<DiffedCellField, string> = {
  decision: 'Decisão',
  offer: 'Oferta',
  limit: 'Limite',
  limitOverride: 'Limite específico',
  color: 'Cor',
  note: 'Observação',
  attrs: 'Atributos',
};

/** Motivo pelo qual a célula entrou ou saiu, em pt-BR. */
export function changeReasonLabel(change: CellChange): string | null {
  if (change.kind === 'ADDED') {
    return change.reason === 'NEW_TUPLE' ? 'combinação nova' : 'estava em branco';
  }
  if (change.kind === 'REMOVED') {
    return change.reason === 'DROPPED_TUPLE' ? 'combinação removida' : 'ficou em branco';
  }
  return null;
}

export function buildDiffMarks(diff: VersionDiff): Map<string, CellChangeKind> {
  const marks = new Map<string, CellChangeKind>();
  for (const change of diff.cells) marks.set(change.key, change.kind);
  return marks;
}

/**
 * `Varejo › 100k–500k × R3` — o caminho legível completo da combinação.
 *
 * A ordem é a da leitura de uma matriz: primeiro a linha (Y), depois a coluna
 * (X). Uma combinação que só existe num dos lados é resolvida pelo eixo do
 * outro; sem domínio correspondente, o próprio código aparece.
 */
export function readableCellPath(
  key: string,
  primary: { x: EditorAxisView; y: EditorAxisView },
  fallback?: { x: EditorAxisView; y: EditorAxisView },
): string {
  const { xPath, yPath } = decodeCellKey(key);
  const x = pickAxis(xPath, primary.x, fallback?.x);
  const y = pickAxis(yPath, primary.y, fallback?.y);
  return `${readableTuple(y.axis.levels, yPath)} × ${readableTuple(x.axis.levels, xPath)}`;
}

/** O eixo que conhece este caminho — a versão em que a tupla existe. */
function pickAxis(
  path: string,
  primary: EditorAxisView,
  fallback: EditorAxisView | undefined,
): EditorAxisView {
  if (fallback === undefined) return primary;
  return primary.axis.tuples.includes(path) ? primary : fallback;
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatBRL(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? currencyFormatter.format(parsed) : value;
}

/** O valor de um campo da célula como a pessoa o lê no grid — "—" quando ausente. */
export function formatCellField(
  cell: Cell | undefined,
  field: DiffedCellField,
  catalog: EditorCatalog,
): string {
  if (cell === undefined) return '—';
  switch (field) {
    case 'decision':
      return cell.decision === undefined
        ? '—'
        : (catalog.byCode.DECISION[cell.decision]?.label ?? cell.decision);
    case 'offer':
      return cell.offer === undefined ? '—' : (catalog.byCode.OFFER[cell.offer]?.label ?? cell.offer);
    case 'limit':
      return cell.limit === undefined ? '—' : (catalog.byCode.LIMIT[cell.limit]?.label ?? cell.limit);
    case 'limitOverride':
      return cell.limitOverride === undefined ? '—' : formatBRL(cell.limitOverride);
    case 'color':
      return cell.color ?? '—';
    case 'note':
      return cell.note ?? '—';
    case 'attrs':
      return cell.attrs === undefined
        ? '—'
        : Object.entries(cell.attrs)
            .map(([name, value]) => `${name}: ${String(value)}`)
            .join(', ');
  }
}

/** Os campos que a lista e o inspector mostram para uma mudança. */
export function fieldsOf(change: CellChange): DiffedCellField[] {
  if (change.kind === 'MODIFIED') return change.fields;
  const cell = change.kind === 'ADDED' ? change.after : change.before;
  return (Object.keys(CELL_FIELD_LABEL) as DiffedCellField[]).filter(
    (field) => cell[field] !== undefined,
  );
}

export function beforeCellOf(change: CellChange): Cell | undefined {
  return change.kind === 'ADDED' ? undefined : change.before;
}

export function afterCellOf(change: CellChange): Cell | undefined {
  return change.kind === 'REMOVED' ? undefined : change.after;
}

const VERSION_STATE_LABEL: Record<MatrixVersionState, string> = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Vigente',
  SUPERSEDED: 'Histórica',
  ARCHIVED: 'Descartada',
};

/** `MTZ_LIMITE_PF v2 · Rascunho` — o rótulo dos seletores de versão. */
export function versionOptionLabel(
  matrixCode: string,
  number: number,
  state: MatrixVersionState,
): string {
  return `${matrixCode} v${number} · ${VERSION_STATE_LABEL[state]}`;
}

export type VersionOption = { id: string; matrixId: string; label: string };

/**
 * Toda versão de toda matriz do documento, em ordem de número dentro de cada
 * matriz. São todas oferecidas porque §4.4 permite comparar versões de
 * matrizes diferentes — comparar PF com PJ é caso de uso real.
 */
export function listComparableVersions(doc: PolicyOpsDocument): VersionOption[] {
  const options: VersionOption[] = [];
  for (const matrix of doc.matrices) {
    for (const version of [...matrix.versions].sort((a, b) => a.number - b.number)) {
      options.push({
        id: version.id,
        matrixId: matrix.id,
        label: versionOptionLabel(matrix.code, version.number, version.state),
      });
    }
  }
  return options;
}

/** Rótulo da pilha de níveis de um eixo, para o banner de incomparabilidade. */
export function axisStackLabel(view: EditorView, role: 'x' | 'y'): string {
  return view[role].axis.levels.map((level) => level.label).join(' › ');
}
