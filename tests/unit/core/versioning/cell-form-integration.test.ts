import { describe, expect, it } from 'vitest';
import { decodeCellKey, encodeCellKey } from '@/core/axes/paths';
import type { Cell, PolicyOpsDocument } from '@/core/document/schema';
import { locateVersion } from '@/core/versioning/lifecycle';
import { applyCellPatch, applyCellPatches } from '@/core/versioning/cells';
import { buildPatchFromForm, computeFieldState } from '@/core/versioning/cell-form';
import { apply, testCtx, withoutEvents } from './fixtures';
import { createTestMatrix } from './fixtures';
import { baseDocument } from './fixtures';

function cellsOf(doc: PolicyOpsDocument, versionId: string): Record<string, Cell> {
  return locateVersion(doc, versionId).version.cells;
}

const R1_SEM = { xPath: 'R1', yPath: 'SEM' };
const R2_SEM = { xPath: 'R2', yPath: 'SEM' };
const R3_SEM = { xPath: 'R3', yPath: 'SEM' };

describe('inspector — formulário sobre seleção heterogênea (docs/07 §6.2)', () => {
  it('alterar só a oferta preserva decisões divergentes das células selecionadas', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;

    let doc = apply(
      created.document,
      ctx,
      applyCellPatches({
        versionId,
        patches: [
          { coords: [R1_SEM], set: { decision: 'APROVADO' } },
          { coords: [R2_SEM], set: { decision: 'REPROVADO' } },
        ],
      }),
    ).document;

    const coords = [R1_SEM, R2_SEM];
    const cells = coords.map((c) => cellsOf(doc, versionId)[encodeCellKey(c.xPath, c.yPath)]);
    expect(computeFieldState(cells, 'decision')).toEqual({ kind: 'divergent' });
    expect(computeFieldState(cells, 'offer')).toEqual({ kind: 'empty' });

    // O usuário só tocou "oferta" — o formulário nunca viu "decision" tocado.
    const patch = buildPatchFromForm(new Set(['offer']), { offer: 'OFERTA_A' }, coords);
    expect(patch).not.toBeNull();

    doc = apply(doc, ctx, applyCellPatch({ versionId, patch: patch! })).document;

    expect(cellsOf(doc, versionId)['R1::SEM']).toEqual({ decision: 'APROVADO', offer: 'OFERTA_A' });
    expect(cellsOf(doc, versionId)['R2::SEM']).toEqual({ decision: 'REPROVADO', offer: 'OFERTA_A' });
  });

  it('undo round-trip: patch misto sobre células cheias e vazias volta ao documento original', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;

    // Preenche parcialmente antes do patch sob teste, para ter "algumas
    // preenchidas, algumas ausentes" no antes do patch misto.
    const seeded = apply(
      created.document,
      ctx,
      applyCellPatch({ versionId, patch: { coords: [R1_SEM], set: { decision: 'APROVADO', note: 'nota antiga' } } }),
    );
    const before = seeded.document;

    const mixed = apply(
      before,
      ctx,
      applyCellPatches({
        versionId,
        patches: [
          { coords: [R1_SEM], set: { decision: 'REPROVADO', note: null } },
          { coords: [R2_SEM], set: { decision: 'ANALISE_MANUAL' } },
          { coords: [R3_SEM], set: { offer: 'OFERTA_B' } },
        ],
      }),
    );

    const undone = apply(mixed.document, ctx, mixed.result.inverse).document;
    expect(withoutEvents(undone)).toEqual(withoutEvents(before));
  });

  it('redo após undo restaura o mesmo resultado', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const versionId = created.data.versionId;

    const applied = apply(
      created.document,
      ctx,
      applyCellPatch({ versionId, patch: { coords: [R1_SEM], set: { decision: 'APROVADO' } } }),
    );
    const after = applied.document;

    const undone = apply(after, ctx, applied.result.inverse);
    const redone = apply(undone.document, ctx, undone.result.inverse);

    expect(cellsOf(redone.document, versionId)['R1::SEM']).toEqual(cellsOf(after, versionId)['R1::SEM']);
  });

  it('coordenadas decodificadas de uma seleção do grid batem com as do patch', () => {
    const key = encodeCellKey('R1', 'SEM');
    expect(decodeCellKey(key)).toEqual(R1_SEM);
  });
});
