import { describe, expect, it } from 'vitest';
import type { Cell, PolicyOpsDocument } from '@/core/document/schema';
import { validateDocument } from '@/core/document/validate';
import {
  applyCellPatch,
  applyCellPatches,
  MAX_AUDIT_CELLS,
  MAX_PATCH_COORDS,
  type CellPatch,
} from '@/core/versioning/cells';
import { createMatrix, locateVersion } from '@/core/versioning/lifecycle';
import {
  apply,
  baseDocument,
  coordsOf,
  createTestMatrix,
  documentWithAllStates,
  expectFailure,
  IDS,
  testCtx,
  withoutEvents,
} from './fixtures';

function cellsOf(doc: PolicyOpsDocument, versionId: string): Record<string, Cell> {
  return locateVersion(doc, versionId).version.cells;
}

/** Uma matriz X = SCORE (R1..R3) × Y = RESTRITIVO (SEM, ALTO), 6 combinações. */
function draftMatrix() {
  const ctx = testCtx();
  const created = createTestMatrix(baseDocument(), ctx);
  return { ctx, document: created.document, versionId: created.data.versionId };
}

const R1_SEM = { xPath: 'R1', yPath: 'SEM' };
const R2_SEM = { xPath: 'R2', yPath: 'SEM' };
const R3_SEM = { xPath: 'R3', yPath: 'SEM' };

// ---------------------------------------------------------------------------
// §2.1 Semântica de três estados
// ---------------------------------------------------------------------------

describe('version/applyCellPatch — semântica de três estados (§2.1)', () => {
  it('valor define, chave ausente não mexe, null limpa', () => {
    const { ctx, document, versionId } = draftMatrix();

    // Valor define.
    const definido = apply(
      document,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: [R1_SEM], set: { decision: 'APROVADO', offer: 'OFERTA_A' } },
      }),
    ).document;
    expect(cellsOf(definido, versionId)['R1::SEM']).toEqual({
      decision: 'APROVADO',
      offer: 'OFERTA_A',
    });

    // Chave ausente não mexe: trocar só a oferta preserva a decisão. É o que
    // permite "atribuir a Oferta B a 50 células" sem tocar nas decisões delas.
    const soOferta = apply(
      definido,
      ctx,
      applyCellPatch({ versionId, patch: { coords: [R1_SEM], set: { offer: 'OFERTA_B' } } }),
    ).document;
    expect(cellsOf(soOferta, versionId)['R1::SEM']).toEqual({
      decision: 'APROVADO',
      offer: 'OFERTA_B',
    });

    // null limpa só aquele campo.
    const semOferta = apply(
      soOferta,
      ctx,
      applyCellPatch({ versionId, patch: { coords: [R1_SEM], set: { offer: null } } }),
    ).document;
    expect(cellsOf(semOferta, versionId)['R1::SEM']).toEqual({ decision: 'APROVADO' });
  });

  it('célula que fica sem nenhum campo é removida do mapa, não vira objeto vazio', () => {
    const { ctx, document, versionId } = draftMatrix();
    const preenchida = apply(
      document,
      ctx,
      applyCellPatch({ versionId, patch: { coords: [R1_SEM], set: { decision: 'APROVADO' } } }),
    ).document;
    expect(Object.keys(cellsOf(preenchida, versionId))).toEqual(['R1::SEM']);

    const esvaziada = apply(
      preenchida,
      ctx,
      applyCellPatch({ versionId, patch: { coords: [R1_SEM], set: { decision: null } } }),
    );
    expect(cellsOf(esvaziada.document, versionId)).toEqual({});
    expect('R1::SEM' in cellsOf(esvaziada.document, versionId)).toBe(false);
    expect(esvaziada.data.removedCells).toBe(1);
    expect(validateDocument(esvaziada.document).ok).toBe(true);
  });

  it('limpar um campo de célula que tem outros não a remove', () => {
    const { ctx, document, versionId } = draftMatrix();
    const cheia = apply(
      document,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: [R1_SEM], set: { decision: 'APROVADO', note: 'Revisar' } },
      }),
    ).document;
    const parcial = apply(
      cheia,
      ctx,
      applyCellPatch({ versionId, patch: { coords: [R1_SEM], set: { decision: null } } }),
    );
    expect(cellsOf(parcial.document, versionId)['R1::SEM']).toEqual({ note: 'Revisar' });
    expect(parcial.data.removedCells).toBe(0);
  });

  it('attrs faz merge raso, e chave com null remove a chave', () => {
    const { ctx, document, versionId } = draftMatrix();
    const inicial = apply(
      document,
      ctx,
      applyCellPatch({
        versionId,
        patch: {
          coords: [R1_SEM],
          set: { decision: 'APROVADO', attrs: { origem: 'planilha', peso: 3, ativo: true } },
        },
      }),
    ).document;
    expect(cellsOf(inicial, versionId)['R1::SEM']!.attrs).toEqual({
      origem: 'planilha',
      peso: 3,
      ativo: true,
    });

    // Merge raso: só as chaves citadas mudam.
    const merged = apply(
      inicial,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: [R1_SEM], set: { attrs: { peso: 9, novo: 'x' } } },
      }),
    ).document;
    expect(cellsOf(merged, versionId)['R1::SEM']!.attrs).toEqual({
      origem: 'planilha',
      peso: 9,
      ativo: true,
      novo: 'x',
    });

    // null remove a chave; esvaziar `attrs` remove o próprio campo.
    const removido = apply(
      merged,
      ctx,
      applyCellPatch({
        versionId,
        patch: {
          coords: [R1_SEM],
          set: { attrs: { origem: null, peso: null, ativo: null, novo: null } },
        },
      }),
    ).document;
    expect(cellsOf(removido, versionId)['R1::SEM']).toEqual({ decision: 'APROVADO' });
  });

  it('aplica o mesmo patch a muitas coordenadas de uma vez', () => {
    const { ctx, document, versionId } = draftMatrix();
    const { document: pintado, data } = apply(
      document,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: coordsOf(document, versionId), set: { offer: 'OFERTA_A' } },
      }),
    );
    expect(data.cellCount).toBe(6);
    expect(Object.keys(cellsOf(pintado, versionId))).toHaveLength(6);
    expect(cellsOf(pintado, versionId)['R3::ALTO']).toEqual({ offer: 'OFERTA_A' });
  });
});

