import type { InlineMark, InlineText } from '@/core/document/schema';
import { normalizeInline } from '@/core/richdoc/text';

/**
 * Ponte entre `InlineText` e o DOM do `contentEditable` — docs/07 §18.
 *
 * O editor é de **blocos**, com um `contentEditable` por linha (nunca um
 * global, docs/14 §7): esta camada é a única do produto que lê e escreve DOM
 * de edição, e existe para que `src/core/richdoc/` continue TypeScript puro
 * (regra 4). Ela faz três coisas e nada mais:
 *
 * 1. modelo → HTML, para pintar a linha;
 * 2. DOM → modelo, depois de cada tecla;
 * 3. seleção do browser → **offsets de texto plano**, que é a coordenada com
 *    que o núcleo raciocina (`text.ts`, `operations.ts`).
 *
 * Marca que não conhecemos morre na volta: o que sai do DOM é sempre um
 * `InlineText` normalizado, com as quatro marcas do schema e nada além delas.
 */

const MARK_TAGS: Record<Exclude<InlineMark, 'link'>, string> = {
  bold: 'strong',
  italic: 'em',
  code: 'code',
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Modelo → HTML da linha. Linha vazia vira `<br>` para o cursor ter onde ficar. */
export function inlineToHtml(inline: InlineText): string {
  const html = normalizeInline(inline)
    .map((run) => {
      const marks = run.marks ?? [];
      let piece = escapeHtml(run.text);
      for (const mark of ['code', 'italic', 'bold'] as const) {
        if (marks.includes(mark)) piece = `<${MARK_TAGS[mark]}>${piece}</${MARK_TAGS[mark]}>`;
      }
      if (marks.includes('link')) {
        const href = escapeHtml(run.href ?? '');
        piece = `<a href="${href}" rel="noreferrer">${piece}</a>`;
      }
      return piece;
    })
    .join('');
  return html.length === 0 ? '<br>' : html;
}

function marksOf(element: Element, inherited: InlineMark[]): { marks: InlineMark[]; href?: string } {
  const tag = element.tagName.toLowerCase();
  const marks = [...inherited];
  if (tag === 'strong' || tag === 'b') marks.push('bold');
  if (tag === 'em' || tag === 'i') marks.push('italic');
  if (tag === 'code') marks.push('code');
  if (tag === 'a') {
    marks.push('link');
    return { marks, href: element.getAttribute('href') ?? '' };
  }
  return { marks };
}

/** DOM → modelo. É o que roda a cada tecla digitada. */
export function inlineFromElement(element: Element): InlineText {
  const runs: InlineText = [];

  function walk(node: Node, marks: InlineMark[], href?: string): void {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        // O `\n` que o browser às vezes injeta não existe no modelo: quebra de
        // linha é bloco novo, decidida pelo Enter (docs/07 §18).
        const text = (child.textContent ?? '').replace(/\n/g, ' ');
        if (text.length > 0) runs.push({ text, ...(marks.length > 0 ? { marks: [...marks] } : {}), ...(href !== undefined ? { href } : {}) });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const childElement = child as Element;
      if (childElement.tagName.toLowerCase() === 'br') continue;
      const next = marksOf(childElement, marks);
      walk(childElement, next.marks, next.href ?? href);
    }
  }

  walk(element, []);
  return normalizeInline(runs);
}

/** Texto plano da linha, na mesma contagem de offsets do modelo. */
export function plainTextFromElement(element: Element): string {
  return inlineFromElement(element)
    .map((run) => run.text)
    .join('');
}

function textNodesOf(element: Element): Text[] {
  const nodes: Text[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current !== null) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

/** Offset de texto plano de uma posição (nó, offset) dentro da linha. */
export function offsetOf(element: Element, node: Node, nodeOffset: number): number {
  if (node === element) {
    // Seleção ancorada no próprio elemento: o offset conta **filhos**.
    const before = Array.from(element.childNodes).slice(0, nodeOffset);
    return before.reduce((total, child) => total + (child.textContent ?? '').length, 0);
  }
  let total = 0;
  for (const text of textNodesOf(element)) {
    if (text === node) return total + nodeOffset;
    total += text.data.length;
  }
  return total;
}

export type InlineSelection = { start: number; end: number };

/** Seleção corrente, em offsets de texto plano — `null` se não está nesta linha. */
export function selectionIn(element: Element): InlineSelection | null {
  const selection = element.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  const start = offsetOf(element, range.startContainer, range.startOffset);
  const end = offsetOf(element, range.endContainer, range.endOffset);
  return start <= end ? { start, end } : { start: end, end: start };
}

/** Posição do cursor (início da seleção) — `null` fora desta linha. */
export function caretOffsetIn(element: Element): number | null {
  return selectionIn(element)?.start ?? null;
}

/**
 * Põe o cursor num offset de texto plano. `Infinity` vai para o fim — é o que
 * a navegação por teclado usa ao subir para a linha de cima.
 */
export function setCaret(element: HTMLElement, offset: number): void {
  const doc = element.ownerDocument;
  const selection = doc.getSelection();
  if (selection === null) return;
  const range = doc.createRange();
  const nodes = textNodesOf(element);

  if (nodes.length === 0) {
    range.setStart(element, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }

  let remaining = Math.max(0, offset);
  for (const node of nodes) {
    if (remaining <= node.data.length) {
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= node.data.length;
  }
  const last = nodes[nodes.length - 1]!;
  range.setStart(last, last.data.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
