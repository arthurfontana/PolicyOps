import type { MatrixVersion, PolicyOpsDocument } from '../document/schema';
import { locateVersion } from '../versioning/lifecycle';
import { diffVersionPair, type VersionSide } from './versions';
import type { VersionDiff } from './types';

/**
 * Fachada do motor de diff — docs/05-regras-de-negocio.md §4.
 *
 * `diffVersions(doc, aId, bId)`: A é a base (a mais antiga), B a comparada.
 * A ordem é responsabilidade de quem chama; `orderForCompare` existe para a
 * interface não ter de decidir sozinha qual das duas é a mais antiga.
 */

export * from './types';
export {
  APPROVING_DECISION_CODES,
  MANUAL_REVIEW_DECISION_CODE,
  REPROVING_DECISION_CODE,
  buildLimitCatalog,
  compareLimits,
  effectiveLimit,
  isApprovingDecision,
  isReprovingDecision,
  summarizeChanges,
  summaryToText,
  type LimitCatalog,
  type LimitCatalogs,
} from './semantics';
export { changedFields, countStructuralCombinations, diffCells } from './cells';
export { diffAxis, stacksMatch } from './axes';
export { diffVersionPair, versionRef, type DiffContext, type VersionSide } from './versions';
export {
  diffComponentPayloads,
  type ComponentPayloadDiff,
  type PayloadFieldChange,
  type PayloadFieldChangeKind,
} from './component-payload';
export {
  ROOT_SECTION_LABEL,
  diffPolicyAt,
  diffPolicySnapshots,
  groupBySection,
  orderPolicyDates,
  type PolicyChangeKind,
  type PolicyDiff,
  type PolicyDiffTotals,
  type PolicyMatrixChange,
  type PolicyNodeChange,
  type PolicySectionGroup,
} from './policy-diff';

export function diffVersions(
  doc: PolicyOpsDocument,
  aId: string,
  bId: string,
): VersionDiff {
  const a = locateVersion(doc, aId);
  const b = locateVersion(doc, bId);
  return diffVersionPair({ a: doc, b: doc }, sideOf(a), sideOf(b));
}

function sideOf(location: { matrix: VersionSide['matrix']; version: MatrixVersion }): VersionSide {
  return { matrix: location.matrix, version: location.version };
}

/**
 * Qual das duas versões é a base. A tela mostra a mais antiga sempre à
 * esquerda, independentemente da ordem em que a pessoa escolheu (docs/07 §9).
 *
 * Na mesma matriz a ordem é o `number`, que nunca se reutiliza (§1.4). Entre
 * matrizes diferentes não há numeração comum, e a data de criação é o critério
 * honesto: é o que o histórico mostra.
 */
export function orderForCompare(
  doc: PolicyOpsDocument,
  firstId: string,
  secondId: string,
): { aId: string; bId: string } {
  const first = locateVersion(doc, firstId);
  const second = locateVersion(doc, secondId);
  const firstIsOlder =
    first.matrix.id === second.matrix.id
      ? first.version.number <= second.version.number
      : first.version.createdAt <= second.version.createdAt;
  return firstIsOlder ? { aId: firstId, bId: secondId } : { aId: secondId, bId: firstId };
}
