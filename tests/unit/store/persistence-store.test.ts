// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleDocument } from '@/core/document/create';
import { serialize } from '@/core/document/serialize';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { DownloadAdapter } from '@/storage/download-adapter';
import { FsaAdapter } from '@/storage/fsa-adapter';
import { useDocumentStore } from '@/store/document-store';
import { usePersistenceStore } from '@/store/persistence-store';
import { useUiStore } from '@/store/ui-store';
import { clearRecents, listRecents } from '@/storage/recents';
import { memoryDirectory } from '@/storage/directory';
import { parseLock } from '@/storage/lock';
import { fakeFileHandle } from '../storage/fakes';

/**
 * O store é a fronteira entre a interface e os adapters — é aqui que as três
 * promessas da Sessão 05 são verificáveis do ponto de vista de quem usa:
 * documento inválido não é gravado, conflito nunca sobrescreve em silêncio, e
 * degradar de modo sempre avisa.
 */

function resetStores() {
  clearRecents();
  useDocumentStore.getState().closeDocument();
  usePersistenceStore.setState({
    fileName: null,
    filePath: null,
    revision: 0,
    lastSavedAt: null,
    status: 'no-document',
    errorMessage: null,
    conflict: null,
    invalid: null,
    recovery: null,
    bufferOffer: null,
    readOnly: false,
    recents: [],
    degraded: null,
    compressionOffer: null,
    preferredFormat: null,
    lockOwned: false,
    lockHeldByOther: null,
    lockUnavailableReason: null,
    backupWarning: null,
  });
  useUiStore.setState({ actor: 'Arthur' });
}

function brokenDocument(): PolicyOpsDocument {
  const doc = createSampleDocument();
  return {
    ...doc,
    matrices: [
      {
        ...doc.matrices[0]!,
        versions: [
          { ...doc.matrices[0]!.versions[0]!, cells: { 'NAO::EXISTE': { decision: 'APROVADO' } } },
        ],
      },
    ],
  };
}

describe('abrir', () => {
  beforeEach(resetStores);

  it('arquivo solto na janela abre e vira "Salvo"', async () => {
    const doc = createSampleDocument();
    usePersistenceStore
      .getState()
      ._setAdapter(new DownloadAdapter({ getActor: () => 'Arthur' }));

    await usePersistenceStore
      .getState()
      .openDroppedFile(new File([serialize(doc)], 'politicas.json'));

    const state = usePersistenceStore.getState();
    expect(state.status).toBe('saved');
    expect(state.fileName).toBe('politicas.json');
    expect(state.revision).toBe(doc.meta.revision);
    expect(useDocumentStore.getState().document).toEqual(doc);
  });

  it('registra o arquivo aberto nos recentes', async () => {
    const doc = createSampleDocument();
    usePersistenceStore
      .getState()
      ._setAdapter(new DownloadAdapter({ getActor: () => 'Arthur' }));

    await usePersistenceStore
      .getState()
      .openDroppedFile(new File([serialize(doc)], 'politicas.json'));

    const recents = listRecents();
    expect(recents).toHaveLength(1);
    expect(recents[0]!.fileName).toBe('politicas.json');
    expect(recents[0]!.documentName).toBe(doc.meta.name);
    // Sem File System Access não há handle para reabrir sozinho — e a lista diz.
    expect(recents[0]!.hasHandle).toBe(false);
  });

  it('arquivo com defeito não entra no documento: abre em modo de recuperação', async () => {
    const doc = createSampleDocument();
    const broken = JSON.stringify(brokenDocument(), null, 2);
    usePersistenceStore
      .getState()
      ._setAdapter(new DownloadAdapter({ getActor: () => 'Arthur' }));

    await usePersistenceStore.getState().openDroppedFile(new File([broken], 'quebrado.json'));

    const state = usePersistenceStore.getState();
    expect(state.recovery).not.toBeNull();
    expect(state.recovery!.fileName).toBe('quebrado.json');
    expect(state.recovery!.issues.length).toBeGreaterThan(0);
    expect(useDocumentStore.getState().document).toBeNull();
    expect(doc.meta.id).toBeDefined();
  });

  it('o exemplo abre em memória, marcado como não salvo', () => {
    usePersistenceStore.getState().openSample();
    expect(usePersistenceStore.getState().fileName).toBeNull();
    expect(usePersistenceStore.getState().status).toBe('dirty');
    expect(useDocumentStore.getState().document).not.toBeNull();
  });
});

