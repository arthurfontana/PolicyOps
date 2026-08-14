import { toPng } from 'html-to-image';
import { dateStamp, exportFileName } from '@/core/export/filename';

/**
 * Export PNG do grid — docs/02-arquitetura.md §2 (`html-to-image`, roda no
 * cliente) e docs/08-camada-de-comandos.md §5: escala 2×, o nó já traz título,
 * versão, vigência e legenda (`GridExportSnapshot`) — a imagem se explica
 * sozinha, sem precisar do resto da aplicação em volta.
 */
export async function exportNodeAsPng(node: HTMLElement, fileName: string): Promise<void> {
  const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true });
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** `{matrixCode}_v{n}_{aaaammdd}.png` — mesmo esquema de nome do CSV (docs/08 §5). */
export function pngFileName(matrixCode: string, versionNumber: number, at: Date = new Date()): string {
  return exportFileName(matrixCode, versionNumber, 'png', at);
}

/**
 * `Comparacao_{codigos}_{aaaammdd}.png` — nome do PNG do board de
 * comparação (§9b). Até 3 códigos no nome; além disso, `+N` no lugar do
 * resto, para o nome do arquivo não virar uma linha inteira.
 */
export function boardPngFileName(matrixCodes: string[], at: Date = new Date()): string {
  const shown = matrixCodes.slice(0, 3).join('-');
  const rest = matrixCodes.length > 3 ? `+${matrixCodes.length - 3}` : '';
  return `Comparacao_${shown}${rest}_${dateStamp(at)}.png`;
}
