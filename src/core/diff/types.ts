import type { AxisRole, Cell, MatrixVersionState } from '../document/schema';

/**
 * Tipos do motor de diff — docs/05-regras-de-negocio.md §4.
 *
 * Ficam num módulo próprio (sem lógica e sem dependências além do schema) para
 * que `src/core/versioning/lifecycle.ts` possa gravar um `DiffSummary` no
 * payload de `VERSION_PUBLISHED` sem criar ciclo de importação com o motor.
 */

/** Identificação de uma das pontas da comparação, pronta para o cabeçalho da tela. */
export type VersionRef = {
  versionId: string;
  matrixId: string;
  matrixCode: string;
  matrixName: string;
  number: number;
  state: MatrixVersionState;
  createdAt: string;
  effectiveFrom?: string;
  effectiveTo?: string;
};

// ---------------------------------------------------------------------------
// §4.1 Diff de eixos
// ---------------------------------------------------------------------------

export type AxisLevelDiff = {
  index: number;
  variableId: string;
  /** Números de versão da variável — presente só quando o pin mudou. */
  pinChanged?: { from: number; to: number };
  addedDomains: string[];
  removedDomains: string[];
  relabeled: Array<{ code: string; from: string; to: string }>;
};

export type AxisDiff = {
  role: AxisRole;
  /** A pilha de variáveis mudou (outras variáveis, ou as mesmas em outra ordem). */
  levelsChanged: boolean;
  levels: AxisLevelDiff[];
  addedTuples: string[];
  removedTuples: string[];
  reorderedTuples: boolean;
};

// ---------------------------------------------------------------------------
// §4.2 Diff de células
// ---------------------------------------------------------------------------

/**
 * Campos comparados entre duas células.
 *
 * §4.2 lista `'decision'|'offer'|'limit'|'color'|'note'|'attrs'`, mas omite
 * `limitOverride`, que §4.3 usa para calcular o limite efetivo. Uma célula que
 * mudou **só** o `limitOverride` mudou de verdade e precisa entrar no
 * resultado com o campo nomeado — então a lista aqui é a união dos campos de
 * célula de §2.1 com `attrs`.
 */
export const DIFFED_CELL_FIELDS = [
  'decision',
  'offer',
  'limit',
  'limitOverride',
  'limitMin',
  'limitMax',
  'color',
  'note',
  'attrs',
] as const;

export type DiffedCellField = (typeof DIFFED_CELL_FIELDS)[number];

/**
 * Por que a célula aparece como adicionada. A interface trata os dois casos de
 * forma diferente: `NEW_TUPLE` é uma combinação que não existia no grid de A,
 * `WAS_EMPTY` é uma combinação que existia e estava em branco.
 */
export type AddedReason = 'NEW_TUPLE' | 'WAS_EMPTY';

/** Simétrico de `AddedReason`: a combinação saiu do grid, ou ficou em branco. */
export type RemovedReason = 'DROPPED_TUPLE' | 'NOW_EMPTY';

export type CellChange =
  | { kind: 'ADDED'; key: string; reason: AddedReason; after: Cell }
  | { kind: 'REMOVED'; key: string; reason: RemovedReason; before: Cell }
  | {
      kind: 'MODIFIED';
      key: string;
      before: Cell;
      after: Cell;
      fields: DiffedCellField[];
    };

export type CellChangeKind = CellChange['kind'];

// ---------------------------------------------------------------------------
// §4.3 Resumo semântico
// ---------------------------------------------------------------------------

export type DiffSummary = {
  /** Decisão passou de reprovadora para aprovadora. */
  cellsOpened: number;
  /** Decisão passou de aprovadora para `REPROVADO`. */
  cellsClosed: number;
  /** Decisão passou para `ANALISE_MANUAL`. */
  cellsToManualReview: number;
  /** `offer` mudou — sem recontar células adicionadas ou removidas. */
  offersChanged: number;
  limitsIncreased: number;
  limitsDecreased: number;
  /** Combinações que entraram/saíram por mudança estrutural do eixo. */
  combinationsAdded: number;
  combinationsRemoved: number;
  notesChanged: number;
  colorsChanged: number;
};

export const EMPTY_DIFF_SUMMARY: DiffSummary = {
  cellsOpened: 0,
  cellsClosed: 0,
  cellsToManualReview: 0,
  offersChanged: 0,
  limitsIncreased: 0,
  limitsDecreased: 0,
  combinationsAdded: 0,
  combinationsRemoved: 0,
  notesChanged: 0,
  colorsChanged: 0,
};

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export type IncomparableReason = 'DIFFERENT_LEVELS';

export type VersionDiff = {
  /** A é a base (a mais antiga); B é a comparada. */
  a: VersionRef;
  b: VersionRef;
  comparable: boolean;
  incomparableReason?: IncomparableReason;
  axes: { x: AxisDiff; y: AxisDiff };
  cells: CellChange[];
  summary: DiffSummary;
  /** Frases prontas em pt-BR, já sem as métricas zeradas. */
  summaryText: string[];
};
