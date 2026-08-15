import { componentDepth } from '../document/components';
import {
  POLICY_COMPONENT_MAX_DEPTH,
  type ComponentOrigin,
  type ComponentPayload,
  type PolicyComponentType,
  type PolicyOpsDocument,
} from '../document/schema';
import { hasBlockingIssue, importIssue, type ImportIssue } from './issues';
import { buildPayload, MARKDOWN_COMPONENT_TYPES, type MarkdownComponentNode, type MarkdownParseResult } from './markdown-policy';

/**
 * Passo de revisão da carga por recorte — docs/14-governanca-de-alteracoes.md
 * §9 passo 2/3, docs/prompts/S40-carga-de-componentes.md.
 *
 * Achata a árvore que `parseMarkdownPolicy` devolveu numa lista de linhas
 * revisáveis: aplica o destino escolhido (a seção da árvore do projeto, ou a
 * raiz), calcula a profundidade absoluta contra I28, marca duplicata de
 * `code` contra o que já existe no projeto (E-GOV-06) e aplica as escolhas do
 * usuário — tipo trocado por linha, linha excluída (e a subárvore dela
 * junto). É **dry-run puro**, como `planImport` da carga de matrizes: nada é
 * gravado no documento aqui.
 */

export type MarkdownImportRow = {
  tempId: string;
  parentTempId?: string;
  /** Nível absoluto na árvore do projeto, já somando o destino (1 = raiz do projeto). */
  depth: number;
  name: string;
  code: string;
  type: PolicyComponentType;
  /** `EXPLICIT` quando veio de `> Tipo:` no Markdown **ou** foi trocado na revisão. */
  typeSource: 'EXPLICIT' | 'HEURISTIC';
  payload: ComponentPayload;
  origin?: ComponentOrigin;
  /** Fora da carga por escolha do usuário — leva a subárvore inteira junto. */
  excluded: boolean;
  issues: ImportIssue[];
};

export type MarkdownImportPlan = {
  projectId: string;
  /** Ausente = raiz do projeto. */
  parentId?: string;
  /** Pré-ordem — pai sempre antes dos filhos, o que a aplicação depende para reparentar por `tempId`. */
  rows: MarkdownImportRow[];
  totals: { total: number; byType: Partial<Record<PolicyComponentType, number>> };
  /** Problemas de nível de documento — do parser (nenhum heading, texto perdido) ou do destino. */
  issues: ImportIssue[];
  /** Alguma linha não excluída tem problema bloqueante, ou não sobrou nenhuma linha para aplicar. */
  blocked: boolean;
};

export type PlanMarkdownImportInput = {
  doc: PolicyOpsDocument;
  projectId: string;
  /** Seção escolhida como destino; ausente = raiz do projeto (docs/14 §9 passo 2). */
  parentId?: string;
  parsed: MarkdownParseResult;
  /** `tempId` das linhas que o usuário excluiu no passo de revisão. */
  excludedTempIds?: readonly string[];
  /** `tempId` → tipo escolhido na revisão, quando diferente do que o parser propôs. */
  typeOverrides?: ReadonlyMap<string, PolicyComponentType>;
};

type FlatNode = { node: MarkdownComponentNode; parentTempId: string | undefined; depth: number };

function flatten(nodes: readonly MarkdownComponentNode[], parentTempId: string | undefined, depth: number, out: FlatNode[]): void {
  for (const node of nodes) {
    out.push({ node, parentTempId, depth });
    flatten(node.children, node.tempId, depth + 1, out);
  }
}

