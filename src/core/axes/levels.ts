import type { Axis, AxisLevel, AxisRole, Cell, MatrixVersion } from '../document/schema';
import { DomainError } from '../errors';
import { decodeCellKey, decodePath, encodeCellKey, encodePath } from './paths';
import {
  assertGridFits,
  assertVariablesNotOnBothAxes,
  generateTuples,
  type ApplicableCompatibility,
  type TupleWarning,
} from './tuples';

/**
 * Operações sobre níveis de um eixo — docs/04-eixos-aninhados.md §5.
 *
 * Todas são funções puras sobre uma `MatrixVersion` em `DRAFT` (I3) e todas
 * devolvem, além da versão nova, **o que seria perdido**: `droppedCells` traz
 * o conteúdo descartado íntegro, para o payload do evento de auditoria
 * (docs/05 §7) — a operação precisa ser reconstruível a partir da auditoria.
 *
 * Cada operação tem uma versão `preview…` que calcula o impacto sem aplicar.
 * Montar o `DocEvent` (id, ator, data) e o comando inverso é da camada de
 * comandos (S04/S12); aqui só existe o cálculo.
 */

export type OnExistingContent = 'REPLICATE' | 'CLEAR';
export type OnCollapse = 'KEEP_FIRST' | 'KEEP_IF_UNANIMOUS';

export type DroppedCell = { key: string; cell: Cell };

export type GridImpact = {
  /** Tuplas do eixo operado. */
  tuples: number;
  /** Combinações do grid inteiro (`x.tuples × y.tuples`). */
  combinations: number;
  /** Células gravadas no mapa `cells`. */
  filledCells: number;
};

// ---------------------------------------------------------------------------
// Utilitários internos
// ---------------------------------------------------------------------------

/** docs/05 §1.5: todo comando que toca `axes` ou `cells` passa por aqui. */
function assertEditable(version: MatrixVersion): void {
  if (version.state !== 'DRAFT') {
    throw new DomainError(
      'VERSION_IMMUTABLE',
      `A versão ${version.number} está em ${version.state} e não pode mais ser editada.`,
      { versionId: version.id, state: version.state },
    );
  }
}

function axisOf(version: MatrixVersion, role: AxisRole): Axis {
  return role === 'X' ? version.axes.x : version.axes.y;
}

function otherRole(role: AxisRole): AxisRole {
  return role === 'X' ? 'Y' : 'X';
}

function withAxis(version: MatrixVersion, role: AxisRole, axis: Axis): MatrixVersion['axes'] {
  return role === 'X' ? { x: axis, y: version.axes.y } : { x: version.axes.x, y: axis };
}

/** Chave de célula a partir do caminho no eixo operado e do caminho no outro eixo. */
function cellKey(role: AxisRole, ownPath: string, otherPath: string): string {
  return role === 'X' ? encodeCellKey(ownPath, otherPath) : encodeCellKey(otherPath, ownPath);
}

function splitKey(role: AxisRole, key: string): { own: string; other: string } {
  const { xPath, yPath } = decodeCellKey(key);
  return role === 'X' ? { own: xPath, other: yPath } : { own: yPath, other: xPath };
}

/** Caminho sem o código do nível `index` — o "ancestral" do caminho no eixo antigo. */
function withoutLevel(path: string, index: number): string {
  return encodePath(decodePath(path).filter((_, at) => at !== index));
}

/** Caminho com os códigos reordenados por `order` (índices antigos na nova ordem). */
function permutePath(path: string, order: number[]): string {
  const codes = decodePath(path);
  return encodePath(order.map((at) => codes[at]!));
}

function moveIndex<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...list];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item!);
  return next;
}

/**
 * Igualdade de conteúdo de célula, estável em relação à ordem das chaves.
 * `Cell` só tem escalares e `attrs` (`string | number | boolean`) — nunca
 * `null` nem arrays (docs/03 §6.2), então a recursão para nos primitivos.
 */
function canonicalize(value: unknown): unknown {
  if (typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const target: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) target[key] = canonicalize(source[key]);
  return target;
}

function cellSignature(cell: Cell | undefined): string {
  return cell === undefined ? '' : JSON.stringify(canonicalize(cell));
}

