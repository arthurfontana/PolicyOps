import { decodeCellKey } from '../axes/paths';
import { applyToDocument, defineCommand, makeEvent, type Command, type Ctx } from '../command';
import { setMatrixTags } from '../document/commands';
import type { Cell, DocEvent, PolicyOpsDocument } from '../document/schema';
import { DomainError } from '../errors';
import type { CellChange } from '../diff/types';
import { createDraft, createMatrix, MIN_NOTES_LENGTH } from '../versioning/lifecycle';
import { suppressTuplesCommand } from '../versioning/axis-commands';
import {
  applyCellPatches,
  MAX_PATCH_COORDS,
  type CellPatch,
  type CellPatchSet,
} from '../versioning/cells';
import { planImport, type ImportPlan, type MatrixPlan } from './plan';
import type { DocumentWithProfiles, ImportProfile } from './profile';
import type { ImportTable } from './parse-table';

/**
 * `import/apply` — a aplicação da carga (docs/12-carga-de-matrizes.md §5.4,
 * docs/08-camada-de-comandos.md §3).
 *
 * O único comando do catálogo que produz eventos de **várias** matrizes numa
 * transação só, e por isso o que mais depende da regra 4 de docs/08 §1
 * (validar antes de tocar). A ordem é normativa:
 *
 * 1. recalcula o plano sobre o documento corrente e compara com o `planHash`
 *    que o usuário revisou — divergiu, falha inteiro (RN-14, CT-11);
 * 2. valida a seleção: só `NEW` e `CHANGED` são aplicáveis;
 * 3. matriz `NEW`: `matrix/create` + `axis/suppressTuples` (RN-21) + as
 *    células, tudo na v1 `DRAFT`;
 * 4. matriz `CHANGED`: `version/createDraft` a partir da publicada + um patch
 *    com **apenas** as células que mudam;
 * 5. tags sempre por `add`, nunca por `remove` (RN-12);
 * 6. um `IMPORT_RUN` no documento e `importRunId` no payload de cada
 *    `MATRIX_CREATED`, `DRAFT_CREATED` e `CELLS_UPDATED` desta rodada.
 *
 * A carga **não publica** (RN-10): tudo para no rascunho.
 *
 * A atomicidade não precisa de mecanismo próprio. Cada passo é um comando
 * existente, aplicado sobre um documento de trabalho imutável; um erro no meio
 * do lote propaga o `DomainError` para fora de `execute`, e `defineCommand`
 * devolve `{ ok: false }` com o documento **original** intocado. Nada de
 * estado parcial, e nenhuma lógica de criação de matriz ou de patch
 * reescrita aqui — só composição.
 */

export type ApplyImportInput = {
  profile: ImportProfile;
  table: ImportTable;
  fileName?: string;
  /** O plano que o usuário revisou (RN-14). */
  planHash: string;
  /** `MatrixPlan.key` das matrizes escolhidas no passo 5. */
  selectedKeys: string[];
  /** Nota da carga, ≥ 10 caracteres — vira a nota padrão de cada publicação. */
  notes: string;
};

export type ApplyImportData = {
  importRunId: string;
  /** `Matrix.id` das matrizes criadas (status `NEW`). */
  createdMatrices: string[];
  /** `MatrixVersion.id` de todo rascunho criado — inclusive a v1 das novas. */
  createdDrafts: string[];
  /** Chaves que o usuário deixou de fora (CT-14). */
  ignoredByUser: string[];
};

// ---------------------------------------------------------------------------
// Células → patches
// ---------------------------------------------------------------------------

const SCALAR_FIELDS = ['decision', 'offer', 'limit', 'limitOverride', 'color', 'note'] as const;
type ScalarField = (typeof SCALAR_FIELDS)[number];

function setForAdded(after: Cell): CellPatchSet {
  const set: CellPatchSet = {};
  for (const field of SCALAR_FIELDS) {
    const value = after[field];
    if (value !== undefined) set[field] = value;
  }
  if (after.attrs !== undefined) set.attrs = { ...after.attrs };
  return set;
}

function setForRemoved(before: Cell): CellPatchSet {
  const set: CellPatchSet = {};
  for (const field of SCALAR_FIELDS) {
    if (before[field] !== undefined) set[field] = null;
  }
  if (before.attrs !== undefined) {
    const attrs: Record<string, null> = {};
    for (const key of Object.keys(before.attrs)) attrs[key] = null;
    set.attrs = attrs;
  }
  return set;
}

/**
 * Só os campos que de fato mudaram — é o que faz "uma célula alterada" virar um
 * patch de um campo, e não a reescrita da célula inteira. Campo ausente no
 * "depois" vira `null`, que é como a semântica de três estados apaga (docs/05
 * §2.1).
 */
