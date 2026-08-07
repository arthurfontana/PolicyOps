/**
 * Datas da tela de vigência — docs/07-ux-e-editor.md §10. Nativo (`Date`),
 * como o resto do app faz (`lib/format.ts`, `lib/matrix-badges.ts`); nenhuma
 * dependência nova.
 */

/** `yyyy-MM-dd` em fuso local — o valor de um `<input type="date">`. */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** O inverso, lido como data **local** — não `new Date(value)`, que interpretaria como UTC meia-noite. */
export function fromDateInputValue(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/**
 * O instante consultado por uma data escolhida no seletor: fim daquele dia,
 * fuso local — inclui tudo que vigorou em algum momento daquele dia, inclusive
 * uma publicação feita mais tarde no mesmo dia de "hoje".
 */
export function endOfDayInstant(value: string): Date {
  const date = fromDateInputValue(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

/** `yyyy-MM-dd` → `dd/mm/aaaa`, sem passar por `Date` — evita qualquer fuso na formatação. */
export function formatDateInputBR(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function startOfYear(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1);
}

export type DateShortcut = { label: string; resolve: () => Date };

/** Atalhos de docs/07 §10: Hoje · Início do mês · 30/90 dias atrás · Início do ano. */
export const DATE_SHORTCUTS: DateShortcut[] = [
  { label: 'Hoje', resolve: () => new Date() },
  { label: 'Início do mês', resolve: startOfMonth },
  { label: '30 dias atrás', resolve: () => daysAgo(30) },
  { label: '90 dias atrás', resolve: () => daysAgo(90) },
  { label: 'Início do ano', resolve: startOfYear },
];
