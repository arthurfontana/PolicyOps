import { describe, expect, it } from 'vitest';
import { validateDocument } from '@/core/document/validate';
import { archiveTemplate, createTemplate, updateTemplate } from '@/core/templates/commands';
import { apply, baseDocument, expectFailure, IDS, testCtx } from '../versioning/fixtures';

const BASE_AXES = {
  x: { levels: [{ variableId: IDS.score }] },
  y: { levels: [{ variableId: IDS.restritivo }] },
};

describe('template/create', () => {
  it('cria o template e o documento continua válido', () => {
    const ctx = testCtx();
    const result = apply(
      baseDocument(),
      ctx,
      createTemplate({ code: 'TPL_A', name: 'Template A', axes: BASE_AXES }),
    );
    const created = result.document.templates.find((t) => t.id === result.data.templateId);
    expect(created).toBeDefined();
    expect(created!.seedRules).toEqual([]);
    expect(validateDocument(result.document).ok).toBe(true);
  });

  it('recusa código duplicado', () => {
    const ctx = testCtx();
    const first = apply(baseDocument(), ctx, createTemplate({ code: 'TPL_A', name: 'A', axes: BASE_AXES }));
    expectFailure(
      first.document,
      ctx,
      createTemplate({ code: 'TPL_A', name: 'Outro', axes: BASE_AXES }),
      'DUPLICATE_CODE',
    );
  });

  it('recusa variável inexistente no eixo', () => {
    const ctx = testCtx();
    expectFailure(
      baseDocument(),
      ctx,
      createTemplate({
        code: 'TPL_X',
        name: 'X',
        axes: { x: { levels: [{ variableId: 'nao-existe' }] }, y: BASE_AXES.y },
      }),
      'NOT_FOUND',
    );
  });

  it('recusa a mesma variável nos dois eixos', () => {
    const ctx = testCtx();
    expectFailure(
      baseDocument(),
      ctx,
      createTemplate({
        code: 'TPL_X',
        name: 'X',
        axes: { x: { levels: [{ variableId: IDS.score }] }, y: { levels: [{ variableId: IDS.score }] } },
      }),
      'VARIABLE_ON_BOTH_AXES',
    );
  });

  it('recusa mais de 3 níveis num eixo', () => {
    const ctx = testCtx();
    expectFailure(
      baseDocument(),
      ctx,
      createTemplate({
        code: 'TPL_X',
        name: 'X',
        axes: {
          x: {
            levels: [
              { variableId: IDS.score },
              { variableId: IDS.restritivo },
              { variableId: IDS.segmento },
              { variableId: IDS.fat },
            ],
          },
          y: { levels: [{ variableId: IDS.bigX }] },
        },
      }),
      'TOO_MANY_LEVELS',
    );
  });

  it('valida com Zod na escrita: rejeita cor fora do formato #RRGGBB', () => {
    const ctx = testCtx();
    expectFailure(
      baseDocument(),
      ctx,
      createTemplate({
        code: 'TPL_COR',
        name: 'Cor inválida',
        axes: BASE_AXES,
        seedRules: [{ when: {}, set: { color: 'nao-e-uma-cor' as never } }],
      }),
      'INVALID_INPUT',
    );
  });

  it('o inverso desfaz a criação', () => {
    const ctx = testCtx();
    const result = apply(
      baseDocument(),
      ctx,
      createTemplate({ code: 'TPL_A', name: 'Template A', axes: BASE_AXES }),
    );
    const undone = apply(result.document, ctx, result.result.inverse);
    expect(undone.document.templates).toEqual([]);
  });
});

describe('template/update', () => {
  it('atualiza nome, defaults e seedRules preservando o restante', () => {
    const ctx = testCtx();
    const created = apply(
      baseDocument(),
      ctx,
      createTemplate({ code: 'TPL_A', name: 'Template A', axes: BASE_AXES }),
    );
    const updated = apply(
      created.document,
      ctx,
      updateTemplate({
        templateId: created.data.templateId,
        name: 'Template A — revisado',
        defaults: { decision: 'APROVADO' },
        seedRules: [{ when: { x: ['R1'] }, set: { decision: 'ANALISE_MANUAL' } }],
      }),
    );
    const template = updated.document.templates.find((t) => t.id === created.data.templateId)!;
    expect(template.name).toBe('Template A — revisado');
    expect(template.defaults).toEqual({ decision: 'APROVADO' });
    expect(template.seedRules).toHaveLength(1);
    expect(template.axes).toEqual(BASE_AXES);
  });

  it('o inverso restaura os valores anteriores', () => {
    const ctx = testCtx();
    const created = apply(
      baseDocument(),
      ctx,
      createTemplate({ code: 'TPL_A', name: 'Template A', axes: BASE_AXES }),
    );
    const updated = apply(
      created.document,
      ctx,
      updateTemplate({ templateId: created.data.templateId, name: 'Novo nome' }),
    );
    const undone = apply(updated.document, ctx, updated.result.inverse);
    expect(undone.document.templates.find((t) => t.id === created.data.templateId)!.name).toBe(
      'Template A',
    );
  });

  it('falha com NOT_FOUND para template inexistente', () => {
    const ctx = testCtx();
    expectFailure(
      baseDocument(),
      ctx,
      updateTemplate({ templateId: 'nao-existe', name: 'X' }),
      'NOT_FOUND',
    );
  });
});

describe('template/archive', () => {
  it('arquiva e o inverso desarquiva', () => {
    const ctx = testCtx();
    const created = apply(
      baseDocument(),
      ctx,
      createTemplate({ code: 'TPL_A', name: 'Template A', axes: BASE_AXES }),
    );
    const archived = apply(created.document, ctx, archiveTemplate({ templateId: created.data.templateId }));
    expect(
      archived.document.templates.find((t) => t.id === created.data.templateId)!.archivedAt,
    ).toBeDefined();

    const restored = apply(archived.document, ctx, archived.result.inverse);
    expect(
      restored.document.templates.find((t) => t.id === created.data.templateId)!.archivedAt,
    ).toBeUndefined();
  });

  it('recusa arquivar duas vezes', () => {
    const ctx = testCtx();
    const created = apply(
      baseDocument(),
      ctx,
      createTemplate({ code: 'TPL_A', name: 'Template A', axes: BASE_AXES }),
    );
    const archived = apply(created.document, ctx, archiveTemplate({ templateId: created.data.templateId }));
    expectFailure(
      archived.document,
      ctx,
      archiveTemplate({ templateId: created.data.templateId }),
      'INVALID_INPUT',
    );
  });
});