function setForModified(before: Cell, after: Cell, fields: readonly string[]): CellPatchSet {
  const set: CellPatchSet = {};
  for (const field of fields) {
    if (field === 'attrs') {
      const attrs: Record<string, string | number | boolean | null> = {};
      for (const key of Object.keys(before.attrs ?? {})) attrs[key] = null;
      for (const [key, value] of Object.entries(after.attrs ?? {})) attrs[key] = value;
      set.attrs = attrs;
      continue;
    }
    const scalar = field as ScalarField;
    set[scalar] = after[scalar] ?? null;
  }
  return set;
}

function setForChange(change: CellChange): CellPatchSet {
  if (change.kind === 'ADDED') return setForAdded(change.after);
  if (change.kind === 'REMOVED') return setForRemoved(change.before);
  return setForModified(change.before, change.after, change.fields);
}

/**
 * Agrupa as coordenadas por conteúdo idêntico do `set`: 40.068 células com seis
 * ofertas distintas viram seis patches, não 40.068. Grupos acima do teto de
 * coordenadas por patch (docs/05 §2.2) são fatiados.
 */
export function patchesForChanges(changes: readonly CellChange[]): CellPatch[] {
  const groups = new Map<string, { set: CellPatchSet; keys: string[] }>();
  for (const change of changes) {
    const set = setForChange(change);
    if (Object.keys(set).length === 0) continue;
    const signature = JSON.stringify(set);
    const group = groups.get(signature);
    if (group === undefined) groups.set(signature, { set, keys: [change.key] });
    else group.keys.push(change.key);
  }

  const patches: CellPatch[] = [];
  for (const { set, keys } of groups.values()) {
    for (let start = 0; start < keys.length; start += MAX_PATCH_COORDS) {
      patches.push({
        coords: keys.slice(start, start + MAX_PATCH_COORDS).map((key) => decodeCellKey(key)),
        set,
      });
    }
  }
  return patches;
}

// ---------------------------------------------------------------------------
// Composição
// ---------------------------------------------------------------------------

/** Estado corrente da composição: documento de trabalho e o que já foi feito. */
type Run = {
  doc: PolicyOpsDocument;
  /** Inversos na ordem de execução — desfeitos ao contrário. */
  inverses: Command[];
  /** Eventos desta rodada que recebem `importRunId`. */
  stamped: Set<string>;
  createdMatrices: string[];
  createdDrafts: string[];
};

const STAMPED_EVENT_TYPES = new Set(['MATRIX_CREATED', 'DRAFT_CREATED', 'CELLS_UPDATED']);

/**
 * Executa um subcomando contra o documento de trabalho. Erro propaga como
 * `DomainError` e derruba a carga inteira antes de qualquer escrita no
 * documento recebido — é a atomicidade de CT-11 e do lote parcial.
 */
function step<O>(run: Run, ctx: Ctx, command: Command<unknown, O>): O {
  const result = command.run(run.doc, ctx);
  if (!result.ok) throw result.error;
  run.doc = result.document;
  run.inverses.push(result.inverse);
  for (const event of result.events) {
    if (STAMPED_EVENT_TYPES.has(event.type)) run.stamped.add(event.id);
  }
  return result.data;
}

function applyTags(run: Run, ctx: Ctx, matrixId: string, tags: readonly string[]): void {
  // RN-12: sempre `add`, nunca `remove` — tag posta à mão nunca é apagada por
  // uma carga. O comando é idempotente, então recarregar não duplica (CT-13).
  if (tags.length === 0) return;
  step(run, ctx, setMatrixTags({ matrixId, add: [...tags] }));
}

function applyNewMatrix(run: Run, ctx: Ctx, profile: ImportProfile, plan: MatrixPlan): void {
  const axes = plan.axes;
  if (axes === undefined) {
    throw new DomainError(
      'IMPORT_PROFILE_INVALID',
      `O plano não projetou os eixos da matriz nova "${plan.code}".`,
      { code: plan.code },
    );
  }

  const created = step(
    run,
    ctx,
    createMatrix({
      projectId: profile.projectId,
      code: plan.code,
      name: plan.name,
      x: { levels: axes.x.levels.map((level) => ({ variableId: level.variableId, label: level.label })) },
      y: { levels: axes.y.levels.map((level) => ({ variableId: level.variableId, label: level.label })) },
    }),
  );
  run.createdMatrices.push(created.matrixId);
  run.createdDrafts.push(created.versionId);

  // RN-21: as tuplas que o arquivo não observa nascem em `manualSuppressions`,
  // e é isso que faz a matriz nova ter zero combinações pendentes (CT-16).
  for (const role of ['X', 'Y'] as const) {
    const paths = role === 'X' ? axes.x.manualSuppressions : axes.y.manualSuppressions;
    if (paths.length === 0) continue;
    step(run, ctx, suppressTuplesCommand({ versionId: created.versionId, role, paths }));
  }

  const patches = patchesForChanges(plan.changes);
  if (patches.length > 0) {
    step(
      run,
      ctx,
      applyCellPatches({ versionId: created.versionId, patches }, `Carga de "${plan.code}"`),
    );
  }

  applyTags(run, ctx, created.matrixId, plan.tags);
}

