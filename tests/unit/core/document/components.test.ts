import { describe, expect, it } from 'vitest';
import {
  archiveComponent,
  componentDepth,
  createComponent,
  duplicateComponent,
  listChildren,
  moveComponent,
  restoreArchivedComponent,
  setComponentReviewStatus,
  subtreeIds,
  updateComponent,
} from '@/core/document/components';
import type { CreateComponentInput } from '@/core/document/components';
import { createComponentDraft, publishComponentVersion } from '@/core/versioning/component-lifecycle';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { validateDocument } from '@/core/document/validate';
import { apply, baseDocument, createTestMatrix, expectFailure, IDS, testCtx } from '../versioning/fixtures';
import type { TestCtx } from '../versioning/fixtures';

/**
 * Comandos da árvore de política — docs/08 §3, docs/14 §3.1.
 *
 * O que estes testes protegem, além do óbvio: **o inverso devolve o documento
 * byte a byte** (é o que faz o desfazer/refazer da árvore não inventar
 * `position` nem carimbo de data) e **mover não abre buraco em `position`**
 * (I28) nem em quem ficou para trás.
 */

function tree(ctx: TestCtx): { document: PolicyOpsDocument; ids: Record<string, string> } {
  let document = baseDocument();
  const ids: Record<string, string> = {};

  const add = (key: string, input: Omit<CreateComponentInput, 'projectId'>): void => {
    const applied = apply(document, ctx, createComponent({ projectId: IDS.projectA, ...input }));
    document = applied.document;
    ids[key] = applied.data.componentId;
  };

  add('capitulo', { code: 'CAP', name: '4.2 Regras Duras', type: 'SECTION' });
  add('divida', { code: 'BLOQUEIOS', name: 'Bloqueios por Dívida', type: 'SECTION', parentId: ids.capitulo });
  add('fraude', { code: 'FRAUDE', name: 'Prevenção a Fraude', type: 'SECTION', parentId: ids.capitulo });
  add('regra1', { code: 'REGRA_DIVIDA_5000', name: 'Dívida acima de R$ 5.000', type: 'RULE', parentId: ids.divida });
  add('regra2', { code: 'REGRA_DIVIDA_VENCIDA', name: 'Dívida vencida', type: 'RULE', parentId: ids.divida });

  return { document, ids };
}

