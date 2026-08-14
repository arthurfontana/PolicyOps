import { describe, expect, it } from 'vitest';
import { createComponent } from '@/core/document/components';
import type { ComponentPayload, PolicyOpsDocument } from '@/core/document/schema';
import { validateDocument } from '@/core/document/validate';
import {
  createComponentDraft,
  discardComponentDraft,
  locateComponentVersion,
  publishComponentVersion,
  updateComponentVersion,
} from '@/core/versioning/component-lifecycle';
import { apply, baseDocument, createTestMatrix, expectFailure, IDS, testCtx } from './fixtures';
import type { TestCtx } from './fixtures';

/**
 * Ciclo de vida da versão de componente — docs/14 §3.2, RN-GOV-06.
 *
 * O que estes testes protegem, além do óbvio: **publicar sela a versão e
 * substitui a anterior sem descartá-la** (RN-GOV-06/I29), **vigência retroativa
 * é permitida** (é o caminho da fundação, RN-GOV-09) e **descartar rascunho tem
 * inverso exato** — a diferença deliberada em relação ao descarte de rascunho
 * de matriz, que queima o número.
 */

const VIGENCIA_1 = '2026-02-01T00:00:00.000Z';
const VIGENCIA_2 = '2026-03-01T00:00:00.000Z';

function rulePayload(businessDescription: string): ComponentPayload {
  return {
    kind: 'RULE',
    businessDescription,
    technicalDefinition: 'Aging > 0 e Valor >= 5000',
    outcome: 'Reprovar',
    reasonCodes: ['DV01'],
  };
}

function comRegra(ctx: TestCtx): { document: PolicyOpsDocument; componentId: string } {
  const criado = apply(
    baseDocument(),
    ctx,
    createComponent({
      projectId: IDS.projectA,
      code: 'REGRA_DIVIDA_5000',
      name: 'Dívida acima de R$ 5.000',
      type: 'RULE',
    }),
  );
  return { document: criado.document, componentId: criado.data.componentId };
}

function comSecao(ctx: TestCtx): { document: PolicyOpsDocument; componentId: string } {
  const criado = apply(
    baseDocument(),
    ctx,
    createComponent({
      projectId: IDS.projectA,
      code: 'CAP_REGRAS_DURAS',
      name: '4.2 Regras Duras',
      type: 'SECTION',
    }),
  );
  return { document: criado.document, componentId: criado.data.componentId };
}

