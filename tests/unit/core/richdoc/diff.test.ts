import { describe, expect, it } from 'vitest';
import type { Block, RichDoc } from '@/core/document/schema';
import { describeBlockChange, diffRichDoc } from '@/core/richdoc/diff';
import { listBlock, paragraphFromText, tableBlock, textBlock } from '@/core/richdoc/model';
import { inlineFromText } from '@/core/richdoc/text';

/**
 * Diff por bloco — docs/14 §7 e a decisão da sessão (DEC-GOV-029): **mover não
 * é remover + adicionar**. O `id` do bloco é estável por contrato, então
 * reordenar dois parágrafos precisa aparecer como dois `MOVED`, e não como
 * quatro linhas de "apagou e criou" que obrigariam a reler texto que não mudou.
 */

function doc(...blocks: Block[]): RichDoc {
  return { blocks };
}

const p = (id: string, text: string): Block => paragraphFromText(id.padEnd(12, '_'), text);

describe('diffRichDoc', () => {
  it('acha adicionado, removido e alterado por id', () => {
    const before = doc(p('a', 'Um'), p('b', 'Dois'), p('c', 'Três'));
    const after = doc(p('a', 'Um'), p('b', 'Dois alterado'), p('d', 'Quatro'));
    const diff = diffRichDoc(before, after);

    expect(diff.totals).toEqual({ ADDED: 1, REMOVED: 1, CHANGED: 1, MOVED: 0, UNCHANGED: 1 });
    expect(diff.hasChanges).toBe(true);
    const byId = new Map(diff.changes.map((change) => [change.blockId, change]));
    expect(byId.get('a___________')!.kind).toBe('UNCHANGED');
    expect(byId.get('b___________')!.kind).toBe('CHANGED');
    expect(byId.get('c___________')!.kind).toBe('REMOVED');
    expect(byId.get('d___________')!.kind).toBe('ADDED');
  });

  it('bloco que só trocou de lugar é MOVED, nunca removido + adicionado', () => {
    const before = doc(p('a', 'Um'), p('b', 'Dois'), p('c', 'Três'));
    const after = doc(p('c', 'Três'), p('a', 'Um'), p('b', 'Dois'));
    const diff = diffRichDoc(before, after);

    expect(diff.totals.REMOVED).toBe(0);
    expect(diff.totals.ADDED).toBe(0);
    expect(diff.totals.MOVED).toBeGreaterThan(0);
    expect(diff.changes.find((change) => change.blockId === 'c___________')).toMatchObject({
      kind: 'MOVED',
      indexBefore: 2,
      indexAfter: 0,
    });
  });

  it('conteúdo e posição mudando é CHANGED com `moved`', () => {
    const before = doc(p('a', 'Um'), p('b', 'Dois'));
    const after = doc(p('b', 'Dois alterado'), p('a', 'Um'));
    const change = diffRichDoc(before, after).changes.find((candidate) => candidate.blockId === 'b___________');
    expect(change).toMatchObject({ kind: 'CHANGED', moved: true });
  });

  it('remover o primeiro bloco não faz os seguintes contarem como movidos', () => {
    const before = doc(p('a', 'Um'), p('b', 'Dois'), p('c', 'Três'));
    const after = doc(p('b', 'Dois'), p('c', 'Três'));
    const diff = diffRichDoc(before, after);
    expect(diff.totals).toEqual({ ADDED: 0, REMOVED: 1, CHANGED: 0, MOVED: 0, UNCHANGED: 2 });
  });

  it('bloco com o mesmo texto e id diferente é adicionado + removido — sem adivinhação', () => {
    const diff = diffRichDoc(doc(p('a', 'Igual')), doc(p('z', 'Igual')));
    expect(diff.totals).toMatchObject({ ADDED: 1, REMOVED: 1, CHANGED: 0, UNCHANGED: 0 });
  });

  it('lado ausente conta como especificação vazia', () => {
    expect(diffRichDoc(undefined, doc(p('a', 'Novo'))).totals.ADDED).toBe(1);
    expect(diffRichDoc(doc(p('a', 'Sumiu')), undefined).totals.REMOVED).toBe(1);
    expect(diffRichDoc(undefined, undefined)).toMatchObject({ changes: [], hasChanges: false });
  });

  it('enxerga mudança de tipo, de item de lista e de célula de tabela', () => {
    const antes = doc(
      textBlock('t___________', 'paragraph', inlineFromText('Título')),
      listBlock('l___________', 'bulletList', [inlineFromText('Serasa')]),
      tableBlock('g___________', ['Faixa'], [['A']]),
    );
    const depois = doc(
      textBlock('t___________', 'heading1', inlineFromText('Título')),
      listBlock('l___________', 'bulletList', [inlineFromText('Serasa'), inlineFromText('SPC')]),
      tableBlock('g___________', ['Faixa'], [['B']]),
    );
    expect(diffRichDoc(antes, depois).totals.CHANGED).toBe(3);
  });

  it('marca aplicada ao texto conta como alteração; espaço em branco canônico não', () => {
    const comMarca = doc(textBlock('t___________', 'paragraph', [{ text: 'Regra', marks: ['bold'] }]));
    const semMarca = doc(textBlock('t___________', 'paragraph', [{ text: 'Regra' }]));
    expect(diffRichDoc(semMarca, comMarca).totals.CHANGED).toBe(1);

    const fragmentado = doc(textBlock('t___________', 'paragraph', [{ text: 'Re' }, { text: 'gra' }]));
    expect(diffRichDoc(semMarca, fragmentado).totals.UNCHANGED).toBe(1);
  });

  it('remoção sai na lista logo depois do bloco que a antecedia', () => {
    const before = doc(p('a', 'Um'), p('b', 'Dois'), p('c', 'Três'));
    const after = doc(p('a', 'Um'), p('c', 'Três'));
    const ordem = diffRichDoc(before, after).changes.map((change) => change.blockId);
    expect(ordem).toEqual(['a___________', 'b___________', 'c___________']);
  });

  it('remoção no começo do documento abre a lista', () => {
    const before = doc(p('a', 'Um'), p('b', 'Dois'));
    const after = doc(p('b', 'Dois'));
    expect(diffRichDoc(before, after).changes[0]).toMatchObject({ blockId: 'a___________', kind: 'REMOVED' });
  });
});

