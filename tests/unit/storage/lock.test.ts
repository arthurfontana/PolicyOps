import { describe, expect, it } from 'vitest';
import { memoryDirectory } from '@/storage/directory';
import {
  AdvisoryLock,
  LOCK_ADVISORY_NOTE,
  LOCK_HEARTBEAT_MS,
  LOCK_STALE_MS,
  describeLock,
  isStale,
  lockFileName,
  parseLock,
  type LockInfo,
} from '@/storage/lock';

/** Bloqueio consultivo — docs/06-persistencia-e-concorrencia.md §6 e §11. */

const T0 = new Date('2026-08-05T12:00:00.000Z');
const at = (msFromT0: number) => new Date(T0.getTime() + msFromT0);

function lockAt(holder: string, heartbeat: Date): LockInfo {
  return {
    holder,
    since: T0.toISOString(),
    heartbeat: heartbeat.toISOString(),
    docRevision: 41,
  };
}

describe('nome do arquivo de bloqueio', () => {
  it('é {nome}.lock.json, ao lado do arquivo de dados', () => {
    expect(lockFileName('politicas.json')).toBe('politicas.lock.json');
    expect(lockFileName('politicas.pmz')).toBe('politicas.lock.json');
  });
});

describe('obsolescência (10 min)', () => {
  it('não é obsoleto antes de 10 minutos', () => {
    expect(isStale(lockAt('Beatriz', T0), at(LOCK_STALE_MS))).toBe(false);
  });

  it('é obsoleto passados 10 minutos sem heartbeat', () => {
    expect(isStale(lockAt('Beatriz', T0), at(LOCK_STALE_MS + 1))).toBe(true);
  });

  it('heartbeat ilegível conta como obsoleto', () => {
    expect(isStale({ ...lockAt('Beatriz', T0), heartbeat: 'ontem' }, at(0))).toBe(true);
  });
});

describe('mensagem do banner', () => {
  it('diz quem está editando e desde quando', () => {
    const lock = lockAt('Arthur', T0);
    expect(describeLock(lock, at(60_000))).toContain('Arthur está editando este arquivo desde');
  });

  it('avisa quando o bloqueio está obsoleto', () => {
    expect(describeLock(lockAt('Arthur', T0), at(LOCK_STALE_MS + 1))).toContain('obsoleto');
  });

  it('a interface tem a palavra "consultivo" disponível, com essas palavras', () => {
    expect(LOCK_ADVISORY_NOTE).toContain('consultivo');
    expect(LOCK_ADVISORY_NOTE).toContain('não impede');
  });
});

describe('parseLock', () => {
  it('lê o formato de §6', () => {
    const lock = parseLock(
      '{"holder":"Arthur","since":"2026-08-05T12:00:00.000Z","heartbeat":"2026-08-05T12:24:00.000Z","docRevision":41}',
    );
    expect(lock).toEqual({
      holder: 'Arthur',
      since: '2026-08-05T12:00:00.000Z',
      heartbeat: '2026-08-05T12:24:00.000Z',
      docRevision: 41,
    });
  });

  it('devolve null para lixo', () => {
    expect(parseLock('não é json')).toBeNull();
    expect(parseLock('{"holder":123}')).toBeNull();
  });
});

