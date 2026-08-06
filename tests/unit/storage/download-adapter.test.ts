import { describe, expect, it } from 'vitest';
import { createSampleDocument } from '@/core/document/create';
import { serialize } from '@/core/document/serialize';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { DownloadAdapter } from '@/storage/download-adapter';
import { DOWNLOAD_ONLY_CONFLICT_WARNING } from '@/storage/conflict';
import { readDocumentFromBytes } from '@/storage/document-io';

/**
 * Modo `DOWNLOAD_ONLY` — docs/06-persistencia-e-concorrencia.md §2 e §11:
 * "save() produz o blob correto e a aplicação avisa da ausência de detecção
 * de conflito".
 */

function adapterWith(file?: File) {
  const downloads: Array<{ blob: Blob; fileName: string }> = [];
  const adapter = new DownloadAdapter({
    getActor: () => 'Arthur',
    now: () => new Date('2026-08-05T12:00:00.000Z'),
    pickFile: () => Promise.resolve(file ?? null),
    downloadBlob: (blob, fileName) => downloads.push({ blob, fileName }),
  });
  return { adapter, downloads };
}

describe('DownloadAdapter', () => {
  it('declara que não grava no lugar', () => {
    const { adapter } = adapterWith();
    expect(adapter.mode).toBe('DOWNLOAD_ONLY');
    expect(adapter.canWriteInPlace).toBe(false);
  });

  it('abre pelo seletor e devolve o documento com hash e tamanho', async () => {
    const doc = createSampleDocument();
    const text = serialize(doc);
    const { adapter } = adapterWith(new File([text], 'politicas.json'));

    const opened = await adapter.open();
    expect(opened.document).toEqual(doc);
    expect(opened.fileName).toBe('politicas.json');
    expect(opened.raw.bytes).toBe(new TextEncoder().encode(text).byteLength);
    expect(adapter.getHandleInfo()).toEqual({ name: 'politicas.json' });
  });

  it('abre por arrastar-e-soltar', async () => {
    const doc = createSampleDocument();
    const { adapter } = adapterWith();
    const opened = await adapter.openFromDrop(new File([serialize(doc)], 'arrastado.json'));
    expect(opened.document.meta.id).toBe(doc.meta.id);
  });

  it('save() produz o blob correto, carimbado e relegível', async () => {
    const doc = createSampleDocument();
    const { adapter, downloads } = adapterWith(new File([serialize(doc)], 'politicas.json'));
    await adapter.open();

    const result = await adapter.save({ ...doc, meta: { ...doc.meta, name: 'Baixado' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(doc.meta.revision + 1);
    expect(result.savedAt).toBe('2026-08-05T12:00:00.000Z');

    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.fileName).toBe('politicas.json');
    expect(downloads[0]!.blob.type).toBe('application/json');

    const bytes = new Uint8Array(await downloads[0]!.blob.arrayBuffer());
    const reread = await readDocumentFromBytes(bytes);
    const written: PolicyOpsDocument = reread.document;
    expect(written.meta.name).toBe('Baixado');
    expect(written.meta.savedBy).toBe('Arthur');
    expect(written.meta.revision).toBe(doc.meta.revision + 1);
    expect(reread.hash).toBe(result.hash);
  });

  it('sem arquivo aberto, sugere o nome a partir do documento', async () => {
    const doc = { ...createSampleDocument(), meta: { ...createSampleDocument().meta, name: 'Políticas PJ' } };
    const { adapter, downloads } = adapterWith();
    const result = await adapter.saveAs(doc);
    expect(result.ok).toBe(true);
    expect(downloads[0]!.fileName).toBe('politicas-pj.json');
  });

  it('documento inválido não vira download', async () => {
    const doc = createSampleDocument();
    const broken: PolicyOpsDocument = {
      ...doc,
      matrices: [
        {
          ...doc.matrices[0]!,
          versions: [
            { ...doc.matrices[0]!.versions[0]!, cells: { 'NAO::EXISTE': { decision: 'APROVA' } } },
          ],
        },
      ],
    };
    const { adapter, downloads } = adapterWith();
    const result = await adapter.save(broken);
    expect(result.ok).toBe(false);
    if (result.ok || result.reason === 'CONFLICT') return;
    expect(result.reason).toBe('IO');
    expect(downloads).toHaveLength(0);
  });

  it('não sabe reler, e por isso não há detecção de conflito', async () => {
    const { adapter } = adapterWith();
    expect(await adapter.reloadCurrent()).toBeNull();
    expect(await adapter.openRecent()).toBeNull();
    expect(adapter.getDirectory()).toBeNull();
    expect(await adapter.requestDirectoryAccess()).toBe(false);
    // O aviso que a interface mostra por causa disso (§5).
    expect(DOWNLOAD_ONLY_CONFLICT_WARNING).toContain('não detecta conflito');
  });

  it('cancelar o seletor vira AbortError', async () => {
    const { adapter } = adapterWith();
    await expect(adapter.open()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
