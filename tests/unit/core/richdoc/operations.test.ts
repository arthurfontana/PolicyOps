import { describe, expect, it } from 'vitest';
import type { Block, RichDoc } from '@/core/document/schema';
import { DomainError } from '@/core/errors';
import {
  blockPlainText,
  emptyRichDoc,
  isBlockEmpty,
  listBlock,
  materializeBlocks,
  paragraphFromText,
  referencedAttachmentIds,
  richDocWithEmptyParagraph,
  sameBlockContent,
  tableBlock,
  textBlock,
} from '@/core/richdoc/model';
import {
  applyOp,
  applyOps,
  emptyTable,
  insertTableColumn,
  insertTableRow,
  mergeBlockBackward,
  moveBlockBy,
  pasteBlocksAt,
  removeTableColumn,
  removeTableRow,
  setBlockInlineText,
  setImageCaption,
  setListItemText,
  setTableCell,
  splitBlockAt,
  toggleMark,
  transformBlockTo,
  type RichDocOp,
} from '@/core/richdoc/operations';
import { inlineFromText, plainTextOf } from '@/core/richdoc/text';

/**
 * Operações de bloco e seus inversos — docs/14 §7, S34.
 *
 * A regra que estes testes exercem em toda operação: **aplicar e desaplicar
 * devolve o documento idêntico**. É dela que sai o undo/redo do editor
 * (docs/08 §1, regra 3), e é o que impede a perda de trabalho que é o modo de
 * falha central desta sessão.
 */

let sequence = 0;
const newId = (): string => {
  sequence += 1;
  return `blk${String(sequence).padStart(9, '0')}`;
};

function doc(...blocks: Block[]): RichDoc {
  return { blocks };
}

const base = (): RichDoc =>
  doc(
    textBlock('b1__________', 'heading1', inlineFromText('Bloqueios por dívida')),
    paragraphFromText('b2__________', 'Cliente com dívida acima de R$ 5.000 é reprovado.'),
    listBlock('b3__________', 'bulletList', [inlineFromText('Serasa'), inlineFromText('SPC')]),
  );

/** Aplica e desfaz, exigindo o documento original de volta. */
function roundTrip(source: RichDoc, op: RichDocOp): RichDoc {
  const applied = applyOp(source, op);
  const back = applyOp(applied.doc, applied.inverse);
  expect(back.doc).toEqual(source);
  return applied.doc;
}

