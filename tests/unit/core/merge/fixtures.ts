import { expect } from 'vitest';
import type { Ctx } from '@/core/command';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { validateDocument } from '@/core/document/validate';
import { createDraft, createMatrix, publishVersion } from '@/core/versioning/lifecycle';
import { apply, baseDocument, DAY, fillAllCells, IDS, T0, type TestCtx } from '../versioning/fixtures';

/**
 * Fixtures do merge de documentos (S17 parte B).
 *
 * O cenário é sempre o mesmo, e é o real: **um ancestral comum** — o arquivo
 * que as duas pessoas abriram — e dois documentos que evoluíram dele por
 * caminhos diferentes. Cada lado evolui pelos **próprios comandos**, com um
 * gerador de ids próprio: duas pessoas nunca produzem o mesmo `nanoid`, e um
 * merge testado com ids coincidentes esconderia justamente os casos que
 * importam.
 */

/**
 * `Ctx` determinístico com prefixo de pessoa. O prefixo entra no id, então os
 * ids de Ana e os de Bruno nunca colidem — como na vida real.
 */
export function personCtx(actor: string, prefix: string, startISO = T0): TestCtx {
  let clock = new Date(startISO).getTime();
  let sequence = 0;
  return {
    actor,
    now: () => new Date(clock),
    newId: () => {
      sequence += 1;
      return `${prefix}${String(sequence).padStart(12 - prefix.length, '0')}`;
    },
    advance: (ms) => {
      clock += ms;
    },
    setNow: (iso) => {
      clock = new Date(iso).getTime();
    },
  };
}

export type Ancestor = {
  /** O arquivo que as duas pessoas abriram. */
  document: PolicyOpsDocument;
  matrixA: string;
  /** v1 de MTZ_A, publicada. */
  publishedA: string;
  matrixB: string;
  /** v1 de MTZ_B, publicada. */
  publishedB: string;
  /** v2 de MTZ_B, em rascunho — o rascunho que as duas pessoas podem editar. */
  draftB: string;
};

/**
 * Ancestral comum: duas matrizes no projeto A, cada uma com a v1 publicada, e
 * MTZ_B com um rascunho v2 aberto. É o arquivo às 9h da manhã.
 */
export function ancestor(): Ancestor {
  const ctx = personCtx('Equipe', 'base');
  let doc = baseDocument();

  const a = apply(
    doc,
    ctx,
    createMatrix({
      projectId: IDS.projectA,
      code: 'MTZ_A',
      name: 'Matriz A',
      x: { levels: [{ variableId: IDS.score }] },
      y: { levels: [{ variableId: IDS.restritivo }] },
    }),
  );
  doc = fillAllCells(a.document, ctx, a.data.versionId);
  doc = apply(doc, ctx, publishVersion({ versionId: a.data.versionId, notes: 'Publicação inicial de A.' })).document;

  const b = apply(
    doc,
    ctx,
    createMatrix({
      projectId: IDS.projectA,
      code: 'MTZ_B',
      name: 'Matriz B',
      x: { levels: [{ variableId: IDS.score }] },
      y: { levels: [{ variableId: IDS.segmento }] },
    }),
  );
  doc = fillAllCells(b.document, ctx, b.data.versionId);
  ctx.advance(DAY);
  doc = apply(doc, ctx, publishVersion({ versionId: b.data.versionId, notes: 'Publicação inicial de B.' })).document;

  const draft = apply(doc, ctx, createDraft({ matrixId: b.data.matrixId }));
  doc = draft.document;

  // A revisão do arquivo compartilhado, como estaria depois de alguns
  // salvamentos: é dela que as duas pessoas partem.
  doc = { ...doc, meta: { ...doc.meta, revision: 40, savedAt: T0, savedBy: 'Equipe' } };

  return {
    document: doc,
    matrixA: a.data.matrixId,
    publishedA: a.data.versionId,
    matrixB: b.data.matrixId,
    publishedB: b.data.versionId,
    draftB: draft.data.versionId,
  };
}

/** Ana abriu o arquivo às 9h. */
export function ana(startISO = '2026-02-01T09:00:00.000Z'): TestCtx {
  return personCtx('Ana', 'ana', startISO);
}

/** Bruno abriu o mesmo arquivo às 9h, e salvou primeiro. */
export function bruno(startISO = '2026-02-01T10:00:00.000Z'): TestCtx {
  return personCtx('Bruno', 'bru', startISO);
}

/** Salva o documento: revisão nova, como o adapter faria (docs/06 §4). */
export function saved(doc: PolicyOpsDocument, by: string, at: string): PolicyOpsDocument {
  return { ...doc, meta: { ...doc.meta, revision: doc.meta.revision + 1, savedAt: at, savedBy: by } };
}

/** Publica o rascunho aberto de uma matriz, preenchendo o que faltar. */
export function publishDraft(
  doc: PolicyOpsDocument,
  ctx: Ctx,
  versionId: string,
  notes = 'Publicação do merge de teste.',
): PolicyOpsDocument {
  const filled = fillAllCells(doc, ctx, versionId);
  return apply(filled, ctx, publishVersion({ versionId, notes })).document;
}

// ---------------------------------------------------------------------------
// Verificações que valem para **todo** cenário de merge
// ---------------------------------------------------------------------------

export type SealedVersion = { matrixId: string; versionId: string; cellCount: number; number: number };

/** Toda versão publicada ou substituída de um documento, por id. */
export function sealedVersions(doc: PolicyOpsDocument): Map<string, SealedVersion> {
  const out = new Map<string, SealedVersion>();
  for (const matrix of doc.matrices) {
    for (const version of matrix.versions) {
      if (version.state !== 'PUBLISHED' && version.state !== 'SUPERSEDED') continue;
      out.set(version.id, {
        matrixId: matrix.id,
        versionId: version.id,
        cellCount: Object.keys(version.cells).length,
        number: version.number,
      });
    }
  }
  return out;
}

function versionById(doc: PolicyOpsDocument, versionId: string) {
  for (const matrix of doc.matrices) {
    const found = matrix.versions.find((version) => version.id === versionId);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Critério de aceite da sessão: **nenhum cenário perde versão publicada**.
 * Presente pelo id, com as mesmas células — renumerar e arquivar é permitido,
 * sumir não é.
 */
export function expectNoPublishedVersionLost(
  mine: PolicyOpsDocument,
  theirs: PolicyOpsDocument,
  merged: PolicyOpsDocument,
): void {
  const expected = new Map([...sealedVersions(mine), ...sealedVersions(theirs)]);
  for (const [versionId, before] of expected) {
    const after = versionById(merged, versionId);
    expect(after, `A versão publicada ${versionId} sumiu no merge.`).toBeDefined();
    expect(Object.keys(after!.cells).length).toBe(before.cellCount);
  }
}

/** Critério de aceite da sessão: **o merge sempre produz documento válido**. */
export function expectValid(doc: PolicyOpsDocument): void {
  const result = validateDocument(doc);
  if (!result.ok) {
    expect.fail(
      `O documento mesclado é inválido:\n${result.issues
        .map((issue) => `- [${issue.invariant}] ${issue.path}: ${issue.message}`)
        .join('\n')}`,
    );
  }
}

/** O conteúdo do documento sem os metadados de salvamento — o que o merge tem de reproduzir. */
export function content(doc: PolicyOpsDocument) {
  const { meta, ...rest } = doc;
  void meta;
  return rest;
}
