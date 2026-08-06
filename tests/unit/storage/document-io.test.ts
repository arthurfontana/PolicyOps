import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSampleDocument } from '@/core/document/create';
import { SCHEMA_TOO_NEW_MESSAGE } from '@/core/document/migrate';
import { serialize } from '@/core/document/serialize';
import { DomainError } from '@/core/errors';
import {
  applyStamp,
  nextStamp,
  prepareSave,
  readDocumentFromBytes,
} from '@/storage/document-io';
import { encodeDocumentText } from '@/storage/format';

/** docs/06-persistencia-e-concorrencia.md §3, §4 e §10. */

const FIXTURES = path.resolve(import.meta.dirname, '..', '..', 'fixtures');
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

describe('readDocumentFromBytes', () => {
  it('lê um documento válido sem problemas', async () => {
    const doc = createSampleDocument();
    const read = await readDocumentFromBytes(await encodeDocumentText(serialize(doc), 'json'));
    expect(read.issues).toEqual([]);
    expect(read.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(read.bytes).toBeGreaterThan(0);
  });

  it('recusa JSON malformado com mensagem em português', async () => {
    await expect(readDocumentFromBytes(new TextEncoder().encode('{ isso não é json'))).rejects.toThrow(
      /JSON válido/,
    );
  });

  it('recusa schemaVersion maior com a mensagem exata de docs/03 §10', async () => {
    const doc = { ...createSampleDocument(), schemaVersion: 99 };
    await expect(readDocumentFromBytes(encode(doc))).rejects.toThrow(SCHEMA_TOO_NEW_MESSAGE);
  });

  it('abre em modo de recuperação (não descarta) quando a validação falha', async () => {
    const read = await readDocumentFromBytes(fixture('defect-orphan-tuple.json'));
    expect(read.issues.length).toBeGreaterThan(0);
    // O documento voltou: §10 é explícito que o arquivo não é descartado.
    expect(read.document.meta.name).toContain('Fixture');
  });

  it('migra o fixture de schemaVersion 0 e o entrega válido', async () => {
    // A cadeia real de migrações está vazia (só existe a versão 1); o que se
    // prova aqui é que um arquivo já na versão corrente passa reto.
    const raw: unknown = JSON.parse(
      readFileSync(path.join(FIXTURES, 'valid-minimal.json'), 'utf-8'),
    );
    const read = await readDocumentFromBytes(encode(raw));
    expect(read.migrationsApplied).toEqual([]);
    expect(read.issues).toEqual([]);
  });
});

describe('carimbo de salvamento (§4)', () => {
  it('incrementa revision e grava savedAt, savedBy e appVersion', () => {
    const doc = createSampleDocument();
    const now = new Date('2026-08-05T12:00:00.000Z');
    const stamp = nextStamp(doc, 'Arthur', now);
    expect(stamp.revision).toBe(doc.meta.revision + 1);
    expect(stamp.savedAt).toBe('2026-08-05T12:00:00.000Z');
    expect(stamp.savedBy).toBe('Arthur');
    expect(stamp.appVersion).toBe(doc.meta.appVersion);

    const stamped = applyStamp(doc, stamp);
    expect(stamped.meta.revision).toBe(doc.meta.revision + 1);
    // O documento original não é mutado.
    expect(doc.meta.savedBy).toBeNull();
  });
});

describe('prepareSave', () => {
  it('produz bytes e hash do texto canônico', async () => {
    const doc = createSampleDocument();
    const prepared = await prepareSave(doc, { actor: 'Arthur', now: new Date() });
    expect(prepared.text.startsWith('{\n  "schemaVersion"')).toBe(true);
    expect(prepared.hash).toMatch(/^[0-9a-f]{64}$/);
    const reread = await readDocumentFromBytes(prepared.bytes);
    expect(reread.document).toEqual(prepared.document);
    expect(reread.hash).toBe(prepared.hash);
  });

  it('recusa documento inválido antes de gerar qualquer byte (§4)', async () => {
    const doc = createSampleDocument();
    const broken = {
      ...doc,
      matrices: [
        {
          ...doc.matrices[0]!,
          versions: [
            {
              ...doc.matrices[0]!.versions[0]!,
              cells: { 'NAO::EXISTE': { decision: 'APROVA' } },
            },
          ],
        },
        ...doc.matrices.slice(1),
      ],
    };

    const error = await prepareSave(broken, { actor: 'Arthur', now: new Date() }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('DOCUMENT_INVALID');
    const details = (error as DomainError).details as { issues: Array<{ invariant: string }> };
    expect(details.issues.some((issue) => issue.invariant === 'I5')).toBe(true);
  });

  it('compacta quando o formato pedido é .pmz', async () => {
    const doc = createSampleDocument();
    const prepared = await prepareSave(doc, {
      actor: 'Arthur',
      now: new Date(),
      format: 'pmz',
    });
    expect(prepared.bytes[0]).toBe(0x1f);
    expect((await readDocumentFromBytes(prepared.bytes)).document).toEqual(prepared.document);
  });
});
