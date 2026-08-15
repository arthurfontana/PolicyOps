import type { InlineText } from '../document/schema';
import { parseDelimitedTable } from '../import/parse-table';
import type { BlockDraft } from './model';
import { inlineFromText } from './text';

/**
 * Sanitização do colar — docs/14-governanca-de-alteracoes.md §7.
 *
 * O contrato tem três linhas, e elas são o resumo honesto do que este arquivo
 * faz:
 *
 * - **texto → parágrafos**;
 * - **tabela HTML → bloco `table`**;
 * - **qualquer outra marcação → texto puro**.
 *
 * Ou seja: negrito, cor, fonte, `class=MsoNormal`, `<span style=…>` e o resto
 * do entulho que o Word despeja no clipboard **não** sobrevivem — é
 * exatamente isso que "colar do Word não traz lixo de formatação" quer dizer.
 * O que se preserva é a **estrutura**: parágrafo, item de lista e célula de
 * tabela.
 *
 * O parser é próprio e regex-based porque `src/core/` é TypeScript puro
 * (regra 4): nada de `DOMParser`, que só existe no browser — e porque
 * DEC-GOV-005 proíbe dependência nova. Ele não precisa ser um parser de HTML
 * completo: precisa achar tabela, lista e fronteira de parágrafo, e jogar o
 * resto fora.
 */

// ---------------------------------------------------------------------------
// Texto e entidades
// ---------------------------------------------------------------------------
// #region: texto-e-entidades

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
  middot: '·',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x') || body.startsWith('#X')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Espaço de HTML é elástico: quebra de linha e tabulação do fonte viram um espaço. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Marcadores de lista do Word
// ---------------------------------------------------------------------------
// #region: marcadores-de-lista

const BULLET_PREFIX = /^[•·▪◦‣*\-–—]\s+/;
const NUMBER_PREFIX = /^(\d{1,3}|[a-zA-Z])[.)]\s+/;

type MarkedLine = { text: string; list: 'bulletList' | 'numberList' | null };

/**
 * O Word não manda `<ul><li>`: manda parágrafos que **começam** com o
 * caractere do marcador (`·`, `•`, `o`), com a indentação em `style`. Como a
 * indentação morre na sanitização, o marcador no início do texto é a única
 * pista que sobra — e reconhecê-lo é a diferença entre uma lista e cinco
 * parágrafos começando com bolinha.
 */
function markLine(text: string): MarkedLine {
  const bullet = BULLET_PREFIX.exec(text);
  if (bullet !== null) return { text: text.slice(bullet[0].length).trim(), list: 'bulletList' };
  const numbered = NUMBER_PREFIX.exec(text);
  if (numbered !== null) return { text: text.slice(numbered[0].length).trim(), list: 'numberList' };
  return { text, list: null };
}

/** Agrupa linhas em parágrafos e listas, respeitando a sequência de marcadores. */
function linesToBlocks(lines: readonly string[]): BlockDraft[] {
  const blocks: BlockDraft[] = [];
  let current: { type: 'bulletList' | 'numberList'; items: InlineText[] } | null = null;

  for (const raw of lines) {
    const text = raw.trim();
    if (text.length === 0) continue;
    const marked = markLine(text);
    if (marked.list === null || marked.text.length === 0) {
      if (current !== null) {
        blocks.push(current);
        current = null;
      }
      blocks.push({ type: 'paragraph', text: inlineFromText(text) });
      continue;
    }
    if (current === null || current.type !== marked.list) {
      if (current !== null) blocks.push(current);
      current = { type: marked.list, items: [] };
    }
    current.items.push(inlineFromText(marked.text));
  }
  if (current !== null) blocks.push(current);
  return blocks;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
// #region: html

/** Tags que fecham um parágrafo quando abrem ou fecham. */
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'section',
  'article',
  'header',
  'footer',
  'address',
]);

type TableAccumulator = { header: string[] | null; rows: string[][]; row: string[] | null; cell: string | null };

/**
 * `html` do clipboard → blocos. Fora de tabela e de lista, tudo vira
 * parágrafo de texto puro; dentro, vira `table`/`bulletList`/`numberList`.
 */
