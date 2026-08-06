import { listPending } from '../axes/combinations';
import {
  addLevel as addLevelToAxis,
  previewAddLevel,
  previewRemoveLevel,
  previewReorderLevels,
  removeLevel as removeLevelFromAxis,
  reorderLevels as reorderAxisLevels,
  type AddLevelPreview,
  type DroppedCell,
  type GridImpact,
  type OnCollapse,
  type OnExistingContent,
  type RemoveLevelPreview,
  type ReorderLevelsPreview,
} from '../axes/levels';
import {
  assertGridFits,
  collectPublishedCompatibility,
  generateTuples,
  type ApplicableCompatibility,
} from '../axes/tuples';
import {
  applyToDocument,
  defineCommand,
  makeEvent,
  type Command,
  type Ctx,
} from '../command';
import type {
  Axis,
  AxisRole,
  Cell,
  MatrixVersion,
  PolicyOpsDocument,
} from '../document/schema';
import { DomainError } from '../errors';
import { assertEditable, locateVersion, resolveLevel, versionScope } from './lifecycle';

/**
 * Comandos de eixo — docs/08-camada-de-comandos.md §3 (Eixos) e
 * docs/04-eixos-aninhados.md §5.
 *
 * As funções puras de `src/core/axes/levels.ts` fazem o cálculo; aqui elas
 * viram comandos: localizam a versão, chamam `assertEditable` **primeiro**,
 * resolvem a biblioteca de compatibilidade, gravam o evento de auditoria com o
 * conteúdo descartado íntegro e devolvem o inverso.
 *
 * Sobre o inverso: docs/08 §3 pede que "comandos de eixo guardem no inverso
 * **todas** as células afetadas". Uma operação de nível reescreve o mapa de
 * células inteiro (as chaves mudam de formato), então "todas as afetadas" é,
 * literalmente, o eixo anterior mais o mapa de células anterior — é isso que
 * `axis/_restore` carrega. Reconstruir a operação inversa passo a passo
 * (readicionar o nível, reaplicar patches) daria o mesmo resultado no caso
 * feliz e perderia conteúdo sempre que a política tivesse esvaziado uma
 * célula. Restaurar o estado é o único caminho que garante o critério de
 * aceite: **desfazer devolve o documento deep-equal ao original**.
 */

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function axisOf(version: MatrixVersion, role: AxisRole): Axis {
  return role === 'X' ? version.axes.x : version.axes.y;
}

function otherAxisOf(version: MatrixVersion, role: AxisRole): Axis {
  return role === 'X' ? version.axes.y : version.axes.x;
}

export const AXIS_ROLE_LABEL: Record<AxisRole, string> = {
  X: 'eixo X (colunas)',
  Y: 'eixo Y (linhas)',
};

function compatibilityOf(doc: PolicyOpsDocument): ApplicableCompatibility[] {
  return collectPublishedCompatibility(doc.compatibility);
}

function variableCodeOf(doc: PolicyOpsDocument, variableId: string): string {
  return doc.variables.find((candidate) => candidate.id === variableId)?.code ?? variableId;
}

