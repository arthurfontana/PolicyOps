import { describe, expect, it } from 'vitest';
import { createCatalogItem, updateCatalogItem } from '@/core/library/catalog';
import { createVariable, saveVariableDomains } from '@/core/library/variables';
import { mergeDocuments } from '@/core/merge';
import type { MergeResolutions } from '@/core/merge';
import { createProject } from '@/core/document/commands';
import { createDraft, createMatrix } from '@/core/versioning/lifecycle';
import { applyCellPatch } from '@/core/versioning/cells';
import { apply, coordsOf, DAY, IDS } from '../versioning/fixtures';
import {
  ana,
  ancestor,
  bruno,
  content,
  expectNoPublishedVersionLost,
  expectValid,
  publishDraft,
  saved,
  sealedVersions,
} from './fixtures';

/**
 * Merge de documentos — docs/06-persistencia-e-concorrencia.md §7.
 *
 * Cada linha das duas tabelas de §7 tem um caso aqui, com fixture própria, e
 * **todos** eles verificam as duas promessas da sessão: o documento resultante
 * é válido e nenhuma versão publicada se perde.
 */

function versionsOf(doc: ReturnType<typeof ancestor>['document'], matrixId: string) {
  return doc.matrices.find((matrix) => matrix.id === matrixId)!.versions;
}

// ---------------------------------------------------------------------------
// Tabela 1 — resolvido automaticamente
// ---------------------------------------------------------------------------