describe('component/create', () => {
  it('cria o nó no fim dos irmãos, com position 0-based e sem buracos', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);

    const irmaos = listChildren(document, IDS.projectA, ids.capitulo);
    expect(irmaos.map((component) => component.code)).toEqual(['BLOQUEIOS', 'FRAUDE']);
    expect(irmaos.map((component) => component.position)).toEqual([0, 1]);
    expect(validateDocument(document).ok).toBe(true);
  });

  it('nasce STRUCTURED, sem versões e sem campos opcionais vazios', () => {
    const ctx = testCtx();
    const criado = apply(
      baseDocument(),
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'CAP', name: 'Capítulo', type: 'SECTION' }),
    );
    const component = criado.document.components[0]!;

    expect(component).toEqual({
      id: criado.data.componentId,
      projectId: IDS.projectA,
      position: 0,
      code: 'CAP',
      name: 'Capítulo',
      type: 'SECTION',
      reviewStatus: 'STRUCTURED',
      createdAt: '2026-01-01T00:00:00.000Z',
      versions: [],
    });
  });

  it('registra COMPONENT_CREATED com o tipo e o pai', () => {
    const ctx = testCtx();
    const criado = apply(
      baseDocument(),
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'CAP', name: 'Capítulo', type: 'SECTION' }),
    );

    expect(criado.result.events.map((event) => event.type)).toEqual(['COMPONENT_CREATED']);
    expect(criado.result.events[0]!.payload).toEqual({
      code: 'CAP',
      name: 'Capítulo',
      componentType: 'SECTION',
      parentId: null,
    });
    expect(criado.result.events[0]!.scope).toEqual({
      projectId: IDS.projectA,
      componentId: criado.data.componentId,
    });
  });

  it('E-GOV-06: recusa code repetido no mesmo projeto, e aceita o mesmo code em outro', () => {
    const ctx = testCtx();
    const primeiro = apply(
      baseDocument(),
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'CAP', name: 'Capítulo', type: 'SECTION' }),
    );

    expectFailure(
      primeiro.document,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'CAP', name: 'Outro', type: 'SECTION' }),
      'COMPONENT_CODE_DUPLICATE',
    );

    const outroProjeto = apply(
      primeiro.document,
      ctx,
      createComponent({ projectId: IDS.projectB, code: 'CAP', name: 'Capítulo', type: 'SECTION' }),
    );
    expect(validateDocument(outroProjeto.document).ok).toBe(true);
  });

  it('recusa projeto inexistente, código fora do formato e nome em branco', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    expectFailure(
      doc,
      ctx,
      createComponent({ projectId: 'nao_existe_', code: 'CAP', name: 'Capítulo', type: 'SECTION' }),
      'NOT_FOUND',
    );
    expectFailure(
      doc,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'cap minúsculo', name: 'C', type: 'SECTION' }),
      'INVALID_INPUT',
    );
    expectFailure(
      doc,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'CAP', name: '   ', type: 'SECTION' }),
      'INVALID_INPUT',
    );
  });

  it('MATRIX aponta uma matriz do mesmo projeto, uma vez só (I27)', () => {
    const ctx = testCtx();
    const comMatriz = createTestMatrix(baseDocument(), ctx);
    const matrixId = comMatriz.data.matrixId;

    // Sem `matrixId` não existe espelho.
    expectFailure(
      comMatriz.document,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'MTZ_NO', name: 'Sem matriz', type: 'MATRIX' }),
      'COMPONENT_TREE_INVALID',
    );

    const espelho = apply(
      comMatriz.document,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'MTZ_A', name: 'Matriz A', type: 'MATRIX', matrixId }),
    );
    expect(validateDocument(espelho.document).ok).toBe(true);

    // Segunda vez: a mesma matriz apontada por dois nós.
    expectFailure(
      espelho.document,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'MTZ_A2', name: 'De novo', type: 'MATRIX', matrixId }),
      'COMPONENT_TREE_INVALID',
    );

    // Matriz de outro projeto.
    expectFailure(
      espelho.document,
      ctx,
      createComponent({ projectId: IDS.projectB, code: 'MTZ_B', name: 'Alheia', type: 'MATRIX', matrixId }),
      'COMPONENT_TREE_INVALID',
    );

    // `matrixId` em nó que não é MATRIX.
    expectFailure(
      espelho.document,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'REGRA_X', name: 'Regra', type: 'RULE', matrixId }),
      'COMPONENT_TREE_INVALID',
    );
  });

  it('MATRIX é sempre folha: pendurar filho nele falha', () => {
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
      createComponent({
        projectId: IDS.projectA,
        code: 'FILHO',
        name: 'Filho',
        type: 'RULE',
        parentId: espelho.data.componentId,
      }),
      'COMPONENT_TREE_INVALID',
    );
  });

  it('POLICY_VARIABLE espelha uma variável existente, uma vez só (I27)', () => {
    const ctx = testCtx();
    const criado = apply(
      baseDocument(),
      ctx,
      createComponent({
        projectId: IDS.projectA,
        code: 'VAR_SCORE',
        name: 'Score',
        type: 'POLICY_VARIABLE',
        variableId: IDS.score,
      }),
    );
    expect(validateDocument(criado.document).ok).toBe(true);

    expectFailure(
      criado.document,
      ctx,
      createComponent({
        projectId: IDS.projectA,
        code: 'VAR_SCORE_2',
        name: 'Score de novo',
        type: 'POLICY_VARIABLE',
        variableId: IDS.score,
      }),
      'COMPONENT_TREE_INVALID',
    );

    expectFailure(
      criado.document,
      ctx,
      createComponent({
        projectId: IDS.projectA,
        code: 'VAR_SUMIU',
        name: 'Some',
        type: 'POLICY_VARIABLE',
        variableId: 'nao_existe_',
      }),
      'NOT_FOUND',
    );

    expectFailure(
      criado.document,
      ctx,
      createComponent({
        projectId: IDS.projectA,
        code: 'REGRA_Y',
        name: 'Regra',
        type: 'RULE',
        variableId: IDS.restritivo,
      }),
      'COMPONENT_TREE_INVALID',
    );
  });

  it('recusa tag que não existe no catálogo, e deduplica a que existe', () => {
    const ctx = testCtx();
    expectFailure(
      baseDocument(),
      ctx,
      createComponent({
        projectId: IDS.projectA,
        code: 'CAP',
        name: 'Capítulo',
        type: 'SECTION',
        tags: ['NAO_EXISTE'],
      }),
      'TAG_NOT_FOUND',
    );

    const criado = apply(
      baseDocument(),
      ctx,
      createComponent({
        projectId: IDS.projectA,
        code: 'CAP',
        name: 'Capítulo',
        type: 'SECTION',
        tags: ['REVISAR', 'REVISAR'],
      }),
    );
    expect(criado.document.components[0]!.tags).toEqual(['REVISAR']);
  });

  it('recusa passar do teto de 6 níveis', () => {
    const ctx = testCtx();
    let document = baseDocument();
    let parentId: string | undefined;

    for (let level = 1; level <= 6; level++) {
      const applied = apply(
        document,
        ctx,
        createComponent({ projectId: IDS.projectA, code: `N${level}`, name: `Nível ${level}`, type: 'SECTION', ...(parentId === undefined ? {} : { parentId }) }),
      );
      document = applied.document;
      parentId = applied.data.componentId;
    }
    expect(componentDepth(document, document.components[5]!)).toBe(6);
    expect(validateDocument(document).ok).toBe(true);

    expectFailure(
      document,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'N7', name: 'Nível 7', type: 'SECTION', parentId }),
      'COMPONENT_TREE_INVALID',
    );
  });

  it('inverso: remove o nó criado e reindexa os irmãos; refazer devolve o documento idêntico', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);

    const terceiro = apply(
      document,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'TERCEIRA', name: 'Terceira', type: 'SECTION', parentId: ids.capitulo }),
    );

    const desfeito = apply(terceiro.document, ctx, terceiro.result.inverse);
    expect(desfeito.document.components.map((component) => component.code)).toEqual(
      document.components.map((component) => component.code),
    );
    expect(listChildren(desfeito.document, IDS.projectA, ids.capitulo).map((c) => c.position)).toEqual([0, 1]);

    const refeito = apply(desfeito.document, ctx, desfeito.result.inverse);
    expect(refeito.document.components).toEqual(terceiro.document.components);
  });

  it('inverso recusa remover um nó que já ganhou filho', () => {
    const ctx = testCtx();
    const criado = apply(
      baseDocument(),
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'CAP', name: 'Capítulo', type: 'SECTION' }),
    );
    const comFilho = apply(
      criado.document,
      ctx,
      createComponent({
        projectId: IDS.projectA,
        code: 'FILHO',
        name: 'Filho',
        type: 'SECTION',
        parentId: criado.data.componentId,
      }),
    );

    expectFailure(comFilho.document, ctx, criado.result.inverse, 'COMPONENT_TREE_INVALID');
  });
});