describe('primitivas e inversos', () => {
  it('insertBlock entra na posição pedida e o inverso remove', () => {
    const next = roundTrip(base(), {
      kind: 'insertBlock',
      index: 1,
      block: paragraphFromText('novo________', 'Parágrafo novo'),
    });
    expect(next.blocks.map((block) => block.id)).toEqual([
      'b1__________',
      'novo________',
      'b2__________',
      'b3__________',
    ]);
  });

  it('removeBlock devolve o bloco na posição exata ao desfazer', () => {
    const next = roundTrip(base(), { kind: 'removeBlock', blockId: 'b2__________' });
    expect(next.blocks).toHaveLength(2);
  });

  it('moveBlock desfaz voltando para o índice de origem', () => {
    const next = roundTrip(base(), { kind: 'moveBlock', blockId: 'b3__________', toIndex: 0 });
    expect(next.blocks[0]?.id).toBe('b3__________');
  });

  it('replaceBlock troca o conteúdo e o inverso restaura o anterior', () => {
    const next = roundTrip(base(), {
      kind: 'replaceBlock',
      block: paragraphFromText('b2__________', 'Outro texto'),
    });
    expect(blockPlainText(next.blocks[1]!)).toBe('Outro texto');
  });

  it('spliceBlocks emenda uma faixa e o inverso repõe o que saiu', () => {
    const next = roundTrip(base(), {
      kind: 'spliceBlocks',
      index: 0,
      count: 2,
      blocks: [paragraphFromText('unico_______', 'Um só')],
    });
    expect(next.blocks).toHaveLength(2);
  });

  it('applyOps devolve os inversos na ordem contrária', () => {
    const source = base();
    const { doc: after, inverses } = applyOps(source, [
      { kind: 'removeBlock', blockId: 'b1__________' },
      { kind: 'moveBlock', blockId: 'b3__________', toIndex: 0 },
    ]);
    const { doc: back } = applyOps(after, inverses);
    expect(back).toEqual(source);
  });

  it('recusa bloco inexistente, índice inválido e id repetido', () => {
    expect(() => applyOp(base(), { kind: 'removeBlock', blockId: 'nada________' })).toThrow(DomainError);
    expect(() =>
      applyOp(base(), { kind: 'insertBlock', index: 99, block: paragraphFromText('x___________', 'x') }),
    ).toThrow(DomainError);
    expect(() =>
      applyOp(base(), { kind: 'insertBlock', index: 0, block: paragraphFromText('b1__________', 'x') }),
    ).toThrow(DomainError);
    expect(() => applyOp(base(), { kind: 'moveBlock', blockId: 'b1__________', toIndex: 9 })).toThrow(DomainError);
    expect(() => applyOp(base(), { kind: 'spliceBlocks', index: 2, count: 5, blocks: [] })).toThrow(DomainError);
  });

  it('replaceBlock recusa troca de tipo que exigiria converter o conteúdo', () => {
    expect(() =>
      applyOp(base(), { kind: 'replaceBlock', block: tableBlock('b2__________', ['a'], [['1']]) }),
    ).toThrow(DomainError);
  });

  it('não muta o documento recebido', () => {
    const source = base();
    const snapshot = structuredClone(source);
    applyOp(source, { kind: 'removeBlock', blockId: 'b1__________' });
    expect(source).toEqual(snapshot);
  });
});

describe('edição de conteúdo', () => {
  it('setBlockInlineText devolve `null` quando nada mudou', () => {
    const source = base();
    expect(setBlockInlineText(source, 'b2__________', inlineFromText('Cliente com dívida acima de R$ 5.000 é reprovado.'))).toBeNull();
    const op = setBlockInlineText(source, 'b2__________', inlineFromText('Outro'));
    expect(op).not.toBeNull();
    roundTrip(source, op!);
  });

  it('setListItemText edita um item e recusa índice fora da lista', () => {
    const source = base();
    const op = setListItemText(source, 'b3__________', 1, inlineFromText('Boa Vista'));
    const next = roundTrip(source, op!);
    expect(blockPlainText(next.blocks[2]!)).toBe('Serasa\nBoa Vista');
    expect(() => setListItemText(source, 'b3__________', 9, [])).toThrow(DomainError);
    expect(() => setListItemText(source, 'b2__________', 0, [])).toThrow(DomainError);
  });

  it('setTableCell edita cabeçalho (linha -1) e corpo, e recusa coordenada inválida', () => {
    const source = doc(tableBlock('t1__________', ['Faixa', 'Limite'], [['A', '1000']]));
    const header = roundTrip(source, setTableCell(source, 't1__________', -1, 0, 'Segmento')!);
    expect((header.blocks[0] as Extract<Block, { type: 'table' }>).header[0]).toBe('Segmento');
    const body = roundTrip(source, setTableCell(source, 't1__________', 0, 1, '2000')!);
    expect((body.blocks[0] as Extract<Block, { type: 'table' }>).rows[0]![1]).toBe('2000');
    expect(setTableCell(source, 't1__________', 0, 1, '1000')).toBeNull();
    expect(() => setTableCell(source, 't1__________', 0, 5, 'x')).toThrow(DomainError);
    expect(() => setTableCell(source, 't1__________', 7, 0, 'x')).toThrow(DomainError);
  });

  it('setImageCaption põe, troca e apaga a legenda', () => {
    const source = doc({ id: 'i1__________', type: 'image', attachmentId: 'att_________' });
    const comLegenda = roundTrip(source, setImageCaption(source, 'i1__________', ' Fluxo ')!);
    expect((comLegenda.blocks[0] as Extract<Block, { type: 'image' }>).caption).toBe('Fluxo');
    expect(setImageCaption(comLegenda, 'i1__________', 'Fluxo')).toBeNull();
    const semLegenda = applyOp(comLegenda, setImageCaption(comLegenda, 'i1__________', '  ')!);
    expect((semLegenda.doc.blocks[0] as Extract<Block, { type: 'image' }>).caption).toBeUndefined();
    // Legenda só existe em imagem: pedir legenda de parágrafo é erro de entrada.
    expect(() => setImageCaption(base(), 'b2__________', 'x')).toThrow(DomainError);
  });

  it('toggleMark marca trecho de parágrafo e de item de lista', () => {
    const source = base();
    const paragrafo = roundTrip(source, toggleMark(source, { blockId: 'b2__________', start: 0, end: 7, mark: 'bold' })!);
    expect((paragrafo.blocks[1] as Extract<Block, { text: unknown }>).text[0]).toMatchObject({ marks: ['bold'] });

    const item = roundTrip(
      source,
      toggleMark(source, { blockId: 'b3__________', itemIndex: 1, start: 0, end: 3, mark: 'italic' })!,
    );
    expect((item.blocks[2] as Extract<Block, { items: unknown[] }>).items[1]).toMatchObject([
      { text: 'SPC', marks: ['italic'] },
    ]);

    expect(() => toggleMark(source, { blockId: 'b3__________', itemIndex: 9, start: 0, end: 1, mark: 'bold' })).toThrow(
      DomainError,
    );
    const tabela = doc(tableBlock('t1__________', ['a'], [['b']]));
    expect(() => toggleMark(tabela, { blockId: 't1__________', start: 0, end: 1, mark: 'bold' })).toThrow(DomainError);
  });
});