describe('§7 — resolvido automaticamente', () => {
  it('versão publicada presente só de um lado entra por união', () => {
    const base = ancestor();
    const ctx = bruno();
    // Bruno criou e publicou a v2 da MTZ_A: essa versão não existe do meu lado.
    const draft = apply(base.document, ctx, createDraft({ matrixId: base.matrixA }));
    const theirs = saved(
      publishDraft(draft.document, ctx, draft.data.versionId),
      'Bruno',
      '2026-02-01T10:00:00.000Z',
    );
    const mine = base.document;

    const { merged, applied, conflicts } = mergeDocuments(mine, theirs);

    expect(conflicts).toEqual([]);
    const versions = versionsOf(merged, base.matrixA);
    expect(versions.map((version) => version.number)).toEqual([1, 2]);
    expect(versions.find((version) => version.number === 2)!.state).toBe('PUBLISHED');
    expect(versions.find((version) => version.number === 1)!.state).toBe('SUPERSEDED');
    expect(
      applied.some(
        (action) => action.kind === 'UNION_PUBLISHED_VERSION' && action.side === 'THEIRS',
      ),
    ).toBe(true);
    expectValid(merged);
    expectNoPublishedVersionLost(mine, theirs, merged);
  });

  it('item de biblioteca novo só de um lado entra por união (variável, regra e catálogo)', () => {
    const base = ancestor();
    const mineCtx = ana();
    const theirsCtx = bruno();

    const mineVariable = apply(
      base.document,
      mineCtx,
      createVariable({ code: 'CANAL', name: 'Canal', type: 'CATEGORICAL' }),
    );
    const mine = apply(
      mineVariable.document,
      mineCtx,
      saveVariableDomains({
        variableId: mineVariable.data.variableId,
        versionId: mineVariable.data.versionId,
        domains: [
          { code: 'APP', label: 'App', position: 0 },
          { code: 'LOJA', label: 'Loja', position: 1 },
        ],
      }),
    ).document;

    const theirs = apply(
      base.document,
      theirsCtx,
      createCatalogItem({ kind: 'DECISION', code: 'PENDENTE', label: 'Pendente' }),
    ).document;

    const { merged, conflicts, applied } = mergeDocuments(mine, theirs);

    expect(conflicts).toEqual([]);
    expect(merged.variables.some((variable) => variable.code === 'CANAL')).toBe(true);
    expect(merged.catalog.some((item) => item.code === 'PENDENTE')).toBe(true);
    expect(applied.filter((action) => action.kind === 'UNION_LIBRARY_ITEM')).toHaveLength(2);
    // `position` continua 0-based e sem buracos por kind depois da união.
    for (const kind of ['DECISION', 'OFFER', 'LIMIT', 'TAG'] as const) {
      const sameKind = merged.catalog.filter((item) => item.kind === kind);
      expect(sameKind.map((item) => item.position)).toEqual(sameKind.map((_item, index) => index));
    }
    expectValid(merged);
  });

  it('projeto e matriz novos só de um lado entram por união', () => {
    const base = ancestor();
    const mineCtx = ana();
    const theirsCtx = bruno();

    const project = apply(base.document, mineCtx, createProject({ code: 'PROJ_C', name: 'Projeto C' }));
    const mine = apply(
      project.document,
      mineCtx,
      createMatrix({
        projectId: project.data.projectId,
        code: 'MTZ_C',
        name: 'Matriz C',
        x: { levels: [{ variableId: IDS.score }] },
        y: { levels: [{ variableId: IDS.restritivo }] },
      }),
    ).document;

    const theirs = apply(
      base.document,
      theirsCtx,
      createMatrix({
        projectId: IDS.projectB,
        code: 'MTZ_D',
        name: 'Matriz D',
        x: { levels: [{ variableId: IDS.score }] },
        y: { levels: [{ variableId: IDS.restritivo }] },
      }),
    ).document;

    const { merged, conflicts, applied } = mergeDocuments(mine, theirs);

    expect(conflicts).toEqual([]);
    expect(merged.projects.map((item) => item.code).sort()).toEqual(['PROJ_A', 'PROJ_B', 'PROJ_C']);
    expect(merged.matrices.map((matrix) => matrix.code).sort()).toEqual([
      'MTZ_A',
      'MTZ_B',
      'MTZ_C',
      'MTZ_D',
    ]);
    expect(applied.some((action) => action.kind === 'UNION_PROJECT')).toBe(true);
    expect(applied.filter((action) => action.kind === 'UNION_MATRIX')).toHaveLength(2);
    expect(merged.projects.map((item) => item.position)).toEqual([0, 1, 2]);
    expectValid(merged);
  });

  it('eventos viram união ordenada por at e deduplicada por id', () => {
    const base = ancestor();
    const mineCtx = ana();
    const theirsCtx = bruno();

    const mine = apply(
      base.document,
      mineCtx,
      createCatalogItem({ kind: 'TAG', code: 'URGENTE', label: 'Urgente' }),
    ).document;
    const theirs = apply(
      base.document,
      theirsCtx,
      createCatalogItem({ kind: 'TAG', code: 'REVISADO', label: 'Revisado' }),
    ).document;

    const { merged } = mergeDocuments(mine, theirs);

    const ids = merged.events.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(base.document.events.length + 2);
    for (const event of [...mine.events, ...theirs.events]) {
      expect(ids).toContain(event.id);
    }
    const times = merged.events.map((event) => event.at);
    expect([...times].sort()).toEqual(times);
  });

  it('mesmo item com um lado inalterado: vence o lado alterado', () => {
    const base = ancestor();
    const mineCtx = ana();
    const target = base.document.catalog.find((item) => item.code === 'APROVADO')!;

    const mine = apply(
      base.document,
      mineCtx,
      updateCatalogItem({ id: target.id, label: 'Aprovado automaticamente' }),
    ).document;
    // Bruno não tocou em nada: o documento dele é o ancestral.
    const theirs = base.document;

    const { merged, conflicts, applied } = mergeDocuments(mine, theirs);

    expect(conflicts).toEqual([]);
    expect(merged.catalog.find((item) => item.id === target.id)!.label).toBe(
      'Aprovado automaticamente',
    );
    expect(
      applied.some((action) => action.kind === 'CHANGED_SIDE_WINS' && action.side === 'MINE'),
    ).toBe(true);
    expectValid(merged);
  });

  it('rascunho editado só de um lado entra sem conflito', () => {
    const base = ancestor();
    const theirsCtx = bruno();
    const coords = coordsOf(base.document, base.draftB).slice(0, 2);
    const theirs = apply(
      base.document,
      theirsCtx,
      applyCellPatch({ versionId: base.draftB, patch: { coords, set: { note: 'ajuste do Bruno' } } }),
    ).document;

    const { merged, conflicts } = mergeDocuments(base.document, theirs);

    expect(conflicts).toEqual([]);
    const draft = versionsOf(merged, base.matrixB).find((version) => version.state === 'DRAFT')!;
    expect(draft.cells[`${coords[0]!.xPath}::${coords[0]!.yPath}`]!.note).toBe('ajuste do Bruno');
    expectValid(merged);
  });
});

