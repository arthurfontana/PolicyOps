import { decodeCellKey } from '../axes/paths';
import type { CatalogItem, CatalogItemKind, Cell, PolicyOpsDocument } from '../document/schema';
import type { CellChange, CellChangeKind, DiffedCellField, VersionDiff } from '../diff/types';
import { buildCsv, decimalToCommaString } from './csv-format';

/**
 * CSV do diff — docs/08-camada-de-comandos.md §5:
 * `caminho_x;caminho_y;campo;antes;depois;tipo`, uma linha por campo alterado
 * (não por célula — uma célula com 3 campos mudados vira 3 linhas, o que é o
 * que torna o arquivo filtrável por campo numa tabela dinâmica).
 */

const FIELD_LABELS: Record<DiffedCellField, string> = {
  decision: 'decisao',
  offer: 'oferta',
  limit: 'limite',
  limitOverride: 'limite_valor',
  limitMin: 'limite_minimo',
  limitMax: 'limite_maximo',
  color: 'cor',
  note: 'observacao',
  attrs: 'atributos',
};

const KIND_LABELS: Record<CellChangeKind, string> = {
  ADDED: 'ADICIONADA',
  REMOVED: 'REMOVIDA',
  MODIFIED: 'MODIFICADA',
};

const CELL_FIELD_ORDER: DiffedCellField[] = [
  'decision',
  'offer',
  'limit',
  'limitOverride',
  'limitMin',
  'limitMax',
  'color',
  'note',
  'attrs',
];

function catalogIndex(doc: PolicyOpsDocument): Map<CatalogItemKind, Map<string, CatalogItem>> {
  const index = new Map<CatalogItemKind, Map<string, CatalogItem>>();
  for (const item of doc.catalog) {
    if (!index.has(item.kind)) index.set(item.kind, new Map());
    index.get(item.kind)!.set(item.code, item);
  }
  return index;
}

function formatFieldValue(
  field: DiffedCellField,
  value: Cell[keyof Cell] | undefined,
  catalog: Map<CatalogItemKind, Map<string, CatalogItem>>,
): string {
  if (value === undefined) return '';
  if (field === 'decision') return catalog.get('DECISION')?.get(value as string)?.label ?? String(value);
  if (field === 'offer') return catalog.get('OFFER')?.get(value as string)?.label ?? String(value);
  if (field === 'limitOverride' || field === 'limitMin' || field === 'limitMax') {
    return decimalToCommaString(value as string);
  }
  if (field === 'attrs') return JSON.stringify(value);
  return String(value);
}

function definedFields(cell: Cell): DiffedCellField[] {
  return CELL_FIELD_ORDER.filter((field) => cell[field as keyof Cell] !== undefined);
}

function rowsForChange(change: CellChange, catalog: Map<CatalogItemKind, Map<string, CatalogItem>>): string[][] {
  const { xPath, yPath } = decodeCellKey(change.key);
  const tipo = KIND_LABELS[change.kind];

  if (change.kind === 'MODIFIED') {
    return change.fields.map((field) => [
      xPath,
      yPath,
      FIELD_LABELS[field],
      formatFieldValue(field, change.before[field as keyof Cell], catalog),
      formatFieldValue(field, change.after[field as keyof Cell], catalog),
      tipo,
    ]);
  }

  if (change.kind === 'ADDED') {
    return definedFields(change.after).map((field) => [
      xPath,
      yPath,
      FIELD_LABELS[field],
      '',
      formatFieldValue(field, change.after[field as keyof Cell], catalog),
      tipo,
    ]);
  }

  return definedFields(change.before).map((field) => [
    xPath,
    yPath,
    FIELD_LABELS[field],
    formatFieldValue(field, change.before[field as keyof Cell], catalog),
    '',
    tipo,
  ]);
}

export function exportDiffCsv(doc: PolicyOpsDocument, diff: VersionDiff): string {
  const catalog = catalogIndex(doc);
  const header = ['caminho_x', 'caminho_y', 'campo', 'antes', 'depois', 'tipo'];
  const rows = diff.cells.flatMap((change) => rowsForChange(change, catalog));
  return buildCsv([header, ...rows]);
}

/** `diff_{matrixCode}_v{aNumber}_v{bNumber}.csv` — mesmo esquema de nome do export de versão. */
export function diffCsvFileName(matrixCode: string, aNumber: number, bNumber: number): string {
  return `diff_${matrixCode}_v${aNumber}_v${bNumber}.csv`;
}