describe('salvar', () => {
  beforeEach(resetStores);

  it('documento inválido não é gravado, e a interface recebe os problemas', async () => {
    const downloads: string[] = [];
    usePersistenceStore.getState()._setAdapter(
      new DownloadAdapter({
        getActor: () => 'Arthur',
        downloadBlob: (_blob, fileName) => downloads.push(fileName),
      }),
    );
    useDocumentStore.getState().openDocument(brokenDocument());

    await usePersistenceStore.getState().save();

    const state = usePersistenceStore.getState();
    expect(state.invalid).not.toBeNull();
    expect(state.invalid!.issues.some((issue) => issue.invariant === 'I5')).toBe(true);
    expect(state.status).toBe('error');
    expect(downloads).toEqual([]);
  });

  it('salvar com sucesso carimba o documento em memória e zera o "não salvo"', async () => {
    const doc = createSampleDocument();
    const handle = fakeFileHandle('politicas.json', serialize(doc));
    const adapter = new FsaAdapter({ getActor: () => 'Arthur' });
    usePersistenceStore.getState()._setAdapter(adapter);
    await adapter.openFromDropHandle(handle);
    useDocumentStore.getState().openDocument(doc);
    usePersistenceStore.setState({ fileName: 'politicas.json' });

    await usePersistenceStore.getState().save();

    const state = usePersistenceStore.getState();
    expect(state.status).toBe('saved');
    expect(state.revision).toBe(doc.meta.revision + 1);

    const inMemory = useDocumentStore.getState().document!;
    expect(inMemory.meta.revision).toBe(doc.meta.revision + 1);
    expect(inMemory.meta.savedBy).toBe('Arthur');
    expect(useDocumentStore.getState().dirty).toBe(false);
    // O que está em memória é o que está no arquivo.
    expect(serialize(inMemory)).toBe(handle.content());
  });

  it('conflito vira estado de conflito com o resumo do que mudou, sem gravar', async () => {
    const doc = createSampleDocument();
    const handle = fakeFileHandle('politicas.json', serialize(doc));
    const adapter = new FsaAdapter({ getActor: () => 'Arthur' });
    usePersistenceStore.getState()._setAdapter(adapter);
    await adapter.openFromDropHandle(handle);
    useDocumentStore.getState().openDocument(doc);
    usePersistenceStore.setState({ fileName: 'politicas.json' });

    const theirs = serialize({
      ...doc,
      meta: { ...doc.meta, name: 'Delas', revision: 9, savedBy: 'Beatriz' },
    });
    handle.writeExternally(theirs);

    await usePersistenceStore.getState().save();

    const state = usePersistenceStore.getState();
    expect(state.conflict).not.toBeNull();
    expect(state.conflict!.headline).toContain('Beatriz');
    expect(state.conflict!.lines.some((line) => line.label === 'Revisão' && line.changed)).toBe(
      true,
    );
    expect(handle.content()).toBe(theirs);
    expect(handle.writeCount()).toBe(0);
  });

  it('sobrescrever exige o nome exato do arquivo digitado', async () => {
    const doc = createSampleDocument();
    const handle = fakeFileHandle('politicas.json', serialize(doc));
    const adapter = new FsaAdapter({ getActor: () => 'Arthur' });
    usePersistenceStore.getState()._setAdapter(adapter);
    await adapter.openFromDropHandle(handle);
    useDocumentStore.getState().openDocument(doc);
    usePersistenceStore.setState({ fileName: 'politicas.json' });

    handle.writeExternally(serialize({ ...doc, meta: { ...doc.meta, name: 'Delas' } }));
    await usePersistenceStore.getState().save();
    expect(usePersistenceStore.getState().conflict).not.toBeNull();

    // Nome errado: continua sem gravar.
    await usePersistenceStore.getState().overwriteAnyway('outro-arquivo.json');
    expect(handle.writeCount()).toBe(0);
    expect(usePersistenceStore.getState().conflict).not.toBeNull();
    expect(usePersistenceStore.getState().errorMessage).toContain('politicas.json');

    // Nome certo: grava.
    await usePersistenceStore.getState().overwriteAnyway('politicas.json');
    expect(handle.writeCount()).toBe(1);
    expect(usePersistenceStore.getState().conflict).toBeNull();
  });

  it('somente leitura recusa salvar por cima e explica o caminho', async () => {
    usePersistenceStore.getState().openSample();
    usePersistenceStore.setState({ readOnly: true });

    await usePersistenceStore.getState().save();

    expect(usePersistenceStore.getState().status).toBe('error');
    expect(usePersistenceStore.getState().errorMessage).toContain('somente leitura');
  });
});

