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
