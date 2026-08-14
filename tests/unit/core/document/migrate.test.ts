import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDomainError } from '@/core/errors';
import { createEmptyDocument } from '@/core/document/create';
import { CURRENT_SCHEMA_VERSION } from '@/core/document/schema';
import { deserialize, serialize } from '@/core/document/serialize';
import { validateDocument } from '@/core/document/validate';
import { applyMigrations, migrateDocument, SCHEMA_TOO_NEW_MESSAGE, type Migration } from '@/core/document/migrate';

const fixturePath = fileURLToPath(new URL('../../../fixtures/migration-v0-raw.json', import.meta.url));
const regionalFixturePath = fileURLToPath(
  new URL('../../../fixtures/regional-v1-document.json', import.meta.url),
);
const v2FixturePath = fileURLToPath(new URL('../../../fixtures/v2-document.json', import.meta.url));
const v3FixturePath = fileURLToPath(new URL('../../../fixtures/v3-document.json', import.meta.url));
const v4FixturePath = fileURLToPath(new URL('../../../fixtures/v4-document.json', import.meta.url));

function readRegionalFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(regionalFixturePath, 'utf-8')) as Record<string, unknown>;
}

function readV2Fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(v2FixturePath, 'utf-8')) as Record<string, unknown>;
}

/** Documento real de schemaVersion 3 — `sample-document.json` antes da migração da S29. */
function readV3Fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(v3FixturePath, 'utf-8')) as Record<string, unknown>;
}

/** Documento real de schemaVersion 4 — `sample-document.json` antes da migração da S32a. */
function readV4Fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(v4FixturePath, 'utf-8')) as Record<string, unknown>;
}

function omit(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out = { ...obj };
  for (const key of keys) delete out[key];
  return out;
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

    expect(result.migrationsApplied).toEqual([
      'Sessão 20: regionalDimension/regionalRanges → groupingDimensions/groupingRanges.',
      'Sessão 23: acrescenta importProfiles: [] (tags de matriz e grupo de tag são opcionais).',
      'Sessão 29: meta.acl? opcional (papéis de acesso) — nenhum campo é escrito.',
      'Sessão 32a: acrescenta components, changeRequests e releases, e carimba kind: "EVIDENCE" nos anexos existentes.',
    ]);

    const doc = result.document as Record<string, never>;
    expect(doc.schemaVersion).toBe(5);
    expect(doc.importProfiles).toEqual([]);

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
    const raw = { ...createEmptyDocument('Doc', 'Arthur'), schemaVersion: 1 };
    const result = migrateDocument(raw);
    expect(result.document).toEqual({ ...raw, schemaVersion: CURRENT_SCHEMA_VERSION });
  });

  it('não muta o objeto recebido', () => {
    const raw = readRegionalFixture();
    const snapshot = structuredClone(raw);
    migrateDocument(raw);
    expect(raw).toEqual(snapshot);
  });
});

/**
 * Migração 2 → 3 (sessão 23) — docs/03-modelo-do-documento.md §10. Puramente
 * aditiva: o único campo novo em relação ao original é `importProfiles: []`.
 * A fixture é um documento real de schemaVersion 2 (`v2-document.json`, o
 * `sample-document.json` de antes da S23).
 */
