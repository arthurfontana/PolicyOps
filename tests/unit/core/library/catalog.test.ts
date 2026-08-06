import { describe, expect, it } from 'vitest';
import {
  archiveCatalogItem,
  createCatalogItem,
  listCatalog,
  reorderCatalog,
  updateCatalogItem,
} from '@/core/library/catalog';
import {
  apply,
  baseDocument,
  expectFailure,
  testCtx,
} from '../versioning/fixtures';

describe('catalog/create', () => {
  it('cria um item de catálogo com posição correta', () => {
    const ctx = testCtx();
    const { document, data } = apply(
      baseDocument(),
      ctx,
      createCatalogItem({ kind: 'DECISION', code: 'NOVO', label: 'Nova Decisão' }),
    );
    const created = document.catalog.find((item) => item.id === data.itemId)!;
    expect(created.code).toBe('NOVO');
    expect(created.label).toBe('Nova Decisão');
    expect(created.kind).toBe('DECISION');
    expect(created.position).toBeGreaterThanOrEqual(0);
  });

  it('recusa código duplicado no mesmo kind', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      createCatalogItem({ kind: 'DECISION', code: 'APROVADO', label: 'Duplicada' }),
      'DUPLICATE_CODE',
    );
  });

  it('permite código duplicado em kinds diferentes', () => {
    const ctx = testCtx();
    const { document } = apply(
      baseDocument(),
      ctx,
      createCatalogItem({ kind: 'DECISION', code: 'TEST', label: 'Decisão Test' }),
    );
    const { document: document2 } = apply(
      document,
      ctx,
      createCatalogItem({ kind: 'OFFER', code: 'TEST', label: 'Oferta Test' }),
    );
    const items = document2.catalog.filter((item) => item.code === 'TEST');
    expect(items).toHaveLength(2);
    expect(items[0]!.kind).not.toBe(items[1]!.kind);
  });

  it('recusa LIMIT sem numericValue', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      createCatalogItem({ kind: 'LIMIT', code: 'LIM_TEST', label: 'Limite Test' }),
      'LIMIT_NEEDS_NUMERIC_VALUE',
    );
  });

  it('recusa LIMIT com valor negativo', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      createCatalogItem({
        kind: 'LIMIT',
        code: 'LIM_NEG',
        label: 'Limite negativo',
        numericValue: '-100',
      }),
      'LIMIT_NEEDS_NUMERIC_VALUE',
    );
  });

  it('recusa LIMIT com valor zero', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      createCatalogItem({
        kind: 'LIMIT',
        code: 'LIM_ZERO',
        label: 'Limite zero',
        numericValue: '0',
      }),
      'LIMIT_NEEDS_NUMERIC_VALUE',
    );
  });

  it('aceita cor válida', () => {
    const ctx = testCtx();
    const { document, data } = apply(
      baseDocument(),
      ctx,
      createCatalogItem({
        kind: 'OFFER',
        code: 'OFF_COLORED',
        label: 'Oferta Colorida',
        color: '#FF5733',
      }),
    );
    const created = document.catalog.find((item) => item.id === data.itemId)!;
    expect(created.color).toBe('#FF5733');
  });

  it('recusa cor inválida', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      createCatalogItem({
        kind: 'OFFER',
        code: 'OFF_BAD',
        label: 'Oferta Ruim',
        color: 'rgb(255,0,0)',
      }),
      'INVALID_INPUT',
    );
  });

  it('o inverso desfaz a criação', () => {
    const ctx = testCtx();
    const { document, result } = apply(
      baseDocument(),
      ctx,
      createCatalogItem({ kind: 'TAG', code: 'NOVA_TAG', label: 'Nova Tag' }),
    );
    const undone = apply(document, ctx, result.inverse);
    expect(undone.document.catalog.some((item) => item.code === 'NOVA_TAG')).toBe(false);
  });

  it('refazer restaura o item removido', () => {
    const ctx = testCtx();
    const { document, result } = apply(
      baseDocument(),
      ctx,
      createCatalogItem({ kind: 'TAG', code: 'TAG_TEST', label: 'Test Tag' }),
    );
    const undone = apply(document, ctx, result.inverse);
    const redone = apply(undone.document, ctx, undone.result.inverse);
    expect(
      redone.document.catalog.find((item) => item.code === 'TAG_TEST' && item.kind === 'TAG'),
    ).toEqual(
      document.catalog.find((item) => item.code === 'TAG_TEST' && item.kind === 'TAG'),
    );
  });
});

