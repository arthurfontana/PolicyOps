import { describe, expect, it } from 'vitest';
import type { Attachment, PolicyOpsDocument } from '@/core/document/schema';
import { DomainError } from '@/core/errors';
import {
  EvidenceApi,
  MAX_EVIDENCE_BYTES,
  explorerPath,
  formatBytes,
  localDateStamp,
  targetCodes,
} from '@/storage/evidences';
import { createSampleDocument } from '@/core/document/create';

/**
 * Cliente das rotas de evidência — docs/14-plataforma-local.md §4 e §7.
 *
 * O que interessa aqui é o **contrato com o servidor** (o que sai na
 * requisição) e a **tradução dos erros**: 413, `HASH_MISMATCH` e 404 de arquivo
 * movido à mão precisam virar frase em português com o caminho do Explorer
 * dentro, que é a única informação acionável nesses três casos.
 */

type Call = { url: string; init?: RequestInit };

function apiWith(
  responder: (call: Call) => Response | Promise<Response>,
  calls: Call[] = [],
): { api: EvidenceApi; calls: Call[] } {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return await responder(call);
  }) as typeof fetch;
  return {
    api: new EvidenceApi({ token: 'token-de-teste', fetchImpl, dataDir: '\\\\rede\\Politicas' }),
    calls,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-PolicyOps-Api': '1' },
  });
}

const ANEXO: Attachment = {
  id: 'ev0000000001',
  fileName: '2026-08-14_DB 513.docx',
  relPath: 'politica-pf/mtz-limite-pf/v1/2026-08-14_DB 513.docx',
  sha256: 'a'.repeat(64),
  bytes: 2048,
  addedBy: { username: 'arthur' },
  addedAt: '2026-08-14T12:00:00.000Z',
  target: { kind: 'VERSION', matrixId: 'AawxBqMiUUVA', versionNumber: 1 },
};

function docx(bytes = 8): File {
  return new File([new Uint8Array(bytes)], 'DB 513.docx');
}

describe('EvidenceApi.upload', () => {
  it('manda o arquivo e os códigos do alvo, com o token do boot', async () => {
    const { api, calls } = apiWith(() =>
      json(201, {
        id: 'ev0000000001',
        relPath: 'politica-pf/mtz-limite-pf/v1/2026-08-14_DB 513.docx',
        fileName: '2026-08-14_DB 513.docx',
        sha256: 'a'.repeat(64),
        bytes: 8,
      }),
    );

    const result = await api.upload({
      file: docx(),
      projectCode: 'POLITICA_PF',
      matrixCode: 'MTZ_LIMITE_PF',
      versionNumber: 1,
      date: '2026-08-14',
    });

    expect(result.relPath).toBe('politica-pf/mtz-limite-pf/v1/2026-08-14_DB 513.docx');
    expect(calls[0]!.url).toBe('/api/evidences');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(new Headers(calls[0]!.init?.headers).get('X-PolicyOps-Token')).toBe('token-de-teste');

    const form = calls[0]!.init?.body as FormData;
    expect(form.get('project')).toBe('POLITICA_PF');
    expect(form.get('matrix')).toBe('MTZ_LIMITE_PF');
    expect(form.get('version')).toBe('1');
    expect(form.get('date')).toBe('2026-08-14');
    expect((form.get('file') as File).name).toBe('DB 513.docx');
  });

  it('alvo de projeto não manda matriz nem versão', async () => {
    const { api, calls } = apiWith(() => json(201, { id: 'x', relPath: 'p/a.pdf', fileName: 'a.pdf', sha256: 'b', bytes: 1 }));

    await api.upload({ file: docx(), projectCode: 'POLITICA_PF', date: '2026-08-14' });

    const form = calls[0]!.init?.body as FormData;
    expect(form.get('matrix')).toBeNull();
    expect(form.get('version')).toBeNull();
  });

  it('arquivo grande demais nem sai da máquina', async () => {
    const { api, calls } = apiWith(() => json(201, {}));
    const enorme = { size: MAX_EVIDENCE_BYTES + 1, name: 'gigante.zip' } as File;

    await expect(
      api.upload({ file: enorme, projectCode: 'P', date: '2026-08-14' }),
    ).rejects.toThrow(/limite por evidência é 50\.0 MB/);
    expect(calls).toHaveLength(0);
  });

  it('413 do servidor vira a mesma mensagem clara', async () => {
    const { api } = apiWith(() => json(413, { code: 'TOO_LARGE', detail: 'passa do limite' }));

    await expect(api.upload({ file: docx(), projectCode: 'P', date: '2026-08-14' })).rejects.toThrow(
      /limite por evidência/,
    );
  });

  it('403 vira ROLE_REQUIRED com o motivo do servidor', async () => {
    const { api } = apiWith(() => json(403, { code: 'FORBIDDEN', detail: 'Seu papel neste documento é READER.' }));

    await api.upload({ file: docx(), projectCode: 'P', date: '2026-08-14' }).then(
      () => expect.unreachable('deveria ter falhado'),
      (error: unknown) => {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe('ROLE_REQUIRED');
        expect((error as DomainError).message).toContain('READER');
      },
    );
  });

  it('servidor fora do ar pergunta se ele foi fechado', async () => {
    const { api } = apiWith(() => {
      throw new TypeError('Failed to fetch');
    });

    await expect(api.upload({ file: docx(), projectCode: 'P', date: '2026-08-14' })).rejects.toThrow(
      /servidor local/,
    );
  });
});

