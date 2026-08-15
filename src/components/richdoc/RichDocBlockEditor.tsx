import { ChevronDown, ChevronUp, Columns3, Plus, Rows3, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Block, InlineText } from '@/core/document/schema';
import { InlineEditable } from './InlineEditable';
import { InlineImageView } from './RichDocView';
import {
  BLOCK_TYPE_LABELS,
  INSERTABLE_BLOCK_TYPES,
  lineKeyOf,
  type BlockEditorHandlers,
} from './block-types';

/**
 * Um bloco em edição — docs/07-ux-e-editor.md §18.
 *
 * Texto, título, citação e destaque são uma linha editável; lista é **uma
 * linha por item**; tabela é uma grade de campos comuns (`<input>`), porque
 * célula de tabela é texto puro no modelo (docs/03 §12.3) e um
 * `contentEditable` ali só traria problema sem trazer recurso; imagem é um
 * anexo com legenda.
 */

const LINE_CLASS =
  'min-h-[1.5rem] w-full rounded-sm px-1 py-0.5 text-sm text-neutral-800 outline-none focus:bg-neutral-50 focus:ring-1 focus:ring-neutral-300 empty:before:text-neutral-400 empty:before:content-[attr(data-placeholder)] dark:text-neutral-200 dark:focus:bg-neutral-900 dark:focus:ring-neutral-700';

const TYPE_CLASS: Record<string, string> = {
  paragraph: '',
  heading1: 'text-base font-semibold',
  heading2: 'text-sm font-semibold',
  quote: 'border-l-2 border-neutral-300 pl-2 italic text-neutral-600 dark:border-neutral-700 dark:text-neutral-400',
  callout:
    'rounded-md border border-amber-200 bg-amber-50 px-2 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100',
};

export function RichDocBlockEditor({
  block,
  index,
  total,
  handlers,
}: {
  block: Block;
  index: number;
  total: number;
  handlers: BlockEditorHandlers;
}) {
  const { editable } = handlers;

  return (
    <div className="group relative flex items-start gap-1" data-block-id={block.id}>
      <div className="min-w-0 flex-1">{renderBlock(block, handlers)}</div>
      {editable && (
        <BlockControls block={block} index={index} total={total} handlers={handlers} />
      )}
    </div>
  );
}

function renderBlock(block: Block, handlers: BlockEditorHandlers) {
  switch (block.type) {
    case 'bulletList':
    case 'numberList':
      return <ListBlockEditor block={block} handlers={handlers} />;
    case 'table':
      return <TableBlockEditor block={block} handlers={handlers} />;
    case 'image':
      return <ImageBlockEditor block={block} handlers={handlers} />;
    default:
      return (
        <InlineEditable
          value={block.text}
          editable={handlers.editable}
          placeholder={block.type === 'paragraph' ? 'Escreva aqui — "/" insere um bloco' : BLOCK_TYPE_LABELS[block.type]}
          ariaLabel={`${BLOCK_TYPE_LABELS[block.type] ?? 'Bloco'} da especificação`}
          className={`${LINE_CLASS} ${TYPE_CLASS[block.type] ?? ''}`}
          lineKey={lineKeyOf(block.id, null)}
          registerLine={handlers.registerLine}
          onInput={(next) => handlers.onLineInput(block.id, null, next)}
          onKeyDown={(event, context) => handlers.onLineKeyDown(block.id, null, event, context)}
          onSelectionChange={(selection) => handlers.onSelectionChange(block.id, null, selection)}
        />
      );
  }
}