// ---------------------------------------------------------------------------
// Tabela 2 — conflito, exige decisão do usuário
// ---------------------------------------------------------------------------

describe('§7 — conflitos que exigem decisão', () => {
  /** Os dois editaram o mesmo rascunho da mesma matriz, de formas diferentes. */
  function divergedDrafts() {
    const base = ancestor();
    const mineCtx = ana();
    const theirsCtx = bruno();
    const coords = coordsOf(base.document, base.draftB);

    const mine = apply(
      base.document,
      mineCtx,
      applyCellPatch({
        versionId: base.draftB,
        patch: { coords: [coords[0]!], set: { note: 'da Ana' } },
      }),
    ).document;
    const theirs = saved(
      apply(
        base.document,
        theirsCtx,
        applyCellPatch({
          versionId: base.draftB,
          patch: { coords: [coords[1]!], set: { note: 'do Bruno' } },
        }),
      ).document,
      'Bruno',
      '2026-02-01T10:00:00.000Z',
    );
    return { base, mine, theirs, coords };
  }

  it('rascunhos diferentes da mesma matriz viram conflito, com os dois preservados por padrão', () => {
    const { base, mine, theirs } = divergedDrafts();
    const { merged, conflicts } = mergeDocuments(mine, theirs);

    const conflict = conflicts.find((item) => item.kind === 'DRAFT_DIVERGED');
    expect(conflict).toBeDefined();
    expect(conflict!.defaultChoice).toBe('KEEP_BOTH');
    expect(conflict!.preview).toEqual({
      kind: 'MATRIX_VERSION',
      matrixId: base.matrixB,
      mineVersionId: base.draftB,
      theirsVersionId: base.draftB,
    });
    expect(conflict!.options.map((option) => option.choice)).toEqual(['KEEP_BOTH', 'MINE', 'THEIRS']);

    // Padrão: o perdedor vira ARCHIVED com nota — nada se perde.
    const versions = versionsOf(merged, base.matrixB);
    expect(versions.filter((version) => version.state === 'DRAFT')).toHaveLength(1);
    const archived = versions.find((version) => version.state === 'ARCHIVED')!;
    expect(archived.notes).toContain('merge');
    expect(archived.number).toBe(3);
    expectValid(merged);
    expectNoPublishedVersionLost(mine, theirs, merged);
  });

  it('rascunhos diferentes: escolher um lado descarta o outro', () => {
    const { base, mine, theirs, coords } = divergedDrafts();
    const first = mergeDocuments(mine, theirs);
    const conflictId = first.conflicts.find((item) => item.kind === 'DRAFT_DIVERGED')!.id;

    for (const [choice, note] of [
      ['MINE', 'da Ana'],
      ['THEIRS', 'do Bruno'],
    ] as const) {
      const resolutions: MergeResolutions = { [conflictId]: { choice } };
      const { merged } = mergeDocuments(mine, theirs, { resolutions });
      const versions = versionsOf(merged, base.matrixB);
      expect(versions.filter((version) => version.state === 'DRAFT')).toHaveLength(1);
      expect(versions.some((version) => version.state === 'ARCHIVED')).toBe(false);
      const draft = versions.find((version) => version.state === 'DRAFT')!;
      const key = choice === 'MINE' ? coords[0]! : coords[1]!;
      expect(draft.cells[`${key.xPath}::${key.yPath}`]!.note).toBe(note);
      expectValid(merged);
      expectNoPublishedVersionLost(mine, theirs, merged);
    }
  });

  it('mesmo number publicado com conteúdo diferente: renumera o perdedor e sinaliza', () => {
    const base = ancestor();
    const mineCtx = ana('2026-02-01T09:00:00.000Z');
    const theirsCtx = bruno('2026-02-02T09:00:00.000Z');

    // Cada uma cria a **sua** v2 de MTZ_A, com conteúdo diferente, e publica.
    const mineDraft = apply(base.document, mineCtx, createDraft({ matrixId: base.matrixA }));
    const mineCoords = coordsOf(mineDraft.document, mineDraft.data.versionId);
    const minePatched = apply(
      mineDraft.document,
      mineCtx,
      applyCellPatch({
        versionId: mineDraft.data.versionId,
        patch: { coords: [mineCoords[0]!], set: { decision: 'REPROVADO' } },
      }),
    ).document;
    const mine = publishDraft(minePatched, mineCtx, mineDraft.data.versionId, 'Versão da Ana.');

    const theirsDraft = apply(base.document, theirsCtx, createDraft({ matrixId: base.matrixA }));
    const theirsCoords = coordsOf(theirsDraft.document, theirsDraft.data.versionId);
    const theirsPatched = apply(
      theirsDraft.document,
      theirsCtx,
      applyCellPatch({
        versionId: theirsDraft.data.versionId,
        patch: { coords: [theirsCoords[1]!], set: { decision: 'ANALISE_MANUAL' } },
      }),
    ).document;
    const theirs = saved(
      publishDraft(theirsPatched, theirsCtx, theirsDraft.data.versionId, 'Versão do Bruno.'),
      'Bruno',
      '2026-02-02T10:00:00.000Z',
    );

    expect(versionsOf(mine, base.matrixA).find((v) => v.state === 'PUBLISHED')!.number).toBe(2);
    expect(versionsOf(theirs, base.matrixA).find((v) => v.state === 'PUBLISHED')!.number).toBe(2);

    const { merged, conflicts, applied } = mergeDocuments(mine, theirs);

    const conflict = conflicts.find((item) => item.kind === 'PUBLISHED_CLASH');
    expect(conflict).toBeDefined();
    expect(conflict!.preview).toMatchObject({ kind: 'MATRIX_VERSION', matrixId: base.matrixA });

    // As duas sobrevivem: a mais antiga fica com o número, a outra é renumerada
    // e a cadeia de vigência vira uma sequência.
    const versions = versionsOf(merged, base.matrixA);
    expect(versions.map((version) => version.number)).toEqual([1, 2, 3]);
    expect(versions.map((version) => version.state)).toEqual([
      'SUPERSEDED',
      'SUPERSEDED',
      'PUBLISHED',
    ]);
    expect(versions.find((version) => version.number === 2)!.id).toBe(mineDraft.data.versionId);
    expect(versions.find((version) => version.number === 3)!.id).toBe(theirsDraft.data.versionId);
    expect(applied.some((action) => action.kind === 'RENUMBERED' && action.needsReview === true)).toBe(
      true,
    );
    expectValid(merged);
    expectNoPublishedVersionLost(mine, theirs, merged);

    // A decisão inverte quem cede o número, e continua sem perder nada.
    const other = mergeDocuments(mine, theirs, {
      resolutions: { [conflict!.id]: { choice: 'THEIRS' } },
    });
    const otherVersions = versionsOf(other.merged, base.matrixA);
    expect(otherVersions.find((version) => version.number === 2)!.id).toBe(
      theirsDraft.data.versionId,
    );
    expectValid(other.merged);
    expectNoPublishedVersionLost(mine, theirs, other.merged);
  });

  it('mesmo item de biblioteca editado dos dois lados: escolha do item ou campo a campo', () => {
    const base = ancestor();
    const target = base.document.catalog.find((item) => item.code === 'APROVADO')!;

    const mine = apply(
      base.document,
      ana(),
      updateCatalogItem({ id: target.id, label: 'Aprovado pela Ana', color: '#111111' }),
    ).document;
    const theirs = apply(
      base.document,
      bruno(),
      updateCatalogItem({ id: target.id, label: 'Aprovado pelo Bruno', color: '#222222' }),
    ).document;

    const { merged, conflicts } = mergeDocuments(mine, theirs);
    const conflict = conflicts.find((item) => item.kind === 'ITEM_DIVERGED')!;
    expect(conflict.entity.kind).toBe('CATALOG');
    expect(conflict.fields.map((field) => field.key).sort()).toEqual(['color', 'label']);
    expect(conflict.fields.every((field) => field.choosable)).toBe(true);
    expect(merged.catalog.find((item) => item.id === target.id)!.label).toBe('Aprovado pela Ana');

    // Campo a campo: rótulo do arquivo, cor minha.
    const mixed = mergeDocuments(mine, theirs, {
      resolutions: { [conflict.id]: { choice: 'MINE', fields: { label: 'THEIRS' } } },
    });
    const item = mixed.merged.catalog.find((candidate) => candidate.id === target.id)!;
    expect(item.label).toBe('Aprovado pelo Bruno');
    expect(item.color).toBe('#111111');
    expectValid(mixed.merged);
  });

  it('mesmo code criado do zero dos dois lados: renomeia um deles e conserta as referências', () => {
    const base = ancestor();
    const mineCtx = ana();
    const theirsCtx = bruno();

    const mine = apply(
      base.document,
      mineCtx,
      createCatalogItem({ kind: 'DECISION', code: 'EXCECAO', label: 'Exceção de crédito' }),
    ).document;

    // Bruno cria o mesmo código para outra coisa **e** usa em um rascunho dele.
    const theirsItem = apply(
      base.document,
      theirsCtx,
      createCatalogItem({ kind: 'DECISION', code: 'EXCECAO', label: 'Exceção operacional' }),
    );
    const theirsCoords = coordsOf(theirsItem.document, base.draftB);
    const theirs = apply(
      theirsItem.document,
      theirsCtx,
      applyCellPatch({
        versionId: base.draftB,
        patch: { coords: [theirsCoords[0]!], set: { decision: 'EXCECAO' } },
      }),
    ).document;

    const { merged, conflicts, applied } = mergeDocuments(mine, theirs);

    const conflict = conflicts.find((item) => item.kind === 'CODE_CLASH')!;
    expect(conflict.defaultChoice).toBe('MINE');

    const codes = merged.catalog.filter((item) => item.label.startsWith('Exceção'));
    expect(codes.map((item) => item.code).sort()).toEqual(['EXCECAO', 'EXCECAO_2']);
    expect(codes.find((item) => item.label === 'Exceção operacional')!.code).toBe('EXCECAO_2');
    // A célula do rascunho do Bruno passou a apontar para o código renomeado —
    // continua sendo a decisão que ele escolheu, e não a da Ana.
    const draft = versionsOf(merged, base.matrixB).find((version) => version.state === 'DRAFT')!;
    expect(draft.cells[`${theirsCoords[0]!.xPath}::${theirsCoords[0]!.yPath}`]!.decision).toBe(
      'EXCECAO_2',
    );
    expect(applied.some((action) => action.kind === 'RENAMED')).toBe(true);
    expectValid(merged);

    // Invertendo a decisão, quem é renomeado é o item da Ana.
    const inverted = mergeDocuments(mine, theirs, {
      resolutions: { [conflict.id]: { choice: 'THEIRS' } },
    });
    expect(
      inverted.merged.catalog.find((item) => item.label === 'Exceção de crédito')!.code,
    ).toBe('EXCECAO_2');
    expectValid(inverted.merged);
  });
});