describe('component/update', () => {
  it('altera nome, tags e origem, e o inverso devolve o documento idêntico', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);
    const antes = document.components.find((component) => component.id === ids.regra1)!;

    const editado = apply(
      document,
      ctx,
      updateComponent({
        componentId: ids.regra1,
        name: 'Dívida acima de R$ 5.000 (revisada)',
        tags: ['REVISAR'],
        origin: { source: 'Filtros e Critérios B2C', locator: 'p. 10' },
      }),
    );

    const depois = editado.document.components.find((component) => component.id === ids.regra1)!;
    expect(depois.name).toBe('Dívida acima de R$ 5.000 (revisada)');
    expect(depois.tags).toEqual(['REVISAR']);
    expect(depois.origin).toEqual({ source: 'Filtros e Critérios B2C', locator: 'p. 10' });
    expect(depois.code).toBe(antes.code);

    const desfeito = apply(editado.document, ctx, editado.result.inverse);
    expect(desfeito.document.components).toEqual(document.components);
  });

  it('lista de tags vazia some do documento, nunca vira []', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);
    const comTag = apply(document, ctx, updateComponent({ componentId: ids.regra1, tags: ['REVISAR'] }));
    const semTag = apply(comTag.document, ctx, updateComponent({ componentId: ids.regra1, tags: [] }));

    expect(semTag.document.components.find((c) => c.id === ids.regra1)).not.toHaveProperty('tags');
  });

  it('recusa componente inexistente e tag fora do catálogo', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);
    expectFailure(document, ctx, updateComponent({ componentId: 'nao_existe_' }), 'NOT_FOUND');
    expectFailure(
      document,
      ctx,
      updateComponent({ componentId: ids.regra1, tags: ['NAO_EXISTE'] }),
      'TAG_NOT_FOUND',
    );
  });
});

