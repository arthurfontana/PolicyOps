import type { Block, InlineMark, InlineText, RichDoc, TextBlockType } from '../document/schema';
import { DomainError } from '../errors';
import {
  blockPlainText,
  findBlockIndex,
  isListBlock,
  isTextBlock,
  listBlock,
  sameBlockContent,
  tableBlock,
  textBlock,
  type NewId,
} from './model';
import { concatInline, inlineLength, normalizeInline, sliceInline, toggleMarkInline } from './text';

/**
 * Operações de bloco — o coração do editor rico (docs/14 §7, S34).
 *
 * Tudo aqui é `RichDoc → RichDoc` **com inverso**: `applyOp` devolve o
 * documento novo e a operação que o desfaz exatamente. É o que permite que
 * `./commands.ts` embrulhe qualquer edição num `Command` da pilha de undo
 * (docs/08 §1, regra 3) sem guardar snapshots do documento inteiro.
 *
 * São cinco primitivas — inserir, remover, mover, substituir e emendar (o
 * `splice`, que cobre dividir, fundir e colar) — e um punhado de **intenções**
 * (`splitBlockAt`, `mergeBlockBackward`, `transformBlockTo`, …) que traduzem
 * um gesto da interface na primitiva certa. A interface nunca monta uma
 * primitiva na mão: ela descreve o gesto, e a decisão de conteúdo fica aqui,
 * em TypeScript puro e testável (regra 4).
 */

// ---------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------
// #region: primitivas

export type RichDocOp =
  | { kind: 'insertBlock'; index: number; block: Block }
  | { kind: 'removeBlock'; blockId: string }
  | { kind: 'moveBlock'; blockId: string; toIndex: number }
  | { kind: 'replaceBlock'; block: Block }
  /** Emenda: substitui `count` blocos a partir de `index` por `blocks`. */
  | { kind: 'spliceBlocks'; index: number; count: number; blocks: Block[] };

export type AppliedOp = { doc: RichDoc; inverse: RichDocOp };

function notFound(blockId: string): DomainError {
  return new DomainError('NOT_FOUND', 'O bloco informado não existe nesta especificação.', { blockId });
}

function locate(doc: RichDoc, blockId: string): { block: Block; index: number } {
  const index = findBlockIndex(doc, blockId);
  if (index < 0) throw notFound(blockId);
  return { block: doc.blocks[index]!, index };
}

function assertIndex(doc: RichDoc, index: number, max: number): void {
  if (!Number.isInteger(index) || index < 0 || index > max) {
    throw new DomainError('INVALID_INPUT', `Posição de bloco inválida: ${index}.`, {
      index,
      blocks: doc.blocks.length,
    });
  }
}

export function applyOp(doc: RichDoc, op: RichDocOp): AppliedOp {
  switch (op.kind) {
    case 'insertBlock': {
      assertIndex(doc, op.index, doc.blocks.length);
      if (findBlockIndex(doc, op.block.id) >= 0) {
        throw new DomainError('INVALID_INPUT', 'Já existe um bloco com este id na especificação.', {
          blockId: op.block.id,
        });
      }
      const blocks = [...doc.blocks];
      blocks.splice(op.index, 0, structuredClone(op.block));
      return { doc: { blocks }, inverse: { kind: 'removeBlock', blockId: op.block.id } };
    }
    case 'removeBlock': {
      const { block, index } = locate(doc, op.blockId);
      const blocks = [...doc.blocks];
      blocks.splice(index, 1);
      return { doc: { blocks }, inverse: { kind: 'insertBlock', index, block: structuredClone(block) } };
    }
    case 'moveBlock': {
      const { index } = locate(doc, op.blockId);
      assertIndex(doc, op.toIndex, doc.blocks.length - 1);
      const blocks = [...doc.blocks];
      const [moved] = blocks.splice(index, 1);
      blocks.splice(op.toIndex, 0, moved!);
      return { doc: { blocks }, inverse: { kind: 'moveBlock', blockId: op.blockId, toIndex: index } };
    }
    case 'replaceBlock': {
      const { block, index } = locate(doc, op.block.id);
      if (block.type !== op.block.type && !canRetype(block, op.block)) {
        // Trocar o tipo mantendo o id é legítimo (parágrafo → título), mas só
        // entre tipos que carregam o mesmo conteúdo; virar imagem ou tabela
        // passa por `transformBlockTo`, que reescreve o conteúdo.
        throw new DomainError('INVALID_INPUT', 'Este bloco não pode virar o tipo informado sem converter o conteúdo.', {
          blockId: op.block.id,
          from: block.type,
          to: op.block.type,
        });
      }
      const blocks = [...doc.blocks];
      blocks[index] = structuredClone(op.block);
      return { doc: { blocks }, inverse: { kind: 'replaceBlock', block: structuredClone(block) } };
    }
    case 'spliceBlocks': {
      assertIndex(doc, op.index, doc.blocks.length);
      if (!Number.isInteger(op.count) || op.count < 0 || op.index + op.count > doc.blocks.length) {
        throw new DomainError('INVALID_INPUT', 'Faixa de blocos inválida para esta emenda.', {
          index: op.index,
          count: op.count,
          blocks: doc.blocks.length,
        });
      }
      const blocks = [...doc.blocks];
      const removed = blocks.splice(op.index, op.count, ...structuredClone(op.blocks));
      return {
        doc: { blocks },
        inverse: { kind: 'spliceBlocks', index: op.index, count: op.blocks.length, blocks: removed },
      };
    }
  }
}

