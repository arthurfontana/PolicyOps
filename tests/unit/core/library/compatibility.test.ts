import { describe, expect, it } from 'vitest';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { collectPublishedCompatibility, generateTuples, type ApplicableCompatibility } from '@/core/axes/tuples';
import {
  archiveCompatibility,
  createCompatibility,
  createCompatibilityDraft,
  discardCompatibilityDraft,
  publishCompatibility,
  saveCompatibilityMap,
} from '@/core/library/compatibility';
import { getApplicableRule, getCompatibilityUsage, listCompatibilityRules } from '@/core/queries';
import { createMatrix, publishVersion } from '@/core/versioning/lifecycle';
import { applyCellPatch } from '@/core/versioning/cells';
import {
  apply,
  baseDocument,
  coordsOf,
  expectFailure,
  FAT_DOMAINS,
  IDS,
  SEGMENTO_DOMAINS,
  SEG_X_FAT_TUPLES,
  testCtx,
} from '../versioning/fixtures';

/** Constrói o `ApplicableCompatibility` que `generateTuples` espera, a partir de uma versão salva (publicada ou não). */
function applicableFrom(doc: PolicyOpsDocument, ruleId: string, versionId: string): ApplicableCompatibility {
  const rule = doc.compatibility.find((candidate) => candidate.id === ruleId)!;
  const version = rule.versions.find((candidate) => candidate.id === versionId)!;
  return {
    ruleId: rule.id,
    ruleCode: rule.code,
    parentVariableId: rule.parentVariableId,
    childVariableId: rule.childVariableId,
    version,
  };
}

describe('compat/create', () => {
  it('cria a regra com v1 DRAFT, mapa vazio e os pinos das versões publicadas atuais', () => {
    const ctx = testCtx();
    const { document, data } = apply(
      baseDocument(),
      ctx,
      createCompatibility({
        code: 'FAT_X_SEG',
        name: 'Faturamento × Segmento',
        parentVariableId: IDS.fat,
        childVariableId: IDS.segmento,
      }),
    );
    const created = document.compatibility.find((r) => r.id === data.ruleId)!;
    expect(created.code).toBe('FAT_X_SEG');
    expect(created.versions).toHaveLength(1);
    const v1 = created.versions[0]!;
    expect(v1.state).toBe('DRAFT');
    expect(v1.allow).toEqual({});
    expect(v1.defaultForUnlisted).toBe('ALL');
    expect(v1.parentVariableVersionId).toBe(IDS.fatV1);
    expect(v1.childVariableVersionId).toBe(IDS.segmentoV1);
    expect(data.versionId).toBe(v1.id);
  });

  it('recusa código duplicado', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      createCompatibility({
        code: 'SEG_X_FATURAMENTO',
        name: 'Outra',
        parentVariableId: IDS.fat,
        childVariableId: IDS.segmento,
      }),
      'DUPLICATE_CODE',
    );
  });

  it('recusa pai e filho iguais', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      createCompatibility({
        code: 'X_X_X',
        name: 'Inválida',
        parentVariableId: IDS.segmento,
        childVariableId: IDS.segmento,
      }),
      'INVALID_INPUT',
    );
  });

  it('recusa variável pai ou filho sem versão publicada', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      createCompatibility({
        code: 'SEMPUB_X_FAT',
        name: 'Sem publicada × Faturamento',
        parentVariableId: IDS.semPublicada,
        childVariableId: IDS.fat,
      }),
      'VARIABLE_HAS_NO_PUBLISHED_VERSION',
    );
  });

  it('I12: recusa segunda regra para o mesmo par (parent, child) ordenado', () => {
    const error = expectFailure(
      baseDocument(),
      testCtx(),
      createCompatibility({
        code: 'SEG_X_FAT_2',
        name: 'Segmento × Faturamento (duplicada)',
        parentVariableId: IDS.segmento,
        childVariableId: IDS.fat,
      }),
      'COMPATIBILITY_PAIR_DUPLICATE',
    );
    expect(error.details).toMatchObject({ existingRuleId: IDS.compatRule });
  });

  it('I12: o par invertido (child, parent) não conflita e passa', () => {
    const ctx = testCtx();
    const { document, data } = apply(
      baseDocument(),
      ctx,
      createCompatibility({
        code: 'FAT_X_SEG',
        name: 'Faturamento × Segmento',
        parentVariableId: IDS.fat,
        childVariableId: IDS.segmento,
      }),
    );
    expect(document.compatibility.find((r) => r.id === data.ruleId)).toBeDefined();
  });

  it('o inverso desfaz a criação', () => {
    const ctx = testCtx();
    const { document, result } = apply(
      baseDocument(),
      ctx,
      createCompatibility({
        code: 'FAT_X_SEG',
        name: 'Faturamento × Segmento',
        parentVariableId: IDS.fat,
        childVariableId: IDS.segmento,
      }),
    );
    const undone = apply(document, ctx, result.inverse);
    expect(undone.document.compatibility.some((r) => r.code === 'FAT_X_SEG')).toBe(false);
  });

  it('refazer restaura a regra removida', () => {
    const ctx = testCtx();
    const { document, result } = apply(
      baseDocument(),
      ctx,
      createCompatibility({
        code: 'FAT_X_SEG',
        name: 'Faturamento × Segmento',
        parentVariableId: IDS.fat,
        childVariableId: IDS.segmento,
      }),
    );
    const undone = apply(document, ctx, result.inverse);
    const redone = apply(undone.document, ctx, undone.result.inverse);
    expect(redone.document.compatibility.find((r) => r.code === 'FAT_X_SEG')).toEqual(
      document.compatibility.find((r) => r.code === 'FAT_X_SEG'),
    );
  });
});

