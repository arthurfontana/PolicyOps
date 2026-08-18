import { describe, expect, it } from 'vitest';
import { checkGovernanceRefs, checkI30, checkI31, validateDocument } from '@/core/document/validate';
import type { ChangeRequest, PolicyOpsDocument } from '@/core/document/schema';
import { deserialize, serialize } from '@/core/document/serialize';
import { createRelease } from '@/core/document/releases';
import { setChangeRequestRelease } from '@/core/document/change-requests';
import { apply, testCtx, type TestCtx } from '../versioning/fixtures';
import { avancarAte, dbSubmetivel, politica, type GovernanceScenario } from './governance-fixtures';

/**
 * I30 e I31 — o DB e a release em repouso (`14-governanca-de-alteracoes.md` §6,
 * `03-modelo-do-documento.md` §9).
 *
 * O documento de partida é montado pelos comandos da própria sessão (é o único
 * jeito de ter um DB bem formado sem escrever 60 linhas de literal), e cada
 * caso adultera **uma** coisa — mesmo espírito dos `defect-*.json` e do teste de
 * I27–I29.
 *
 * O que **não** dá para conferir aqui: a metade temporal de I30 ("itens
 * imutáveis a partir de APPROVED"). Um documento parado não sabe se o item
 * mudou — quem garante isso é `assertItemsEditable`, coberto em
 * `change-requests.test.ts` (CT-GOV-04).
 */

function base(ctx: TestCtx): { document: PolicyOpsDocument; cena: GovernanceScenario } {
  const cena = politica(ctx);
  const { document } = dbSubmetivel(cena.document, ctx, cena.goodlistId);
  return { document, cena };
}

function adulterado(
  doc: PolicyOpsDocument,
  mutate: (doc: PolicyOpsDocument, cr: ChangeRequest) => void,
): PolicyOpsDocument {
  const clone = structuredClone(doc);
  mutate(clone, clone.changeRequests[0]!);
  return clone;
}

describe('documento de partida', () => {
  it('é válido, com DB e release limpos', () => {
    const ctx = testCtx();
    const { document } = base(ctx);
    // Vincular a uma release exige status ≥ APPROVED (docs/14 §3.4, S37).
    const aprovado = avancarAte(document, ctx, document.changeRequests[0]!.id, 'APPROVED');
    const comRelease = apply(aprovado, ctx, createRelease({ code: '2026.09.01' }));
    const vinculado = apply(
      comRelease.document,
      ctx,
      setChangeRequestRelease({
        changeRequestId: document.changeRequests[0]!.id,
        releaseId: comRelease.data.releaseId,
      }),
    ).document;

    expect(checkI30(vinculado)).toEqual([]);
    expect(checkI31(vinculado)).toEqual([]);
    expect(checkGovernanceRefs(vinculado)).toEqual([]);
    expect(validateDocument(vinculado).ok).toBe(true);
  });

  it('sobrevive ao round-trip de serialização, trilha do DB incluída', () => {
    const ctx = testCtx();
    const { document } = base(ctx);
    const voltou = validateDocument(deserialize(serialize(document)));

    expect(voltou.ok).toBe(true);
    if (!voltou.ok) return;
    expect(voltou.document.changeRequests).toEqual(document.changeRequests);
    expect(voltou.document.changeRequests[0]!.events.map((event) => event.type)).toEqual([
      'CR_CREATED',
      'CR_ITEM_CHANGED',
    ]);
  });
});

