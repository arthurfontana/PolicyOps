import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { nanoid } from 'nanoid';
import { Bold, Code, Italic, Link2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import type { Block, InlineMark, RichDoc } from '@/core/document/schema';
import { isDomainError } from '@/core/errors';
import { warnsOnInlineImageTotal } from '@/core/richdoc/attachments';
import {
  applyRichDocOp,
  insertRichDocImage,
  removeRichDocBlock,
  typingCoalesceKey,
  type RichDocTarget,
} from '@/core/richdoc/commands';
import { isBlockEmpty, isListBlock, isTextBlock, listBlock, textBlock } from '@/core/richdoc/model';
import {
  emptyTable,
  insertTableColumn,
  insertTableRow,
  mergeBlockBackward,
  moveBlockBy,
  pasteBlocksAt,
  removeTableColumn,
  removeTableRow,
  setBlockInlineText,
  setImageCaption,
  setListItemText,
  setTableCell,
  splitBlockAt,
  toggleMark,
  transformBlockTo,
  type RichDocOp,
} from '@/core/richdoc/operations';
import { blocksFromClipboard } from '@/core/richdoc/paste';
import { materializeBlocks } from '@/core/richdoc/model';
import { inlineLength, insertTextInline, plainTextOf } from '@/core/richdoc/text';
import { prepareInlineImage } from '@/lib/image';
import { useDocumentStore } from '@/store/document-store';
import { caretOffsetIn, setCaret, type InlineSelection } from './inline-dom';
import { RichDocBlockEditor } from './RichDocBlockEditor';
import {
  BLOCK_TYPE_LABELS,
  INSERTABLE_BLOCK_TYPES,
  lineKeyOf,
  type BlockEditorHandlers,
  type InsertableBlockType,
} from './block-types';
import { RichDocView } from './RichDocView';

/**
 * Editor rico de especificação — docs/07-ux-e-editor.md §18,
 * docs/14-governanca-de-alteracoes.md §7 (S34).
 *
 * O editor não guarda estado de conteúdo: **cada tecla vira comando**
 * (`richdoc/apply`) e o documento do store é a única fonte de verdade. É o que
 * garante o critério de aceite mais importante da sessão — nada do que foi
 * digitado se perde, porque nada fica pendurado num `useState` esperando um
 * "salvar". A digitação não vira cem entradas de undo por causa da
 * coalescência (`coalesceKey`, docs/08 §2): um Ctrl+Z desfaz o parágrafo
 * inteiro.
 *
 * As decisões de conteúdo (dividir, fundir, transformar, colar) moram em
 * `src/core/richdoc/operations.ts`; o que este componente faz é traduzir gesto
 * em intenção, cuidar do foco e do cursor, e mostrar erro em português.
 */

type FocusRequest = { key: string; offset: number };
type ActiveLine = { blockId: string; itemIndex: number | null; selection: InlineSelection | null };

export interface RichDocEditorProps {
  target: RichDocTarget;
  value: RichDoc | undefined;
  editable: boolean;
  /** Rótulo do bloco vazio quando não há nada escrito e não dá para editar. */
  emptyLabel?: string;
}

export function RichDocEditor({ target, value, editable, emptyLabel }: RichDocEditorProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);
  const breakCoalescing = useDocumentStore((s) => s.breakCoalescing);
  const identity = useDocumentStore((s) => s.identity);
  const actor = useDocumentStore((s) => s.actor);
  const { toast } = useToast();

  const doc: RichDoc = value ?? { blocks: [] };

  const lines = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<FocusRequest | null>(null);
  const activeLine = useRef<ActiveLine | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const imageAnchor = useRef<string | null>(null);
  const [insertMenuFor, setInsertMenuFor] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState('');

  const registerLine = useCallback((key: string, element: HTMLElement | null) => {
    if (element === null) lines.current.delete(key);
    else lines.current.set(key, element);
  }, []);

  // Foco pedido por uma operação (dividir, fundir, inserir) só pode ser
  // aplicado depois de o React repintar a lista de blocos.
  useEffect(() => {
    const request = pendingFocus.current;
    if (request === null) return;
    pendingFocus.current = null;
    const element = lines.current.get(request.key);
    if (element === undefined) return;
    element.focus();
    setCaret(element, request.offset);
  });

  function fail(error: unknown): void {
    const message = isDomainError(error) ? error.message : 'Não foi possível editar a especificação.';
    toast({ title: 'Especificação', description: message });
  }

  /** Executa uma intenção que pode recusar (`DomainError`) sem derrubar a tela. */
  function safely<T>(compute: () => T): T | undefined {
    try {
      return compute();
    } catch (error) {
      fail(error);
      return undefined;
    }
  }

  function run(op: RichDocOp | null | undefined, options: { label?: string; coalesceKey?: string } = {}): boolean {
    if (op === null || op === undefined) return false;
    const result = dispatch(applyRichDocOp({ target, op, ...options }));
    if (!result.ok) {
      fail(result.error);
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Navegação entre linhas
  // -------------------------------------------------------------------------
  // #region: navegacao-entre-linhas

  /** Todas as linhas editáveis, na ordem do documento (tabela e imagem não têm). */
  function lineKeys(): string[] {
    return doc.blocks.flatMap((block) => {
      if (isListBlock(block)) return block.items.map((_, index) => lineKeyOf(block.id, index));
      if (isTextBlock(block)) return [lineKeyOf(block.id, null)];
      return [];
    });
  }

  function moveCaretToLine(currentKey: string, delta: number): boolean {
    const keys = lineKeys();
    const index = keys.indexOf(currentKey);
    const next = keys[index + delta];
    if (index < 0 || next === undefined) return false;
    pendingFocus.current = { key: next, offset: delta > 0 ? 0 : Number.POSITIVE_INFINITY };
    const element = lines.current.get(next);
    if (element !== undefined) {
      element.focus();
      setCaret(element, delta > 0 ? 0 : Number.POSITIVE_INFINITY);
      pendingFocus.current = null;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Teclado
  // -------------------------------------------------------------------------
  // #region: teclado

  function handleKeyDown(
    blockId: string,
    itemIndex: number | null,
    event: KeyboardEvent<HTMLDivElement>,
    context: { offset: number; length: number; selection: InlineSelection | null },
  ): void {
    const chord = event.ctrlKey || event.metaKey;
    activeLine.current = { blockId, itemIndex, selection: context.selection };

    // Desfazer/refazer precisam ser interceptados aqui: o desfazer nativo do
    // `contentEditable` mexeria no DOM sem passar pelo documento, e as duas
    // pilhas divergiriam na hora.
    if (chord && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (chord && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (chord && (event.key.toLowerCase() === 'b' || event.key.toLowerCase() === 'i')) {
      event.preventDefault();
      applyMark(event.key.toLowerCase() === 'b' ? 'bold' : 'italic');
      return;
    }

    const block = doc.blocks.find((candidate) => candidate.id === blockId);
    if (block === undefined) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      const newBlockId = nanoid(12);
      const op = safely(() =>
        splitBlockAt(
          doc,
          { blockId, offset: context.offset, ...(itemIndex !== null ? { itemIndex } : {}) },
          () => newBlockId,
        ),
      );
      if (run(op, { label: 'Dividir bloco da especificação' })) {
        pendingFocus.current =
          itemIndex === null
            ? { key: lineKeyOf(newBlockId, null), offset: 0 }
            : { key: lineKeyOf(blockId, itemIndex + 1), offset: 0 };
      }
      return;
    }

    if (event.key === 'Backspace' && context.offset === 0 && isCollapsed(context.selection)) {
      const newBlockId = nanoid(12);
      const focus = focusAfterMerge(block, itemIndex, newBlockId);
      const op = safely(() =>
        mergeBlockBackward(doc, { blockId, ...(itemIndex !== null ? { itemIndex } : {}) }, () => newBlockId),
      );
      if (op === undefined || op === null) return;
      event.preventDefault();
      if (run(op, { label: 'Juntar blocos da especificação' })) pendingFocus.current = focus;
      return;
    }

    if (event.key === 'ArrowUp' && context.offset === 0) {
      if (moveCaretToLine(lineKeyOf(blockId, itemIndex), -1)) event.preventDefault();
      return;
    }
    if (event.key === 'ArrowDown' && context.offset >= context.length) {
      if (moveCaretToLine(lineKeyOf(blockId, itemIndex), 1)) event.preventDefault();
      return;
    }

    // "/" numa linha vazia abre o menu de inserção — o atalho de sempre, sem
    // precisar caçar a barra de ferramentas com o mouse.
    if (event.key === '/' && context.length === 0) {
      event.preventDefault();
      setInsertMenuFor(blockId);
    }
  }

  function isCollapsed(selection: InlineSelection | null): boolean {
    return selection === null || selection.start === selection.end;
  }

  /** Para onde o cursor vai depois de um Backspace que funde — calculado **antes** da operação. */
  function focusAfterMerge(block: Block, itemIndex: number | null, newBlockId: string): FocusRequest | null {
    if (isListBlock(block)) {
      if ((itemIndex ?? 0) > 0) {
        const previous = block.items[(itemIndex ?? 0) - 1] ?? [];
        return { key: lineKeyOf(block.id, (itemIndex ?? 0) - 1), offset: inlineLength(previous) };
      }
      return { key: lineKeyOf(newBlockId, null), offset: 0 };
    }
    if (!isTextBlock(block)) return null;
    if (block.type !== 'paragraph') return { key: lineKeyOf(block.id, null), offset: 0 };
    const index = doc.blocks.findIndex((candidate) => candidate.id === block.id);
    const previous = index > 0 ? doc.blocks[index - 1] : undefined;
    if (previous === undefined) return null;
    if (isTextBlock(previous)) return { key: lineKeyOf(previous.id, null), offset: inlineLength(previous.text) };
    if (isListBlock(previous) && previous.items.length > 0) {
      const last = previous.items.length - 1;
      return { key: lineKeyOf(previous.id, last), offset: inlineLength(previous.items[last]!) };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Marcas e link
  // -------------------------------------------------------------------------
  // #region: marcas-e-link

  function applyMark(mark: InlineMark, href?: string): void {
    const line = activeLine.current;
    if (line === null || line.selection === null || line.selection.start === line.selection.end) {
      toast({ title: 'Selecione o texto', description: 'Marcas valem para o trecho selecionado.' });
      return;
    }
    const op = safely(() =>
      toggleMark(doc, {
        blockId: line.blockId,
        ...(line.itemIndex !== null ? { itemIndex: line.itemIndex } : {}),
        start: line.selection!.start,
        end: line.selection!.end,
        mark,
        ...(href !== undefined ? { href } : {}),
      }),
    );
    run(op, { label: 'Formatar trecho da especificação' });
  }

  // -------------------------------------------------------------------------
  // Colar
  // -------------------------------------------------------------------------
  // #region: colar

  function handlePaste(event: ClipboardEvent<HTMLDivElement>): void {
    if (!editable) return;
    const drafts = blocksFromClipboard({
      html: event.clipboardData.getData('text/html'),
      text: event.clipboardData.getData('text/plain'),
    });
    if (drafts.length === 0) return;
    event.preventDefault();
    breakCoalescing();

    // Quem recebe o colar é a linha sob o evento — não o último foco
    // registrado: colar com o mouse pode acontecer numa linha em que ninguém
    // digitou ainda.
    const origin = event.target instanceof HTMLElement ? event.target : null;
    const lineElement = origin?.closest<HTMLElement>('[data-line-key]') ?? null;
    const lineKey = lineElement?.getAttribute('data-line-key') ?? null;
    const blockId =
      origin?.closest<HTMLElement>('[data-block-id]')?.getAttribute('data-block-id') ??
      activeLine.current?.blockId ??
      null;
    const itemIndex = lineKey !== null && lineKey.includes('#') ? Number(lineKey.split('#')[1]) : null;
    const single = drafts.length === 1 && drafts[0]!.type === 'paragraph' ? drafts[0]! : null;

    // Um parágrafo colado dentro de uma linha entra **no cursor**: colar o
    // nome de um reason code no meio da frase não deve criar bloco novo.
    if (single !== null && single.type === 'paragraph' && blockId !== null && lineElement !== null) {
      const block = doc.blocks.find((candidate) => candidate.id === blockId);
      const offset = caretOffsetIn(lineElement);
      const current =
        block === undefined
          ? null
          : isListBlock(block)
            ? (block.items[itemIndex ?? 0] ?? [])
            : isTextBlock(block)
              ? block.text
              : null;
      if (block !== undefined && offset !== null && current !== null) {
        const text = plainTextOf(single.text);
        const op = safely(() =>
          itemIndex === null
            ? setBlockInlineText(doc, block.id, insertTextInline(current, offset, text))
            : setListItemText(doc, block.id, itemIndex, insertTextInline(current, offset, text)),
        );
        if (run(op, { label: 'Colar na especificação' })) {
          pendingFocus.current = { key: lineKeyOf(block.id, itemIndex), offset: offset + text.length };
        }
        return;
      }
    }

    const blocks = materializeBlocks(drafts, () => nanoid(12));
    const op = safely(() => pasteBlocksAt(doc, blockId, blocks));
    if (run(op, { label: 'Colar na especificação' })) {
      const last = blocks[blocks.length - 1]!;
      pendingFocus.current = { key: lineKeyOf(last.id, isListBlock(last) ? last.items.length - 1 : null), offset: Number.POSITIVE_INFINITY };
    }
  }

  // -------------------------------------------------------------------------
  // Inserção de blocos e imagem
  // -------------------------------------------------------------------------
  // #region: insercao-de-blocos

  function insertBlockOfType(anchorId: string | null, type: InsertableBlockType): void {
    setInsertMenuFor(null);
    breakCoalescing();

    if (type === 'image') {
      imageAnchor.current = anchorId;
      fileInput.current?.click();
      return;
    }

    const anchor = anchorId === null ? null : (doc.blocks.find((block) => block.id === anchorId) ?? null);
    const anchorIndex = anchor === null ? doc.blocks.length - 1 : doc.blocks.indexOf(anchor);
    const replaces = anchor !== null && isBlockEmpty(anchor) && anchor.type !== 'table';

    if (type === 'table') {
      const table = emptyTable(() => nanoid(12));
      const op: RichDocOp = replaces
        ? { kind: 'spliceBlocks', index: anchorIndex, count: 1, blocks: [table] }
        : { kind: 'insertBlock', index: anchorIndex + 1, block: table };
      run(op, { label: 'Inserir tabela na especificação' });
      return;
    }

    if (replaces && anchor !== null) {
      const newBlockId = nanoid(12);
      const op = safely(() => transformBlockTo(doc, { blockId: anchor.id, type }, () => newBlockId));
      if (op === null) return;
      const targetId = op !== undefined && op.kind === 'replaceBlock' ? anchor.id : newBlockId;
      if (run(op, { label: 'Trocar o tipo do bloco' })) {
        pendingFocus.current = {
          key: lineKeyOf(targetId, type === 'bulletList' || type === 'numberList' ? 0 : null),
          offset: 0,
        };
      }
      return;
    }

    const id = nanoid(12);
    const block =
      type === 'bulletList' || type === 'numberList' ? listBlock(id, type, [[]]) : textBlock(id, type, []);
    if (run({ kind: 'insertBlock', index: anchorIndex + 1, block }, { label: 'Inserir bloco na especificação' })) {
      pendingFocus.current = {
        key: lineKeyOf(id, type === 'bulletList' || type === 'numberList' ? 0 : null),
        offset: 0,
      };
    }
  }

  async function handleImageFile(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    try {
      const prepared = await prepareInlineImage(file);
      const result = dispatch(
        insertRichDocImage({
          target,
          image: {
            fileName: prepared.fileName,
            mimeType: prepared.mimeType,
            data: prepared.data,
            bytes: prepared.bytes,
            width: prepared.width,
            height: prepared.height,
            addedBy: {
              username: identity.username,
              ...(actor.length > 0 ? { displayName: actor } : {}),
            },
          },
          afterBlockId: imageAnchor.current,
        }),
      );
      if (!result.ok) {
        fail(result.error);
        return;
      }
      // Aviso, nunca bloqueio (docs/14 §7): o `.json` engordou, e quem escreve
      // a política decide o que fazer com isso.
      if (document !== null && warnsOnInlineImageTotal(document)) {
        toast({
          title: 'Anexos passaram de 3 MB',
          description: 'As imagens embutidas deixam o arquivo da política mais pesado — considere anexar só o essencial.',
        });
      }
    } catch (error) {
      fail(error);
    } finally {
      imageAnchor.current = null;
      if (fileInput.current !== null) fileInput.current.value = '';
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  // #region: render

  if (!editable) {
    return <RichDocView value={value} {...(emptyLabel !== undefined ? { emptyLabel } : {})} />;
  }

  const handlers: BlockEditorHandlers = {
    editable,
    registerLine,
    onLineInput: (blockId, itemIndex, next) => {
      const op = safely(() =>
        itemIndex === null
          ? setBlockInlineText(doc, blockId, next)
          : setListItemText(doc, blockId, itemIndex, next),
      );
      run(op, {
        label: 'Digitar na especificação',
        coalesceKey: typingCoalesceKey(target, blockId, String(itemIndex ?? '')),
      });
    },
    onLineKeyDown: handleKeyDown,
    onSelectionChange: (blockId, itemIndex, selection) => {
      activeLine.current = { blockId, itemIndex, selection };
    },
    onTableCell: (blockId, row, column, value) => {
      const op = safely(() => setTableCell(doc, blockId, row, column, value));
      run(op, {
        label: 'Editar célula da tabela',
        coalesceKey: typingCoalesceKey(target, blockId, `${row}:${column}`),
      });
    },
    onTableStructure: (blockId, action, at) => {
      breakCoalescing();
      const op = safely(() => {
        switch (action) {
          case 'addRow':
            return insertTableRow(doc, blockId);
          case 'removeRow':
            return removeTableRow(doc, blockId, at ?? 0);
          case 'addColumn':
            return insertTableColumn(doc, blockId);
          case 'removeColumn':
            return removeTableColumn(doc, blockId, at ?? 0);
        }
      });
      run(op, { label: 'Alterar a estrutura da tabela' });
    },
    onCaption: (blockId, caption) => {
      const op = safely(() => setImageCaption(doc, blockId, caption));
      run(op, { label: 'Editar legenda', coalesceKey: typingCoalesceKey(target, blockId, 'caption') });
    },
    onMove: (blockId, delta) => {
      breakCoalescing();
      run(safely(() => moveBlockBy(doc, blockId, delta)), { label: 'Mover bloco da especificação' });
    },
    onRemove: (blockId) => {
      breakCoalescing();
      const result = dispatch(removeRichDocBlock({ target, blockId }));
      if (!result.ok) fail(result.error);
    },
    onInsertBelow: insertBlockOfType,
    insertMenuFor,
    onInsertMenuOpenChange: (blockId, open) => setInsertMenuFor(open ? blockId : null),
  };

  const lastBlockId = doc.blocks[doc.blocks.length - 1]?.id ?? null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-1 border-b border-neutral-200 pb-2 dark:border-neutral-800">
        <MarkButton label="Negrito (Ctrl+B)" onClick={() => applyMark('bold')}>
          <Bold className="h-3.5 w-3.5" />
        </MarkButton>
        <MarkButton label="Itálico (Ctrl+I)" onClick={() => applyMark('italic')}>
          <Italic className="h-3.5 w-3.5" />
        </MarkButton>
        <MarkButton label="Código" onClick={() => applyMark('code')}>
          <Code className="h-3.5 w-3.5" />
        </MarkButton>
        <MarkButton label="Link" onClick={() => setLinkOpen((open) => !open)}>
          <Link2 className="h-3.5 w-3.5" />
        </MarkButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="ml-auto h-7">
              <Plus className="mr-1 h-3.5 w-3.5" /> Inserir
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {INSERTABLE_BLOCK_TYPES.map((type) => (
              <DropdownMenuItem key={type} onSelect={() => insertBlockOfType(activeLine.current?.blockId ?? lastBlockId, type)}>
                {BLOCK_TYPE_LABELS[type]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {linkOpen && (
        <div className="flex items-center gap-1">
          <Input
            value={linkHref}
            aria-label="Endereço do link"
            // Sem "https://" literal no placeholder: o guard de autocontenção
            // (`pnpm check-selfcontained`) reprova qualquer URL no bundle, e
            // um exemplo de endereço não vale abrir exceção no guard.
            placeholder="Endereço do link (intranet, arquivo ou pasta de rede)"
            onChange={(event) => setLinkHref(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              applyMark('link', linkHref.trim());
              setLinkOpen(false);
              setLinkHref('');
            }}
          >
            Aplicar
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-1.5" onPaste={handlePaste} onBlur={() => breakCoalescing()}>
        {doc.blocks.map((block, index) => (
          <RichDocBlockEditor
            key={block.id}
            block={block}
            index={index}
            total={doc.blocks.length}
            handlers={handlers}
          />
        ))}
        {doc.blocks.length === 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => insertBlockOfType(null, 'paragraph')}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Começar a escrever
          </Button>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Escolher imagem para a especificação"
        onChange={(event) => void handleImageFile(event.target.files?.[0])}
      />
    </div>
  );
}

function MarkButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 w-7 p-0"
      aria-label={label}
      title={label}
      // Sem isto o clique tira o foco da linha e a seleção morre antes de a
      // marca ser aplicada.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