describe('migração 2 → 3: importProfiles', () => {
  it('acrescenta somente importProfiles: [] — o resto do documento é idêntico campo a campo', () => {
    const before = readV2Fixture();
    const result = migrateDocument(before);

    expect(result.migrationsApplied).toEqual([
      'Sessão 23: acrescenta importProfiles: [] (tags de matriz e grupo de tag são opcionais).',
      'Sessão 29: meta.acl? opcional (papéis de acesso) — nenhum campo é escrito.',
      'Sessão 32a: acrescenta components, changeRequests e releases, e carimba kind: "EVIDENCE" nos anexos existentes.',
    ]);

    const after = result.document as Record<string, unknown>;
    expect(after.schemaVersion).toBe(5);
    expect(after.importProfiles).toEqual([]);

    const beforeRest = omit(before, ['schemaVersion']);
    const afterRest = omit(after, [
      'schemaVersion',
      'importProfiles',
      'components',
      'changeRequests',
      'releases',
    ]);
    expect(afterRest).toEqual(beforeRest);
  });

  it('o documento migrado passa por validateDocument sem nenhum ERROR', () => {
    const result = migrateDocument(readV2Fixture());
    const validated = validateDocument(result.document);
    if (!validated.ok) expect(validated.issues).toEqual([]);
    expect(validated.ok).toBe(true);
  });

  it('não muta o objeto recebido', () => {
    const raw = readV2Fixture();
    const snapshot = structuredClone(raw);
    migrateDocument(raw);
    expect(raw).toEqual(snapshot);
  });

  it('documento v1 continua migrando em cadeia 1 → 2 → 3 → 4 → 5', () => {
    const result = migrateDocument(readRegionalFixture());
    expect(result.migrationsApplied).toHaveLength(4);
    expect((result.document as Record<string, unknown>).schemaVersion).toBe(5);
    expect(validateDocument(result.document).ok).toBe(true);
  });
});

/**
 * Migração 3 → 4 (sessão 29) — docs/03-modelo-do-documento.md §10. Puramente
 * aditiva e, mais que isso, não escreve nenhum campo: `meta.acl` ausente já É
 * o estado migrado ("modo aberto", docs/14-plataforma-local.md §6). A fixture
 * é `sample-document.json` como estava antes desta sessão (schemaVersion 3).
 */
describe('migração 3 → 4: meta.acl (aditiva, nada escrito)', () => {
  it('só troca o schemaVersion — o resto do documento é idêntico campo a campo', () => {
    const before = readV3Fixture();
    const result = migrateDocument(before);

    expect(result.migrationsApplied).toEqual([
      'Sessão 29: meta.acl? opcional (papéis de acesso) — nenhum campo é escrito.',
      'Sessão 32a: acrescenta components, changeRequests e releases, e carimba kind: "EVIDENCE" nos anexos existentes.',
    ]);

    const after = result.document as Record<string, unknown>;
    expect(after.schemaVersion).toBe(5);
    expect(
      omit(after, ['schemaVersion', 'components', 'changeRequests', 'releases']),
    ).toEqual(omit(before, ['schemaVersion']));

    const meta = after.meta as Record<string, unknown>;
    expect(meta.acl).toBeUndefined();
  });

  it('o documento migrado passa por validateDocument sem nenhum ERROR', () => {
    const result = migrateDocument(readV3Fixture());
    const validated = validateDocument(result.document);
    if (!validated.ok) expect(validated.issues).toEqual([]);
    expect(validated.ok).toBe(true);
  });

  it('não muta o objeto recebido', () => {
    const raw = readV3Fixture();
    const snapshot = structuredClone(raw);
    migrateDocument(raw);
    expect(raw).toEqual(snapshot);
  });

  it('documento schemaVersion 6 é recusado com DOCUMENT_SCHEMA_TOO_NEW', () => {
    expect.assertions(3);
    try {
      migrateDocument({ ...readV3Fixture(), schemaVersion: 6 });
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
      if (isDomainError(error)) {
        expect(error.code).toBe('DOCUMENT_SCHEMA_TOO_NEW');
        expect(error.message).toBe(SCHEMA_TOO_NEW_MESSAGE);
      }
    }
  });
});

/**
 * Migração 4 → 5 (sessão 32a) — docs/03-modelo-do-documento.md §10, núcleo do
 * épico Governança. A fixture é `sample-document.json` como estava antes desta
 * sessão (schemaVersion 4, documento real com duas matrizes, biblioteca
 * completa e auditoria).
 */
