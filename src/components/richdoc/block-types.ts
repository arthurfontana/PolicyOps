import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { InlineText } from '@/core/document/schema';
import type { LineKeyboardContext } from './InlineEditable';
import type { InlineSelection } from './inline-dom';

/**
 * Vocabulário do editor de blocos — rótulos, tipos inseríveis e o contrato de
 * gestos entre `RichDocEditor` e `RichDocBlockEditor` (docs/07 §18).
 *
 * Fica num módulo próprio porque são constantes e tipos, não componentes: no
 * mesmo arquivo dos componentes, o Fast Refresh do Vite deixa de funcionar.
 */

export const BLOCK_TYPE_LABELS: Record<string, string> = {
  paragraph: 'Parágrafo',
  heading1: 'Título 1',
  heading2: 'Título 2',
  quote: 'Citação',
  callout: 'Destaque',
  bulletList: 'Lista com marcadores',
  numberList: 'Lista numerada',
  table: 'Tabela',
  image: 'Imagem',
};

export type InsertableBlockType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'quote'
  | 'callout'
  | 'bulletList'
  | 'numberList'
  | 'table'
  | 'image';

export const INSERTABLE_BLOCK_TYPES: InsertableBlockType[] = [
  'paragraph',
  'heading1',
  'heading2',
  'quote',
  'callout',
  'bulletList',
  'numberList',
  'table',
  'image',
];

/** Identidade da linha editável: o bloco, ou o bloco e o item da lista. */
export function lineKeyOf(blockId: string, itemIndex: number | null): string {
  return itemIndex === null ? blockId : `${blockId}#${itemIndex}`;
}

export type BlockEditorHandlers = {
  editable: boolean;
  registerLine: (key: string, element: HTMLElement | null) => void;
  onLineInput: (blockId: string, itemIndex: number | null, next: InlineText) => void;
  onLineKeyDown: (
    blockId: string,
    itemIndex: number | null,
    event: ReactKeyboardEvent<HTMLDivElement>,
    context: LineKeyboardContext,
  ) => void;
  onSelectionChange: (blockId: string, itemIndex: number | null, selection: InlineSelection | null) => void;
  onTableCell: (blockId: string, row: number, column: number, value: string) => void;
  onTableStructure: (
    blockId: string,
    action: 'addRow' | 'removeRow' | 'addColumn' | 'removeColumn',
    at?: number,
  ) => void;
  onCaption: (blockId: string, caption: string) => void;
  onMove: (blockId: string, delta: number) => void;
  onRemove: (blockId: string) => void;
  onInsertBelow: (blockId: string, type: InsertableBlockType) => void;
  /** Menu "/" aberto neste bloco (a barra digitada numa linha vazia). */
  insertMenuFor: string | null;
  onInsertMenuOpenChange: (blockId: string, open: boolean) => void;
};