// ---------------------------------------------------------------------------
// §2.2 Validações
// ---------------------------------------------------------------------------

describe('version/applyCellPatch — validações (§2.2)', () => {
  it('recusa coordenada fora das tuplas dos eixos', () => {
    const { ctx, document, versionId } = draftMatrix();
    const error = expectFailure(
      document,
      ctx,
      applyCellPatch({
        versionId,
        patch: {
          coords: [R1_SEM, { xPath: 'R9', yPath: 'SEM' }, { xPath: 'R1', yPath: 'MEDIO' }],
          set: { decision: 'APROVADO' },
        },
      }),
      'INVALID_COORD',
    );
    expect(error.details).toEqual({
      coords: [
        { xPath: 'R9', yPath: 'SEM' },
        { xPath: 'R1', yPath: 'MEDIO' },
      ],
    });
  });

  it('recusa referência de catálogo inexistente, de kind errado ou arquivada', () => {
    const { ctx, document, versionId } = draftMatrix();
    const patchWith = (set: CellPatch['set']) =>
      applyCellPatch({ versionId, patch: { coords: [R1_SEM], set } });

    expectFailure(document, ctx, patchWith({ decision: 'FANTASMA' }), 'CATALOG_KIND_MISMATCH');
    // OFERTA_A existe, mas como OFFER — não serve para `decision`.
    expectFailure(document, ctx, patchWith({ decision: 'OFERTA_A' }), 'CATALOG_KIND_MISMATCH');
    expectFailure(document, ctx, patchWith({ limit: 'APROVADO' }), 'CATALOG_KIND_MISMATCH');
    expectFailure(document, ctx, patchWith({ offer: 'OFERTA_VELHA' }), 'CATALOG_ITEM_ARCHIVED');
  });

  it('valida cor, limitOverride e observação', () => {
    const { ctx, document, versionId } = draftMatrix();
    const patchWith = (set: CellPatch['set']) =>
      applyCellPatch({ versionId, patch: { coords: [R1_SEM], set } });

    expectFailure(document, ctx, patchWith({ color: 'vermelho' }), 'INVALID_INPUT');
    expectFailure(document, ctx, patchWith({ color: '#FFF' }), 'INVALID_INPUT');
    expectFailure(document, ctx, patchWith({ limitOverride: 'mil' }), 'INVALID_INPUT');
    expectFailure(document, ctx, patchWith({ limitOverride: '0' }), 'INVALID_INPUT');
    expectFailure(document, ctx, patchWith({ limitOverride: '-10' }), 'INVALID_INPUT');
    expectFailure(document, ctx, patchWith({ note: '   ' }), 'INVALID_INPUT');

    const valido = apply(
      document,
      ctx,
      patchWith({ color: '#16A34A', limitOverride: '1500.50', note: 'Exceção aprovada' }),
    ).document;
    expect(cellsOf(valido, versionId)['R1::SEM']).toEqual({
      color: '#16A34A',
      limitOverride: '1500.50',
      note: 'Exceção aprovada',
    });
  });

  it('recusa patch vazio, patch sem campos e lista de patches vazia', () => {
    const { ctx, document, versionId } = draftMatrix();
    expectFailure(
      document,
      ctx,
      applyCellPatch({ versionId, patch: { coords: [], set: { decision: 'APROVADO' } } }),
      'INVALID_INPUT',
    );
    expectFailure(
      document,
      ctx,
      applyCellPatch({ versionId, patch: { coords: [R1_SEM], set: {} } }),
      'INVALID_INPUT',
    );
    expectFailure(document, ctx, applyCellPatches({ versionId, patches: [] }), 'INVALID_INPUT');
  });

  it('recusa patch acima do teto de coordenadas', () => {
    const { ctx, document, versionId } = draftMatrix();
    const coords = Array.from({ length: MAX_PATCH_COORDS + 1 }, () => R1_SEM);
    const error = expectFailure(
      document,
      ctx,
      applyCellPatch({ versionId, patch: { coords, set: { decision: 'APROVADO' } } }),
      'PATCH_TOO_LARGE',
    );
    expect(error.details).toEqual({ count: MAX_PATCH_COORDS + 1, max: MAX_PATCH_COORDS });
  });

  it('recusa versão inexistente', () => {
    const { ctx, document } = draftMatrix();
    expectFailure(
      document,
      ctx,
      applyCellPatch({
        versionId: 'fantasma',
        patch: { coords: [R1_SEM], set: { decision: 'APROVADO' } },
      }),
      'NOT_FOUND',
    );
  });

  it.each(['published', 'superseded', 'archived'] as const)(
    'I3: recusa editar células de uma versão em %s com VERSION_IMMUTABLE',
    (which) => {
      const ctx = testCtx();
      const states = documentWithAllStates(ctx);
      const error = expectFailure(
        states.document,
        ctx,
        applyCellPatch({
          versionId: states[which],
          patch: { coords: [R1_SEM], set: { decision: 'REPROVADO' } },
        }),
        'VERSION_IMMUTABLE',
      );
      expect(error.details).toMatchObject({ versionId: states[which] });
    },
  );
});