describe('compat/createDraft', () => {
  it('clona a versão PUBLISHED em DRAFT', () => {
    const ctx = testCtx();
    const { document, data } = apply(baseDocument(), ctx, createCompatibilityDraft({ ruleId: IDS.compatRule }));
    const rule = document.compatibility.find((r) => r.id === IDS.compatRule)!;
    expect(rule.versions).toHaveLength(2);
    expect(data.number).toBe(2);
    expect(data.basedOnNumber).toBe(1);
    const draft = rule.versions.find((v) => v.id === data.versionId)!;
    expect(draft.state).toBe('DRAFT');
    expect(draft.allow).toEqual(rule.versions[0]!.allow);
    expect(draft.allow).not.toBe(rule.versions[0]!.allow);
  });

  it('falha com DRAFT_ALREADY_EXISTS se já houver rascunho', () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createCompatibilityDraft({ ruleId: IDS.compatRule })).document;
    expectFailure(withDraft, ctx, createCompatibilityDraft({ ruleId: IDS.compatRule }), 'DRAFT_ALREADY_EXISTS');
  });

  it('falha com NO_VERSION_TO_DERIVE quando não há nenhuma versão publicada nem em rascunho', () => {
    const ctx = testCtx();
    const created = apply(
      baseDocument(),
      ctx,
      createCompatibility({
        code: 'FAT_X_SEG',
        name: 'Faturamento × Segmento',
        parentVariableId: IDS.fat,
        childVariableId: IDS.segmento,
      }),
    );
    // A v1 recém-criada é DRAFT; descartá-la deixa a regra sem nenhuma versão.
    const discarded = apply(
      created.document,
      ctx,
      discardCompatibilityDraft({ ruleId: created.data.ruleId, versionId: created.data.versionId }),
    ).document;
    expectFailure(
      discarded,
      ctx,
      createCompatibilityDraft({ ruleId: created.data.ruleId }),
      'NO_VERSION_TO_DERIVE',
    );
  });
});

