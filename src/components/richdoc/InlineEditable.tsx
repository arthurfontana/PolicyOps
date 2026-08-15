import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { InlineText } from '@/core/document/schema';
import { inlineLength } from '@/core/richdoc/text';
import {
  caretOffsetIn,
  inlineFromElement,
  inlineToHtml,
  selectionIn,
  setCaret,
  type InlineSelection,
} from './inline-dom';

/**
 * Uma linha editável — docs/07-ux-e-editor.md §18.
 *
 * `contentEditable` **não controlado**: escrever `innerHTML` a cada tecla
 * jogaria o cursor para o começo da linha, que é o defeito clássico de editor
 * feito em React. O elemento é pintado uma vez e só é reescrito quando o
 * modelo muda **por fora** (desfazer, refazer, colar, troca de bloco) — a
 * comparação é contra o HTML que esta própria linha emitiu por último.
 */

export type LineKeyboardContext = {
  offset: number;
  length: number;
  selection: InlineSelection | null;
  element: HTMLElement;
};

export interface InlineEditableProps {
  value: InlineText;
  editable: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
  /** Identidade da linha para o foco programático (bloco, ou bloco + item). */
  lineKey: string;
  registerLine?: (key: string, element: HTMLElement | null) => void;
  onInput: (next: InlineText) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>, context: LineKeyboardContext) => void;
  onFocus?: (lineKey: string) => void;
  onSelectionChange?: (selection: InlineSelection | null) => void;
}

export function InlineEditable({
  value,
  editable,
  placeholder,
  className,
  ariaLabel,
  lineKey,
  registerLine,
  onInput,
  onKeyDown,
  onFocus,
  onSelectionChange,
}: InlineEditableProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const emittedHtml = useRef<string | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const html = inlineToHtml(value);
    // Mudança que veio do próprio teclado já está no DOM: reescrever apagaria
    // a posição do cursor sem necessidade.
    if (emittedHtml.current === html) return;
    const active = element.ownerDocument.activeElement === element;
    const caret = active ? caretOffsetIn(element) : null;
    element.innerHTML = html;
    emittedHtml.current = html;
    if (active) setCaret(element, Math.min(caret ?? inlineLength(value), inlineLength(value)));
  }, [value]);

  useEffect(() => {
    const element = ref.current;
    registerLine?.(lineKey, element);
    return () => registerLine?.(lineKey, null);
  }, [lineKey, registerLine]);

  return (
    <div
      ref={ref}
      role="textbox"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-multiline={false}
      contentEditable={editable}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      data-line-key={lineKey}
      className={className}
      onInput={(event) => {
        const element = event.currentTarget;
        const next = inlineFromElement(element);
        emittedHtml.current = inlineToHtml(next);
        onInput(next);
      }}
      onKeyDown={(event) => {
        const element = event.currentTarget;
        onKeyDown?.(event, {
          offset: caretOffsetIn(element) ?? 0,
          length: inlineLength(inlineFromElement(element)),
          selection: selectionIn(element),
          element,
        });
      }}
      onKeyUp={(event) => onSelectionChange?.(selectionIn(event.currentTarget))}
      onMouseUp={(event) => onSelectionChange?.(selectionIn(event.currentTarget))}
      onFocus={() => onFocus?.(lineKey)}
    />
  );
}