describe('describeBlockChange', () => {
  it('resume cada tipo de mudança em uma frase', () => {
    const before = doc(p('a', 'Texto antigo'), p('b', 'Fica'));
    const after = doc(p('b', 'Fica'), p('c', 'Texto novo'));
    const frases = diffRichDoc(before, after).changes.map(describeBlockChange);
    expect(frases).toContain('Bloco removido: Texto antigo');
    expect(frases).toContain('Bloco novo: Texto novo');
    expect(frases).toContain('Fica');
  });

  it('corta o trecho longo e nomeia o bloco vazio', () => {
    const longo = 'x'.repeat(120);
    const [change] = diffRichDoc(doc(), doc(p('a', longo))).changes;
    expect(describeBlockChange(change!)).toMatch(/…$/);
    const [vazio] = diffRichDoc(doc(), doc(p('b', ''))).changes;
    expect(describeBlockChange(vazio!)).toBe('Bloco novo: (vazio)');
  });

  it('descreve o bloco movido', () => {
    const before = doc(p('a', 'Um'), p('b', 'Dois'));
    const after = doc(p('b', 'Dois'), p('a', 'Um'));
    const movido = diffRichDoc(before, after).changes.find((change) => change.kind === 'MOVED');
    expect(describeBlockChange(movido!)).toMatch(/^Bloco movido: /);
  });
});

describe('describeBlockChange — alterado', () => {
  it('descreve o bloco alterado pelo conteúdo novo', () => {
    const antes: RichDoc = { blocks: [paragraphFromText('a___________', 'Velho')] };
    const depois: RichDoc = { blocks: [paragraphFromText('a___________', 'Novo')] };
    const [change] = diffRichDoc(antes, depois).changes;
    expect(describeBlockChange(change!)).toBe('Bloco alterado: Novo');
  });
});