describe('component/move', () => {
  it('move para outro pai, reindexando origem e destino', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);

    const movido = apply(document, ctx, moveComponent({ componentId: ids.regra1, parentId: ids.fraude }));

    expect(listChildren(movido.document, IDS.projectA, ids.divida).map((c) => [c.code, c.position])).toEqual([
      ['REGRA_DIVIDA_VENCIDA', 0],
    ]);
    expect(listChildren(movido.document, IDS.projectA, ids.fraude).map((c) => [c.code, c.position])).toEqual([
      ['REGRA_DIVIDA_5000', 0],
    ]);
    expect(validateDocument(movido.document).ok).toBe(true);
  });

  it('reordena entre irmãos, respeitando a posição pedida', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);

    const movido = apply(document, ctx, moveComponent({ componentId: ids.fraude, position: 0 }));

    expect(listChildren(movido.document, IDS.projectA, ids.capitulo).map((c) => c.code)).toEqual([
      'FRAUDE',
      'BLOQUEIOS',
    ]);
    expect(listChildren(movido.document, IDS.projectA, ids.capitulo).map((c) => c.position)).toEqual([0, 1]);
  });

  it('vira raiz do projeto com parentId: null', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);

    const movido = apply(document, ctx, moveComponent({ componentId: ids.divida, parentId: null }));

    const raizes = listChildren(movido.document, IDS.projectA, undefined);
    expect(raizes.map((c) => [c.code, c.position])).toEqual([
      ['CAP', 0],
      ['BLOQUEIOS', 1],
    ]);
    expect(movido.document.components.find((c) => c.id === ids.divida)).not.toHaveProperty('parentId');
  });

  it('recusa mover para dentro da própria subárvore (ciclo, I28)', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);

    expectFailure(
      document,
      ctx,
      moveComponent({ componentId: ids.capitulo, parentId: ids.regra1 }),
      'COMPONENT_TREE_INVALID',
    );
    expectFailure(
      document,
      ctx,
      moveComponent({ componentId: ids.capitulo, parentId: ids.capitulo }),
      'COMPONENT_TREE_INVALID',
    );
    expect(subtreeIds(document, ids.capitulo).size).toBe(5);
  });

  it('recusa destino que estouraria a profundidade, contando a subárvore movida', () => {
    const ctx = testCtx();
    const built = tree(ctx);
    const ids = built.ids;
    let document = built.document;

    // Uma coluna de 4 níveis, para receber a subárvore de 3 (CAP → seção → regra).
    let parentId: string | undefined;
    for (let level = 1; level <= 4; level++) {
      const applied = apply(
        document,
        ctx,
        createComponent({
          projectId: IDS.projectA,
          code: `COL${level}`,
          name: `Coluna ${level}`,
          type: 'SECTION',
          ...(parentId === undefined ? {} : { parentId }),
        }),
      );
      document = applied.document;
      parentId = applied.data.componentId;
    }

    expectFailure(
      document,
      ctx,
      moveComponent({ componentId: ids.capitulo, parentId }),
      'COMPONENT_TREE_INVALID',
    );
  });

  it('recusa pendurar sob um MATRIX ou sob um nó de outro projeto', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);
    const comMatriz = createTestMatrix(document, ctx);
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
    const outroProjeto = apply(
      espelho.document,
      ctx,
      createComponent({ projectId: IDS.projectB, code: 'OUTRO', name: 'Outro', type: 'SECTION' }),
    );

    expectFailure(
      outroProjeto.document,
      ctx,
      moveComponent({ componentId: ids.regra1, parentId: espelho.data.componentId }),
      'COMPONENT_TREE_INVALID',
    );
    expectFailure(
      outroProjeto.document,
      ctx,
      moveComponent({ componentId: ids.regra1, parentId: outroProjeto.data.componentId }),
      'COMPONENT_TREE_INVALID',
    );
    expectFailure(document, ctx, moveComponent({ componentId: ids.regra1, position: -1 }), 'INVALID_INPUT');
  });

  it('mover para onde já estava não escreve nada nem gera evento', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);

    const parado = apply(
      document,
      ctx,
      moveComponent({ componentId: ids.fraude, parentId: ids.capitulo, position: 1 }),
    );

    expect(parado.document).toBe(document);
    expect(parado.result.events).toEqual([]);
  });

  it('inverso: devolve o nó ao pai e à posição de origem, byte a byte', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);

    const movido = apply(
      document,
      ctx,
      moveComponent({ componentId: ids.regra1, parentId: ids.fraude, position: 0 }),
    );
    const desfeito = apply(movido.document, ctx, movido.result.inverse);

    expect(desfeito.document.components).toEqual(document.components);
    expect(desfeito.result.events.map((event) => event.type)).toEqual(['COMPONENT_MOVED']);
  });
});

