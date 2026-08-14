// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleDocument } from '@/core/document/create';
import { attachEvidence, detachEvidence } from '@/core/document/evidence';
import { serialize } from '@/core/document/serialize';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { EvidenceApi } from '@/storage/evidences';
import { FsaAdapter } from '@/storage/fsa-adapter';
import { useDocumentStore } from '@/store/document-store';
import { usePersistenceStore } from '@/store/persistence-store';
import { fakeFileHandle } from '../storage/fakes';

/**
 * A regra mais delicada da sessão 30 (docs/14-plataforma-local.md §7): o
 * arquivo do acervo **só** vai para a lixeira depois de um salvamento
 * bem-sucedido que já tirou o vínculo. Nunca no desanexo — senão desfazer
 * dependeria de um arquivo que já se moveu.
 *
 * O adapter aqui é o de arquivo (não o do servidor) só porque salvar precisa
 * dar certo; quem está sob teste é a reconciliação do acervo, injetada por
 * `_setEvidenceApi` como `_setAdapter` já fazia com o adapter.
 */

const RELPATH = 'politica-pf/mtz-limite-pf/v1/2026-08-14_DB 513.docx';

function trackingApi(): { api: EvidenceApi; trashed: string[] } {
  const trashed: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      trashed.push(new URL(String(input), 'http://127.0.0.1').searchParams.get('relPath') ?? '');
      return new Response(JSON.stringify({ trashed: true }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return { api: new EvidenceApi({ token: 't', fetchImpl }), trashed };
}

async function openSaved(doc: PolicyOpsDocument): Promise<void> {
  const handle = fakeFileHandle('politicas.json', serialize(doc));
  const adapter = new FsaAdapter({ getActor: () => 'Arthur' });
  usePersistenceStore.getState()._setAdapter(adapter);
  await adapter.openFromDropHandle(handle);
  useDocumentStore.getState().openDocument(doc);
  usePersistenceStore.setState({ fileName: 'politicas.json', readOnly: false });
}

function documentWithAttachment(): PolicyOpsDocument {
  const doc = createSampleDocument();
  const result = attachEvidence({
    id: 'ev0000000001',
    fileName: '2026-08-14_DB 513.docx',
    relPath: RELPATH,
    sha256: 'a'.repeat(64),
    bytes: 2048,
    addedBy: { username: 'arthur' },
    addedAt: '2026-08-14T12:00:00.000Z',
    target: { kind: 'PROJECT', projectId: doc.projects[0]!.id },
  }).run(doc, { actor: 'Arthur', now: () => new Date('2026-08-14T12:00:00.000Z'), newId: () => 'evt000000001' });
  if (!result.ok) throw result.error;
  return result.document;
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useDocumentStore.getState().setActor('Arthur');
  usePersistenceStore.setState({ status: 'no-document', conflict: null, invalid: null, backupWarning: null });
  usePersistenceStore.getState()._setEvidenceApi(null);
});

describe('reconciliação do acervo (docs/14 §7)', () => {
  it('desanexar não move nada até o salvamento', async () => {
    const { api, trashed } = trackingApi();
    await openSaved(documentWithAttachment());
    usePersistenceStore.getState()._setEvidenceApi(api, [RELPATH]);

    useDocumentStore.getState().dispatch(detachEvidence({ id: 'ev0000000001' }));

    expect(trashed).toEqual([]);
  });

  it('desanexar e salvar manda o arquivo para a lixeira — uma vez só', async () => {
    const { api, trashed } = trackingApi();
    await openSaved(documentWithAttachment());
    usePersistenceStore.getState()._setEvidenceApi(api, [RELPATH]);

    useDocumentStore.getState().dispatch(detachEvidence({ id: 'ev0000000001' }));
    await usePersistenceStore.getState().save();
    expect(usePersistenceStore.getState().status).toBe('saved');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(trashed).toEqual([RELPATH]);

    // Salvar de novo não repete o pedido: o caminho já não é reivindicado.
    useDocumentStore.getState().dispatch(detachEvidence({ id: 'ev0000000001' }));
    await usePersistenceStore.getState().save();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(trashed).toEqual([RELPATH]);
  });

  it('desanexar, desfazer e salvar não toca no arquivo', async () => {
    const { api, trashed } = trackingApi();
    await openSaved(documentWithAttachment());
    usePersistenceStore.getState()._setEvidenceApi(api, [RELPATH]);

    useDocumentStore.getState().dispatch(detachEvidence({ id: 'ev0000000001' }));
    useDocumentStore.getState().undo();
    await usePersistenceStore.getState().save();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(trashed).toEqual([]);
    expect(useDocumentStore.getState().document!.attachments).toHaveLength(1);
  });

  it('salvar com o vínculo intacto nunca pede nada ao servidor', async () => {
    const { api, trashed } = trackingApi();
    await openSaved(documentWithAttachment());
    usePersistenceStore.getState()._setEvidenceApi(api, [RELPATH]);

    await usePersistenceStore.getState().save();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(trashed).toEqual([]);
  });

  it('conflito ao salvar não move arquivo nenhum', async () => {
    const { api, trashed } = trackingApi();
    const doc = documentWithAttachment();
    const handle = fakeFileHandle('politicas.json', serialize(doc));
    const adapter = new FsaAdapter({ getActor: () => 'Arthur' });
    usePersistenceStore.getState()._setAdapter(adapter);
    await adapter.openFromDropHandle(handle);
    useDocumentStore.getState().openDocument(doc);
    usePersistenceStore.setState({ fileName: 'politicas.json' });
    usePersistenceStore.getState()._setEvidenceApi(api, [RELPATH]);

    useDocumentStore.getState().dispatch(detachEvidence({ id: 'ev0000000001' }));
    // Outra pessoa gravou por cima: o save vira conflito e não grava.
    handle.writeExternally(serialize({ ...doc, meta: { ...doc.meta, name: 'Delas', revision: 9 } }));
    await usePersistenceStore.getState().save();

    expect(usePersistenceStore.getState().conflict).not.toBeNull();
    expect(trashed).toEqual([]);
  });
});