describe('bloqueio consultivo e pasta (§6 e §9)', () => {
  beforeEach(resetStores);

  it('sem acesso à pasta, o modo FULL diz que lock e backup estão indisponíveis', async () => {
    const doc = createSampleDocument();
    const adapter = new FsaAdapter({ getActor: () => 'Arthur' });
    usePersistenceStore.getState()._setAdapter(adapter);

    await usePersistenceStore
      .getState()
      .openDroppedFile(new File([serialize(doc)], 'politicas.json'));

    const state = usePersistenceStore.getState();
    expect(state.lockOwned).toBe(false);
    expect(state.lockUnavailableReason).toContain('acesso à pasta');
  });

  it('concedida a pasta, o bloqueio é tomado e o .lock.json aparece ao lado', async () => {
    const doc = createSampleDocument();
    const directory = memoryDirectory('Politicas');
    const adapter = new FsaAdapter({ getActor: () => 'Arthur' });
    // Substitui só o pedido ao usuário: o resto do caminho é o de produção.
    adapter.requestDirectoryAccess = () => {
      adapter.attachDirectory(directory);
      return Promise.resolve(true);
    };
    usePersistenceStore.getState()._setAdapter(adapter);

    await usePersistenceStore
      .getState()
      .openDroppedFile(new File([serialize(doc)], 'politicas.json'));
    await usePersistenceStore.getState().enableFolderFeatures();

    expect(usePersistenceStore.getState().lockOwned).toBe(true);
    expect(usePersistenceStore.getState().lockUnavailableReason).toBeNull();

    const lock = parseLock(directory.readText('politicas.lock.json')!);
    expect(lock?.holder).toBe('Arthur');
    expect(lock?.docRevision).toBe(doc.meta.revision);

    // Fechar o documento libera o bloqueio.
    await usePersistenceStore.getState().closeDocument();
    expect(directory.readText('politicas.lock.json')).toBeNull();
  });

  it('arquivo travado por outra pessoa abre em somente leitura, com o banner', async () => {
    const doc = createSampleDocument();
    const directory = memoryDirectory('Politicas');
    directory.writeText(
      'politicas.lock.json',
      JSON.stringify({
        holder: 'Beatriz',
        since: new Date().toISOString(),
        heartbeat: new Date().toISOString(),
        docRevision: 3,
      }),
    );

    const adapter = new FsaAdapter({ getActor: () => 'Arthur' });
    adapter.requestDirectoryAccess = () => {
      adapter.attachDirectory(directory);
      return Promise.resolve(true);
    };
    usePersistenceStore.getState()._setAdapter(adapter);

    await usePersistenceStore
      .getState()
      .openDroppedFile(new File([serialize(doc)], 'politicas.json'));
    await usePersistenceStore.getState().enableFolderFeatures();

    const held = usePersistenceStore.getState().lockHeldByOther;
    expect(held?.info.holder).toBe('Beatriz');
    expect(held?.description).toContain('está editando este arquivo desde');
    // "Abrir somente leitura" é o recomendado, e é o estado inicial.
    expect(usePersistenceStore.getState().readOnly).toBe(true);
    expect(JSON.parse(directory.readText('politicas.lock.json')!).holder).toBe('Beatriz');

    // "Editar assim mesmo" toma o bloqueio, e só então.
    await usePersistenceStore.getState().takeLockAnyway();
    expect(usePersistenceStore.getState().readOnly).toBe(false);
    expect(JSON.parse(directory.readText('politicas.lock.json')!).holder).toBe('Arthur');
  });
});

