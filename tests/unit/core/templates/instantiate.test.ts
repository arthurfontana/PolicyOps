import { describe, expect, it } from 'vitest';
import { validateDocument } from '@/core/document/validate';
import type { PolicyOpsDocument, Template } from '@/core/document/schema';
import { previewTemplate } from '@/core/templates/preview';
import { instantiateTemplate } from '@/core/templates/instantiate';
import { locateVersion } from '@/core/versioning/lifecycle';
import { publishVariable, createVariableDraft, saveVariableDomains } from '@/core/library/variables';
import {
  apply,
  baseDocument,
  expectFailure,
  fixedId,
  IDS,
  SEG_X_FAT_TUPLES,
  T0,
  testCtx,
} from '../versioning/fixtures';

function withTemplate(doc: PolicyOpsDocument, template: Template): PolicyOpsDocument {
  return { ...doc, templates: [...doc.templates, template] };
}

const NESTED_TEMPLATE: Template = {
  id: fixedId('tplpjseg'),
  code: 'TPL_PJ_SEG',
  name: 'Limite PJ segmentado',
  axes: {
    x: { levels: [{ variableId: IDS.score }] },
    y: { levels: [{ variableId: IDS.segmento }, { variableId: IDS.fat }] },
  },
  defaults: { decision: 'ANALISE_MANUAL' },
  seedRules: [
    { when: { y: ['CORPORATE'] }, set: { decision: 'APROVADO', offer: 'OFERTA_A' } },
    { when: { x: ['R1'], y: ['CORPORATE'] }, set: { offer: 'OFERTA_B' } },
  ],
  createdAt: T0,
};

