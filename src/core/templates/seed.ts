import { encodeCellKey } from '../axes/paths';
import type { CatalogItem, CatalogItemKind, Cell, SeedRule, Template } from '../document/schema';
import { matchesPathMatcher } from './matcher';

/**
 * Preenchimento de células a partir de um template — docs/05-regras-de-negocio.md §8.
 *
 * 1. `defaults` em todas as combinações.
 * 2. `seedRules` em ordem, a última vencendo na mesma célula.
 * 3. Regra cujo `set` cita um código de catálogo inexistente (ou arquivado)
 *    é ignorada inteira e devolvida em `skippedRules` — não quebra a
 *    instanciação, e a célula que ela cobriria simplesmente não recebe nada
 *    dela (outras regras aplicáveis àquela célula continuam valendo).
 */

export type SkippedSeedRule = { index: number; rule: SeedRule; reason: string };

export type BuildSeedCellsInput = {
  xTuples: string[];
  yTuples: string[];
  defaults?: Template['defaults'];
  seedRules: SeedRule[];
  catalog: CatalogItem[];
};

export type BuildSeedCellsResult = {
  cells: Record<string, Cell>;
  skippedRules: SkippedSeedRule[];
};

const SET_CATALOG_FIELDS: Array<{
  field: 'decision' | 'offer' | 'limit';
  kind: CatalogItemKind;
  label: string;
}> = [
  { field: 'decision', kind: 'DECISION', label: 'decisões' },
  { field: 'offer', kind: 'OFFER', label: 'ofertas' },
  { field: 'limit', kind: 'LIMIT', label: 'limites' },
];

/** Primeiro código de `set` que não existe no catálogo (ou está arquivado), se houver. */
function invalidCatalogRef(
  set: SeedRule['set'],
  catalog: CatalogItem[],
): { code: string; label: string } | null {
  for (const { field, kind, label } of SET_CATALOG_FIELDS) {
    const code = set[field];
    if (code === undefined) continue;
    const exists = catalog.some(
      (item) => item.kind === kind && item.code === code && item.archivedAt === undefined,
    );
    if (!exists) return { code, label };
  }
  return null;
}

function applySet(cell: Cell | undefined, set: SeedRule['set']): Cell {
  const next: Cell = { ...cell };
  if (set.decision !== undefined) next.decision = set.decision;
  if (set.offer !== undefined) next.offer = set.offer;
  if (set.limit !== undefined) next.limit = set.limit;
  if (set.color !== undefined) next.color = set.color;
  return next;
}

export function buildSeedCells(input: BuildSeedCellsInput): BuildSeedCellsResult {
  const cells: Record<string, Cell> = {};

  const defaults = input.defaults;
  if (
    defaults !== undefined &&
    (defaults.decision !== undefined || defaults.offer !== undefined || defaults.limit !== undefined)
  ) {
    for (const yPath of input.yTuples) {
      for (const xPath of input.xTuples) {
        cells[encodeCellKey(xPath, yPath)] = applySet(undefined, defaults);
      }
    }
  }

  const skippedRules: SkippedSeedRule[] = [];
  input.seedRules.forEach((rule, index) => {
    const invalid = invalidCatalogRef(rule.set, input.catalog);
    if (invalid !== null) {
      skippedRules.push({
        index,
        rule,
        reason: `O código "${invalid.code}" não existe no catálogo de ${invalid.label} (ou está arquivado) — a biblioteca pode ter evoluído desde a criação do template.`,
      });
      return;
    }
    for (const yPath of input.yTuples) {
      if (!matchesPathMatcher(rule.when.y, yPath)) continue;
      for (const xPath of input.xTuples) {
        if (!matchesPathMatcher(rule.when.x, xPath)) continue;
        const key = encodeCellKey(xPath, yPath);
        cells[key] = applySet(cells[key], rule.set);
      }
    }
  });

  return { cells, skippedRules };
}