/** Tuplas que passam a existir — é o que a interface seleciona depois de aplicar. */
function addedTuples(before: string[], after: string[]): string[] {
  const previous = new Set(before);
  return after.filter((tuple) => !previous.has(tuple));
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * O que todo comando de eixo devolve: o preview já calculado (a interface o
 * mostrou antes de aplicar e o repete no toast), as tuplas novas do eixo — que
 * viram a seleção automática — e quantas combinações ficaram pendentes.
 */
export type AxisCommandData<P> = {
  preview: P;
  newTuples: string[];
  pendingCells: number;
};

function dataFor<P>(preview: P, before: Axis, after: MatrixVersion, role: AxisRole): AxisCommandData<P> {
  return {
    preview,
    newTuples: addedTuples(before.tuples, axisOf(after, role).tuples),
    pendingCells: listPending(after).length,
  };
}

// ---------------------------------------------------------------------------
// Inverso comum: restaurar o eixo e as células
// ---------------------------------------------------------------------------

export type RestoreAxisInput = {
  versionId: string;
  role: AxisRole;
  axis: Axis;
  cells: Record<string, Cell>;
};

/**
 * Devolve o eixo e o mapa de células exatamente como estavam. É o inverso de
 * **todas** as operações de nível e de supressão, e é o seu próprio inverso —
 * o que faz refazer funcionar sem recalcular nada.
 */
function restoreAxis(input: RestoreAxisInput, label: string): Command<RestoreAxisInput, void> {
  return defineCommand({
    type: 'axis/_restore',
    input,
    label,
    scope: { versionId: input.versionId },
    execute(doc) {
      const { matrixIndex, version, versionIndex } = locateVersion(doc, input.versionId);
      assertEditable(version);
      const previous: RestoreAxisInput = {
        versionId: input.versionId,
        role: input.role,
        axis: structuredClone(axisOf(version, input.role)),
        cells: structuredClone(version.cells),
      };
      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.matrices[matrixIndex]!.versions[versionIndex]!;
          const axis = structuredClone(input.axis);
          if (input.role === 'X') target.axes.x = axis;
          else target.axes.y = axis;
          target.cells = structuredClone(input.cells);
        }),
        data: undefined,
        events: [],
        inverse: restoreAxis(previous, label),
      };
    },
  });
}

/** Snapshot do estado atual do eixo — o que o inverso vai devolver. */
function snapshotOf(version: MatrixVersion, role: AxisRole, versionId: string): RestoreAxisInput {
  return {
    versionId,
    role,
    axis: structuredClone(axisOf(version, role)),
    cells: structuredClone(version.cells),
  };
}

// ---------------------------------------------------------------------------
// axis/addLevel — docs/04 §5.1
// ---------------------------------------------------------------------------

export type AddLevelCommandInput = {
  versionId: string;
  role: AxisRole;
  variableId: string;
  /** Profundidade de inserção: 0 = mais externo. */
  position: number;
  /** Padrão `REPLICATE`. */
  onExisting?: OnExistingContent;
  /** Rótulo do nível; o padrão é o nome da variável. */
  label?: string;
};