describe('compat/saveMap', () => {
  it('substitui o mapa inteiro e repina as versões de variável atualmente publicadas', () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createCompatibilityDraft({ ruleId: IDS.compatRule })).document;
    const draftVersionId = withDraft.compatibility.find((r) => r.id === IDS.compatRule)!.versions[1]!.id;
    const newAllow = { VAREJO: ['ATE_100K'], ATACADO: ['500K_1M'] };
    const { document } = apply(
      withDraft,
      ctx,
      saveCompatibilityMap({
        ruleId: IDS.compatRule,
        versionId: draftVersionId,
        allow: newAllow,
        defaultForUnlisted: 'NONE',
      }),
    );
    const draft = document.compatibility.find((r) => r.id === IDS.compatRule)!.versions[1]!;
    expect(draft.allow).toEqual(newAllow);
    expect(draft.defaultForUnlisted).toBe('NONE');
    expect(draft.parentVariableVersionId).toBe(IDS.segmentoV1);
    expect(draft.childVariableVersionId).toBe(IDS.fatV1);
  });

  it('o inverso restaura o mapa e os pinos anteriores, e o refazer reaplica', () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createCompatibilityDraft({ ruleId: IDS.compatRule })).document;
    const draftVersionId = withDraft.compatibility.find((r) => r.id === IDS.compatRule)!.versions[1]!.id;
    const before = structuredClone(
      withDraft.compatibility.find((r) => r.id === IDS.compatRule)!.versions[1]!,
    );
    const { document, result } = apply(
      withDraft,
      ctx,
      saveCompatibilityMap({
        ruleId: IDS.compatRule,
        versionId: draftVersionId,
        allow: { VAREJO: ['ATE_100K'] },
        defaultForUnlisted: 'NONE',
      }),
    );
    const undone = apply(document, ctx, result.inverse);
    const restored = undone.document.compatibility.find((r) => r.id === IDS.compatRule)!.versions[1]!;
    expect(restored.allow).toEqual(before.allow);
    expect(restored.defaultForUnlisted).toBe(before.defaultForUnlisted);

    const redone = apply(undone.document, ctx, undone.result.inverse);
    const reapplied = redone.document.compatibility.find((r) => r.id === IDS.compatRule)!.versions[1]!;
    expect(reapplied.allow).toEqual({ VAREJO: ['ATE_100K'] });
    expect(reapplied.defaultForUnlisted).toBe('NONE');
  });

  it('recusa alterar uma versão publicada — COMPATIBILITY_VERSION_IMMUTABLE', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      saveCompatibilityMap({
        ruleId: IDS.compatRule,
        versionId: IDS.compatV1,
        allow: {},
        defaultForUnlisted: 'ALL',
      }),
      'COMPATIBILITY_VERSION_IMMUTABLE',
    );
  });

  it('código desconhecido no mapa não impede o salvamento, e gera aviso em generateTuples', () => {
    const ctx = testCtx();
    const withRule = apply(
      baseDocument(),
      ctx,
      createCompatibility({
        code: 'FAT_X_SEG',
        name: 'Faturamento × Segmento',
        parentVariableId: IDS.fat,
        childVariableId: IDS.segmento,
      }),
    );
    const { document } = apply(
      withRule.document,
      ctx,
      saveCompatibilityMap({
        ruleId: withRule.data.ruleId,
        versionId: withRule.data.versionId,
        allow: { CODIGO_INEXISTENTE: ['VAREJO'] },
        defaultForUnlisted: 'ALL',
      }),
    );
    const saved = document.compatibility.find((r) => r.id === withRule.data.ruleId)!.versions[0]!;
    expect(saved.allow).toEqual({ CODIGO_INEXISTENTE: ['VAREJO'] });

    const applicable = applicableFrom(document, withRule.data.ruleId, withRule.data.versionId);
    const { warnings } = generateTuples({
      levels: [
        { variableId: IDS.fat, domains: FAT_DOMAINS },
        { variableId: IDS.segmento, domains: SEGMENTO_DOMAINS },
      ],
      compatibility: [applicable],
    });
    const unknown = warnings.find((w) => w.code === 'RULE_REFERENCES_UNKNOWN_DOMAIN');
    expect(unknown).toBeDefined();
    expect(unknown!.codes).toContain('CODIGO_INEXISTENTE');
  });

  it("defaultForUnlisted 'NONE' com pai ausente do mapa elimina o pai das tuplas", () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createCompatibilityDraft({ ruleId: IDS.compatRule })).document;
    const draftVersionId = withDraft.compatibility.find((r) => r.id === IDS.compatRule)!.versions[1]!.id;
    // Mapa sem nenhuma entrada para ATACADO.
    const { document } = apply(
      withDraft,
      ctx,
      saveCompatibilityMap({
        ruleId: IDS.compatRule,
        versionId: draftVersionId,
        allow: { VAREJO: ['ATE_100K'], CORPORATE: ['ACIMA_10M'] },
        defaultForUnlisted: 'NONE',
      }),
    );
    const applicable = applicableFrom(document, IDS.compatRule, draftVersionId);
    const { tuples, warnings } = generateTuples({
      levels: [
        { variableId: IDS.segmento, domains: SEGMENTO_DOMAINS },
        { variableId: IDS.fat, domains: FAT_DOMAINS },
      ],
      compatibility: [applicable],
    });
    expect(tuples.some((t) => t.startsWith('ATACADO|'))).toBe(false);
    expect(tuples).toEqual(['VAREJO|ATE_100K', 'CORPORATE|ACIMA_10M']);
    expect(warnings.some((w) => w.code === 'PARENT_HAS_NO_CHILDREN' && w.path === 'ATACADO')).toBe(true);
  });

  it("defaultForUnlisted 'ALL' com pai ausente do mapa libera todos os filhos", () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createCompatibilityDraft({ ruleId: IDS.compatRule })).document;
    const draftVersionId = withDraft.compatibility.find((r) => r.id === IDS.compatRule)!.versions[1]!.id;
    const { document } = apply(
      withDraft,
      ctx,
      saveCompatibilityMap({
        ruleId: IDS.compatRule,
        versionId: draftVersionId,
        allow: { VAREJO: ['ATE_100K'] },
        defaultForUnlisted: 'ALL',
      }),
    );
    const applicable = applicableFrom(document, IDS.compatRule, draftVersionId);
    const { tuples } = generateTuples({
      levels: [
        { variableId: IDS.segmento, domains: SEGMENTO_DOMAINS },
        { variableId: IDS.fat, domains: FAT_DOMAINS },
      ],
      compatibility: [applicable],
    });
    const atacadoTuples = tuples.filter((t) => t.startsWith('ATACADO|'));
    expect(atacadoTuples).toHaveLength(FAT_DOMAINS.length);
    const corporateTuples = tuples.filter((t) => t.startsWith('CORPORATE|'));
    expect(corporateTuples).toHaveLength(FAT_DOMAINS.length);
  });
});