/** Troca de tipo permitida em `replaceBlock`: dentro de texto, ou dentro de lista. */
function canRetype(from: Block, to: Block): boolean {
  return (isTextBlock(from) && isTextBlock(to)) || (isListBlock(from) && isListBlock(to));
}

/** Aplica uma sequência, devolvendo o inverso já na ordem contrária. */
export function applyOps(doc: RichDoc, ops: readonly RichDocOp[]): { doc: RichDoc; inverses: RichDocOp[] } {
  let current = doc;
  const inverses: RichDocOp[] = [];
  for (const op of ops) {
    const applied = applyOp(current, op);
    current = applied.doc;
    inverses.unshift(applied.inverse);
  }
  return { doc: current, inverses };
}

// ---------------------------------------------------------------------------
// Intenções — o gesto da interface virando primitiva
// ---------------------------------------------------------------------------
// #region: intencoes

/** Edição de texto de um bloco de texto (digitação, marcas). */
export function setBlockInlineText(doc: RichDoc, blockId: string, text: InlineText): RichDocOp | null {
  const { block } = locate(doc, blockId);
  if (!isTextBlock(block)) {
    throw new DomainError('INVALID_INPUT', 'Este bloco não tem texto simples para editar.', { blockId });
  }
  const next = textBlock(block.id, block.type, text);
  return sameBlockContent(block, next) ? null : { kind: 'replaceBlock', block: next };
}

export function setListItemText(
  doc: RichDoc,
  blockId: string,
  itemIndex: number,
  text: InlineText,
): RichDocOp | null {
  const { block } = locate(doc, blockId);
  if (!isListBlock(block)) {
    throw new DomainError('INVALID_INPUT', 'Este bloco não é uma lista.', { blockId });
  }
  if (itemIndex < 0 || itemIndex >= block.items.length) {
    throw new DomainError('INVALID_INPUT', `A lista não tem o item ${itemIndex}.`, { blockId, itemIndex });
  }
  const items = block.items.map((item, index) => (index === itemIndex ? normalizeInline(text) : item));
  const next = listBlock(block.id, block.type, items);
  return sameBlockContent(block, next) ? null : { kind: 'replaceBlock', block: next };
}