function ListBlockEditor({
  block,
  handlers,
}: {
  block: Extract<Block, { items: InlineText[] }>;
  handlers: BlockEditorHandlers;
}) {
  const marker = block.type === 'bulletList' ? 'list-disc' : 'list-decimal';
  const List = block.type === 'bulletList' ? 'ul' : 'ol';
  return (
    <List className={`ml-5 flex flex-col ${marker}`}>
      {block.items.map((item, itemIndex) => (
        <li key={itemIndex} className="text-sm">
          <InlineEditable
            value={item}
            editable={handlers.editable}
            placeholder="Item"
            ariaLabel={`Item ${itemIndex + 1} da lista`}
            className={LINE_CLASS}
            lineKey={lineKeyOf(block.id, itemIndex)}
            registerLine={handlers.registerLine}
            onInput={(next) => handlers.onLineInput(block.id, itemIndex, next)}
            onKeyDown={(event, context) => handlers.onLineKeyDown(block.id, itemIndex, event, context)}
            onSelectionChange={(selection) => handlers.onSelectionChange(block.id, itemIndex, selection)}
          />
        </li>
      ))}
    </List>
  );
}

function TableBlockEditor({
  block,
  handlers,
}: {
  block: Extract<Block, { type: 'table' }>;
  handlers: BlockEditorHandlers;
}) {
  const { editable } = handlers;
  return (
    <div className="flex flex-col gap-1">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {block.header.map((cell, column) => (
                <th key={column} className="border border-neutral-200 p-0 dark:border-neutral-800">
                  <input
                    value={cell}
                    disabled={!editable}
                    aria-label={`Cabeçalho da coluna ${column + 1}`}
                    onChange={(event) => handlers.onTableCell(block.id, -1, column, event.target.value)}
                    className="w-full bg-neutral-50 px-2 py-1 font-semibold outline-none dark:bg-neutral-900"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, column) => (
                  <td key={column} className="border border-neutral-200 p-0 dark:border-neutral-800">
                    <input
                      value={cell}
                      disabled={!editable}
                      aria-label={`Linha ${rowIndex + 1}, coluna ${column + 1}`}
                      onChange={(event) => handlers.onTableCell(block.id, rowIndex, column, event.target.value)}
                      className="w-full bg-transparent px-2 py-1 outline-none"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => handlers.onTableStructure(block.id, 'addRow')}>
            <Rows3 className="mr-1 h-3 w-3" /> Linha
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handlers.onTableStructure(block.id, 'removeRow', block.rows.length - 1)}
          >
            Remover linha
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handlers.onTableStructure(block.id, 'addColumn')}
          >
            <Columns3 className="mr-1 h-3 w-3" /> Coluna
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handlers.onTableStructure(block.id, 'removeColumn', block.header.length - 1)}
          >
            Remover coluna
          </Button>
        </div>
      )}
    </div>
  );
}

function ImageBlockEditor({
  block,
  handlers,
}: {
  block: Extract<Block, { type: 'image' }>;
  handlers: BlockEditorHandlers;
}) {
  return (
    <div className="flex flex-col gap-1">
      <InlineImageView attachmentId={block.attachmentId} caption={block.caption} />
      {handlers.editable && (
        <Input
          value={block.caption ?? ''}
          aria-label="Legenda da imagem"
          placeholder="Legenda (opcional)"
          onChange={(event) => handlers.onCaption(block.id, event.target.value)}
        />
      )}
    </div>
  );
}

function BlockControls({
  block,
  index,
  total,
  handlers,
}: {
  block: Block;
  index: number;
  total: number;
  handlers: BlockEditorHandlers;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <DropdownMenu
        open={handlers.insertMenuFor === block.id}
        onOpenChange={(open) => handlers.onInsertMenuOpenChange(block.id, open)}
      >
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" aria-label={`Inserir bloco depois de ${index + 1}`} className="h-6 w-6 p-0">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {INSERTABLE_BLOCK_TYPES.map((type) => (
            <DropdownMenuItem key={type} onSelect={() => handlers.onInsertBelow(block.id, type)}>
              {BLOCK_TYPE_LABELS[type]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Mover bloco ${index + 1} para cima`}
        disabled={index === 0}
        className="h-6 w-6 p-0"
        onClick={() => handlers.onMove(block.id, -1)}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Mover bloco ${index + 1} para baixo`}
        disabled={index === total - 1}
        className="h-6 w-6 p-0"
        onClick={() => handlers.onMove(block.id, 1)}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Remover bloco ${index + 1}`}
        className="h-6 w-6 p-0"
        onClick={() => handlers.onRemove(block.id)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
