import { describe, expect, it } from 'vitest';
import type { Domain, PolicyOpsDocument, RegionalDimension } from '@/core/document/schema';
import {
  archiveVariable,
  createVariable,
  createVariableDraft,
  discardVariableDraft,
  duplicateVariable,
  publishVariable,
  saveVariableDomains,
  updateVariableMeta,
} from '@/core/library/variables';
import { getVariableUsage, listVariables } from '@/core/queries';
import { publishVersion } from '@/core/versioning/lifecycle';
import {
  apply,
  baseDocument,
  createTestMatrix,
  expectFailure,
  fillAllCells,
  IDS,
  SCORE_DOMAINS,
  T0,
  testCtx,
} from '../versioning/fixtures';

function domain(code: string, position: number, extra: Partial<Domain> = {}): Domain {
  return { code, label: `Rótulo ${code}`, position, ...extra };
}

describe('variable/create', () => {
  it('cria a variável com v1 DRAFT e sem domínios', () => {
    const ctx = testCtx();
    const { document, data } = apply(
      baseDocument(),
      ctx,
      createVariable({ code: 'NOVA', name: 'Nova Variável', type: 'CATEGORICAL' }),
    );
    const created = document.variables.find((v) => v.id === data.variableId)!;
    expect(created.code).toBe('NOVA');
    expect(created.versions).toHaveLength(1);
    expect(created.versions[0]!.state).toBe('DRAFT');
    expect(created.versions[0]!.domains).toEqual([]);
    expect(data.versionId).toBe(created.versions[0]!.id);
  });

  it('recusa código duplicado', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      createVariable({ code: 'SCORE', name: 'Duplicada', type: 'CATEGORICAL' }),
      'DUPLICATE_CODE',
    );
  });

  it('recusa código em formato inválido', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      createVariable({ code: 'minusculo', name: 'X', type: 'CATEGORICAL' }),
      'INVALID_INPUT',
    );
  });

  it('recusa nome em branco', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      createVariable({ code: 'NOVA', name: '   ', type: 'CATEGORICAL' }),
      'INVALID_INPUT',
    );
  });

  it('o inverso desfaz a criação', () => {
    const ctx = testCtx();
    const { document, result } = apply(
      baseDocument(),
      ctx,
      createVariable({ code: 'NOVA', name: 'Nova', type: 'CATEGORICAL' }),
    );
    const undone = apply(document, ctx, result.inverse);
    expect(undone.document.variables.some((v) => v.code === 'NOVA')).toBe(false);
  });

  it('refazer (desfazer o desfazer) restaura a variável removida', () => {
    const ctx = testCtx();
    const { document, result } = apply(
      baseDocument(),
      ctx,
      createVariable({ code: 'NOVA', name: 'Nova', type: 'CATEGORICAL' }),
    );
    const undone = apply(document, ctx, result.inverse);
    const redone = apply(undone.document, ctx, undone.result.inverse);
    expect(redone.document.variables.find((v) => v.code === 'NOVA')).toEqual(
      document.variables.find((v) => v.code === 'NOVA'),
    );
  });
});

describe('variable/updateMeta', () => {
  it('atualiza nome e descrição, e o inverso restaura', () => {
    const ctx = testCtx();
    const { document, result } = apply(
      baseDocument(),
      ctx,
      updateVariableMeta({ variableId: IDS.score, name: 'Score Renomeado', description: 'Nova descrição' }),
    );
    const updated = document.variables.find((v) => v.id === IDS.score)!;
    expect(updated.name).toBe('Score Renomeado');
    expect(updated.description).toBe('Nova descrição');

    const undone = apply(document, ctx, result.inverse);
    const reverted = undone.document.variables.find((v) => v.id === IDS.score)!;
    expect(reverted.name).toBe('Score');
    expect(reverted.description).toBeUndefined();
  });

  it('description: null apaga o campo', () => {
    const ctx = testCtx();
    const withDesc = apply(
      baseDocument(),
      ctx,
      updateVariableMeta({ variableId: IDS.score, description: 'Algo' }),
    ).document;
    const cleared = apply(withDesc, ctx, updateVariableMeta({ variableId: IDS.score, description: null }))
      .document;
    expect(cleared.variables.find((v) => v.id === IDS.score)!.description).toBeUndefined();
  });

  it('falha com NOT_FOUND para variável inexistente', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      updateVariableMeta({ variableId: 'nada', name: 'X' }),
      'NOT_FOUND',
    );
  });
});

