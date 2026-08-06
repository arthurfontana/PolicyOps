import { describe, expect, it } from 'vitest';
import { createSampleDocument } from '@/core/document/create';
import { serialize } from '@/core/document/serialize';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { FsaAdapter } from '@/storage/fsa-adapter';
import { memoryDirectory } from '@/storage/directory';
import { BACKUP_DIR } from '@/storage/backups';
import { fakeFileHandle } from './fakes';

/**
 * Detecção de conflito — docs/06-persistencia-e-concorrencia.md §5 e §11.
 *
 * O teste que o documento normativo exige é literal: "hash divergente devolve
 * CONFLICT e **não grava** (verifique o conteúdo do arquivo depois)". É o que
 * está aqui — o retorno *e* o conteúdo do arquivo.
 */

function adapterFor(handle: ReturnType<typeof fakeFileHandle>, options?: { now?: () => Date }) {
  const warnings: string[] = [];
  const adapter = new FsaAdapter({
    getActor: () => 'Arthur',
    now: options?.now,
    onBackupUnavailable: (message) => warnings.push(message),
  });
  return { adapter, warnings, open: () => adapter.openFromDropHandle(handle) };
}

function renamed(doc: PolicyOpsDocument, name: string): PolicyOpsDocument {
  return { ...doc, meta: { ...doc.meta, name } };
}

