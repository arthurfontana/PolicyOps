import {
  applyToDocument,
  defineCommand,
  isoFrom,
  makeEvent,
  type Command,
} from '../command';
import { CODE_REGEX, COLOR_REGEX, DECIMAL_REGEX } from '../document/schema';
import type { CatalogItem, CatalogItemKind, PolicyOpsDocument } from '../document/schema';
import { DomainError } from '../errors';

/**
 * Comandos da Biblioteca de Conteúdo (Catálogo) — docs/08-camada-de-comandos.md §3
 * e docs/05-regras-de-negocio.md §5.5 (catálogo é referência viva, não snapshot).
 *
 * Mesmo contrato da S04 (`src/core/command.ts`): puro, imutável, inversível,
 * valida antes de tocar, registra evento `CATALOG_CHANGED`.
 */

function assertText(value: string, what: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DomainError('INVALID_INPUT', `${what} não pode ficar em branco.`, { value });
  }
  return trimmed;
}

function assertCode(code: string): void {
  if (!CODE_REGEX.test(code)) {
    throw new DomainError(
      'INVALID_INPUT',
      `"${code}" não é um código válido: um código casa ^[A-Z0-9_]+$.`,
      { code },
    );
  }
}

function assertColor(color: string | undefined): string | undefined {
  if (color !== undefined && !COLOR_REGEX.test(color)) {
    throw new DomainError('INVALID_INPUT', `"${color}" não é uma cor válida: esperado #RRGGBB.`, {
      color,
    });
  }
  return color;
}

function assertNumericValue(numericValue: string | undefined): string | undefined {
  if (numericValue !== undefined) {
    if (!DECIMAL_REGEX.test(numericValue)) {
      throw new DomainError(
        'INVALID_INPUT',
        `"${numericValue}" não é um número válido.`,
        { numericValue },
      );
    }
    // Valida que é positivo
    const decimal = parseFloat(numericValue);
    if (decimal <= 0) {
      throw new DomainError(
        'LIMIT_NEEDS_NUMERIC_VALUE',
        `Valor para limite deve ser positivo, recebido: ${numericValue}.`,
        { numericValue },
      );
    }
  }
  return numericValue;
}

function locateCatalogItem(
  doc: PolicyOpsDocument,
  itemId: string,
): { item: CatalogItem; index: number } {
  const index = doc.catalog.findIndex((candidate) => candidate.id === itemId);
  if (index < 0) {
    throw new DomainError('NOT_FOUND', 'O item do catálogo informado não existe neste documento.', {
      itemId,
    });
  }
  return { item: doc.catalog[index]!, index };
}

/** Valor anterior de um campo opcional, no formato que o inverso precisa. */
function previous(value: string | undefined): string | null {
  return value === undefined ? null : value;
}

// ---------------------------------------------------------------------------
// catalog/create
// ---------------------------------------------------------------------------

export type CreateCatalogItemInput = {
  kind: CatalogItemKind;
  code: string;
  label: string;
  description?: string;
  color?: string;
  numericValue?: string;
  /** Só faz sentido em kind `TAG`: a faceta do filtro (docs/03 §4). */
  group?: string;
};
export type CreateCatalogItemData = { itemId: string };

/**
 * Cria um item de catálogo com posição = último + 1 dentro do kind.
 * Para kind = 'LIMIT', numericValue é obrigatório e deve ser positivo.
 */
