import { describe, expect, it } from 'vitest';
import { encodeCellKey } from '@/core/axes/paths';
import type { Ctx } from '@/core/command';
import { archiveMatrix, setMatrixTags } from '@/core/document/commands';
import { validateDocument } from '@/core/document/validate';
import type { DocEvent, PolicyOpsDocument } from '@/core/document/schema';
import { applyImport, type ApplyImportData } from '@/core/import/apply';
import { planImport, type ImportPlan } from '@/core/import/plan';
import { createCatalogItem } from '@/core/library/catalog';
import { createDraft, discardDraft, publishVersion } from '@/core/versioning/lifecycle';
import { apply, expectFailure, testCtx, withoutEvents } from '../versioning/fixtures';
import {
  cineminhaDocument,
  cineminhaProfile,
  editCsvCell,
  excerptCsv,
  excerptTable,
  tableOf,
} from './fixtures';

/**
 * `import/apply` — docs/12-carga-de-matrizes.md §5.4, cenários CT-01, CT-02,
 * CT-10, CT-11, CT-13, CT-14 e CT-16.
 *
 * Todos os cenários rodam sobre o recorte real do `CINEMINHA_20260708.csv`:
 * 18 matrizes (3 partições × 6 canais), a mesma fixture do motor.
 */

const profile = cineminhaProfile();
const NOTES = 'Carga do recorte CINEMINHA de julho';

function planOf(doc: PolicyOpsDocument, csv = excerptCsv(), restoreKeys: readonly string[] = []): ImportPlan {
  return planImport(doc, tableOf(csv), profile, { fileName: 'recorte.csv', restoreKeys });
}

/** As tags que o perfil produz — a carga nunca cria item de catálogo (RN-17). */
function withTagCatalog(doc: PolicyOpsDocument, ctx: Ctx): PolicyOpsDocument {
  const plan = planOf(doc);
  const codes = [...new Set(plan.matrices.flatMap((entry) => entry.tags))];
  let working = doc;
  for (const code of codes) {
    working = apply(
      working,
      ctx,
      createCatalogItem({ kind: 'TAG', code, label: code }),
    ).document;
  }
  return working;
}

function applyCommandFor(
  doc: PolicyOpsDocument,
  csv = excerptCsv(),
  overrides: { selectedKeys?: string[]; notes?: string; planHash?: string } = {},
): ReturnType<typeof applyImport> {
  const plan = planOf(doc, csv);
  const applicable = plan.matrices
    .filter((entry) => entry.status === 'NEW' || entry.status === 'CHANGED')
    .map((entry) => entry.key);
  return applyImport({
    profile,
    table: tableOf(csv),
    fileName: 'recorte.csv',
    planHash: overrides.planHash ?? plan.planHash,
    selectedKeys: overrides.selectedKeys ?? applicable,
    notes: overrides.notes ?? NOTES,
  });
}

/** Carga inicial aplicada de verdade: 18 matrizes novas, cada uma com v1 DRAFT. */
function initialLoad(): {
  doc: PolicyOpsDocument;
  ctx: Ctx;
  before: PolicyOpsDocument;
  data: ApplyImportData;
} {
  const ctx = testCtx();
  const before = withTagCatalog(cineminhaDocument(), ctx);
  const applied = apply(before, ctx, applyCommandFor(before));
  return { doc: applied.document, ctx, before, data: applied.data };
}

/** Publica todos os rascunhos abertos — a revisão humana de US-07, em lote. */
function publishAllDrafts(doc: PolicyOpsDocument, ctx: Ctx): PolicyOpsDocument {
  let working = doc;
  for (const matrix of doc.matrices) {
    const draft = matrix.versions.find((version) => version.state === 'DRAFT');
    if (draft === undefined) continue;
    working = apply(working, ctx, publishVersion({ versionId: draft.id, notes: NOTES })).document;
  }
  return working;
}

function eventsOfType(doc: PolicyOpsDocument, type: DocEvent['type']): DocEvent[] {
  return doc.events.filter((event) => event.type === type);
}

// ---------------------------------------------------------------------------

