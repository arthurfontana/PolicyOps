import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BlockDraft } from '@/core/richdoc/model';
import {
  blocksFromClipboard,
  decodeEntities,
  sanitizePastedHtml,
  sanitizePastedText,
} from '@/core/richdoc/paste';
import { plainTextOf } from '@/core/richdoc/text';

/**
 * Sanitização do colar — docs/14 §7, critério de aceite da S34: "colar uma
 * tabela do Excel produz um bloco `table` fiel; colar texto do Word não traz
 * lixo de formatação".
 *
 * As fixtures são HTML **de clipboard real** (`tests/fixtures/paste-*.html`),
 * com `mso-*`, `<o:p>`, comentário condicional, `<style>` e entidade
 * `windows-1252` — nenhuma das fixtures canônicas de `docs/claude/` serve,
 * porque nenhuma delas é HTML.
 */

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url)), 'utf8');
}

function textOf(block: BlockDraft): string {
  if (block.type === 'bulletList' || block.type === 'numberList') return block.items.map(plainTextOf).join(' | ');
  if (block.type === 'table') return [block.header, ...block.rows].map((row) => row.join(';')).join(' / ');
  if (block.type === 'image') return block.caption ?? '';
  return plainTextOf(block.text);
}

describe('colar do Word', () => {
  const blocks = sanitizePastedHtml(fixture('paste-word.html'));

  it('vira parágrafos e uma lista, sem nenhum resquício de formatação', () => {
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'paragraph', 'bulletList', 'paragraph']);
    expect(textOf(blocks[0]!)).toBe('Bloqueio por dívida vencida');
    expect(textOf(blocks[1]!)).toBe(
      'O cliente com dívida vencida acima de R$ 5.000 é reprovado na esteira, com o reason code DV01.',
    );
    expect(textOf(blocks[3]!)).toBe('A regra vale para PF e PJ.');
  });

  it('reconhece a lista que o Word manda como parágrafos com marcador', () => {
    expect(blocks[2]).toEqual({
      type: 'bulletList',
      items: [[{ text: 'Consulta Serasa' }], [{ text: 'Consulta SPC' }], [{ text: 'Consulta Boa Vista' }]],
    });
  });

  it('não deixa passar marca nenhuma — o negrito do Word morre no caminho', () => {
    const marks = blocks.flatMap((block) =>
      block.type === 'paragraph' ? block.text.flatMap((run) => run.marks ?? []) : [],
    );
    expect(marks).toEqual([]);
  });

  it('não deixa vazar `<style>`, comentário condicional nem `<o:p>`', () => {
    const todo = blocks.map(textOf).join(' ');
    expect(todo).not.toMatch(/mso-|font-face|MsoNormal|o:p|<!--/);
  });
});

describe('colar do Excel', () => {
  const blocks = sanitizePastedHtml(fixture('paste-excel.html'));

  it('vira um bloco `table` fiel, com a primeira linha como cabeçalho', () => {
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: 'table',
      header: ['Faixa de score', 'Decisão', 'Limite (R$)'],
      rows: [
        ['Até 300', 'Reprovar', '0,00'],
        ['301 a 600', 'Mesa', '2.000,00'],
        ['Acima de 600', 'Aprovar', '5.000,00'],
      ],
    });
  });
});

describe('sanitizePastedHtml — casos de borda', () => {
  it('mistura texto, tabela e texto na ordem em que aparecem', () => {
    const blocks = sanitizePastedHtml(
      '<p>Antes</p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><p>Depois</p>',
    );
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'table', 'paragraph']);
    expect(textOf(blocks[1]!)).toBe('A;B / 1;2');
  });

  it('completa linha curta e corta a sobra para manter a tabela retangular', () => {
    const blocks = sanitizePastedHtml(
      '<table><tr><td>A</td><td>B</td></tr><tr><td>1</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>',
    );
    expect(blocks[0]).toEqual({ type: 'table', header: ['A', 'B'], rows: [['1', ''], ['1', '2']] });
  });

  it('tabela aninhada não vira bloco próprio — o texto entra na célula de fora', () => {
    const blocks = sanitizePastedHtml(
      '<table><tr><td>Externa <table><tr><td>Interna</td></tr></table></td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>',
    );
    expect(blocks).toHaveLength(1);
    expect(textOf(blocks[0]!)).toContain('Externa');
  });

  it('trata `<ul>`/`<ol>` de verdade, e `<br>` como fronteira de parágrafo', () => {
    const lista = sanitizePastedHtml('<ul><li>Um</li><li>Dois</li></ul><ol><li>Primeiro</li></ol>');
    expect(lista.map((block) => block.type)).toEqual(['bulletList', 'numberList']);
    const linhas = sanitizePastedHtml('Linha um<br/>Linha dois');
    expect(linhas.map(textOf)).toEqual(['Linha um', 'Linha dois']);
  });

  it('HTML sem estrutura nenhuma vira um parágrafo só', () => {
    expect(sanitizePastedHtml('<span style="color:red">texto <b>solto</b></span>')).toEqual([
      { type: 'paragraph', text: [{ text: 'texto solto' }] },
    ]);
  });

  it('decodifica entidades nomeadas e numéricas', () => {
    expect(decodeEntities('a&amp;b &#233; &#xE9; &nbsp;x &desconhecida;')).toBe('a&b é é  x &desconhecida;');
  });
});

