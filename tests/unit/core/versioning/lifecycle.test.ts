import { describe, expect, it } from 'vitest';
import { validateDocument } from '@/core/document/validate';
import type { MatrixVersion, PolicyOpsDocument } from '@/core/document/schema';
import { getEffectiveVersion } from '@/core/queries';
import {
  addNote,
  assertDraft,
  assertEditable,
  combinationCount,
  createDraft,
  createMatrix,
  discardDraft,
  locateMatrix,
  locateVersion,
  pendingCoords,
  publishVersion,
} from '@/core/versioning/lifecycle';
import {
  apply,
  baseDocument,
  createTestMatrix,
  DAY,
  documentWithAllStates,
  expectFailure,
  fillAllCells,
  IDS,
  SEG_X_FAT_TUPLES,
  T0,
  testCtx,
  withoutEvents,
} from './fixtures';

function versionOf(doc: PolicyOpsDocument, versionId: string): MatrixVersion {
  return locateVersion(doc, versionId).version;
}

// ---------------------------------------------------------------------------
// §1.5 Imutabilidade
// ---------------------------------------------------------------------------

describe('assertEditable e assertDraft (§1.5)', () => {
  const states = ['PUBLISHED', 'SUPERSEDED', 'ARCHIVED'] as const;

  it('deixa passar uma versão em DRAFT', () => {
    const ctx = testCtx();
    const { document, draft } = documentWithAllStates(ctx);
    expect(() => assertEditable(versionOf(document, draft))).not.toThrow();
    expect(() => assertDraft(versionOf(document, draft))).not.toThrow();
  });

  it.each(states)('recusa uma versão em %s com VERSION_IMMUTABLE', (state) => {
    const version = { number: 7, state, id: 'x' } as unknown as MatrixVersion;
    expect(() => assertEditable(version)).toThrowError(
      expect.objectContaining({ code: 'VERSION_IMMUTABLE' }),
    );
  });

  it.each(states)('recusa uma versão em %s com VERSION_NOT_DRAFT', (state) => {
    const version = { number: 7, state, id: 'x' } as unknown as MatrixVersion;
    expect(() => assertDraft(version)).toThrowError(
      expect.objectContaining({ code: 'VERSION_NOT_DRAFT' }),
    );
  });
});

describe('localização', () => {
  it('encontra matriz e versão em qualquer posição da lista', () => {
    const ctx = testCtx();
    const first = createTestMatrix(baseDocument(), ctx, 'MTZ_A');
    const second = createTestMatrix(first.document, ctx, 'MTZ_B');
    expect(locateMatrix(second.document, second.data.matrixId).matrixIndex).toBe(1);
    expect(locateVersion(second.document, second.data.versionId).matrixIndex).toBe(1);
    expect(locateVersion(second.document, first.data.versionId).matrixIndex).toBe(0);
  });

  it('falha com NOT_FOUND para ids desconhecidos', () => {
    const doc = baseDocument();
    expect(() => locateMatrix(doc, 'nada')).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(() => locateVersion(doc, 'nada')).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });
});

// ---------------------------------------------------------------------------
// §1.1 matrix/create
// ---------------------------------------------------------------------------

