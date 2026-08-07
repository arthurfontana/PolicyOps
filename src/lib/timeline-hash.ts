import { HASH_BY_VIEW } from '@/store/ui-store';

/**
 * `date`/`project` da tela de vigência, refletidos no hash — docs/07-ux-e-editor.md
 * §10: "o link com a data no hash abre a mesma visão para outra pessoa".
 * Funções puras (sem `window`) para ficarem testáveis sem DOM; quem lê e
 * escreve `window.location.hash` é o componente.
 */
export type TimelineHashParams = { date: string | null; projectId: string | null };

export function parseTimelineHash(hash: string): TimelineHashParams {
  const queryIndex = hash.indexOf('?');
  const query = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : '');
  return { date: query.get('date'), projectId: query.get('project') };
}

export function buildTimelineHash(params: TimelineHashParams): string {
  const query = new URLSearchParams();
  if (params.date !== null && params.date !== '') query.set('date', params.date);
  if (params.projectId !== null && params.projectId !== '') query.set('project', params.projectId);
  const queryString = query.toString();
  return queryString === '' ? HASH_BY_VIEW.timeline : `${HASH_BY_VIEW.timeline}?${queryString}`;
}