describe('FsaAdapter — abrir e salvar', () => {
  it('abre pelo handle e guarda o hash do que leu', async () => {
    const doc = createSampleDocument();
    const handle = fakeFileHandle('politicas.json', serialize(doc));
    const { adapter, open } = adapterFor(handle);

    const opened = await open();
    expect(opened.document).toEqual(doc);
    expect(opened.fileName).toBe('politicas.json');
    expect(opened.issues).toEqual([]);
    expect(adapter.baseHash).toBe(opened.raw.hash);
    expect(adapter.canWriteInPlace).toBe(true);
    expect(adapter.mode).toBe('FULL');
  });

  it('salva no mesmo arquivo, incrementa a revisão e carimba savedBy', async () => {
    const doc = createSampleDocument();
    const handle = fakeFileHandle('politicas.json', serialize(doc));
    const { adapter, open } = adapterFor(handle);
    await open();

    const result = await adapter.save(renamed(doc, 'Políticas 2027'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(doc.meta.revision + 1);

    const written: PolicyOpsDocument = JSON.parse(handle.content());
    expect(written.meta.name).toBe('Políticas 2027');
    expect(written.meta.revision).toBe(doc.meta.revision + 1);
    expect(written.meta.savedBy).toBe('Arthur');
    expect(written.meta.savedAt).toBe(result.savedAt);
  });

  it('depois de salvar, salvar de novo não acusa conflito (o hash acompanhou)', async () => {
    const doc = createSampleDocument();
    const handle = fakeFileHandle('politicas.json', serialize(doc));
    const { adapter, open } = adapterFor(handle);
    await open();

    const first = await adapter.save(renamed(doc, 'A'));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await adapter.save({
      ...renamed(doc, 'B'),
      meta: { ...doc.meta, name: 'B', revision: first.revision, savedAt: first.savedAt, savedBy: 'Arthur' },
    });
    expect(second.ok).toBe(true);
    expect(handle.writeCount()).toBe(2);
  });
});

describe('conflito (§5)', () => {
  it('hash divergente devolve CONFLICT e o arquivo em disco não é alterado', async () => {
    const doc = createSampleDocument();
    const handle = fakeFileHandle('politicas.json', serialize(doc));
    const { adapter, open } = adapterFor(handle);
    await open();

    // Outra pessoa salva às 10h, do outro lado do SharePoint.
    const theirs: PolicyOpsDocument = {
      ...doc,
      meta: {
        ...doc.meta,
        name: 'Editado por outra pessoa',
        revision: doc.meta.revision + 1,
        savedAt: '2026-08-05T13:00:00.000Z',
        savedBy: 'Beatriz',
      },
    };
    const theirText = serialize(theirs);
    handle.writeExternally(theirText);

    const result = await adapter.save(renamed(doc, 'Minha edição'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('CONFLICT');
    if (result.reason !== 'CONFLICT') return;
    expect(result.remote.meta.savedBy).toBe('Beatriz');

    // O que importa: o arquivo em disco continua sendo o dela, byte a byte.
    expect(handle.content()).toBe(theirText);
    expect(handle.writeCount()).toBe(0);
  });

  it('"sobrescrever mesmo assim" grava por cima só depois de aceitar o remoto como base', async () => {
    const doc = createSampleDocument();
    const handle = fakeFileHandle('politicas.json', serialize(doc));
    const { adapter, open } = adapterFor(handle);
    await open();

    handle.writeExternally(serialize({ ...doc, meta: { ...doc.meta, name: 'Delas' } }));
    const blocked = await adapter.save(renamed(doc, 'Minha'));
    expect(blocked.ok).toBe(false);

    adapter.acceptRemoteAsBase();
    const forced = await adapter.save(renamed(doc, 'Minha'));
    expect(forced.ok).toBe(true);
    expect(JSON.parse(handle.content()).meta.name).toBe('Minha');
  });

  it('arquivo que virou lixo no disco também bloqueia a gravação', async () => {
    const doc = createSampleDocument();
    const handle = fakeFileHandle('politicas.json', serialize(doc));
    const { adapter, open } = adapterFor(handle);
    await open();

    handle.writeExternally('{ não é mais json');
    const result = await adapter.save(renamed(doc, 'Minha'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('CONFLICT');
    expect(handle.writeCount()).toBe(0);
  });

  it('reloadCurrent relê o arquivo do disco', async () => {
    const doc = createSampleDocument();
    const handle = fakeFileHandle('politicas.json', serialize(doc));
    const { adapter, open } = adapterFor(handle);
    await open();

    handle.writeExternally(serialize({ ...doc, meta: { ...doc.meta, name: 'Outro nome' } }));
    const remote = await adapter.reloadCurrent();
    expect(remote?.meta.name).toBe('Outro nome');
  });
});

describe('documento inválido nunca é gravado (§4)', () => {
  it('save() devolve IO com a explicação e não escreve nada', async () => {
    const doc = createSampleDocument();
    const handle = fakeFileHandle('politicas.json', serialize(doc));
    const { adapter, open } = adapterFor(handle);
    await open();

    const broken: PolicyOpsDocument = {
      ...doc,
      matrices: [
        {
          ...doc.matrices[0]!,
          versions: [
            { ...doc.matrices[0]!.versions[0]!, cells: { 'X::Y': { decision: 'APROVA' } } },
          ],
        },
      ],
    };

    const result = await adapter.save(broken);
    expect(result.ok).toBe(false);
    if (result.ok || result.reason === 'CONFLICT') return;
    expect(result.reason).toBe('IO');
    expect(result.message).toContain('não passou na validação');
    expect(handle.writeCount()).toBe(0);
    expect(handle.content()).toBe(serialize(doc));
  });
});

describe('backups automáticos (§9)', () => {
  it('copia o conteúdo anterior para _backups/ antes de gravar', async () => {
    const doc = createSampleDocument();
    const original = serialize(doc);
    const handle = fakeFileHandle('politicas.json', original);
    const directory = memoryDirectory('Politicas');
    const { adapter, open } = adapterFor(handle, {
      now: () => new Date(2026, 7, 5, 14, 32, 10),
    });
    await open();
    // Simula a pasta concedida pelo usuário ("Dar acesso à pasta").
    adapter.attachDirectory(directory);

    await adapter.save(renamed(doc, 'Com backup'));

    const backups = directory.children.get(BACKUP_DIR);
    expect(backups).toBeDefined();
    expect([...backups!.files.keys()]).toEqual(['politicas.2026-08-05T14-32-10.json']);
    expect(backups!.readText('politicas.2026-08-05T14-32-10.json')).toBe(original);
    // E o arquivo principal recebeu a versão nova.
    expect(JSON.parse(handle.content()).meta.name).toBe('Com backup');
  });
});

describe('sem arquivo aberto', () => {
  it('getHandleInfo é null e reloadCurrent também', async () => {
    const adapter = new FsaAdapter({ getActor: () => 'Arthur' });
    expect(adapter.getHandleInfo()).toBeNull();
    expect(await adapter.reloadCurrent()).toBeNull();
    expect(adapter.getDirectory()).toBeNull();
  });
});