describe('Enter — splitBlockAt', () => {
  it('divide um parágrafo em dois, com o mesmo tipo', () => {
    const source = base();
    const next = roundTrip(source, splitBlockAt(source, { blockId: 'b2__________', offset: 7 }, newId));
    expect(next.blocks.map(blockPlainText).slice(0, 3)).toEqual([
      'Bloqueios por dívida',
      'Cliente',
      ' com dívida acima de R$ 5.000 é reprovado.',
    ]);
  });

  it('dividir um título produz parágrafo na segunda metade', () => {
    const source = base();
    const next = applyOp(source, splitBlockAt(source, { blockId: 'b1__________', offset: 9 }, newId)).doc;
    expect(next.blocks[0]!.type).toBe('heading1');
    expect(next.blocks[1]!.type).toBe('paragraph');
  });

  it('divide um item de lista em dois itens do mesmo bloco', () => {
    const source = base();
    const next = roundTrip(source, splitBlockAt(source, { blockId: 'b3__________', offset: 3, itemIndex: 0 }, newId));
    expect(blockPlainText(next.blocks[2]!)).toBe('Ser\nasa\nSPC');
    expect(() => splitBlockAt(source, { blockId: 'b3__________', offset: 0, itemIndex: 9 }, newId)).toThrow(DomainError);
  });

  it('em tabela e imagem, Enter cria um parágrafo depois do bloco', () => {
    const source = doc(tableBlock('t1__________', ['a'], [['b']]));
    const next = roundTrip(source, splitBlockAt(source, { blockId: 't1__________', offset: 0 }, newId));
    expect(next.blocks[1]!.type).toBe('paragraph');
  });
});