export function planMarkdownImport(input: PlanMarkdownImportInput): MarkdownImportPlan {
  const { doc, projectId, parentId, parsed } = input;
  const excludedByUser = new Set(input.excludedTempIds ?? []);
  const overrides = input.typeOverrides ?? new Map<string, PolicyComponentType>();

  const issues: ImportIssue[] = [...parsed.issues];

  let destinationOk = true;
  let baseDepth = 0;
  if (parentId !== undefined) {
    const parent = doc.components.find((candidate) => candidate.id === parentId);
    if (parent === undefined || parent.projectId !== projectId) {
      destinationOk = false;
      issues.push(
        importIssue(
          'COMPONENT_TREE_INVALID',
          'O destino escolhido não existe mais neste projeto — volte ao passo anterior e escolha outro.',
        ),
      );
    } else if (parent.type === 'MATRIX') {
      destinationOk = false;
      issues.push(
        importIssue(
          'COMPONENT_TREE_INVALID',
          `"${parent.name}" é uma matriz e não pode receber componentes — escolha outro destino.`,
        ),
      );
    } else {
      baseDepth = componentDepth(doc, parent);
    }
  }

  const flat: FlatNode[] = [];
  flatten(parsed.roots, undefined, 1, flat);

  const existingCodes = new Map(
    doc.components.filter((candidate) => candidate.projectId === projectId).map((candidate) => [candidate.code, candidate]),
  );

  const excludedTransitively = new Set<string>();
  function isExcluded(tempId: string, parentTempId: string | undefined): boolean {
    if (!destinationOk) return true;
    if (excludedByUser.has(tempId)) return true;
    return parentTempId !== undefined && excludedTransitively.has(parentTempId);
  }

  const rows: MarkdownImportRow[] = [];
  const totals: MarkdownImportPlan['totals'] = { total: 0, byType: {} };

  for (const { node, parentTempId, depth: relativeDepth } of flat) {
    const override = overrides.get(node.tempId);
    const type = override ?? node.type;
    const excluded = isExcluded(node.tempId, parentTempId);
    if (excluded) excludedTransitively.add(node.tempId);

    const absoluteDepth = baseDepth + relativeDepth;
    const rowIssues: ImportIssue[] = [...node.issues];
    if (absoluteDepth > POLICY_COMPONENT_MAX_DEPTH) {
      rowIssues.push(
        importIssue(
          'COMPONENT_TREE_INVALID',
          `"${node.name}" ficaria no nível ${absoluteDepth} — a árvore da política tem no máximo ${POLICY_COMPONENT_MAX_DEPTH} níveis.`,
        ),
      );
    }
    const existing = existingCodes.get(node.code);
    if (existing !== undefined) {
      rowIssues.push(
        importIssue(
          'COMPONENT_CODE_DUPLICATE',
          `"${node.code}" já existe neste projeto, no componente "${existing.name}" — exclua esta linha ou ajuste a origem antes de confirmar.`,
          { details: { componentId: existing.id } },
        ),
      );
    }

    if (!excluded) {
      totals.total += 1;
      totals.byType[type] = (totals.byType[type] ?? 0) + 1;
    }

    const payload = override === undefined ? node.payload : buildPayload(type, node.businessDescription, node.markers);

    const row: MarkdownImportRow = {
      tempId: node.tempId,
      depth: absoluteDepth,
      name: node.name,
      code: node.code,
      type,
      typeSource: override === undefined ? node.typeSource : 'EXPLICIT',
      payload,
      excluded,
      issues: rowIssues,
    };
    if (parentTempId !== undefined) row.parentTempId = parentTempId;
    if (node.origin !== undefined) row.origin = node.origin;
    rows.push(row);
  }

  const blocked =
    !destinationOk || rows.filter((row) => !row.excluded).length === 0 || rows.some((row) => !row.excluded && hasBlockingIssue(row.issues));

  const plan: MarkdownImportPlan = { projectId, rows, totals, issues, blocked };
  if (parentId !== undefined) plan.parentId = parentId;
  return plan;
}

/** Os tipos que uma linha pode assumir na revisão — `MATRIX` fica de fora (docs/14 §9). */
export const MARKDOWN_ROW_TYPES = MARKDOWN_COMPONENT_TYPES;
