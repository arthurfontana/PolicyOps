import { describe, expect, it } from 'vitest';
import { previewTemplate, resolveTemplateAxes } from '@/core/templates/preview';
import type { PolicyOpsDocument, Template } from '@/core/document/schema';
import { DomainError } from '@/core/errors';
import { baseDocument, fixedId, IDS, SEG_X_FAT_TUPLES, T0 } from '../versioning/fixtures';

function withTemplate(doc: PolicyOpsDocument, template: Template): PolicyOpsDocument {
  return { ...doc, templates: [...doc.templates, template] };
}

const SIMPLE_TEMPLATE: Template = {
  id: fixedId('tplsimple'),
  code: 'TPL_SIMPLES',
  name: 'Template simples',
  axes: {
    x: { levels: [{ variableId: IDS.score }] },
    y: { levels: [{ variableId: IDS.restritivo }] },
  },
  defaults: { decision: 'APROVADO' },
  seedRules: [{ when: { x: ['R3'] }, set: { decision: 'REPROVADO' } }],
  createdAt: T0,
};

const NESTED_TEMPLATE: Template = {
  id: fixedId('tplnested'),
  code: 'TPL_ANINHADO',
  name: 'Template aninhado',
  axes: {
    x: { levels: [{ variableId: IDS.score }] },
    y: { levels: [{ variableId: IDS.segmento }, { variableId: IDS.fat }] },
  },
  seedRules: [{ when: { y: ['VAREJO'] }, set: { decision: 'ANALISE_MANUAL' } }],
  createdAt: T0,
};

describe('previewTemplate (docs/prompts/S17 Parte A)', () => {
  it('não grava nada — o documento devolvido é a mesma referência recebida', () => {
    const doc = withTemplate(baseDocument(), SIMPLE_TEMPLATE);
    const before = doc;
    previewTemplate(doc, SIMPLE_TEMPLATE.id);
    expect(doc).toBe(before);
    expect(doc.templates).toHaveLength(1);
  });

  it('resolve eixo de 1 nível e aplica defaults + seedRules com a última vencendo', () => {
    const doc = withTemplate(baseDocument(), SIMPLE_TEMPLATE);
    const preview = previewTemplate(doc, SIMPLE_TEMPLATE.id);
    expect(preview.combinations).toBe(3 * 2); // SCORE (R1..R3) × RESTRITIVO (SEM, ALTO)
    expect(preview.x.tuples).toEqual(['R1', 'R2', 'R3']);
    expect(preview.cells['R3::SEM']!.decision).toBe('REPROVADO');
    expect(preview.cells['R1::SEM']!.decision).toBe('APROVADO');
    expect(preview.filledCount).toBe(preview.combinations);
    expect(preview.pendingCount).toBe(0);
    expect(preview.skippedRules).toEqual([]);
  });

  it('resolve eixo aninhado com compatibilidade — mesmas 8 tuplas de SEGMENTO›FAT', () => {
    const doc = withTemplate(baseDocument(), NESTED_TEMPLATE);
    const preview = previewTemplate(doc, NESTED_TEMPLATE.id);
    expect(preview.y.tuples).toEqual(SEG_X_FAT_TUPLES);
    expect(preview.combinations).toBe(3 * SEG_X_FAT_TUPLES.length);
    // Só as células de Varejo foram semeadas.
    expect(preview.cells['R1::VAREJO|ATE_100K']!.decision).toBe('ANALISE_MANUAL');
    expect(preview.cells['R1::ATACADO|500K_1M']).toBeUndefined();
  });

  it('falha com NOT_FOUND para template inexistente', () => {
    const doc = baseDocument();
    expect(() => previewTemplate(doc, 'nao-existe')).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('falha com VARIABLE_HAS_NO_PUBLISHED_VERSION quando o eixo referencia variável sem publicada', () => {
    const template: Template = {
      ...SIMPLE_TEMPLATE,
      id: fixedId('tplbadvar'),
      code: 'TPL_SEM_PUB',
      axes: { x: { levels: [{ variableId: IDS.semPublicada }] }, y: { levels: [{ variableId: IDS.restritivo }] } },
      seedRules: [],
    };
    const doc = withTemplate(baseDocument(), template);
    let error: unknown;
    try {
      previewTemplate(doc, template.id);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('VARIABLE_HAS_NO_PUBLISHED_VERSION');
  });

  it('resolveTemplateAxes usa a versão publicada atual, mesmo depois de a biblioteca evoluir', () => {
    const doc = baseDocument();
    const scoreVariable = doc.variables.find((v) => v.id === IDS.score)!;
    const evolved: PolicyOpsDocument = {
      ...doc,
      variables: doc.variables.map((variable) =>
        variable.id !== IDS.score
          ? variable
          : {
              ...variable,
              versions: [
                { ...variable.versions[0]!, state: 'SUPERSEDED' },
                {
                  id: fixedId('scorev2'),
                  number: 2,
                  state: 'PUBLISHED',
                  createdAt: T0,
                  createdBy: 'Equipe',
                  publishedAt: T0,
                  publishedBy: 'Equipe',
                  domains: [
                    { code: 'BAIXO', label: 'Baixo', position: 0 },
                    { code: 'ALTO', label: 'Alto', position: 1 },
                  ],
                },
              ],
            },
      ),
    };
    const { x } = resolveTemplateAxes(evolved, {
      ...SIMPLE_TEMPLATE,
      axes: { x: { levels: [{ variableId: IDS.score }] }, y: { levels: [{ variableId: IDS.restritivo }] } },
    });
    expect(x.tuples).toEqual(['BAIXO', 'ALTO']);
    expect(x.levels[0]!.variableVersionId).not.toBe(scoreVariable.versions[0]!.id);
  });
});