describe('instantiateTemplate (docs/05 §8) — reutiliza matrix/create', () => {
  it('cria a matriz com as tuplas do template e aplica defaults + seedRules', () => {
    const ctx = testCtx();
    const doc = withTemplate(baseDocument(), NESTED_TEMPLATE);
    const result = apply(
      doc,
      ctx,
      instantiateTemplate({
        templateId: NESTED_TEMPLATE.id,
        projectId: IDS.projectA,
        code: 'MTZ_PJ_SEG',
        name: 'Limite PJ Segmentado',
      }),
    );

    const { version } = locateVersion(result.document, result.data.versionId);
    expect(version.axes.y.tuples).toEqual(SEG_X_FAT_TUPLES);
    expect(result.data.combinations).toBe(3 * SEG_X_FAT_TUPLES.length);
    expect(result.data.skippedRules).toEqual([]);

    // Default em toda combinação.
    expect(version.cells['R2::VAREJO|ATE_100K']!.decision).toBe('ANALISE_MANUAL');
    // Regra "CORPORATE" vence o default.
    expect(version.cells['R2::CORPORATE|1M_10M']!.decision).toBe('APROVADO');
    expect(version.cells['R2::CORPORATE|1M_10M']!.offer).toBe('OFERTA_A');
    // Regra mais específica (R1×CORPORATE) vence a de CORPORATE sozinho, mas só no campo offer.
    expect(version.cells['R1::CORPORATE|1M_10M']!.decision).toBe('APROVADO');
    expect(version.cells['R1::CORPORATE|1M_10M']!.offer).toBe('OFERTA_B');

    expect(validateDocument(result.document).ok).toBe(true);
  });

  it('o resultado bate exatamente com previewTemplate calculado antes de instanciar', () => {
    const ctx = testCtx();
    const doc = withTemplate(baseDocument(), NESTED_TEMPLATE);
    const preview = previewTemplate(doc, NESTED_TEMPLATE.id);

    const result = apply(
      doc,
      ctx,
      instantiateTemplate({
        templateId: NESTED_TEMPLATE.id,
        projectId: IDS.projectA,
        code: 'MTZ_PJ_SEG',
        name: 'Limite PJ Segmentado',
      }),
    );
    const { version } = locateVersion(result.document, result.data.versionId);

    expect(version.axes.x.tuples).toEqual(preview.x.tuples);
    expect(version.axes.y.tuples).toEqual(preview.y.tuples);
    expect(version.cells).toEqual(preview.cells);
    expect(result.data.combinations).toBe(preview.combinations);
  });

  it('código inexistente numa seedRule vira skippedRules sem quebrar a instanciação', () => {
    const ctx = testCtx();
    const template: Template = {
      ...NESTED_TEMPLATE,
      id: fixedId('tplbroken'),
      code: 'TPL_QUEBRADO',
      defaults: undefined,
      seedRules: [{ when: {}, set: { decision: 'NAO_EXISTE_NO_CATALOGO' } }],
    };
    const doc = withTemplate(baseDocument(), template);
    const result = apply(
      doc,
      ctx,
      instantiateTemplate({
        templateId: template.id,
        projectId: IDS.projectA,
        code: 'MTZ_QUEBRADA',
        name: 'Matriz Quebrada',
      }),
    );
    expect(result.data.skippedRules).toHaveLength(1);
    const { version } = locateVersion(result.document, result.data.versionId);
    expect(Object.keys(version.cells)).toHaveLength(0);
  });

  it('propaga DUPLICATE_CODE de matrix/create quando o código já existe no projeto', () => {
    const ctx = testCtx();
    const doc = withTemplate(baseDocument(), NESTED_TEMPLATE);
    const first = apply(
      doc,
      ctx,
      instantiateTemplate({
        templateId: NESTED_TEMPLATE.id,
        projectId: IDS.projectA,
        code: 'MTZ_DUP',
        name: 'Primeira',
      }),
    );
    expectFailure(
      first.document,
      ctx,
      instantiateTemplate({
        templateId: NESTED_TEMPLATE.id,
        projectId: IDS.projectA,
        code: 'MTZ_DUP',
        name: 'Segunda',
      }),
      'DUPLICATE_CODE',
    );
  });

  it('falha com NOT_FOUND para template inexistente', () => {
    const ctx = testCtx();
    expectFailure(
      baseDocument(),
      ctx,
      instantiateTemplate({
        templateId: 'nao-existe',
        projectId: IDS.projectA,
        code: 'MTZ_X',
        name: 'X',
      }),
      'NOT_FOUND',
    );
  });

  it('usa a versão publicada ATUAL da variável, não a de quando o template foi criado', () => {
    const ctx = testCtx();
    const template: Template = {
      id: fixedId('tplevolve'),
      code: 'TPL_EVOLUI',
      name: 'Template que evolui',
      axes: {
        x: { levels: [{ variableId: IDS.score }] },
        y: { levels: [{ variableId: IDS.restritivo }] },
      },
      seedRules: [],
      createdAt: T0,
    };
    let doc = withTemplate(baseDocument(), template);

    // Publica uma v2 de SCORE com domínios diferentes — a biblioteca evoluiu
    // depois que o template foi "criado".
    const draft = apply(doc, ctx, createVariableDraft({ variableId: IDS.score }));
    doc = draft.document;
    doc = apply(
      doc,
      ctx,
      saveVariableDomains({
        variableId: IDS.score,
        versionId: draft.data.versionId,
        domains: [
          { code: 'BAIXO', label: 'Baixo', position: 0 },
          { code: 'MEDIO', label: 'Médio', position: 1 },
          { code: 'ALTO', label: 'Alto', position: 2 },
        ],
      }),
    ).document;
    doc = apply(doc, ctx, publishVariable({ variableId: IDS.score, versionId: draft.data.versionId }))
      .document;

    const result = apply(
      doc,
      ctx,
      instantiateTemplate({
        templateId: template.id,
        projectId: IDS.projectA,
        code: 'MTZ_EVOLUIU',
        name: 'Matriz que evoluiu',
      }),
    );
    const { version } = locateVersion(result.document, result.data.versionId);
    expect(version.axes.x.tuples).toEqual(['BAIXO', 'MEDIO', 'ALTO']);
    expect(version.axes.x.levels[0]!.variableVersionId).toBe(draft.data.versionId);
  });
});