describe('sanitizePastedText', () => {
  it('cada linha vira um parágrafo, linhas em branco somem', () => {
    expect(sanitizePastedText('Primeira\n\nSegunda\r\nTerceira').map(textOf)).toEqual([
      'Primeira',
      'Segunda',
      'Terceira',
    ]);
  });

  it('reconhece marcadores e numeração no texto plano', () => {
    const blocks = sanitizePastedText('Contexto\n- Serasa\n- SPC\n1. Primeiro\n2. Segundo');
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'bulletList', 'numberList']);
    expect(textOf(blocks[1]!)).toBe('Serasa | SPC');
  });

  it('TSV com mais de uma coluna vira tabela — é o Excel sem HTML', () => {
    const blocks = sanitizePastedText('Faixa\tLimite\nA\t1000\nB\t2000');
    expect(blocks[0]).toEqual({ type: 'table', header: ['Faixa', 'Limite'], rows: [['A', '1000'], ['B', '2000']] });
  });

  it('texto com uma tabulação solta continua sendo parágrafo', () => {
    expect(sanitizePastedText('uma frase\tcom tabulação').map((block) => block.type)).toEqual(['paragraph']);
    expect(sanitizePastedText('só\tuma linha\ncom duas colunas').map((block) => block.type)).toEqual([
      'paragraph',
      'paragraph',
    ]);
  });
});

describe('blocksFromClipboard', () => {
  it('prefere o HTML quando ele existe', () => {
    const blocks = blocksFromClipboard({
      html: '<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>',
      text: 'A\tB\n1\t2',
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('table');
  });

  it('cai no texto plano quando o HTML não traz conteúdo', () => {
    expect(blocksFromClipboard({ html: '<style>p{}</style>', text: 'Só texto' })).toEqual([
      { type: 'paragraph', text: [{ text: 'Só texto' }] },
    ]);
  });

  it('clipboard vazio não produz bloco nenhum', () => {
    expect(blocksFromClipboard({})).toEqual([]);
    expect(blocksFromClipboard({ html: '   ', text: '  \n ' })).toEqual([]);
  });
});

describe('sanitizePastedHtml — HTML malformado', () => {
  it('tabela sem `</table>` no fim do clipboard ainda vira bloco', () => {
    const blocks = sanitizePastedHtml('<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td>');
    expect(blocks[0]).toEqual({ type: 'table', header: ['A', 'B'], rows: [['1', '2']] });
  });

  it('`<li>` solto, sem `<ul>`, vira lista com marcadores', () => {
    expect(sanitizePastedHtml('<li>Um</li><li>Dois</li>')).toEqual([
      { type: 'bulletList', items: [[{ text: 'Um' }], [{ text: 'Dois' }]] },
    ]);
  });

  it('texto solto depois de uma lista não se perde', () => {
    const blocks = sanitizePastedHtml('<ul><li>Item</li></ul><p>Depois</p>');
    expect(blocks.map((block) => block.type)).toEqual(['bulletList', 'paragraph']);
  });
});

describe('sanitizePastedText — o que não vira tabela', () => {
  it('TSV entre aspas que resulta numa coluna só continua parágrafo', () => {
    expect(sanitizePastedText('"a\tb"\n"c\td"').map((block) => block.type)).toEqual(['paragraph', 'paragraph']);
  });

  it('arquivo que começa com linha em branco não vira tabela', () => {
    expect(sanitizePastedText('\nA\tB\nC\tD').every((block) => block.type === 'paragraph')).toBe(true);
  });

  it('uma linha só de TSV é parágrafo, não tabela de zero linhas', () => {
    expect(sanitizePastedText('A\tB').map((block) => block.type)).toEqual(['paragraph']);
  });
});