describe('matrix/create (§1.1)', () => {
  it('cria v1 DRAFT com cells vazio e eixos com snapshot', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const { document, data } = createTestMatrix(doc, ctx);

    const { matrix, version } = locateVersion(document, data.versionId);
    expect(matrix.code).toBe('MTZ_A');
    expect(version.number).toBe(1);
    expect(version.state).toBe('DRAFT');
    expect(version.cells).toEqual({});
    expect(version.createdBy).toBe('Arthur');
    expect(version.createdAt).toBe(T0);
    expect(version.axes.x.tuples).toEqual(['R1', 'R2', 'R3']);
    expect(version.axes.y.tuples).toEqual(['SEM', 'ALTO']);
    // O snapshot é cópia, não referência: o nível carrega os domínios da
    // versão publicada da variável.
    expect(version.axes.x.levels[0]!.variableVersionId).toBe(IDS.scoreV1);
    expect(version.axes.x.levels[0]!.domains).toHaveLength(3);
    expect(data.combinations).toBe(6);
    expect(validateDocument(document).ok).toBe(true);
  });

  it('aplica as regras de compatibilidade publicadas ao montar o eixo', () => {
    const ctx = testCtx();
    const { document, data } = apply(
      baseDocument(),
      ctx,
      createMatrix({
        projectId: IDS.projectA,
        code: 'MTZ_PJ',
        name: 'Matriz PJ',
        description: 'Com eixo aninhado.',
        x: { levels: [{ variableId: IDS.score }] },
        y: { levels: [{ variableId: IDS.segmento }, { variableId: IDS.fat, label: 'Faixa' }] },
      }),
    );
    const { matrix, version } = locateVersion(document, data.versionId);
    // 8 tuplas, não 15: a regra SEG_X_FATURAMENTO recorta o produto cartesiano.
    expect(version.axes.y.tuples).toEqual(SEG_X_FAT_TUPLES);
    expect(version.axes.y.derivedFrom.compatibilityVersionIds).toEqual([IDS.compatV1]);
    expect(version.axes.y.levels[1]!.label).toBe('Faixa');
    expect(matrix.description).toBe('Com eixo aninhado.');
    expect(data.combinations).toBe(24);
  });

  it('registra MATRIX_CREATED e DRAFT_CREATED com frase pronta em pt-BR', () => {
    const ctx = testCtx();
    const { result } = createTestMatrix(baseDocument(), ctx);
    expect(result.events.map((event) => event.type)).toEqual(['MATRIX_CREATED', 'DRAFT_CREATED']);
    expect(result.events[0]!.summary).toBe('Arthur criou a matriz "MTZ_A" com 6 combinações.');
    expect(result.events[0]!.payload).toMatchObject({ code: 'MTZ_A', combinations: 6 });
    expect(result.events[1]!.summary).toBe('Arthur criou o rascunho da versão 1 de "MTZ_A".');
    expect(result.events[1]!.payload).toEqual({ baseVersionNumber: null });
  });

  it('recusa projeto inexistente, código duplicado e entradas inválidas', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const base = {
      code: 'MTZ_A',
      name: 'Matriz A',
      x: { levels: [{ variableId: IDS.score }] },
      y: { levels: [{ variableId: IDS.restritivo }] },
    };

    expectFailure(doc, ctx, createMatrix({ ...base, projectId: 'inexistente' }), 'NOT_FOUND');
    expectFailure(
      doc,
      ctx,
      createMatrix({ ...base, projectId: IDS.projectA, code: 'minusculo' }),
      'INVALID_INPUT',
    );
    expectFailure(
      doc,
      ctx,
      createMatrix({ ...base, projectId: IDS.projectA, name: '   ' }),
      'INVALID_INPUT',
    );
    expectFailure(
      doc,
      ctx,
      createMatrix({ ...base, projectId: IDS.projectA, description: '  ' }),
      'INVALID_INPUT',
    );
    expectFailure(
      doc,
      ctx,
      createMatrix({
        ...base,
        projectId: IDS.projectA,
        x: { levels: [{ variableId: IDS.score, label: ' ' }] },
      }),
      'INVALID_INPUT',
    );

    const created = createTestMatrix(doc, ctx).document;
    expectFailure(
      created,
      ctx,
      createMatrix({ ...base, projectId: IDS.projectA }),
      'DUPLICATE_CODE',
    );
    // O mesmo código em outro projeto é permitido: `code` é único no projeto.
    expect(
      createMatrix({ ...base, projectId: IDS.projectB }).run(created, ctx).ok,
    ).toBe(true);
  });

  it('recusa variável inexistente e variável sem versão publicada', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const base = {
      projectId: IDS.projectA,
      code: 'MTZ_A',
      name: 'Matriz A',
      y: { levels: [{ variableId: IDS.restritivo }] },
    };
    expectFailure(
      doc,
      ctx,
      createMatrix({ ...base, x: { levels: [{ variableId: 'fantasma' }] } }),
      'NOT_FOUND',
    );
    expectFailure(
      doc,
      ctx,
      createMatrix({ ...base, x: { levels: [{ variableId: IDS.semPublicada }] } }),
      'VARIABLE_HAS_NO_PUBLISHED_VERSION',
    );
  });

  it('valida I13, I14 e I16', () => {
    const ctx = testCtx();
    const doc = baseDocument();

    // I13: eixo sem nível.
    expectFailure(
      doc,
      ctx,
      createMatrix({
        projectId: IDS.projectA,
        code: 'MTZ_A',
        name: 'Matriz A',
        x: { levels: [] },
        y: { levels: [{ variableId: IDS.restritivo }] },
      }),
      'AXIS_NEEDS_ONE_LEVEL',
    );

    // I13: mesma variável duas vezes no mesmo eixo.
    expectFailure(
      doc,
      ctx,
      createMatrix({
        projectId: IDS.projectA,
        code: 'MTZ_A',
        name: 'Matriz A',
        x: { levels: [{ variableId: IDS.score }, { variableId: IDS.score }] },
        y: { levels: [{ variableId: IDS.restritivo }] },
      }),
      'DUPLICATE_VARIABLE_IN_AXIS',
    );

    // I14: a mesma variável nos dois eixos.
    expectFailure(
      doc,
      ctx,
      createMatrix({
        projectId: IDS.projectA,
        code: 'MTZ_A',
        name: 'Matriz A',
        x: { levels: [{ variableId: IDS.score }] },
        y: { levels: [{ variableId: IDS.score }] },
      }),
      'VARIABLE_ON_BOTH_AXES',
    );

    // I16: (30 × 2) × (21 × 5) = 6.300 estoura o teto de 6.000 combinações.
    expectFailure(
      doc,
      ctx,
      createMatrix({
        projectId: IDS.projectA,
        code: 'MTZ_GRANDE',
        name: 'Matriz grande',
        x: { levels: [{ variableId: IDS.bigX }, { variableId: IDS.restritivo }] },
        y: { levels: [{ variableId: IDS.bigY }, { variableId: IDS.fat }] },
      }),
      'GRID_TOO_LARGE',
    );
  });
});