describe('variable/createDraft', () => {
  it('clona a versão PUBLISHED em DRAFT', () => {
    const ctx = testCtx();
    const { document, data } = apply(baseDocument(), ctx, createVariableDraft({ variableId: IDS.score }));
    const variable = document.variables.find((v) => v.id === IDS.score)!;
    expect(variable.versions).toHaveLength(2);
    expect(data.number).toBe(2);
    expect(data.basedOnNumber).toBe(1);
    const draft = variable.versions.find((v) => v.id === data.versionId)!;
    expect(draft.state).toBe('DRAFT');
    expect(draft.domains).toEqual(SCORE_DOMAINS);
    // É uma cópia, não a mesma referência.
    expect(draft.domains).not.toBe(variable.versions[0]!.domains);
  });

  it('falha com DRAFT_ALREADY_EXISTS se já houver rascunho', () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createVariableDraft({ variableId: IDS.score })).document;
    expectFailure(withDraft, ctx, createVariableDraft({ variableId: IDS.score }), 'DRAFT_ALREADY_EXISTS');
  });

  it('falha com NO_VERSION_TO_DERIVE quando não há nenhuma versão publicada nem em rascunho', () => {
    const ctx = testCtx();
    const created = apply(
      baseDocument(),
      ctx,
      createVariable({ code: 'VAZIA', name: 'Vazia', type: 'CATEGORICAL' }),
    );
    // A v1 recém-criada é DRAFT; descartá-la deixa a variável sem nenhuma versão.
    const discarded = apply(
      created.document,
      ctx,
      discardVariableDraft({ variableId: created.data.variableId, versionId: created.data.versionId }),
    ).document;
    expectFailure(
      discarded,
      ctx,
      createVariableDraft({ variableId: created.data.variableId }),
      'NO_VERSION_TO_DERIVE',
    );
  });

  it('o inverso descarta o rascunho recém-criado', () => {
    const ctx = testCtx();
    const { document, result } = apply(baseDocument(), ctx, createVariableDraft({ variableId: IDS.score }));
    const undone = apply(document, ctx, result.inverse);
    expect(undone.document.variables.find((v) => v.id === IDS.score)!.versions).toHaveLength(1);
  });

  it('clona também o boundaryMode da versão publicada', () => {
    const ctx = testCtx();
    const created = apply(
      baseDocument(),
      ctx,
      createVariable({ code: 'SERASA3', name: 'Score Serasa 3', type: 'RANGE' }),
    );
    const withInclusive = apply(
      created.document,
      ctx,
      saveVariableDomains({
        variableId: created.data.variableId,
        versionId: created.data.versionId,
        domains: [domain('A', 0, { rangeMin: '0', rangeMax: '9' }), domain('B', 1, { rangeMin: '10', isCatchAll: true })],
        boundaryMode: 'INCLUSIVE_INTEGER',
      }),
    ).document;
    const published = apply(
      withInclusive,
      ctx,
      publishVariable({ variableId: created.data.variableId, versionId: created.data.versionId }),
    ).document;
    const { document } = apply(published, ctx, createVariableDraft({ variableId: created.data.variableId }));
    const variable = document.variables.find((v) => v.id === created.data.variableId)!;
    const draft = variable.versions.find((v) => v.state === 'DRAFT')!;
    expect(draft.boundaryMode).toBe('INCLUSIVE_INTEGER');
  });
});