export function setTableCell(
  doc: RichDoc,
  blockId: string,
  row: number,
  column: number,
  value: string,
): RichDocOp | null {
  const table = locateTable(doc, blockId);
  if (column < 0 || column >= table.header.length) {
    throw new DomainError('INVALID_INPUT', `A tabela não tem a coluna ${column}.`, { blockId, column });
  }
  // `row === -1` é o cabeçalho: uma coordenada só para as duas faixas evita
  // duplicar a operação (e o inverso) entre cabeçalho e corpo.
  if (row < -1 || row >= table.rows.length) {
    throw new DomainError('INVALID_INPUT', `A tabela não tem a linha ${row}.`, { blockId, row });
  }
  const header = row === -1 ? table.header.map((cell, index) => (index === column ? value : cell)) : table.header;
  const rows =
    row === -1
      ? table.rows
      : table.rows.map((current, index) =>
          index === row ? current.map((cell, cellIndex) => (cellIndex === column ? value : cell)) : current,
        );
  const next = tableBlock(table.id, header, rows);
  return sameBlockContent(table, next) ? null : { kind: 'replaceBlock', block: next };
}

export function setImageCaption(doc: RichDoc, blockId: string, caption: string): RichDocOp | null {
  const { block } = locate(doc, blockId);
  if (block.type !== 'image') {
    throw new DomainError('INVALID_INPUT', 'Este bloco não é uma imagem.', { blockId });
  }
  const trimmed = caption.trim();
  const next: Block = { id: block.id, type: 'image', attachmentId: block.attachmentId };
  if (trimmed.length > 0) next.caption = trimmed;
  return sameBlockContent(block, next) ? null : { kind: 'replaceBlock', block: next };
}

/**
 * Marca (negrito, itálico, código, link) num intervalo de offsets de texto
 * plano. `itemIndex` seleciona o item quando o bloco é lista.
 */
export function toggleMark(
  doc: RichDoc,
  input: {
    blockId: string;
    itemIndex?: number;
    start: number;
    end: number;
    mark: InlineMark;
    href?: string;
  },
): RichDocOp | null {
  const { block } = locate(doc, input.blockId);
  if (isListBlock(block)) {
    const itemIndex = input.itemIndex ?? 0;
    const item = block.items[itemIndex];
    if (item === undefined) {
      throw new DomainError('INVALID_INPUT', `A lista não tem o item ${itemIndex}.`, { blockId: block.id });
    }
    return setListItemText(
      doc,
      block.id,
      itemIndex,
      toggleMarkInline(item, input.start, input.end, input.mark, input.href),
    );
  }
  if (!isTextBlock(block)) {
    throw new DomainError('INVALID_INPUT', 'Este bloco não aceita marcas de texto.', { blockId: block.id });
  }
  return setBlockInlineText(
    doc,
    block.id,
    toggleMarkInline(block.text, input.start, input.end, input.mark, input.href),
  );
}

/**
 * Enter. Num bloco de texto, divide em dois; num item de lista, divide o item.
 * Dividir um título produz um **parágrafo** na segunda metade — continuar
 * digitando título depois de dar Enter é o que ninguém quer.
 */
export function splitBlockAt(
  doc: RichDoc,
  input: { blockId: string; offset: number; itemIndex?: number },
  newId: NewId,
): RichDocOp {
  const { block, index } = locate(doc, input.blockId);

  if (isListBlock(block)) {
    const itemIndex = input.itemIndex ?? 0;
    const item = block.items[itemIndex];
    if (item === undefined) {
      throw new DomainError('INVALID_INPUT', `A lista não tem o item ${itemIndex}.`, { blockId: block.id });
    }
    const head = sliceInline(item, 0, input.offset);
    const tail = sliceInline(item, input.offset, inlineLength(item));
    const items = [...block.items.slice(0, itemIndex), head, tail, ...block.items.slice(itemIndex + 1)];
    return { kind: 'replaceBlock', block: listBlock(block.id, block.type, items) };
  }

  if (!isTextBlock(block)) {
    // Tabela e imagem não se dividem: Enter cria um parágrafo depois delas.
    return { kind: 'insertBlock', index: index + 1, block: textBlock(newId(), 'paragraph', []) };
  }

  const head = sliceInline(block.text, 0, input.offset);
  const tail = sliceInline(block.text, input.offset, inlineLength(block.text));
  const tailType: TextBlockType = block.type === 'heading1' || block.type === 'heading2' ? 'paragraph' : block.type;
  return {
    kind: 'spliceBlocks',
    index,
    count: 1,
    blocks: [textBlock(block.id, block.type, head), textBlock(newId(), tailType, tail)],
  };
}