// ---------------------------------------------------------------------------
// Propriedades gerais
// ---------------------------------------------------------------------------

describe('propriedades do merge', () => {
  /** Cenário sem conflito: cada lado mexeu numa coisa diferente. */
  function disjoint() {
    const base = ancestor();
    const mineCtx = ana();
    const theirsCtx = bruno();

    const variable = apply(
      base.document,
      mineCtx,
      createVariable({ code: 'CANAL', name: 'Canal', type: 'CATEGORICAL' }),
    );
    const mine = apply(
      variable.document,
      mineCtx,
      saveVariableDomains({
        variableId: variable.data.variableId,
        versionId: variable.data.versionId,
        domains: [
          { code: 'APP', label: 'App', position: 0 },
          { code: 'LOJA', label: 'Loja', position: 1 },
        ],
      }),
    ).document;

    const theirs = saved(
      publishDraft(base.document, theirsCtx, base.draftB),
      'Bruno',
      '2026-02-01T10:00:00.000Z',
    );
    return { base, mine, theirs };
  }

  it('sem conflito, merge(a,b) e merge(b,a) produzem o mesmo documento', () => {
    const { mine, theirs } = disjoint();
    const forward = mergeDocuments(mine, theirs);
    const backward = mergeDocuments(theirs, mine);

    expect(forward.conflicts).toEqual([]);
    expect(backward.conflicts).toEqual([]);
    expect(content(forward.merged)).toEqual(content(backward.merged));
    // Os metadados também são simétricos, tirando o id do documento (que é o
    // mesmo arquivo dos dois lados).
    expect(forward.merged.meta).toEqual(backward.merged.meta);
  });

  it('é determinístico: a mesma entrada produz exatamente o mesmo resultado', () => {
    const { mine, theirs } = disjoint();
    expect(mergeDocuments(mine, theirs).merged).toEqual(mergeDocuments(mine, theirs).merged);
  });

  it('mesclar um documento com ele mesmo não muda nada e não gera conflito', () => {
    const base = ancestor();
    const { merged, conflicts, applied } = mergeDocuments(base.document, base.document);
    expect(conflicts).toEqual([]);
    expect(applied.filter((action) => action.needsReview === true)).toEqual([]);
    expect(content(merged)).toEqual(content(base.document));
    expectValid(merged);
  });

  it('cenário realista: uma publica a versão nova, a outra edita outro rascunho e cria uma variável', () => {
    const base = ancestor();
    const mineCtx = ana();
    const theirsCtx = bruno();

    // Ana: edita o rascunho da MTZ_B e cria uma variável nova.
    const coords = coordsOf(base.document, base.draftB);
    const edited = apply(
      base.document,
      mineCtx,
      applyCellPatch({
        versionId: base.draftB,
        patch: { coords: coords.slice(0, 3), set: { decision: 'REPROVADO' } },
      }),
    ).document;
    const variable = apply(
      edited,
      mineCtx,
      createVariable({ code: 'CANAL', name: 'Canal', type: 'CATEGORICAL' }),
    );
    const mine = apply(
      variable.document,
      mineCtx,
      saveVariableDomains({
        variableId: variable.data.variableId,
        versionId: variable.data.versionId,
        domains: [
          { code: 'APP', label: 'App', position: 0 },
          { code: 'LOJA', label: 'Loja', position: 1 },
        ],
      }),
    ).document;

    // Bruno: publica a versão nova da MTZ_A e salva primeiro.
    theirsCtx.advance(DAY);
    const theirsDraft = apply(base.document, theirsCtx, createDraft({ matrixId: base.matrixA }));
    const theirs = saved(
      publishDraft(theirsDraft.document, theirsCtx, theirsDraft.data.versionId, 'Nova política A.'),
      'Bruno',
      '2026-02-02T10:00:00.000Z',
    );

    const { merged, conflicts, applied } = mergeDocuments(mine, theirs);

    expect(conflicts).toEqual([]);
    // A publicação do Bruno está lá.
    const matrixA = versionsOf(merged, base.matrixA);
    expect(matrixA).toHaveLength(2);
    expect(matrixA.find((version) => version.number === 2)!.state).toBe('PUBLISHED');
    // As edições da Ana no rascunho da outra matriz continuam lá.
    const draft = versionsOf(merged, base.matrixB).find((version) => version.state === 'DRAFT')!;
    expect(draft.id).toBe(base.draftB);
    expect(
      coords.slice(0, 3).every((coord) => draft.cells[`${coord.xPath}::${coord.yPath}`]?.decision === 'REPROVADO'),
    ).toBe(true);
    // E a variável nova dela também.
    expect(merged.variables.some((item) => item.code === 'CANAL')).toBe(true);
    // O histórico é a união dos dois.
    expect(merged.events.length).toBe(
      new Set([...mine.events, ...theirs.events].map((event) => event.id)).size,
    );
    expect(applied.length).toBeGreaterThan(0);
    expect(merged.meta.revision).toBe(Math.max(mine.meta.revision, theirs.meta.revision));
    expectValid(merged);
    expectNoPublishedVersionLost(mine, theirs, merged);
  });

  it('nenhuma versão publicada se perde, mesmo com tudo divergindo ao mesmo tempo', () => {
    const base = ancestor();
    const mineCtx = ana('2026-02-01T09:00:00.000Z');
    const theirsCtx = bruno('2026-02-02T09:00:00.000Z');

    // Ana publica a v2 da MTZ_A e edita o rascunho da MTZ_B.
    const mineDraft = apply(base.document, mineCtx, createDraft({ matrixId: base.matrixA }));
    let mine = publishDraft(mineDraft.document, mineCtx, mineDraft.data.versionId, 'v2 da Ana.');
    mine = apply(
      mine,
      mineCtx,
      applyCellPatch({
        versionId: base.draftB,
        patch: { coords: coordsOf(mine, base.draftB).slice(0, 1), set: { note: 'da Ana' } },
      }),
    ).document;

    // Bruno publica a **sua** v2 da MTZ_A e também o rascunho da MTZ_B.
    const theirsDraft = apply(base.document, theirsCtx, createDraft({ matrixId: base.matrixA }));
    let theirs = publishDraft(theirsDraft.document, theirsCtx, theirsDraft.data.versionId, 'v2 do Bruno.');
    theirs = publishDraft(theirs, theirsCtx, base.draftB, 'v2 da B, pelo Bruno.');
    theirs = saved(theirs, 'Bruno', '2026-02-02T12:00:00.000Z');

    const before = new Set([...sealedVersions(mine).keys(), ...sealedVersions(theirs).keys()]);
    const { merged, conflicts } = mergeDocuments(mine, theirs);

    expect(conflicts.length).toBeGreaterThan(0);
    const after = new Set(
      merged.matrices.flatMap((matrix) => matrix.versions.map((version) => version.id)),
    );
    for (const versionId of before) expect(after.has(versionId)).toBe(true);
    expectValid(merged);
    expectNoPublishedVersionLost(mine, theirs, merged);
  });

  it('publicar de um lado e continuar editando do outro preserva as duas coisas', () => {
    const base = ancestor();
    const mineCtx = ana();
    const theirsCtx = bruno();

    // Ana continua editando o rascunho v2 da MTZ_B.
    const coords = coordsOf(base.document, base.draftB);
    const mine = apply(
      base.document,
      mineCtx,
      applyCellPatch({
        versionId: base.draftB,
        patch: { coords: [coords[0]!], set: { note: 'ainda editando' } },
      }),
    ).document;

    // Bruno publicou esse mesmo rascunho.
    const theirs = saved(
      publishDraft(base.document, theirsCtx, base.draftB),
      'Bruno',
      '2026-02-01T10:00:00.000Z',
    );

    const { merged, conflicts } = mergeDocuments(mine, theirs);

    // A publicada entra sempre; as edições da Ana viram uma versão nova, ainda
    // em rascunho — nada é descartado em silêncio.
    const versions = versionsOf(merged, base.matrixB);
    expect(versions.find((version) => version.id === base.draftB)!.state).toBe('PUBLISHED');
    const draft = versions.find((version) => version.state === 'DRAFT');
    expect(draft).toBeDefined();
    expect(draft!.number).toBe(3);
    expect(draft!.cells[`${coords[0]!.xPath}::${coords[0]!.yPath}`]!.note).toBe('ainda editando');
    expect(conflicts.every((conflict) => conflict.kind !== 'PUBLISHED_CLASH')).toBe(true);
    expectValid(merged);
    expectNoPublishedVersionLost(mine, theirs, merged);
  });
});
