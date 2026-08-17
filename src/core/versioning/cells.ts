import Decimal from 'decimal.js-light';
import { decodeCellKey, encodeCellKey } from '../axes/paths';
import {
  applyToDocument,
  defineCommand,
  makeEvent,
  type Command,
  type Ctx,
} from '../command';
import { COLOR_REGEX, DECIMAL_REGEX } from '../document/schema';
import type {
  CatalogItem,
  CatalogItemKind,
  Cell,
  DocEvent,
  Matrix,
  MatrixVersion,
  PolicyOpsDocument,
} from '../document/schema';
import { DomainError } from '../errors';
import { assertLinkedDraftEditable } from '../document/cr-freeze';
import { assertEditable, locateVersion, versionScope } from './lifecycle';

/**
 * Edição de células — docs/05-regras-de-negocio.md §2.
 *
 * A semântica de três estados por campo é o que permite "atribuir a Oferta 8 a
 * 50 células" sem tocar nas decisões delas:
 *
 * | no `set`            | efeito          |
 * |---------------------|-----------------|
 * | chave **ausente**   | não mexe        |
 * | `null`              | limpa o campo   |
 * | valor               | define o campo  |
 */

// ---------------------------------------------------------------------------
// §2.1 Patch
// ---------------------------------------------------------------------------

export type CellField = 'decision' | 'offer' | 'limit' | 'limitOverride' | 'color' | 'note';

/** Ordem canônica dos campos — é o que faz dois `set` iguais gerarem a mesma assinatura. */
export const CELL_FIELDS: readonly CellField[] = [
  'decision',
  'offer',
  'limit',
  'limitOverride',
  'color',
  'note',
];

export type CellAttrValue = string | number | boolean;

export type CellPatchSet = {
  decision?: string | null;
  offer?: string | null;
  limit?: string | null;
  limitOverride?: string | null;
  color?: string | null;
  note?: string | null;
  /** Merge raso; chave com `null` remove a chave. */
  attrs?: Record<string, CellAttrValue | null>;
};

export type PatchCoord = { xPath: string; yPath: string };
export type CellPatch = { coords: PatchCoord[]; set: CellPatchSet };

/** docs/05 §2.2: teto de 6.000 coordenadas por patch. */
export const MAX_PATCH_COORDS = 6_000;
/** docs/05 §2.3: acima disso o evento grava só contagem e campos. */
export const MAX_AUDIT_CELLS = 500;

export type ApplyCellPatchInput = { versionId: string; patch: CellPatch };
export type ApplyCellPatchesInput = { versionId: string; patches: CellPatch[] };
export type ApplyCellPatchData = {
  /** Coordenadas distintas tocadas. */
  cellCount: number;
  /** Células que ficaram sem nenhum campo e saíram do mapa. */
  removedCells: number;
  fields: string[];
};

/**
 * Vista parcial de `Cell` com todos os campos escalares opcionais. `Cell` é
 * estruturalmente compatível, e é isso que permite escrever `alvo[campo] = v`
 * e `delete alvo[campo]` com `campo: CellField` sem recorrer a `any`.
 */
type CellScalars = Partial<Record<CellField, string>>;

// ---------------------------------------------------------------------------
// §2.2 Validações
// ---------------------------------------------------------------------------

const FIELD_KIND: Partial<Record<CellField, CatalogItemKind>> = {
  decision: 'DECISION',
  offer: 'OFFER',
  limit: 'LIMIT',
};

const FIELD_LABEL: Record<CellField | 'attrs', string> = {
  decision: 'a decisão',
  offer: 'a oferta',
  limit: 'o limite',
  limitOverride: 'o valor de limite',
  color: 'a cor',
  note: 'a observação',
  attrs: 'os atributos',
};

function assertCatalogRef(catalog: CatalogItem[], field: CellField, code: string): void {
  const kind = FIELD_KIND[field]!;
  const item = catalog.find((candidate) => candidate.kind === kind && candidate.code === code);
  if (item === undefined) {
    throw new DomainError(
      'CATALOG_KIND_MISMATCH',
      `"${code}" não existe no catálogo como item do tipo ${kind}.`,
      { field, code, kind },
    );
  }
  if (item.archivedAt !== undefined) {
    throw new DomainError(
      'CATALOG_ITEM_ARCHIVED',
      `O item "${item.label}" foi descontinuado e não pode ser atribuído a células.`,
      { field, code, kind },
    );
  }
}

function assertFieldValue(catalog: CatalogItem[], field: CellField, value: string): void {
  if (FIELD_KIND[field] !== undefined) {
    assertCatalogRef(catalog, field, value);
    return;
  }
  if (field === 'color') {
    if (!COLOR_REGEX.test(value)) {
      throw new DomainError('INVALID_INPUT', `"${value}" não é uma cor no formato #RRGGBB.`, {
        field,
        value,
      });
    }
    return;
  }
  if (field === 'limitOverride') {
    if (!DECIMAL_REGEX.test(value) || new Decimal(value).lte(0)) {
      throw new DomainError(
        'INVALID_INPUT',
        `"${value}" não é um valor de limite válido: informe um decimal positivo.`,
        { field, value },
      );
    }
    return;
  }
  // note
  if (value.trim().length === 0) {
    throw new DomainError(
      'INVALID_INPUT',
      'Uma observação em branco não é gravada — use null para apagá-la.',
      { field },
    );
  }
}