describe('compat/publish', () => {
  it('promove a versão e supera a anterior', () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createCompatibilityDraft({ ruleId: IDS.compatRule })).document;
    const draftVersionId = withDraft.compatibility.find((r) => r.id === IDS.compatRule)!.versions[1]!.id;
    const withMap = apply(
      withDraft,
      ctx,
      saveCompatibilityMap({
        ruleId: IDS.compatRule,
        versionId: draftVersionId,
        allow: { VAREJO: ['ATE_100K'] },
        defaultForUnlisted: 'NONE',
      }),
    ).document;

    const { document, result } = apply(
      withMap,
      ctx,
      publishCompatibility({ ruleId: IDS.compatRule, versionId: draftVersionId, notes: 'Restringi Varejo.' }),
    );

    const rule = document.compatibility.find((r) => r.id === IDS.compatRule)!;
    expect(rule.versions.find((v) => v.id === IDS.compatV1)!.state).toBe('SUPERSEDED');
    expect(rule.versions.find((v) => v.id === draftVersionId)!.state).toBe('PUBLISHED');

    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe('COMPATIBILITY_PUBLISHED');
    expect(result.events[0]!.payload).toMatchObject({ code: 'SEG_X_FATURAMENTO', versionNumber: 2 });
  });

  it('recusa publicar fora de DRAFT', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      publishCompatibility({ ruleId: IDS.compatRule, versionId: IDS.compatV1 }),
      'COMPATIBILITY_VERSION_IMMUTABLE',
    );
  });

  it('I12: recusa publicar quando outra regra (mesmo arquivada) já tem versão publicada para o par', () => {
    const ctx = testCtx();
    // Cria a regra invertida, publica-a, arquiva-a — a versão publicada sobrevive ao arquivamento.
    const created = apply(
      baseDocument(),
      ctx,
      createCompatibility({
        code: 'FAT_X_SEG',
        name: 'Faturamento × Segmento',
        parentVariableId: IDS.fat,
        childVariableId: IDS.segmento,
      }),
    );
    const publishedFirst = apply(
      created.document,
      ctx,
      publishCompatibility({ ruleId: created.data.ruleId, versionId: created.data.versionId, notes: 'Primeira.' }),
    ).document;
    const archived = apply(publishedFirst, ctx, archiveCompatibility({ ruleId: created.data.ruleId })).document;

    // Uma segunda regra para o mesmo par (fat → segmento) só é possível porque a primeira está arquivada.
    const second = apply(
      archived,
      ctx,
      createCompatibility({
        code: 'FAT_X_SEG_2',
        name: 'Faturamento × Segmento (nova)',
        parentVariableId: IDS.fat,
        childVariableId: IDS.segmento,
      }),
    );
    expectFailure(
      second.document,
      ctx,
      publishCompatibility({ ruleId: second.data.ruleId, versionId: second.data.versionId }),
      'COMPATIBILITY_PAIR_DUPLICATE',
    );
  });

  it('o inverso é irreversível', () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createCompatibilityDraft({ ruleId: IDS.compatRule })).document;
    const draftVersionId = withDraft.compatibility.find((r) => r.id === IDS.compatRule)!.versions[1]!.id;
    const { result } = apply(
      withDraft,
      ctx,
      publishCompatibility({ ruleId: IDS.compatRule, versionId: draftVersionId, notes: 'ok' }),
    );
    expect(result.inverse.run(baseDocument(), ctx).ok).toBe(false);
  });

  it('publicar v2 não altera as tuplas de nenhuma versão de matriz existente', () => {
    const ctx = testCtx();
    // Matriz X = SCORE, Y = SEGMENTO › FAT (usa a regra publicada v1: 8 tuplas).
    const withMatrix = apply(
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
    expect(withMatrix.document.matrices[0]!.versions[0]!.axes.y.tuples).toEqual(SEG_X_FAT_TUPLES);

    const filled = apply(
      withMatrix.document,
      ctx,
      applyCellPatch({
        versionId: withMatrix.data.versionId,
        patch: { coords: coordsOf(withMatrix.document, withMatrix.data.versionId), set: { decision: 'APROVADO' } },
      }),
    ).document;
    const publishedMatrix = apply(
      filled,
      ctx,
      publishVersion({ versionId: withMatrix.data.versionId, notes: 'Publicação inicial.' }),
    ).document;

    const beforeMatrix = structuredClone(
      publishedMatrix.matrices.find((m) => m.id === withMatrix.data.matrixId)!,
    );

    const withDraft = apply(
      publishedMatrix,
      ctx,
      createCompatibilityDraft({ ruleId: IDS.compatRule }),
    ).document;
    const draftVersionId = withDraft.compatibility.find((r) => r.id === IDS.compatRule)!.versions[1]!.id;
    const withMap = apply(
      withDraft,
      ctx,
      saveCompatibilityMap({
        ruleId: IDS.compatRule,
        versionId: draftVersionId,
        allow: { VAREJO: ['ATE_100K'] },
        defaultForUnlisted: 'NONE',
      }),
    ).document;
    const afterPublish = apply(
      withMap,
      ctx,
      publishCompatibility({ ruleId: IDS.compatRule, versionId: draftVersionId, notes: 'Restringi bastante.' }),
    ).document;

    const afterMatrix = afterPublish.matrices.find((m) => m.id === withMatrix.data.matrixId)!;
    expect(afterMatrix).toEqual(beforeMatrix);
    expect(afterMatrix.versions[0]!.axes.y.tuples).toEqual(SEG_X_FAT_TUPLES);
  });
});