describe('variable/saveDomains', () => {
  it('substitui o conjunto inteiro de domínios em DRAFT', () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createVariableDraft({ variableId: IDS.score })).document;
    const draftVersionId = withDraft.variables.find((v) => v.id === IDS.score)!.versions[1]!.id;
    const newDomains = [domain('R1', 0), domain('R2', 1), domain('R3', 2), domain('R4', 3)];
    const { document } = apply(
      withDraft,
      ctx,
      saveVariableDomains({ variableId: IDS.score, versionId: draftVersionId, domains: newDomains }),
    );
    const draft = document.variables.find((v) => v.id === IDS.score)!.versions[1]!;
    expect(draft.domains).toEqual(newDomains);
  });

  it('recusa alterar uma versão que não está em DRAFT — VARIABLE_VERSION_IMMUTABLE', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      saveVariableDomains({
        variableId: IDS.score,
        versionId: IDS.scoreV1,
        domains: [domain('A', 0), domain('B', 1)],
      }),
      'VARIABLE_VERSION_IMMUTABLE',
    );
  });

  it('faixa com buraco mostra erro claro e não grava (RANGE_NOT_CONTIGUOUS)', () => {
    const ctx = testCtx();
    const created = apply(
      baseDocument(),
      ctx,
      createVariable({ code: 'FAIXA', name: 'Faixa', type: 'RANGE' }),
    );
    const validDomains = [
      domain('BAIXO', 0, { rangeMin: '0', rangeMax: '100' }),
      domain('ALTO', 1, { rangeMin: '100', rangeMax: '200' }),
    ];
    const withValidDomains = apply(
      created.document,
      ctx,
      saveVariableDomains({
        variableId: created.data.variableId,
        versionId: created.data.versionId,
        domains: validDomains,
      }),
    ).document;

    const withGap = [
      domain('BAIXO', 0, { rangeMin: '0', rangeMax: '100' }),
      domain('ALTO', 1, { rangeMin: '150', rangeMax: '200' }),
    ];
    const error = expectFailure(
      withValidDomains,
      ctx,
      saveVariableDomains({
        variableId: created.data.variableId,
        versionId: created.data.versionId,
        domains: withGap,
      }),
      'RANGE_NOT_CONTIGUOUS',
    );
    expect(error.message).toMatch(/contíguas/);
    // Nada foi gravado: os domínios da versão continuam os válidos de antes.
    const draft = withValidDomains.variables.find((v) => v.id === created.data.variableId)!.versions[0]!;
    expect(draft.domains).toEqual(validDomains);
  });

  it('BOOLEAN com 3 domínios não grava — BOOLEAN_NEEDS_TWO_DOMAINS', () => {
    const ctx = testCtx();
    const withVar = apply(
      baseDocument(),
      ctx,
      createVariable({ code: 'FLAG', name: 'Flag', type: 'BOOLEAN' }),
    ).document;
    const versionId = withVar.variables.find((v) => v.code === 'FLAG')!.versions[0]!.id;
    expectFailure(
      withVar,
      ctx,
      saveVariableDomains({
        variableId: withVar.variables.find((v) => v.code === 'FLAG')!.id,
        versionId,
        domains: [domain('SIM', 0), domain('NAO', 1), domain('TALVEZ', 2)],
      }),
      'BOOLEAN_NEEDS_TWO_DOMAINS',
    );
  });

  it('boundaryMode INCLUSIVE_INTEGER: aceita faixas fechado-fechado com salto de 1, sem ajuste manual', () => {
    const ctx = testCtx();
    const created = apply(
      baseDocument(),
      ctx,
      createVariable({ code: 'SERASA', name: 'Score Serasa', type: 'RANGE' }),
    );
    // R20: 0-357, R19: 358-437 — formato original do Excel, sem repetir o
    // máximo de R20 como mínimo de R19.
    const excelDomains = [
      domain('R20', 0, { rangeMin: '0', rangeMax: '357' }),
      domain('R19', 1, { rangeMin: '358', isCatchAll: true }),
    ];

    // Sem boundaryMode (HALF_OPEN), a mesma colagem crua é rejeitada.
    expectFailure(
      created.document,
      ctx,
      saveVariableDomains({
        variableId: created.data.variableId,
        versionId: created.data.versionId,
        domains: excelDomains,
      }),
      'RANGE_NOT_CONTIGUOUS',
    );

    // Ligando o modo, a mesma colagem passa e o campo fica gravado na versão.
    const { document } = apply(
      created.document,
      ctx,
      saveVariableDomains({
        variableId: created.data.variableId,
        versionId: created.data.versionId,
        domains: excelDomains,
        boundaryMode: 'INCLUSIVE_INTEGER',
      }),
    );
    const draft = document.variables.find((v) => v.id === created.data.variableId)!.versions[0]!;
    expect(draft.boundaryMode).toBe('INCLUSIVE_INTEGER');
    expect(draft.domains).toEqual(excelDomains);
  });

  it('o inverso de saveDomains restaura também o boundaryMode anterior', () => {
    const ctx = testCtx();
    const created = apply(
      baseDocument(),
      ctx,
      createVariable({ code: 'SERASA2', name: 'Score Serasa 2', type: 'RANGE' }),
    );
    const { document: withInclusive } = apply(
      created.document,
      ctx,
      saveVariableDomains({
        variableId: created.data.variableId,
        versionId: created.data.versionId,
        domains: [domain('R2', 0, { rangeMin: '0', rangeMax: '357' }), domain('R1', 1, { rangeMin: '358', isCatchAll: true })],
        boundaryMode: 'INCLUSIVE_INTEGER',
      }),
    );

    const { document, result } = apply(
      withInclusive,
      ctx,
      saveVariableDomains({
        variableId: created.data.variableId,
        versionId: created.data.versionId,
        domains: [
          domain('A', 0, { rangeMin: '0', rangeMax: '10' }),
          domain('B', 1, { rangeMin: '10', isCatchAll: true }),
        ],
      }),
    );
    expect(
      document.variables.find((v) => v.id === created.data.variableId)!.versions[0]!.boundaryMode,
    ).toBeUndefined();

    const undone = apply(document, ctx, result.inverse);
    expect(
      undone.document.variables.find((v) => v.id === created.data.variableId)!.versions[0]!.boundaryMode,
    ).toBe('INCLUSIVE_INTEGER');
  });

  it('o inverso restaura os domínios anteriores mesmo quando eram vazios', () => {
    const ctx = testCtx();
    const created = apply(
      baseDocument(),
      ctx,
      createVariable({ code: 'NOVA', name: 'Nova', type: 'CATEGORICAL' }),
    );
    const { document, result } = apply(
      created.document,
      ctx,
      saveVariableDomains({
        variableId: created.data.variableId,
        versionId: created.data.versionId,
        domains: [domain('A', 0), domain('B', 1)],
      }),
    );
    const undone = apply(document, ctx, result.inverse);
    expect(
      undone.document.variables.find((v) => v.id === created.data.variableId)!.versions[0]!.domains,
    ).toEqual([]);
  });
});

