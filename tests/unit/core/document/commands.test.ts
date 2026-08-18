import { describe, expect, it } from 'vitest';
import {
  archiveMatrix,
  archiveProject,
  createProject,
  renameDocument,
  setMatrixTags,
  updateMatrixMeta,
  updateProject,
} from '@/core/document/commands';
import { validateDocument } from '@/core/document/validate';
import { createCatalogItem } from '@/core/library/catalog';
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

  it('RN-GOV-09: define, sobrescreve e apaga a vigência da fundação, com a mesma semântica de três estados', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    expect(doc.projects[0]!.foundationEffectiveFrom).toBeUndefined();

    const definida = apply(
      doc,
      ctx,
      updateProject({ projectId: IDS.projectA, foundationEffectiveFrom: '2024-01-01T00:00:00.000Z' }),
    );
    expect(definida.document.projects[0]!.foundationEffectiveFrom).toBe('2024-01-01T00:00:00.000Z');

    const inalterada = apply(definida.document, ctx, updateProject({ projectId: IDS.projectA, name: 'Projeto A' }));
    expect(inalterada.document.projects[0]!.foundationEffectiveFrom).toBe('2024-01-01T00:00:00.000Z');

    const apagada = apply(
      inalterada.document,
      ctx,
      updateProject({ projectId: IDS.projectA, foundationEffectiveFrom: null }),
    );
    expect('foundationEffectiveFrom' in apagada.document.projects[0]!).toBe(false);

    const desfeito = apply(apagada.document, ctx, apagada.result.inverse);
    expect(desfeito.document.projects[0]!.foundationEffectiveFrom).toBe('2024-01-01T00:00:00.000Z');

    expectFailure(
      doc,
      ctx,
      updateProject({ projectId: IDS.projectA, foundationEffectiveFrom: '01/01/2024' }),
      'INVALID_INPUT',
    );
  });

  it('docs/14 §8 (S38): define, sobrescreve e apaga os contatos do factoryTemplate, três estados', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    expect(doc.projects[0]!.factoryTemplate).toBeUndefined();

    const definidos = apply(
      doc,
      ctx,
      updateProject({
        projectId: IDS.projectA,
        factoryContacts: [{ name: 'Equipe de Políticas', role: 'Solicitante', email: 'x@exemplo.com' }],
      }),
    );
    expect(definidos.document.projects[0]!.factoryTemplate).toEqual({
      boilerplate: { blocks: [] },
      contacts: [{ name: 'Equipe de Políticas', role: 'Solicitante', email: 'x@exemplo.com' }],
    });

    const inalterados = apply(definidos.document, ctx, updateProject({ projectId: IDS.projectA, name: 'Projeto A' }));
    expect(inalterados.document.projects[0]!.factoryTemplate?.contacts).toHaveLength(1);

    const sobrescritos = apply(
      inalterados.document,
      ctx,
      updateProject({ projectId: IDS.projectA, factoryContacts: [{ name: 'Compliance' }] }),
    );
    expect(sobrescritos.document.projects[0]!.factoryTemplate?.contacts).toEqual([{ name: 'Compliance' }]);

    const apagados = apply(sobrescritos.document, ctx, updateProject({ projectId: IDS.projectA, factoryContacts: null }));
    // Sem boilerplate e sem contatos, `factoryTemplate` some inteiro (vazio é ausência).
    expect(apagados.document.projects[0]!.factoryTemplate).toBeUndefined();

    const desfeito = apply(apagados.document, ctx, apagados.result.inverse);
    expect(desfeito.document.projects[0]!.factoryTemplate?.contacts).toEqual([{ name: 'Compliance' }]);

    expectFailure(
      doc,
      ctx,
      updateProject({ projectId: IDS.projectA, factoryContacts: [{ name: '   ' }] }),
      'INVALID_INPUT',
    );
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

/**
 * matrix/setTags — docs/08 §3, docs/03 §5/§9 I20. `REVISAR` já existe no
 * catálogo de `baseDocument()` (kind TAG, sem grupo); os demais são criados
 * inline nos testes que precisam de mais de uma tag.
 */
describe('matrix/setTags', () => {
  it('idempotente nos dois sentidos: adicionar tag presente não duplica, remover ausente não falha', () => {
    const ctx = testCtx();
    const criada = createTestMatrix(baseDocument(), ctx);
    const matrixId = criada.data.matrixId;

    const marcada = apply(criada.document, ctx, setMatrixTags({ matrixId, add: ['REVISAR'] }));
    expect(marcada.document.matrices[0]!.tags).toEqual(['REVISAR']);

    // Adicionar de novo a mesma tag: sem duplicar.
    const denovo = apply(marcada.document, ctx, setMatrixTags({ matrixId, add: ['REVISAR'] }));
    expect(denovo.document.matrices[0]!.tags).toEqual(['REVISAR']);

    // Remover uma tag que a matriz não tem: sem falhar, sem alterar nada.
    const removeAusente = apply(denovo.document, ctx, setMatrixTags({ matrixId, remove: ['NUNCA_TEVE'] }));
    expect(removeAusente.document.matrices[0]!.tags).toEqual(['REVISAR']);

    // Remover a mesma tag duas vezes: idempotente também na remoção.
    const semTag = apply(removeAusente.document, ctx, setMatrixTags({ matrixId, remove: ['REVISAR'] }));
    expect(semTag.document.matrices[0]!.tags).toBeUndefined();
    const denovoSemTag = apply(semTag.document, ctx, setMatrixTags({ matrixId, remove: ['REVISAR'] }));
    expect(denovoSemTag.document.matrices[0]!.tags).toBeUndefined();
  });

  it('omite o campo quando a lista de tags esvazia', () => {
    const ctx = testCtx();
    const criada = createTestMatrix(baseDocument(), ctx);
    const matrixId = criada.data.matrixId;
    expect('tags' in criada.document.matrices[0]!).toBe(false);

    const marcada = apply(criada.document, ctx, setMatrixTags({ matrixId, add: ['REVISAR'] }));
    expect(marcada.document.matrices[0]!.tags).toEqual(['REVISAR']);

    const limpa = apply(marcada.document, ctx, setMatrixTags({ matrixId, remove: ['REVISAR'] }));
    expect('tags' in limpa.document.matrices[0]!).toBe(false);
  });

  it('inverso round-trip: desfazer devolve exatamente o mesmo conjunto de tags', () => {
    const ctx = testCtx();
    // Base com uma segunda tag disponível, para exercitar add+remove
    // combinados na mesma chamada.
    const semaforo = apply(
      baseDocument(),
      ctx,
      createCatalogItem({ kind: 'TAG', code: 'SEMAFORO', label: 'Semáforo' }),
    );
    const criada = createTestMatrix(semaforo.document, ctx);
    const matrixId = criada.data.matrixId;
    const base = apply(
      criada.document,
      ctx,
      setMatrixTags({ matrixId, add: ['REVISAR', 'SEMAFORO'] }),
    );
    expect(new Set(base.document.matrices[0]!.tags)).toEqual(new Set(['REVISAR', 'SEMAFORO']));

    const alterado = apply(base.document, ctx, setMatrixTags({ matrixId, add: ['SEMAFORO'], remove: ['REVISAR'] }));
    expect(new Set(alterado.document.matrices[0]!.tags)).toEqual(new Set(['SEMAFORO']));

    const desfeito = apply(alterado.document, ctx, alterado.result.inverse);
    expect(new Set(desfeito.document.matrices[0]!.tags ?? [])).toEqual(
      new Set(base.document.matrices[0]!.tags ?? []),
    );

    const refeito = apply(desfeito.document, ctx, desfeito.result.inverse);
    expect(new Set(refeito.document.matrices[0]!.tags ?? [])).toEqual(
      new Set(alterado.document.matrices[0]!.tags ?? []),
    );
  });

  it('valida I20: recusa adicionar tag que não existe no catálogo', () => {
    const ctx = testCtx();
    const criada = createTestMatrix(baseDocument(), ctx);
    expectFailure(
      criada.document,
      ctx,
      setMatrixTags({ matrixId: criada.data.matrixId, add: ['NAO_EXISTE'] }),
      'TAG_NOT_FOUND',
    );
  });

  it('recusa matriz inexistente', () => {
    expectFailure(baseDocument(), testCtx(), setMatrixTags({ matrixId: 'fantasma', add: ['REVISAR'] }), 'NOT_FOUND');
  });

  it('emite MATRIX_TAGGED com { matrixId, added, removed }', () => {
    const ctx = testCtx();
    const criada = createTestMatrix(baseDocument(), ctx);
    const matrixId = criada.data.matrixId;
    const marcada = apply(criada.document, ctx, setMatrixTags({ matrixId, add: ['REVISAR'] }));
    expect(marcada.result.events).toHaveLength(1);
    expect(marcada.result.events[0]!.type).toBe('MATRIX_TAGGED');
    expect(marcada.result.events[0]!.payload).toEqual({ matrixId, added: ['REVISAR'], removed: [] });
  });

  it('CT-13 (docs/12 §3) — tags aplicadas por uma carga não apagam as marcadas manualmente', () => {
    const ctx = testCtx();
    let doc = baseDocument();
    for (const code of ['PRIORITARIA', 'CANAL_DIGITAL', 'CLUSTER_G4', 'RISCO_ALTO']) {
      doc = apply(doc, ctx, createCatalogItem({ kind: 'TAG', code, label: code })).document;
    }
    const criada = createTestMatrix(doc, ctx);
    const matrixId = criada.data.matrixId;

    // A matriz recebeu manualmente a tag "Prioritária".
    const manual = apply(criada.document, ctx, setMatrixTags({ matrixId, add: ['PRIORITARIA'] }));
    expect(manual.document.matrices[0]!.tags).toEqual(['PRIORITARIA']);

    // Uma carga aplica as tags de partição, sempre acrescentando.
    const carregada = apply(
      manual.document,
      ctx,
      setMatrixTags({ matrixId, add: ['CANAL_DIGITAL', 'CLUSTER_G4', 'RISCO_ALTO'] }),
    );

    const tags = carregada.document.matrices[0]!.tags ?? [];
    expect(new Set(tags)).toEqual(new Set(['PRIORITARIA', 'CANAL_DIGITAL', 'CLUSTER_G4', 'RISCO_ALTO']));
    expect(tags).toHaveLength(new Set(tags).size);
  });
});
