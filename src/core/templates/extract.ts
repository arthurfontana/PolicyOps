import type { MatrixVersion, Template } from '../document/schema';

/**
 * Extração de eixos e defaults a partir de uma matriz existente — botão
 * "Criar template a partir desta matriz" (docs/07-ux-e-editor.md §11).
 * **Regras não são inferidas**: só eixos e o valor mais frequente de cada
 * campo entre as células preenchidas viram `defaults`; o construtor de
 * regras começa vazio para o usuário montar à mão.
 */
export type ExtractedTemplateSeed = {
  axes: Template['axes'];
  defaults?: Template['defaults'];
};

/** O código mais frequente da lista, ou `undefined` se ela estiver vazia. */
function mode(codes: string[]): string | undefined {
  if (codes.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  let best: string | undefined;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

export function extractTemplateSeed(version: MatrixVersion): ExtractedTemplateSeed {
  const axes: Template['axes'] = {
    x: {
      levels: version.axes.x.levels.map((level) => ({ variableId: level.variableId, label: level.label })),
    },
    y: {
      levels: version.axes.y.levels.map((level) => ({ variableId: level.variableId, label: level.label })),
    },
  };

  const cells = Object.values(version.cells);
  const decision = mode(cells.map((cell) => cell.decision).filter((code): code is string => code !== undefined));
  const offer = mode(cells.map((cell) => cell.offer).filter((code): code is string => code !== undefined));
  const limit = mode(cells.map((cell) => cell.limit).filter((code): code is string => code !== undefined));

  const defaults: Template['defaults'] = {};
  if (decision !== undefined) defaults.decision = decision;
  if (offer !== undefined) defaults.offer = offer;
  if (limit !== undefined) defaults.limit = limit;

  return Object.keys(defaults).length > 0 ? { axes, defaults } : { axes };
}