export function createCatalogItem(
  input: CreateCatalogItemInput,
): Command<CreateCatalogItemInput, CreateCatalogItemData> {
  return defineCommand({
    type: 'catalog/create',
    input,
    label: `Criar ${input.kind.toLowerCase()} "${input.code}"`,
    execute(doc, ctx) {
      assertCode(input.code);
      const label = assertText(input.label, 'O rótulo');
      const color = assertColor(input.color);
      const numericValue = assertNumericValue(input.numericValue);

      // Valida: código é único dentro do kind
      if (doc.catalog.some((candidate) => candidate.kind === input.kind && candidate.code === input.code)) {
        throw new DomainError(
          'DUPLICATE_CODE',
          `Já existe um item desse tipo com o código "${input.code}".`,
          { kind: input.kind, code: input.code },
        );
      }

      // Valida: LIMIT exige numericValue
      if (input.kind === 'LIMIT' && !numericValue) {
        throw new DomainError(
          'LIMIT_NEEDS_NUMERIC_VALUE',
          'Limite exige um valor numérico.',
          { kind: input.kind, code: input.code },
        );
      }

      // Calcula position = último + 1 dentro do kind
      const sameKind = doc.catalog.filter((item) => item.kind === input.kind);
      const nextPosition = sameKind.length > 0 ? Math.max(...sameKind.map((item) => item.position)) + 1 : 0;

      const now = isoFrom(ctx.now());
      const itemId = ctx.newId();
      const item: CatalogItem = {
        id: itemId,
        kind: input.kind,
        code: input.code,
        label,
        position: nextPosition,
        createdAt: now,
      };
      if (input.description !== undefined) {
        item.description = assertText(input.description, 'A descrição');
      }
      if (color !== undefined) item.color = color;
      if (numericValue !== undefined) item.numericValue = numericValue;
      // `group` só tem significado em kind TAG (docs/03 §4); em qualquer outro
      // kind o campo é ignorado, em vez de gravado sem sentido.
      if (input.kind === 'TAG' && input.group !== undefined) {
        item.group = assertText(input.group, 'O grupo da tag');
      }

      const event = makeEvent(ctx, {
        type: 'CATALOG_CHANGED',
        scope: {},
        summary: `${ctx.actor} adicionou ${input.kind.toLowerCase()} "${input.code}".`,
        payload: { kind: input.kind, code: input.code },
      });

      return {
        document: applyToDocument(doc, [event], (draft) => {
          draft.catalog.push(item);
        }),
        data: { itemId },
        events: [event],
        inverse: removeCreatedCatalogItem({ itemId, kind: input.kind, code: input.code }),
      };
    },
  });
}

/** Inverso de `catalog/create`: remove item recém-criado. */
function removeCreatedCatalogItem(
  input: { itemId: string; kind: CatalogItemKind; code: string },
): Command<{ itemId: string; kind: CatalogItemKind; code: string }, void> {
  return defineCommand({
    type: 'catalog/_removeCreated',
    input,
    label: `Desfazer criação de ${input.kind.toLowerCase()}`,
    execute(doc) {
      const { item, index } = locateCatalogItem(doc, input.itemId);
      const removed = structuredClone(item);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.catalog.splice(index, 1);
        }),
        data: undefined,
        events: [],
        inverse: restoreCatalogItem({ item: removed, index }),
      };
    },
  });
}

