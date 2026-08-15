import type { InlineMark, InlineText } from '../document/schema';

/**
 * Aritmética de `InlineText` — docs/14-governanca-de-alteracoes.md §7.
 *
 * Um parágrafo é uma sequência de trechos (`runs`), cada um com suas marcas.
 * O editor precisa de quatro coisas sobre essa estrutura, e todas moram aqui,
 * em TypeScript puro (regra 4): medir, fatiar, concatenar e marcar um
 * intervalo. O componente traduz seleção do DOM em **offsets de texto plano**
 * e chama estas funções; nenhuma decisão de conteúdo acontece no DOM.
 *
 * **Forma canônica** (`normalizeInline`): trecho vazio some, trechos vizinhos
 * com as mesmas marcas se fundem, `marks` entra sempre na mesma ordem e
 * `href` só sobrevive junto da marca `link`. Sem isso, digitar no meio de um
 * parágrafo produziria uma fragmentação crescente de runs idênticos — e o
 * diff por bloco (`./diff.ts`), que compara conteúdo por igualdade
 * estrutural, acusaria mudança onde o texto é o mesmo.
 */

/** Ordem canônica das marcas — comparação estrutural precisa de ordem estável. */
const MARK_ORDER: readonly InlineMark[] = ['bold', 'italic', 'code', 'link'];

export type InlineRun = InlineText[number];

export function inlineLength(inline: InlineText): number {
  return inline.reduce((total, run) => total + run.text.length, 0);
}

export function plainTextOf(inline: InlineText): string {
  return inline.map((run) => run.text).join('');
}

/** Texto sem marca nenhuma. Texto vazio vira `[]`, nunca um run vazio. */
export function inlineFromText(text: string): InlineText {
  return text.length === 0 ? [] : [{ text }];
}

function sortMarks(marks: readonly InlineMark[]): InlineMark[] {
  return MARK_ORDER.filter((mark) => marks.includes(mark));
}

function sameFormatting(a: InlineRun, b: InlineRun): boolean {
  const aMarks = a.marks ?? [];
  const bMarks = b.marks ?? [];
  if (aMarks.length !== bMarks.length) return false;
  if (aMarks.some((mark, index) => bMarks[index] !== mark)) return false;
  return (a.href ?? '') === (b.href ?? '');
}

/** Run com marcas ordenadas, sem `marks: []` e sem `href` órfão. */
export function canonicalRun(run: InlineRun): InlineRun {
  const marks = sortMarks(run.marks ?? []);
  const next: InlineRun = { text: run.text };
  if (marks.length > 0) next.marks = marks;
  // `href` sem a marca `link` seria um dado que a interface nunca mostra.
  if (marks.includes('link') && run.href !== undefined && run.href.length > 0) next.href = run.href;
  return next;
}

export function normalizeInline(inline: InlineText): InlineText {
  const result: InlineText = [];
  for (const raw of inline) {
    if (raw.text.length === 0) continue;
    const run = canonicalRun(raw);
    const previous = result[result.length - 1];
    if (previous !== undefined && sameFormatting(previous, run)) {
      previous.text += run.text;
      continue;
    }
    result.push(run);
  }
  return result;
}

/** Fatia por offset de **texto plano**, mantendo as marcas de cada trecho. */
export function sliceInline(inline: InlineText, start: number, end: number): InlineText {
  const from = Math.max(0, start);
  const to = Math.min(inlineLength(inline), end);
  if (to <= from) return [];
  const result: InlineText = [];
  let cursor = 0;
  for (const run of inline) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    if (runEnd <= from || runStart >= to) continue;
    const text = run.text.slice(Math.max(0, from - runStart), Math.min(run.text.length, to - runStart));
    if (text.length > 0) result.push(canonicalRun({ ...run, text }));
  }
  return normalizeInline(result);
}

export function concatInline(...parts: InlineText[]): InlineText {
  return normalizeInline(parts.flat());
}

/** Insere texto plano (sem marca) no offset — o caminho da digitação simples. */
export function insertTextInline(inline: InlineText, offset: number, text: string): InlineText {
  if (text.length === 0) return normalizeInline(inline);
  const length = inlineLength(inline);
  const at = Math.max(0, Math.min(length, offset));
  // Herda a formatação do caractere à esquerda: digitar no fim de um trecho em
  // negrito continua em negrito, que é o que qualquer editor faz.
  const left = sliceInline(inline, 0, at);
  const anchor = left[left.length - 1];
  const inserted: InlineText = [anchor === undefined ? { text } : canonicalRun({ ...anchor, text })];
  return concatInline(left, inserted, sliceInline(inline, at, length));
}

function runHasMark(run: InlineRun, mark: InlineMark, href?: string): boolean {
  if (!(run.marks ?? []).includes(mark)) return false;
  if (mark !== 'link') return true;
  return href === undefined || (run.href ?? '') === href;
}

/**
 * Liga/desliga uma marca num intervalo. O comportamento é o de qualquer
 * editor: se **todo** o intervalo já tem a marca, o comando a remove; se
 * alguma parte não tem, o comando a aplica no intervalo inteiro.
 *
 * `link` é a única marca com dado junto (`href`): aplicar troca o destino de
 * todo o intervalo, e remover apaga marca e destino.
 */
export function toggleMarkInline(
  inline: InlineText,
  start: number,
  end: number,
  mark: InlineMark,
  href?: string,
): InlineText {
  const length = inlineLength(inline);
  const from = Math.max(0, Math.min(length, start));
  const to = Math.max(0, Math.min(length, end));
  if (to <= from) return normalizeInline(inline);

  const middle = sliceInline(inline, from, to);
  const active = middle.every((run) => runHasMark(run, mark, href));
  const marked = middle.map((run) => {
    const marks = (run.marks ?? []).filter((candidate) => candidate !== mark);
    if (active) return canonicalRun({ text: run.text, marks, ...(run.href !== undefined ? { href: run.href } : {}) });
    return canonicalRun({
      text: run.text,
      marks: [...marks, mark],
      ...(mark === 'link' ? { href } : run.href !== undefined ? { href: run.href } : {}),
    });
  });

  return concatInline(sliceInline(inline, 0, from), marked, sliceInline(inline, to, length));
}

/** `true` quando o intervalo inteiro carrega a marca — estado do botão da toolbar. */
export function hasMarkInline(inline: InlineText, start: number, end: number, mark: InlineMark): boolean {
  const middle = sliceInline(inline, start, end);
  return middle.length > 0 && middle.every((run) => runHasMark(run, mark));
}
