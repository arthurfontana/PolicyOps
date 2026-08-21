/** Formatação de data/hora em pt-BR — docs/07-ux-e-editor.md §4.2, item 4 da S13. */

const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: 'year', seconds: 60 * 60 * 24 * 365 },
  { unit: 'month', seconds: 60 * 60 * 24 * 30 },
  { unit: 'week', seconds: 60 * 60 * 24 * 7 },
  { unit: 'day', seconds: 60 * 60 * 24 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
];

const relativeFormatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

/** "há 3 dias" / "em 2 horas" — sempre no passado neste app, mas o formatter cobre os dois sentidos. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffSeconds = (then - now.getTime()) / 1000;
  if (Math.abs(diffSeconds) < 30) return 'agora mesmo';

  for (const { unit, seconds } of RELATIVE_UNITS) {
    if (Math.abs(diffSeconds) >= seconds) {
      return relativeFormatter.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return relativeFormatter.format(Math.round(diffSeconds / 60), 'minute');
}

/** Data e hora absolutas, pt-BR — usado no tooltip do tempo relativo. */
export function formatDateTimeBR(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

/** Só a data, pt-BR. */
export function formatDateBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

/** `YYYY-MM-DD` local — o valor de um `<input type="date">`, a partir de um `Date`. */
export function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `YYYY-MM-DD` local — o mesmo valor, a partir de uma data ISO 8601 UTC já gravada no documento. */
export function isoToDateInputValue(iso: string): string {
  return dateInputValue(new Date(iso));
}

/** O valor de um `<input type="date">` de volta para ISO 8601 UTC, meia-noite. */
export function dateInputToIso(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Valor decimal (string, nunca `number` — docs/03 §1) em BRL, pt-BR. */
export function formatBRL(value: string | undefined): string {
  if (value === undefined || value === '') return '—';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? currencyFormatter.format(parsed) : value;
}

/** Faixa de limite (mín/máx) em BRL, pt-BR — modo alternativo ao valor único de catálogo. */
export function formatBRLRange(min: string | undefined, max: string | undefined): string {
  if (min === undefined && max === undefined) return '—';
  if (min !== undefined && max !== undefined) return `${formatBRL(min)} – ${formatBRL(max)}`;
  if (min !== undefined) return `a partir de ${formatBRL(min)}`;
  return `até ${formatBRL(max)}`;
}

/** Milhar com separador pt-BR, sem casas decimais — contadores e estatísticas. */
export function formatThousands(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}
