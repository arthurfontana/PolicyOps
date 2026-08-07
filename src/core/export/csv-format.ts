import { exportFileName } from './filename';

/**
 * Utilidades compartilhadas dos exports CSV — docs/08-camada-de-comandos.md §5:
 * separador `;`, decimal com vírgula, UTF-8 **com BOM** (sem isso o Excel em
 * português abre errado).
 */

export const CSV_SEP = ';';
export const CSV_NEWLINE = '\r\n';
export const CSV_BOM = '\uFEFF';

/** Só entra aspas quando o valor precisa — mantém o CSV legível a olho nu. */
export function csvEscape(value: string): string {
  if (value === '') return '';
  if (/["\r\n]/.test(value) || value.includes(CSV_SEP)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function csvLine(fields: string[]): string {
  return fields.map(csvEscape).join(CSV_SEP);
}

export function buildCsv(rows: string[][]): string {
  return CSV_BOM + rows.map(csvLine).join(CSV_NEWLINE) + CSV_NEWLINE;
}

/** "5000.50" → "5000,50" — decimal nunca é `number` (docs/03 §1); só troca o separador. */
export function decimalToCommaString(value: string): string {
  return value.replace('.', ',');
}

/** `{matrixCode}_v{n}_{aaaammdd}.csv` — docs/08 §5. */
export function csvFileName(matrixCode: string, versionNumber: number, at: Date = new Date()): string {
  return exportFileName(matrixCode, versionNumber, 'csv', at);
}
