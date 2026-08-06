// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_RECENTS,
  RECENTS_STORAGE_KEY,
  clearRecents,
  ensureReadWritePermission,
  forgetRecent,
  listRecents,
  loadHandles,
  recentId,
  rememberRecent,
  saveHandles,
  type RecentEntry,
} from '@/storage/recents';

/** Arquivos recentes — docs/07-ux-e-editor.md §1. */

function entry(overrides: Partial<RecentEntry> = {}): RecentEntry {
  return {
    id: 'politicas-json::doc000000001',
    fileName: 'politicas.json',
    documentName: 'Políticas',
    bytes: 1234,
    openedAt: '2026-08-05T12:00:00.000Z',
    revision: 3,
    mode: 'FULL',
    hasHandle: true,
    ...overrides,
  };
}

describe('lista de recentes', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('começa vazia', () => {
    expect(listRecents()).toEqual([]);
  });

  it('guarda e devolve a entrada', () => {
    rememberRecent(entry());
    expect(listRecents()).toEqual([entry()]);
  });

  it('reabrir o mesmo arquivo atualiza no lugar, sem duplicar', () => {
    rememberRecent(entry());
    rememberRecent(entry({ revision: 4, openedAt: '2026-08-05T13:00:00.000Z' }));

    const list = listRecents();
    expect(list).toHaveLength(1);
    expect(list[0]!.revision).toBe(4);
  });

  it('põe o mais recente na frente', () => {
    rememberRecent(entry({ id: 'a', fileName: 'a.json' }));
    rememberRecent(entry({ id: 'b', fileName: 'b.json' }));
    expect(listRecents().map((item) => item.id)).toEqual(['b', 'a']);
  });

  it(`guarda no máximo ${MAX_RECENTS}`, () => {
    for (let i = 0; i < MAX_RECENTS + 5; i++) {
      rememberRecent(entry({ id: `id-${i}`, fileName: `arquivo-${i}.json` }));
    }
    expect(listRecents()).toHaveLength(MAX_RECENTS);
    expect(listRecents()[0]!.id).toBe(`id-${MAX_RECENTS + 4}`);
  });

  it('esquece uma entrada', () => {
    rememberRecent(entry({ id: 'a' }));
    rememberRecent(entry({ id: 'b' }));
    expect(forgetRecent('a').map((item) => item.id)).toEqual(['b']);
  });

  it('limpa tudo', () => {
    rememberRecent(entry());
    clearRecents();
    expect(listRecents()).toEqual([]);
  });

  it('aguenta localStorage com lixo dentro', () => {
    localStorage.setItem(RECENTS_STORAGE_KEY, 'não é json');
    expect(listRecents()).toEqual([]);
    localStorage.setItem(RECENTS_STORAGE_KEY, '{"não":"é array"}');
    expect(listRecents()).toEqual([]);
    localStorage.setItem(RECENTS_STORAGE_KEY, '[{"lixo":1}]');
    expect(listRecents()).toEqual([]);
  });

  it('o id junta nome do arquivo e id do documento', () => {
    expect(recentId('Políticas PJ.json', 'doc000000001')).toBe('politicas-pj-json::doc000000001');
  });
});

describe('handles sem IndexedDB (é o caso do jsdom)', () => {
  it('não explodem: só não reabrem sem seletor', async () => {
    await expect(
      saveHandles({ id: 'a', file: {} as FileSystemFileHandle }),
    ).resolves.toBeUndefined();
    expect(await loadHandles('a')).toBeNull();
  });
});

describe('reconfirmação de permissão', () => {
  it('não pede de novo quando já está concedida', async () => {
    const handle = {
      queryPermission: () => Promise.resolve('granted' as const),
      requestPermission: () => Promise.reject(new Error('não deveria ser chamado')),
    } as unknown as FileSystemHandle;
    expect(await ensureReadWritePermission(handle)).toBe(true);
  });

  it('pede com um clique quando expirou', async () => {
    let asked = 0;
    const handle = {
      queryPermission: () => Promise.resolve('prompt' as const),
      requestPermission: () => {
        asked += 1;
        return Promise.resolve('granted' as const);
      },
    } as unknown as FileSystemHandle;

    expect(await ensureReadWritePermission(handle)).toBe(true);
    expect(asked).toBe(1);
  });

  it('devolve false quando o usuário nega', async () => {
    const handle = {
      queryPermission: () => Promise.resolve('prompt' as const),
      requestPermission: () => Promise.resolve('denied' as const),
    } as unknown as FileSystemHandle;
    expect(await ensureReadWritePermission(handle)).toBe(false);
  });

  it('devolve false quando o handle nem tem a API de permissão', async () => {
    expect(await ensureReadWritePermission({} as FileSystemHandle)).toBe(false);
  });
});