describe('AdvisoryLock', () => {
  function build(holder: string, clock: { current: Date }) {
    const directory = memoryDirectory('Politicas');
    return {
      directory,
      lock: new AdvisoryLock({
        directory,
        dataFileName: 'politicas.json',
        holder,
        now: () => clock.current,
        setInterval: () => 1,
        clearInterval: () => undefined,
      }),
    };
  }

  it('toma o bloqueio quando o arquivo está livre e grava o .lock.json', async () => {
    const clock = { current: T0 };
    const { directory, lock } = build('Arthur', clock);

    const result = await lock.acquire(41);
    expect(result.ok).toBe(true);
    const written = JSON.parse(directory.readText('politicas.lock.json')!);
    expect(written.holder).toBe('Arthur');
    expect(written.docRevision).toBe(41);
    expect(written.since).toBe(T0.toISOString());
  });

  it('recusa quando outra pessoa está com o bloqueio ativo', async () => {
    const clock = { current: T0 };
    const { directory, lock } = build('Arthur', clock);
    directory.writeText('politicas.lock.json', JSON.stringify(lockAt('Beatriz', T0)));

    clock.current = at(LOCK_STALE_MS - 1);
    const result = await lock.acquire(41);
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'HELD') throw new Error('esperava HELD');
    expect(result.lock.holder).toBe('Beatriz');
    // Não sobrescreveu o arquivo dela.
    expect(JSON.parse(directory.readText('politicas.lock.json')!).holder).toBe('Beatriz');
  });

  it('toma o bloqueio obsoleto (mais de 10 min sem heartbeat)', async () => {
    const clock = { current: at(LOCK_STALE_MS + 1) };
    const { directory, lock } = build('Arthur', clock);
    directory.writeText('politicas.lock.json', JSON.stringify(lockAt('Beatriz', T0)));

    const result = await lock.acquire(42);
    expect(result.ok).toBe(true);
    expect(JSON.parse(directory.readText('politicas.lock.json')!).holder).toBe('Arthur');
  });

  it('"editar assim mesmo" toma o bloqueio ativo de outra pessoa', async () => {
    const clock = { current: T0 };
    const { directory, lock } = build('Arthur', clock);
    directory.writeText('politicas.lock.json', JSON.stringify(lockAt('Beatriz', T0)));

    const result = await lock.acquire(41, { force: true });
    expect(result.ok).toBe(true);
    expect(JSON.parse(directory.readText('politicas.lock.json')!).holder).toBe('Arthur');
  });

  it('o heartbeat renova o carimbo sem mexer no "since"', async () => {
    const clock = { current: T0 };
    const { directory, lock } = build('Arthur', clock);
    await lock.acquire(41);

    clock.current = at(LOCK_HEARTBEAT_MS);
    const beaten = await lock.beat(42);

    expect(beaten?.since).toBe(T0.toISOString());
    expect(beaten?.heartbeat).toBe(at(LOCK_HEARTBEAT_MS).toISOString());
    expect(beaten?.docRevision).toBe(42);
    // E renovado, deixa de ser obsoleto na janela seguinte.
    const stored = parseLock(directory.readText('politicas.lock.json')!)!;
    expect(isStale(stored, at(LOCK_HEARTBEAT_MS + LOCK_STALE_MS - 1))).toBe(false);
  });

  it('o temporizador de 60 s dispara o heartbeat', async () => {
    const clock = { current: T0 };
    const directory = memoryDirectory('Politicas');
    let tick: (() => void) | null = null;
    let interval = 0;
    const lock = new AdvisoryLock({
      directory,
      dataFileName: 'politicas.json',
      holder: 'Arthur',
      now: () => clock.current,
      setInterval: (handler, ms) => {
        tick = handler;
        interval = ms;
        return 7;
      },
      clearInterval: () => {
        tick = null;
      },
    });

    await lock.acquire(41);
    lock.startHeartbeat();
    expect(interval).toBe(LOCK_HEARTBEAT_MS);

    clock.current = at(LOCK_HEARTBEAT_MS);
    tick!();
    await Promise.resolve();
    await Promise.resolve();
    expect(parseLock(directory.readText('politicas.lock.json')!)!.heartbeat).toBe(
      at(LOCK_HEARTBEAT_MS).toISOString(),
    );

    lock.stopHeartbeat();
    expect(tick).toBeNull();
  });

  it('liberar apaga o arquivo de bloqueio', async () => {
    const clock = { current: T0 };
    const { directory, lock } = build('Arthur', clock);
    await lock.acquire(41);
    await lock.release();
    expect(directory.readText('politicas.lock.json')).toBeNull();
    expect(lock.current).toBeNull();
  });

  it('liberar não apaga o bloqueio de outra pessoa que tomou o meu obsoleto', async () => {
    const clock = { current: T0 };
    const { directory, lock } = build('Arthur', clock);
    await lock.acquire(41);

    directory.writeText('politicas.lock.json', JSON.stringify(lockAt('Beatriz', at(LOCK_STALE_MS + 2))));
    await lock.release();

    expect(JSON.parse(directory.readText('politicas.lock.json')!).holder).toBe('Beatriz');
  });
});
