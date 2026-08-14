import { describe, expect, it } from 'vitest';
import {
  attachEvidence,
  attachmentRelPaths,
  detachEvidence,
  listAttachments,
  sameTarget,
} from '@/core/document/evidence';
import type { AttachEvidenceInput } from '@/core/document/evidence';
import type { AttachmentTarget, PolicyOpsDocument } from '@/core/document/schema';
import { serialize } from '@/core/document/serialize';
import { checkI25, checkI26, validateDocument } from '@/core/document/validate';
import {
  apply,
  baseDocument,
  createTestMatrix,
  documentWithAllStates,
  expectFailure,
  IDS,
  testCtx,
} from '../versioning/fixtures';

/**
 * Evidências — docs/14-plataforma-local.md §7, ADR-004.
 *
 * O que estes testes protegem, além do óbvio: **anexar não toca no snapshot da
 * versão** (é o que permite anexar a uma versão publicada sem ferir I3) e
 * **desanexar é reversível byte a byte** (é o que permite adiar a ida do
 * arquivo para a lixeira até o salvamento).
 */

const DOCX: Omit<AttachEvidenceInput, 'target'> = {
  fileName: '2026-08-14_DB 513 - Ajuste.docx',
  relPath: 'proj-a/mtz-a/v1/2026-08-14_DB 513 - Ajuste.docx',
  sha256: 'a'.repeat(64),
  bytes: 4096,
  addedBy: { username: 'arthur', displayName: 'Arthur' },
};

function projectTarget(): AttachmentTarget {
  return { kind: 'PROJECT', projectId: IDS.projectA };
}

