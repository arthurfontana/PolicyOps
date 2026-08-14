import { describe, expect, it } from 'vitest';
import { createSampleDocument } from '@/core/document/create';
import { serialize } from '@/core/document/serialize';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { ServerAdapter } from '@/storage/server-adapter';
import { fakeServer } from './server-fake';

/**
 * Adapter do modo `SERVER` — docs/14-plataforma-local.md §4, §5 e §8,
 * docs/06-persistencia-e-concorrencia.md §2 e §5.
 *
 * Mesma suíte de contrato dos outros dois adapters (abrir, salvar, conflito,
 * documento inválido), mais o que é específico deste modo: conflito decidido
 * pelo servidor via `baseHash` (não por reler e comparar aqui), `saveAs`
 * indisponível (arquivo fixo) e erro de rede traduzido em `IO` com uma
 * mensagem que pergunta se o servidor caiu.
 */

function renamed(doc: PolicyOpsDocument, name: string): PolicyOpsDocument {
  return { ...doc, meta: { ...doc.meta, name } };
}

function adapterFor(server: ReturnType<typeof fakeServer>, options?: { now?: () => Date }): ServerAdapter {
  return new ServerAdapter({
    getActor: () => 'Arthur',
    now: options?.now,
    token: server.token,
    fetchImpl: server.fetchImpl,
    dataFileName: server.dataFile,
    dataDir: server.dataDir,
  });
}