// ---------------------------------------------------------------------------
// §1.2 version/createDraft
// ---------------------------------------------------------------------------

describe('version/createDraft (§1.2)', () => {
  function publishedMatrix(ctx: ReturnType<typeof testCtx>) {
    const created = createTestMatrix(baseDocument(), ctx);
    const filled = fillAllCells(created.document, ctx, created.data.versionId, 'REPROVADO');
    const published = apply(
      filled,
      ctx,
      publishVersion({ versionId: created.data.versionId, notes: 'Publicação inicial.' }),
    );
    return { document: published.document, matrixId: created.data.matrixId, v1: created.data.versionId };
  }

  it('clona integralmente: pinos, snapshots, tuplas e o mapa de células', () => {
    const ctx = testCtx();
    const { document, matrixId, v1 } = publishedMatrix(ctx);
    const { document: withDraft, data } = apply(document, ctx, createDraft({ matrixId }));

    const base = versionOf(document, v1);
    const draft = versionOf(withDraft, data.versionId);
    expect(draft.number).toBe(2);
    expect(draft.state).toBe('DRAFT');
    expect(draft.baseVersionId).toBe(v1);
    expect(draft.cells).toEqual(base.cells);
    expect(draft.axes.x.tuples).toEqual(base.axes.x.tuples);
    expect(draft.axes.x.levels[0]!.variableVersionId).toBe(base.axes.x.levels[0]!.variableVersionId);
    expect(draft.axes.x.levels[0]!.domains).toEqual(base.axes.x.levels[0]!.domains);
    // O clone é independente: o nível tem id próprio.
    expect(draft.axes.x.levels[0]!.id).not.toBe(base.axes.x.levels[0]!.id);
    expect(data.baseVersionNumber).toBe(1);
  });

  it('clona também as supressões manuais', () => {
    const ctx = testCtx();
    const { document, matrixId, v1 } = publishedMatrix(ctx);
    // Supressão gravada à mão: os comandos de eixo são S12.
    const comSupressao: PolicyOpsDocument = structuredClone(document);
    locateVersion(comSupressao, v1).version.axes.x.manualSuppressions = ['R3'];

    const { document: withDraft, data } = apply(comSupressao, ctx, createDraft({ matrixId }));
    expect(versionOf(withDraft, data.versionId).axes.x.manualSuppressions).toEqual(['R3']);
  });

  it('I1: um segundo rascunho na mesma matriz falha com DRAFT_ALREADY_EXISTS', () => {
    const ctx = testCtx();
    const { document, matrixId } = publishedMatrix(ctx);
    const first = apply(document, ctx, createDraft({ matrixId }));
    expectFailure(first.document, ctx, createDraft({ matrixId }), 'DRAFT_ALREADY_EXISTS');
  });

  it('sem versão publicada e sem base explícita, falha com NO_VERSION_TO_DERIVE', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const discarded = apply(
      created.document,
      ctx,
      discardDraft({ versionId: created.data.versionId }),
    ).document;
    expectFailure(
      discarded,
      ctx,
      createDraft({ matrixId: created.data.matrixId }),
      'NO_VERSION_TO_DERIVE',
    );
  });

  it('deriva de uma versão SUPERSEDED — é o "restaurar versão histórica"', () => {
    const ctx = testCtx();
    const states = documentWithAllStates(ctx);
    // Descarta o rascunho aberto para liberar I1.
    const semRascunho = apply(states.document, ctx, discardDraft({ versionId: states.draft }))
      .document;

    const restaurada = apply(
      semRascunho,
      ctx,
      createDraft({ matrixId: states.matrixId, baseVersionId: states.superseded }),
    );
    const draft = versionOf(restaurada.document, restaurada.data.versionId);
    expect(draft.baseVersionId).toBe(states.superseded);
    expect(draft.cells).toEqual(versionOf(states.document, states.superseded).cells);
    expect(restaurada.data.baseVersionNumber).toBe(1);
  });

  it('recusa matriz inexistente e base fora da matriz', () => {
    const ctx = testCtx();
    const { document, matrixId } = publishedMatrix(ctx);
    expectFailure(document, ctx, createDraft({ matrixId: 'fantasma' }), 'NOT_FOUND');
    expectFailure(document, ctx, createDraft({ matrixId, baseVersionId: 'fantasma' }), 'NOT_FOUND');
  });

  it('registra DRAFT_CREATED com o número da versão de origem', () => {
    const ctx = testCtx();
    const { document, matrixId } = publishedMatrix(ctx);
    const { result } = apply(document, ctx, createDraft({ matrixId }));
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe('DRAFT_CREATED');
    expect(result.events[0]!.summary).toBe(
      'Arthur criou a versão 2 de "MTZ_A" a partir da versão 1.',
    );
    expect(result.events[0]!.payload).toEqual({ baseVersionNumber: 1 });
  });
});

