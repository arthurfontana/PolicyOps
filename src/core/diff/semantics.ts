import Decimal from 'decimal.js-light';
import type { CatalogItem, Cell, PolicyOpsDocument } from '../document/schema';
import { EMPTY_DIFF_SUMMARY, type CellChange, type DiffSummary } from './types';

/**
 * O resumo semântico do diff — docs/05-regras-de-negocio.md §4.3.
 *
 * É a parte que traduz "12 células mudaram" em "12 células abertas, 8
 * fechadas, 4 ofertas alteradas": a linguagem de quem escreve política de
 * crédito, não a do modelo de dados.
 */

/**
 * Decisões consideradas **aprovadoras**. É o único lugar do sistema que sabe
 * disso, e a resposta vem sempre do `code` do item de catálogo — nunca da cor
 * (que é configurável) nem da posição (que é ordenação de tela).
 *
 * **Ponto de configuração futura:** hoje a lista é fixa. Quando o catálogo
 * ganhar um marcador próprio de "decisão aprovadora" (um campo no
 * `CatalogItem`), é esta constante que sai — e mais nada precisa mudar, porque
 * todo o resto do motor pergunta por `isApprovingDecision`.
 */
export const APPROVING_DECISION_CODES: readonly string[] = ['APROVADO', 'EXCECAO'];

/** Decisão que fecha a combinação — a contraparte explícita de §4.3. */
export const REPROVING_DECISION_CODE = 'REPROVADO';

/** Decisão que manda a combinação para a mesa — `cellsToManualReview`. */
export const MANUAL_REVIEW_DECISION_CODE = 'ANALISE_MANUAL';

export function isApprovingDecision(code: string | undefined): boolean {
  return code !== undefined && APPROVING_DECISION_CODES.includes(code);
}

/**
 * Decisão preenchida que **não** aprova. Célula sem decisão (pendente) não é
 * reprovadora: ela nunca chegou a fechar nada, e por isso preenchê-la com
 * "Aprovado" não conta como "célula aberta".
 */
export function isReprovingDecision(code: string | undefined): boolean {
  return code !== undefined && !isApprovingDecision(code);
}

// ---------------------------------------------------------------------------
// Limite efetivo
// ---------------------------------------------------------------------------

/** Busca O(1) por `code` entre os itens de catálogo do tipo `LIMIT`. */
export type LimitCatalog = Record<string, CatalogItem>;

export function buildLimitCatalog(doc: PolicyOpsDocument): LimitCatalog {
  const byCode: LimitCatalog = {};
  for (const item of doc.catalog) {
    if (item.kind === 'LIMIT') byCode[item.code] = item;
  }
  return byCode;
}

/**
 * Limite efetivo da célula: `limitOverride` quando existe, senão o
 * `numericValue` do item de catálogo referenciado. `null` = sem limite.
 *
 * Sempre `Decimal`, nunca ponto flutuante: os valores vêm como string decimal
 * do documento (docs/03 §1) justamente para não passarem por `number`.
 */
export function effectiveLimit(cell: Cell, limits: LimitCatalog): Decimal | null {
  if (cell.limitOverride !== undefined) return new Decimal(cell.limitOverride);
  if (cell.limit === undefined) return null;
  const numericValue = limits[cell.limit]?.numericValue;
  if (numericValue === undefined) return null;
  return new Decimal(numericValue);
}

/**
 * Um catálogo de limites por lado da comparação. São o mesmo objeto quando os
 * dois lados vêm do mesmo documento — e só diferem no conflito de salvamento.
 */
export type LimitCatalogs = { before: LimitCatalog; after: LimitCatalog };

/**
 * `1` limite aumentou, `-1` diminuiu, `0` não mudou.
 *
 * Ganhar limite (de ausente para presente) conta como aumento; perdê-lo, como
 * redução — é a regra literal de §4.3, e é a leitura de negócio correta:
 * tirar o limite de uma célula é reduzir o que ela concede.
 */