describe('EvidenceApi.download', () => {
  it('pede o arquivo com o caminho e o hash registrados no documento', async () => {
    const { api, calls } = apiWith(() => new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 }));

    const blob = await api.download(ANEXO);

    expect(blob.size).toBe(3);
    const url = new URL(calls[0]!.url, 'http://127.0.0.1');
    expect(url.pathname).toBe('/api/evidences/ev0000000001');
    expect(url.searchParams.get('relPath')).toBe(ANEXO.relPath);
    expect(url.searchParams.get('sha256')).toBe(ANEXO.sha256);
  });

  it('HASH_MISMATCH explica que o arquivo não vale mais como prova, e onde ele está', async () => {
    const { api } = apiWith(() =>
      json(409, { code: 'HASH_MISMATCH', detail: 'O conteúdo não é mais o que foi anexado.' }),
    );

    await expect(api.download(ANEXO)).rejects.toThrow(/não confere com o hash registrado/);
    await expect(api.download(ANEXO)).rejects.toThrow(/\\\\rede\\Politicas\\_evidencias\\politica-pf/);
  });

  it('404 diz o caminho esperado e lembra da lixeira', async () => {
    const { api } = apiWith(() => json(404, { code: 'NOT_FOUND', detail: 'O arquivo não está lá.' }));

    await api.download(ANEXO).then(
      () => expect.unreachable('deveria ter falhado'),
      (error: unknown) => {
        expect((error as DomainError).code).toBe('EVIDENCE_NOT_FOUND');
        expect((error as DomainError).message).toContain('_evidencias\\politica-pf\\mtz-limite-pf\\v1');
        expect((error as DomainError).message).toContain('_lixeira');
      },
    );
  });
});

describe('EvidenceApi.trash', () => {
  it('manda DELETE com o caminho e devolve se moveu', async () => {
    const { api, calls } = apiWith(() => json(200, { trashed: true, relPath: '_lixeira/p/a.docx' }));

    expect(await api.trash('p/a.docx', 'ev0000000001')).toBe(true);
    expect(calls[0]!.init?.method).toBe('DELETE');
    expect(new URL(calls[0]!.url, 'http://127.0.0.1').searchParams.get('relPath')).toBe('p/a.docx');
  });

  it('arquivo que já não estava lá não é erro', async () => {
    const { api } = apiWith(() => json(200, { trashed: false, relPath: null }));

    expect(await api.trash('p/a.docx')).toBe(false);
  });
});

describe('helpers', () => {
  it('explorerPath monta o caminho que se digita no Explorer', () => {
    expect(explorerPath('politica-pf/v1/a.docx', '\\\\rede\\Politicas')).toBe(
      '\\\\rede\\Politicas\\_evidencias\\politica-pf\\v1\\a.docx',
    );
    expect(explorerPath('politica-pf/a.docx')).toBe('_evidencias\\politica-pf\\a.docx');
  });

  it('formatBytes usa a unidade que a pessoa lê', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('localDateStamp usa o fuso de quem anexa, não UTC', () => {
    // 23:30 local de 14/08 continua sendo 14/08 no nome do arquivo.
    expect(localDateStamp(new Date(2026, 7, 14, 23, 30))).toBe('2026-08-14');
  });

  it('targetCodes traduz o alvo nos códigos que viram pasta', () => {
    const doc: PolicyOpsDocument = createSampleDocument();
    const project = doc.projects[0]!;
    const matrix = doc.matrices.find((candidate) => candidate.projectId === project.id)!;

    expect(targetCodes(doc, { kind: 'PROJECT', projectId: project.id })).toEqual({
      projectCode: project.code,
    });
    expect(targetCodes(doc, { kind: 'MATRIX', matrixId: matrix.id })).toEqual({
      projectCode: project.code,
      matrixCode: matrix.code,
    });
    expect(targetCodes(doc, { kind: 'VERSION', matrixId: matrix.id, versionNumber: 1 })).toEqual({
      projectCode: project.code,
      matrixCode: matrix.code,
      versionNumber: 1,
    });
    expect(targetCodes(doc, { kind: 'PROJECT', projectId: 'sumiu______' })).toBeNull();
  });
});