function applyChangedMatrix(run: Run, ctx: Ctx, plan: MatrixPlan): void {
  const draft = step(
    run,
    ctx,
    createDraft({ matrixId: plan.matrixId!, baseVersionId: plan.baseVersionId! }),
  );
  run.createdDrafts.push(draft.versionId);

  // Só as células que mudam: o rascunho já nasce clone da publicada, e
  // reescrever o grid inteiro tornaria o diff da revisão ilegível.
  const patches = patchesForChanges(plan.changes);
  if (patches.length > 0) {
    step(run, ctx, applyCellPatches({ versionId: draft.versionId, patches }, `Carga de "${plan.code}"`));
  }

  applyTags(run, ctx, plan.matrixId!, plan.tags);
}

// ---------------------------------------------------------------------------
// Validação da seleção (§5.5, §5.8)
// ---------------------------------------------------------------------------

function selectApplicable(plan: ImportPlan, selectedKeys: readonly string[]): MatrixPlan[] {
  const byKey = new Map(plan.matrices.map((entry) => [entry.key, entry]));
  const applicable: MatrixPlan[] = [];

  for (const key of selectedKeys) {
    const entry = byKey.get(key);
    if (entry === undefined) {
      // Chave que não está no plano recalculado é sintoma de plano obsoleto —
      // mas o `planHash` já teria pegado isso; aqui é defesa de programação.
      throw new DomainError(
        'IMPORT_PLAN_STALE',
        `A matriz "${key}" não está no plano recalculado — revise o plano antes de aplicar.`,
        { key },
      );
    }
    if (entry.status === 'NEW' || entry.status === 'CHANGED') {
      applicable.push(entry);
      continue;
    }
    if (entry.status === 'STRUCTURAL') {
      throw new DomainError(
        'IMPORT_STRUCTURE_DIVERGED',
        `${entry.code}: ${entry.reason ?? 'o arquivo traz combinações que não existem nos eixos desta matriz.'}`,
        { key, code: entry.code, unknownTuples: entry.unknownTuples },
      );
    }
    if (entry.status === 'BLOCKED') {
      throw new DomainError(
        'IMPORT_TARGET_HAS_DRAFT',
        `${entry.code}: ${entry.reason ?? 'esta matriz não pode receber a carga agora.'}`,
        { key, code: entry.code },
      );
    }
    // `UNCHANGED` e `ABSENT_IN_FILE` selecionadas não são erro: não há nada a
    // fazer com elas, e é exatamente isso que RN-02 exige (nenhum evento).
  }

  if (applicable.length === 0) {
    throw new DomainError(
      'IMPORT_NOTHING_TO_APPLY',
      'Nenhuma alteração a aplicar: a seleção não tem nenhuma matriz nova nem alterada.',
      { selected: selectedKeys.length },
    );
  }
  return applicable;
}

// ---------------------------------------------------------------------------
// O comando
// ---------------------------------------------------------------------------

function runSummary(actor: string, plan: ImportPlan, applied: readonly MatrixPlan[]): string {
  const source = plan.source.fileName ?? 'a tabela colada';
  const changed = applied.filter((entry) => entry.status === 'CHANGED').length;
  const created = applied.filter((entry) => entry.status === 'NEW').length;
  const parts: string[] = [];
  if (created > 0) parts.push(`${created} de ${plan.matrices.length} matrizes criadas`);
  if (changed > 0) parts.push(`${changed} de ${plan.matrices.length} matrizes alteradas`);
  parts.push(`${plan.totals.unchanged} inalteradas`);
  return `${actor} carregou ${source}: ${parts.join(', ')}.`;
}

