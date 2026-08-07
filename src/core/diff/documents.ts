import type { Matrix, MatrixVersion, PolicyOpsDocument } from '../document/schema';
import { diffVersionPair } from './versions';
import type { VersionDiff } from './types';

/**
 * Diff entre dois **documentos** — docs/06-persistencia-e-concorrencia.md §5.
 *
 * Serve o conflito de salvamento: o arquivo no disco (o "deles") já mudou
 * desde que eu o abri, e a pergunta que a pessoa faz é "o que exatamente
 * ficaria diferente se eu salvasse?". A resposta é a lista das versões de
 * matriz que divergem, cada uma com o diff completo de §4 — o mesmo motor e a
 * mesma tela das comparações normais.
 *
 * A base (lado A) é sempre o documento remoto: é ele que existe hoje, e o meu
 * é a proposta de mudança por cima.
 */

export type ConflictVersionStatus = 'CHANGED' | 'ONLY_MINE' | 'ONLY_THEIRS';

export type ConflictVersionEntry = {
  matrixId: string;
  matrixCode: string;
  matrixName: string;
  versionId: string;
  versionNumber: number;
  status: ConflictVersionStatus;
  /** `null` quando a versão existe só de um lado — não há o que comparar. */
  diff: VersionDiff | null;
};

type VersionIndexEntry = { matrix: Matrix; version: MatrixVersion };

function indexVersions(doc: PolicyOpsDocument): Map<string, VersionIndexEntry> {
  const index = new Map<string, VersionIndexEntry>();
  for (const matrix of doc.matrices) {
    for (const version of matrix.versions) index.set(version.id, { matrix, version });
  }
  return index;
}

/** Uma versão mudou quando o diff acusa qualquer coisa — célula ou estrutura de eixo. */
function hasChanges(diff: VersionDiff): boolean {
  if (!diff.comparable) return true;
  if (diff.cells.length > 0) return true;
  return [diff.axes.x, diff.axes.y].some(
    (axis) =>
      axis.addedTuples.length > 0 ||
      axis.removedTuples.length > 0 ||
      axis.reorderedTuples ||
      axis.levels.some(
        (level) =>
          level.pinChanged !== undefined ||
          level.addedDomains.length > 0 ||
          level.removedDomains.length > 0 ||
          level.relabeled.length > 0,
      ),
  );
}

function entryFor(
  side: VersionIndexEntry,
  status: ConflictVersionStatus,
  diff: VersionDiff | null,
): ConflictVersionEntry {
  return {
    matrixId: side.matrix.id,
    matrixCode: side.matrix.code,
    matrixName: side.matrix.name,
    versionId: side.version.id,
    versionNumber: side.version.number,
    status,
    diff,
  };
}

/**
 * As versões de matriz que diferem entre o meu documento e o remoto.
 *
 * O casamento é por **id de versão**: os dois documentos descendem do mesmo
 * arquivo, então o id é a identidade estável. Versão que existe só de um lado
 * entra na lista com `ONLY_MINE`/`ONLY_THEIRS` e sem diff.
 */
export function diffDocuments(
  mine: PolicyOpsDocument,
  theirs: PolicyOpsDocument,
): ConflictVersionEntry[] {
  const mineIndex = indexVersions(mine);
  const theirsIndex = indexVersions(theirs);
  const entries: ConflictVersionEntry[] = [];

  for (const [versionId, mineSide] of mineIndex) {
    const theirsSide = theirsIndex.get(versionId);
    if (theirsSide === undefined) {
      entries.push(entryFor(mineSide, 'ONLY_MINE', null));
      continue;
    }
    const diff = diffVersionPair({ a: theirs, b: mine }, theirsSide, mineSide);
    if (hasChanges(diff)) entries.push(entryFor(mineSide, 'CHANGED', diff));
  }

  for (const [versionId, theirsSide] of theirsIndex) {
    if (mineIndex.has(versionId)) continue;
    entries.push(entryFor(theirsSide, 'ONLY_THEIRS', null));
  }

  return entries.sort(
    (left, right) =>
      left.matrixCode.localeCompare(right.matrixCode, 'pt-BR') ||
      left.versionNumber - right.versionNumber,
  );
}