describe('componentVersion/createDraft', () => {
  it('cria a v1 DRAFT com o conteúdo informado e registra COMPONENT_DRAFT_CREATED', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);

    const rascunho = apply(
      document,
      ctx,
      createComponentDraft({ componentId, payload: rulePayload('Bloqueia dívida ≥ R$ 5.000.') }),
    );

    expect(rascunho.data).toEqual({
      versionId: rascunho.data.versionId,
      number: 1,
      baseVersionNumber: null,
    });
    const version = rascunho.document.components[0]!.versions[0]!;
    expect(version.state).toBe('DRAFT');
    expect(version.createdBy).toBe('Arthur');
    expect(version.effectiveFrom).toBeUndefined();
    expect(version.payload).toEqual(rulePayload('Bloqueia dívida ≥ R$ 5.000.'));
    expect(rascunho.result.events.map((event) => event.type)).toEqual(['COMPONENT_DRAFT_CREATED']);
    expect(rascunho.result.events[0]!.scope).toEqual({
      projectId: IDS.projectA,
      componentId,
      componentVersionId: rascunho.data.versionId,
    });
    expect(validateDocument(rascunho.document).ok).toBe(true);
  });

  it('deriva da publicada vigente, clonando payload e spec', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const v1 = apply(
      document,
      ctx,
      createComponentDraft({
        componentId,
        payload: rulePayload('Texto original.'),
        spec: { blocks: [{ id: 'blk000000001', type: 'paragraph', text: [{ text: 'Detalhe.' }] }] },
      }),
    );
    const publicada = apply(
      v1.document,
      ctx,
      publishComponentVersion({ versionId: v1.data.versionId, effectiveFrom: VIGENCIA_1 }),
    );

    const v2 = apply(publicada.document, ctx, createComponentDraft({ componentId }));

    expect(v2.data).toEqual({ versionId: v2.data.versionId, number: 2, baseVersionNumber: 1 });
    const version = locateComponentVersion(v2.document, v2.data.versionId).version;
    expect(version.payload).toEqual(rulePayload('Texto original.'));
    expect(version.spec).toEqual({
      blocks: [{ id: 'blk000000001', type: 'paragraph', text: [{ text: 'Detalhe.' }] }],
    });
  });

  it('I29: recusa um segundo rascunho no mesmo componente', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const v1 = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('Um.') }));

    expectFailure(
      v1.document,
      ctx,
      createComponentDraft({ componentId, payload: rulePayload('Dois.') }),
      'DRAFT_ALREADY_EXISTS',
    );
  });

  it('sem conteúdo e sem base, recusa com NO_VERSION_TO_DERIVE', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    expectFailure(document, ctx, createComponentDraft({ componentId }), 'NO_VERSION_TO_DERIVE');
  });

  it('recusa componente inexistente e base fora do componente', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    expectFailure(
      document,
      ctx,
      createComponentDraft({ componentId: 'nao_existe_', payload: rulePayload('X') }),
      'NOT_FOUND',
    );
    expectFailure(
      document,
      ctx,
      createComponentDraft({ componentId, baseVersionId: 'nao_existe_', payload: rulePayload('X') }),
      'NOT_FOUND',
    );
  });

  it('I27: componente MATRIX não versiona nada', () => {
    const ctx = testCtx();
    const comMatriz = createTestMatrix(baseDocument(), ctx);
    const espelho = apply(
      comMatriz.document,
      ctx,
      createComponent({
        projectId: IDS.projectA,
        code: 'MTZ_A',
        name: 'Matriz A',
        type: 'MATRIX',
        matrixId: comMatriz.data.matrixId,
      }),
    );

    expectFailure(
      espelho.document,
      ctx,
      createComponentDraft({ componentId: espelho.data.componentId, payload: rulePayload('X') }),
      'COMPONENT_TREE_INVALID',
    );
  });

  it('I29: recusa payload de outro tipo, e a seção aceita o payload OTHER', () => {
    const ctx = testCtx();
    const { document: comRegraDoc, componentId: regraId } = comRegra(ctx);
    expectFailure(
      comRegraDoc,
      ctx,
      createComponentDraft({
        componentId: regraId,
        payload: { kind: 'LIST', businessDescription: 'Lista errada.' },
      }),
      'INVALID_INPUT',
    );

    const { document: comSecaoDoc, componentId: secaoId } = comSecao(ctx);
    expectFailure(
      comSecaoDoc,
      ctx,
      createComponentDraft({ componentId: secaoId, payload: rulePayload('Regra numa seção.') }),
      'INVALID_INPUT',
    );

    const visaoGeral = apply(
      comSecaoDoc,
      ctx,
      createComponentDraft({
        componentId: secaoId,
        payload: {
          kind: 'OTHER',
          businessDescription: 'Visão Geral: as regras duras rodam antes do modelo.',
        },
      }),
    );
    expect(validateDocument(visaoGeral.document).ok).toBe(true);
  });

  it('preserva changeRequestId quando ele vem no comando', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const rascunho = apply(
      document,
      ctx,
      createComponentDraft({ componentId, payload: rulePayload('X'), changeRequestId: 'db519000000' }),
    );

    expect(rascunho.document.components[0]!.versions[0]!.changeRequestId).toBe('db519000000');
  });

  it('inverso: apaga o rascunho criado; refazer devolve o documento idêntico', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const rascunho = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('X') }));

    const desfeito = apply(rascunho.document, ctx, rascunho.result.inverse);
    expect(desfeito.document.components[0]!.versions).toEqual([]);

    const refeito = apply(desfeito.document, ctx, desfeito.result.inverse);
    expect(refeito.document.components).toEqual(rascunho.document.components);
  });
});