describe('variable/publish', () => {
  it('promove a versão e supera a anterior, com domainsAdded/domainsRemoved no evento', () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createVariableDraft({ variableId: IDS.score })).document;
    const draftVersionId = withDraft.variables.find((v) => v.id === IDS.score)!.versions[1]!.id;
    const withDomains = apply(
      withDraft,
      ctx,
      saveVariableDomains({
        variableId: IDS.score,
        versionId: draftVersionId,
        domains: [domain('R1', 0), domain('R2', 1), domain('R3', 2), domain('R4', 3)],
      }),
    ).document;

    const { document, result } = apply(
      withDomains,
      ctx,
      publishVariable({ variableId: IDS.score, versionId: draftVersionId, notes: 'Adicionei R4.' }),
    );

    const variable = document.variables.find((v) => v.id === IDS.score)!;
    expect(variable.versions.find((v) => v.id === IDS.scoreV1)!.state).toBe('SUPERSEDED');
    expect(variable.versions.find((v) => v.id === draftVersionId)!.state).toBe('PUBLISHED');
    expect(variable.versions.find((v) => v.id === draftVersionId)!.publishedBy).toBe('Arthur');

    const events = result.events;
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('VARIABLE_PUBLISHED');
    expect(events[0]!.payload).toMatchObject({
      code: 'SCORE',
      versionNumber: 2,
      domainsAdded: ['R4'],
      domainsRemoved: [],
    });
  });

  it('recusa publicar uma versão fora de DRAFT', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      publishVariable({ variableId: IDS.score, versionId: IDS.scoreV1 }),
      'VARIABLE_VERSION_IMMUTABLE',
    );
  });

  it('recusa publicar domínios inválidos (draft nunca editado, domains vazio)', () => {
    const ctx = testCtx();
    const created = apply(
      baseDocument(),
      ctx,
      createVariable({ code: 'NOVA', name: 'Nova', type: 'CATEGORICAL' }),
    ).document;
    const variableId = created.variables.find((v) => v.code === 'NOVA')!.id;
    const versionId = created.variables.find((v) => v.code === 'NOVA')!.versions[0]!.id;
    expectFailure(created, ctx, publishVariable({ variableId, versionId }), 'INVALID_DOMAIN_SET');
  });

  it('o inverso é irreversível', () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createVariableDraft({ variableId: IDS.score })).document;
    const draftVersionId = withDraft.variables.find((v) => v.id === IDS.score)!.versions[1]!.id;
    const { result } = apply(
      withDraft,
      ctx,
      publishVariable({ variableId: IDS.score, versionId: draftVersionId, notes: 'ok' }),
    );
    expect(result.inverse.run(baseDocument(), ctx).ok).toBe(false);
  });

  it('publicar v2 não altera nenhum snapshot de eixo já existente numa matriz (garantia da S04, pela biblioteca)', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const beforeMatrix = structuredClone(
      created.document.matrices.find((m) => m.id === created.data.matrixId)!,
    );

    const withDraft = apply(created.document, ctx, createVariableDraft({ variableId: IDS.score })).document;
    const draftVersionId = withDraft.variables.find((v) => v.id === IDS.score)!.versions[1]!.id;
    const withDomains = apply(
      withDraft,
      ctx,
      saveVariableDomains({
        variableId: IDS.score,
        versionId: draftVersionId,
        domains: [domain('R1', 0), domain('R2', 1), domain('R3', 2), domain('R4', 3)],
      }),
    ).document;
    const published = apply(
      withDomains,
      ctx,
      publishVariable({ variableId: IDS.score, versionId: draftVersionId, notes: 'Adicionei R4.' }),
    ).document;

    const afterMatrix = published.matrices.find((m) => m.id === created.data.matrixId)!;
    expect(afterMatrix).toEqual(beforeMatrix);
    expect(afterMatrix.versions[0]!.axes.x.tuples).toEqual(['R1', 'R2', 'R3']);
    expect(afterMatrix.versions[0]!.axes.x.levels[0]!.domains).toEqual(SCORE_DOMAINS);
    expect(afterMatrix.versions[0]!.axes.x.levels[0]!.variableVersionId).toBe(IDS.scoreV1);
  });
});

