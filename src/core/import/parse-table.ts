import { importIssue, type ImportIssue } from './issues';

/**
 * Leitura do arquivo delimitado — docs/12-carga-de-matrizes.md §5.4.
 *
 * Parser próprio, sem dependência nova e sem nada de navegador: recebe **texto**
 * (a decodificação do arquivo fica em `src/storage/`, docs/12 §5.1) e devolve
 * cabeçalho, linhas e a lista de problemas com a coordenada de cada um.
 *
 * O que ele reconhece sozinho: separador (`;` `,` TAB `|`) pela contagem de
 * ocorrências na linha de cabeçalho, BOM, CRLF/LF, aspas duplas com escape
 * `""` (inclusive com separador e quebra de linha **dentro** do campo) e
 * células vazias. Número de colunas diferente do cabeçalho é erro
 * (`IMPORT_PARSE_ERROR`), nunca tolerado: uma linha torta vira célula no lugar
 * errado, e o custo de descobrir isso depois é alto demais (US-01).
 */

export type Delimiter = ';' | ',' | '\t' | '|';

/** Ordem de desempate da detecção: o `;` do Excel pt-BR primeiro. */
export const DELIMITERS: readonly Delimiter[] = [';', ',', '\t', '|'];

export type DelimitedFormat = {
  delimiter: Delimiter;
  /** 1-based, contada no arquivo original. */
  headerRow: number;
  hasBom: boolean;
  trimValues: boolean;
};

/** O que o motor consome depois do parser — e o que `import/apply` recebe (§5.4). */
export type ImportTable = {
  header: string[];
  rows: string[][];
  /**
   * Linha 1-based do arquivo original onde cada linha de `rows` começa.
   * Só difere de "cabeçalho + índice" quando um campo entre aspas contém
   * quebra de linha; ausente, o motor cai nessa aritmética.
   */
  lines?: number[];
};

export type ParseDelimitedTableResult = {
  /** O formato detectado, já com o que o chamador informou tendo precedência. */
  format: DelimitedFormat;
  header: string[];
  /** Sem a linha de cabeçalho. */
  rows: string[][];
  lines: number[];
  warnings: ImportIssue[];
  errors: ImportIssue[];
};

/** Um registro do arquivo: os campos e a linha 1-based em que ele começa. */
type Record_ = { fields: string[]; line: number };

/**
 * Um registro que começa em `lines[start]` e pode consumir as linhas seguintes,
 * quando um campo entre aspas contém quebra de linha. Só é chamado para linhas
 * que de fato têm aspas.
 */
function readQuotedRecord(
  lines: readonly string[],
  start: number,
  delimiter: Delimiter,
): { fields: string[]; next: number } {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  let index = start;

  for (let current = lines[index]; current !== undefined; current = lines[index]) {
    for (let i = 0; i < current.length; i++) {
      const char = current[i]!;
      if (quoted) {
        if (char !== '"') {
          field += char;
          continue;
        }
        if (current[i + 1] === '"') {
          field += '"';
          i++;
          continue;
        }
        quoted = false;
        continue;
      }
      if (char === '"' && field === '') {
        quoted = true;
        continue;
      }
      if (char === delimiter) {
        fields.push(field);
        field = '';
        continue;
      }
      field += char;
    }
    index++;
    // Aspas ainda abertas: a quebra de linha faz parte do campo.
    if (!quoted) break;
    field += '\n';
  }

  fields.push(field);
  return { fields, next: index };
}

/**
 * Quebra o texto em registros, respeitando aspas duplas. Um campo entre aspas
 * pode conter o separador, quebras de linha e `""` (aspas escapadas).
 *
 * A linha **sem nenhuma aspa** — o caso de praticamente todo arquivo de
 * extração — sai por `String.prototype.split`, sem varredura caractere a
 * caractere. É o que segura o orçamento de 300 ms para 20.000 × 30 (§5.7).
 */
function splitRecords(text: string, delimiter: Delimiter): Record_[] {
  const lines = text.split('\n');
  const records: Record_[] = [];
  let index = 0;

  while (index < lines.length) {
    const current = lines[index]!;
    if (!current.includes('"')) {
      records.push({ fields: current.split(delimiter), line: index + 1 });
      index += 1;
      continue;
    }
    const record = readQuotedRecord(lines, index, delimiter);
    records.push({ fields: record.fields, line: index + 1 });
    index = record.next;
  }

  return records;
}