describe('oferta de compactação acima de 5 MB (§3)', () => {
  beforeEach(resetStores);

  it('documento pequeno salva direto em .json, sem perguntar nada', async () => {
    const downloads: Array<{ blob: Blob; fileName: string }> = [];
    usePersistenceStore.getState()._setAdapter(
      new DownloadAdapter({
        getActor: () => 'Arthur',
        downloadBlob: (blob, fileName) => downloads.push({ blob, fileName }),
      }),
    );
    useDocumentStore.getState().openDocument(createSampleDocument());

    await usePersistenceStore.getState().save();

    expect(usePersistenceStore.getState().compressionOffer).toBeNull();
    expect(usePersistenceStore.getState().preferredFormat).toBe('json');
    expect(downloads[0]!.blob.type).toBe('application/json');
  });

  it('documento grande para o salvamento e pergunta antes de gravar', async () => {
    const downloads: Array<{ blob: Blob; fileName: string }> = [];
    usePersistenceStore.getState()._setAdapter(
      new DownloadAdapter({
        getActor: () => 'Arthur',
        downloadBlob: (blob, fileName) => downloads.push({ blob, fileName }),
      }),
    );

    // Um documento acima de 5 MB, inflado por uma descrição longa: o que
    // interessa é o tamanho do JSON serializado.
    const doc = createSampleDocument();
    useDocumentStore.getState().openDocument({
      ...doc,
      meta: { ...doc.meta, description: 'x'.repeat(6 * 1024 * 1024) },
    });

    await usePersistenceStore.getState().save();

    const offer = usePersistenceStore.getState().compressionOffer;
    expect(offer).not.toBeNull();
    expect(offer!.bytes).toBeGreaterThan(5 * 1024 * 1024);
    // Nada foi gravado enquanto a pergunta está na tela.
    expect(downloads).toEqual([]);

    await usePersistenceStore.getState().chooseFormat('pmz');

    expect(usePersistenceStore.getState().compressionOffer).toBeNull();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.blob.type).toBe('application/gzip');
    expect(downloads[0]!.fileName).toMatch(/\.pmz$/);
    expect(usePersistenceStore.getState().status).toBe('saved');
  });

  it('a resposta vale para os salvamentos seguintes', async () => {
    const downloads: Blob[] = [];
    usePersistenceStore.getState()._setAdapter(
      new DownloadAdapter({
        getActor: () => 'Arthur',
        downloadBlob: (blob) => downloads.push(blob),
      }),
    );
    const doc = createSampleDocument();
    useDocumentStore.getState().openDocument({
      ...doc,
      meta: { ...doc.meta, description: 'x'.repeat(6 * 1024 * 1024) },
    });

    await usePersistenceStore.getState().save();
    await usePersistenceStore.getState().chooseFormat('json');
    await usePersistenceStore.getState().save();

    expect(usePersistenceStore.getState().compressionOffer).toBeNull();
    expect(downloads).toHaveLength(2);
    expect(downloads.every((blob) => blob.type === 'application/json')).toBe(true);
  });
});

describe('modo', () => {
  beforeEach(resetStores);

  it('num ambiente sem File System Access, o modo é DOWNLOAD_ONLY', () => {
    // jsdom não tem showOpenFilePicker — é o mesmo caso de Firefox e Safari.
    expect(usePersistenceStore.getState().capabilities.fileSystemAccess).toBe(false);
  });

  it('o aviso de ausência de detecção de conflito pode ser dispensado', () => {
    expect(usePersistenceStore.getState().downloadOnlyWarningDismissed).toBe(false);
    usePersistenceStore.getState().dismissDownloadOnlyWarning();
    expect(usePersistenceStore.getState().downloadOnlyWarningDismissed).toBe(true);
  });
});