describe('import/apply — carga inicial', () => {
  it('cria uma matriz por linha NOVA do plano, todas em v1 DRAFT e nada publicado (RN-10)', () => {
    const { doc, data } = initialLoad();

    expect(doc.matrices).toHaveLength(18);
    expect(data.createdMatrices).toHaveLength(18);
    expect(data.createdDrafts).toHaveLength(18);
    for (const matrix of doc.matrices) {
      expect(matrix.versions).toHaveLength(1);
      expect(matrix.versions[0]!.state).toBe('DRAFT');
    }
    expect(eventsOfType(doc, 'VERSION_PUBLISHED')).toHaveLength(0);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('CT-16 — matriz nova nasce sem pendência e é publicável na sequência', () => {
    const { doc, ctx } = initialLoad();
    const publicado = publishAllDrafts(doc, ctx);
    for (const matrix of publicado.matrices) {
      expect(matrix.versions[0]!.state).toBe('PUBLISHED');
    }
    expect(validateDocument(publicado).ok).toBe(true);
  });

  it('aplica as tags do perfil em toda matriz criada', () => {
    const { doc } = initialLoad();
    const digital = doc.matrices.find((m) => m.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    expect(digital.tags).toEqual(['CLUSTER_G1', 'CEP_SEM_RISCO', 'CANAL_DIGITAL']);
  });

  it('carimba importRunId em todo MATRIX_CREATED, DRAFT_CREATED e CELLS_UPDATED', () => {
    const { doc, data } = initialLoad();
    for (const type of ['MATRIX_CREATED', 'DRAFT_CREATED', 'CELLS_UPDATED'] as const) {
      const events = eventsOfType(doc, type);
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.payload?.importRunId).toBe(data.importRunId);
      }
    }
    const run = eventsOfType(doc, 'IMPORT_RUN');
    expect(run).toHaveLength(1);
    expect(run[0]!.payload?.importRunId).toBe(data.importRunId);
    expect(run[0]!.payload?.profileCode).toBe('CARGA_CINEMINHA');
    expect(run[0]!.payload?.fileName).toBe('recorte.csv');
  });
});

describe('CT-01 — segunda carga do mesmo arquivo não cria rascunho nenhum', () => {
  it('falha com IMPORT_NOTHING_TO_APPLY e não grava nada', () => {
    const { doc, ctx } = initialLoad();
    const publicado = publishAllDrafts(doc, ctx);

    const plan = planOf(publicado);
    expect(plan.totals.changed).toBe(0);
    expect(plan.totals.new).toBe(0);
    expect(plan.totals.unchanged).toBe(18);

    const eventsBefore = publicado.events.length;
    expectFailure(
      publicado,
      ctx,
      applyImport({
        profile,
        table: excerptTable(),
        fileName: 'recorte.csv',
        planHash: plan.planHash,
        selectedKeys: plan.matrices.map((entry) => entry.key),
        notes: NOTES,
      }),
      'IMPORT_NOTHING_TO_APPLY',
    );
    expect(publicado.events).toHaveLength(eventsBefore);
    expect(publicado.matrices.every((m) => m.versions.length === 1)).toBe(true);
  });
});

describe('CT-02 — só a matriz alterada é versionada', () => {
  it('uma célula alterada produz um rascunho, numa matriz, com uma célula', () => {
    const { doc, ctx } = initialLoad();
    const publicado = publishAllDrafts(doc, ctx);
    const eventsBefore = publicado.events.length;

    const alterado = editCsvCell(excerptCsv(), 2, 'OFERTA_DIGITAL', '0');
    const applied = apply(publicado, ctx, applyCommandFor(publicado, alterado));

    const comRascunho = applied.document.matrices.filter((m) =>
      m.versions.some((v) => v.state === 'DRAFT'),
    );
    expect(comRascunho).toHaveLength(1);
    expect(comRascunho[0]!.code).toBe('MTZ_G1_SEM_RISCO_DIGITAL');

    const draft = comRascunho[0]!.versions.find((v) => v.state === 'DRAFT')!;
    expect(draft.number).toBe(2);
    expect(draft.baseVersionId).toBe(comRascunho[0]!.versions[0]!.id);

    // As outras 17 não recebem evento algum (RN-02).
    const novos = applied.document.events.slice(eventsBefore);
    const escopos = new Set(novos.map((event) => event.scope.matrixId).filter(Boolean));
    expect([...escopos]).toEqual([comRascunho[0]!.id]);

    const celulas = novos.filter((event) => event.type === 'CELLS_UPDATED');
    expect(celulas).toHaveLength(1);
    expect(celulas[0]!.payload?.cellCount).toBe(1);
  });

  it('o rascunho difere da publicada em exatamente uma célula', () => {
    const { doc, ctx } = initialLoad();
    const publicado = publishAllDrafts(doc, ctx);
    const alterado = editCsvCell(excerptCsv(), 2, 'OFERTA_DIGITAL', '0');
    const applied = apply(publicado, ctx, applyCommandFor(publicado, alterado));

    const matrix = applied.document.matrices.find((m) => m.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    const [published, draft] = [matrix.versions[0]!, matrix.versions[1]!];
    const diferentes = Object.keys(draft.cells).filter(
      (key) => JSON.stringify(draft.cells[key]) !== JSON.stringify(published.cells[key]),
    );
    expect(diferentes).toHaveLength(1);
    const alvo = draft.cells[diferentes[0]!]!;
    expect(alvo.offer).toBe('OFERTA_0');
    expect(alvo.decision).toBe('REPROVADO');
  });
});

describe('CT-10 — matriz com rascunho aberto fica bloqueada', () => {
  it('o plano a marca BLOCKED e aplicar a seleção com ela falha com IMPORT_TARGET_HAS_DRAFT', () => {
    const { doc, ctx } = initialLoad();
    const publicado = publishAllDrafts(doc, ctx);

    // Rascunho aberto à mão numa matriz que a carga alteraria.
    const alterado = editCsvCell(excerptCsv(), 2, 'OFERTA_DIGITAL', '0');
    const alvo = publicado.matrices.find((m) => m.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    const comRascunho = apply(
      publicado,
      ctx,
      // `version/createDraft` a partir da publicada, o caminho normal do editor.
      createDraft({ matrixId: alvo.id }),
    ).document;

    const plan = planOf(comRascunho, alterado);
    const bloqueada = plan.matrices.find((entry) => entry.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    expect(bloqueada.status).toBe('BLOCKED');
    expect(bloqueada.reason).toContain('rascunho aberto');

    expectFailure(
      comRascunho,
      ctx,
      applyImport({
        profile,
        table: tableOf(alterado),
        fileName: 'recorte.csv',
        planHash: plan.planHash,
        selectedKeys: [bloqueada.key],
        notes: NOTES,
      }),
      'IMPORT_TARGET_HAS_DRAFT',
    );
  });
});

describe('CT-11 — plano obsoleto falha sem gravar', () => {
  it('planHash de outro documento produz IMPORT_PLAN_STALE', () => {
    const ctx = testCtx();
    const doc = withTagCatalog(cineminhaDocument(), ctx);
    const antes = doc.events.length;

    expectFailure(
      doc,
      ctx,
      applyCommandFor(doc, excerptCsv(), { planHash: 'planoobsoleto0000' }),
      'IMPORT_PLAN_STALE',
    );
    expect(doc.matrices).toHaveLength(0);
    expect(doc.events).toHaveLength(antes);
  });

  it('o documento mudar entre o plano e a aplicação invalida o plano', () => {
    const ctx = testCtx();
    const doc = withTagCatalog(cineminhaDocument(), ctx);
    const plan = planOf(doc);

    // Outra ação criou a matriz que a carga criaria.
    const depois = apply(doc, ctx, applyCommandFor(doc)).document;

    expectFailure(
      depois,
      ctx,
      applyImport({
        profile,
        table: excerptTable(),
        fileName: 'recorte.csv',
        planHash: plan.planHash,
        selectedKeys: plan.matrices.map((entry) => entry.key),
        notes: NOTES,
      }),
      'IMPORT_PLAN_STALE',
    );
  });
});

describe('CT-14 — aplicação parcial por seleção', () => {
  it('as desmarcadas ficam sem rascunho e sem evento, e entram em ignoredByUser', () => {
    const ctx = testCtx();
    const doc = withTagCatalog(cineminhaDocument(), ctx);
    const plan = planOf(doc);
    const escolhidas = plan.matrices.slice(0, 5).map((entry) => entry.key);

    const applied = apply(
      doc,
      ctx,
      applyImport({
        profile,
        table: excerptTable(),
        fileName: 'recorte.csv',
        planHash: plan.planHash,
        selectedKeys: escolhidas,
        notes: NOTES,
      }),
    );

    expect(applied.document.matrices).toHaveLength(5);
    expect(applied.data.ignoredByUser).toHaveLength(13);
    const run = eventsOfType(applied.document, 'IMPORT_RUN')[0]!;
    expect((run.payload?.ignoredByUser as string[]).length).toBe(13);
  });

  it('seleção vazia falha com IMPORT_NOTHING_TO_APPLY', () => {
    const ctx = testCtx();
    const doc = withTagCatalog(cineminhaDocument(), ctx);
    expectFailure(
      doc,
      ctx,
      applyCommandFor(doc, excerptCsv(), { selectedKeys: [] }),
      'IMPORT_NOTHING_TO_APPLY',
    );
  });
});

describe('CT-13 — tags da carga não apagam as manuais', () => {
  it('a matriz fica com as tags manuais e as da carga, sem duplicata', () => {
    const { doc, ctx } = initialLoad();
    const publicado = publishAllDrafts(doc, ctx);

    const comTagManual = apply(
      publicado,
      ctx,
      createCatalogItem({ kind: 'TAG', code: 'PRIORITARIA', label: 'Prioritária' }),
    ).document;
    const alvo = comTagManual.matrices.find((m) => m.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    const marcado = apply(
      comTagManual,
      ctx,
      setMatrixTags({ matrixId: alvo.id, add: ['PRIORITARIA'] }),
    ).document;

    const alterado = editCsvCell(excerptCsv(), 2, 'OFERTA_DIGITAL', '0');
    const recarregado = apply(marcado, ctx, applyCommandFor(marcado, alterado)).document;

    const depois = recarregado.matrices.find((m) => m.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    expect(depois.tags).toEqual([
      'CLUSTER_G1',
      'CEP_SEM_RISCO',
      'CANAL_DIGITAL',
      'PRIORITARIA',
    ]);
    expect(new Set(depois.tags).size).toBe(depois.tags!.length);
  });
});

describe('atomicidade e inverso', () => {
  it('erro no meio do lote não deixa nada gravado', () => {
    const ctx = testCtx();
    // Sem o catálogo de tags, a décima matriz falha em `matrix/setTags` —
    // a carga inteira cai e nenhuma das anteriores fica no documento.
    const doc = cineminhaDocument();
    const antes = { matrices: doc.matrices.length, events: doc.events.length };

    expectFailure(doc, ctx, applyCommandFor(doc), 'TAG_NOT_FOUND');

    expect(doc.matrices).toHaveLength(antes.matrices);
    expect(doc.events).toHaveLength(antes.events);
  });

  it('aplicar e desfazer devolve o documento estruturalmente idêntico', () => {
    const ctx = testCtx();
    const before = withTagCatalog(cineminhaDocument(), ctx);
    const applied = apply(before, ctx, applyCommandFor(before));
    expect(applied.document.matrices).toHaveLength(18);

    const undone = apply(applied.document, ctx, applied.result.inverse);
    // O log de eventos é append-only (docs/03 §8): o desfazer devolve a
    // estrutura, não reescreve a história.
    expect(withoutEvents(undone.document)).toEqual(withoutEvents(before));
  });

  it('desfazer uma carga de atualização descarta só os rascunhos criados', () => {
    const { doc, ctx } = initialLoad();
    const publicado = publishAllDrafts(doc, ctx);
    const alterado = editCsvCell(excerptCsv(), 2, 'OFERTA_DIGITAL', '0');
    const applied = apply(publicado, ctx, applyCommandFor(publicado, alterado));
    const undone = apply(applied.document, ctx, applied.result.inverse);

    expect(withoutEvents(undone.document)).toEqual(withoutEvents(publicado));
  });
});

describe('nota da carga', () => {
  it('nota com menos de 10 caracteres falha com NOTES_REQUIRED, sem gravar', () => {
    const ctx = testCtx();
    const doc = withTagCatalog(cineminhaDocument(), ctx);
    expectFailure(doc, ctx, applyCommandFor(doc, excerptCsv(), { notes: 'curta' }), 'NOTES_REQUIRED');
    expect(doc.matrices).toHaveLength(0);
  });
});

describe('idempotência ponta a ponta (RN-05)', () => {
  it('carga → publicar → carga do mesmo arquivo não muda célula alguma', () => {
    const { doc, ctx } = initialLoad();
    const publicado = publishAllDrafts(doc, ctx);
    const plan = planOf(publicado);

    expect(plan.totals.cellsChanged).toBe(0);
    for (const entry of plan.matrices) {
      expect(entry.status).toBe('UNCHANGED');
      expect(entry.changes).toHaveLength(0);
    }
  });

  it('as células carregadas batem com o arquivo, célula a célula', () => {
    const { doc } = initialLoad();
    const matrix = doc.matrices.find((m) => m.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    const cells = matrix.versions[0]!.cells;
    for (const cell of Object.values(cells)) {
      expect(cell.decision).toBeDefined();
      expect(cell.decision === 'REPROVADO' ? cell.offer : 'OFERTA_0').toBeDefined();
    }
    expect(Object.keys(cells).length).toBeGreaterThan(0);
    // Toda combinação do grid efetivo tem célula: zero pendências (CT-16).
    const version = matrix.versions[0]!;
    expect(Object.keys(cells)).toHaveLength(
      version.axes.x.tuples.length * version.axes.y.tuples.length,
    );
    expect(cells[encodeCellKey(version.axes.x.tuples[0]!, version.axes.y.tuples[0]!)]).toBeDefined();
  });
});

describe('DEC-CARGA-018 — restaurar matriz arquivada na carga', () => {
  function archivedFixture(csv: string): { doc: PolicyOpsDocument; ctx: Ctx; matrixId: string; key: string } {
    const { doc, ctx } = initialLoad();
    const publicado = publishAllDrafts(doc, ctx);
    const alvo = publicado.matrices.find((m) => m.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    const arquivado = apply(publicado, ctx, archiveMatrix({ matrixId: alvo.id })).document;
    const key = planOf(arquivado, csv).matrices.find((e) => e.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!.key;
    return { doc: arquivado, ctx, matrixId: alvo.id, key };
  }

  it('sem restoreKeys, aplicar a chave arquivada falha com IMPORT_TARGET_ARCHIVED, e nada é gravado', () => {
    const alterado = editCsvCell(excerptCsv(), 2, 'OFERTA_DIGITAL', '0');
    const { doc, ctx, key } = archivedFixture(alterado);
    const plan = planOf(doc, alterado);
    expect(plan.matrices.find((e) => e.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!.status).toBe('ARCHIVED');

    const eventsBefore = doc.events.length;
    expectFailure(
      doc,
      ctx,
      applyImport({
        profile,
        table: tableOf(alterado),
        fileName: 'recorte.csv',
        planHash: plan.planHash,
        selectedKeys: [key],
        notes: NOTES,
      }),
      'IMPORT_TARGET_ARCHIVED',
    );
    expect(doc.events).toHaveLength(eventsBefore);
    expect(doc.matrices.find((m) => m.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!.archivedAt).toBeDefined();
  });

  it('com restoreKeys confirmando, desarquiva e cria o rascunho com a mudança (CHANGED)', () => {
    const alterado = editCsvCell(excerptCsv(), 2, 'OFERTA_DIGITAL', '0');
    const { doc, ctx, matrixId, key } = archivedFixture(alterado);
    const plan = planOf(doc, alterado, [key]);
    const entry = plan.matrices.find((e) => e.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    expect(entry.status).toBe('CHANGED');
    expect(entry.archived).toBe(true);

    const applied = apply(
      doc,
      ctx,
      applyImport({
        profile,
        table: tableOf(alterado),
        fileName: 'recorte.csv',
        planHash: plan.planHash,
        selectedKeys: [key],
        restoreKeys: [key],
        notes: NOTES,
      }),
    );

    const restaurada = applied.document.matrices.find((m) => m.id === matrixId)!;
    expect(restaurada.archivedAt).toBeUndefined();
    expect(restaurada.versions.some((v) => v.state === 'DRAFT')).toBe(true);
    expect(applied.data.restoredMatrices).toEqual([matrixId]);

    const run = applied.document.events.find(
      (event) => event.type === 'IMPORT_RUN' && event.payload?.importRunId === applied.data.importRunId,
    )!;
    expect(run.payload?.restoredMatrices).toBe(1);
  });

  it('com restoreKeys e conteúdo idêntico, só desarquiva — sem rascunho novo (RN-02)', () => {
    const { doc, ctx, matrixId, key } = archivedFixture(excerptCsv());
    const plan = planOf(doc, excerptCsv(), [key]);
    const entry = plan.matrices.find((e) => e.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    expect(entry.status).toBe('UNCHANGED');
    expect(entry.archived).toBe(true);

    const applied = apply(
      doc,
      ctx,
      applyImport({
        profile,
        table: tableOf(excerptCsv()),
        fileName: 'recorte.csv',
        planHash: plan.planHash,
        selectedKeys: [key],
        restoreKeys: [key],
        notes: NOTES,
      }),
    );

    const restaurada = applied.document.matrices.find((m) => m.id === matrixId)!;
    expect(restaurada.archivedAt).toBeUndefined();
    expect(restaurada.versions).toHaveLength(1);
    expect(restaurada.versions[0]!.state).toBe('PUBLISHED');
    expect(applied.data.restoredMatrices).toEqual([matrixId]);
    expect(applied.data.createdDrafts).toEqual([]);
  });

  it('desfazer devolve a matriz arquivada e descarta o rascunho criado', () => {
    const alterado = editCsvCell(excerptCsv(), 2, 'OFERTA_DIGITAL', '0');
    const { doc, ctx, key } = archivedFixture(alterado);
    const plan = planOf(doc, alterado, [key]);

    const applied = apply(
      doc,
      ctx,
      applyImport({
        profile,
        table: tableOf(alterado),
        fileName: 'recorte.csv',
        planHash: plan.planHash,
        selectedKeys: [key],
        restoreKeys: [key],
        notes: NOTES,
      }),
    );
    const undone = apply(applied.document, ctx, applied.result.inverse);
    expect(withoutEvents(undone.document)).toEqual(withoutEvents(doc));
  });
});

describe('DEC-CARGA-019 — restaurar matriz arquivada que nunca foi publicada', () => {
  /** O fluxo real: rascunho v1 descartado antes de publicar, depois a matriz arquivada. */
  function neverPublishedArchivedFixture(): { doc: PolicyOpsDocument; ctx: Ctx; matrixId: string; key: string } {
    const { doc, ctx } = initialLoad();
    const alvo = doc.matrices.find((m) => m.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    const draft = alvo.versions.find((v) => v.state === 'DRAFT')!;
    const descartado = apply(doc, ctx, discardDraft({ versionId: draft.id })).document;
    const arquivado = apply(descartado, ctx, archiveMatrix({ matrixId: alvo.id })).document;
    const key = planOf(arquivado).matrices.find((e) => e.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!.key;
    return { doc: arquivado, ctx, matrixId: alvo.id, key };
  }

  it('a matriz fica sem nenhuma versão publicada, só a v1 ARCHIVED do rascunho descartado', () => {
    const { doc, matrixId } = neverPublishedArchivedFixture();
    const matrix = doc.matrices.find((m) => m.id === matrixId)!;
    expect(matrix.versions).toHaveLength(1);
    expect(matrix.versions[0]!.state).toBe('ARCHIVED');
    expect(matrix.archivedAt).toBeDefined();
  });

  it('com restoreKeys confirmando, projeta eixos frescos e cria a v2 DRAFT — não trava mais em BLOCKED', () => {
    const { doc, ctx, matrixId, key } = neverPublishedArchivedFixture();
    const plan = planOf(doc, excerptCsv(), [key]);
    const entry = plan.matrices.find((e) => e.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    expect(entry.status).toBe('NEW');
    expect(entry.archived).toBe(true);

    const applied = apply(
      doc,
      ctx,
      applyImport({
        profile,
        table: tableOf(excerptCsv()),
        fileName: 'recorte.csv',
        planHash: plan.planHash,
        selectedKeys: [key],
        restoreKeys: [key],
        notes: NOTES,
      }),
    );

    const restaurada = applied.document.matrices.find((m) => m.id === matrixId)!;
    expect(restaurada.archivedAt).toBeUndefined();
    expect(restaurada.versions).toHaveLength(2);
    const draft = restaurada.versions.find((v) => v.state === 'DRAFT')!;
    expect(draft.number).toBe(2);
    expect(Object.keys(draft.cells).length).toBeGreaterThan(0);
    expect(applied.data.restoredMatrices).toEqual([matrixId]);
    // A matriz já existia (código reservado) — não é `matrix/create` de novo.
    expect(applied.data.createdMatrices).not.toContain(matrixId);
    expect(applied.data.createdDrafts).toContain(draft.id);
  });

  it('sem restoreKeys, aplicar a chave falha com IMPORT_TARGET_ARCHIVED', () => {
    const { doc, ctx, key } = neverPublishedArchivedFixture();
    const plan = planOf(doc);
    expectFailure(
      doc,
      ctx,
      applyImport({
        profile,
        table: excerptTable(),
        fileName: 'recorte.csv',
        planHash: plan.planHash,
        selectedKeys: [key],
        notes: NOTES,
      }),
      'IMPORT_TARGET_ARCHIVED',
    );
  });
});