/** Quantas vezes cada candidato aparece na linha de cabeçalho (§5.4). */
export function detectDelimiter(headerLine: string): Delimiter | undefined {
  let best: Delimiter | undefined;
  let bestCount = 0;
  for (const candidate of DELIMITERS) {
    let count = 0;
    for (const char of headerLine) {
      if (char === candidate) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

const DEFAULT_DELIMITER: Delimiter = ';';

function emptyResult(format: DelimitedFormat, errors: ImportIssue[]): ParseDelimitedTableResult {
  return { format, header: [], rows: [], lines: [], warnings: [], errors };
}

export function parseDelimitedTable(
  text: string,
  format: Partial<DelimitedFormat> = {},
): ParseDelimitedTableResult {
  const detectedBom = text.charCodeAt(0) === 0xfeff;
  const body = (detectedBom ? text.slice(1) : text).replace(/\r\n?/g, '\n');
  const headerRow = format.headerRow ?? 1;
  const trimValues = format.trimValues ?? true;
  const hasBom = format.hasBom ?? detectedBom;

  const physicalLines = body.split('\n');
  const headerLine = physicalLines[headerRow - 1];

  const warnings: ImportIssue[] = [];
  if (headerRow < 1 || headerLine === undefined || headerLine.trim() === '') {
    return emptyResult(
      { delimiter: format.delimiter ?? DEFAULT_DELIMITER, headerRow, hasBom, trimValues },
      [
        importIssue(
          'IMPORT_PARSE_ERROR',
          `O arquivo não tem uma linha de cabeçalho na linha ${headerRow}.`,
          { line: headerRow, details: { headerRow } },
        ),
      ],
    );
  }

  let delimiter = format.delimiter;
  if (delimiter === undefined) {
    const detected = detectDelimiter(headerLine);
    if (detected === undefined) {
      delimiter = DEFAULT_DELIMITER;
      warnings.push(
        importIssue(
          'IMPORT_DELIMITER_NOT_DETECTED',
          `Nenhum separador (";", ",", tabulação ou "|") foi encontrado no cabeçalho — o arquivo foi lido como uma coluna só.`,
          { line: headerRow },
        ),
      );
    } else {
      delimiter = detected;
    }
  }

  const resolved: DelimitedFormat = { delimiter, headerRow, hasBom, trimValues };
  const clean = (value: string): string => (trimValues ? value.trim() : value);

  // O texto anterior ao cabeçalho é descartado antes do parser para que uma
  // aspa aberta em linha de comentário não contamine o resto do arquivo.
  const offset = physicalLines.slice(0, headerRow - 1).reduce((sum, line) => sum + line.length + 1, 0);
  const records = splitRecords(body.slice(offset), delimiter).map((record) => ({
    fields: record.fields.map(clean),
    line: record.line + headerRow - 1,
  }));

  const [headerRecord, ...dataRecords] = records;
  const header = headerRecord!.fields;
  const errors: ImportIssue[] = [];

  header.forEach((name, index) => {
    if (name === '') {
      errors.push(
        importIssue('IMPORT_PARSE_ERROR', `A coluna ${index + 1} do cabeçalho está sem nome.`, {
          line: headerRow,
          details: { index },
        }),
      );
      return;
    }
    if (header.indexOf(name) !== index) {
      errors.push(
        importIssue(
          'IMPORT_PARSE_ERROR',
          `A coluna "${name}" aparece duas vezes no cabeçalho — nomes de coluna precisam ser únicos.`,
          { line: headerRow, column: name, details: { index } },
        ),
      );
    }
  });

  const rows: string[][] = [];
  const lines: number[] = [];
  for (const record of dataRecords) {
    const isBlank = record.fields.length === 1 && record.fields[0]!.trim() === '';
    if (isBlank) continue;
    if (record.fields.length !== header.length) {
      errors.push(
        importIssue(
          'IMPORT_PARSE_ERROR',
          `Linha ${record.line}: ${record.fields.length} colunas, mas o cabeçalho tem ${header.length}.`,
          {
            line: record.line,
            column: header[Math.min(record.fields.length, header.length - 1)],
            details: { expected: header.length, found: record.fields.length },
          },
        ),
      );
      continue;
    }
    rows.push(record.fields);
    lines.push(record.line);
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push(
      importIssue('IMPORT_PARSE_ERROR', 'O arquivo não tem nenhuma linha de dados.', {
        line: headerRow,
      }),
    );
  }

  return { format: resolved, header, rows, lines, warnings, errors };
}

/** A linha 1-based do arquivo para a linha `index` da tabela (§5.4). */
export function sourceLine(table: ImportTable, index: number, headerRow = 1): number {
  return table.lines?.[index] ?? headerRow + 1 + index;
}