export function sanitizePastedHtml(html: string): BlockDraft[] {
  const source = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ');

  const blocks: BlockDraft[] = [];
  /** Linhas soltas fora de tabela/lista — viram parágrafos e listas do Word no fim de cada trecho. */
  let pending: string[] = [];
  let buffer = '';
  let table: TableAccumulator | null = null;
  let tableDepth = 0;
  let list: { type: 'bulletList' | 'numberList'; items: InlineText[] } | null = null;
  let inListItem = false;

  function flushPending(): void {
    flushLine();
    if (pending.length === 0) return;
    blocks.push(...linesToBlocks(pending));
    pending = [];
  }

  /** Texto acumulado desde a última fronteira, já decodificado e sem espaço à toa. */
  function takeBuffer(): string {
    const text = collapseWhitespace(decodeEntities(buffer));
    buffer = '';
    return text;
  }

  function flushLine(): void {
    const text = takeBuffer();
    if (text.length === 0) return;
    if (list !== null && inListItem) {
      list.items.push(inlineFromText(text));
      return;
    }
    pending.push(text);
  }

  function flushList(): void {
    if (list === null) return;
    if (list.items.length > 0) blocks.push(list);
    list = null;
    inListItem = false;
  }

  /** Quebra dentro da célula vira espaço: o modelo não tem célula multilinha. */
  function foldBufferIntoCell(): void {
    if (table === null) return;
    const text = takeBuffer();
    if (text.length === 0) return;
    table.cell = table.cell === null || table.cell.length === 0 ? text : `${table.cell} ${text}`;
  }

  function flushCell(): void {
    if (table === null || table.row === null) return;
    foldBufferIntoCell();
    if (table.cell === null) return;
    table.row.push(table.cell);
    table.cell = null;
  }

  function flushRow(): void {
    if (table === null || table.row === null) return;
    flushCell();
    const row = table.row;
    table.row = null;
    if (row.every((cell) => cell.length === 0)) return;
    if (table.header === null) table.header = row;
    else table.rows.push(row);
  }

  function flushTable(): void {
    if (table === null) return;
    flushRow();
    const header = table.header;
    const rows = table.rows;
    table = null;
    if (header === null) return;
    // Linha curta ganha célula vazia; linha longa perde a sobra — o modelo
    // exige uma tabela retangular (docs/03 §12.3).
    const width = header.length;
    blocks.push({
      type: 'table',
      header: fit(header, width),
      rows: rows.map((row) => fit(row, width)),
    });
  }

  const token = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)[^>]*>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(source)) !== null) {
    buffer += source.slice(cursor, match.index);
    cursor = match.index + match[0].length;

    const tag = match[1]!.toLowerCase();
    const closing = match[0].startsWith('</');

    if (tag === 'table') {
      if (closing) {
        tableDepth = Math.max(0, tableDepth - 1);
        // Tabela aninhada não vira bloco próprio: o texto dela já entrou na
        // célula de fora, que é o comportamento menos surpreendente.
        if (tableDepth === 0) flushTable();
        continue;
      }
      if (tableDepth === 0) {
        flushPending();
        flushList();
        table = { header: null, rows: [], row: null, cell: null };
      }
      tableDepth += 1;
      continue;
    }

    if (table !== null) {
      if (tag === 'tr') {
        if (closing) flushRow();
        else {
          flushRow();
          table.row = [];
        }
        continue;
      }
      if (tag === 'td' || tag === 'th') {
        if (closing) flushCell();
        else {
          flushCell();
          if (table.row === null) table.row = [];
          table.cell = '';
        }
        continue;
      }
      if (BLOCK_TAGS.has(tag)) foldBufferIntoCell();
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      flushLine();
      if (closing) {
        flushList();
      } else {
        flushPending();
        flushList();
        list = { type: tag === 'ul' ? 'bulletList' : 'numberList', items: [] };
      }
      continue;
    }
    if (tag === 'li') {
      flushLine();
      if (closing) inListItem = false;
      else {
        if (list === null) list = { type: 'bulletList', items: [] };
        inListItem = true;
      }
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      flushLine();
      continue;
    }
    // Marcação inline (span, b, font, a…) some sem deixar rastro: o texto dela
    // já está no buffer.
  }

  buffer += source.slice(cursor);
  if (table !== null) foldBufferIntoCell();
  else flushLine();
  flushTable();
  flushList();
  flushPending();
  return blocks;
}

function fit(row: readonly string[], width: number): string[] {
  const next = row.slice(0, width);
  while (next.length < width) next.push('');
  return next;
}

// ---------------------------------------------------------------------------
// Texto plano
// ---------------------------------------------------------------------------
// #region: texto-plano

/**
 * Texto plano → parágrafos. Um caso especial ganha tabela: o TSV que o Excel
 * põe no clipboard junto do HTML (e que é tudo que sobra quando a origem é um
 * `.txt` ou um editor sem HTML). O critério é conservador — precisa de
 * tabulação, de mais de uma coluna e de pelo menos uma linha de dados —
 * porque transformar um parágrafo com um tab no meio em tabela seria pior do
 * que não reconhecer nada.
 */
export function sanitizePastedText(text: string): BlockDraft[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const table = tsvTable(normalized);
  if (table !== null) return [table];
  return linesToBlocks(normalized.split('\n'));
}

function tsvTable(text: string): BlockDraft | null {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 2) return null;
  if (!lines.every((line) => line.includes('\t'))) return null;
  const parsed = parseDelimitedTable(text, { delimiter: '\t' });
  if (parsed.errors.length > 0 || parsed.header.length < 2 || parsed.rows.length === 0) return null;
  const width = parsed.header.length;
  return { type: 'table', header: fit(parsed.header, width), rows: parsed.rows.map((row) => fit(row, width)) };
}

// ---------------------------------------------------------------------------
// Entrada do clipboard
// ---------------------------------------------------------------------------
// #region: entrada-do-clipboard

export type ClipboardPayload = { html?: string | undefined; text?: string | undefined };

/**
 * O que o editor chama no `onPaste`. HTML tem precedência quando existe — é
 * dele que sai a tabela do Excel e a lista do Word; o texto plano é o caminho
 * de tudo o mais. Colar imagem **não** é desta sessão (docs/14 §7): anexar é
 * explícito, pelo botão.
 */
export function blocksFromClipboard(payload: ClipboardPayload): BlockDraft[] {
  const html = payload.html?.trim() ?? '';
  if (html.length > 0) {
    const blocks = sanitizePastedHtml(html);
    if (blocks.length > 0) return blocks;
  }
  const text = payload.text ?? '';
  return text.trim().length > 0 ? sanitizePastedText(text) : [];
}
