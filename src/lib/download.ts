/** Download de arquivo gerado no cliente — sem requisição de rede (docs/02 §2). */

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  downloadBlob(fileName, new Blob([content], { type: mimeType }));
}

export function downloadJson(fileName: string, data: unknown): void {
  downloadTextFile(fileName, JSON.stringify(data, null, 2), 'application/json');
}

/** `;`-CSV com BOM já embutido pelo próprio conteúdo (`src/core/export/csv-format.ts`). */
export function downloadCsv(fileName: string, csv: string): void {
  downloadTextFile(fileName, csv, 'text/csv;charset=utf-8');
}
