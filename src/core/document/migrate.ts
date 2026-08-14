import { z } from 'zod';
import { DomainError } from '../errors';
import { CURRENT_SCHEMA_VERSION } from './schema';

/**
 * Migração entre `schemaVersion` — docs/03-modelo-do-documento.md §10.
 * A infraestrutura de encadeamento (`applyMigrations`) é parametrizada pela
 * lista de migrações e também é testada com uma cadeia fictícia 0 → 1 sobre
 * `tests/fixtures/migration-v0-raw.json`, independente das migrações reais.
 */

export type Migration = {
  from: number;
  to: number;
  description: string;
  migrate: (raw: Record<string, unknown>) => Record<string, unknown>;
};

export type MigrationResult = {
  /** Ainda não validado — passe por `validateDocument` em seguida. */
  document: unknown;
  migrationsApplied: string[];
};

/** Mensagem exata exigida por docs/03-modelo-do-documento.md §10. */
export const SCHEMA_TOO_NEW_MESSAGE =
  'Este arquivo foi salvo por uma versão mais nova do PolicyOps. Atualize o PolicyOps.html.';

const SchemaVersionEnvelopeSchema = z.object({ schemaVersion: z.number().int() }).passthrough();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Migração 1 → 2 (sessão 20) — docs/03-modelo-do-documento.md §10.
 *
 * Única migração não-aditiva do produto até aqui: `Domain.regionalRanges` era
 * `Record<string, RegionalRange>` (uma entrada por regional) e vira
 * `Domain.groupingRanges: GroupingRange[]` (cada entrada carrega o próprio
 * `path`); `VariableVersion.regionalDimension` vira `groupingDimensions` com
 * **um** nível `REGIONAL`, preservando as opções tal como estavam.
 *
 * Toda navegação é defensiva porque a entrada é o JSON cru do arquivo, ainda
 * não validado — o que não tiver a forma esperada passa intocado e é
 * `validateDocument` quem reclama depois.
 */
function migrateRegionalToGrouping(raw: Record<string, unknown>): Record<string, unknown> {
  const doc = structuredClone(raw);
  doc.schemaVersion = 2;

  const variables = doc.variables;
  if (!Array.isArray(variables)) return doc;

  for (const variable of variables) {
    if (!isRecord(variable) || !Array.isArray(variable.versions)) continue;

    for (const version of variable.versions) {
      if (!isRecord(version)) continue;
      const regionalDimension = version.regionalDimension;
      if (!isRecord(regionalDimension)) continue;

      const regions = Array.isArray(regionalDimension.regions) ? regionalDimension.regions : [];
      version.groupingDimensions = [{ code: 'REGIONAL', label: 'Regional', options: regions }];
      delete version.regionalDimension;

      if (!Array.isArray(version.domains)) continue;
      for (const domain of version.domains) {
        if (!isRecord(domain)) continue;
        const regionalRanges = domain.regionalRanges;
        if (!isRecord(regionalRanges)) continue;
        domain.groupingRanges = Object.entries(regionalRanges).map(([regionCode, range]) => ({
          path: [regionCode],
          ...(isRecord(range) ? range : {}),
        }));
        delete domain.regionalRanges;
      }
    }
  }

  return doc;
}

/**
 * Migração 2 → 3 (sessão 23) — docs/03-modelo-do-documento.md §10.
 *
 * Puramente aditiva: só acrescenta `importProfiles: []` no topo do
 * documento. `Matrix.tags` e `CatalogItem.group` são opcionais e ficam
 * ausentes em todo registro existente — nada a migrar neles.
 */
function migrateImportProfiles(raw: Record<string, unknown>): Record<string, unknown> {
  const doc = structuredClone(raw);
  doc.schemaVersion = 3;
  if (!Array.isArray(doc.importProfiles)) doc.importProfiles = [];
  return doc;
}

/**
 * Migração 3 → 4 (sessão 29) — docs/03-modelo-do-documento.md §10.
 *
 * Puramente aditiva, e mais: não escreve nenhum campo novo. `meta.acl` é
 * opcional e sua ausência **é** o estado migrado — "modo aberto" (docs/14
 * §6). Só existe para os documentos existentes trocarem de `schemaVersion`.
 */
function migrateAcl(raw: Record<string, unknown>): Record<string, unknown> {
  const doc = structuredClone(raw);
  doc.schemaVersion = 4;
  return doc;
}

const MIGRATIONS: Migration[] = [
  {
    from: 1,
    to: 2,
    description: 'Sessão 20: regionalDimension/regionalRanges → groupingDimensions/groupingRanges.',
    migrate: migrateRegionalToGrouping,
  },
  {
    from: 2,
    to: 3,
    description: 'Sessão 23: acrescenta importProfiles: [] (tags de matriz e grupo de tag são opcionais).',
    migrate: migrateImportProfiles,
  },
  {
    from: 3,
    to: 4,
    description: 'Sessão 29: meta.acl? opcional (papéis de acesso) — nenhum campo é escrito.',
    migrate: migrateAcl,
  },
];

export function migrateDocument(raw: unknown): MigrationResult {
  return applyMigrations(raw, MIGRATIONS);
}

/**
 * Mecanismo de encadeamento em si, parametrizado pela lista de migrações —
 * separado de `migrateDocument` para que o teste de infraestrutura possa
 * injetar uma cadeia fictícia sem depender de uma migração real existir.
 */
export function applyMigrations(raw: unknown, migrations: Migration[]): MigrationResult {
  const envelope = SchemaVersionEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new DomainError(
      'DOCUMENT_INVALID',
      'O arquivo não tem um schemaVersion numérico reconhecível.',
    );
  }

  let version = envelope.data.schemaVersion;

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new DomainError('DOCUMENT_SCHEMA_TOO_NEW', SCHEMA_TOO_NEW_MESSAGE, {
      fileVersion: version,
      supportedVersion: CURRENT_SCHEMA_VERSION,
    });
  }

  let document: Record<string, unknown> = envelope.data;
  const migrationsApplied: string[] = [];

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations.find((m) => m.from === version);
    if (!step) {
      throw new DomainError(
        'DOCUMENT_INVALID',
        `Não existe caminho de migração de schemaVersion ${version} para ${CURRENT_SCHEMA_VERSION}.`,
      );
    }
    document = step.migrate(document);
    migrationsApplied.push(step.description);
    version = step.to;
  }

  return { document, migrationsApplied };
}
