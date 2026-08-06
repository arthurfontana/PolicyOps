import { z } from 'zod';
import { DomainError } from '../errors';
import { CURRENT_SCHEMA_VERSION } from './schema';

/**
 * Migração entre `schemaVersion` — docs/03-modelo-do-documento.md §10.
 * Hoje só existe a versão 1, então `MIGRATIONS` fica vazio; a infraestrutura
 * de encadeamento (`applyMigrations`) existe e é testada com uma migração
 * fictícia 0 → 1 sobre `tests/fixtures/migration-v0-raw.json`, para provar
 * que o mecanismo funciona antes de a primeira migração real precisar dele.
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

// Quando schemaVersion 2 existir, a migração 1 → 2 entra aqui.
const MIGRATIONS: Migration[] = [];

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
