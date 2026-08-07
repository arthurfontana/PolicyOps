function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `aaaammdd` — parte comum de todo nome de export (docs/08 §5). */
export function dateStamp(at: Date = new Date()): string {
  return `${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}`;
}

/** `{matrixCode}_v{n}_{aaaammdd}.{extension}` — docs/08-camada-de-comandos.md §5. */
export function exportFileName(
  matrixCode: string,
  versionNumber: number,
  extension: string,
  at: Date = new Date(),
): string {
  return `${matrixCode}_v${versionNumber}_${dateStamp(at)}.${extension}`;
}