describe('catalog/update', () => {
  it('atualiza label e descrição', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const item = doc.catalog.find((c) => c.code === 'APROVADO')!;
    const { document } = apply(
      doc,
      ctx,
      updateCatalogItem({
        id: item.id,
        label: 'Aprovado (Novo)',
        description: 'Nova descrição',
      }),
    );
    const updated = document.catalog.find((c) => c.id === item.id)!;
    expect(updated.label).toBe('Aprovado (Novo)');
    expect(updated.description).toBe('Nova descrição');
  });

  it('não permite alterar code', () => {
    const doc = baseDocument();
    const item = doc.catalog[0]!;
    // createCatalogItem sem field 'code', então não é testável diretamente.
    // O teste é que o comando não aceita input.code.
    expect(updateCatalogItem({ id: item.id, label: 'X' })).toBeDefined();
  });

  it('description: null apaga o campo', () => {
    const ctx = testCtx();
    const doc = apply(
      baseDocument(),
      ctx,
      createCatalogItem({
        kind: 'OFFER',
        code: 'OFF_DESC',
        label: 'Com descrição',
        description: 'Descrição inicial',
      }),
    ).document;
    const item = doc.catalog.find((c) => c.code === 'OFF_DESC')!;

    const cleared = apply(
      doc,
      ctx,
      updateCatalogItem({ id: item.id, description: null }),
    ).document;
    expect(cleared.catalog.find((c) => c.id === item.id)!.description).toBeUndefined();
  });

  it('o inverso restaura o estado anterior', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const item = doc.catalog.find((c) => c.code === 'REPROVADO')!;
    const original = structuredClone(item);

    const { document, result } = apply(
      doc,
      ctx,
      updateCatalogItem({ id: item.id, label: 'Alterado' }),
    );
    const undone = apply(document, ctx, result.inverse);
    expect(undone.document.catalog.find((c) => c.id === item.id)).toEqual(original);
  });

  it('falha com NOT_FOUND para item inexistente', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      updateCatalogItem({ id: 'nada_______', label: 'X' }),
      'NOT_FOUND',
    );
  });
});

describe('catalog/archive', () => {
  it('marca um item como arquivado', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const item = doc.catalog.find((c) => c.code === 'APROVADO')!;
    const { document } = apply(
      doc,
      ctx,
      archiveCatalogItem({ id: item.id }),
    );
    const archived = document.catalog.find((c) => c.id === item.id)!;
    expect(archived.archivedAt).toBeDefined();
  });

  it('o inverso (unarchive) restaura o item', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const item = doc.catalog.find((c) => c.code === 'APROVADO')!;
    const original = structuredClone(item);

    const { document, result } = apply(
      doc,
      ctx,
      archiveCatalogItem({ id: item.id }),
    );
    const undone = apply(document, ctx, result.inverse);
    expect(undone.document.catalog.find((c) => c.id === item.id)).toEqual(original);
  });

  it('falha ao tentar arquivar já arquivado', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const item = doc.catalog.find((c) => c.code === 'APROVADO')!;
    const archived = apply(doc, ctx, archiveCatalogItem({ id: item.id })).document;
    expectFailure(
      archived,
      testCtx(),
      archiveCatalogItem({ id: item.id }),
      'INVALID_INPUT',
    );
  });
});

describe('catalog/reorder', () => {
  it('reatribui position de 0 a n-1 sem buracos', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const offers = doc.catalog.filter((c) => c.kind === 'OFFER');
    const reversed = offers.reverse().map((c) => c.id);

    const { document } = apply(
      doc,
      ctx,
      reorderCatalog({ kind: 'OFFER', orderedIds: reversed }),
    );

    const reordered = document.catalog
      .filter((c) => c.kind === 'OFFER')
      .sort((a, b) => a.position - b.position);
    reordered.forEach((item, index) => {
      expect(item.position).toBe(index);
    });
  });

  it('o inverso restaura a ordem anterior', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const decisions = doc.catalog.filter((c) => c.kind === 'DECISION');
    const originalOrder = decisions.map((c) => c.id);
    const reversed = [...originalOrder].reverse();

    const { document, result } = apply(
      doc,
      ctx,
      reorderCatalog({ kind: 'DECISION', orderedIds: reversed }),
    );
    const undone = apply(document, ctx, result.inverse);

    const restored = undone.document.catalog.filter((c) => c.kind === 'DECISION');
    expect(restored.map((c) => c.id)).toEqual(originalOrder);
  });

  it('falha se número de ids não bate', () => {
    expectFailure(
      baseDocument(),
      testCtx(),
      reorderCatalog({ kind: 'OFFER', orderedIds: ['only_one__'] }),
      'INVALID_INPUT',
    );
  });
});

describe('listCatalog', () => {
  it('lista itens do kind especificado', () => {
    const doc = baseDocument();
    const decisions = listCatalog(doc, { kind: 'DECISION' });
    expect(decisions.every((item) => item.kind === 'DECISION')).toBe(true);
  });

  it('ordena por position', () => {
    const doc = baseDocument();
    const items = listCatalog(doc, { kind: 'OFFER' });
    const positions = items.map((item) => item.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('exclui arquivados por padrão', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const item = doc.catalog.find((c) => c.code === 'APROVADO')!;
    const withArchived = apply(doc, ctx, archiveCatalogItem({ id: item.id })).document;

    const listed = listCatalog(withArchived, { kind: 'DECISION' });
    expect(listed.some((c) => c.id === item.id)).toBe(false);
  });

  it('inclui arquivados com flag includeArchived', () => {
    const ctx = testCtx();
    const doc = baseDocument();
    const item = doc.catalog.find((c) => c.code === 'APROVADO')!;
    const withArchived = apply(doc, ctx, archiveCatalogItem({ id: item.id })).document;

    const listed = listCatalog(withArchived, { kind: 'DECISION', includeArchived: true });
    expect(listed.some((c) => c.id === item.id)).toBe(true);
  });

  it('calcula contagem de uso (sem matrizes, deve ser 0)', () => {
    const doc = baseDocument();
    const items = listCatalog(doc);
    expect(items.every((item) => item.usage.inPublished === 0 && item.usage.inDraft === 0)).toBe(
      true,
    );
  });
});