// ---------------------------------------------------------------------------
// §1.3 version/publish
// ---------------------------------------------------------------------------

describe('version/publish (§1.3)', () => {
  function readyToPublish(ctx: ReturnType<typeof testCtx>) {
    const created = createTestMatrix(baseDocument(), ctx);
    return {
      document: fillAllCells(created.document, ctx, created.data.versionId),
      versionId: created.data.versionId,
      matrixId: created.data.matrixId,
    };
  }

  it('publica, carimba a vigência e valida o documento', () => {
    const ctx = testCtx();
    const { document, versionId } = readyToPublish(ctx);
    const { document: published, data, result } = apply(
      document,
      ctx,
      publishVersion({ versionId, notes: 'Primeira publicação da matriz.' }),
    );

    const version = versionOf(published, versionId);
    expect(version.state).toBe('PUBLISHED');
    expect(version.publishedBy).toBe('Arthur');
    expect(version.publishedAt).toBe(T0);
    expect(version.effectiveFrom).toBe(T0);
    expect(version.effectiveTo).toBeUndefined();
    expect(version.notes).toBe('Primeira publicação da matriz.');
    expect(data.supersededVersionId).toBeNull();
    expect(result.events.map((event) => event.type)).toEqual(['VERSION_PUBLISHED']);
    expect(result.events[0]!.payload).toEqual({ effectiveFrom: T0, diffSummary: null });
    expect(validateDocument(published).ok).toBe(true);
  });

  it('I2: publicar substitui a anterior e nunca deixa duas PUBLISHED', () => {
    const ctx = testCtx();
    const { document, versionId, matrixId } = readyToPublish(ctx);
    const v1Published = apply(
      document,
      ctx,
      publishVersion({ versionId, notes: 'Primeira publicação.' }),
    ).document;

    const v2 = apply(v1Published, ctx, createDraft({ matrixId }));
    ctx.advance(DAY);
    const { document: v2Published, data, result } = apply(
      v2.document,
      ctx,
      publishVersion({ versionId: v2.data.versionId, notes: 'Segunda publicação.' }),
    );

    const matrix = locateMatrix(v2Published, matrixId).matrix;
    expect(matrix.versions.filter((version) => version.state === 'PUBLISHED')).toHaveLength(1);
    expect(versionOf(v2Published, versionId).state).toBe('SUPERSEDED');
    expect(versionOf(v2Published, versionId).effectiveTo).toBe(
      versionOf(v2Published, v2.data.versionId).effectiveFrom,
    );
    expect(data.supersededVersionId).toBe(versionId);
    expect(result.events.map((event) => event.type)).toEqual([
      'VERSION_SUPERSEDED',
      'VERSION_PUBLISHED',
    ]);
    expect(result.events[0]!.summary).toBe(
      'A versão 1 de "MTZ_A" foi substituída pela versão 2.',
    );
    expect(validateDocument(v2Published).ok).toBe(true);
  });

  it('I4: três publicações produzem intervalos contíguos, e a vigência acerta no instante exato da troca', () => {
    const ctx = testCtx();
    const { document, versionId, matrixId } = readyToPublish(ctx);
    let doc = apply(document, ctx, publishVersion({ versionId, notes: 'Publicação 1.' })).document;

    const ids = [versionId];
    for (const number of [2, 3]) {
      const draft = apply(doc, ctx, createDraft({ matrixId }));
      ctx.advance(DAY);
      doc = apply(
        draft.document,
        ctx,
        publishVersion({ versionId: draft.data.versionId, notes: `Publicação ${number}.` }),
      ).document;
      ids.push(draft.data.versionId);
    }

    const versions = ids.map((id) => versionOf(doc, id));
    expect(versions.map((version) => version.state)).toEqual([
      'SUPERSEDED',
      'SUPERSEDED',
      'PUBLISHED',
    ]);
    // Contíguos e sem sobreposição: o fim de cada um é o começo do próximo.
    expect(versions[0]!.effectiveTo).toBe(versions[1]!.effectiveFrom);
    expect(versions[1]!.effectiveTo).toBe(versions[2]!.effectiveFrom);
    expect(versions[2]!.effectiveTo).toBeUndefined();
    expect(validateDocument(doc).ok).toBe(true);

    const at = (iso: string) => getEffectiveVersion(doc, matrixId, new Date(iso))?.number ?? null;
    // Antes de tudo: não havia política vigente.
    expect(at('2025-12-31T23:59:59.999Z')).toBeNull();
    // Durante cada intervalo.
    expect(at(versions[0]!.effectiveFrom!)).toBe(1);
    expect(at('2026-01-01T12:00:00.000Z')).toBe(1);
    expect(at('2026-01-02T12:00:00.000Z')).toBe(2);
    expect(at('2026-01-03T12:00:00.000Z')).toBe(3);
    // No instante exato da troca vale a versão nova (intervalo semiaberto).
    expect(at(versions[1]!.effectiveFrom!)).toBe(2);
    expect(at(versions[2]!.effectiveFrom!)).toBe(3);
    // Um milissegundo antes, ainda vale a anterior.
    expect(at(new Date(new Date(versions[1]!.effectiveFrom!).getTime() - 1).toISOString())).toBe(1);
  });

  it('I6: publicar com pendência falha com UNSET_CELLS_REMAIN e a lista de coordenadas', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const error = expectFailure(
      created.document,
      ctx,
      publishVersion({ versionId: created.data.versionId, notes: 'Tentativa de publicação.' }),
      'UNSET_CELLS_REMAIN',
    );
    expect(error.details).toEqual({
      count: 6,
      coords: [
        { xPath: 'R1', yPath: 'SEM' },
        { xPath: 'R2', yPath: 'SEM' },
        { xPath: 'R3', yPath: 'SEM' },
        { xPath: 'R1', yPath: 'ALTO' },
        { xPath: 'R2', yPath: 'ALTO' },
        { xPath: 'R3', yPath: 'ALTO' },
      ],
    });
  });

  it('recusa nas seis validações, na ordem especificada', () => {
    const ctx = testCtx();
    const { document, versionId } = readyToPublish(ctx);

    expectFailure(document, ctx, publishVersion({ versionId: 'fantasma', notes: 'x'.repeat(20) }), 'NOT_FOUND');

    // 2. notas curtas — checadas antes de qualquer coisa sobre células.
    expectFailure(document, ctx, publishVersion({ versionId, notes: 'curta' }), 'NOTES_REQUIRED');

    // 4. chave de célula fora do grid (I5).
    const grade: PolicyOpsDocument = structuredClone(document);
    locateVersion(grade, versionId).version.cells['R9::SEM'] = { decision: 'APROVADO' };
    const gradeErro = expectFailure(
      grade,
      ctx,
      publishVersion({ versionId, notes: 'Publicação válida.' }),
      'CELL_GRID_INCONSISTENT',
    );
    expect(gradeErro.details).toEqual({ keys: ['R9::SEM'] });

    // 5. referência a catálogo inexistente (I17).
    const semRef: PolicyOpsDocument = structuredClone(document);
    locateVersion(semRef, versionId).version.cells['R1::SEM'] = {
      decision: 'APROVADO',
      offer: 'OFERTA_FANTASMA',
    };
    const refErro = expectFailure(
      semRef,
      ctx,
      publishVersion({ versionId, notes: 'Publicação válida.' }),
      'CATALOG_REF_MISSING',
    );
    expect(refErro.details).toEqual({
      refs: [{ key: 'R1::SEM', field: 'offer', code: 'OFERTA_FANTASMA' }],
    });
  });

  it('aceita publicação agendada e recusa publicação retroativa', () => {
    const ctx = testCtx();
    const { document, versionId } = readyToPublish(ctx);

    expectFailure(
      document,
      ctx,
      publishVersion({ versionId, notes: 'Publicação válida.', effectiveFrom: 'ontem' }),
      'INVALID_INPUT',
    );
    expectFailure(
      document,
      ctx,
      publishVersion({
        versionId,
        notes: 'Publicação válida.',
        effectiveFrom: '2025-12-31T00:00:00.000Z',
      }),
      'EFFECTIVE_DATE_INVALID',
    );

    // Agendada: a versão fica PUBLISHED com vigência no futuro.
    const futuro = '2026-06-01T00:00:00.000Z';
    const { document: agendada } = apply(
      document,
      ctx,
      publishVersion({ versionId, notes: 'Publicação agendada.', effectiveFrom: futuro }),
    );
    expect(versionOf(agendada, versionId).state).toBe('PUBLISHED');
    expect(versionOf(agendada, versionId).effectiveFrom).toBe(futuro);
    // A consulta de vigência continua correta: hoje ainda não vale nada.
    const matrixId = locateVersion(agendada, versionId).matrix.id;
    expect(getEffectiveVersion(agendada, matrixId, new Date(T0))).toBeNull();
    expect(getEffectiveVersion(agendada, matrixId, new Date(futuro))?.id).toBe(versionId);
  });

  it('recusa vigência anterior ou igual à da versão vigente', () => {
    const ctx = testCtx();
    const { document, versionId, matrixId } = readyToPublish(ctx);
    const publicada = apply(
      document,
      ctx,
      publishVersion({ versionId, notes: 'Publicação inicial.', effectiveFrom: '2026-03-01T00:00:00.000Z' }),
    ).document;
    const draft = apply(publicada, ctx, createDraft({ matrixId }));

    expectFailure(
      draft.document,
      ctx,
      publishVersion({
        versionId: draft.data.versionId,
        notes: 'Publicação seguinte.',
        effectiveFrom: '2026-03-01T00:00:00.000Z',
      }),
      'EFFECTIVE_DATE_INVALID',
    );
  });

  it.each(['published', 'superseded', 'archived'] as const)(
    'recusa publicar uma versão em %s',
    (which) => {
      const ctx = testCtx();
      const states = documentWithAllStates(ctx);
      expectFailure(
        states.document,
        ctx,
        publishVersion({ versionId: states[which], notes: 'Publicação inválida.' }),
        'VERSION_NOT_DRAFT',
      );
    },
  );

  it('não tem inverso: o desfazer falha com mensagem explícita', () => {
    const ctx = testCtx();
    const { document, versionId } = readyToPublish(ctx);
    const { result } = apply(document, ctx, publishVersion({ versionId, notes: 'Publicação.' }));
    const undone = result.inverse.run(document, ctx);
    expect(undone.ok).toBe(false);
    expect((undone as { ok: false; error: Error }).error.message).toMatch(
      /não pode ser desfeito/,
    );
  });
});

