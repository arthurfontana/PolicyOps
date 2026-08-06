import type { DirectoryPort } from './directory';
import { baseName } from './format';

/**
 * Backups automáticos — docs/06-persistencia-e-concorrencia.md §9.
 *
 * Antes de cada gravação no modo `FULL`, o conteúdo **anterior** vai para
 * `_backups/{nome}.{timestamp}.json`, mantendo os 20 mais recentes. Se a
 * pasta não puder ser criada, avisa **uma vez** e segue — backup nunca
 * bloqueia salvamento.
 *
 * No SharePoint isso é redundante com o histórico de versões nativo; é cinto
 * e suspensório, e a interface diz isso.
 */

export const BACKUP_DIR = '_backups';
export const MAX_BACKUPS = 20;

export const BACKUP_REDUNDANCY_NOTE =
  'No SharePoint, o histórico de versões da biblioteca já guarda as versões anteriores — o backup local é cinto e suspensório.';

function two(value: number): string {
  return String(value).padStart(2, '0');
}

/** `politicas.2026-08-05T14-32.json` (docs/02-arquitetura.md §1). */
export function backupFileName(dataFileName: string, at: Date): string {
  const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`;
  return `${baseName(dataFileName)}.${stamp}.json`;
}

function isBackupOf(fileName: string, dataFileName: string): boolean {
  return (
    fileName.startsWith(`${baseName(dataFileName)}.`) &&
    /\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/.test(fileName)
  );
}

export type BackupOutcome =
  | { ok: true; fileName: string; pruned: string[] }
  | { ok: false; reason: 'NO_DIRECTORY' | 'PERMISSION'; message: string };

export const BACKUP_UNAVAILABLE_MESSAGE =
  'Não foi possível criar a pasta _backups ao lado do arquivo — provavelmente falta permissão de escrita. O salvamento segue normalmente, sem backup local.';

/**
 * Copia o conteúdo anterior para `_backups/` e apaga o excedente. Chame
 * **antes** de gravar, com o texto que estava no arquivo.
 */
export async function writeBackup(
  directory: DirectoryPort,
  dataFileName: string,
  previousContent: Uint8Array,
  at: Date,
  max = MAX_BACKUPS,
): Promise<BackupOutcome> {
  const backupDir = await directory.subdirectory(BACKUP_DIR, { create: true });
  if (backupDir === null) {
    return { ok: false, reason: 'NO_DIRECTORY', message: BACKUP_UNAVAILABLE_MESSAGE };
  }

  const fileName = backupFileName(dataFileName, at);
  try {
    await backupDir.writeFile(fileName, previousContent);
  } catch (error) {
    return {
      ok: false,
      reason: 'PERMISSION',
      message: `${BACKUP_UNAVAILABLE_MESSAGE} (${String(error)})`,
    };
  }

  return { ok: true, fileName, pruned: await pruneBackups(backupDir, dataFileName, max) };
}

/** Mantém os `max` mais recentes; devolve o que foi apagado. */
export async function pruneBackups(
  backupDir: DirectoryPort,
  dataFileName: string,
  max = MAX_BACKUPS,
): Promise<string[]> {
  const files = (await backupDir.listFiles())
    .filter((name) => isBackupOf(name, dataFileName))
    // O timestamp no nome é ordenável lexicograficamente por construção.
    .sort();

  const excess = files.slice(0, Math.max(0, files.length - max));
  for (const name of excess) {
    try {
      await backupDir.removeFile(name);
    } catch {
      /* backup que não some não é motivo para falhar o salvamento */
    }
  }
  return excess;
}
