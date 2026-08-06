import { migrateDocument } from '@/core/document/migrate';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { hashDocument, serialize } from '@/core/document/serialize';
import { validateDocument, type ValidationIssue } from '@/core/document/validate';
import { DomainError } from '@/core/errors';
import { APP_VERSION } from '@/core/document/create';
import { decodeDocumentText, encodeDocumentText, readBlobBytes, type FileFormat } from './format';
import { coerceToDocumentShape } from './recovery';

/**
 * Leitura e escrita de um documento: o caminho por onde **todo** byte passa,
 * nos dois adapters. docs/06-persistencia-e-concorrencia.md §3, §4 e §10.
 *
 * A ordem é sempre: bytes → formato (magic number) → texto → JSON → migração
 * → validação. A validação nunca descarta o arquivo: se falhar, o documento
 * volta como veio (moldado por `coerceToDocumentShape`) junto da lista de
 * problemas, e quem chamou decide — na prática, o modo de recuperação (§10).
 */

export type ReadDocumentResult = {
  document: PolicyOpsDocument;
  /** Não vazio = modo de recuperação. */
  issues: ValidationIssue[];
  /** Texto exatamente como lido, antes de qualquer canonicalização. */
  text: string;
  /** SHA-256 do texto lido — "o que eu vi por último" da detecção de conflito (§4). */
  hash: string;
  bytes: number;
  format: FileFormat;
  migrationsApplied: string[];
};

export async function readDocumentFromBytes(bytes: Uint8Array): Promise<ReadDocumentResult> {
  const { text, format } = await decodeDocumentText(bytes);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DomainError(
      'DOCUMENT_INVALID',
      'O arquivo não é um JSON válido. Se ele veio de um editor de texto, verifique se não foi cortado no meio.',
    );
  }

  // `migrateDocument` lança DOCUMENT_SCHEMA_TOO_NEW com a mensagem exata de
  // docs/03 §10 — arquivo de versão futura é recusado, não "consertado".
  const migrated = migrateDocument(raw);

  const validated = validateDocument(migrated.document);
  const hash = await hashDocument(text);

  if (validated.ok) {
    return {
      document: validated.document,
      issues: [],
      text,
      hash,
      bytes: bytes.byteLength,
      format,
      migrationsApplied: migrated.migrationsApplied,
    };
  }

  return {
    document: coerceToDocumentShape(migrated.document),
    issues: validated.issues,
    text,
    hash,
    bytes: bytes.byteLength,
    format,
    migrationsApplied: migrated.migrationsApplied,
  };
}

export async function readDocumentFromFile(file: File): Promise<ReadDocumentResult> {
  return readDocumentFromBytes(await readBlobBytes(file));
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export type SaveStamp = {
  revision: number;
  savedAt: string;
  savedBy: string;
  appVersion: string;
};

/**
 * Carimbo de salvamento (§4): `meta.revision` incrementa, `savedAt`,
 * `savedBy` e `appVersion` são gravados. É função pura e determinística de
 * propósito — o documento em memória aplica o mesmo carimbo que foi gravado
 * no arquivo, e por isso continua com o mesmo hash do disco.
 */
export function nextStamp(doc: PolicyOpsDocument, actor: string, now: Date): SaveStamp {
  return {
    revision: doc.meta.revision + 1,
    savedAt: now.toISOString(),
    savedBy: actor,
    appVersion: APP_VERSION,
  };
}

export function applyStamp(doc: PolicyOpsDocument, stamp: SaveStamp): PolicyOpsDocument {
  return { ...doc, meta: { ...doc.meta, ...stamp } };
}

export type PreparedSave = {
  document: PolicyOpsDocument;
  stamp: SaveStamp;
  text: string;
  hash: string;
  bytes: Uint8Array;
  format: FileFormat;
};

/**
 * Prepara o conteúdo a gravar. **Valida antes** (§4): documento inválido não
 * chega a virar bytes — lança `DOCUMENT_INVALID` com os problemas em
 * `details`, para a interface mostrar o que está errado e onde.
 */
export async function prepareSave(
  doc: PolicyOpsDocument,
  options: { actor: string; now: Date; format?: FileFormat },
): Promise<PreparedSave> {
  const stamped = applyStamp(doc, nextStamp(doc, options.actor, options.now));

  const validated = validateDocument(stamped);
  if (!validated.ok) {
    throw new DomainError(
      'DOCUMENT_INVALID',
      'O documento não passou na validação e por isso não foi gravado — gravar assim corromperia o arquivo do time.',
      { issues: validated.issues },
    );
  }

  const text = serialize(validated.document);
  const format = options.format ?? 'json';
  const bytes = await encodeDocumentText(text, format);

  return {
    document: validated.document,
    stamp: {
      revision: stamped.meta.revision,
      savedAt: stamped.meta.savedAt!,
      savedBy: stamped.meta.savedBy!,
      appVersion: stamped.meta.appVersion,
    },
    text,
    hash: await hashDocument(text),
    bytes,
    format,
  };
}