export function applyImport(input: ApplyImportInput): Command<ApplyImportInput, ApplyImportData> {
  return defineCommand({
    type: 'import/apply',
    input,
    label: 'Aplicar a carga de matrizes',
    execute(doc, ctx) {
      // 1. RN-14 — o plano é recalculado sobre o documento corrente, e o hash
      // do que o usuário revisou precisa bater. Nada é gravado antes disso.
      const plan = planImport(doc as DocumentWithProfiles, input.table, input.profile, {
        ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
      });
      if (plan.planHash !== input.planHash) {
        throw new DomainError(
          'IMPORT_PLAN_STALE',
          'O documento mudou depois que o plano foi calculado — revise o plano recalculado antes de aplicar.',
          { expected: input.planHash, actual: plan.planHash },
        );
      }

      // 2. A nota da carga é o padrão de cada publicação futura (US-07), então
      // vale o mesmo mínimo de `version/publish`.
      const notes = input.notes.trim();
      if (notes.length < MIN_NOTES_LENGTH) {
        throw new DomainError(
          'NOTES_REQUIRED',
          `Descreva esta carga: são necessários ao menos ${MIN_NOTES_LENGTH} caracteres.`,
          { length: notes.length, minimum: MIN_NOTES_LENGTH },
        );
      }

      // 3. A seleção, contra o plano recalculado.
      const applicable = selectApplicable(plan, input.selectedKeys);

      const importRunId = ctx.newId();
      const run: Run = {
        doc,
        inverses: [],
        stamped: new Set(),
        createdMatrices: [],
        createdDrafts: [],
      };

      for (const entry of applicable) {
        if (entry.status === 'NEW') applyNewMatrix(run, ctx, input.profile, entry);
        else applyChangedMatrix(run, ctx, entry);
      }

      const selected = new Set(input.selectedKeys);
      const ignoredByUser = plan.matrices
        .filter((entry) => (entry.status === 'NEW' || entry.status === 'CHANGED') && !selected.has(entry.key))
        .map((entry) => entry.key);

      const importRun = makeEvent(ctx, {
        type: 'IMPORT_RUN',
        scope: { projectId: input.profile.projectId },
        summary: runSummary(ctx.actor, plan, applicable),
        payload: {
          importRunId,
          profileCode: plan.profileCode,
          notes,
          ...(plan.source.fileName === undefined ? {} : { fileName: plan.source.fileName }),
          contentHash: plan.source.contentHash,
          rowCount: plan.source.rowCount,
          totals: plan.totals,
          createdMatrices: run.createdMatrices.length,
          createdDrafts: run.createdDrafts.length,
          ignoredByUser,
        },
      });

      // 4. US-10 — todo evento desta rodada carrega o `importRunId`, que é o fio
      // que liga uma célula ao arquivo que a originou. Os eventos já estão no
      // documento de trabalho (cada subcomando os anexou); esta passada só os
      // carimba, junto com o `IMPORT_RUN`.
      const document = applyToDocument(run.doc, [importRun], (draft) => {
        for (const event of draft.events) {
          if (!run.stamped.has(event.id)) continue;
          const payload = (event.payload ?? {}) as Record<string, unknown>;
          payload.importRunId = importRunId;
          event.payload = payload as DocEvent['payload'];
        }
      });

      return {
        document,
        data: {
          importRunId,
          createdMatrices: run.createdMatrices,
          createdDrafts: run.createdDrafts,
          ignoredByUser,
        },
        events: [importRun],
        inverse: undoImport({
          inverses: run.inverses,
          matrices: run.createdMatrices.length,
          drafts: run.createdDrafts.length,
        }),
      };
    },
  });
}

/**
 * Inverso de `import/apply`: os inversos dos subcomandos, **na ordem
 * contrária** — descarta os rascunhos criados e remove as matrizes criadas,
 * devolvendo o documento ao que era. O log de eventos não é rebobinado: ele é
 * append-only (docs/03 §8) e o desfazer é registro, não reescrita da história
 * (docs/08 §2).
 */
type UndoImportInput = { inverses: Command[]; matrices: number; drafts: number };

function undoImport(input: UndoImportInput): Command<UndoImportInput, void> {
  return defineCommand({
    type: 'import/_undoApply',
    input,
    label:
      input.matrices > 0
        ? `Desfazer a carga (${input.matrices} matrizes, ${input.drafts} rascunhos)`
        : `Desfazer a carga (${input.drafts} rascunhos)`,
    execute(doc, ctx) {
      let working = doc;
      const redo: Command[] = [];
      for (let index = input.inverses.length - 1; index >= 0; index--) {
        const result = input.inverses[index]!.run(working, ctx);
        if (!result.ok) throw result.error;
        working = result.document;
        redo.push(result.inverse);
      }
      return {
        document: working,
        data: undefined,
        events: [],
        // `redo` já sai na ordem que este mesmo comando espera: ele executa o
        // array de trás para frente, e `redo` foi montado do fim para o começo.
        inverse: undoImport({ ...input, inverses: redo }),
      };
    },
  });
}
