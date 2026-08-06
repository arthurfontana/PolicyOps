import { describe, expect, it } from 'vitest';
import { memoryDirectory, type DirectoryPort } from '@/storage/directory';
import {
  BACKUP_DIR,
  MAX_BACKUPS,
  backupFileName,
  pruneBackups,
  writeBackup,
} from '@/storage/backups';

/** Backups automáticos — docs/06-persistencia-e-concorrencia.md §9. */

const content = (text: string) => new TextEncoder().encode(text);

describe('backupFileName', () => {
  it('usa o formato de docs/02 §1: {nome}.{timestamp}.json', () => {
    expect(backupFileName('politicas.json', new Date(2026, 7, 5, 14, 32, 7))).toBe(
      'politicas.2026-08-05T14-32-07.json',
    );
  });
});

describe('writeBackup', () => {
  it('grava o conteúdo anterior em _backups/', async () => {
    const directory = memoryDirectory('Politicas');
    const outcome = await writeBackup(
      directory,
      'politicas.json',
      content('conteúdo antigo'),
      new Date(2026, 7, 5, 14, 32, 0),
    );

    expect(outcome.ok).toBe(true);
    const backups = directory.children.get(BACKUP_DIR)!;
    expect(backups.readText('politicas.2026-08-05T14-32-00.json')).toBe('conteúdo antigo');
  });

  it('mantém os 20 mais recentes e apaga o excedente', async () => {
    const directory = memoryDirectory('Politicas');

    for (let i = 0; i < MAX_BACKUPS + 3; i++) {
      await writeBackup(
        directory,
        'politicas.json',
        content(`versão ${i}`),
        new Date(2026, 7, 5, 14, 0, i),
      );
    }

    const backups = directory.children.get(BACKUP_DIR)!;
    const names = [...backups.files.keys()].sort();
    expect(names).toHaveLength(MAX_BACKUPS);
    // Os três primeiros sumiram; o último ficou.
    expect(names[0]).toBe('politicas.2026-08-05T14-00-03.json');
    expect(names[names.length - 1]).toBe(`politicas.2026-08-05T14-00-${String(MAX_BACKUPS + 2).padStart(2, '0')}.json`);
  });

  it('não confunde backups de arquivos diferentes na mesma pasta', async () => {
    const directory = memoryDirectory('Politicas');
    await writeBackup(directory, 'politicas.json', content('a'), new Date(2026, 7, 5, 14, 0, 0));
    await writeBackup(directory, 'outro.json', content('b'), new Date(2026, 7, 5, 14, 0, 1));

    const backups = directory.children.get(BACKUP_DIR)!;
    const pruned = await pruneBackups(backups, 'politicas.json', 0);
    expect(pruned).toEqual(['politicas.2026-08-05T14-00-00.json']);
    expect(backups.readText('outro.2026-08-05T14-00-01.json')).toBe('b');
  });

  it('sem poder criar a pasta, avisa e não bloqueia o salvamento', async () => {
    const readOnly: DirectoryPort = {
      ...memoryDirectory('SomenteLeitura'),
      subdirectory: () => Promise.resolve(null),
    };

    const outcome = await writeBackup(readOnly, 'politicas.json', content('x'), new Date());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('NO_DIRECTORY');
    expect(outcome.message).toContain('sem backup local');
  });

  it('sem permissão de escrita na pasta de backup, também segue', async () => {
    const directory = memoryDirectory('Politicas');
    const backupDir = memoryDirectory(BACKUP_DIR);
    backupDir.writeFile = () => Promise.reject(new Error('permissão negada'));
    directory.children.set(BACKUP_DIR, backupDir);

    const outcome = await writeBackup(directory, 'politicas.json', content('x'), new Date());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('PERMISSION');
  });
});