/**
 * Backspace no início. A regra é a de qualquer editor, com as bordas
 * explicitadas:
 *
 * - item de lista que não é o primeiro: funde com o item anterior;
 * - primeiro item da lista: vira um parágrafo antes do resto da lista;
 * - bloco de texto que não é parágrafo: vira parágrafo (o Backspace "tira o
 *   formato" antes de fundir — senão não haveria como desfazer um título sem
 *   apagar o texto);
 * - parágrafo depois de outro bloco de texto: funde com ele;
 * - qualquer outro caso (primeiro bloco, ou anterior é tabela/imagem): `null`,
 *   e a interface não faz nada.
 */
export function mergeBlockBackward(
  doc: RichDoc,
  input: { blockId: string; itemIndex?: number },
  newId: NewId,
): RichDocOp | null {
  const { block, index } = locate(doc, input.blockId);

  if (isListBlock(block)) {
    const itemIndex = input.itemIndex ?? 0;
    const item = block.items[itemIndex];
    if (item === undefined) return null;
    if (itemIndex > 0) {
      const previous = block.items[itemIndex - 1]!;
      const items = [
        ...block.items.slice(0, itemIndex - 1),
        concatInline(previous, item),
        ...block.items.slice(itemIndex + 1),
      ];
      return { kind: 'replaceBlock', block: listBlock(block.id, block.type, items) };
    }
    const rest = block.items.slice(1);
    const blocks: Block[] = [textBlock(newId(), 'paragraph', item)];
    if (rest.length > 0) blocks.push(listBlock(block.id, block.type, rest));
    return { kind: 'spliceBlocks', index, count: 1, blocks };
  }

  if (!isTextBlock(block)) return null;

  if (block.type !== 'paragraph') {
    return { kind: 'replaceBlock', block: textBlock(block.id, 'paragraph', block.text) };
  }

  const previous = index > 0 ? doc.blocks[index - 1]! : undefined;
  if (previous === undefined) return null;

  if (isTextBlock(previous)) {
    return {
      kind: 'spliceBlocks',
      index: index - 1,
      count: 2,
      blocks: [textBlock(previous.id, previous.type, concatInline(previous.text, block.text))],
    };
  }
  if (isListBlock(previous) && previous.items.length > 0) {
    const items = [...previous.items];
    items[items.length - 1] = concatInline(items[items.length - 1]!, block.text);
    return { kind: 'spliceBlocks', index: index - 1, count: 2, blocks: [listBlock(previous.id, previous.type, items)] };
  }
  return null;
}

/**
 * Troca de tipo pelo menu. Texto ↔ texto mantém o `id` (é o mesmo bloco com
 * outro formato); lista → texto vira **um bloco por item** e texto → lista
 * vira uma lista de um item só — os dois casos reescrevem a estrutura, então o
 * id novo é honesto: o diff mostra um bloco que saiu e outros que entraram.
 */
export function transformBlockTo(
  doc: RichDoc,
  input: { blockId: string; type: TextBlockType | 'bulletList' | 'numberList' },
  newId: NewId,
): RichDocOp | null {
  const { block, index } = locate(doc, input.blockId);
  if (block.type === input.type) return null;

  if (block.type === 'table' || block.type === 'image') {
    throw new DomainError('INVALID_INPUT', 'Tabela e imagem não se convertem em texto — remova o bloco e insira outro.', {
      blockId: block.id,
    });
  }

  const targetIsList = input.type === 'bulletList' || input.type === 'numberList';

  if (isListBlock(block)) {
    if (targetIsList) {
      return { kind: 'replaceBlock', block: listBlock(block.id, input.type as 'bulletList' | 'numberList', block.items) };
    }
    const blocks = block.items.map((item) => textBlock(newId(), input.type as TextBlockType, item));
    if (blocks.length === 0) blocks.push(textBlock(newId(), input.type as TextBlockType, []));
    return { kind: 'spliceBlocks', index, count: 1, blocks };
  }

  if (targetIsList) {
    return {
      kind: 'spliceBlocks',
      index,
      count: 1,
      blocks: [listBlock(newId(), input.type as 'bulletList' | 'numberList', [block.text])],
    };
  }
  return { kind: 'replaceBlock', block: textBlock(block.id, input.type as TextBlockType, block.text) };
}

