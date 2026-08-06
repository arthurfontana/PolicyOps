import { describe, expect, it } from 'vitest';
import { createSampleDocument } from '@/core/document/create';
import { deserialize, hashDocument, serialize } from '@/core/document/serialize';

describe('serialize / deserialize', () => {
  it('faz round-trip idêntico com o documento de exemplo inteiro', () => {
    const doc = createSampleDocument();
    const text = serialize(doc);
    const parsed = deserialize(text);
    expect(parsed).toEqual(doc);
  });

  it('indenta com 2 espaços', () => {
    const doc = createSampleDocument();
    const text = serialize(doc);
    expect(text.startsWith('{\n  "schemaVersion"')).toBe(true);
  });

  it('omite campos opcionais vazios em vez de gravar null', () => {
    const doc = createSampleDocument();
    const text = serialize(doc);
    // meta.savedAt e meta.savedBy são `string | null` de verdade (não
    // opcionais) — o documento de exemplo nunca foi salvo, então ficam null.
    // Fora desses dois, nenhum campo opcional deve aparecer como null.
    const nullOccurrences = [...text.matchAll(/"(\w+)":\s*null/g)].map((m) => m[1]);
    expect(new Set(nullOccurrences)).toEqual(new Set(['savedAt', 'savedBy']));
  });

  it('produz a mesma ordem de chaves em serializações sucessivas', () => {
    const doc = createSampleDocument();
    expect(serialize(doc)).toBe(serialize(doc));
  });
});

describe('hashDocument', () => {
  it('produz um hex de 64 caracteres (SHA-256)', async () => {
    const hash = await hashDocument('conteúdo de teste');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('é determinístico para o mesmo texto', async () => {
    const text = serialize(createSampleDocument());
    const h1 = await hashDocument(text);
    const h2 = await hashDocument(text);
    expect(h1).toBe(h2);
  });

  it('muda quando o texto muda', async () => {
    const h1 = await hashDocument('a');
    const h2 = await hashDocument('b');
    expect(h1).not.toBe(h2);
  });
});
