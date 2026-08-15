import type { Block, InlineText, RichDoc, TextBlockType } from '../document/schema';
import { inlineFromText, normalizeInline, plainTextOf } from './text';

/**
 * Construtores e predicados de bloco — docs/03-modelo-do-documento.md §12.3.
 *
 * O `id` do bloco é estável e nunca é reaproveitado: é ele que torna o diff um
 * diff **por bloco** (`./diff.ts`) e o que permite a coalescência de digitação
 * reconhecer "ainda é o mesmo bloco" (`./commands.ts`). Todo construtor recebe
 * o gerador de id de fora (`Ctx.newId`) — `src/core/` não sorteia nada
 * (docs/08 §1, regra 1).
 */

export type NewId = () => string;

/** Bloco sem `id`: o que o colar e os menus produzem antes de o comando carimbar. */
export type BlockDraft =
  | { type: TextBlockType; text: InlineText }
  | { type: 'bulletList' | 'numberList'; items: InlineText[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'image'; attachmentId: string; caption?: string };

export const TEXT_BLOCK_TYPES: readonly TextBlockType[] = [
  'paragraph',
  'heading1',
  'heading2',
  'quote',
  'callout',
];

export function isTextBlock(block: Block): block is Extract<Block, { text: InlineText }> {
  return 'text' in block;
}

export function isListBlock(block: Block): block is Extract<Block, { items: InlineText[] }> {
  return block.type === 'bulletList' || block.type === 'numberList';
}

export function emptyRichDoc(): RichDoc {
  return { blocks: [] };
}

/** Documento com um parágrafo vazio — o estado inicial de um editor em branco. */
export function richDocWithEmptyParagraph(newId: NewId): RichDoc {
  return { blocks: [textBlock(newId(), 'paragraph', [])] };
}

export function textBlock(id: string, type: TextBlockType, text: InlineText): Block {
  return { id, type, text: normalizeInline(text) };
}

export function paragraphFromText(id: string, text: string): Block {
  return { id, type: 'paragraph', text: inlineFromText(text) };
}

export function listBlock(id: string, type: 'bulletList' | 'numberList', items: InlineText[]): Block {
  return { id, type, items: items.map(normalizeInline) };
}

export function tableBlock(id: string, header: string[], rows: string[][]): Block {
  return { id, type: 'table', header: [...header], rows: rows.map((row) => [...row]) };
}

export function imageBlock(id: string, attachmentId: string, caption?: string): Block {
  const block: Block = { id, type: 'image', attachmentId };
  if (caption !== undefined && caption.length > 0) block.caption = caption;
  return block;
}

/** Carimba o id nos blocos vindos do colar/menus, na ordem em que chegaram. */
export function materializeBlocks(drafts: readonly BlockDraft[], newId: NewId): Block[] {
  return drafts.map((draft) => {
    switch (draft.type) {
      case 'bulletList':
      case 'numberList':
        return listBlock(newId(), draft.type, draft.items);
      case 'table':
        return tableBlock(newId(), draft.header, draft.rows);
      case 'image':
        return imageBlock(newId(), draft.attachmentId, draft.caption);
      default:
        return textBlock(newId(), draft.type, draft.text);
    }
  });
}

/** Texto plano do bloco — usado no resumo do diff e nos rótulos de comando. */
export function blockPlainText(block: Block): string {
  switch (block.type) {
    case 'bulletList':
    case 'numberList':
      return block.items.map(plainTextOf).join('\n');
    case 'table':
      return [block.header, ...block.rows].map((row) => row.join('\t')).join('\n');
    case 'image':
      return block.caption ?? '';
    default:
      return plainTextOf(block.text);
  }
}

export function isBlockEmpty(block: Block): boolean {
  if (block.type === 'image') return false;
  return blockPlainText(block).trim().length === 0;
}

/**
 * Chave estrutural do **conteúdo** do bloco (sem o `id`). É o que o diff
 * compara para decidir "alterado" e o que a coalescência usa para saber se a
 * digitação mudou alguma coisa. Ordem de chaves fixa, como em
 * `document/serialize.ts` — comparação por string exige forma canônica.
 */
export function blockContentKey(block: Block): string {
  switch (block.type) {
    case 'bulletList':
    case 'numberList':
      return JSON.stringify([block.type, block.items.map(normalizeInline)]);
    case 'table':
      return JSON.stringify([block.type, block.header, block.rows]);
    case 'image':
      return JSON.stringify([block.type, block.attachmentId, block.caption ?? null]);
    default:
      return JSON.stringify([block.type, normalizeInline(block.text)]);
  }
}

export function sameBlockContent(a: Block, b: Block): boolean {
  return blockContentKey(a) === blockContentKey(b);
}

export function findBlockIndex(doc: RichDoc, blockId: string): number {
  return doc.blocks.findIndex((block) => block.id === blockId);
}

/** Todos os `attachmentId` referenciados por um `RichDoc` (blocos `image`). */
export function referencedAttachmentIds(doc: RichDoc): string[] {
  return doc.blocks.filter((block) => block.type === 'image').map((block) => block.attachmentId);
}