// ---------------------------------------------------------------------------
// §2.3 Inverso
// ---------------------------------------------------------------------------

describe('version/applyCellPatch — inverso (§2.3)', () => {
  it('reconstrói campo a campo, com null para os campos que estavam ausentes', () => {
    const { ctx, document, versionId } = draftMatrix();
    const inicial = apply(
      document,
      ctx,
      applyCellPatch({ versionId, patch: { coords: [R1_SEM], set: { decision: 'APROVADO' } } }),
    ).document;

    const editada = apply(
      inicial,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: [R1_SEM], set: { decision: 'REPROVADO', offer: 'OFERTA_A' } },
      }),
    );

    const inverse = editada.result.inverse as ReturnType<typeof applyCellPatches>;
    // `decision` volta ao valor anterior; `offer`, que estava **ausente**,
    // vira `null` — é o que apaga o campo de novo.
    expect(inverse.input.patches).toEqual([
      { coords: [R1_SEM], set: { decision: 'APROVADO', offer: null } },
    ]);
  });

  it('agrupa coordenadas com o mesmo estado anterior num patch só', () => {
    const { ctx, document, versionId } = draftMatrix();
    const inicial = apply(
      document,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: [R1_SEM, R2_SEM], set: { decision: 'APROVADO' } },
      }),
    ).document;

    const editada = apply(
      inicial,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: [R1_SEM, R2_SEM, R3_SEM], set: { decision: 'REPROVADO' } },
      }),
    );

    const inverse = editada.result.inverse as ReturnType<typeof applyCellPatches>;
    // Dois grupos: as duas que valiam APROVADO e a que não existia.
    expect(inverse.input.patches).toEqual([
      { coords: [R1_SEM, R2_SEM], set: { decision: 'APROVADO' } },
      { coords: [R3_SEM], set: { decision: null } },
    ]);
  });

  it('round-trip: patch misto sobre 10 células e o inverso devolvem o documento idêntico', () => {
    const ctx = testCtx();
    // Grid maior: X = SCORE (3) × Y = SEGMENTO›FAT (8) = 24 combinações.
    const created = apply(
      baseDocument(),
      ctx,
      createMatrix({
        projectId: IDS.projectA,
        code: 'MTZ_PJ',
        name: 'Matriz PJ',
        x: { levels: [{ variableId: IDS.score }] },
        y: { levels: [{ variableId: IDS.segmento }, { variableId: IDS.fat }] },
      }),
    );
    const versionId = created.data.versionId;
    const coords = coordsOf(created.document, versionId).slice(0, 10);

    // Estado de partida deliberadamente heterogêneo: das 10 coordenadas, 4
    // ficam cheias (com attrs), 2 ficam com um campo só, 4 ficam ausentes.
    let original = apply(
      created.document,
      ctx,
      applyCellPatches({
        versionId,
        patches: [
          {
            coords: coords.slice(0, 4),
            set: {
              decision: 'APROVADO',
              offer: 'OFERTA_A',
              limit: 'LIM_1000',
              limitOverride: '2500.00',
              color: '#16A34A',
              note: 'Aprovada na alçada.',
              attrs: { origem: 'planilha', peso: 2 },
            },
          },
          { coords: coords.slice(4, 6), set: { decision: 'ANALISE_MANUAL' } },
        ],
      }),
    ).document;
    original = apply(
      original,
      ctx,
      applyCellPatch({
        versionId,
        // Uma célula fora do recorte, para provar que o inverso não a toca.
        patch: { coords: [coords[12] ?? coords[9]!], set: { decision: 'REPROVADO' } },
      }),
    ).document;

    // Patch misto sobre as 10: define, limpa, mexe em attrs e esvazia células.
    const forward = apply(
      original,
      ctx,
      applyCellPatches({
        versionId,
        patches: [
          {
            coords: coords.slice(0, 5),
            set: { offer: 'OFERTA_B', note: null, attrs: { peso: 7, extra: true } },
          },
          {
            coords: coords.slice(3, 8),
            set: {
              decision: null,
              limit: null,
              limitOverride: null,
              color: null,
              note: null,
              offer: null,
              attrs: { peso: null, origem: null, extra: null },
            },
          },
          { coords: coords.slice(8, 10), set: { decision: 'REPROVADO', color: '#DC2626' } },
        ],
      }),
    );

    // Algumas células realmente sumiram do mapa — o round-trip precisa
    // ressuscitá-las, não só recolocar campos.
    expect(forward.data.removedCells).toBeGreaterThan(0);
    expect(cellsOf(forward.document, versionId)).not.toEqual(cellsOf(original, versionId));

    const back = apply(forward.document, ctx, forward.result.inverse);

    // Deep-equal do documento inteiro (menos `events`, que é append-only por
    // desenho: desfazer registra que houve desfazer).
    expect(withoutEvents(back.document)).toEqual(withoutEvents(original));
    expect(validateDocument(back.document).ok).toBe(true);

    // E o inverso do inverso refaz exatamente o estado editado.
    const redo = apply(back.document, ctx, back.result.inverse);
    expect(withoutEvents(redo.document)).toEqual(withoutEvents(forward.document));
  });
});