function gridImpact(
  ownTuples: number,
  otherTuples: number,
  cells: Record<string, Cell>,
): GridImpact {
  return {
    tuples: ownTuples,
    combinations: ownTuples * otherTuples,
    filledCells: Object.keys(cells).length,
  };
}

function buildAxis(
  role: AxisRole,
  levels: AxisLevel[],
  tuples: string[],
  usedRuleIds: string[],
  suppressions: string[],
): Axis {
  const axis: Axis = {
    role,
    levels,
    tuples,
    derivedFrom: { compatibilityVersionIds: usedRuleIds },
  };
  // Campos opcionais são omitidos quando vazios (docs/03 §1).
  if (suppressions.length > 0) axis.manualSuppressions = suppressions;
  return axis;
}

function assertIndexInRange(index: number, min: number, max: number, what: string): void {
  if (index < min || index > max) {
    throw new DomainError('INVALID_INPUT', `${what} fora do intervalo permitido (${min}–${max}).`, {
      index,
      min,
      max,
    });
  }
}

// ---------------------------------------------------------------------------
// §5.1 Adicionar nível
// ---------------------------------------------------------------------------

export type AddLevelInput = {
  /**
   * Nível completo — id, pin de versão da variável e snapshot de domínios. O
   * chamador resolve a variável na biblioteca; `src/core/axes/` não conhece o
   * documento inteiro.
   */
  level: AxisLevel;
  /** Profundidade de inserção: 0 = mais externo. */
  position: number;
  /** Padrão `REPLICATE` — quase sempre é o que se quer. */
  onExisting?: OnExistingContent;
  compatibility: ApplicableCompatibility[];
};

export type AddLevelPreview = {
  role: AxisRole;
  position: number;
  mode: OnExistingContent;
  before: GridImpact;
  after: GridImpact;
  /** Combinações que ficam sem nenhuma célula gravada depois da operação. */
  combinationsWithoutCell: number;
  droppedCells: DroppedCell[];
  warnings: TupleWarning[];
};

export type AddLevelResult = {
  version: MatrixVersion;
  preview: AddLevelPreview;
  /** Payload de `AXIS_LEVEL_ADDED` (docs/05 §7). */
  eventPayload: {
    role: AxisRole;
    variableId: string;
    label: string;
    position: number;
    mode: OnExistingContent;
    before: GridImpact;
    after: GridImpact;
    droppedCells: DroppedCell[];
  };
};

function computeAddLevel(
  version: MatrixVersion,
  role: AxisRole,
  input: AddLevelInput,
): AddLevelResult {
  assertEditable(version);
  const mode = input.onExisting ?? 'REPLICATE';
  const axis = axisOf(version, role);
  const other = axisOf(version, otherRole(role));
  assertIndexInRange(input.position, 0, axis.levels.length, 'A posição do novo nível está');

  const levels = [...axis.levels];
  levels.splice(input.position, 0, input.level);
  assertVariablesNotOnBothAxes(levels, other.levels);

  // As supressões manuais são caminho-formadas: ao inserir um nível, cada uma
  // se expande para todas as suas descendentes — a intenção do usuário
  // ("esta combinação não existe") continua valendo, com mais detalhe.
  const universe = generateTuples({
    levels,
    compatibility: input.compatibility,
    manualSuppressions: [],
  });
  const previous = new Set(axis.manualSuppressions ?? []);
  const suppressions = universe.tuples.filter((tuple) =>
    previous.has(withoutLevel(tuple, input.position)),
  );
  const generated = generateTuples({
    levels,
    compatibility: input.compatibility,
    manualSuppressions: suppressions,
  });
  assertGridFits(generated.tuples.length * other.tuples.length);

  const cells: Record<string, Cell> = {};
  if (mode === 'REPLICATE') {
    const existingTuples = new Set(axis.tuples);
    for (const tuple of generated.tuples) {
      const ancestor = withoutLevel(tuple, input.position);
      if (!existingTuples.has(ancestor)) continue;
      for (const otherPath of other.tuples) {
        const cell = version.cells[cellKey(role, ancestor, otherPath)];
        if (cell === undefined) continue;
        cells[cellKey(role, tuple, otherPath)] = cell;
      }
    }
  }

  const survivors = new Set(generated.tuples.map((tuple) => withoutLevel(tuple, input.position)));
  const droppedCells: DroppedCell[] = [];
  for (const [key, cell] of Object.entries(version.cells)) {
    const { own } = splitKey(role, key);
    if (mode === 'CLEAR' || !survivors.has(own)) droppedCells.push({ key, cell });
  }

  const nextAxis = buildAxis(role, levels, generated.tuples, generated.usedRuleIds, suppressions);
  const nextVersion: MatrixVersion = {
    ...version,
    axes: withAxis(version, role, nextAxis),
    cells,
  };

  const before = gridImpact(axis.tuples.length, other.tuples.length, version.cells);
  const after = gridImpact(generated.tuples.length, other.tuples.length, cells);
  const preview: AddLevelPreview = {
    role,
    position: input.position,
    mode,
    before,
    after,
    combinationsWithoutCell: after.combinations - after.filledCells,
    droppedCells,
    warnings: generated.warnings,
  };

  return {
    version: nextVersion,
    preview,
    eventPayload: {
      role,
      variableId: input.level.variableId,
      label: input.level.label,
      position: input.position,
      mode,
      before,
      after,
      droppedCells,
    },
  };
}