describe('Backspace — mergeBlockBackward', () => {
  it('funde o parágrafo com o bloco de texto anterior', () => {
    const source = doc(paragraphFromText('p1__________', 'Uma frase'), paragraphFromText('p2__________', ' e outra'));
    const next = roundTrip(source, mergeBlockBackward(source, { blockId: 'p2__________' }, newId)!);
    expect(next.blocks).toHaveLength(1);
    expect(blockPlainText(next.blocks[0]!)).toBe('Uma frase e outra');
  });

  it('funde o parágrafo com o último item da lista anterior', () => {
    const source = doc(
      listBlock('l1__________', 'bulletList', [inlineFromText('Serasa')]),
      paragraphFromText('p1__________', ' e SPC'),
    );
    const next = roundTrip(source, mergeBlockBackward(source, { blockId: 'p1__________' }, newId)!);
    expect(blockPlainText(next.blocks[0]!)).toBe('Serasa e SPC');
  });

  it('tira o formato antes de fundir: título vira parágrafo', () => {
    const source = base();
    const next = roundTrip(source, mergeBlockBackward(source, { blockId: 'b1__________' }, newId)!);
    expect(next.blocks[0]!.type).toBe('paragraph');
    expect(blockPlainText(next.blocks[0]!)).toBe('Bloqueios por dívida');
  });

  it('funde item de lista com o item anterior', () => {
    const source = base();
    const next = roundTrip(source, mergeBlockBackward(source, { blockId: 'b3__________', itemIndex: 1 }, newId)!);
    expect(blockPlainText(next.blocks[2]!)).toBe('SerasaSPC');
  });

  it('no primeiro item, a lista vira parágrafo e o resto continua lista', () => {
    const source = base();
    const next = roundTrip(source, mergeBlockBackward(source, { blockId: 'b3__________', itemIndex: 0 }, newId)!);
    expect(next.blocks[2]!.type).toBe('paragraph');
    expect(blockPlainText(next.blocks[2]!)).toBe('Serasa');
    expect(next.blocks[3]!.type).toBe('bulletList');
  });

  it('lista de um item só vira parágrafo e some da lista', () => {
    const source = doc(listBlock('l1__________', 'numberList', [inlineFromText('Único')]));
    const next = applyOp(source, mergeBlockBackward(source, { blockId: 'l1__________', itemIndex: 0 }, newId)!).doc;
    expect(next.blocks).toHaveLength(1);
    expect(next.blocks[0]!.type).toBe('paragraph');
  });

  it('devolve `null` quando não há o que fundir', () => {
    const source = doc(paragraphFromText('p1__________', 'Primeiro'));
    expect(mergeBlockBackward(source, { blockId: 'p1__________' }, newId)).toBeNull();

    const depoisDeImagem = doc(
      { id: 'i1__________', type: 'image', attachmentId: 'att_________' },
      paragraphFromText('p1__________', 'Texto'),
    );
    expect(mergeBlockBackward(depoisDeImagem, { blockId: 'p1__________' }, newId)).toBeNull();
    expect(mergeBlockBackward(depoisDeImagem, { blockId: 'i1__________' }, newId)).toBeNull();
    expect(mergeBlockBackward(base(), { blockId: 'b3__________', itemIndex: 9 }, newId)).toBeNull();
  });
});

describe('transformBlockTo', () => {
  it('troca entre tipos de texto mantendo o id — é o mesmo bloco com outro formato', () => {
    const source = base();
    const next = roundTrip(source, transformBlockTo(source, { blockId: 'b2__________', type: 'callout' }, newId)!);
    expect(next.blocks[1]!.id).toBe('b2__________');
    expect(next.blocks[1]!.type).toBe('callout');
  });

  it('texto vira lista de um item e lista vira um bloco por item', () => {
    const source = base();
    const lista = applyOp(source, transformBlockTo(source, { blockId: 'b2__________', type: 'bulletList' }, newId)!).doc;
    expect(lista.blocks[1]!.type).toBe('bulletList');

    const paragrafos = roundTrip(source, transformBlockTo(source, { blockId: 'b3__________', type: 'paragraph' }, newId)!);
    expect(paragrafos.blocks.slice(2).map(blockPlainText)).toEqual(['Serasa', 'SPC']);
  });

  it('troca entre tipos de lista mantém o bloco e os itens', () => {
    const source = base();
    const next = roundTrip(source, transformBlockTo(source, { blockId: 'b3__________', type: 'numberList' }, newId)!);
    expect(next.blocks[2]).toMatchObject({ id: 'b3__________', type: 'numberList' });
  });

  it('lista vazia vira um bloco de texto vazio, nunca zero blocos', () => {
    const source = doc(listBlock('l1__________', 'bulletList', []));
    const next = applyOp(source, transformBlockTo(source, { blockId: 'l1__________', type: 'paragraph' }, newId)!).doc;
    expect(next.blocks).toHaveLength(1);
    expect(isBlockEmpty(next.blocks[0]!)).toBe(true);
  });

  it('devolve `null` para o mesmo tipo e recusa tabela/imagem', () => {
    const source = base();
    expect(transformBlockTo(source, { blockId: 'b2__________', type: 'paragraph' }, newId)).toBeNull();
    const tabela = doc(tableBlock('t1__________', ['a'], [['b']]));
    expect(() => transformBlockTo(tabela, { blockId: 't1__________', type: 'paragraph' }, newId)).toThrow(DomainError);
  });
});