describe('componentVersion/update', () => {
  it('altera payload e spec do rascunho, e o inverso devolve o documento idêntico', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const rascunho = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('Antes.') }));

    const editado = apply(
      rascunho.document,
      ctx,
      updateComponentVersion({
        versionId: rascunho.data.versionId,
        payload: rulePayload('Depois.'),
        spec: { blocks: [{ id: 'blk000000001', type: 'heading1', text: [{ text: 'Contexto' }] }] },
      }),
    );

    const version = locateComponentVersion(editado.document, rascunho.data.versionId).version;
    expect(version.payload.businessDescription).toBe('Depois.');
    expect(version.spec?.blocks).toHaveLength(1);
    // Editar rascunho não é um marco da linha do tempo — o marco é a publicação.
    expect(editado.result.events).toEqual([]);

    const desfeito = apply(editado.document, ctx, editado.result.inverse);
    expect(desfeito.document.components).toEqual(rascunho.document.components);
  });

  it('spec: null apaga a especificação, sem virar campo vazio', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const rascunho = apply(
      document,
      ctx,
      createComponentDraft({
        componentId,
        payload: rulePayload('X'),
        spec: { blocks: [{ id: 'blk000000001', type: 'paragraph', text: [{ text: 'Some.' }] }] },
      }),
    );

    const limpo = apply(
      rascunho.document,
      ctx,
      updateComponentVersion({ versionId: rascunho.data.versionId, spec: null, changeRequestId: null }),
    );

    expect(limpo.document.components[0]!.versions[0]).not.toHaveProperty('spec');
  });

  it('vincula o rascunho a um DB, e o inverso devolve o vínculo anterior', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const rascunho = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('X') }));

    const vinculado = apply(
      rascunho.document,
      ctx,
      updateComponentVersion({ versionId: rascunho.data.versionId, changeRequestId: 'db519000000' }),
    );
    expect(vinculado.document.components[0]!.versions[0]!.changeRequestId).toBe('db519000000');

    const desfeito = apply(vinculado.document, ctx, vinculado.result.inverse);
    expect(desfeito.document.components).toEqual(rascunho.document.components);
  });

  it('I3: recusa editar versão publicada, com VERSION_IMMUTABLE', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const rascunho = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('X') }));
    const publicada = apply(
      rascunho.document,
      ctx,
      publishComponentVersion({ versionId: rascunho.data.versionId, effectiveFrom: VIGENCIA_1 }),
    );

    expectFailure(
      publicada.document,
      ctx,
      updateComponentVersion({ versionId: rascunho.data.versionId, payload: rulePayload('Y') }),
      'VERSION_IMMUTABLE',
    );
    expectFailure(
      publicada.document,
      ctx,
      updateComponentVersion({ versionId: 'nao_existe_', payload: rulePayload('Y') }),
      'NOT_FOUND',
    );
  });
});

