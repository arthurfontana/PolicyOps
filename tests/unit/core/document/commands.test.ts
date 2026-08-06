import { describe, expect, it } from 'vitest';
import {
  archiveMatrix,
  archiveProject,
  createProject,
  renameDocument,
  updateMatrixMeta,
  updateProject,
} from '@/core/document/commands';
import { validateDocument } from '@/core/document/validate';
import { createMatrix } from '@/core/versioning/lifecycle';
import {
  apply,
  baseDocument,
  createTestMatrix,
  expectFailure,
  IDS,
  T0,
  testCtx,
} from '../versioning/fixtures';

/**
 * Comandos de projeto e de metadados — docs/08 §3. Nenhum deles gera evento:
 * `DocEventType` não tem tipo para eles (ver `src/core/command.ts`).
 */

describe('document/rename', () => {
  it('renomeia, aceita descrição e volta ao estado anterior pelo inverso', () => {
    const ctx = testCtx();
    const doc = baseDocument();

    const renomeado = apply(
      doc,
      ctx,
      renameDocument({ name: 'Políticas de Crédito', description: 'Cartões PF e PJ' }),
    );
    expect(renomeado.document.meta.name).toBe('Políticas de Crédito');
    expect(renomeado.document.meta.description).toBe('Cartões PF e PJ');
    expect(renomeado.result.events).toEqual([]);

    // O inverso restaura o nome antigo e **remove** a descrição, que não existia.
    const desfeito = apply(renomeado.document, ctx, renomeado.result.inverse);
    expect(desfeito.document).toEqual(doc);
    expect('description' in desfeito.document.meta).toBe(false);

    const refeito = apply(desfeito.document, ctx, desfeito.result.inverse);
    expect(refeito.document).toEqual(renomeado.document);
  });

  it('apaga a descrição com null e ignora a chave ausente', () => {
    const ctx = testCtx();
    const comDescricao = apply(
      baseDocument(),
      ctx,
      renameDocument({ name: 'Doc', description: 'Alguma coisa' }),
    ).document;

    const semMexer = apply(comDescricao, ctx, renameDocument({ name: 'Outro' })).document;
    expect(semMexer.meta.description).toBe('Alguma coisa');

    const limpo = apply(semMexer, ctx, renameDocument({ name: 'Outro', description: null }))
      .document;
    expect('description' in limpo.meta).toBe(false);
  });

  it('recusa nome em branco', () => {
    expectFailure(baseDocument(), testCtx(), renameDocument({ name: '  ' }), 'INVALID_INPUT');
  });
});

describe('project/create', () => {
  it('cria no fim da lista, com position sem buracos', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const { document, data } = apply(
      doc,
      ctx,
      createProject({ code: 'PROJ_C', name: 'Projeto C', description: 'Terceiro' }),
    );

    const project = document.projects[2]!;
    expect(project.id).toBe(data.projectId);
    expect(project.code).toBe('PROJ_C');
    expect(project.position).toBe(2);
    expect(project.createdAt).toBe(T0);
    expect(project.description).toBe('Terceiro');
    expect(validateDocument(document).ok).toBe(true);
  });

  it('recusa código inválido, duplicado, nome e descrição em branco', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    expectFailure(doc, ctx, createProject({ code: 'proj-c', name: 'C' }), 'INVALID_INPUT');
    expectFailure(doc, ctx, createProject({ code: 'PROJ_A', name: 'C' }), 'DUPLICATE_CODE');
    expectFailure(doc, ctx, createProject({ code: 'PROJ_C', name: ' ' }), 'INVALID_INPUT');
    expectFailure(
      doc,
      ctx,
      createProject({ code: 'PROJ_C', name: 'C', description: ' ' }),
      'INVALID_INPUT',
    );
  });

  it('desfaz e refaz devolvendo o documento idêntico', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const criado = apply(doc, ctx, createProject({ code: 'PROJ_C', name: 'Projeto C' }));

    const desfeito = apply(criado.document, ctx, criado.result.inverse);
    expect(desfeito.document).toEqual(doc);

    const refeito = apply(desfeito.document, ctx, desfeito.result.inverse);
    expect(refeito.document).toEqual(criado.document);
  });

  it('recusa desfazer se o projeto deixou de ser o último ou já tem matrizes', () => {
    const ctx = testCtx();
    const criado = apply(baseDocument(), ctx, createProject({ code: 'PROJ_C', name: 'Projeto C' }));

    expectFailure(baseDocument(), ctx, criado.result.inverse, 'NOT_FOUND');

    // Deixou de ser o último: remover abriria um buraco nas posições.
    const comOutro = apply(criado.document, ctx, createProject({ code: 'PROJ_D', name: 'D' }))
      .document;
    expectFailure(comOutro, ctx, criado.result.inverse, 'INVALID_INPUT');

    // Já tem matriz: remover levaria a matriz junto, em silêncio.
    const comMatriz = apply(
      criado.document,
      ctx,
      createMatrix({
        projectId: criado.data.projectId,
        code: 'MTZ_C',
        name: 'Matriz do C',
        x: { levels: [{ variableId: IDS.score }] },
        y: { levels: [{ variableId: IDS.restritivo }] },
      }),
    ).document;
    expectFailure(comMatriz, ctx, criado.result.inverse, 'INVALID_INPUT');
  });
});

