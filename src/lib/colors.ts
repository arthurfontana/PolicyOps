import type { Cell } from '@/core/document/schema';
import type { EditorCatalog } from '@/core/queries';

/**
 * Cor da célula e contraste de texto — docs/05-regras-de-negocio.md §3.
 *
 * `src/core/` não pode depender de nada de apresentação, então a prioridade
 * de cor (que é regra de negócio) mora aqui, em `src/lib/`, e não em
 * `src/core/`: ela só é consumida pelo grid, nunca por um comando.
 */

/** Preenchida, sem cor própria nem cor herdada de decisão/oferta. */
export const NEUTRAL_CELL_COLOR = '#E5E7EB';
/** Pendente: hachura diagonal por cima desta cor de fundo. */
export const PENDING_CELL_COLOR = '#F3F4F6';

/** Uma combinação está pendente quando não há decisão — nunca armazenado, sempre derivado (docs/04 §6). */
export function isCellPending(cell: Cell | undefined): boolean {
  return cell?.decision === undefined;
}

/**
 * Prioridade, do mais forte ao mais fraco (docs/05 §3):
 * 1. `cell.color`
 * 2. cor do item de catálogo da decisão
 * 3. cor do item de catálogo da oferta
 * 4. cinza neutro (preenchida, sem cor)
 * 5. cinza claro (pendente) — o grid soma a hachura por cima
 */
export function resolveCellColor(cell: Cell | undefined, catalog: EditorCatalog): string {
  if (cell?.color !== undefined) return cell.color;

  const decisionItem = cell?.decision !== undefined ? catalog.byCode.DECISION[cell.decision] : undefined;
  if (decisionItem?.color !== undefined) return decisionItem.color;

  const offerItem = cell?.offer !== undefined ? catalog.byCode.OFFER[cell.offer] : undefined;
  if (offerItem?.color !== undefined) return offerItem.color;

  if (isCellPending(cell)) return PENDING_CELL_COLOR;
  return NEUTRAL_CELL_COLOR;
}

/** Um canal sRGB (0–255) para o espaço linear usado na luminância relativa (WCAG). */
function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

/** Luminância relativa de uma cor `#RRGGBB`, no intervalo [0, 1]. */
export function relativeLuminance(hexColor: string): number {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

/** Limiar de docs/05 §3: preto se a luminância do fundo > 0,55; branco caso contrário. */
export const CONTRAST_THRESHOLD = 0.55;

/** Texto preto sobre fundo claro, branco sobre fundo escuro. */
export function contrastText(backgroundColor: string): '#000000' | '#FFFFFF' {
  return relativeLuminance(backgroundColor) > CONTRAST_THRESHOLD ? '#000000' : '#FFFFFF';
}