export function previewAddLevel(
  version: MatrixVersion,
  role: AxisRole,
  input: AddLevelInput,
): AddLevelPreview {
  return computeAddLevel(version, role, input).preview;
}

export function addLevel(
  version: MatrixVersion,
  role: AxisRole,
  input: AddLevelInput,
): AddLevelResult {
  return computeAddLevel(version, role, input);
}

// ---------------------------------------------------------------------------
// §5.2 Remover nível
// ---------------------------------------------------------------------------

export type RemoveLevelInput = {
  levelIndex: number;
  /** Padrão `KEEP_IF_UNANIMOUS`: perder informação em silêncio é o pior desfecho. */
  onCollapse?: OnCollapse;
  compatibility: ApplicableCompatibility[];
};

export type RemoveLevelPreview = {
  role: AxisRole;
  levelIndex: number;
  mode: OnCollapse;
  before: GridImpact;
  after: GridImpact;
  combinationsWithoutCell: number;
  /** Tuplas resultantes que colapsaram mais de uma tupla antiga. */
  collapsedGroups: number;
  /** Células cujo grupo divergia — em `KEEP_IF_UNANIMOUS`, nascem vazias. */
  divergentCells: number;
  droppedCells: DroppedCell[];
  /** Supressões manuais que deixam de existir: elas eram do formato antigo de caminho. */
  droppedSuppressions: string[];
  addedTuples: string[];
  removedTuples: string[];
  warnings: TupleWarning[];
};

export type RemoveLevelResult = {
  version: MatrixVersion;
  preview: RemoveLevelPreview;
  /** Payload de `AXIS_LEVEL_REMOVED` (docs/05 §7). */
  eventPayload: {
    role: AxisRole;
    variableId: string;
    label: string;
    levelIndex: number;
    mode: OnCollapse;
    droppedCells: DroppedCell[];
    droppedSuppressions: string[];
  };
};

