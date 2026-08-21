import { allCombinations } from '../axes/combinations';
import { decodePath } from '../axes/paths';
import type { Axis, CatalogItem, CatalogItemKind, MatrixVersion, PolicyOpsDocument } from '../document/schema';
import { buildCsv, csvFileName, decimalToCommaString } from './csv-format';

export { csvFileName };

/**
 * CSV do grid — docs/08-camada-de-comandos.md §5: uma linha por **combinação**
 * (não só por célula preenchida — é o retângulo completo que uma tabela
 * dinâmica do Excel espera), uma coluna por nível de cada eixo.
 */

function variableCodesOf(doc: PolicyOpsDocument, axis: Axis): string[] {
  return axis.levels.map(
    (level) => doc.variables.find((candidate) => candidate.id === level.variableId)?.code ?? level.variableId,
  );
}

function domainLabelLookups(axis: Axis): Array<Map<string, string>> {
  return axis.levels.map((level) => new Map(level.domains.map((domain) => [domain.code, domain.label])));
}

function labelsFor(path: string, lookups: Array<Map<string, string>>): string[] {
  return decodePath(path).map((code, index) => lookups[index]?.get(code) ?? code);
}

function catalogIndex(doc: PolicyOpsDocument): Map<CatalogItemKind, Map<string, CatalogItem>> {
  const index = new Map<CatalogItemKind, Map<string, CatalogItem>>();
  for (const item of doc.catalog) {
    if (!index.has(item.kind)) index.set(item.kind, new Map());
    index.get(item.kind)!.set(item.code, item);
  }
  return index;
}

export function exportVersionCsv(doc: PolicyOpsDocument, version: MatrixVersion): string {
  const catalog = catalogIndex(doc);
  const limitByCode = catalog.get('LIMIT') ?? new Map<string, CatalogItem>();

  const xCodes = variableCodesOf(doc, version.axes.x);
  const yCodes = variableCodesOf(doc, version.axes.y);
  const xLookups = domainLabelLookups(version.axes.x);
  const yLookups = domainLabelLookups(version.axes.y);

  const header = [
    ...xCodes.map((code) => `x_${code}`),
    ...yCodes.map((code) => `y_${code}`),
    'decisao',
    'oferta',
    'limite',
    'limite_valor',
    'limite_minimo',
    'limite_maximo',
    'cor',
    'observacao',
  ];

  const rows = allCombinations(version).map(({ xPath, yPath, key }) => {
    const cell = version.cells[key];
    const decision =
      cell?.decision !== undefined ? (catalog.get('DECISION')?.get(cell.decision)?.label ?? cell.decision) : '';
    const offer = cell?.offer !== undefined ? (catalog.get('OFFER')?.get(cell.offer)?.label ?? cell.offer) : '';
    const limitValue = cell?.limitOverride ?? limitByCode.get(cell?.limit ?? '')?.numericValue;
    return [
      ...labelsFor(xPath, xLookups),
      ...labelsFor(yPath, yLookups),
      decision,
      offer,
      cell?.limit ?? '',
      limitValue !== undefined ? decimalToCommaString(limitValue) : '',
      cell?.limitMin !== undefined ? decimalToCommaString(cell.limitMin) : '',
      cell?.limitMax !== undefined ? decimalToCommaString(cell.limitMax) : '',
      cell?.color ?? '',
      cell?.note ?? '',
    ];
  });

  return buildCsv([header, ...rows]);
}
