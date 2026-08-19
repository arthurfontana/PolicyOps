import type { PolicyComponentType } from '@/core/document/schema';
import type { PolicySnapshot, PolicySnapshotNode } from '@/core/timeline/policy-at';

/**
 * As linhas da aba **Estrutura** da tela de Vigência — docs/07-ux-e-editor.md
 * §10. Puro: recebe a fotografia que `getPolicyAt` (docs/05 §6.2) já produziu
 * e devolve o que a árvore de leitura desenha, na mesma ordem. Fica fora do
 * componente porque é o trabalho que "abrir a data" custa — e é o que o teste
 * de desempenho mede, sem precisar de DOM.
 */

/** Uma linha da árvore da data: o nó da fotografia mais o que a lista precisa para desenhar. */
export type StructureRow = {
  key: string;
  node: PolicySnapshotNode;
  name: string;
  code: string;
  /** `null` na matriz sem componente espelho — desenha com o ícone de matriz. */
  type: PolicyComponentType | null;
  /** 0-based, como o recuo de `TreeNodeRow`. */
  depth: number;
  hasChildren: boolean;
  /** Ancestral preservado pelo filtro sem ter passado nele (§17.1). */
  dimmed: boolean;
};

export type StructureFilter = {
  matchedIds: Set<string>;
  visibleIds: Set<string>;
  /** Busca já normalizada; `''` quando não há busca. */
  search: string;
  /** Tipos selecionados — a matriz sem espelho só entra se `MATRIX` couber. */
  types: PolicyComponentType[];
  /** Filtros que só existem em componente: com qualquer um deles, matriz órfã sai. */
  componentOnly: boolean;
};

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Filtro da matriz sem componente espelho (DEC-GOV-039): ela não está em
 * `filterComponentTree` — não tem componente para filtrar —, então a busca e o
 * tipo são aplicados aqui, e qualquer filtro de revisão/tag (que só existe em
 * componente) a deixa de fora em vez de fingir que ela passou.
 */
function orphanPasses(row: { name: string; code: string }, filter: StructureFilter): boolean {
  if (filter.componentOnly) return false;
  if (filter.types.length > 0 && !filter.types.includes('MATRIX')) return false;
  if (filter.search === '') return true;
  const needle = normalize(filter.search);
  return normalize(row.name).includes(needle) || normalize(row.code).includes(needle);
}

/**
 * As linhas da árvore da data, na ordem de leitura de `getPolicyAt`.
 *
 * Função pura e exportada de propósito: é o trabalho que "abrir a data" custa,
 * e é o que o teste de desempenho mede (300 componentes + 102 matrizes em
 * menos de 500 ms, o orçamento da S39).
 */
export function buildStructureRows(
  snapshot: PolicySnapshot,
  filter: StructureFilter | null,
): StructureRow[] {
  const parents = new Set<string>();
  for (const node of snapshot.nodes) {
    const parent = node.ancestors[node.ancestors.length - 1];
    if (parent !== undefined) parents.add(parent.id);
  }

  const rows: StructureRow[] = [];
  for (const node of snapshot.nodes) {
    const name = node.component?.name ?? node.matrix?.name ?? '—';
    const code = node.component?.code ?? node.matrix?.code ?? '';

    if (filter !== null) {
      if (node.component === null) {
        if (!orphanPasses({ name, code }, filter)) continue;
      } else if (!filter.visibleIds.has(node.component.id)) {
        continue;
      }
    }

    rows.push({
      key: node.key,
      node,
      name,
      code,
      type: node.component?.type ?? null,
      depth: node.depth - 1,
      hasChildren: node.component !== null && parents.has(node.component.id),
      dimmed:
        filter !== null && node.component !== null && !filter.matchedIds.has(node.component.id),
    });
  }
  return rows;
}
