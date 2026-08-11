import { describe, expect, it } from 'vitest';
import {
  fnv1a64,
  hashText,
  hashValue,
  normalizeForHash,
  stableStringify,
  toHashString,
} from '@/core/import/hash';

/** Referência independente, em `BigInt` puro, do FNV-1a de 64 bits sobre bytes. */
function referenceFnv(text: string): bigint {
  const MASK = 0xffffffffffffffffn;
  const PRIME = 0x100000001b3n;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    for (const byte of unit > 0xff ? [unit & 0xff, unit >>> 8] : [unit & 0xff]) {
      hash ^= BigInt(byte);
      hash = (hash * PRIME) & MASK;
    }
  }
  return hash;
}

describe('fnv1a64', () => {
  it('casa com a implementação de referência em BigInt', () => {
    for (const text of ['', 'a', 'PolicyOps', 'G4;c.RISCO ALTO;HVI3;R01', 'ação · Ω']) {
      expect(fnv1a64(text)).toBe(referenceFnv(text));
    }
  });

  it('é o offset basis para texto vazio', () => {
    expect(fnv1a64('')).toBe(0xcbf29ce484222325n);
    expect(toHashString(fnv1a64(''))).toBe('cbf29ce484222325');
  });

  it('produz 16 dígitos hexadecimais, com zeros à esquerda', () => {
    expect(toHashString(1n)).toBe('0000000000000001');
    expect(hashText('qualquer coisa')).toHaveLength(16);
  });

  it('muda com uma única letra diferente', () => {
    expect(hashText('OFERTA_15')).not.toBe(hashText('OFERTA_12'));
  });
});

describe('normalizeForHash (RN-20)', () => {
  it('remove o BOM e uniformiza CRLF, CR e LF', () => {
    const lf = 'a;b\nc;d\n';
    expect(normalizeForHash(`\u{FEFF}${lf}`)).toBe(lf);
    expect(normalizeForHash('a;b\r\nc;d\r\n')).toBe(lf);
    expect(normalizeForHash('a;b\rc;d\r')).toBe(lf);
    expect(normalizeForHash(lf)).toBe(lf);
  });

  it('dá o mesmo hash para o mesmo conteúdo em codificações diferentes', () => {
    expect(hashText('\u{FEFF}a;b\r\nc;d')).toBe(hashText('a;b\nc;d'));
  });
});

describe('stableStringify', () => {
  it('independe da ordem em que as chaves foram escritas', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(hashValue({ b: 1, a: 2 })).toBe(hashValue({ a: 2, b: 1 }));
  });

  it('omite campos ausentes e preserva a ordem de arrays', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('serializa primitivos, nulo e indefinido', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('null');
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(3)).toBe('3');
    expect(stableStringify(true)).toBe('true');
  });

  it('distingue estruturas aninhadas diferentes', () => {
    expect(hashValue({ a: { b: 1 } })).not.toBe(hashValue({ a: { b: 2 } }));
  });
});