describe('componentVersion/publish', () => {
  it('carimba vigência, autor e data, e registra COMPONENT_VERSION_PUBLISHED', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const rascunho = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('X') }));

    const publicada = apply(
      rascunho.document,
      ctx,
      publishComponentVersion({ versionId: rascunho.data.versionId, effectiveFrom: VIGENCIA_1 }),
    );

    const version = publicada.document.components[0]!.versions[0]!;
    expect(version.state).toBe('PUBLISHED');
    expect(version.effectiveFrom).toBe(VIGENCIA_1);
    expect(version.effectiveTo).toBeUndefined();
    expect(version.publishedBy).toBe('Arthur');
    expect(version.publishedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(publicada.data.supersededVersionId).toBeNull();
    expect(publicada.result.events.map((event) => event.type)).toEqual(['COMPONENT_VERSION_PUBLISHED']);
    // RN-GOV-07: sem DB de origem, a timeline carimba "publicação direta".
    expect(publicada.result.events[0]!.payload).toEqual({
      effectiveFrom: VIGENCIA_1,
      changeRequestId: null,
    });
    expect(publicada.result.events[0]!.summary).toContain('publicação direta');
    expect(validateDocument(publicada.document).ok).toBe(true);
  });

  it('RN-GOV-06: a v2 substitui a v1, que vira SUPERSEDED com effectiveTo — nada se perde', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const v1 = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('Antes.') }));
    const p1 = apply(
      v1.document,
      ctx,
      publishComponentVersion({ versionId: v1.data.versionId, effectiveFrom: VIGENCIA_1 }),
    );
    const v2 = apply(
      p1.document,
      ctx,
      createComponentDraft({ componentId, payload: rulePayload('Depois.') }),
    );
    const p2 = apply(
      v2.document,
      ctx,
      publishComponentVersion({ versionId: v2.data.versionId, effectiveFrom: VIGENCIA_2 }),
    );

    const versions = p2.document.components[0]!.versions;
    expect(versions.map((version) => [version.number, version.state])).toEqual([
      [1, 'SUPERSEDED'],
      [2, 'PUBLISHED'],
    ]);
    expect(versions[0]!.effectiveTo).toBe(VIGENCIA_2);
    expect(versions[0]!.payload.businessDescription).toBe('Antes.');
    expect(p2.data.supersededVersionId).toBe(v1.data.versionId);
    expect(p2.result.events.map((event) => event.type)).toEqual([
      'COMPONENT_VERSION_SUPERSEDED',
      'COMPONENT_VERSION_PUBLISHED',
    ]);
    expect(validateDocument(p2.document).ok).toBe(true);
  });

  it('RN-GOV-09: vigência retroativa é permitida — é o caminho da fundação', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const rascunho = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('X') }));

    const fundacao = apply(
      rascunho.document,
      ctx,
      publishComponentVersion({
        versionId: rascunho.data.versionId,
        effectiveFrom: '2024-01-01T00:00:00.000Z',
      }),
    );

    expect(fundacao.document.components[0]!.versions[0]!.effectiveFrom).toBe('2024-01-01T00:00:00.000Z');
    expect(validateDocument(fundacao.document).ok).toBe(true);
  });

  it('recusa vigência mal formada e vigência anterior ou igual à da vigente', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const v1 = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('X') }));

    expectFailure(
      v1.document,
      ctx,
      publishComponentVersion({ versionId: v1.data.versionId, effectiveFrom: '01/02/2026' }),
      'INVALID_INPUT',
    );

    const p1 = apply(
      v1.document,
      ctx,
      publishComponentVersion({ versionId: v1.data.versionId, effectiveFrom: VIGENCIA_1 }),
    );
    const v2 = apply(p1.document, ctx, createComponentDraft({ componentId }));

    expectFailure(
      v2.document,
      ctx,
      publishComponentVersion({ versionId: v2.data.versionId, effectiveFrom: VIGENCIA_1 }),
      'EFFECTIVE_DATE_INVALID',
    );
  });

  it('recusa publicar o que não é rascunho, e versão inexistente', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const v1 = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('X') }));
    const p1 = apply(
      v1.document,
      ctx,
      publishComponentVersion({ versionId: v1.data.versionId, effectiveFrom: VIGENCIA_1 }),
    );

    expectFailure(
      p1.document,
      ctx,
      publishComponentVersion({ versionId: v1.data.versionId, effectiveFrom: VIGENCIA_2 }),
      'VERSION_NOT_DRAFT',
    );
    expectFailure(
      p1.document,
      ctx,
      publishComponentVersion({ versionId: 'nao_existe_', effectiveFrom: VIGENCIA_2 }),
      'NOT_FOUND',
    );
  });

  it('I3: não tem inverso — o desfazer falha com mensagem explícita', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const v1 = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('X') }));
    const p1 = apply(
      v1.document,
      ctx,
      publishComponentVersion({ versionId: v1.data.versionId, effectiveFrom: VIGENCIA_1 }),
    );

    const result = p1.result.inverse.run(p1.document, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('não pode ser desfeito');
  });

  it('a linha do tempo aponta o DB de origem quando a versão tem changeRequestId', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const v1 = apply(
      document,
      ctx,
      createComponentDraft({ componentId, payload: rulePayload('X'), changeRequestId: 'db519000000' }),
    );
    const p1 = apply(
      v1.document,
      ctx,
      publishComponentVersion({ versionId: v1.data.versionId, effectiveFrom: VIGENCIA_1 }),
    );

    expect(p1.result.events[0]!.payload).toEqual({
      effectiveFrom: VIGENCIA_1,
      changeRequestId: 'db519000000',
    });
    expect(p1.result.events[0]!.summary).not.toContain('publicação direta');
  });
});