// ---------------------------------------------------------------------------
// §1.4 version/discardDraft
// ---------------------------------------------------------------------------

describe('version/discardDraft (§1.4)', () => {
  it('arquiva o rascunho e queima o número da versão', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const filled = fillAllCells(created.document, ctx, created.data.versionId);
    const publicada = apply(
      filled,
      ctx,
      publishVersion({ versionId: created.data.versionId, notes: 'Publicação inicial.' }),
    ).document;

    const v2 = apply(publicada, ctx, createDraft({ matrixId: created.data.matrixId }));
    expect(v2.data.number).toBe(2);
    const { document: descartada, data, result } = apply(
      v2.document,
      ctx,
      discardDraft({ versionId: v2.data.versionId }),
    );

    const version = versionOf(descartada, v2.data.versionId);
    expect(version.state).toBe('ARCHIVED');
    expect(version.archivedAt).toBe(T0);
    expect(data.editedCells).toBe(6);
    expect(result.events[0]!.type).toBe('DRAFT_DISCARDED');
    expect(result.events[0]!.payload).toEqual({ editedCells: 6 });

    // O número 2 está queimado: o próximo rascunho é a versão 3.
    const v3 = apply(descartada, ctx, createDraft({ matrixId: created.data.matrixId }));
    expect(v3.data.number).toBe(3);
    expect(validateDocument(v3.document).ok).toBe(true);
  });

  it.each(['published', 'superseded', 'archived'] as const)(
    'recusa descartar uma versão em %s',
    (which) => {
      const ctx = testCtx();
      const states = documentWithAllStates(ctx);
      expectFailure(
        states.document,
        ctx,
        discardDraft({ versionId: states[which] }),
        'VERSION_NOT_DRAFT',
      );
    },
  );

  it('não tem inverso: o desfazer falha com mensagem explícita', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const { result } = apply(
      created.document,
      ctx,
      discardDraft({ versionId: created.data.versionId }),
    );
    const undone = result.inverse.run(created.document, ctx);
    expect(undone.ok).toBe(false);
    expect((undone as { ok: false; error: Error }).error.message).toMatch(/queimado/);
  });
});