describe('migração 4 → 5: componentes e entidades de governança', () => {
  it('acrescenta as três coleções novas — o resto do documento é idêntico campo a campo', () => {
    const before = readV4Fixture();
    const result = migrateDocument(before);

    expect(result.migrationsApplied).toEqual([
      'Sessão 32a: acrescenta components, changeRequests e releases, e carimba kind: "EVIDENCE" nos anexos existentes.',
    ]);

    const after = result.document as Record<string, unknown>;
    expect(after.schemaVersion).toBe(5);
    expect(after.components).toEqual([]);
    expect(after.changeRequests).toEqual([]);
    expect(after.releases).toEqual([]);
    // Campos opcionais continuam ausentes — a migração não inventa nada.
    expect(after.attachments).toBeUndefined();
    expect((after.projects as Array<Record<string, unknown>>)[0]!.foundationEffectiveFrom).toBeUndefined();
    expect((after.projects as Array<Record<string, unknown>>)[0]!.factoryTemplate).toBeUndefined();

    expect(
      omit(after, ['schemaVersion', 'components', 'changeRequests', 'releases']),
    ).toEqual(omit(before, ['schemaVersion']));
  });

  it('o documento v4 real migrado passa por validateDocument sem nenhum ERROR', () => {
    const result = migrateDocument(readV4Fixture());
    const validated = validateDocument(result.document);
    if (!validated.ok) expect(validated.issues).toEqual([]);
    expect(validated.ok).toBe(true);
  });

  it('carimba kind: EVIDENCE nos anexos já existentes, sem tocar em mais nada deles', () => {
    const before = readV4Fixture();
    before.attachments = [
      {
        id: 'anexo1234567',
        fileName: 'parecer.pdf',
        relPath: 'politica-pf/mtz-limite-pf/v1/parecer.pdf',
        sha256: 'abc123',
        bytes: 1024,
        addedBy: { username: 'arthur' },
        addedAt: '2026-08-01T12:00:00.000Z',
        target: { kind: 'PROJECT', projectId: (before.projects as Array<{ id: string }>)[0]!.id },
      },
    ];

    const after = migrateDocument(before).document as Record<string, unknown>;
    const attachments = after.attachments as Array<Record<string, unknown>>;
    expect(attachments[0]!.kind).toBe('EVIDENCE');
    expect(omit(attachments[0]!, ['kind'])).toEqual(
      omit((before.attachments as Array<Record<string, unknown>>)[0]!, []),
    );
    expect(validateDocument(after).ok).toBe(true);
  });

  it('não muta o objeto recebido', () => {
    const raw = readV4Fixture();
    const snapshot = structuredClone(raw);
    migrateDocument(raw);
    expect(raw).toEqual(snapshot);
  });

  it('o documento v4 real migrado re-serializa canonicamente e reabre igual', () => {
    const migrated = validateDocument(migrateDocument(readV4Fixture()).document);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;

    const once = serialize(migrated.document);
    const reopened = validateDocument(deserialize(once));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(serialize(reopened.document)).toBe(once);
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
        to: 2,
        description: 'fictícia 1 → 2',
        migrate: (doc) => {
          applied.push(1);
          return { ...doc, schemaVersion: 2 };
        },
      },
      {
        from: 2,
        to: 3,
        description: 'fictícia 2 → 3',
        migrate: (doc) => {
          applied.push(2);
          return { ...doc, schemaVersion: 3 };
        },
      },
      {
        from: 3,
        to: 4,
        description: 'fictícia 3 → 4',
        migrate: (doc) => {
          applied.push(3);
          return { ...doc, schemaVersion: 4 };
        },
      },
      {
        from: 4,
        to: 5,
        description: 'fictícia 4 → 5',
        migrate: (doc) => {
          applied.push(4);
          return { ...doc, schemaVersion: 5 };
        },
      },
    ];

    const result = applyMigrations({ schemaVersion: 0 }, chain);
    expect(applied).toEqual([0, 1, 2, 3, 4]);
    expect(result.migrationsApplied).toEqual([
      'fictícia 0 → 1',
      'fictícia 1 → 2',
      'fictícia 2 → 3',
      'fictícia 3 → 4',
      'fictícia 4 → 5',
    ]);
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