describe('component/archive e component/setReviewStatus', () => {
  it('arquiva com carimbo, registra o evento e o inverso desarquiva byte a byte', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);

    const arquivado = apply(document, ctx, archiveComponent({ componentId: ids.regra1 }));
    const alvo = arquivado.document.components.find((c) => c.id === ids.regra1)!;
    expect(alvo.archivedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(arquivado.result.events.map((event) => event.type)).toEqual(['COMPONENT_ARCHIVED']);

    const desfeito = apply(arquivado.document, ctx, arquivado.result.inverse);
    expect(desfeito.document.components).toEqual(document.components);
  });

  it('restoreArchivedComponent desarquiva pelo mesmo caminho do desfazer', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);
    const arquivado = apply(document, ctx, archiveComponent({ componentId: ids.regra1 }));
    const restaurado = apply(arquivado.document, ctx, restoreArchivedComponent({ componentId: ids.regra1 }));

    expect(restaurado.document.components.find((c) => c.id === ids.regra1)).not.toHaveProperty('archivedAt');
  });

  it('promove a VALIDATED com evento, e o inverso volta ao estado anterior', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);

    const promovido = apply(
      document,
      ctx,
      setComponentReviewStatus({ componentId: ids.regra1, reviewStatus: 'VALIDATED' }),
    );
    expect(promovido.document.components.find((c) => c.id === ids.regra1)!.reviewStatus).toBe('VALIDATED');
    expect(promovido.result.events[0]!.payload).toEqual({
      componentId: ids.regra1,
      from: 'STRUCTURED',
      to: 'VALIDATED',
    });

    const desfeito = apply(promovido.document, ctx, promovido.result.inverse);
    expect(desfeito.document.components).toEqual(document.components);
  });

  it('marcar o estado que já estava não escreve nada nem gera evento', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);
    const parado = apply(
      document,
      ctx,
      setComponentReviewStatus({ componentId: ids.regra1, reviewStatus: 'STRUCTURED' }),
    );

    expect(parado.document).toBe(document);
    expect(parado.result.events).toEqual([]);
  });

  it('recusa componente inexistente nos dois comandos', () => {
    const ctx = testCtx();
    const { document } = tree(ctx);
    expectFailure(document, ctx, archiveComponent({ componentId: 'nao_existe_' }), 'NOT_FOUND');
    expectFailure(
      document,
      ctx,
      setComponentReviewStatus({ componentId: 'nao_existe_', reviewStatus: 'VALIDATED' }),
      'NOT_FOUND',
    );
    expectFailure(document, ctx, restoreArchivedComponent({ componentId: 'nao_existe_' }), 'NOT_FOUND');
  });
});