/**
 * Campos escalares efetivamente presentes no `set`, em ordem canônica.
 * `undefined` conta como ausente: quem quer limpar um campo passa `null`.
 */
function fieldsOf(set: CellPatchSet): CellField[] {
  return CELL_FIELDS.filter((field) => set[field] !== undefined);
}

function validatePatch(version: MatrixVersion, catalog: CatalogItem[], patch: CellPatch): void {
  if (patch.coords.length === 0) {
    throw new DomainError('INVALID_INPUT', 'Um patch precisa de ao menos uma coordenada.');
  }
  if (patch.coords.length > MAX_PATCH_COORDS) {
    throw new DomainError(
      'PATCH_TOO_LARGE',
      `Este patch abrange ${patch.coords.length} coordenadas; o teto é ${MAX_PATCH_COORDS}.`,
      { count: patch.coords.length, max: MAX_PATCH_COORDS },
    );
  }

  const fields = fieldsOf(patch.set);
  const attrs = patch.set.attrs;
  if (fields.length === 0 && attrs === undefined) {
    throw new DomainError('INVALID_INPUT', 'Um patch precisa mexer em ao menos um campo.');
  }

  const xTuples = new Set(version.axes.x.tuples);
  const yTuples = new Set(version.axes.y.tuples);
  const invalid = patch.coords.filter(
    (coord) => !xTuples.has(coord.xPath) || !yTuples.has(coord.yPath),
  );
  if (invalid.length > 0) {
    throw new DomainError(
      'INVALID_COORD',
      `${invalid.length} coordenada(s) do patch não existem nos eixos desta versão.`,
      { coords: invalid },
    );
  }

  for (const field of fields) {
    const value = patch.set[field];
    if (value === null) continue;
    assertFieldValue(catalog, field, value!);
  }
}

// ---------------------------------------------------------------------------
// Aplicação
// ---------------------------------------------------------------------------

type Touched = { fields: Set<CellField>; attrKeys: Set<string> };

type PatchOutcome = {
  cells: Record<string, Cell>;
  touched: Map<string, Touched>;
  removedCells: number;
  fields: string[];
};

function applyPatches(original: Record<string, Cell>, patches: CellPatch[]): PatchOutcome {
  const cells: Record<string, Cell> = { ...original };
  const touched = new Map<string, Touched>();
  const allFields = new Set<string>();

  for (const patch of patches) {
    const fields = fieldsOf(patch.set);
    const attrEntries = Object.entries(patch.set.attrs ?? {});
    for (const field of fields) allFields.add(field);
    if (patch.set.attrs !== undefined) allFields.add('attrs');

    for (const coord of patch.coords) {
      const key = encodeCellKey(coord.xPath, coord.yPath);

      let record = touched.get(key);
      if (record === undefined) {
        record = { fields: new Set(), attrKeys: new Set() };
        touched.set(key, record);
      }
      for (const field of fields) record.fields.add(field);
      for (const [attrKey] of attrEntries) record.attrKeys.add(attrKey);

      const before = cells[key];
      const next: Cell = { ...before };
      const scalars = next as CellScalars;
      for (const field of fields) {
        const value = patch.set[field];
        if (value === null) delete scalars[field];
        else scalars[field] = value!;
      }
      if (attrEntries.length > 0) {
        const attrs: Record<string, CellAttrValue> = { ...before?.attrs };
        for (const [attrKey, attrValue] of attrEntries) {
          if (attrValue === null) delete attrs[attrKey];
          else attrs[attrKey] = attrValue;
        }
        if (Object.keys(attrs).length === 0) delete next.attrs;
        else next.attrs = attrs;
      }

      // Célula sem nenhum campo preenchido é removida do mapa (§2.1).
      if (Object.keys(next).length === 0) delete cells[key];
      else cells[key] = next;
    }
  }

  let removedCells = 0;
  for (const key of touched.keys()) {
    if (original[key] !== undefined && cells[key] === undefined) removedCells += 1;
  }

  return { cells, touched, removedCells, fields: [...allFields] };
}

/**
 * O patch inverso, campo a campo — inclusive os campos que estavam **ausentes**
 * na célula original, que viram `null` (§2.3).
 *
 * Um único `CellPatch` não dá conta: dez células com conteúdos diferentes
 * precisam de dez restaurações diferentes. As coordenadas são agrupadas por
 * conteúdo idêntico do `set`, e o inverso é a lista de patches resultante —
 * cada um deles um patch legítimo, com a mesma semântica de três estados.
 */
