import { describe, expect, it } from 'vitest';
import { extractTemplateSeed } from '@/core/templates/extract';
import { applyCellPatch } from '@/core/versioning/cells';
import { locateVersion } from '@/core/versioning/lifecycle';
import { apply, baseDocument, coordsOf, createTestMatrix, IDS, testCtx } from '../versioning/fixtures';

describe('extractTemplateSeed — botão "Criar template a partir desta matriz" (docs/07 §11)', () => {
  it('extrai os eixos e o valor mais frequente de cada campo como defaults', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const coords = coordsOf(created.document, created.data.versionId);

    // 5 células com APROVADO, 1 com REPROVADO — o modo é APROVADO.
    let doc = apply(
      created.document,
      ctx,
      applyCellPatch({
        versionId: created.data.versionId,
        patch: { coords, set: { decision: 'APROVADO', offer: 'OFERTA_A' } },
      }),
    ).document;
    doc = apply(
      doc,
      ctx,
      applyCellPatch({
        versionId: created.data.versionId,
        patch: { coords: [coords[0]!], set: { decision: 'REPROVADO' } },
      }),
    ).document;

    const { version } = locateVersion(doc, created.data.versionId);
    const seed = extractTemplateSeed(version);

    expect(seed.axes).toEqual({
      x: { levels: [{ variableId: IDS.score, label: 'Score' }] },
      y: { levels: [{ variableId: IDS.restritivo, label: 'Restritivo' }] },
    });
    expect(seed.defaults).toEqual({ decision: 'APROVADO', offer: 'OFERTA_A' });
  });

  it('sem células preenchidas, devolve só os eixos', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const { version } = locateVersion(created.document, created.data.versionId);
    const seed = extractTemplateSeed(version);
    expect(seed.defaults).toBeUndefined();
    expect(seed.axes.x.levels).toHaveLength(1);
  });
});