export function addLevelCommand(
  input: AddLevelCommandInput,
): Command<AddLevelCommandInput, AxisCommandData<AddLevelPreview>> {
  return defineCommand({
    type: 'axis/addLevel',
    input,
    label: 'Adicionar nível ao eixo',
    scope: { versionId: input.versionId },
    execute(doc, ctx) {
      const { matrix, matrixIndex, version, versionIndex } = locateVersion(doc, input.versionId);
      assertEditable(version);

      const ref = input.label === undefined
        ? { variableId: input.variableId }
        : { variableId: input.variableId, label: input.label };
      const level = resolveLevel(doc, ref, ctx);
      const snapshot = snapshotOf(version, input.role, input.versionId);

      const applied = addLevelToAxis(version, input.role, {
        level,
        position: input.position,
        ...(input.onExisting === undefined ? {} : { onExisting: input.onExisting }),
        compatibility: compatibilityOf(doc),
      });
      // I16 de novo, agora sobre o grid inteiro já montado.
      assertCombinationsFit(applied.version);

      const { preview, eventPayload } = applied;
      const events = [
        makeEvent(ctx, {
          type: 'AXIS_LEVEL_ADDED',
          scope: versionScope(matrix, version.id),
          summary:
            `${ctx.actor} adicionou o nível "${level.label}" ao ${AXIS_ROLE_LABEL[input.role]} de "${matrix.code}": ` +
            `${preview.before.combinations} combinações viram ${preview.after.combinations}.`,
          payload: {
            role: input.role,
            variableCode: variableCodeOf(doc, input.variableId),
            position: input.position,
            mode: preview.mode,
            before: eventPayload.before,
            after: eventPayload.after,
            droppedCells: eventPayload.droppedCells,
          },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          writeVersion(draft.matrices[matrixIndex]!.versions[versionIndex]!, applied.version);
        }),
        data: dataFor(preview, snapshot.axis, applied.version, input.role),
        events,
        inverse: restoreAxis(snapshot, `Desfazer a adição do nível "${level.label}"`),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// axis/removeLevel — docs/04 §5.2
// ---------------------------------------------------------------------------

export type RemoveLevelCommandInput = {
  versionId: string;
  role: AxisRole;
  levelIndex: number;
  /** Padrão `KEEP_IF_UNANIMOUS` — o conservador. */
  onCollapse?: OnCollapse;
};

export function removeLevelCommand(
  input: RemoveLevelCommandInput,
): Command<RemoveLevelCommandInput, AxisCommandData<RemoveLevelPreview>> {
  return defineCommand({
    type: 'axis/removeLevel',
    input,
    label: 'Remover nível do eixo',
    scope: { versionId: input.versionId },
    execute(doc, ctx) {
      const { matrix, matrixIndex, version, versionIndex } = locateVersion(doc, input.versionId);
      assertEditable(version);

      const snapshot = snapshotOf(version, input.role, input.versionId);

      const applied = removeLevelFromAxis(version, input.role, {
        levelIndex: input.levelIndex,
        ...(input.onCollapse === undefined ? {} : { onCollapse: input.onCollapse }),
        compatibility: compatibilityOf(doc),
      });
      assertCombinationsFit(applied.version);

      const { preview, eventPayload } = applied;
      const events = [
        makeEvent(ctx, {
          type: 'AXIS_LEVEL_REMOVED',
          scope: versionScope(matrix, version.id),
          summary:
            `${ctx.actor} removeu o nível "${eventPayload.label}" do ${AXIS_ROLE_LABEL[input.role]} de "${matrix.code}": ` +
            `${preview.before.combinations} combinações viram ${preview.after.combinations}, ` +
            `${plural(eventPayload.droppedCells.length, 'célula descartada', 'células descartadas')}.`,
          payload: {
            role: input.role,
            variableCode: variableCodeOf(doc, eventPayload.variableId),
            levelIndex: input.levelIndex,
            mode: preview.mode,
            // Íntegro: a operação precisa ser reconstruível a partir da auditoria.
            droppedCells: eventPayload.droppedCells,
            droppedSuppressions: eventPayload.droppedSuppressions,
          },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          writeVersion(draft.matrices[matrixIndex]!.versions[versionIndex]!, applied.version);
        }),
        data: dataFor(preview, snapshot.axis, applied.version, input.role),
        events,
        inverse: restoreAxis(snapshot, `Desfazer a remoção do nível "${eventPayload.label}"`),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// axis/reorderLevels — docs/04 §5.3
// ---------------------------------------------------------------------------

export type ReorderLevelsCommandInput = {
  versionId: string;
  role: AxisRole;
  from: number;
  to: number;
  /** Obrigatório quando o conjunto de tuplas muda (reordenação com perda). */
  confirm?: boolean;
};

export function reorderLevelsCommand(
  input: ReorderLevelsCommandInput,
): Command<ReorderLevelsCommandInput, AxisCommandData<ReorderLevelsPreview>> {
  return defineCommand({
    type: 'axis/reorderLevels',
    input,
    label: 'Reordenar níveis do eixo',
    scope: { versionId: input.versionId },
    execute(doc, ctx) {
      const { matrix, matrixIndex, version, versionIndex } = locateVersion(doc, input.versionId);
      assertEditable(version);

      const snapshot = snapshotOf(version, input.role, input.versionId);
      const applied = reorderAxisLevels(version, input.role, {
        fromIndex: input.from,
        toIndex: input.to,
        compatibility: compatibilityOf(doc),
        ...(input.confirm === undefined ? {} : { confirm: input.confirm }),
      });
      assertCombinationsFit(applied.version);

      const { preview, eventPayload } = applied;
      const events = [
        makeEvent(ctx, {
          type: 'AXIS_LEVEL_REORDERED',
          scope: versionScope(matrix, version.id),
          summary: preview.tuplesChanged
            ? `${ctx.actor} reordenou os níveis do ${AXIS_ROLE_LABEL[input.role]} de "${matrix.code}", ` +
              `mudando o conjunto de combinações: ${plural(preview.addedTuples.length, 'entra', 'entram')} e ` +
              `${plural(preview.removedTuples.length, 'sai', 'saem')}.`
            : `${ctx.actor} reordenou os níveis do ${AXIS_ROLE_LABEL[input.role]} de "${matrix.code}" — ` +
              'nenhuma célula foi perdida.',
          payload: {
            role: input.role,
            from: input.from,
            to: input.to,
            tuplesChanged: preview.tuplesChanged,
            addedTuples: preview.addedTuples,
            removedTuples: preview.removedTuples,
            droppedCells: eventPayload.droppedCells,
          },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          writeVersion(draft.matrices[matrixIndex]!.versions[versionIndex]!, applied.version);
        }),
        data: dataFor(preview, snapshot.axis, applied.version, input.role),
        events,
        inverse: restoreAxis(snapshot, 'Desfazer a reordenação dos níveis'),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// axis/suppressTuples e axis/restoreTuples — docs/04 §5.4, docs/07 §8
// ---------------------------------------------------------------------------

export type SuppressionPreview = {
  role: AxisRole;
  paths: string[];
  before: GridImpact;
  after: GridImpact;
  droppedCells: DroppedCell[];
};

export type SuppressTuplesInput = { versionId: string; role: AxisRole; paths: string[] };

/**
 * Recalcula o eixo com outro conjunto de supressões manuais e devolve o que
 * some junto. Serve tanto para suprimir quanto para restaurar: a diferença
 * está só no conjunto que entra.
 */
function applySuppressions(
  doc: PolicyOpsDocument,
  version: MatrixVersion,
  role: AxisRole,
  suppressions: string[],
): { version: MatrixVersion; preview: SuppressionPreview; paths: string[] } {
  const axis = axisOf(version, role);
  const other = otherAxisOf(version, role);
  const generated = generateTuples({
    levels: axis.levels.map((level) => ({ variableId: level.variableId, domains: level.domains })),
    compatibility: compatibilityOf(doc),
    manualSuppressions: suppressions,
  });
  assertGridFits(generated.tuples.length * other.tuples.length);

  const surviving = new Set(generated.tuples);
  const cells: Record<string, Cell> = {};
  const droppedCells: DroppedCell[] = [];
  for (const [key, cell] of Object.entries(version.cells)) {
    const [xPath, yPath] = key.split('::') as [string, string];
    const own = role === 'X' ? xPath : yPath;
    if (surviving.has(own)) cells[key] = cell;
    else droppedCells.push({ key, cell });
  }

  const nextAxis: Axis = {
    role,
    levels: axis.levels,
    tuples: generated.tuples,
    derivedFrom: { compatibilityVersionIds: generated.usedRuleIds },
  };
  if (suppressions.length > 0) nextAxis.manualSuppressions = suppressions;

  const nextVersion: MatrixVersion = {
    ...version,
    axes: role === 'X' ? { x: nextAxis, y: other } : { x: other, y: nextAxis },
    cells,
  };

  return {
    version: nextVersion,
    paths: suppressions,
    preview: {
      role,
      paths: suppressions,
      before: {
        tuples: axis.tuples.length,
        combinations: axis.tuples.length * other.tuples.length,
        filledCells: Object.keys(version.cells).length,
      },
      after: {
        tuples: generated.tuples.length,
        combinations: generated.tuples.length * other.tuples.length,
        filledCells: Object.keys(cells).length,
      },
      droppedCells,
    },
  };
}

function assertNonEmptyPaths(paths: string[]): void {
  if (paths.length === 0) {
    throw new DomainError('INVALID_INPUT', 'Informe ao menos uma combinação.');
  }
}

/** `axis/suppressTuples` — "marcar como inexistente" (docs/07 §8). */
export function suppressTuplesCommand(
  input: SuppressTuplesInput,
): Command<SuppressTuplesInput, AxisCommandData<SuppressionPreview>> {
  return defineCommand({
    type: 'axis/suppressTuples',
    input,
    label: 'Marcar combinações como inexistentes',
    scope: { versionId: input.versionId },
    execute(doc, ctx) {
      const { matrix, matrixIndex, version, versionIndex } = locateVersion(doc, input.versionId);
      assertEditable(version);
      assertNonEmptyPaths(input.paths);

      const axis = axisOf(version, input.role);
      const existing = new Set(axis.tuples);
      const unknown = input.paths.filter((path) => !existing.has(path));
      if (unknown.length > 0) {
        throw new DomainError(
          'INVALID_COORD',
          `${unknown.length} combinação(ões) informada(s) não existem neste eixo.`,
          { paths: unknown },
        );
      }

      const snapshot = snapshotOf(version, input.role, input.versionId);
      const suppressions = [...new Set([...(axis.manualSuppressions ?? []), ...input.paths])];
      const applied = applySuppressions(doc, version, input.role, suppressions);

      const events = [
        makeEvent(ctx, {
          type: 'TUPLES_SUPPRESSED',
          scope: versionScope(matrix, version.id),
          summary:
            `${ctx.actor} marcou ${plural(input.paths.length, 'combinação', 'combinações')} como inexistente(s) ` +
            `no ${AXIS_ROLE_LABEL[input.role]} de "${matrix.code}".`,
          payload: {
            role: input.role,
            action: 'SUPPRESS',
            paths: input.paths,
            droppedCells: applied.preview.droppedCells,
          },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          writeVersion(draft.matrices[matrixIndex]!.versions[versionIndex]!, applied.version);
        }),
        data: dataFor(applied.preview, snapshot.axis, applied.version, input.role),
        events,
        inverse: restoreAxis(snapshot, 'Desfazer a supressão de combinações'),
      };
    },
  });
}

/** `axis/restoreTuples` — devolve ao grid combinações suprimidas manualmente. */
export function restoreTuplesCommand(
  input: SuppressTuplesInput,
): Command<SuppressTuplesInput, AxisCommandData<SuppressionPreview>> {
  return defineCommand({
    type: 'axis/restoreTuples',
    input,
    label: 'Restaurar combinações suprimidas',
    scope: { versionId: input.versionId },
    execute(doc, ctx) {
      const { matrix, matrixIndex, version, versionIndex } = locateVersion(doc, input.versionId);
      assertEditable(version);
      assertNonEmptyPaths(input.paths);

      const axis = axisOf(version, input.role);
      const current = axis.manualSuppressions ?? [];
      const unknown = input.paths.filter((path) => !current.includes(path));
      if (unknown.length > 0) {
        throw new DomainError(
          'INVALID_COORD',
          `${unknown.length} combinação(ões) informada(s) não estão suprimidas neste eixo.`,
          { paths: unknown },
        );
      }

      const snapshot = snapshotOf(version, input.role, input.versionId);
      const remaining = current.filter((path) => !input.paths.includes(path));
      const applied = applySuppressions(doc, version, input.role, remaining);

      const events = [
        makeEvent(ctx, {
          type: 'TUPLES_SUPPRESSED',
          scope: versionScope(matrix, version.id),
          summary:
            `${ctx.actor} restaurou ${plural(input.paths.length, 'combinação suprimida', 'combinações suprimidas')} ` +
            `no ${AXIS_ROLE_LABEL[input.role]} de "${matrix.code}".`,
          payload: {
            role: input.role,
            action: 'RESTORE',
            paths: input.paths,
            droppedCells: applied.preview.droppedCells,
          },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          writeVersion(draft.matrices[matrixIndex]!.versions[versionIndex]!, applied.version);
        }),
        data: dataFor(applied.preview, snapshot.axis, applied.version, input.role),
        events,
        inverse: restoreAxis(snapshot, 'Desfazer a restauração de combinações'),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Escrita e revalidação
// ---------------------------------------------------------------------------

/** Grava eixos e células calculados por `src/core/axes/levels.ts` no rascunho. */
function writeVersion(target: MatrixVersion, computed: MatrixVersion): void {
  target.axes = structuredClone(computed.axes);
  target.cells = structuredClone(computed.cells);
}

/** I16 revalidada **depois** da operação, sobre o grid inteiro. */
function assertCombinationsFit(version: MatrixVersion): void {
  assertGridFits(version.axes.x.tuples.length * version.axes.y.tuples.length);
}

// ---------------------------------------------------------------------------
// Previews — a interface nunca aplica sem mostrar antes (docs/07 §7)
// ---------------------------------------------------------------------------

/**
 * Id de mentira para os previews: nada do que o preview produz é gravado — o
 * nível resolvido só serve para calcular domínios e tuplas. O id de verdade
 * nasce quando o comando roda.
 */
const PREVIEW_CTX: Pick<Ctx, 'newId'> = { newId: () => 'preview-level' };

/**
 * O preview de uma operação: o impacto calculado **e** as tuplas de antes e de
 * depois, que é o que a miniatura do grid desenha (as novas hachuradas, as que
 * saem riscadas).
 */
export type AxisOperationPreview<P> = {
  preview: P;
  tuplesBefore: string[];
  tuplesAfter: string[];
};

export function previewAddLevelOn(
  doc: PolicyOpsDocument,
  input: AddLevelCommandInput,
  ctx: Pick<Ctx, 'newId'> = PREVIEW_CTX,
): AxisOperationPreview<AddLevelPreview> {
  const { version } = locateVersion(doc, input.versionId);
  const ref = input.label === undefined
    ? { variableId: input.variableId }
    : { variableId: input.variableId, label: input.label };
  const levelInput = {
    level: resolveLevel(doc, ref, ctx),
    position: input.position,
    ...(input.onExisting === undefined ? {} : { onExisting: input.onExisting }),
    compatibility: compatibilityOf(doc),
  };
  return {
    preview: previewAddLevel(version, input.role, levelInput),
    tuplesBefore: axisOf(version, input.role).tuples,
    tuplesAfter: axisOf(addLevelToAxis(version, input.role, levelInput).version, input.role).tuples,
  };
}

export function previewRemoveLevelOn(
  doc: PolicyOpsDocument,
  input: RemoveLevelCommandInput,
): AxisOperationPreview<RemoveLevelPreview> {
  const { version } = locateVersion(doc, input.versionId);
  const levelInput = {
    levelIndex: input.levelIndex,
    ...(input.onCollapse === undefined ? {} : { onCollapse: input.onCollapse }),
    compatibility: compatibilityOf(doc),
  };
  return {
    preview: previewRemoveLevel(version, input.role, levelInput),
    tuplesBefore: axisOf(version, input.role).tuples,
    tuplesAfter: axisOf(removeLevelFromAxis(version, input.role, levelInput).version, input.role).tuples,
  };
}

export function previewReorderLevelsOn(
  doc: PolicyOpsDocument,
  input: ReorderLevelsCommandInput,
): AxisOperationPreview<ReorderLevelsPreview> {
  const { version } = locateVersion(doc, input.versionId);
  const levelInput = {
    fromIndex: input.from,
    toIndex: input.to,
    compatibility: compatibilityOf(doc),
    // `confirm` não muda o cálculo: só governa a recusa de aplicar sem
    // confirmação, e o preview é justamente o que embasa essa confirmação.
    confirm: true,
  };
  return {
    preview: previewReorderLevels(version, input.role, levelInput),
    tuplesBefore: axisOf(version, input.role).tuples,
    tuplesAfter: axisOf(reorderAxisLevels(version, input.role, levelInput).version, input.role).tuples,
  };
}