describe('compat/discardDraft', () => {
  it('remove a versão em rascunho', () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createCompatibilityDraft({ ruleId: IDS.compatRule })).document;
    const draftVersionId = withDraft.compatibility.find((r) => r.id === IDS.compatRule)!.versions[1]!.id;
    const { document, data } = apply(
      withDraft,
      ctx,
      discardCompatibilityDraft({ ruleId: IDS.compatRule, versionId: draftVersionId }),
    );
    expect(data.number).toBe(2);
    expect(document.compatibility.find((r) => r.id === IDS.compatRule)!.versions).toHaveLength(1);
  });

  it('recusa descartar uma versão publicada', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      discardCompatibilityDraft({ ruleId: IDS.compatRule, versionId: IDS.compatV1 }),
      'COMPATIBILITY_VERSION_IMMUTABLE',
    );
  });

  it('o inverso restaura a versão descartada', () => {
    const ctx = testCtx();
    const withDraft = apply(baseDocument(), ctx, createCompatibilityDraft({ ruleId: IDS.compatRule })).document;
    const draftVersionId = withDraft.compatibility.find((r) => r.id === IDS.compatRule)!.versions[1]!.id;
    const { document, result } = apply(
      withDraft,
      ctx,
      discardCompatibilityDraft({ ruleId: IDS.compatRule, versionId: draftVersionId }),
    );
    const undone = apply(document, ctx, result.inverse);
    expect(undone.document.compatibility.find((r) => r.id === IDS.compatRule)!.versions).toHaveLength(2);
  });
});