// ---------------------------------------------------------------------------
// version/addNote
// ---------------------------------------------------------------------------

describe('version/addNote', () => {
  it('anota no histórico sem tocar na versão — vale em qualquer estado', () => {
    const ctx = testCtx();
    const states = documentWithAllStates(ctx);
    const { document, result } = apply(
      states.document,
      ctx,
      addNote({ versionId: states.published, text: '  Revisado com o jurídico.  ' }),
    );

    expect(withoutEvents(document)).toEqual(withoutEvents(states.document));
    expect(result.events[0]!.type).toBe('NOTE_ADDED');
    expect(result.events[0]!.payload).toEqual({ text: 'Revisado com o jurídico.' });
    expect(result.events[0]!.summary).toBe(
      'Arthur anotou na versão 3 de "MTZ_A": Revisado com o jurídico.',
    );
    expect(result.inverse.run(document, ctx).ok).toBe(false);
  });

  it('recusa versão inexistente e anotação em branco', () => {
    const ctx = testCtx();
    const states = documentWithAllStates(ctx);
    expectFailure(states.document, ctx, addNote({ versionId: 'fantasma', text: 'x' }), 'NOT_FOUND');
    expectFailure(
      states.document,
      ctx,
      addNote({ versionId: states.draft, text: '   ' }),
      'INVALID_INPUT',
    );
  });
});