function computeRemoveLevel(
  version: MatrixVersion,
  role: AxisRole,
  input: RemoveLevelInput,
): RemoveLevelResult {
  assertEditable(version);
  const mode = input.onCollapse ?? 'KEEP_IF_UNANIMOUS';
  const axis = axisOf(version, role);
  const other = axisOf(version, otherRole(role));
  if (axis.levels.length === 1) {
    throw new DomainError(
      'AXIS_NEEDS_ONE_LEVEL',
      'Este eixo tem um único nível — removê-lo deixaria a matriz sem eixo.',
      { role },
    );
  }
  assertIndexInRange(input.levelIndex, 0, axis.levels.length - 1, 'O nível a remover está');

  const removed = axis.levels[input.levelIndex]!;
  const levels = axis.levels.filter((_, index) => index !== input.levelIndex);
  // Uma supressão manual aponta para um caminho do formato antigo; depois do
  // colapso a combinação suprimida não tem mais identidade própria. Some, e é
  // reportada — nada se perde em silêncio (§5.4).
  const droppedSuppressions = axis.manualSuppressions ?? [];
  const generated = generateTuples({
    levels,
    compatibility: input.compatibility,
    manualSuppressions: [],
  });
  assertGridFits(generated.tuples.length * other.tuples.length);

  // Grupos de tuplas antigas que colapsam numa mesma tupla nova, na ordem do grid.
  const groups = new Map<string, string[]>();
  for (const tuple of axis.tuples) {
    const collapsed = withoutLevel(tuple, input.levelIndex);
    const group = groups.get(collapsed);
    if (group === undefined) groups.set(collapsed, [tuple]);
    else group.push(tuple);
  }

  const generatedSet = new Set(generated.tuples);
  const addedTuples = generated.tuples.filter((tuple) => !groups.has(tuple));
  const removedTuples = [...groups.keys()].filter((tuple) => !generatedSet.has(tuple));

  const cells: Record<string, Cell> = {};
  let collapsedGroups = 0;
  let divergentCells = 0;
  for (const tuple of generated.tuples) {
    const group = groups.get(tuple);
    if (group === undefined) continue;
    if (group.length > 1) collapsedGroups += 1;
    for (const otherPath of other.tuples) {
      const values = group.map((source) => version.cells[cellKey(role, source, otherPath)]);
      const first = values[0];
      const signature = cellSignature(first);
      const unanimous = values.every((value) => cellSignature(value) === signature);
      if (!unanimous) divergentCells += 1;
      const chosen = mode === 'KEEP_FIRST' || unanimous ? first : undefined;
      if (chosen !== undefined) cells[cellKey(role, tuple, otherPath)] = chosen;
    }
  }

  const droppedCells: DroppedCell[] = [];
  for (const [key, cell] of Object.entries(version.cells)) {
    const { own, other: otherPath } = splitKey(role, key);
    const survivor = cells[cellKey(role, withoutLevel(own, input.levelIndex), otherPath)];
    if (cellSignature(survivor) !== cellSignature(cell)) droppedCells.push({ key, cell });
  }

  const nextAxis = buildAxis(role, levels, generated.tuples, generated.usedRuleIds, []);
  const nextVersion: MatrixVersion = {
    ...version,
    axes: withAxis(version, role, nextAxis),
    cells,
  };

  const before = gridImpact(axis.tuples.length, other.tuples.length, version.cells);
  const after = gridImpact(generated.tuples.length, other.tuples.length, cells);
  const preview: RemoveLevelPreview = {
    role,
    levelIndex: input.levelIndex,
    mode,
    before,
    after,
    combinationsWithoutCell: after.combinations - after.filledCells,
    collapsedGroups,
    divergentCells,
    droppedCells,
    droppedSuppressions,
    addedTuples,
    removedTuples,
    warnings: generated.warnings,
  };

  return {
    version: nextVersion,
    preview,
    eventPayload: {
      role,
      variableId: removed.variableId,
      label: removed.label,
      levelIndex: input.levelIndex,
      mode,
      droppedCells,
      droppedSuppressions,
    },
  };
}

export function previewRemoveLevel(
  version: MatrixVersion,
  role: AxisRole,
  input: RemoveLevelInput,
): RemoveLevelPreview {
  return computeRemoveLevel(version, role, input).preview;
}

export function removeLevel(
  version: MatrixVersion,
  role: AxisRole,
  input: RemoveLevelInput,
): RemoveLevelResult {
  return computeRemoveLevel(version, role, input);
}

// ---------------------------------------------------------------------------
// §5.3 Reordenar níveis
// ---------------------------------------------------------------------------

export type ReorderLevelsInput = {
  fromIndex: number;
  toIndex: number;
  compatibility: ApplicableCompatibility[];
  /**
   * Obrigatório quando a reordenação muda o conjunto de tuplas: a
   * compatibilidade é direcional (pai → filho), então inverter os níveis pode
   * trocar a regra aplicável por outra, ou por nenhuma.
   */
  confirm?: boolean;
};

export type ReorderLevelsPreview = {
  role: AxisRole;
  fromIndex: number;
  toIndex: number;
  /** O conjunto de tuplas mudou: reordenação **com perda**. */
  tuplesChanged: boolean;
  requiresConfirmation: boolean;
  before: GridImpact;
  after: GridImpact;
  combinationsWithoutCell: number;
  addedTuples: string[];
  removedTuples: string[];
  droppedCells: DroppedCell[];
  warnings: TupleWarning[];
};