function buildInversePatches(
  original: Record<string, Cell>,
  touched: Map<string, Touched>,
): CellPatch[] {
  const groups = new Map<string, CellPatch>();

  for (const [key, record] of touched) {
    const cell = original[key];
    const set: CellPatchSet = {};
    const scalars = set as Partial<Record<CellField, string | null>>;
    for (const field of CELL_FIELDS) {
      if (!record.fields.has(field)) continue;
      scalars[field] = (cell as CellScalars | undefined)?.[field] ?? null;
    }
    if (record.attrKeys.size > 0) {
      const attrs: Record<string, CellAttrValue | null> = {};
      for (const attrKey of [...record.attrKeys].sort()) {
        attrs[attrKey] = cell?.attrs?.[attrKey] ?? null;
      }
      set.attrs = attrs;
    }

    const signature = JSON.stringify(set);
    const coord = decodeCellKey(key);
    const group = groups.get(signature);
    if (group === undefined) groups.set(signature, { coords: [coord], set });
    else group.coords.push(coord);
  }

  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// §2.3 Auditoria
// ---------------------------------------------------------------------------

function summarize(actor: string, fields: string[], cellCount: number): string {
  const labels = fields.map((field) => FIELD_LABEL[field as CellField | 'attrs']);
  const what =
    labels.length === 1
      ? labels[0]!
      : `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]!}`;
  const cells = cellCount === 1 ? '1 célula' : `${cellCount} células`;
  return `${actor} alterou ${what} de ${cells}.`;
}

function cellsUpdatedEvent(
  ctx: Ctx,
  matrix: Matrix,
  version: MatrixVersion,
  outcome: PatchOutcome,
  original: Record<string, Cell>,
): DocEvent {
  const cellCount = outcome.touched.size;
  const payload: Record<string, unknown> = { cellCount, fields: outcome.fields };

  // Acima de 500 células grava só contagem e campos — o documento não pode
  // virar um log (§2.3).
  if (cellCount <= MAX_AUDIT_CELLS) {
    const before: Record<string, Cell> = {};
    const after: Record<string, Cell> = {};
    for (const key of outcome.touched.keys()) {
      const previous = original[key];
      if (previous !== undefined) before[key] = previous;
      const next = outcome.cells[key];
      if (next !== undefined) after[key] = next;
    }
    payload.before = before;
    payload.after = after;
  }

  return makeEvent(ctx, {
    type: 'CELLS_UPDATED',
    scope: versionScope(matrix, version.id),
    summary: summarize(ctx.actor, outcome.fields, cellCount),
    payload,
  });
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

function runPatches(
  doc: PolicyOpsDocument,
  ctx: Ctx,
  versionId: string,
  patches: CellPatch[],
  label: string,
) {
  const { matrix, matrixIndex, version, versionIndex } = locateVersion(doc, versionId);

  // Valida tudo antes de tocar em qualquer coisa: nada de estado parcial.
  assertEditable(version);
  // I25: rascunho de matriz vinculado a DB congelado é somente leitura (S36).
  assertLinkedDraftEditable(doc, version.id);
  if (patches.length === 0) {
    throw new DomainError('INVALID_INPUT', 'Nenhum patch informado.');
  }
  for (const patch of patches) validatePatch(version, doc.catalog, patch);

  const original = version.cells;
  const outcome = applyPatches(original, patches);
  const inversePatches = buildInversePatches(original, outcome.touched);
  const events = [cellsUpdatedEvent(ctx, matrix, version, outcome, original)];

  return {
    document: applyToDocument(doc, events, (draft) => {
      draft.matrices[matrixIndex]!.versions[versionIndex]!.cells = outcome.cells;
    }),
    data: {
      cellCount: outcome.touched.size,
      removedCells: outcome.removedCells,
      fields: outcome.fields,
    },
    events,
    inverse: applyCellPatches({ versionId, patches: inversePatches }, label),
  };
}

/** `version/applyCellPatch` — docs/08 §3. Um patch, muitas coordenadas. */
export function applyCellPatch(
  input: ApplyCellPatchInput,
): Command<ApplyCellPatchInput, ApplyCellPatchData> {
  const label = `Editar ${input.patch.coords.length === 1 ? '1 célula' : `${input.patch.coords.length} células`}`;
  return defineCommand({
    type: 'version/applyCellPatch',
    input,
    label,
    scope: { versionId: input.versionId },
    execute: (doc, ctx) => runPatches(doc, ctx, input.versionId, [input.patch], label),
  });
}

/**
 * Forma geral: uma lista de patches aplicada em ordem. É o que o inverso de
 * `version/applyCellPatch` usa, já que restaurar N células com conteúdos
 * diferentes exige N grupos de restauração.
 */
export function applyCellPatches(
  input: ApplyCellPatchesInput,
  label = 'Editar células',
): Command<ApplyCellPatchesInput, ApplyCellPatchData> {
  return defineCommand({
    type: 'version/applyCellPatches',
    input,
    label,
    scope: { versionId: input.versionId },
    execute: (doc, ctx) => runPatches(doc, ctx, input.versionId, input.patches, label),
  });
}
