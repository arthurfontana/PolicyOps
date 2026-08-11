import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDomainError } from '@/core/errors';
import { createEmptyDocument } from '@/core/document/create';
import { CURRENT_SCHEMA_VERSION } from '@/core/document/schema';
import { validateDocument } from '@/core/document/validate';
import { applyMigrations, migrateDocument, SCHEMA_TOO_NEW_MESSAGE, type Migration } from '@/core/document/migrate';

const fixturePath = fileURLToPath(new URL('../../../fixtures/migration-v0-raw.json', import.meta.url));
const regionalFixturePath = fileURLToPath(
  new URL('../../../fixtures/regional-v1-document.json', import.meta.url),
);

function readRegionalFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(regionalFixturePath, 'utf-8')) as Record<string, unknown>;
}

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

/**
 * Migração 1 → 2 — docs/03-modelo-do-documento.md §10. A fixture é o documento
 * real que a sessão 18 salvava (`regionalDimension` + `regionalRanges`); o que
 * se compara aqui é o documento migrado inteiro, campo a campo, contra o
 * formato novo esperado.
 */
describe('migração 1 → 2: regionalDimension → groupingDimensions', () => {
  it('gera um único nível REGIONAL preservando as opções tal como estavam', () => {
    const result = migrateDocument(readRegionalFixture());

    // A fixture é `schemaVersion: 1`, então a cadeia inteira roda até a atual.
    expect(result.migrationsApplied).toEqual([
      'Sessão 20: regionalDimension/regionalRanges → groupingDimensions/groupingRanges.',
      'Sessão 23: importProfiles no topo do documento, tags de matriz e grupo de tag.',
    ]);

    const doc = result.document as Record<string, never>;
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    const version = (doc.variables as never[])[0]!.versions[0]!;
    expect(version.groupingDimensions).toEqual([
      {
        code: 'REGIONAL',
        label: 'Regional',
        options: [
          { code: 'BASE', label: 'Base' },
          { code: 'SP', label: 'São Paulo' },
        ],
      },
    ]);
    expect(version.regionalDimension).toBeUndefined();
  });

  it('converte regionalRanges em groupingRanges com path de um nível, campo a campo', () => {
    const result = migrateDocument(readRegionalFixture());
    const doc = result.document as Record<string, never>;
    const domains = (doc.variables as never[])[0]!.versions[0]!.domains as Array<Record<string, unknown>>;

    expect(domains[0]).toEqual({
      code: 'R1',
      label: 'R1 - Risco baixo',
      position: 0,
      color: '#00FF2A',
      groupingRanges: [
        { path: ['BASE'], min: '0', max: '100' },
        { path: ['SP'], min: '0', max: '120' },
      ],
    });
    expect(domains[1]).toEqual({
      code: 'R2',
      label: 'R2 - Risco médio',
      position: 1,
      color: '#FFA200',
      groupingRanges: [
        { path: ['BASE'], min: '100', max: '200' },
        { path: ['SP'], min: '120', max: '240' },
      ],
    });
    // O catch-all continua sem `max` — a migração não inventa limite.
    expect(domains[2]).toEqual({
      code: 'R3',
      label: 'R3 - Risco alto',
      position: 2,
      color: '#FF0000',
      isCatchAll: true,
      groupingRanges: [
        { path: ['BASE'], min: '200' },
        { path: ['SP'], min: '240' },
      ],
    });
    for (const domain of domains) {
      expect(domain).not.toHaveProperty('regionalRanges');
    }
  });

  it('o documento migrado passa por validateDocument sem nenhum ERROR', () => {
    const result = migrateDocument(readRegionalFixture());
    const validated = validateDocument(result.document);
    if (!validated.ok) expect(validated.issues).toEqual([]);
    expect(validated.ok).toBe(true);
  });

  it('variável sem regionalDimension passa sem alteração de conteúdo', () => {
    const before = readRegionalFixture();
    const beforeSegmento = structuredClone((before.variables as never[])[1]);
    const result = migrateDocument(before);
    const doc = result.document as Record<string, never>;
    expect((doc.variables as never[])[1]).toEqual(beforeSegmento);
  });

  it('documento sem nenhum regionalDimension só muda de schemaVersion', () => {
    const raw = { ...createEmptyDocument('Doc', 'Arthur'), schemaVersion: 1, importProfiles: undefined };
    delete (raw as Record<string, unknown>).importProfiles;
    const result = migrateDocument(raw);
    expect(result.document).toEqual({
      ...raw,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      importProfiles: [],
    });
  });

  it('não muta o objeto recebido', () => {
    const raw = readRegionalFixture();
    const snapshot = structuredClone(raw);
    migrateDocument(raw);
    expect(raw).toEqual(snapshot);
  });
});

describe('applyMigrations — infraestrutura de encadeamento', () => {
  it('aplica uma migração fictícia 0 → atual sobre a fixture de teste', () => {
    const raw: unknown = JSON.parse(readFileSync(fixturePath, 'utf-8'));

    const fictitiousMigrations: Migration[] = [
      {
        from: 0,
        to: CURRENT_SCHEMA_VERSION,
        description: 'Migração fictícia 0 → atual (teste de infraestrutura de migrate.ts).',
        migrate: (doc) => ({ ...doc, schemaVersion: CURRENT_SCHEMA_VERSION, migratedFromV0: true }),
      },
    ];

    const result = applyMigrations(raw, fictitiousMigrations);

    expect(result.migrationsApplied).toEqual([
      'Migração fictícia 0 → atual (teste de infraestrutura de migrate.ts).',
    ]);
    expect((result.document as { schemaVersion: number }).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect((result.document as { migratedFromV0: boolean }).migratedFromV0).toBe(true);
  });

  it('encadeia várias migrações em sequência até a versão atual', () => {
    const applied: number[] = [];
    const chain: Migration[] = [
      {
        from: 0,
        to: 1,
        description: 'fictícia 0 → 1',
        migrate: (doc) => {
          applied.push(0);
          return { ...doc, schemaVersion: 1 };
        },
      },
      {
        from: 1,
        to: CURRENT_SCHEMA_VERSION,
        description: 'fictícia 1 → atual',
        migrate: (doc) => {
          applied.push(1);
          return { ...doc, schemaVersion: CURRENT_SCHEMA_VERSION };
        },
      },
    ];

    const result = applyMigrations({ schemaVersion: 0 }, chain);
    expect(applied).toEqual([0, 1]);
    expect(result.migrationsApplied).toEqual(['fictícia 0 → 1', 'fictícia 1 → atual']);
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
