import { describe, expect, it } from 'vitest';
import type { InlineText } from '@/core/document/schema';
import {
  concatInline,
  hasMarkInline,
  inlineFromText,
  inlineLength,
  insertTextInline,
  normalizeInline,
  plainTextOf,
  sliceInline,
  toggleMarkInline,
} from '@/core/richdoc/text';

/**
 * Aritmética de `InlineText` — docs/14 §7. O que estes testes protegem é a
 * forma canônica: sem ela, digitar fragmenta o parágrafo em runs idênticos e o
 * diff por bloco acusa mudança onde o texto é o mesmo.
 */

const negrito: InlineText = [
  { text: 'Cliente ' },
  { text: 'bloqueado', marks: ['bold'] },
  { text: ' por dívida' },
];

describe('normalizeInline', () => {
  it('funde trechos vizinhos com as mesmas marcas e descarta os vazios', () => {
    const normalized = normalizeInline([
      { text: 'abc' },
      { text: '' },
      { text: 'def' },
      { text: 'ghi', marks: ['bold'] },
    ]);
    expect(normalized).toEqual([{ text: 'abcdef' }, { text: 'ghi', marks: ['bold'] }]);
  });

  it('ordena as marcas e descarta `href` sem a marca link', () => {
    const normalized = normalizeInline([{ text: 'x', marks: ['italic', 'bold'], href: 'http://a' }]);
    expect(normalized).toEqual([{ text: 'x', marks: ['bold', 'italic'] }]);
  });

  it('mantém `href` quando a marca link está presente', () => {
    const normalized = normalizeInline([{ text: 'x', marks: ['link'], href: 'http://a' }]);
    expect(normalized).toEqual([{ text: 'x', marks: ['link'], href: 'http://a' }]);
  });

  it('não funde trechos com `href` diferente', () => {
    const normalized = normalizeInline([
      { text: 'a', marks: ['link'], href: 'http://a' },
      { text: 'b', marks: ['link'], href: 'http://b' },
    ]);
    expect(normalized).toHaveLength(2);
  });
});

describe('medidas e conversões', () => {
  it('mede e converte texto plano', () => {
    expect(inlineLength(negrito)).toBe('Cliente bloqueado por dívida'.length);
    expect(plainTextOf(negrito)).toBe('Cliente bloqueado por dívida');
    expect(inlineFromText('')).toEqual([]);
    expect(inlineFromText('oi')).toEqual([{ text: 'oi' }]);
  });
});

describe('sliceInline', () => {
  it('fatia preservando as marcas de cada trecho', () => {
    expect(sliceInline(negrito, 0, 8)).toEqual([{ text: 'Cliente ' }]);
    expect(sliceInline(negrito, 8, 17)).toEqual([{ text: 'bloqueado', marks: ['bold'] }]);
    expect(sliceInline(negrito, 10, 13)).toEqual([{ text: 'oqu', marks: ['bold'] }]);
  });

  it('devolve vazio quando o intervalo é degenerado e recorta o que passa do fim', () => {
    expect(sliceInline(negrito, 5, 5)).toEqual([]);
    expect(sliceInline(negrito, 4, 2)).toEqual([]);
    expect(plainTextOf(sliceInline(negrito, 20, 999))).toBe('r dívida');
  });
});

describe('concatInline e insertTextInline', () => {
  it('concatena normalizando a emenda', () => {
    expect(concatInline([{ text: 'ab' }], [{ text: 'cd' }])).toEqual([{ text: 'abcd' }]);
  });

  it('insere herdando a formatação do caractere à esquerda', () => {
    const next = insertTextInline(negrito, 17, ' HOJE');
    expect(plainTextOf(next)).toBe('Cliente bloqueado HOJE por dívida');
    expect(next[1]).toEqual({ text: 'bloqueado HOJE', marks: ['bold'] });
  });

  it('insere no começo sem marca nenhuma e ignora texto vazio', () => {
    expect(insertTextInline([{ text: 'b' }], 0, 'a')).toEqual([{ text: 'ab' }]);
    expect(insertTextInline(negrito, 3, '')).toEqual(normalizeInline(negrito));
  });

  it('grampeia o offset ao tamanho do texto', () => {
    expect(plainTextOf(insertTextInline([{ text: 'ab' }], 99, 'c'))).toBe('abc');
  });
});

describe('toggleMarkInline', () => {
  it('aplica a marca quando parte do intervalo não a tem', () => {
    const next = toggleMarkInline([{ text: 'abcdef' }], 0, 3, 'bold');
    expect(next).toEqual([{ text: 'abc', marks: ['bold'] }, { text: 'def' }]);
  });

  it('remove a marca quando o intervalo inteiro já a tem', () => {
    const marcado = toggleMarkInline([{ text: 'abcdef' }], 0, 3, 'bold');
    expect(toggleMarkInline(marcado, 0, 3, 'bold')).toEqual([{ text: 'abcdef' }]);
  });

  it('troca o destino do link e depois o remove por inteiro', () => {
    const comLink = toggleMarkInline([{ text: 'manual' }], 0, 6, 'link', 'file://politica');
    expect(comLink).toEqual([{ text: 'manual', marks: ['link'], href: 'file://politica' }]);
    // Destino diferente = aplicar de novo, não desligar.
    const outro = toggleMarkInline(comLink, 0, 6, 'link', 'file://outro');
    expect(outro[0]?.href).toBe('file://outro');
    expect(toggleMarkInline(outro, 0, 6, 'link', 'file://outro')).toEqual([{ text: 'manual' }]);
  });

  it('não mexe em nada com intervalo vazio', () => {
    expect(toggleMarkInline(negrito, 3, 3, 'italic')).toEqual(normalizeInline(negrito));
  });

  it('hasMarkInline responde pelo intervalo inteiro', () => {
    expect(hasMarkInline(negrito, 8, 17, 'bold')).toBe(true);
    expect(hasMarkInline(negrito, 0, 17, 'bold')).toBe(false);
    expect(hasMarkInline(negrito, 5, 5, 'bold')).toBe(false);
  });
});

describe('marcas e formatação — bordas', () => {
  it('aplicar marca comum sobre um trecho com link preserva o destino', () => {
    const comLink: InlineText = [{ text: 'manual', marks: ['link'], href: 'file://a' }];
    const negritado = toggleMarkInline(comLink, 0, 6, 'bold');
    expect(negritado).toEqual([{ text: 'manual', marks: ['bold', 'link'], href: 'file://a' }]);
  });

  it('remover marca comum de um trecho com link não apaga o link', () => {
    const ambos: InlineText = [{ text: 'manual', marks: ['bold', 'link'], href: 'file://a' }];
    expect(toggleMarkInline(ambos, 0, 6, 'bold')).toEqual([
      { text: 'manual', marks: ['link'], href: 'file://a' },
    ]);
  });

  it('trechos com marcas diferentes nunca se fundem', () => {
    expect(
      normalizeInline([
        { text: 'a', marks: ['bold'] },
        { text: 'b', marks: ['italic'] },
      ]),
    ).toHaveLength(2);
  });
});