export type ReorderLevelsResult = {
  version: MatrixVersion;
  preview: ReorderLevelsPreview;
  /** Payload de `AXIS_LEVEL_REORDERED` (docs/05 §7). */
  eventPayload: {
    role: AxisRole;
    from: number;
    to: number;
    tuplesChanged: boolean;
    droppedCells: DroppedCell[];
  };
};

function computeReorderLevels(
  version: MatrixVersion,
  role: AxisRole,
  input: ReorderLevelsInput,
): ReorderLevelsResult {
  assertEditable(version);
  const axis = axisOf(version, role);
  const other = axisOf(version, otherRole(role));
  const last = axis.levels.length - 1;
  assertIndexInRange(input.fromIndex, 0, last, 'O nível de origem está');
  assertIndexInRange(input.toIndex, 0, last, 'O nível de destino está');

  const order = moveIndex(
    axis.levels.map((_, index) => index),
    input.fromIndex,
    input.toIndex,
  );
  const levels = order.map((index) => axis.levels[index]!);
  const suppressions = (axis.manualSuppressions ?? []).map((path) => permutePath(path, order));
  const generated = generateTuples({
    levels,
    compatibility: input.compatibility,
    manualSuppressions: suppressions,
  });
  assertGridFits(generated.tuples.length * other.tuples.length);

  const expected = axis.tuples.map((path) => permutePath(path, order));
  const expectedSet = new Set(expected);
  const generatedSet = new Set(generated.tuples);
  const addedTuples = generated.tuples.filter((tuple) => !expectedSet.has(tuple));
  const removedTuples = expected.filter((tuple) => !generatedSet.has(tuple));
  const tuplesChanged = addedTuples.length > 0 || removedTuples.length > 0;

  const cells: Record<string, Cell> = {};
  const droppedCells: DroppedCell[] = [];
  for (const [key, cell] of Object.entries(version.cells)) {
    const { own, other: otherPath } = splitKey(role, key);
    const moved = permutePath(own, order);
    if (generatedSet.has(moved)) cells[cellKey(role, moved, otherPath)] = cell;
    else droppedCells.push({ key, cell });
  }

  const nextAxis = buildAxis(role, levels, generated.tuples, generated.usedRuleIds, suppressions);
  const nextVersion: MatrixVersion = {
    ...version,
    axes: withAxis(version, role, nextAxis),
    cells,
  };

  const before = gridImpact(axis.tuples.length, other.tuples.length, version.cells);
  const after = gridImpact(generated.tuples.length, other.tuples.length, cells);
  const preview: ReorderLevelsPreview = {
    role,
    fromIndex: input.fromIndex,
    toIndex: input.toIndex,
    tuplesChanged,
    requiresConfirmation: tuplesChanged,
    before,
    after,
    combinationsWithoutCell: after.combinations - after.filledCells,
    addedTuples,
    removedTuples,
    droppedCells,
    warnings: generated.warnings,
  };

  return {
    version: nextVersion,
    preview,
    eventPayload: {
      role,
      from: input.fromIndex,
      to: input.toIndex,
      tuplesChanged,
      droppedCells,
    },
  };
}

export function previewReorderLevels(
  version: MatrixVersion,
  role: AxisRole,
  input: ReorderLevelsInput,
): ReorderLevelsPreview {
  return computeReorderLevels(version, role, input).preview;
}

export function reorderLevels(
  version: MatrixVersion,
  role: AxisRole,
  input: ReorderLevelsInput,
): ReorderLevelsResult {
  const result = computeReorderLevels(version, role, input);
  if (result.preview.requiresConfirmation && input.confirm !== true) {
    throw new DomainError(
      'INVALID_INPUT',
      'Reordenar estes níveis muda o conjunto de combinações do eixo — confirme a operação para aplicá-la.',
      {
        addedTuples: result.preview.addedTuples,
        removedTuples: result.preview.removedTuples,
        droppedCells: result.preview.droppedCells,
      },
    );
  }
  return result;
}