// ---------------------------------------------------------------------------
// Inversos estruturais
// ---------------------------------------------------------------------------

describe('inversos de criação', () => {
  it('desfaz e refaz matrix/create devolvendo o documento idêntico', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const created = createTestMatrix(doc, ctx);

    const undone = apply(created.document, ctx, created.result.inverse);
    expect(withoutEvents(undone.document)).toEqual(withoutEvents(doc));

    const redone = apply(undone.document, ctx, undone.result.inverse);
    expect(withoutEvents(redone.document)).toEqual(withoutEvents(created.document));
  });

  it('recusa remover uma matriz que já tem histórico', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const filled = fillAllCells(created.document, ctx, created.data.versionId);
    const publicada = apply(
      filled,
      ctx,
      publishVersion({ versionId: created.data.versionId, notes: 'Publicação inicial.' }),
    ).document;

    expectFailure(publicada, ctx, created.result.inverse, 'VERSION_IMMUTABLE');
    expectFailure(baseDocument(), ctx, created.result.inverse, 'NOT_FOUND');
  });

  it('desfaz e refaz version/createDraft devolvendo o documento idêntico', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const filled = fillAllCells(created.document, ctx, created.data.versionId);
    const publicada = apply(
      filled,
      ctx,
      publishVersion({ versionId: created.data.versionId, notes: 'Publicação inicial.' }),
    ).document;

    const draft = apply(publicada, ctx, createDraft({ matrixId: created.data.matrixId }));
    const undone = apply(draft.document, ctx, draft.result.inverse);
    expect(withoutEvents(undone.document)).toEqual(withoutEvents(publicada));

    const redone = apply(undone.document, ctx, undone.result.inverse);
    expect(withoutEvents(redone.document)).toEqual(withoutEvents(draft.document));
  });
});

// ---------------------------------------------------------------------------
// Pureza e imutabilidade (regras 1 e 2 de docs/08 §1)
// ---------------------------------------------------------------------------

describe('pureza e imutabilidade', () => {
  it('o mesmo comando com o mesmo ctx produz resultado idêntico', () => {
    const doc = baseDocument();
    const primeiro = createTestMatrix(doc, testCtx());
    const segundo = createTestMatrix(doc, testCtx());
    expect(segundo.document).toEqual(primeiro.document);
    expect(segundo.result.events).toEqual(primeiro.result.events);
    expect(segundo.data).toEqual(primeiro.data);
  });

  it('nenhum comando muta o documento recebido', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const antes = structuredClone(doc);

    const created = createTestMatrix(doc, ctx);
    expect(doc).toEqual(antes);

    const anterior = structuredClone(created.document);
    apply(created.document, ctx, discardDraft({ versionId: created.data.versionId }));
    expect(created.document).toEqual(anterior);
  });

  it('erro não altera o documento nem deixa estado parcial', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const antes = structuredClone(doc);
    expectFailure(doc, ctx, createMatrix({
      projectId: IDS.projectA,
      code: 'MTZ_A',
      name: 'Matriz A',
      x: { levels: [{ variableId: IDS.score }] },
      y: { levels: [{ variableId: IDS.score }] },
    }), 'VARIABLE_ON_BOTH_AXES');
    expect(doc).toEqual(antes);
  });
});