describe('ServerAdapter — abrir e salvar', () => {
  it('declara o modo e a capacidade de escrever no lugar', () => {
    const adapter = adapterFor(fakeServer());
    expect(adapter.mode).toBe('SERVER');
    expect(adapter.canWriteInPlace).toBe(true);
  });

  it('abre via GET /api/document e devolve o documento sem problemas', async () => {
    const doc = createSampleDocument();
    const server = fakeServer({ initialText: serialize(doc) });
    const adapter = adapterFor(server);

    const opened = await adapter.open();
    expect(opened.document).toEqual(doc);
    expect(opened.fileName).toBe('politicas.json');
    expect(opened.issues).toEqual([]);
  });

  it('sem arquivo no servidor, open() recusa com mensagem clara (404)', async () => {
    const server = fakeServer({ initialText: null });
    const adapter = adapterFor(server);
    await expect(adapter.open()).rejects.toThrow(/politicas\.json/);
  });

  it('salva via PUT, incrementa a revisão e carimba savedBy', async () => {
    const doc = createSampleDocument();
    const server = fakeServer({ initialText: serialize(doc) });
    const adapter = adapterFor(server);
    await adapter.open();

    const result = await adapter.save(renamed(doc, 'Políticas 2027'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(doc.meta.revision + 1);

    const written: PolicyOpsDocument = JSON.parse(server.content()!);
    expect(written.meta.name).toBe('Políticas 2027');
    expect(written.meta.savedBy).toBe('Arthur');
    expect(written.meta.savedAt).toBe(result.savedAt);
  });

  it('depois de salvar, salvar de novo não acusa conflito (o hash acompanhou)', async () => {
    const doc = createSampleDocument();
    const server = fakeServer({ initialText: serialize(doc) });
    const adapter = adapterFor(server);
    await adapter.open();

    const first = await adapter.save(renamed(doc, 'A'));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await adapter.save({
      ...renamed(doc, 'B'),
      meta: { ...doc.meta, name: 'B', revision: first.revision, savedAt: first.savedAt, savedBy: 'Arthur' },
    });
    expect(second.ok).toBe(true);
  });

  it('sem open() prévio, save() cria o arquivo quando o servidor ainda não tem um (bootstrap)', async () => {
    const server = fakeServer({ initialText: null });
    const adapter = adapterFor(server);

    const result = await adapter.save(createSampleDocument());
    expect(result.ok).toBe(true);
    expect(server.content()).not.toBeNull();
  });
});

describe('conflito (§5) — decidido pelo servidor via baseHash', () => {
  it('baseHash divergente devolve CONFLICT e o servidor não grava', async () => {
    const doc = createSampleDocument();
    const server = fakeServer({ initialText: serialize(doc) });
    const adapter = adapterFor(server);
    await adapter.open();

    const theirs: PolicyOpsDocument = {
      ...doc,
      meta: { ...doc.meta, name: 'Editado por outra pessoa', revision: doc.meta.revision + 1, savedBy: 'Beatriz' },
    };
    const theirText = serialize(theirs);
    server.writeExternally(theirText);

    const result = await adapter.save(renamed(doc, 'Minha edição'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('CONFLICT');
    if (result.reason !== 'CONFLICT') return;
    expect(result.remote.meta.savedBy).toBe('Beatriz');
    // O que importa: o servidor continua com o conteúdo dela.
    expect(server.content()).toBe(theirText);
  });

  it('arquivo apagado no servidor também vira CONFLICT, nunca gravação nova silenciosa', async () => {
    const doc = createSampleDocument();
    const server = fakeServer({ initialText: serialize(doc) });
    const adapter = adapterFor(server);
    await adapter.open();

    server.deleteExternally();

    const result = await adapter.save(renamed(doc, 'Minha'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('CONFLICT');
  });

  it('"sobrescrever mesmo assim" só grava depois de aceitar o hash remoto visto no 409', async () => {
    const doc = createSampleDocument();
    const server = fakeServer({ initialText: serialize(doc) });
    const adapter = adapterFor(server);
    await adapter.open();

    server.writeExternally(serialize({ ...doc, meta: { ...doc.meta, name: 'Delas' } }));
    const blocked = await adapter.save(renamed(doc, 'Minha'));
    expect(blocked.ok).toBe(false);

    adapter.acceptRemoteAsBase();
    const forced = await adapter.save(renamed(doc, 'Minha'));
    expect(forced.ok).toBe(true);
    expect(JSON.parse(server.content()!).meta.name).toBe('Minha');
  });

  it('se alguém salvar de novo entre o 409 e o "sobrescrever", o próximo save ainda conflita', async () => {
    const doc = createSampleDocument();
    const server = fakeServer({ initialText: serialize(doc) });
    const adapter = adapterFor(server);
    await adapter.open();

    server.writeExternally(serialize({ ...doc, meta: { ...doc.meta, name: 'Delas 1' } }));
    const blocked = await adapter.save(renamed(doc, 'Minha'));
    expect(blocked.ok).toBe(false);

    // Diferente do modo FULL, o `force` do servidor não ignora o baseHash —
    // só destrava o lock. Se o conteúdo mudar de novo, o 409 volta.
    server.writeExternally(serialize({ ...doc, meta: { ...doc.meta, name: 'Delas 2' } }));
    adapter.acceptRemoteAsBase();
    const stillBlocked = await adapter.save(renamed(doc, 'Minha'));
    expect(stillBlocked.ok).toBe(false);
    if (stillBlocked.ok) return;
    expect(stillBlocked.reason).toBe('CONFLICT');
  });

  it('reloadCurrent relê o documento do servidor sem mexer no baseHash', async () => {
    const doc = createSampleDocument();
    const server = fakeServer({ initialText: serialize(doc) });
    const adapter = adapterFor(server);
    await adapter.open();

    server.writeExternally(serialize({ ...doc, meta: { ...doc.meta, name: 'Outro nome' } }));
    const remote = await adapter.reloadCurrent();
    expect(remote?.meta.name).toBe('Outro nome');

    // reloadCurrent não aceita o remoto como base — save() ainda vê conflito.
    const result = await adapter.save(renamed(doc, 'Minha'));
    expect(result.ok).toBe(false);
  });
});

describe('bloqueio de outra pessoa (423, defesa em profundidade do servidor)', () => {
  it('save() traduz 423 numa falha clara, sem inventar CONFLICT', async () => {
    const doc = createSampleDocument();
    const server = fakeServer({ initialText: serialize(doc) });
    const adapter = adapterFor(server);
    await adapter.open();

    server.setExternalLock('Beatriz', new Date().toISOString());
    const result = await adapter.save(renamed(doc, 'Minha'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('PERMISSION');
    expect(result.message).toContain('Beatriz');
  });
});

describe('documento inválido nunca é gravado (§4)', () => {
  it('save() devolve IO com a explicação e não chama o servidor', async () => {
    const doc = createSampleDocument();
    const server = fakeServer({ initialText: serialize(doc) });
    const adapter = adapterFor(server);
    await adapter.open();

    const broken: PolicyOpsDocument = {
      ...doc,
      matrices: [
        {
          ...doc.matrices[0]!,
          versions: [{ ...doc.matrices[0]!.versions[0]!, cells: { 'X::Y': { decision: 'APROVA' } } }],
        },
      ],
    };

    const result = await adapter.save(broken);
    expect(result.ok).toBe(false);
    if (result.ok || result.reason === 'CONFLICT') return;
    expect(result.reason).toBe('IO');
    expect(result.message).toContain('não passou na validação');
    expect(server.content()).toBe(serialize(doc));
  });
});

describe('rede e servidor fora do ar', () => {
  it('erro de rede em save() vira IO perguntando se o servidor caiu', async () => {
    const doc = createSampleDocument();
    const server = fakeServer({ initialText: serialize(doc) });
    const adapter = adapterFor(server);
    await adapter.open();

    server.goOffline();
    const result = await adapter.save(renamed(doc, 'Minha'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('IO');
    expect(result.message).toContain('servidor local');
  });

  it('erro de rede em open() lança com a mesma pergunta — o autosave do IndexedDB continua protegendo o trabalho', async () => {
    const server = fakeServer({ initialText: '{}' });
    server.goOffline();
    const adapter = adapterFor(server);
    await expect(adapter.open()).rejects.toThrow(/servidor local/);
  });

  it('reloadCurrent() nunca lança — erro de rede vira null', async () => {
    const server = fakeServer({ initialText: '{}' });
    server.goOffline();
    const adapter = adapterFor(server);
    expect(await adapter.reloadCurrent()).toBeNull();
  });
});

describe('saveAs indisponível — arquivo fixo pela pasta do servidor (§8)', () => {
  it('devolve falha clara em vez de abrir seletor nenhum', async () => {
    const adapter = adapterFor(fakeServer());
    const result = await adapter.saveAs(createSampleDocument());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('PERMISSION');
    expect(result.message).toContain('fixo');
  });
});

describe('sem seletor, sem arrastar, sem recentes — arquivo fixo (§8)', () => {
  it('openFromDrop rejeita e openRecent devolve null', async () => {
    const adapter = adapterFor(fakeServer());
    await expect(adapter.openFromDrop()).rejects.toThrow();
    expect(await adapter.openRecent()).toBeNull();
  });
});

describe('pasta, handle e encerramento', () => {
  it('getHandleInfo devolve nome e caminho fixos; getDirectory é null (lock e backup passam pela API)', async () => {
    const adapter = adapterFor(fakeServer());
    expect(adapter.getHandleInfo()).toEqual({ name: 'politicas.json', path: '\\\\rede\\Politicas\\politicas.json' });
    expect(adapter.getDirectory()).toBeNull();
    await expect(adapter.requestDirectoryAccess()).resolves.toBe(false);
  });

  it('close() esquece o hash visto — o próximo save() sem reabrir vira conflito, não sobrescrita', async () => {
    const doc = createSampleDocument();
    const server = fakeServer({ initialText: serialize(doc) });
    const adapter = adapterFor(server);
    await adapter.open();
    adapter.close();

    const result = await adapter.save(renamed(doc, 'Depois de fechar'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('CONFLICT');
  });
});