describe('evidence/attach', () => {
  it('anexa ao projeto, com quem/quando, e registra o evento de auditoria', () => {
    const ctx = testCtx();
    const target = projectTarget();

    const anexado = apply(baseDocument(), ctx, attachEvidence({ ...DOCX, target, note: 'DB da mudança' }));

    expect(anexado.document.attachments).toHaveLength(1);
    const attachment = anexado.document.attachments![0]!;
    expect(attachment.fileName).toBe(DOCX.fileName);
    expect(attachment.relPath).toBe(DOCX.relPath);
    expect(attachment.sha256).toBe(DOCX.sha256);
    expect(attachment.addedBy).toEqual({ username: 'arthur', displayName: 'Arthur' });
    expect(attachment.addedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(attachment.note).toBe('DB da mudança');
    expect(attachment.target).toEqual(target);

    expect(anexado.result.events).toHaveLength(1);
    const event = anexado.result.events[0]!;
    expect(event.type).toBe('EVIDENCE_ATTACHED');
    expect(event.scope).toEqual({ projectId: IDS.projectA });
    expect(event.summary).toContain('DB 513');
    expect(event.payload).toMatchObject({ relPath: DOCX.relPath });
  });

  it('usa o id do servidor quando ele vem, e gera um quando não vem', () => {
    const ctx = testCtx();

    const comId = apply(baseDocument(), ctx, attachEvidence({ ...DOCX, id: 'Zx9_-abcDEF1', target: projectTarget() }));
    expect(comId.data.id).toBe('Zx9_-abcDEF1');

    // `ctx` novo: no primeiro caso o `newId` da sequência foi para o evento.
    const semId = apply(baseDocument(), testCtx(), attachEvidence({ ...DOCX, target: projectTarget() }));
    expect(semId.data.id).toBe('id-000000001');
  });

  it('recusa alvo inexistente (I25 nunca chega a ser violada pelo comando)', () => {
    const ctx = testCtx();
    const doc = baseDocument();

    expectFailure(
      doc,
      ctx,
      attachEvidence({ ...DOCX, target: { kind: 'PROJECT', projectId: 'nao_existe_' } }),
      'NOT_FOUND',
    );
    expectFailure(
      doc,
      ctx,
      attachEvidence({ ...DOCX, target: { kind: 'MATRIX', matrixId: 'nao_existe_' } }),
      'NOT_FOUND',
    );
  });

  it('recusa versão inexistente da matriz', () => {
    const ctx = testCtx();
    const criada = createTestMatrix(baseDocument(), ctx);

    expectFailure(
      criada.document,
      ctx,
      attachEvidence({ ...DOCX, target: { kind: 'VERSION', matrixId: criada.data.matrixId, versionNumber: 7 } }),
      'NOT_FOUND',
    );
  });

  it('recusa o mesmo arquivo do acervo duas vezes (I26)', () => {
    const ctx = testCtx();
    const primeiro = apply(baseDocument(), ctx, attachEvidence({ ...DOCX, target: projectTarget() }));

    expectFailure(
      primeiro.document,
      ctx,
      attachEvidence({ ...DOCX, target: { kind: 'PROJECT', projectId: IDS.projectB } }),
      'EVIDENCE_DUPLICATE_PATH',
    );
  });

  it('recusa anexo sem caminho ou sem hash — sem eles o arquivo não é rastreável', () => {
    const ctx = testCtx();
    const doc = baseDocument();

    expectFailure(doc, ctx, attachEvidence({ ...DOCX, relPath: '  ', target: projectTarget() }), 'INVALID_INPUT');
    expectFailure(doc, ctx, attachEvidence({ ...DOCX, sha256: '', target: projectTarget() }), 'INVALID_INPUT');
  });

  it('é append-only por alvo: anexo novo entra no fim da lista daquele alvo', () => {
    const ctx = testCtx();
    const target = projectTarget();

    let doc = apply(baseDocument(), ctx, attachEvidence({ ...DOCX, target })).document;
    doc = apply(doc, ctx, attachEvidence({ ...DOCX, relPath: 'proj-a/outro.pdf', fileName: 'outro.pdf', target })).document;
    doc = apply(doc, ctx, attachEvidence({ ...DOCX, relPath: 'proj-b/terceiro.pdf', fileName: 'terceiro.pdf', target: { kind: 'PROJECT', projectId: IDS.projectB } })).document;

    expect(listAttachments(doc, target).map((a) => a.fileName)).toEqual([DOCX.fileName, 'outro.pdf']);
    expect(attachmentRelPaths(doc)).toHaveLength(3);
  });
});

describe('evidência em versão publicada', () => {
  it('é permitida e não altera o snapshot da versão (docs/14 §7)', () => {
    const ctx = testCtx();
    const estados = documentWithAllStates(ctx);
    const publicada = estados.document.matrices[0]!.versions.find((v) => v.state === 'PUBLISHED')!;
    const antes = structuredClone(publicada);

    const anexado = apply(
      estados.document,
      ctx,
      attachEvidence({
        ...DOCX,
        target: { kind: 'VERSION', matrixId: estados.matrixId, versionNumber: publicada.number },
      }),
    );

    const depois = anexado.document.matrices[0]!.versions.find((v) => v.id === publicada.id)!;
    // Deep equal: nem células, nem eixos, nem estado, nem data de publicação.
    expect(depois).toEqual(antes);
    expect(anexado.document.attachments).toHaveLength(1);
    // I3 continua valendo: o documento inteiro segue válido.
    expect(validateDocument(anexado.document).ok).toBe(true);
  });

  it('registra o evento no escopo da versão certa', () => {
    const ctx = testCtx();
    const estados = documentWithAllStates(ctx);
    const publicada = estados.document.matrices[0]!.versions.find((v) => v.state === 'PUBLISHED')!;

    const anexado = apply(
      estados.document,
      ctx,
      attachEvidence({
        ...DOCX,
        target: { kind: 'VERSION', matrixId: estados.matrixId, versionNumber: publicada.number },
      }),
    );

    expect(anexado.result.events[0]!.scope).toEqual({
      projectId: IDS.projectA,
      matrixId: estados.matrixId,
      versionId: publicada.id,
    });
  });
});

describe('evidence/detach', () => {
  it('tira o vínculo, registra o evento e some com a lista quando esvazia', () => {
    const ctx = testCtx();
    const anexado = apply(baseDocument(), ctx, attachEvidence({ ...DOCX, target: projectTarget() }));

    const desanexado = apply(anexado.document, ctx, detachEvidence({ id: anexado.data.id }));

    expect('attachments' in desanexado.document).toBe(false);
    expect(desanexado.result.events[0]!.type).toBe('EVIDENCE_DETACHED');
    // O texto diz o que vai acontecer com o arquivo — e quando (docs/14 §7).
    expect(desanexado.result.events[0]!.summary).toContain('lixeira');
    expect(serialize(desanexado.document)).not.toContain('attachments');
  });

  it('o inverso restaura o registro exato, na mesma posição', () => {
    const ctx = testCtx();
    const target = projectTarget();
    let doc: PolicyOpsDocument = baseDocument();
    doc = apply(doc, ctx, attachEvidence({ ...DOCX, target, note: 'primeiro' })).document;
    doc = apply(doc, ctx, attachEvidence({ ...DOCX, relPath: 'proj-a/b.pdf', fileName: 'b.pdf', target })).document;
    doc = apply(doc, ctx, attachEvidence({ ...DOCX, relPath: 'proj-a/c.pdf', fileName: 'c.pdf', target })).document;
    const antes = doc;
    const alvo = doc.attachments![1]!;

    // Desanexa o **do meio** — o caso em que "append no fim" não bastaria.
    const desanexado = apply(doc, ctx, detachEvidence({ id: alvo.id }));
    expect(desanexado.document.attachments!.map((a) => a.fileName)).toEqual([DOCX.fileName, 'c.pdf']);

    const desfeito = apply(desanexado.document, ctx, desanexado.result.inverse);
    expect(desfeito.document.attachments).toEqual(antes.attachments);
    expect(desfeito.document.attachments![1]).toEqual(alvo);

    // E refazer volta ao estado desanexado.
    const refeito = apply(desfeito.document, ctx, desfeito.result.inverse);
    expect(refeito.document.attachments).toEqual(desanexado.document.attachments);
  });

  it('desfazer não depende do arquivo: o vínculo volta com o mesmo caminho e hash', () => {
    const ctx = testCtx();
    const anexado = apply(baseDocument(), ctx, attachEvidence({ ...DOCX, target: projectTarget() }));
    const desanexado = apply(anexado.document, ctx, detachEvidence({ id: anexado.data.id }));

    const desfeito = apply(desanexado.document, ctx, desanexado.result.inverse);

    expect(attachmentRelPaths(desfeito.document)).toEqual([DOCX.relPath]);
    expect(desfeito.document.attachments![0]!.sha256).toBe(DOCX.sha256);
    expect(desfeito.document.attachments![0]!.id).toBe(anexado.data.id);
  });

  it('recusa id que não está anexado', () => {
    const ctx = testCtx();
    expectFailure(baseDocument(), ctx, detachEvidence({ id: 'nao_existe_' }), 'EVIDENCE_NOT_FOUND');
  });
});

describe('sameTarget', () => {
  it('distingue alvo por tipo e por identidade', () => {
    expect(sameTarget(projectTarget(), { kind: 'PROJECT', projectId: IDS.projectA })).toBe(true);
    expect(sameTarget(projectTarget(), { kind: 'PROJECT', projectId: IDS.projectB })).toBe(false);
    expect(sameTarget(projectTarget(), { kind: 'MATRIX', matrixId: IDS.projectA })).toBe(false);
    expect(
      sameTarget(
        { kind: 'VERSION', matrixId: IDS.projectA, versionNumber: 1 },
        { kind: 'VERSION', matrixId: IDS.projectA, versionNumber: 2 },
      ),
    ).toBe(false);
  });
});

describe('I25 / I26', () => {
  function docWith(attachments: PolicyOpsDocument['attachments']): PolicyOpsDocument {
    return { ...baseDocument(), attachments };
  }

  const base = {
    kind: 'EVIDENCE' as const,
    id: 'ev0000000001',
    fileName: 'a.docx',
    relPath: 'proj-a/a.docx',
    sha256: 'a'.repeat(64),
    bytes: 1,
    addedBy: { username: 'arthur' },
    addedAt: '2026-01-01T00:00:00.000Z',
  };

  it('documento sem anexos não gera problema nenhum', () => {
    expect(checkI25(baseDocument())).toEqual([]);
    expect(checkI26(baseDocument())).toEqual([]);
  });

  it('I25 denuncia alvo inexistente — projeto, matriz e versão', () => {
    const doc = docWith([
      { ...base, target: { kind: 'PROJECT', projectId: 'sumiu______' } },
      { ...base, id: 'ev0000000002', relPath: 'b.docx', target: { kind: 'MATRIX', matrixId: 'sumiu______' } },
    ]);

    const issues = checkI25(doc);

    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.severity === 'ERROR' && issue.invariant === 'I25')).toBe(true);
    expect(validateDocument(doc).ok).toBe(false);
  });

  it('I25 denuncia número de versão que não existe na matriz', () => {
    const ctx = testCtx();
    const criada = createTestMatrix(baseDocument(), ctx);
    const doc: PolicyOpsDocument = {
      ...criada.document,
      attachments: [{ ...base, target: { kind: 'VERSION', matrixId: criada.data.matrixId, versionNumber: 99 } }],
    };

    expect(checkI25(doc).map((issue) => issue.path)).toEqual(['attachments[0].target']);
  });

  it('I26 denuncia relPath repetido e campos em branco', () => {
    const doc = docWith([
      { ...base, target: { kind: 'PROJECT', projectId: IDS.projectA } },
      { ...base, id: 'ev0000000002', target: { kind: 'PROJECT', projectId: IDS.projectB } },
      { ...base, id: 'ev0000000003', relPath: '   ', sha256: '  ', target: { kind: 'PROJECT', projectId: IDS.projectA } },
    ]);

    const issues = checkI26(doc);

    expect(issues.map((issue) => issue.path)).toEqual([
      'attachments[1].relPath',
      'attachments[2].relPath',
      'attachments[2].sha256',
    ]);
    expect(issues.every((issue) => issue.severity === 'ERROR')).toBe(true);
  });
});