describe('variable/discardDraft', () => {
  it('remove a versão em rascunho (sem estado ARCHIVED para VariableVersion)', () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createVariableDraft({ variableId: IDS.score })).document;
    const draftVersionId = withDraft.variables.find((v) => v.id === IDS.score)!.versions[1]!.id;
    const { document, data } = apply(
      withDraft,
      ctx,
      discardVariableDraft({ variableId: IDS.score, versionId: draftVersionId }),
    );
    expect(data.number).toBe(2);
    expect(document.variables.find((v) => v.id === IDS.score)!.versions).toHaveLength(1);
  });

  it('recusa descartar uma versão que não está em DRAFT', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      discardVariableDraft({ variableId: IDS.score, versionId: IDS.scoreV1 }),
      'VARIABLE_VERSION_IMMUTABLE',
    );
  });

  it('o inverso restaura a versão descartada', () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createVariableDraft({ variableId: IDS.score })).document;
    const draftVersionId = withDraft.variables.find((v) => v.id === IDS.score)!.versions[1]!.id;
    const { document, result } = apply(
      withDraft,
      ctx,
      discardVariableDraft({ variableId: IDS.score, versionId: draftVersionId }),
    );
    const undone = apply(document, ctx, result.inverse);
    const restored = undone.document.variables.find((v) => v.id === IDS.score)!;
    expect(restored.versions).toHaveLength(2);
    expect(restored.versions[1]!.id).toBe(draftVersionId);
  });
});