function restoreCatalogItem(
  input: { item: CatalogItem; index: number },
): Command<{ item: CatalogItem; index: number }, void> {
  return defineCommand({
    type: 'catalog/_restore',
    input,
    label: `Refazer criação de ${input.item.kind.toLowerCase()}`,
    execute(doc) {
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.catalog.splice(input.index, 0, structuredClone(input.item));
        }),
        data: undefined,
        events: [],
        inverse: removeCreatedCatalogItem({
          itemId: input.item.id,
          kind: input.item.kind,
          code: input.item.code,
        }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// catalog/update
// ---------------------------------------------------------------------------

export type UpdateCatalogItemInput = {
  id: string;
  label?: string;
  description?: string | null;
  color?: string | null;
  numericValue?: string | null;
};

export function updateCatalogItem(
  input: UpdateCatalogItemInput,
): Command<UpdateCatalogItemInput, void> {
  return defineCommand({
    type: 'catalog/update',
    input,
    label: 'Editar item do catálogo',
    execute(doc, ctx) {
      const { item, index } = locateCatalogItem(doc, input.id);

      // Valida: code e kind são imutáveis
      // (neste caso não há input.code nem input.kind, então não há o que validar)

      const label = input.label === undefined ? undefined : assertText(input.label, 'O rótulo');
      const color = input.color === undefined ? undefined : assertColor(input.color === null ? undefined : input.color);
      const numericValue = input.numericValue === undefined ? undefined : assertNumericValue(input.numericValue === null ? undefined : input.numericValue);

      // Valida: se kind = LIMIT, numericValue não pode ficar nulo
      if (item.kind === 'LIMIT' && input.numericValue === null) {
        throw new DomainError(
          'LIMIT_NEEDS_NUMERIC_VALUE',
          'Limite exige um valor numérico.',
          { itemId: input.id, kind: item.kind },
        );
      }

      const inverse = updateCatalogItem({
        id: item.id,
        label: item.label,
        description: previous(item.description),
        color: previous(item.color),
        numericValue: previous(item.numericValue),
      });

      const event = makeEvent(ctx, {
        type: 'CATALOG_CHANGED',
        scope: {},
        summary: `${ctx.actor} editou ${item.kind.toLowerCase()} "${item.code}".`,
        payload: { kind: item.kind, code: item.code },
      });

      return {
        document: applyToDocument(doc, [event], (draft) => {
          const target = draft.catalog[index]!;
          if (label !== undefined) target.label = label;
          if (input.description !== undefined) {
            if (input.description === null) delete target.description;
            else target.description = assertText(input.description, 'A descrição');
          }
          if (color !== undefined) {
            if (color === undefined) delete target.color;
            else target.color = color;
          }
          if (numericValue !== undefined) {
            if (numericValue === undefined) delete target.numericValue;
            else target.numericValue = numericValue;
          }
        }),
        data: undefined,
        events: [event],
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// catalog/archive
// ---------------------------------------------------------------------------

export type ArchiveCatalogItemInput = { id: string };

export function archiveCatalogItem(
  input: ArchiveCatalogItemInput,
): Command<ArchiveCatalogItemInput, void> {
  return defineCommand({
    type: 'catalog/archive',
    input,
    label: 'Arquivar item do catálogo',
    execute(doc, ctx) {
      const { item, index } = locateCatalogItem(doc, input.id);

      if (item.archivedAt) {
        throw new DomainError(
          'INVALID_INPUT',
          `${item.kind} "${item.code}" já está arquivado.`,
          { itemId: input.id },
        );
      }

      const now = isoFrom(ctx.now());
      const inverse = unarchiveCatalogItem({ id: item.id });

      const event = makeEvent(ctx, {
        type: 'CATALOG_CHANGED',
        scope: {},
        summary: `${ctx.actor} arquivou ${item.kind.toLowerCase()} "${item.code}".`,
        payload: { kind: item.kind, code: item.code },
      });

      return {
        document: applyToDocument(doc, [event], (draft) => {
          draft.catalog[index]!.archivedAt = now;
        }),
        data: undefined,
        events: [event],
        inverse,
      };
    },
  });
}

function unarchiveCatalogItem(input: { id: string }): Command<{ id: string }, void> {
  return defineCommand({
    type: 'catalog/_unarchive',
    input,
    label: 'Restaurar item do catálogo',
    execute(doc, ctx) {
      const { item, index } = locateCatalogItem(doc, input.id);

      if (!item.archivedAt) {
        throw new DomainError(
          'INVALID_INPUT',
          `${item.kind} "${item.code}" não está arquivado.`,
          { itemId: input.id },
        );
      }

      const event = makeEvent(ctx, {
        type: 'CATALOG_CHANGED',
        scope: {},
        summary: `${ctx.actor} restaurou ${item.kind.toLowerCase()} "${item.code}".`,
        payload: { kind: item.kind, code: item.code },
      });

      return {
        document: applyToDocument(doc, [event], (draft) => {
          delete draft.catalog[index]!.archivedAt;
        }),
        data: undefined,
        events: [event],
        inverse: archiveCatalogItem({ id: item.id }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// catalog/reorder
// ---------------------------------------------------------------------------

export type ReorderCatalogInput = { kind: CatalogItemKind; orderedIds: string[] };

export function reorderCatalog(input: ReorderCatalogInput): Command<ReorderCatalogInput, void> {
  return defineCommand({
    type: 'catalog/reorder',
    input,
    label: `Reordenar ${input.kind.toLowerCase()}`,
    execute(doc, ctx) {
      // Coleta todos do kind na ordem atual
      const sameKind = doc.catalog.filter((item) => item.kind === input.kind);
      const sameKindById = new Map(sameKind.map((item) => [item.id, item]));

      // Valida: todos os ids são do kind e existem
      if (input.orderedIds.length !== sameKind.length) {
        throw new DomainError(
          'INVALID_INPUT',
          `Número de itens não bate: esperado ${sameKind.length}, recebido ${input.orderedIds.length}.`,
          { kind: input.kind },
        );
      }
      for (const id of input.orderedIds) {
        if (!sameKindById.has(id)) {
          throw new DomainError(
            'NOT_FOUND',
            `Item ${id} não existe neste tipo.`,
            { kind: input.kind, itemId: id },
          );
        }
      }

      // Guarda a ordem anterior
      const previousOrder = sameKind.map((item) => item.id);

      // Aplica nova ordem de posições
      const event = makeEvent(ctx, {
        type: 'CATALOG_CHANGED',
        scope: {},
        summary: `${ctx.actor} reordenou ${input.kind.toLowerCase()}.`,
        payload: { kind: input.kind },
      });

      return {
        document: applyToDocument(doc, [event], (draft) => {
          for (let i = 0; i < input.orderedIds.length; i++) {
            const item = draft.catalog.find((candidate) => candidate.id === input.orderedIds[i]);
            if (item) item.position = i;
          }
        }),
        data: undefined,
        events: [event],
        inverse: reorderCatalog({ kind: input.kind, orderedIds: previousOrder }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export type CatalogUsage = {
  inPublished: number;
  inDraft: number;
};

export type CatalogItemWithUsage = CatalogItem & { usage: CatalogUsage };

/**
 * Lista itens do catálogo ordenados por position, com contagem de uso
 * separando versões vigentes de rascunhos.
 */
export function listCatalog(
  doc: PolicyOpsDocument,
  options: { kind?: CatalogItemKind; includeArchived?: boolean } = {},
): CatalogItemWithUsage[] {
  let items = doc.catalog;

  // Filtra por kind se especificado
  if (options.kind !== undefined) {
    items = items.filter((item) => item.kind === options.kind);
  }

  // Filtra por arquivo se indicado
  if (!options.includeArchived) {
    items = items.filter((item) => !item.archivedAt);
  }

  // Ordena por position
  items = items.slice().sort((a, b) => a.position - b.position);

  // Calcula uso de cada item
  return items.map((item) => {
    let inPublished = 0;
    let inDraft = 0;

    // Conta quantas células referenciam este item
    for (const matrix of doc.matrices) {
      for (const version of matrix.versions) {
        const isPublished = version.state === 'PUBLISHED';
        for (const cell of Object.values(version.cells)) {
          if (
            (item.kind === 'DECISION' && cell.decision === item.code) ||
            (item.kind === 'OFFER' && cell.offer === item.code) ||
            (item.kind === 'LIMIT' && cell.limit === item.code) ||
            (item.kind === 'TAG' && cell.attrs?.['tag'] === item.code)
          ) {
            if (isPublished) inPublished++;
            else inDraft++;
          }
        }
      }
    }

    return { ...item, usage: { inPublished, inDraft } };
  });
}