describe('I30 — itens do DB', () => {
  it('acusa o mesmo componente em dois itens (RN-GOV-02)', () => {
    const ctx = testCtx();
    const { document } = base(ctx);
    const doc = adulterado(document, (_doc, cr) => {
      cr.items.push(structuredClone(cr.items[0]!));
    });

    const issues = checkI30(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'ERROR', invariant: 'I30', path: 'changeRequests[0].items[1]' });
    expect(issues[0]!.message).toContain('uma vez só por DB');
    expect(validateDocument(doc).ok).toBe(false);
  });

  it('acusa item apontando componente que não existe', () => {
    const ctx = testCtx();
    const { document } = base(ctx);
    const doc = adulterado(document, (_doc, cr) => {
      cr.items[0]!.componentId = 'sumiu0000001';
    });

    const issues = checkI30(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('componente que não existe');
  });

  it('acusa versão base e rascunho inexistentes', () => {
    const ctx = testCtx();
    const { document } = base(ctx);

    const semBase = adulterado(document, (_doc, cr) => {
      cr.items[0]!.baseVersionId = 'sumiu0000001';
    });
    expect(checkI30(semBase)[0]).toMatchObject({
      invariant: 'I30',
      path: 'changeRequests[0].items[0].baseVersionId',
    });

    const semRascunho = adulterado(document, (_doc, cr) => {
      cr.items[0]!.draftVersionId = 'sumiu0000001';
    });
    expect(checkI30(semRascunho)[0]!.message).toContain('rascunho que não existe');
  });

  it('acusa vínculo com versão que não é mais rascunho', () => {
    const ctx = testCtx();
    const { document, cena } = base(ctx);
    const doc = adulterado(document, (clone, cr) => {
      cr.items[0]!.draftVersionId = cena.goodlistV1;
      void clone;
    });

    const issues = checkI30(doc);
    // A versão publicada não é rascunho **e** não aponta de volta para o DB.
    expect(issues.map((issue) => issue.message.includes('não é mais rascunho'))).toContain(true);
    expect(issues.map((issue) => issue.message.includes('não aponta de volta'))).toContain(true);
  });

  it('acusa rascunho que aponta outro DB (segunda metade de I30)', () => {
    const ctx = testCtx();
    const { document, cena } = base(ctx);
    const doc = adulterado(document, (clone, cr) => {
      const componente = clone.components.find((candidate) => candidate.id === cena.goodlistId)!;
      componente.versions.push({
        id: 'rasc00000001',
        number: 2,
        state: 'DRAFT',
        createdAt: '2026-02-01T00:00:00.000Z',
        createdBy: 'Arthur',
        changeRequestId: 'outrodb00001',
        payload: { kind: 'RULE', businessDescription: 'Proposta de outro DB.' },
      });
      cr.items[0]!.draftVersionId = 'rasc00000001';
    });

    const issues = checkI30(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('não aponta de volta');
  });

  it('item de espelho de matriz é conferido contra as versões da matriz', () => {
    const ctx = testCtx();
    const { document, cena } = base(ctx);

    const valido = adulterado(document, (_doc, cr) => {
      cr.items.push({
        componentId: cena.espelhoId,
        changeType: 'UPDATE',
        draftVersionId: cena.matrixDraftId,
        proposedSummary: 'Corte novo.',
      });
    });
    expect(checkI30(valido)).toEqual([]);

    const invalido = adulterado(valido, (_doc, cr) => {
      cr.items[1]!.draftVersionId = cena.goodlistV1;
      cr.items[1]!.baseVersionId = cena.goodlistV1;
    });
    const issues = checkI30(invalido);
    expect(issues.map((issue) => issue.path)).toEqual([
      'changeRequests[0].items[1].baseVersionId',
      'changeRequests[0].items[1].draftVersionId',
    ]);
    // Espelho de matriz não é cobrado do `changeRequestId` de volta — a
    // `MatrixVersion` não tem esse campo (docs/14 §3.3).
    expect(issues.some((issue) => issue.message.includes('não aponta de volta'))).toBe(false);
  });

  it('espelho sem matriz correspondente reporta o rascunho como inexistente', () => {
    const ctx = testCtx();
    const { document, cena } = base(ctx);
    const doc = adulterado(document, (clone, cr) => {
      cr.items.push({
        componentId: cena.espelhoId,
        changeType: 'UPDATE',
        draftVersionId: cena.matrixDraftId,
        proposedSummary: 'Corte novo.',
      });
      clone.matrices = [];
    });

    expect(checkI30(doc)[0]!.message).toContain('rascunho que não existe');
  });
});

describe('I31 — código de DB e de release', () => {
  it('acusa dois DBs com o mesmo código', () => {
    const ctx = testCtx();
    const { document } = base(ctx);
    const doc = adulterado(document, (clone, cr) => {
      const copia = structuredClone(cr);
      copia.id = 'cr0000000002';
      clone.changeRequests.push(copia);
    });

    const issues = checkI31(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ invariant: 'I31', path: 'changeRequests[1].code' });
    expect(validateDocument(doc).ok).toBe(false);
  });

  it('acusa duas releases com o mesmo código', () => {
    const ctx = testCtx();
    const { document } = base(ctx);
    const criada = apply(document, ctx, createRelease({ code: '2026.09.01' })).document;
    const doc = structuredClone(criada);
    doc.releases.push({ ...structuredClone(doc.releases[0]!), id: 'rel000000002' });

    const issues = checkI31(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ invariant: 'I31', path: 'releases[1].code' });
  });
});

describe('vínculos de governança (GOV-REF)', () => {
  it('acusa release inexistente, motivador e categoria de impacto fora do catálogo', () => {
    const ctx = testCtx();
    const { document } = base(ctx);
    const doc = adulterado(document, (_clone, cr) => {
      cr.releaseId = 'sumiu0000001';
      cr.motivators = ['NAO_EXISTE'];
      cr.impacts = [{ category: 'TAMBEM_NAO' }];
    });

    const issues = checkGovernanceRefs(doc);
    expect(issues.map((issue) => issue.path)).toEqual([
      'changeRequests[0].releaseId',
      'changeRequests[0].motivators[0]',
      'changeRequests[0].impacts[0].category',
    ]);
    expect(issues.every((issue) => issue.autoFix === 'CLEAR_REF')).toBe(true);
    expect(validateDocument(doc).ok).toBe(false);
  });
});