describe('schema e serialização', () => {
  it('anexos sobrevivem ao round-trip com as chaves em ordem canônica', () => {
    const ctx = testCtx();
    const doc = apply(
      baseDocument(),
      ctx,
      attachEvidence({ ...DOCX, target: projectTarget(), note: 'nota' }),
    ).document;

    const texto = serialize(doc);
    const relido = validateDocument(JSON.parse(texto));

    expect(relido.ok).toBe(true);
    expect((relido as { ok: true; document: PolicyOpsDocument }).document.attachments).toEqual(doc.attachments);
    // `attachments` vem depois de `importProfiles` e antes de `events` (docs/03 §1).
    expect(Object.keys(JSON.parse(texto))).toEqual([
      'schemaVersion',
      'meta',
      'variables',
      'compatibility',
      'catalog',
      'projects',
      'matrices',
      'templates',
      'importProfiles',
      'components',
      'changeRequests',
      'releases',
      'attachments',
      'events',
    ]);
  });

  it('schemaVersion 5: um documento sem anexos não ganha a chave attachments', () => {
    const doc = baseDocument();

    expect(doc.schemaVersion).toBe(5);
    expect(serialize(doc)).not.toContain('attachments');
    expect(validateDocument(JSON.parse(serialize(doc))).ok).toBe(true);
  });
});