describe('project/update e project/archive', () => {
  it('atualiza nome e descrição com a semântica de três estados', () => {
    const ctx = testCtx();
    const doc = baseDocument();

    const comDescricao = apply(
      doc,
      ctx,
      updateProject({ projectId: IDS.projectA, description: 'Cartões' }),
    ).document;
    expect(comDescricao.projects[0]!.name).toBe('Projeto A');
    expect(comDescricao.projects[0]!.description).toBe('Cartões');

    const renomeado = apply(
      comDescricao,
      ctx,
      updateProject({ projectId: IDS.projectA, name: 'Projeto A+' }),
    );
    expect(renomeado.document.projects[0]!.name).toBe('Projeto A+');
    expect(renomeado.document.projects[0]!.description).toBe('Cartões');

    const limpo = apply(
      renomeado.document,
      ctx,
      updateProject({ projectId: IDS.projectA, description: null }),
    ).document;
    expect('description' in limpo.projects[0]!).toBe(false);

    const desfeito = apply(renomeado.document, ctx, renomeado.result.inverse);
    expect(desfeito.document).toEqual(comDescricao);
  });

  it('arquiva e desarquiva devolvendo o carimbo exato', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const arquivado = apply(doc, ctx, archiveProject({ projectId: IDS.projectA }));
    expect(arquivado.document.projects[0]!.archivedAt).toBe(T0);

    const desfeito = apply(arquivado.document, ctx, arquivado.result.inverse);
    expect(desfeito.document).toEqual(doc);

    // Refazer devolve o **mesmo** carimbo, ainda que o relógio tenha andado.
    ctx.advance(60_000);
    const refeito = apply(desfeito.document, ctx, desfeito.result.inverse);
    expect(refeito.document).toEqual(arquivado.document);
  });

  it('recusa projeto inexistente', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    expectFailure(doc, ctx, updateProject({ projectId: 'fantasma' }), 'NOT_FOUND');
    expectFailure(doc, ctx, archiveProject({ projectId: 'fantasma' }), 'NOT_FOUND');
    expectFailure(doc, ctx, updateProject({ projectId: IDS.projectA, name: ' ' }), 'INVALID_INPUT');
  });
});

describe('matrix/updateMeta e matrix/archive', () => {
  it('edita metadados sem tocar nas versões, e o inverso restaura', () => {
    const ctx = testCtx();
    const criada = createTestMatrix(baseDocument(), ctx);
    const matrixId = criada.data.matrixId;

    const editada = apply(
      criada.document,
      ctx,
      updateMatrixMeta({ matrixId, name: 'Matriz renomeada', description: 'Nova descrição' }),
    );
    expect(editada.document.matrices[0]!.name).toBe('Matriz renomeada');
    expect(editada.document.matrices[0]!.description).toBe('Nova descrição');
    expect(editada.document.matrices[0]!.versions).toEqual(criada.document.matrices[0]!.versions);

    const desfeito = apply(editada.document, ctx, editada.result.inverse);
    expect(desfeito.document).toEqual(criada.document);
  });

  it('arquiva a matriz e desfaz o arquivamento', () => {
    const ctx = testCtx();
    const criada = createTestMatrix(baseDocument(), ctx);
    const arquivada = apply(criada.document, ctx, archiveMatrix({ matrixId: criada.data.matrixId }));
    expect(arquivada.document.matrices[0]!.archivedAt).toBe(T0);

    const desfeito = apply(arquivada.document, ctx, arquivada.result.inverse);
    expect(desfeito.document).toEqual(criada.document);

    ctx.advance(60_000);
    const refeito = apply(desfeito.document, ctx, desfeito.result.inverse);
    expect(refeito.document).toEqual(arquivada.document);
  });

  it('recusa matriz inexistente e nome em branco', () => {
    const ctx = testCtx();
    const criada = createTestMatrix(baseDocument(), ctx);
    expectFailure(criada.document, ctx, updateMatrixMeta({ matrixId: 'fantasma' }), 'NOT_FOUND');
    expectFailure(criada.document, ctx, archiveMatrix({ matrixId: 'fantasma' }), 'NOT_FOUND');
    expectFailure(
      criada.document,
      ctx,
      updateMatrixMeta({ matrixId: criada.data.matrixId, name: '  ' }),
      'INVALID_INPUT',
    );
  });
});
