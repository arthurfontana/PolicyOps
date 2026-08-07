import { describe, expect, it } from 'vitest';
import { isIrreversible } from '@/core/command';
import { createCatalogItem } from '@/core/library/catalog';
import { mergeDocument } from '@/core/merge';
import { applyCellPatch } from '@/core/versioning/cells';
import { createDraft } from '@/core/versioning/lifecycle';
import { apply, coordsOf } from '../versioning/fixtures';
import { ana, ancestor, bruno, expectValid, publishDraft, saved } from './fixtures';

/**
 * `document/merge` — docs/08-camada-de-comandos.md §3.
 *
 * O comando é o que grava o `DOCUMENT_MERGED` de §7 "com o resumo completo":
 * o merge em si já está coberto por `documents.test.ts`.
 */

function scenario() {
  const base = ancestor();
  const mineCtx = ana();
  const theirsCtx = bruno();

  const mine = apply(
    base.document,
    mineCtx,
    createCatalogItem({ kind: 'TAG', code: 'URGENTE', label: 'Urgente' }),
  ).document;

  const draft = apply(base.document, theirsCtx, createDraft({ matrixId: base.matrixA }));
  const theirs = saved(
    publishDraft(draft.document, theirsCtx, draft.data.versionId),
    'Bruno',
    '2026-02-01T10:00:00.000Z',
  );

  return { base, mine, theirs, mineCtx };
}

describe('document/merge', () => {
  it('mescla, registra DOCUMENT_MERGED com o resumo completo e devolve documento válido', () => {
    const { mine, theirs, mineCtx } = scenario();
    const result = apply(mine, mineCtx, mergeDocument({ theirs }));

    const event = result.document.events[result.document.events.length - 1]!;
    expect(event.type).toBe('DOCUMENT_MERGED');
    expect(event.summary).toContain('Ana mesclou o documento com a revisão 41 salva por Bruno');
    expect(event.payload).toMatchObject({
      remoteRevision: 41,
      remoteSavedBy: 'Bruno',
      conflictCount: 0,
    });
    expect((event.payload!.applied as string[]).length).toBe(result.data.applied.length);
    expect(result.data.conflicts).toEqual([]);
    expectValid(result.document);
  });

  it('o merge não pode ser desfeito', () => {
    const { mine, theirs, mineCtx } = scenario();
    const result = apply(mine, mineCtx, mergeDocument({ theirs }));
    expect(isIrreversible(result.result.inverse)).toBe(true);
  });

  it('registra no evento a decisão tomada em cada conflito', () => {
    const base = ancestor();
    const mineCtx = ana();
    const theirsCtx = bruno();
    const coords = coordsOf(base.document, base.draftB);

    const mine = apply(
      base.document,
      mineCtx,
      applyCellPatch({
        versionId: base.draftB,
        patch: { coords: [coords[0]!], set: { note: 'da Ana' } },
      }),
    ).document;
    const theirs = saved(
      apply(
        base.document,
        theirsCtx,
        applyCellPatch({
          versionId: base.draftB,
          patch: { coords: [coords[1]!], set: { note: 'do Bruno' } },
        }),
      ).document,
      'Bruno',
      '2026-02-01T10:00:00.000Z',
    );

    const preview = apply(mine, mineCtx, mergeDocument({ theirs }));
    const conflict = preview.data.conflicts[0]!;
    expect(conflict.kind).toBe('DRAFT_DIVERGED');

    const decided = apply(
      mine,
      mineCtx,
      mergeDocument({ theirs, resolutions: { [conflict.id]: { choice: 'THEIRS' } } }),
    );
    const event = decided.document.events[decided.document.events.length - 1]!;
    expect(event.payload!.decisions).toEqual([{ conflict: conflict.title, choice: 'THEIRS' }]);
    // A decisão vale: sobra o rascunho do Bruno, e só ele.
    const versions = decided.document.matrices.find((matrix) => matrix.id === base.matrixB)!.versions;
    const draft = versions.find((version) => version.state === 'DRAFT')!;
    expect(draft.cells[`${coords[1]!.xPath}::${coords[1]!.yPath}`]!.note).toBe('do Bruno');
    expect(versions.some((version) => version.state === 'ARCHIVED')).toBe(false);
    expectValid(decided.document);
  });
});