// ---------------------------------------------------------------------------
// §2.3 Auditoria
// ---------------------------------------------------------------------------

describe('version/applyCellPatch — auditoria (§2.3)', () => {
  it('grava CELLS_UPDATED com before/after e frase pronta em pt-BR', () => {
    const { ctx, document, versionId } = draftMatrix();
    const inicial = apply(
      document,
      ctx,
      applyCellPatch({ versionId, patch: { coords: [R1_SEM], set: { decision: 'APROVADO' } } }),
    ).document;

    const { result } = apply(
      inicial,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: [R1_SEM, R2_SEM], set: { offer: 'OFERTA_A' } },
      }),
    );

    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event.type).toBe('CELLS_UPDATED');
    expect(event.summary).toBe('Arthur alterou a oferta de 2 células.');
    expect(event.payload).toEqual({
      cellCount: 2,
      fields: ['offer'],
      before: { 'R1::SEM': { decision: 'APROVADO' } },
      after: {
        'R1::SEM': { decision: 'APROVADO', offer: 'OFERTA_A' },
        'R2::SEM': { offer: 'OFERTA_A' },
      },
    });
  });

  it('concorda o número e enumera os campos na frase', () => {
    const { ctx, document, versionId } = draftMatrix();
    const um = apply(
      document,
      ctx,
      applyCellPatch({ versionId, patch: { coords: [R1_SEM], set: { decision: 'APROVADO' } } }),
    );
    expect(um.result.events[0]!.summary).toBe('Arthur alterou a decisão de 1 célula.');

    const varios = apply(
      document,
      ctx,
      applyCellPatch({
        versionId,
        patch: {
          coords: [R1_SEM, R2_SEM],
          set: { decision: 'APROVADO', limit: 'LIM_1000', attrs: { origem: 'lote' } },
        },
      }),
    );
    expect(varios.result.events[0]!.summary).toBe(
      'Arthur alterou a decisão, o limite e os atributos de 2 células.',
    );
  });

  it('acima de 500 células grava só contagem e campos — o documento não vira um log', () => {
    const ctx = testCtx();
    // 30 × 21 = 630 combinações.
    const created = apply(
      baseDocument(),
      ctx,
      createMatrix({
        projectId: IDS.projectA,
        code: 'MTZ_GRANDE',
        name: 'Matriz grande',
        x: { levels: [{ variableId: IDS.bigX }] },
        y: { levels: [{ variableId: IDS.bigY }] },
      }),
    );
    const coords = coordsOf(created.document, created.data.versionId);
    expect(coords.length).toBeGreaterThan(MAX_AUDIT_CELLS);

    const { result } = apply(
      created.document,
      ctx,
      applyCellPatch({
        versionId: created.data.versionId,
        patch: { coords, set: { decision: 'APROVADO' } },
      }),
    );
    expect(result.events[0]!.payload).toEqual({ cellCount: 630, fields: ['decision'] });

    // No limite exato ainda grava o detalhe.
    const noLimite = apply(
      created.document,
      ctx,
      applyCellPatch({
        versionId: created.data.versionId,
        patch: { coords: coords.slice(0, MAX_AUDIT_CELLS), set: { decision: 'APROVADO' } },
      }),
    );
    expect(noLimite.result.events[0]!.payload).toHaveProperty('after');
  });

  it('rotula a pilha de undo com a contagem de células', () => {
    const { versionId } = draftMatrix();
    expect(applyCellPatch({ versionId, patch: { coords: [R1_SEM], set: {} } }).label).toBe(
      'Editar 1 célula',
    );
    expect(
      applyCellPatch({ versionId, patch: { coords: [R1_SEM, R2_SEM], set: {} } }).label,
    ).toBe('Editar 2 células');
    expect(applyCellPatches({ versionId, patches: [] }).label).toBe('Editar células');
  });
});

// ---------------------------------------------------------------------------
// Pureza
// ---------------------------------------------------------------------------

describe('pureza de version/applyCellPatch', () => {
  it('não muta o documento recebido e é determinístico', () => {
    const { document, versionId } = draftMatrix();
    const antes = structuredClone(document);
    const patch: CellPatch = { coords: [R1_SEM], set: { decision: 'APROVADO' } };

    const primeiro = apply(document, testCtx(), applyCellPatch({ versionId, patch }));
    expect(document).toEqual(antes);

    const segundo = apply(document, testCtx(), applyCellPatch({ versionId, patch }));
    expect(segundo.document).toEqual(primeiro.document);
  });
});