describe('componentVersion/discardDraft', () => {
  it('remove o rascunho e registra o evento; o inverso o devolve byte a byte', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const rascunho = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('X') }));

    const descartado = apply(
      rascunho.document,
      ctx,
      discardComponentDraft({ versionId: rascunho.data.versionId }),
    );

    expect(descartado.document.components[0]!.versions).toEqual([]);
    expect(descartado.data).toEqual({ versionId: rascunho.data.versionId, number: 1 });
    expect(descartado.result.events.map((event) => event.type)).toEqual(['COMPONENT_DRAFT_DISCARDED']);

    const desfeito = apply(descartado.document, ctx, descartado.result.inverse);
    expect(desfeito.document.components).toEqual(rascunho.document.components);
  });

  it('descartar não queima o número: o rascunho seguinte volta a ser o mesmo', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const rascunho = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('X') }));
    const descartado = apply(
      rascunho.document,
      ctx,
      discardComponentDraft({ versionId: rascunho.data.versionId }),
    );

    const outro = apply(descartado.document, ctx, createComponentDraft({ componentId, payload: rulePayload('Y') }));
    expect(outro.data.number).toBe(1);
  });

  it('recusa descartar versão publicada e versão inexistente', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);
    const v1 = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('X') }));
    const p1 = apply(
      v1.document,
      ctx,
      publishComponentVersion({ versionId: v1.data.versionId, effectiveFrom: VIGENCIA_1 }),
    );

    expectFailure(p1.document, ctx, discardComponentDraft({ versionId: v1.data.versionId }), 'VERSION_NOT_DRAFT');
    expectFailure(p1.document, ctx, discardComponentDraft({ versionId: 'nao_existe_' }), 'NOT_FOUND');
  });
});

describe('ciclo completo de uma regra (US-GOV-02)', () => {
  it('rascunho → publicar → novo rascunho → publicar → descartar deixa o documento válido em cada passo', () => {
    const ctx = testCtx();
    const { document, componentId } = comRegra(ctx);

    const v1 = apply(document, ctx, createComponentDraft({ componentId, payload: rulePayload('v1') }));
    expect(validateDocument(v1.document).ok).toBe(true);

    const p1 = apply(
      v1.document,
      ctx,
      publishComponentVersion({ versionId: v1.data.versionId, effectiveFrom: VIGENCIA_1 }),
    );
    expect(validateDocument(p1.document).ok).toBe(true);

    const v2 = apply(p1.document, ctx, createComponentDraft({ componentId, payload: rulePayload('v2') }));
    const p2 = apply(
      v2.document,
      ctx,
      publishComponentVersion({ versionId: v2.data.versionId, effectiveFrom: VIGENCIA_2 }),
    );
    expect(validateDocument(p2.document).ok).toBe(true);

    const v3 = apply(p2.document, ctx, createComponentDraft({ componentId }));
    const descartado = apply(v3.document, ctx, discardComponentDraft({ versionId: v3.data.versionId }));
    expect(validateDocument(descartado.document).ok).toBe(true);

    // A cadeia de vigência ficou contígua e só a última está PUBLISHED (I29).
    const versions = descartado.document.components[0]!.versions;
    expect(versions.map((v) => [v.number, v.state, v.effectiveFrom, v.effectiveTo])).toEqual([
      [1, 'SUPERSEDED', VIGENCIA_1, VIGENCIA_2],
      [2, 'PUBLISHED', VIGENCIA_2, undefined],
    ]);
  });
});