describe('component/duplicate', () => {
  it('cria irmão logo abaixo, com sufixo no code, mesmo tipo e pai, e reindexa', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);

    const duplicado = apply(document, ctx, duplicateComponent({ componentId: ids.divida }));
    expect(duplicado.data.code).toBe('BLOQUEIOS_COPIA');

    const siblings = listChildren(duplicado.document, IDS.projectA, ids.capitulo);
    expect(siblings.map((c) => c.code)).toEqual(['BLOQUEIOS', 'BLOQUEIOS_COPIA', 'FRAUDE']);
    expect(siblings.map((c) => c.position)).toEqual([0, 1, 2]);

    const copia = duplicado.document.components.find((c) => c.id === duplicado.data.componentId)!;
    expect(copia.name).toBe('Bloqueios por Dívida (cópia)');
    expect(copia.type).toBe('SECTION');
    expect(copia.parentId).toBe(ids.capitulo);
    expect(copia.versions).toEqual([]);
  });

  it('gera sufixo numérico quando "_COPIA" já existe', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);

    const primeira = apply(document, ctx, duplicateComponent({ componentId: ids.divida }));
    const segunda = apply(primeira.document, ctx, duplicateComponent({ componentId: ids.divida }));
    expect(segunda.data.code).toBe('BLOQUEIOS_COPIA2');
  });

  it('copia tags e origin, mas a duplicata nasce STRUCTURED mesmo se a origem é VALIDATED', () => {
    const ctx = testCtx();
    const built = tree(ctx);
    const { ids } = built;
    let document = built.document;
    document = apply(
      document,
      ctx,
      updateComponent({
        componentId: ids.regra1,
        tags: ['REVISAR'],
        origin: { source: 'Filtros e Critérios B2C', locator: 'p. 10' },
      }),
    ).document;
    document = apply(
      document,
      ctx,
      setComponentReviewStatus({ componentId: ids.regra1, reviewStatus: 'VALIDATED' }),
    ).document;

    const duplicado = apply(document, ctx, duplicateComponent({ componentId: ids.regra1 }));
    const copia = duplicado.document.components.find((c) => c.id === duplicado.data.componentId)!;
    expect(copia.tags).toEqual(['REVISAR']);
    expect(copia.origin).toEqual({ source: 'Filtros e Critérios B2C', locator: 'p. 10' });
    expect(copia.reviewStatus).toBe('STRUCTURED');
  });

  it('com versão publicada: o payload mais recente vira rascunho 1 da duplicata, sem herdar publicação', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);
    const rascunho = apply(
      document,
      ctx,
      createComponentDraft({
        componentId: ids.regra1,
        payload: { kind: 'RULE', businessDescription: 'Bloqueia dívida acima de R$ 5.000.' },
      }),
    );
    const publicado = apply(
      rascunho.document,
      ctx,
      publishComponentVersion({ versionId: rascunho.data.versionId, effectiveFrom: '2026-01-01T00:00:00.000Z' }),
    );

    const duplicado = apply(publicado.document, ctx, duplicateComponent({ componentId: ids.regra1 }));
    const copia = duplicado.document.components.find((c) => c.id === duplicado.data.componentId)!;
    expect(copia.versions).toHaveLength(1);
    expect(copia.versions[0]!.state).toBe('DRAFT');
    expect(copia.versions[0]!.number).toBe(1);
    expect(copia.versions[0]!.payload).toEqual({
      kind: 'RULE',
      businessDescription: 'Bloqueia dívida acima de R$ 5.000.',
    });
    expect(copia.versions[0]!.effectiveFrom).toBeUndefined();
  });

  it('recusa duplicar um nó MATRIX — o espelho é único', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);
    const withMatrix = createTestMatrix(document, ctx);
    const comMatriz = apply(
      withMatrix.document,
      ctx,
      createComponent({
        projectId: IDS.projectA,
        code: 'MTZ_NODE',
        name: 'Matriz',
        type: 'MATRIX',
        matrixId: withMatrix.data.matrixId,
        parentId: ids.capitulo,
      }),
    );
    expectFailure(
      comMatriz.document,
      ctx,
      duplicateComponent({ componentId: comMatriz.data.componentId }),
      'COMPONENT_TREE_INVALID',
    );
  });

  it('inverso remove a duplicata e reindexa; refazer devolve o documento idêntico', () => {
    const ctx = testCtx();
    const { document, ids } = tree(ctx);
    const duplicado = apply(document, ctx, duplicateComponent({ componentId: ids.divida }));

    const desfeito = apply(duplicado.document, ctx, duplicado.result.inverse);
    expect(desfeito.document.components).toEqual(document.components);

    const refeito = apply(desfeito.document, ctx, desfeito.result.inverse);
    expect(refeito.document.components).toEqual(duplicado.document.components);
  });
});