describe('compat/archive', () => {
  it('marca archivedAt, e o inverso desarquiva', () => {
    const ctx = testCtx();
    const { document, result } = apply(baseDocument(), ctx, archiveCompatibility({ ruleId: IDS.compatRule }));
    expect(document.compatibility.find((r) => r.id === IDS.compatRule)!.archivedAt).toBeDefined();
    const undone = apply(document, ctx, result.inverse);
    expect(undone.document.compatibility.find((r) => r.id === IDS.compatRule)!.archivedAt).toBeUndefined();

    const redone = apply(undone.document, ctx, undone.result.inverse);
    expect(redone.document.compatibility.find((r) => r.id === IDS.compatRule)!.archivedAt).toBe(
      document.compatibility.find((r) => r.id === IDS.compatRule)!.archivedAt,
    );
  });
});

describe('consultas', () => {
  it('getApplicableRule devolve a regra publicada do par, ou null', () => {
    const doc = baseDocument();
    const found = getApplicableRule(doc, IDS.segmento, IDS.fat);
    expect(found?.rule.id).toBe(IDS.compatRule);
    expect(found?.version.id).toBe(IDS.compatV1);
    expect(getApplicableRule(doc, IDS.fat, IDS.segmento)).toBeNull();
  });

  it('listCompatibilityRules calcula combinações válidas sobre o total e uso', () => {
    const doc = baseDocument();
    const [summary] = listCompatibilityRules(doc, { search: 'SEG_X_FATURAMENTO' });
    expect(summary!.rule.id).toBe(IDS.compatRule);
    expect(summary!.totalCombinations).toBe(SEGMENTO_DOMAINS.length * FAT_DOMAINS.length);
    expect(summary!.validCombinations).toBe(8);
    expect(summary!.usageCount).toBe(0);
  });

  it('getCompatibilityUsage conta os eixos que derivaram tuplas da regra', () => {
    const ctx = testCtx();
    const withMatrix = apply(
      baseDocument(),
      ctx,
      createMatrix({
        projectId: IDS.projectA,
        code: 'MTZ_PJ',
        name: 'Matriz PJ',
        x: { levels: [{ variableId: IDS.score }] },
        y: { levels: [{ variableId: IDS.segmento }, { variableId: IDS.fat }] },
      }),
    ).document;
    const usage = getCompatibilityUsage(withMatrix, IDS.compatRule);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ matrixCode: 'MTZ_PJ', role: 'Y', compatibilityVersionId: IDS.compatV1 });

    const summary = listCompatibilityRules(withMatrix).find((s) => s.rule.id === IDS.compatRule)!;
    expect(summary.usageCount).toBe(1);
  });
});

describe('não referencia collectPublishedCompatibility sem uso (evita import não utilizado)', () => {
  it('sanity', () => {
    expect(collectPublishedCompatibility(baseDocument().compatibility)).toHaveLength(1);
  });
});