/** Move um bloco uma posição para cima/baixo (as setas do menu do bloco). */
export function moveBlockBy(doc: RichDoc, blockId: string, delta: number): RichDocOp | null {
  const { index } = locate(doc, blockId);
  const target = index + delta;
  if (target < 0 || target >= doc.blocks.length) return null;
  return { kind: 'moveBlock', blockId, toIndex: target };
}

/**
 * Colar. Os blocos vêm já sanitizados de `./paste.ts`; o que se decide aqui é
 * **onde** eles entram: no lugar do bloco corrente quando ele está vazio (o
 * caso comum de colar num parágrafo em branco), logo depois dele caso
 * contrário. Nunca em cima de conteúdo digitado — colar não apaga texto.
 */
export function pasteBlocksAt(doc: RichDoc, blockId: string | null, blocks: readonly Block[]): RichDocOp | null {
  if (blocks.length === 0) return null;
  if (blockId === null) {
    return { kind: 'spliceBlocks', index: doc.blocks.length, count: 0, blocks: [...blocks] };
  }
  const { block, index } = locate(doc, blockId);
  const replacesCurrent = blockPlainText(block).length === 0 && block.type !== 'image';
  return {
    kind: 'spliceBlocks',
    index: replacesCurrent ? index : index + 1,
    count: replacesCurrent ? 1 : 0,
    blocks: [...blocks],
  };
}

// ---------------------------------------------------------------------------
// Tabela — estrutura
// ---------------------------------------------------------------------------
// #region: tabela-estrutura

function locateTable(doc: RichDoc, blockId: string): Extract<Block, { type: 'table' }> {
  const { block } = locate(doc, blockId);
  if (block.type !== 'table') {
    throw new DomainError('INVALID_INPUT', 'Este bloco não é uma tabela.', { blockId });
  }
  return block;
}

export function insertTableRow(doc: RichDoc, blockId: string, at?: number): RichDocOp {
  const table = locateTable(doc, blockId);
  const index = at ?? table.rows.length;
  const rows = [...table.rows];
  rows.splice(Math.max(0, Math.min(rows.length, index)), 0, table.header.map(() => ''));
  return { kind: 'replaceBlock', block: tableBlock(table.id, table.header, rows) };
}

export function removeTableRow(doc: RichDoc, blockId: string, at: number): RichDocOp | null {
  const table = locateTable(doc, blockId);
  if (at < 0 || at >= table.rows.length) return null;
  const rows = table.rows.filter((_, index) => index !== at);
  return { kind: 'replaceBlock', block: tableBlock(table.id, table.header, rows) };
}

export function insertTableColumn(doc: RichDoc, blockId: string, at?: number): RichDocOp {
  const table = locateTable(doc, blockId);
  const index = Math.max(0, Math.min(table.header.length, at ?? table.header.length));
  const header = [...table.header];
  header.splice(index, 0, '');
  const rows = table.rows.map((row) => {
    const next = [...row];
    next.splice(index, 0, '');
    return next;
  });
  return { kind: 'replaceBlock', block: tableBlock(table.id, header, rows) };
}

export function removeTableColumn(doc: RichDoc, blockId: string, at: number): RichDocOp | null {
  const table = locateTable(doc, blockId);
  // Uma tabela sem coluna nenhuma não é representável na interface.
  if (table.header.length <= 1 || at < 0 || at >= table.header.length) return null;
  const header = table.header.filter((_, index) => index !== at);
  const rows = table.rows.map((row) => row.filter((_, index) => index !== at));
  return { kind: 'replaceBlock', block: tableBlock(table.id, header, rows) };
}

/** Bloco de tabela vazio do menu de inserção: 2×2 com cabeçalho. */
export function emptyTable(newId: NewId, columns = 2, rows = 2): Block {
  return tableBlock(
    newId(),
    Array.from({ length: columns }, () => ''),
    Array.from({ length: rows }, () => Array.from({ length: columns }, () => '')),
  );
}
