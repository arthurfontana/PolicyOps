import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDomainError } from '@/core/errors';
import { createEmptyDocument } from '@/core/document/create';
import { applyMigrations, migrateDocument, SCHEMA_TOO_NEW_MESSAGE, type Migration } from '@/core/document/migrate';

const fixturePath = fileURLToPath(new URL('../../../fixtures/migration-v0-raw.json', import.meta.url));

describe('migrateDocument', () => {
  it('não aplica nenhuma migração a um documento já na versão atual', () => {
    const doc = createEmptyDocument('Doc', 'Arthur');
    const result = migrateDocument(doc);
    expect(result.migrationsApplied).toEqual([]);
    expect(result.document).toEqual(doc);
  });

  it('recusa schemaVersion maior que o suportado com DOCUMENT_SCHEMA_TOO_NEW', () => {
    expect.assertions(3);
    try {
      migrateDocument({ schemaVersion: 999 });
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
      if (isDomainError(error)) {
        expect(error.code).toBe('DOCUMENT_SCHEMA_TOO_NEW');
        expect(error.message).toBe(SCHEMA_TOO_NEW_MESSAGE);
      }
    }
  });

  it('recusa entrada sem schemaVersion numérico com DOCUMENT_INVALID', () => {
    expect.assertions(2);
    try {
      migrateDocument({ nome: 'sem schemaVersion' });
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
      if (isDomainError(error)) expect(error.code).toBe('DOCUMENT_INVALID');
    }
  });
});

describe('applyMigrations — infraestrutura de encadeamento', () => {
  it('aplica uma migração fictícia 0 → 1 sobre a fixture de teste', () => {
    const raw: unknown = JSON.parse(readFileSync(fixturePath, 'utf-8'));

    const fictitiousMigrations: Migration[] = [
      {
        from: 0,
        to: 1,
        description: 'Migração fictícia 0 → 1 (teste de infraestrutura de migrate.ts).',
        migrate: (doc) => ({ ...doc, schemaVersion: 1, migratedFromV0: true }),
      },
    ];

    const result = applyMigrations(raw, fictitiousMigrations);

    expect(result.migrationsApplied).toEqual([
      'Migração fictícia 0 → 1 (teste de infraestrutura de migrate.ts).',
    ]);
    expect((result.document as { schemaVersion: number }).schemaVersion).toBe(1);
    expect((result.document as { migratedFromV0: boolean }).migratedFromV0).toBe(true);
  });

  it('falha com DOCUMENT_INVALID quando não há caminho de migração para a versão atual', () => {
    expect.assertions(2);
    try {
      applyMigrations({ schemaVersion: 0 }, []);
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
      if (isDomainError(error)) expect(error.code).toBe('DOCUMENT_INVALID');
    }
  });
});