describe('variable/archive', () => {
  it('falha quando em uso por versão PUBLICADA de matriz', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const filled = fillAllCells(created.document, ctx, created.data.versionId);
    const published = apply(
      filled,
      ctx,
      publishVersion({ versionId: created.data.versionId, notes: 'Publicação inicial.' }),
    ).document;

    expectFailure(published, ctx, archiveVariable({ variableId: IDS.score }), 'INVALID_INPUT');
  });

  it('passa quando o uso é só em rascunho', () => {
    const ctx = testCtx();
    // createTestMatrix cria a v1 em DRAFT — nunca publicada.
    const created = createTestMatrix(baseDocument(), ctx);
    expect(getVariableUsage(created.document, IDS.score).every((u) => u.versionState === 'DRAFT')).toBe(
      true,
    );

    const { document } = apply(created.document, ctx, archiveVariable({ variableId: IDS.score }));
    expect(document.variables.find((v) => v.id === IDS.score)!.archivedAt).toBeDefined();
  });

  it('passa quando a variável não está em uso nenhum', () => {
    const ctx = testCtx();
    const { document } = apply(baseDocument(), ctx, archiveVariable({ variableId: IDS.fat }));
    expect(document.variables.find((v) => v.id === IDS.fat)!.archivedAt).toBeDefined();
    expect(listVariables(document).map((entry) => entry.variable.code)).not.toContain('FAT');
  });

  it('o inverso desarquiva, e refazer arquiva de novo com o mesmo carimbo', () => {
    const ctx = testCtx();
    const { document, result } = apply(baseDocument(), ctx, archiveVariable({ variableId: IDS.fat }));
    const undone = apply(document, ctx, result.inverse);
    expect(undone.document.variables.find((v) => v.id === IDS.fat)!.archivedAt).toBeUndefined();

    const redone = apply(undone.document, ctx, undone.result.inverse);
    expect(redone.document.variables.find((v) => v.id === IDS.fat)!.archivedAt).toBe(
      document.variables.find((v) => v.id === IDS.fat)!.archivedAt,
    );
  });
});

describe('variable/duplicate (docs/05 §5.6.3)', () => {
  it('copia domínios e regionalDimension fielmente, com o mesmo type e sem eventos', () => {
    const ctx = testCtx();
    const regionalDimension: RegionalDimension = {
      regions: [{ code: 'BASE', label: 'Base' }, { code: 'SP', label: 'São Paulo' }],
    };
    const created0 = apply(
      baseDocument(),
      ctx,
      createVariable({ code: 'HVI1', name: 'HVI1', type: 'RANGE' }),
    );
    const withRegional = apply(
      created0.document,
      ctx,
      saveVariableDomains({
        variableId: created0.data.variableId,
        versionId: created0.data.versionId,
        domains: [
          { code: 'R1', label: 'R1', position: 0, regionalRanges: { BASE: { min: '0', max: '100' }, SP: { min: '0', max: '120' } } },
          { code: 'R2', label: 'R2', position: 1, regionalRanges: { BASE: { min: '100', max: '200' }, SP: { min: '120', max: '240' } } },
        ],
        regionalDimension,
      }),
    ).document;

    const before = structuredClone(withRegional);
    const { document, data } = apply(
      withRegional,
      ctx,
      duplicateVariable({
        sourceVariableId: created0.data.variableId,
        sourceVersionId: created0.data.versionId,
        code: 'HVI2',
        name: 'HVI2',
      }),
    );

    const created = document.variables.find((v) => v.id === data.variableId)!;
    expect(created.code).toBe('HVI2');
    expect(created.type).toBe('RANGE');
    expect(created.versions).toHaveLength(1);
    expect(created.versions[0]!.state).toBe('DRAFT');
    expect(created.versions[0]!.number).toBe(1);
    expect(created.versions[0]!.domains).toEqual(
      withRegional.variables.find((v) => v.id === created0.data.variableId)!.versions[0]!.domains,
    );
    expect(created.versions[0]!.regionalDimension).toEqual(regionalDimension);
    expect(document.events).toEqual(withRegional.events);

    // A origem não é tocada.
    expect(document.variables.find((v) => v.id === created0.data.variableId)).toEqual(
      before.variables.find((v) => v.id === created0.data.variableId),
    );
  });

  it('copia também o boundaryMode da versão de origem', () => {
    const ctx = testCtx();
    const created0 = apply(
      baseDocument(),
      ctx,
      createVariable({ code: 'SERASA4', name: 'Score Serasa 4', type: 'RANGE' }),
    );
    const withInclusive = apply(
      created0.document,
      ctx,
      saveVariableDomains({
        variableId: created0.data.variableId,
        versionId: created0.data.versionId,
        domains: [domain('A', 0, { rangeMin: '0', rangeMax: '9' }), domain('B', 1, { rangeMin: '10', isCatchAll: true })],
        boundaryMode: 'INCLUSIVE_INTEGER',
      }),
    ).document;

    const { document, data } = apply(
      withInclusive,
      ctx,
      duplicateVariable({
        sourceVariableId: created0.data.variableId,
        sourceVersionId: created0.data.versionId,
        code: 'SERASA5',
        name: 'Score Serasa 5',
      }),
    );
    const created = document.variables.find((v) => v.id === data.variableId)!;
    expect(created.versions[0]!.boundaryMode).toBe('INCLUSIVE_INTEGER');
  });

  it('falha com DUPLICATE_CODE quando o código novo já existe', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      duplicateVariable({
        sourceVariableId: IDS.fat,
        sourceVersionId: IDS.fatV1,
        code: 'SCORE',
        name: 'Duplicada',
      }),
      'DUPLICATE_CODE',
    );
  });

  it('falha com NOT_FOUND quando a variável de origem não existe', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      duplicateVariable({
        sourceVariableId: 'inexistente__',
        sourceVersionId: IDS.fatV1,
        code: 'NOVA',
        name: 'Nova',
      }),
      'NOT_FOUND',
    );
  });

  it('falha com NOT_FOUND quando a versão de origem não existe', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      duplicateVariable({
        sourceVariableId: IDS.fat,
        sourceVersionId: 'inexistente__',
        code: 'NOVA',
        name: 'Nova',
      }),
      'NOT_FOUND',
    );
  });

  it('variável sem regionalDimension duplica sem o campo (omitido, não null)', () => {
    const ctx = testCtx();
    const { document, data } = apply(
      baseDocument(),
      ctx,
      duplicateVariable({
        sourceVariableId: IDS.fat,
        sourceVersionId: IDS.fatV1,
        code: 'FAT2',
        name: 'Faturamento 2',
      }),
    );
    const created = document.variables.find((v) => v.id === data.variableId)!;
    expect(created.versions[0]!.regionalDimension).toBeUndefined();
    expect(created.versions[0]!.domains).toEqual(
      document.variables.find((v) => v.id === IDS.fat)!.versions[0]!.domains,
    );
  });

  it('o inverso desfaz a duplicação', () => {
    const ctx = testCtx();
    const { document, result } = apply(
      baseDocument(),
      ctx,
      duplicateVariable({ sourceVariableId: IDS.fat, sourceVersionId: IDS.fatV1, code: 'FAT2', name: 'F2' }),
    );
    const undone = apply(document, ctx, result.inverse);
    expect(undone.document.variables.some((v) => v.code === 'FAT2')).toBe(false);
  });
});