// ---------------------------------------------------------------------------
// O teste mais importante do projeto: o lastro do snapshot
// ---------------------------------------------------------------------------

describe('snapshot: evolução da biblioteca não altera matriz nenhuma (§5.1)', () => {
  it('publicar uma nova versão de variável não muda nem a publicada nem o rascunho', () => {
    const ctx = testCtx();

    // Uma matriz com v1 PUBLISHED e v2 DRAFT, ambas pinadas em SCORE v1.
    const created = createTestMatrix(baseDocument(), ctx);
    const filled = fillAllCells(created.document, ctx, created.data.versionId);
    const publicada = apply(
      filled,
      ctx,
      publishVersion({ versionId: created.data.versionId, notes: 'Publicação inicial.' }),
    ).document;
    const comRascunho = apply(publicada, ctx, createDraft({ matrixId: created.data.matrixId }))
      .document;

    const matrizesAntes = structuredClone(comRascunho.matrices);

    // A biblioteca evolui: SCORE ganha a v2 publicada, com um domínio a mais e
    // um rótulo diferente, e a v1 passa a SUPERSEDED. (Os comandos de
    // biblioteca são S06; aqui o efeito é aplicado direto ao documento, que é
    // exatamente o que `variable/publish` fará.)
    const evoluido: PolicyOpsDocument = structuredClone(comRascunho);
    const score = evoluido.variables.find((variable) => variable.id === IDS.score)!;
    score.versions[0]!.state = 'SUPERSEDED';
    score.versions.push({
      id: IDS.scoreV2,
      number: 2,
      state: 'PUBLISHED',
      createdAt: '2026-02-01T00:00:00.000Z',
      createdBy: 'Equipe',
      publishedAt: '2026-02-01T00:00:00.000Z',
      publishedBy: 'Equipe',
      domains: [
        { code: 'R1', label: 'R1 — renomeado', position: 0 },
        { code: 'R2', label: 'Rótulo R2', position: 1 },
        { code: 'R3', label: 'Rótulo R3', position: 2 },
        { code: 'R4', label: 'Rótulo R4', position: 3 },
      ],
    });

    // O lastro: **nada** nas matrizes se move. Nem a publicada, nem o
    // rascunho. Os pinos continuam apontando para a v1, os snapshots de
    // domínio continuam com 3 domínios e as tuplas continuam congeladas.
    // Adotar a evolução é sempre ato explícito do usuário (§5, S16).
    expect(evoluido.matrices).toEqual(matrizesAntes);

    for (const version of evoluido.matrices[0]!.versions) {
      expect(version.axes.x.levels[0]!.variableVersionId).toBe(IDS.scoreV1);
      expect(version.axes.x.levels[0]!.domains).toHaveLength(3);
      expect(version.axes.x.levels[0]!.domains[0]!.label).toBe('Rótulo R1');
      expect(version.axes.x.tuples).toEqual(['R1', 'R2', 'R3']);
    }

    // E criar um rascunho novo depois disso também não adota a v2: o clone
    // não atualiza pinos nem regenera tuplas (§1.2).
    const descartado = apply(
      evoluido,
      ctx,
      discardDraft({ versionId: evoluido.matrices[0]!.versions[1]!.id }),
    ).document;
    const novoRascunho = apply(
      descartado,
      ctx,
      createDraft({ matrixId: created.data.matrixId }),
    );
    const clone = versionOf(novoRascunho.document, novoRascunho.data.versionId);
    expect(clone.axes.x.levels[0]!.variableVersionId).toBe(IDS.scoreV1);
    expect(clone.axes.x.tuples).toEqual(['R1', 'R2', 'R3']);
  });
});

// ---------------------------------------------------------------------------
// Consultas de apoio
// ---------------------------------------------------------------------------

describe('consultas de apoio', () => {
  it('conta combinações e lista as pendentes', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const version = versionOf(created.document, created.data.versionId);
    expect(combinationCount(version)).toBe(6);
    expect(pendingCoords(version)).toHaveLength(6);

    const filled = fillAllCells(created.document, ctx, created.data.versionId);
    expect(pendingCoords(versionOf(filled, created.data.versionId))).toEqual([]);
  });
});