describe('mover e colar', () => {
  it('moveBlockBy anda uma posição e trava nas bordas', () => {
    const source = base();
    const next = roundTrip(source, moveBlockBy(source, 'b2__________', -1)!);
    expect(next.blocks[0]!.id).toBe('b2__________');
    expect(moveBlockBy(source, 'b1__________', -1)).toBeNull();
    expect(moveBlockBy(source, 'b3__________', 1)).toBeNull();
  });

  it('colar num bloco vazio substitui o bloco; num bloco com texto, entra depois', () => {
    const vazio = doc(paragraphFromText('p1__________', ''));
    const colado = materializeBlocks([{ type: 'paragraph', text: inlineFromText('Colado') }], newId);
    const substituido = roundTrip(vazio, pasteBlocksAt(vazio, 'p1__________', colado)!);
    expect(substituido.blocks).toHaveLength(1);
    expect(blockPlainText(substituido.blocks[0]!)).toBe('Colado');

    const source = base();
    const depois = roundTrip(source, pasteBlocksAt(source, 'b2__________', colado)!);
    expect(depois.blocks.map(blockPlainText)[2]).toBe('Colado');
  });

  it('colar sem bloco de referência acrescenta no fim, e colar nada não é operação', () => {
    const source = base();
    const colado = materializeBlocks([{ type: 'paragraph', text: inlineFromText('Fim') }], newId);
    const next = roundTrip(source, pasteBlocksAt(source, null, colado)!);
    expect(blockPlainText(next.blocks[next.blocks.length - 1]!)).toBe('Fim');
    expect(pasteBlocksAt(source, null, [])).toBeNull();
  });

  it('colar depois de uma imagem nunca a substitui', () => {
    const source = doc({ id: 'i1__________', type: 'image', attachmentId: 'att_________' });
    const colado = materializeBlocks([{ type: 'paragraph', text: inlineFromText('Legenda solta') }], newId);
    const next = applyOp(source, pasteBlocksAt(source, 'i1__________', colado)!).doc;
    expect(next.blocks).toHaveLength(2);
    expect(next.blocks[0]!.type).toBe('image');
  });
});