describe('regras gerais dos comandos (docs/08 §1)', () => {
  it('erro não altera o documento nem mesmo parcialmente', () => {
    const doc = baseDocument();
    const before = structuredClone(doc);
    const ctx = testCtx();
    const result = saveVariableDomains({
      variableId: IDS.score,
      versionId: IDS.scoreV1,
      domains: [domain('X', 0), domain('Y', 1)],
    }).run(doc, ctx);
    expect(result.ok).toBe(false);
    expect(doc).toEqual(before);
  });

  it('mesmo Ctx determinístico produz o mesmo documento', () => {
    const run = () =>
      apply(
        baseDocument(),
        testCtx(),
        createVariable({ code: 'DET', name: 'Determinística', type: 'CATEGORICAL' }),
      ).document;
    expect(run()).toEqual(run());
  });

  it('não referencia T0 sem uso (evita import não utilizado em builds estritos)', () => {
    expect(typeof T0).toBe('string');
  });

  it('documento devolvido é imutável (Immer congela)', () => {
    const ctx = testCtx();
    const { document } = apply(
      baseDocument(),
      ctx,
      createVariable({ code: 'IMUT', name: 'Imutável', type: 'CATEGORICAL' }),
    );
    expect(() => {
      (document as unknown as { variables: unknown[] }).variables.push({});
    }).toThrow();
  });

  it('mantém o resto do documento intacto (round-trip sem eventos)', () => {
    const ctx = testCtx();
    const before: PolicyOpsDocument = baseDocument();
    const { document } = apply(before, ctx, updateVariableMeta({ variableId: IDS.score, name: 'X' }));
    expect(document.projects).toEqual(before.projects);
    expect(document.catalog).toEqual(before.catalog);
  });
});