export function compareLimits(before: Cell, after: Cell, limits: LimitCatalogs): -1 | 0 | 1 {
  const from = effectiveLimit(before, limits.before);
  const to = effectiveLimit(after, limits.after);
  if (from === null && to === null) return 0;
  if (from === null) return 1;
  if (to === null) return -1;
  const comparison = from.comparedTo(to);
  if (comparison < 0) return 1;
  if (comparison > 0) return -1;
  return 0;
}

// ---------------------------------------------------------------------------
// §4.3 As métricas
// ---------------------------------------------------------------------------

export type StructuralCounts = { combinationsAdded: number; combinationsRemoved: number };

/**
 * Conta as métricas de §4.3 sobre a lista de mudanças de célula.
 *
 * **Só `MODIFIED` entra nas métricas por célula.** §4.3 diz isso de
 * `offersChanged` ("excluindo adicionadas/removidas") e a mesma regra vale para
 * as demais pelo mesmo motivo: uma combinação que entrou ou saiu do grid já é
 * contada por `combinationsAdded`/`combinationsRemoved`, e contá-la de novo
 * como "célula aberta" inflaria o resumo. As contagens estruturais vêm dos
 * eixos (quantas combinações o grid ganhou ou perdeu), não das células — uma
 * combinação nova nasce pendente e nem chega a ter célula.
 */
export function summarizeChanges(
  changes: readonly CellChange[],
  limits: LimitCatalogs,
  structural: StructuralCounts,
): DiffSummary {
  const summary: DiffSummary = {
    ...EMPTY_DIFF_SUMMARY,
    combinationsAdded: structural.combinationsAdded,
    combinationsRemoved: structural.combinationsRemoved,
  };

  for (const change of changes) {
    if (change.kind !== 'MODIFIED') continue;
    const { before, after, fields } = change;

    if (fields.includes('decision')) {
      if (isReprovingDecision(before.decision) && isApprovingDecision(after.decision)) {
        summary.cellsOpened += 1;
      }
      if (isApprovingDecision(before.decision) && after.decision === REPROVING_DECISION_CODE) {
        summary.cellsClosed += 1;
      }
      if (after.decision === MANUAL_REVIEW_DECISION_CODE) {
        summary.cellsToManualReview += 1;
      }
    }

    if (fields.includes('offer')) summary.offersChanged += 1;

    if (fields.includes('limit') || fields.includes('limitOverride')) {
      const direction = compareLimits(before, after, limits);
      if (direction > 0) summary.limitsIncreased += 1;
      else if (direction < 0) summary.limitsDecreased += 1;
    }

    if (fields.includes('note')) summary.notesChanged += 1;
    if (fields.includes('color')) summary.colorsChanged += 1;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// summaryText — as frases prontas
// ---------------------------------------------------------------------------

type Phrase = { value: number; one: string; many: string };

function phrase(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * As frases de §4.3 em pt-BR, na ordem da tabela do documento normativo e
 * **omitindo as métricas zeradas**. Lista vazia significa "nada mudou".
 */
export function summaryToText(summary: DiffSummary): string[] {
  const phrases: Phrase[] = [
    { value: summary.cellsOpened, one: 'célula aberta', many: 'células abertas' },
    { value: summary.cellsClosed, one: 'célula fechada', many: 'células fechadas' },
    {
      value: summary.cellsToManualReview,
      one: 'célula enviada para análise manual',
      many: 'células enviadas para análise manual',
    },
    { value: summary.offersChanged, one: 'oferta alterada', many: 'ofertas alteradas' },
    { value: summary.limitsIncreased, one: 'limite aumentado', many: 'limites aumentados' },
    { value: summary.limitsDecreased, one: 'limite reduzido', many: 'limites reduzidos' },
    { value: summary.combinationsAdded, one: 'combinação nova', many: 'combinações novas' },
    {
      value: summary.combinationsRemoved,
      one: 'combinação removida',
      many: 'combinações removidas',
    },
    { value: summary.notesChanged, one: 'observação alterada', many: 'observações alteradas' },
    { value: summary.colorsChanged, one: 'cor alterada', many: 'cores alteradas' },
  ];

  return phrases
    .filter((entry) => entry.value > 0)
    .map((entry) => phrase(entry.value, entry.one, entry.many));
}