describe('estrutura de tabela', () => {
  const tabela = (): RichDoc => doc(tableBlock('t1__________', ['Faixa', 'Limite'], [['A', '1000']]));

  it('adiciona e remove linha', () => {
    const source = tabela();
    const comLinha = roundTrip(source, insertTableRow(source, 't1__________'));
    expect((comLinha.blocks[0] as Extract<Block, { type: 'table' }>).rows).toHaveLength(2);
    const semLinha = roundTrip(source, removeTableRow(source, 't1__________', 0)!);
    expect((semLinha.blocks[0] as Extract<Block, { type: 'table' }>).rows).toHaveLength(0);
    expect(removeTableRow(source, 't1__________', 9)).toBeNull();
  });

  it('adiciona e remove coluna, mantendo a tabela retangular', () => {
    const source = tabela();
    const comColuna = roundTrip(source, insertTableColumn(source, 't1__________'));
    const bloco = comColuna.blocks[0] as Extract<Block, { type: 'table' }>;
    expect(bloco.header).toHaveLength(3);
    expect(bloco.rows[0]).toHaveLength(3);

    const semColuna = roundTrip(source, removeTableColumn(source, 't1__________', 1)!);
    expect((semColuna.blocks[0] as Extract<Block, { type: 'table' }>).header).toEqual(['Faixa']);
  });

  it('nunca deixa a tabela sem coluna nenhuma', () => {
    const source = doc(tableBlock('t1__________', ['Única'], [['x']]));
    expect(removeTableColumn(source, 't1__________', 0)).toBeNull();
  });

  it('recusa operação de tabela em bloco que não é tabela', () => {
    expect(() => insertTableRow(base(), 'b2__________')).toThrow(DomainError);
  });

  it('emptyTable nasce com cabeçalho e células vazias', () => {
    const table = emptyTable(newId, 3, 1) as Extract<Block, { type: 'table' }>;
    expect(table.header).toHaveLength(3);
    expect(table.rows).toEqual([['', '', '']]);
  });
});

describe('modelo', () => {
  it('richDocWithEmptyParagraph nasce com um parágrafo vazio', () => {
    const inicial = richDocWithEmptyParagraph(newId);
    expect(inicial.blocks).toHaveLength(1);
    expect(isBlockEmpty(inicial.blocks[0]!)).toBe(true);
  });

  it('blockPlainText resume cada tipo e imagem nunca é "vazia"', () => {
    expect(blockPlainText(tableBlock('t___________', ['a', 'b'], [['1', '2']]))).toBe('a\tb\n1\t2');
    expect(blockPlainText({ id: 'i___________', type: 'image', attachmentId: 'att_________' })).toBe('');
    expect(isBlockEmpty({ id: 'i___________', type: 'image', attachmentId: 'att_________' })).toBe(false);
  });

  it('sameBlockContent ignora o id e enxerga a forma canônica do texto', () => {
    const a = textBlock('a___________', 'paragraph', [{ text: 'oi' }, { text: '' }]);
    const b = textBlock('b___________', 'paragraph', [{ text: 'oi' }]);
    expect(sameBlockContent(a, b)).toBe(true);
    expect(plainTextOf((a as Extract<Block, { text: never[] }>).text)).toBe('oi');
  });

  it('referencedAttachmentIds lista só os blocos de imagem', () => {
    const source = doc(
      paragraphFromText('p1__________', 'x'),
      { id: 'i1__________', type: 'image', attachmentId: 'att1________' },
      { id: 'i2__________', type: 'image', attachmentId: 'att2________', caption: 'Fluxo' },
    );
    expect(referencedAttachmentIds(source)).toEqual(['att1________', 'att2________']);
  });

  it('materializeBlocks carimba id em cada tipo de rascunho de bloco', () => {
    const blocks = materializeBlocks(
      [
        { type: 'paragraph', text: inlineFromText('p') },
        { type: 'bulletList', items: [inlineFromText('i')] },
        { type: 'table', header: ['h'], rows: [['c']] },
        { type: 'image', attachmentId: 'att_________', caption: 'legenda' },
      ],
      newId,
    );
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'bulletList', 'table', 'image']);
    expect(new Set(blocks.map((block) => block.id)).size).toBe(4);
  });
});

describe('guardas de tipo das intenções', () => {
  it('editar texto simples recusa lista, tabela e imagem', () => {
    const lista = doc(listBlock('l___________', 'bulletList', [inlineFromText('x')]));
    expect(() => setBlockInlineText(lista, 'l___________', inlineFromText('y'))).toThrow(DomainError);
  });

  it('emptyRichDoc é um documento sem bloco nenhum', () => {
    expect(emptyRichDoc()).toEqual({ blocks: [] });
  });
});
