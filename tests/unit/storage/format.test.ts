import { describe, expect, it } from 'vitest';
import { createSampleDocument } from '@/core/document/create';
import { serialize } from '@/core/document/serialize';
import {
  COMPRESSION_THRESHOLD_BYTES,
  baseName,
  conflictCopyName,
  decodeDocumentText,
  detectFormat,
  encodeDocumentText,
  extensionFor,
  shouldOfferCompression,
  slugify,
  suggestedFileName,
} from '@/storage/format';
import { readDocumentFromBytes } from '@/storage/document-io';

/** docs/06-persistencia-e-concorrencia.md §3 e §11. */

describe('round-trip', () => {
  it('documento → JSON → documento é deep-equal', async () => {
    const doc = createSampleDocument();
    const bytes = await encodeDocumentText(serialize(doc), 'json');
    const read = await readDocumentFromBytes(bytes);
    expect(read.issues).toEqual([]);
    expect(read.document).toEqual(doc);
    expect(read.format).toBe('json');
  });

  it('documento → gzip → documento é deep-equal', async () => {
    const doc = createSampleDocument();
    const bytes = await encodeDocumentText(serialize(doc), 'pmz');
    const read = await readDocumentFromBytes(bytes);
    expect(read.document).toEqual(doc);
    expect(read.format).toBe('pmz');
  });

  it('gzip é bem menor que o JSON cru', async () => {
    const text = serialize(createSampleDocument());
    const json = await encodeDocumentText(text, 'json');
    const pmz = await encodeDocumentText(text, 'pmz');
    expect(pmz.byteLength).toBeLessThan(json.byteLength / 2);
  });

  it('o hash do texto lido é o mesmo nos dois formatos', async () => {
    const text = serialize(createSampleDocument());
    const fromJson = await readDocumentFromBytes(await encodeDocumentText(text, 'json'));
    const fromPmz = await readDocumentFromBytes(await encodeDocumentText(text, 'pmz'));
    expect(fromPmz.hash).toBe(fromJson.hash);
  });
});

describe('detecção de formato pelo magic number', () => {
  it('reconhece gzip pelos bytes 1f 8b', async () => {
    const gzipped = await encodeDocumentText('{"a":1}', 'pmz');
    expect(gzipped[0]).toBe(0x1f);
    expect(gzipped[1]).toBe(0x8b);
    expect(detectFormat(gzipped)).toBe('pmz');
  });

  it('reconhece JSON quando não há magic number de gzip', () => {
    expect(detectFormat(new TextEncoder().encode('{"schemaVersion":1}'))).toBe('json');
  });

  it('não se deixa enganar pela extensão: .pmz renomeado para .json abre igual', async () => {
    const doc = createSampleDocument();
    const gzipped = await encodeDocumentText(serialize(doc), 'pmz');
    // O nome do arquivo nem entra nesta chamada — é sempre o conteúdo que decide.
    const read = await readDocumentFromBytes(gzipped);
    expect(read.format).toBe('pmz');
    expect(read.document.meta.id).toBe(doc.meta.id);
  });

  it('trata bytes curtos como JSON (e falha na leitura, não na detecção)', () => {
    expect(detectFormat(new Uint8Array([0x1f]))).toBe('json');
    expect(detectFormat(new Uint8Array([]))).toBe('json');
  });

  it('ignora BOM UTF-8 no começo do JSON', async () => {
    const text = '{"ok":true}';
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
    expect((await decodeDocumentText(withBom)).text).toBe(text);
  });
});

describe('oferta de compactação', () => {
  it('só oferece .pmz acima de 5 MB', () => {
    expect(shouldOfferCompression(COMPRESSION_THRESHOLD_BYTES)).toBe(false);
    expect(shouldOfferCompression(COMPRESSION_THRESHOLD_BYTES + 1)).toBe(true);
  });
});

describe('nomes de arquivo', () => {
  it('slugifica removendo acentos e pontuação', () => {
    expect(slugify('Políticas de Crédito — 2026')).toBe('politicas-de-credito-2026');
    expect(slugify('   ')).toBe('documento');
  });

  it('sugere {slug}.json', () => {
    expect(suggestedFileName('Políticas PJ')).toBe('politicas-pj.json');
    expect(suggestedFileName('Políticas PJ', 'pmz')).toBe('politicas-pj.pmz');
  });

  it('monta o nome da cópia de conflito com nome e hora', () => {
    const at = new Date(2026, 7, 5, 10, 5);
    expect(conflictCopyName('politicas.json', 'Arthur', at)).toBe(
      'politicas-conflito-arthur-10h05.json',
    );
  });

  it('tira só as extensões conhecidas do nome base', () => {
    expect(baseName('politicas.json')).toBe('politicas');
    expect(baseName('politicas.pmz')).toBe('politicas');
    expect(baseName('politicas.v2')).toBe('politicas.v2');
    expect(extensionFor('json')).toBe('.json');
  });
});
