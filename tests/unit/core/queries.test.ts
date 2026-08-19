import { beforeEach, describe, expect, it } from 'vitest';
import type { PolicyOpsDocument } from '@/core/document/schema';
import {
  axisStructureLabel,
  componentPath,
  countPending,
  filterComponentTree,
  findTypeaheadMatch,
  flattenComponentTree,
  getAxisStaleness,
  getChangeRequestTimeline,
  getComponentEffectiveVersion,
  getComponentTimeline,
  getEditorView,
  getEditorViewComputations,
  getEffectiveVersion,
  getMatrixTimeline,
  getOpenDraft,
  getPortfolioAt,
  getPrecedingVersion,
  getPublishedVersion,
  getStaleAxes,
  getVariableUsage,
  getVersionEvents,
  latestVersionOf,
  listComponentsEffectiveAt,
  listMatrices,
  listMatrixVersions,
  listOpenDrafts,
  listPendingComponentVersions,
  listPendingComponents,
  listProjectMatrices,
  listProjects,
  listUnmirroredMatrices,
  listVariables,
  nextPendingComponentId,
  nextVisibleNodeId,
  previousVisibleNodeId,
  resetEditorViewComputations,
  resolveOpenVersion,
} from '@/core/queries';
import { archiveComponent, createComponent } from '@/core/document/components';
import { setMatrixTags } from '@/core/document/commands';
import { addChangeRequestItem } from '@/core/document/change-requests';
import { linkChangeRequestDraft } from '@/core/document/cr-drafts';
import { publishChangeRequest } from '@/core/document/cr-publish';
import { createRelease } from '@/core/document/releases';
import { archiveCatalogItem, createCatalogItem } from '@/core/library/catalog';
import { addLevelCommand } from '@/core/versioning/axis-commands';
import { applyCellPatch } from '@/core/versioning/cells';
import { createComponentDraft, publishComponentVersion } from '@/core/versioning/component-lifecycle';
import { createDraft, createMatrix, locateVersion, publishVersion } from '@/core/versioning/lifecycle';
import {
  apply,
  baseDocument,
  coordsOf,
  createTestMatrix,
  DAY,
  documentWithAllStates,
  fillAllCells,
  IDS,
  SEG_X_FAT_TUPLES,
  T0,
  testCtx,
} from './versioning/fixtures';
import {
  avancarAte,
  criarDb,
  dbPublicavel,
  dbSubmetivel,
  politica,
  VIGENCIA_PROPOSTA,
} from './document/governance-fixtures';

function nestedMatrix() {
  const ctx = testCtx();
  const created = apply(
    baseDocument(),
    ctx,
    createMatrix({
      projectId: IDS.projectA,
      code: 'MTZ_PJ',
      name: 'Matriz PJ',
      x: { levels: [{ variableId: IDS.score }] },
      y: { levels: [{ variableId: IDS.segmento }, { variableId: IDS.fat }] },
    }),
  );
  return { ctx, document: created.document, ...created.data };
}

// ---------------------------------------------------------------------------
// getEditorView
// ---------------------------------------------------------------------------

describe('getEditorView', () => {
  beforeEach(() => {
    resetEditorViewComputations();
  });

  it('devolve tudo que o grid precisa numa chamada', () => {
    const { document, versionId } = nestedMatrix();
    const view = getEditorView(document, versionId);

    expect(view.matrix.code).toBe('MTZ_PJ');
    expect(view.project?.code).toBe('PROJ_A');
    expect(view.editable).toBe(true);
    expect(view.x.tupleCount).toBe(3);
    expect(view.y.tupleCount).toBe(8);
    expect(view.y.levelCount).toBe(2);
    expect(view.y.axis.tuples).toEqual(SEG_X_FAT_TUPLES);

    // Layout de cabeçalho aninhado, com os spans já calculados (S03).
    expect(view.y.headerRows).toHaveLength(2);
    expect(view.y.headerRows[0]!.cells.map((cell) => [cell.code, cell.span])).toEqual([
      ['VAREJO', 3],
      ['ATACADO', 3],
      ['CORPORATE', 2],
    ]);

    expect(view.stats).toEqual({
      combinations: 24,
      filledCells: 0,
      decidedCells: 0,
      pendingCells: 24,
    });

    expect(view.catalog.decisions.map((item) => item.code)).toEqual([
      'APROVADO',
      'REPROVADO',
      'ANALISE_MANUAL',
    ]);
    expect(view.catalog.byCode.DECISION.APROVADO!.color).toBe('#16A34A');
    expect(view.catalog.limits[0]!.numericValue).toBe('1000');
    expect(view.catalog.tags.map((item) => item.code)).toEqual(['REVISAR']);
  });

  it('reflete as estatísticas depois de decidir células', () => {
    const { ctx, document, versionId } = nestedMatrix();
    const coords = coordsOf(document, versionId).slice(0, 5);
    const editado = apply(
      document,
      ctx,
      applyCellPatch({ versionId, patch: { coords, set: { decision: 'APROVADO' } } }),
    ).document;

    expect(getEditorView(editado, versionId).stats).toEqual({
      combinations: 24,
      filledCells: 5,
      decidedCells: 5,
      pendingCells: 19,
    });
  });

  it('memoiza por (documento, versão) — o layout não é recalculado a cada leitura', () => {
    const { document, versionId } = nestedMatrix();

    // Simula o que o grid faz: uma leitura por célula renderizada.
    const primeira = getEditorView(document, versionId);
    for (let render = 0; render < 500; render++) {
      expect(getEditorView(document, versionId)).toBe(primeira);
    }
    expect(getEditorViewComputations()).toBe(1);

    // Outra versão do mesmo documento é outro cálculo.
    const outra = createTestMatrix(baseDocument(), testCtx());
    getEditorView(outra.document, outra.data.versionId);
    expect(getEditorViewComputations()).toBe(2);
  });

  it('recalcula quando o documento muda — a referência nova invalida o cache', () => {
    const { ctx, document, versionId } = nestedMatrix();
    getEditorView(document, versionId);
    expect(getEditorViewComputations()).toBe(1);

    const editado = apply(
      document,
      ctx,
      applyCellPatch({
        versionId,
        patch: { coords: coordsOf(document, versionId).slice(0, 1), set: { decision: 'APROVADO' } },
      }),
    ).document;

    const nova = getEditorView(editado, versionId);
    expect(getEditorViewComputations()).toBe(2);
    expect(nova.stats.filledCells).toBe(1);
    // E o documento antigo continua servido do cache, sem recalcular.
    getEditorView(document, versionId);
    expect(getEditorViewComputations()).toBe(2);
  });

  it('marca versão publicada como não editável e sem badge de defasagem', () => {
    const ctx = testCtx();
    const states = documentWithAllStates(ctx);
    const publicada = getEditorView(states.document, states.published);
    expect(publicada.editable).toBe(false);
    // O badge de defasagem só aparece em rascunho (§5.2).
    expect(publicada.staleness).toBeNull();

    const rascunho = getEditorView(states.document, states.draft);
    expect(rascunho.editable).toBe(true);
    expect(rascunho.staleness).not.toBeNull();
    expect(rascunho.staleness!.x.stale).toBe(false);
  });

  it('falha com NOT_FOUND para versão inexistente', () => {
    const { document } = nestedMatrix();
    expect(() => getEditorView(document, 'fantasma')).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('devolve project nulo quando a matriz aponta para projeto ausente', () => {
    const { document, versionId, matrixId } = nestedMatrix();
    const orfa: PolicyOpsDocument = structuredClone(document);
    orfa.matrices.find((matrix) => matrix.id === matrixId)!.projectId = IDS.projectB;
    orfa.projects = [];
    expect(getEditorView(orfa, versionId).project).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Defasagem — §5.2
// ---------------------------------------------------------------------------

describe('defasagem de eixo (§5.2)', () => {
  it('nada defasado num eixo recém-criado', () => {
    const { document, versionId } = nestedMatrix();
    const { version } = locateVersion(document, versionId);
    expect(getAxisStaleness(document, version.axes.y)).toEqual({
      role: 'Y',
      stale: false,
      reasons: [],
    });
    expect(getStaleAxes(document)).toEqual([]);
  });

  it('detecta pino de variável que deixou de ser a versão publicada', () => {
    const { document, versionId } = nestedMatrix();
    const evoluido: PolicyOpsDocument = structuredClone(document);
    const score = evoluido.variables.find((variable) => variable.id === IDS.score)!;
    score.versions[0]!.state = 'SUPERSEDED';

    const { version } = locateVersion(evoluido, versionId);
    const staleness = getAxisStaleness(evoluido, version.axes.x);
    expect(staleness.stale).toBe(true);
    expect(staleness.reasons[0]!.kind).toBe('LEVEL_PIN_OUTDATED');
    expect(getStaleAxes(evoluido)).toHaveLength(1);
  });

  it('detecta variável ou versão de variável que sumiu da biblioteca', () => {
    const { document, versionId } = nestedMatrix();
    const semVariavel: PolicyOpsDocument = structuredClone(document);
    semVariavel.variables = semVariavel.variables.filter(
      (variable) => variable.id !== IDS.score,
    );
    const { version } = locateVersion(semVariavel, versionId);
    expect(getAxisStaleness(semVariavel, version.axes.x).stale).toBe(true);
  });

  it('detecta regra de compatibilidade que deixou de estar publicada', () => {
    const { document, versionId } = nestedMatrix();
    const evoluido: PolicyOpsDocument = structuredClone(document);
    evoluido.compatibility[0]!.versions[0]!.state = 'SUPERSEDED';

    const { version } = locateVersion(evoluido, versionId);
    const staleness = getAxisStaleness(evoluido, version.axes.y);
    expect(staleness.stale).toBe(true);
    expect(staleness.reasons.map((reason) => reason.kind)).toContain('RULE_OUTDATED');
  });

  it('detecta regra que sumiu da biblioteca', () => {
    const { document, versionId } = nestedMatrix();
    const semRegra: PolicyOpsDocument = structuredClone(document);
    semRegra.compatibility = [];

    const { version } = locateVersion(semRegra, versionId);
    const staleness = getAxisStaleness(semRegra, version.axes.y);
    expect(staleness.reasons.map((reason) => reason.kind)).toEqual([
      'RULE_OUTDATED',
    ]);
  });

  it('detecta regra publicada que passou a existir para um par sem regra', () => {
    const ctx = testCtx();
    // Eixo Y sem regra entre SEGMENTO e RESTRITIVO.
    const created = apply(
      baseDocument(),
      ctx,
      createMatrix({
        projectId: IDS.projectA,
        code: 'MTZ_NOVA_REGRA',
        name: 'Matriz',
        x: { levels: [{ variableId: IDS.score }] },
        y: { levels: [{ variableId: IDS.segmento }, { variableId: IDS.restritivo }] },
      }),
    );

    const comRegraNova: PolicyOpsDocument = structuredClone(created.document);
    comRegraNova.compatibility.push({
      id: 'segxrestr___',
      code: 'SEG_X_RESTRITIVO',
      name: 'Segmento × Restritivo',
      parentVariableId: IDS.segmento,
      childVariableId: IDS.restritivo,
      createdAt: T0,
      versions: [
        {
          id: 'segxrestrV1_',
          number: 1,
          state: 'PUBLISHED',
          createdAt: T0,
          createdBy: 'Equipe',
          publishedAt: T0,
          publishedBy: 'Equipe',
          parentVariableVersionId: IDS.segmentoV1,
          childVariableVersionId: IDS.restritivoV1,
          allow: { VAREJO: ['SEM'] },
          defaultForUnlisted: 'ALL',
        },
      ],
    });

    const { version } = locateVersion(comRegraNova, created.data.versionId);
    const staleness = getAxisStaleness(comRegraNova, version.axes.y);
    expect(staleness.stale).toBe(true);
    expect(staleness.reasons[0]!.kind).toBe('NEW_RULE_AVAILABLE');
    expect(staleness.reasons[0]!.ruleCode).toBe('SEG_X_RESTRITIVO');

    // Regra arquivada não conta como novidade.
    const arquivada: PolicyOpsDocument = structuredClone(comRegraNova);
    arquivada.compatibility[1]!.archivedAt = T0;
    const arquivadaVersion = locateVersion(arquivada, created.data.versionId).version;
    expect(getAxisStaleness(arquivada, arquivadaVersion.axes.y).stale).toBe(false);
  });

  it('lista apenas rascunhos defasados — publicadas são registro, não pendência', () => {
    const ctx = testCtx();
    const states = documentWithAllStates(ctx);
    const evoluido: PolicyOpsDocument = structuredClone(states.document);
    evoluido.variables.find((variable) => variable.id === IDS.score)!.versions[0]!.state =
      'SUPERSEDED';

    const stale = getStaleAxes(evoluido);
    expect(stale).toHaveLength(1);
    expect(stale[0]!.versionId).toBe(states.draft);
    expect(stale[0]!.staleness.role).toBe('X');
    expect(stale[0]!.matrixCode).toBe('MTZ_A');
  });
});

// ---------------------------------------------------------------------------
// Histórico, vigência e biblioteca
// ---------------------------------------------------------------------------

describe('listMatrixVersions e getVersionEvents', () => {
  it('lista o histórico da mais recente para a mais antiga, com estados e vigências', () => {
    const ctx = testCtx();
    const states = documentWithAllStates(ctx);
    const versions = listMatrixVersions(states.document, states.matrixId);

    expect(versions.map((version) => [version.number, version.state])).toEqual([
      [4, 'DRAFT'],
      [3, 'PUBLISHED'],
      [2, 'ARCHIVED'],
      [1, 'SUPERSEDED'],
    ]);
    const publicada = versions[1]!;
    expect(publicada.publishedBy).toBe('Arthur');
    expect(publicada.notes).toBe('Segunda publicação.');
    expect(publicada.effectiveFrom).toBeDefined();
    expect(publicada.baseVersionId).toBe(states.superseded);
    expect(publicada.combinations).toBe(6);
    expect(publicada.filledCells).toBe(6);
    expect(publicada.pendingCells).toBe(0);
    expect(versions[3]!.effectiveTo).toBe(publicada.effectiveFrom);
    expect(versions[2]!.archivedAt).toBe(T0);
  });

  it('devolve a auditoria da versão em ordem cronológica', () => {
    const ctx = testCtx();
    const states = documentWithAllStates(ctx);
    const events = getVersionEvents(states.document, states.superseded);
    expect(events.map((event) => event.type)).toEqual([
      'DRAFT_CREATED',
      'CELLS_UPDATED',
      'VERSION_PUBLISHED',
      'VERSION_SUPERSEDED',
    ]);
    expect(getVersionEvents(states.document, 'fantasma')).toEqual([]);
  });

  it('conta pendências por versão', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    expect(countPending(created.document, created.data.versionId)).toBe(6);
    const filled = fillAllCells(created.document, ctx, created.data.versionId);
    expect(countPending(filled, created.data.versionId)).toBe(0);
  });
});

describe('getEffectiveVersion e getPortfolioAt', () => {
  it('devolve null quando a matriz nunca teve versão publicada', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    expect(getEffectiveVersion(created.document, created.data.matrixId, new Date(T0))).toBeNull();
  });

  it('monta o portfólio do projeto na data pedida', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const filled = fillAllCells(created.document, ctx, created.data.versionId);
    const publicada = apply(
      filled,
      ctx,
      publishVersion({ versionId: created.data.versionId, notes: 'Publicação inicial.' }),
    ).document;
    // Uma segunda matriz do mesmo projeto, ainda em rascunho.
    const outra = createTestMatrix(publicada, ctx, 'MTZ_B');

    const portfolio = getPortfolioAt(outra.document, IDS.projectA, new Date(T0));
    expect(portfolio.map((entry) => [entry.matrix.code, entry.version?.number ?? null])).toEqual([
      ['MTZ_A', 1],
      ['MTZ_B', null],
    ]);
    expect(getPortfolioAt(outra.document, IDS.projectB, new Date(T0))).toEqual([]);
  });

  it('nos limites da troca: um instante antes vale a antiga, no instante exato e depois valem a nova (intervalo semiaberto)', () => {
    const ctx = testCtx();
    const state = documentWithAllStates(ctx);
    // `documentWithAllStates`: superseded publicada em T0, published (v3) publicada em T0+DAY.
    const transitionInstant = new Date(T0).getTime() + DAY;

    const before = getEffectiveVersion(state.document, state.matrixId, new Date(transitionInstant - 1));
    expect(before?.id).toBe(state.superseded);

    const exact = getEffectiveVersion(state.document, state.matrixId, new Date(transitionInstant));
    expect(exact?.id).toBe(state.published);

    const after = getEffectiveVersion(state.document, state.matrixId, new Date(transitionInstant + 1));
    expect(after?.id).toBe(state.published);
  });

  it('data anterior à primeira publicação devolve null', () => {
    const ctx = testCtx();
    const state = documentWithAllStates(ctx);
    const before = new Date(new Date(T0).getTime() - 1);
    expect(getEffectiveVersion(state.document, state.matrixId, before)).toBeNull();
  });

  it('versão agendada para o futuro não vale hoje, mas vale a partir da data do agendamento', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const filled = fillAllCells(created.document, ctx, created.data.versionId);
    const future = new Date(new Date(T0).getTime() + 30 * DAY).toISOString();
    const scheduled = apply(
      filled,
      ctx,
      publishVersion({ versionId: created.data.versionId, notes: 'Publicação agendada.', effectiveFrom: future }),
    ).document;

    expect(getEffectiveVersion(scheduled, created.data.matrixId, new Date(T0))).toBeNull();
    expect(getEffectiveVersion(scheduled, created.data.matrixId, new Date(future))).not.toBeNull();
    expect(getEffectiveVersion(scheduled, created.data.matrixId, new Date(future))?.number).toBe(1);
  });

  it('getPortfolioAt com matrizes de idades diferentes: cada uma responde pela própria vigência', () => {
    const ctx = testCtx();
    // MTZ_A publica em T0.
    const first = createTestMatrix(baseDocument(), ctx);
    let doc = fillAllCells(first.document, ctx, first.data.versionId);
    doc = apply(doc, ctx, publishVersion({ versionId: first.data.versionId, notes: 'Primeira matriz.' })).document;

    // MTZ_B só nasce e publica bem mais tarde.
    ctx.advance(60 * DAY);
    const second = createTestMatrix(doc, ctx, 'MTZ_B');
    doc = fillAllCells(second.document, ctx, second.data.versionId);
    doc = apply(doc, ctx, publishVersion({ versionId: second.data.versionId, notes: 'Segunda matriz, bem mais nova.' }))
      .document;

    // A 30 dias de T0: MTZ_A já vigora, MTZ_B ainda não existia.
    const midDate = new Date(new Date(T0).getTime() + 30 * DAY);
    const midPortfolio = getPortfolioAt(doc, IDS.projectA, midDate);
    expect(midPortfolio.map((entry) => [entry.matrix.code, entry.version?.number ?? null])).toEqual([
      ['MTZ_A', 1],
      ['MTZ_B', null],
    ]);

    // Hoje (ctx.now(), depois dos 60 dias): as duas vigoram.
    const todayPortfolio = getPortfolioAt(doc, IDS.projectA, ctx.now());
    expect(todayPortfolio.map((entry) => [entry.matrix.code, entry.version?.number ?? null])).toEqual([
      ['MTZ_A', 1],
      ['MTZ_B', 1],
    ]);
  });
});

describe('getMatrixTimeline', () => {
  it('um segmento por versão publicada/superada, em ordem cronológica — sem rascunho nem descartada', () => {
    const ctx = testCtx();
    const state = documentWithAllStates(ctx);
    const { matrix } = locateVersion(state.document, state.draft);

    const timeline = getMatrixTimeline(matrix);
    expect(timeline.map((segment) => segment.versionId)).toEqual([state.superseded, state.published]);
    expect(timeline[0]).toMatchObject({ state: 'SUPERSEDED', effectiveFrom: T0 });
    expect(timeline[0]!.effectiveTo).toBe(timeline[1]!.effectiveFrom);
    expect(timeline[1]).toMatchObject({ state: 'PUBLISHED', effectiveTo: null });
  });

  it('matriz sem nenhuma versão publicada devolve lista vazia', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const { matrix } = locateVersion(created.document, created.data.versionId);
    expect(getMatrixTimeline(matrix)).toEqual([]);
  });
});

describe('vigência mostra a estrutura de eixos DAQUELA versão, não a atual', () => {
  it('matriz cujo eixo Y ganhou um nível entre v1 e v2: a consulta antiga devolve a estrutura antiga', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const v1Id = created.data.versionId;
    let doc = fillAllCells(created.document, ctx, v1Id);
    doc = apply(doc, ctx, publishVersion({ versionId: v1Id, notes: 'Publicação inicial — Y só com Restritivo.' }))
      .document;

    const draft = apply(doc, ctx, createDraft({ matrixId: created.data.matrixId }));
    doc = apply(
      draft.document,
      ctx,
      addLevelCommand({ versionId: draft.data.versionId, role: 'Y', variableId: IDS.segmento, position: 1 }),
    ).document;
    ctx.advance(DAY);
    doc = apply(
      doc,
      ctx,
      publishVersion({ versionId: draft.data.versionId, notes: 'Y ganhou Segmento.' }),
    ).document;

    // Na data de v1, a estrutura consultada é a de v1 — um nível só.
    const atV1 = getEffectiveVersion(doc, created.data.matrixId, new Date(T0));
    expect(atV1?.id).toBe(v1Id);
    expect(axisStructureLabel(atV1!.axes.y)).toBe('Restritivo');

    // Hoje, a vigente é v2 — dois níveis.
    const atToday = getEffectiveVersion(doc, created.data.matrixId, ctx.now());
    expect(atToday?.id).toBe(draft.data.versionId);
    expect(axisStructureLabel(atToday!.axes.y)).toBe('Restritivo › Segmento');
  });
});

describe('listVariables e getVariableUsage', () => {
  it('conta o uso de cada variável e separa publicada de rascunho', () => {
    const ctx = testCtx();
    const { document, matrixId, versionId } = nestedMatrix();
    const comRascunho = apply(
      fillAllCells(document, ctx, versionId),
      ctx,
      publishVersion({ versionId, notes: 'Publicação inicial.' }),
    ).document;
    const comV2 = apply(comRascunho, ctx, createDraft({ matrixId })).document;

    const variables = listVariables(comV2);
    const porCodigo = new Map(variables.map((entry) => [entry.variable.code, entry]));
    // SCORE está no eixo X das duas versões.
    expect(porCodigo.get('SCORE')!.usageCount).toBe(2);
    expect(porCodigo.get('SCORE')!.publishedVersion?.id).toBe(IDS.scoreV1);
    expect(porCodigo.get('SCORE')!.draftVersion).toBeNull();
    expect(porCodigo.get('SEM_PUB')!.publishedVersion).toBeNull();
    expect(porCodigo.get('SEM_PUB')!.draftVersion?.id).toBe(IDS.semPublicadaV1);
    expect(porCodigo.get('RESTRITIVO')!.usageCount).toBe(0);
  });

  it('filtra por busca e por arquivadas', () => {
    const arquivada: PolicyOpsDocument = structuredClone(baseDocument());
    arquivada.variables.find((variable) => variable.id === IDS.fat)!.archivedAt = T0;

    expect(listVariables(arquivada).map((entry) => entry.variable.code)).not.toContain('FAT');
    expect(
      listVariables(arquivada, { includeArchived: true }).map((entry) => entry.variable.code),
    ).toContain('FAT');
    expect(listVariables(arquivada, { search: 'segm' }).map((entry) => entry.variable.code)).toEqual(
      ['SEGMENTO'],
    );
    expect(listVariables(arquivada, { search: '  ' })).toHaveLength(6);
  });

  it('diz quem pina cada versão da variável', () => {
    const { document, versionId } = nestedMatrix();
    const usage = getVariableUsage(document, IDS.fat);
    expect(usage).toEqual([
      {
        matrixId: locateVersion(document, versionId).matrix.id,
        matrixCode: 'MTZ_PJ',
        versionId,
        versionNumber: 1,
        versionState: 'DRAFT',
        role: 'Y',
        levelIndex: 1,
        variableVersionId: IDS.fatV1,
        variableVersionNumber: 1,
      },
    ]);
    expect(getVariableUsage(document, IDS.restritivo)).toEqual([]);
  });

  it('reporta número de versão nulo quando o pino aponta para versão inexistente', () => {
    const { document } = nestedMatrix();
    const quebrado: PolicyOpsDocument = structuredClone(document);
    quebrado.variables.find((variable) => variable.id === IDS.fat)!.versions = [];
    expect(getVariableUsage(quebrado, IDS.fat)[0]!.variableVersionNumber).toBeNull();

    const semVariavel: PolicyOpsDocument = structuredClone(document);
    semVariavel.variables = semVariavel.variables.filter((variable) => variable.id !== IDS.fat);
    expect(getVariableUsage(semVariavel, IDS.fat)[0]!.variableVersionNumber).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Navegação de projeto → matriz → versão — docs/09 S09
// ---------------------------------------------------------------------------

describe('resolveOpenVersion — vigente; senão rascunho; senão nulo', () => {
  it('devolve o rascunho quando não há versão publicada', () => {
    const { document, versionId } = nestedMatrix();
    const { matrix } = locateVersion(document, versionId);
    expect(resolveOpenVersion(matrix)?.id).toBe(versionId);
  });

  it('devolve a vigente quando ela existe, mesmo com um rascunho mais novo', () => {
    const { ctx, document, versionId } = nestedMatrix();
    const filled = fillAllCells(document, ctx, versionId);
    const published = apply(filled, ctx, publishVersion({ versionId, notes: 'Publicação inicial.' }));
    const matrixId = locateVersion(published.document, versionId).matrix.id;
    const draft = apply(published.document, ctx, createDraft({ matrixId }));
    const { matrix } = locateVersion(draft.document, versionId);
    expect(resolveOpenVersion(matrix)?.id).toBe(versionId);
  });

  it('devolve nulo quando a matriz não tem nenhuma versão aberta', () => {
    const matrixSemVersao = { ...nestedMatrix().document.matrices[0]!, versions: [] };
    expect(resolveOpenVersion(matrixSemVersao)).toBeNull();
  });
});

describe('latestVersionOf e axisStructureLabel', () => {
  it('latestVersionOf devolve a versão de maior número', () => {
    const { ctx, document, versionId } = nestedMatrix();
    const filled = fillAllCells(document, ctx, versionId);
    const published = apply(filled, ctx, publishVersion({ versionId, notes: 'Publicação inicial.' }));
    const { matrix } = locateVersion(published.document, versionId);
    const draft = apply(published.document, ctx, createDraft({ matrixId: matrix.id }));
    const { matrix: matrixWithDraft } = locateVersion(draft.document, draft.data.versionId);
    expect(latestVersionOf(matrixWithDraft)?.number).toBe(2);
  });

  it('latestVersionOf devolve nulo para matriz sem versões', () => {
    const semVersao = { ...nestedMatrix().document.matrices[0]!, versions: [] };
    expect(latestVersionOf(semVersao)).toBeNull();
  });

  it('axisStructureLabel junta os rótulos de nível com "›"', () => {
    const { document, versionId } = nestedMatrix();
    const { version } = locateVersion(document, versionId);
    expect(axisStructureLabel(version.axes.x)).toBe('Score');
    expect(axisStructureLabel(version.axes.y)).toBe('Segmento › Faturamento');
  });
});

describe('listProjects e listProjectMatrices', () => {
  it('lista projetos ativos, ordenados por position, com contagem de matrizes e rascunhos abertos', () => {
    const { document } = nestedMatrix();
    const summaries = listProjects(document);
    expect(summaries.map((s) => s.project.id)).toEqual([IDS.projectA, IDS.projectB]);
    const projectA = summaries.find((s) => s.project.id === IDS.projectA)!;
    expect(projectA.matrixCount).toBe(1);
    expect(projectA.openDraftCount).toBe(1);
    const projectB = summaries.find((s) => s.project.id === IDS.projectB)!;
    expect(projectB.matrixCount).toBe(0);
    expect(projectB.openDraftCount).toBe(0);
  });

  it('lista as matrizes do projeto com a estrutura de eixos e os badges de versão', () => {
    const { ctx, document, versionId } = nestedMatrix();
    const filled = fillAllCells(document, ctx, versionId);
    const published = apply(filled, ctx, publishVersion({ versionId, notes: 'Publicação inicial.' }));

    const matrices = listProjectMatrices(published.document, IDS.projectA);
    expect(matrices).toHaveLength(1);
    expect(matrices[0]!.xLabel).toBe('Score');
    expect(matrices[0]!.yLabel).toBe('Segmento › Faturamento');
    expect(matrices[0]!.publishedVersion?.id).toBe(versionId);
    expect(matrices[0]!.draftVersion).toBeNull();
  });

  it('projeto sem nenhuma matriz devolve lista vazia', () => {
    const { document } = nestedMatrix();
    expect(listProjectMatrices(document, IDS.projectB)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S13 — ciclo de vida na interface
// ---------------------------------------------------------------------------

describe('getPublishedVersion, getOpenDraft e getPrecedingVersion', () => {
  it('resolve a vigente, o rascunho aberto e a versão que ela substituiu', () => {
    const ctx = testCtx();
    const states = documentWithAllStates(ctx);
    const { matrix } = locateVersion(states.document, states.draft);

    expect(getPublishedVersion(matrix)?.id).toBe(states.published);
    expect(getOpenDraft(matrix)?.id).toBe(states.draft);

    const publishedVersion = matrix.versions.find((version) => version.id === states.published)!;
    expect(getPrecedingVersion(matrix, publishedVersion)?.id).toBe(states.superseded);
  });

  it('sem vigente publicada, devolve nulo para vigente e para a precedente', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const { matrix } = locateVersion(created.document, created.data.versionId);

    expect(getPublishedVersion(matrix)).toBeNull();
    // O próprio v1, ainda em DRAFT, é o "rascunho aberto".
    expect(getOpenDraft(matrix)?.id).toBe(created.data.versionId);
    const draftVersion = matrix.versions[0]!;
    expect(getPrecedingVersion(matrix, draftVersion)).toBeNull();
  });
});

describe('listOpenDrafts', () => {
  it('lista os rascunhos abertos de todos os projetos, com o projeto e as pendências', () => {
    const ctx = testCtx();
    const states = documentWithAllStates(ctx);
    const entries = listOpenDrafts(states.document);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.version.id).toBe(states.draft);
    expect(entries[0]!.matrix.id).toBe(states.matrixId);
    expect(entries[0]!.project?.id).toBe(IDS.projectA);
    expect(entries[0]!.pendingCells).toBe(0);
  });

  it('sem nenhum rascunho aberto em nenhuma matriz, devolve lista vazia', () => {
    const ctx = testCtx();
    const created = createTestMatrix(baseDocument(), ctx);
    const filled = fillAllCells(created.document, ctx, created.data.versionId);
    const published = apply(
      filled,
      ctx,
      publishVersion({ versionId: created.data.versionId, notes: 'Publicação inicial.' }),
    ).document;
    expect(listOpenDrafts(published)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listMatrices — docs/07-ux-e-editor.md §15
// ---------------------------------------------------------------------------

const TAG_GROUP_OF: Record<string, string> = {
  CANAL_DIGITAL: 'Canal',
  CANAL_URA: 'Canal',
  CLUSTER_G4: 'Cluster',
  CLUSTER_G1: 'Cluster',
};

function taggedMatricesDoc() {
  const ctx = testCtx();
  let document = baseDocument();

  for (const code of Object.keys(TAG_GROUP_OF)) {
    document = apply(
      document,
      ctx,
      createCatalogItem({ kind: 'TAG', code, label: code, group: TAG_GROUP_OF[code]! }),
    ).document;
  }

  function makeMatrix(code: string, tags: string[]): string {
    const created = createTestMatrix(document, ctx, code);
    document = created.document;
    if (tags.length > 0) {
      document = apply(document, ctx, setMatrixTags({ matrixId: created.data.matrixId, add: tags })).document;
    }
    return created.data.matrixId;
  }

  const m1 = makeMatrix('MTZ_M1', ['CANAL_DIGITAL', 'CLUSTER_G4']);
  const m2 = makeMatrix('MTZ_M2', ['CANAL_URA', 'CLUSTER_G4']);
  const m3 = makeMatrix('MTZ_M3', ['CANAL_DIGITAL', 'CLUSTER_G1']);
  const m4 = makeMatrix('MTZ_M4', []);

  return { ctx, get document() { return document; }, m1, m2, m3, m4 };
}

describe('listMatrices', () => {
  it('OU dentro do grupo: duas tags do mesmo grupo somam', () => {
    const { document, m1, m2, m3, m4 } = taggedMatricesDoc();
    const result = listMatrices(document, {
      projectId: IDS.projectA,
      tags: ['CANAL_DIGITAL', 'CANAL_URA'],
    });
    const ids = result.matrices.map((m) => m.id);
    expect(new Set(ids)).toEqual(new Set([m1, m2, m3]));
    expect(ids).not.toContain(m4);
  });

  it('E entre grupos diferentes: só quem tem as duas facetas passa', () => {
    const { document, m1, m2, m3 } = taggedMatricesDoc();
    const result = listMatrices(document, {
      projectId: IDS.projectA,
      tags: ['CANAL_DIGITAL', 'CLUSTER_G4'],
    });
    const ids = result.matrices.map((m) => m.id);
    expect(ids).toEqual([m1]);
    expect(ids).not.toContain(m2);
    expect(ids).not.toContain(m3);
  });

  it('a contagem de cada tag é sobre o conjunto antes do filtro do próprio grupo', () => {
    const { document } = taggedMatricesDoc();
    // Filtrando só por Cluster: G4 — o facet de Canal deve contar dentro do
    // subconjunto que já tem Cluster: G4 (M1 e M2), não do total do projeto.
    const result = listMatrices(document, { projectId: IDS.projectA, tags: ['CLUSTER_G4'] });
    const canal = result.facets.find((g) => g.group === 'Canal')!;
    expect(canal.options.find((o) => o.code === 'CANAL_DIGITAL')!.count).toBe(1);
    expect(canal.options.find((o) => o.code === 'CANAL_URA')!.count).toBe(1);

    // O facet do próprio grupo (Cluster) ignora o filtro de Cluster e conta
    // sobre as 4 matrizes do projeto.
    const cluster = result.facets.find((g) => g.group === 'Cluster')!;
    expect(cluster.options.find((o) => o.code === 'CLUSTER_G4')!.count).toBe(2);
    expect(cluster.options.find((o) => o.code === 'CLUSTER_G1')!.count).toBe(1);
  });

  it('tag arquivada some das facetas, mas a matriz que já a tem continua visível', () => {
    const { ctx, document, m3 } = taggedMatricesDoc();
    const g1Id = document.catalog.find((item) => item.kind === 'TAG' && item.code === 'CLUSTER_G1')!.id;
    const arquivado = apply(document, ctx, archiveCatalogItem({ id: g1Id })).document;

    const result = listMatrices(arquivado, { projectId: IDS.projectA });
    const cluster = result.facets.find((g) => g.group === 'Cluster')!;
    expect(cluster.options.some((o) => o.code === 'CLUSTER_G1')).toBe(false);

    // A matriz continua na lista, e a tag arquivada continua no seu `tags`.
    const matrix = result.matrices.find((m) => m.id === m3)!;
    expect(matrix.tags).toContain('CLUSTER_G1');
  });

  it('busca combinada com filtro de tag: as duas condições valem ao mesmo tempo', () => {
    const { document, m1 } = taggedMatricesDoc();
    const soDigitalG4 = listMatrices(document, {
      projectId: IDS.projectA,
      tags: ['CANAL_DIGITAL', 'CLUSTER_G4'],
      search: 'MTZ_M1',
    });
    expect(soDigitalG4.matrices.map((m) => m.id)).toEqual([m1]);

    const buscaSemBater = listMatrices(document, {
      projectId: IDS.projectA,
      tags: ['CANAL_DIGITAL', 'CLUSTER_G4'],
      search: 'MTZ_M2',
    });
    expect(buscaSemBater.matrices).toEqual([]);
  });

  it('sem filtro nenhum, devolve todas as matrizes do projeto', () => {
    const { document, m1, m2, m3, m4 } = taggedMatricesDoc();
    const result = listMatrices(document, { projectId: IDS.projectA });
    expect(new Set(result.matrices.map((m) => m.id))).toEqual(new Set([m1, m2, m3, m4]));
  });
});

// ---------------------------------------------------------------------------
// Árvore de política — docs/07-ux-e-editor.md §17, S33a
// ---------------------------------------------------------------------------

/**
 * CMA
 *  └ Fraude
 *      ├ RegraA (RULE, tag CANAL_DIGITAL, PENDING_REVIEW)
 *      └ RegraB (RULE, tag CANAL_URA)
 * Grupos (SECTION, sem filhos)
 */
function policyTreeDoc() {
  const ctx = testCtx();
  let document = baseDocument();

  document = apply(
    document,
    ctx,
    createCatalogItem({ kind: 'TAG', code: 'CANAL_DIGITAL', label: 'Digital', group: 'Canal' }),
  ).document;
  document = apply(
    document,
    ctx,
    createCatalogItem({ kind: 'TAG', code: 'CANAL_URA', label: 'URA', group: 'Canal' }),
  ).document;

  const cma = apply(
    document,
    ctx,
    createComponent({ projectId: IDS.projectA, code: 'CMA', name: 'CMA', type: 'SECTION' }),
  );
  document = cma.document;
  const fraude = apply(
    document,
    ctx,
    createComponent({
      projectId: IDS.projectA,
      code: 'FRAUDE',
      name: 'Fraude',
      type: 'SECTION',
      parentId: cma.data.componentId,
    }),
  );
  document = fraude.document;
  const regraA = apply(
    document,
    ctx,
    createComponent({
      projectId: IDS.projectA,
      code: 'REGRA_A',
      name: 'Regra A',
      type: 'RULE',
      parentId: fraude.data.componentId,
      tags: ['CANAL_DIGITAL'],
      reviewStatus: 'PENDING_REVIEW',
    }),
  );
  document = regraA.document;
  const regraB = apply(
    document,
    ctx,
    createComponent({
      projectId: IDS.projectA,
      code: 'REGRA_B',
      name: 'Regra B',
      type: 'RULE',
      parentId: fraude.data.componentId,
      tags: ['CANAL_URA'],
    }),
  );
  document = regraB.document;
  const grupos = apply(
    document,
    ctx,
    createComponent({ projectId: IDS.projectA, code: 'GRUPOS', name: 'Grupos', type: 'SECTION' }),
  );
  document = grupos.document;

  return {
    ctx,
    document,
    cma: cma.data.componentId,
    fraude: fraude.data.componentId,
    regraA: regraA.data.componentId,
    regraB: regraB.data.componentId,
    grupos: grupos.data.componentId,
  };
}

describe('componentPath', () => {
  it('devolve o caminho da raiz até o nó, inclusive', () => {
    const { document, cma, fraude, regraA } = policyTreeDoc();
    const path = componentPath(document, regraA);
    expect(path.map((c) => c.id)).toEqual([cma, fraude, regraA]);
  });

  it('componente raiz devolve caminho de um elemento', () => {
    const { document, cma } = policyTreeDoc();
    expect(componentPath(document, cma).map((c) => c.id)).toEqual([cma]);
  });
});

describe('listUnmirroredMatrices', () => {
  it('exclui matrizes já referenciadas por um nó MATRIX e as arquivadas', () => {
    const { ctx, document, cma } = policyTreeDoc();
    const livre = createTestMatrix(document, ctx, 'MTZ_LIVRE');
    const pendurada = createTestMatrix(livre.document, ctx, 'MTZ_PENDURADA');
    const comNo = apply(
      pendurada.document,
      ctx,
      createComponent({
        projectId: IDS.projectA,
        code: 'NODE_MATRIZ',
        name: 'Matriz pendurada',
        type: 'MATRIX',
        matrixId: pendurada.data.matrixId,
        parentId: cma,
      }),
    );

    const result = listUnmirroredMatrices(comNo.document, IDS.projectA);
    expect(result.map((m) => m.id)).toEqual([livre.data.matrixId]);
  });

  it('só considera matrizes do projeto informado', () => {
    const { document } = policyTreeDoc();
    const outroProjeto = apply(
      document,
      testCtx(),
      createMatrix({
        projectId: IDS.projectB,
        code: 'MTZ_B',
        name: 'Matriz B',
        x: { levels: [{ variableId: IDS.score }] },
        y: { levels: [{ variableId: IDS.restritivo }] },
      }),
    );
    const result = listUnmirroredMatrices(outroProjeto.document, IDS.projectA);
    expect(result.map((m) => m.code)).not.toContain('MTZ_B');
  });
});

describe('filterComponentTree', () => {
  it('sem filtro: matchedIds e visibleIds cobrem todos os componentes ativos do projeto', () => {
    const { document, cma, fraude, regraA, regraB, grupos } = policyTreeDoc();
    const result = filterComponentTree(document, IDS.projectA, {});
    const expected = new Set([cma, fraude, regraA, regraB, grupos]);
    expect(result.matchedIds).toEqual(expected);
    expect(result.visibleIds).toEqual(expected);
  });

  it('busca por nome preserva os ancestrais em visibleIds, sem marcá-los como match', () => {
    const { document, cma, fraude, regraA, regraB, grupos } = policyTreeDoc();
    const result = filterComponentTree(document, IDS.projectA, { search: 'Regra A' });

    expect(result.matchedIds).toEqual(new Set([regraA]));
    // Ancestrais (CMA, Fraude) continuam visíveis — a árvore não achata.
    expect(result.visibleIds).toEqual(new Set([cma, fraude, regraA]));
    expect(result.visibleIds.has(regraB)).toBe(false);
    expect(result.visibleIds.has(grupos)).toBe(false);
  });

  it('filtro por tipo: só RULE, com os ancestrais SECTION preservados em visibleIds', () => {
    const { document, cma, fraude, regraA, regraB } = policyTreeDoc();
    const result = filterComponentTree(document, IDS.projectA, { types: ['RULE'] });
    expect(result.matchedIds).toEqual(new Set([regraA, regraB]));
    expect(result.visibleIds).toEqual(new Set([cma, fraude, regraA, regraB]));
  });

  it('filtro por reviewStatus', () => {
    const { document, regraA } = policyTreeDoc();
    const result = filterComponentTree(document, IDS.projectA, { reviewStatuses: ['PENDING_REVIEW'] });
    expect(result.matchedIds).toEqual(new Set([regraA]));
  });

  it('filtro por tag: OU dentro do grupo devolve as duas regras do canal', () => {
    const { document, regraA, regraB } = policyTreeDoc();
    const result = filterComponentTree(document, IDS.projectA, { tags: ['CANAL_DIGITAL', 'CANAL_URA'] });
    expect(result.matchedIds).toEqual(new Set([regraA, regraB]));
    const canal = result.facets.find((g) => g.group === 'Canal')!;
    expect(canal.options.find((o) => o.code === 'CANAL_DIGITAL')!.count).toBe(1);
  });

  it('componente arquivado nunca aparece em matchedIds nem visibleIds', () => {
    const { ctx, document, regraB } = policyTreeDoc();
    const arquivado = apply(document, ctx, archiveComponent({ componentId: regraB })).document;
    const result = filterComponentTree(arquivado, IDS.projectA, {});
    expect(result.matchedIds.has(regraB)).toBe(false);
    expect(result.visibleIds.has(regraB)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Vigência e linha do tempo de componente
// ---------------------------------------------------------------------------

const VIGENCIA_1 = '2026-02-01T00:00:00.000Z';
const VIGENCIA_2 = '2026-03-01T00:00:00.000Z';

describe('getComponentTimeline', () => {
  it('um segmento por versão publicada/histórica, em ordem cronológica; MATRIX nunca versiona', () => {
    const { ctx, document, regraA } = policyTreeDoc();
    const v1 = apply(
      document,
      ctx,
      createComponentDraft({ componentId: regraA, payload: { kind: 'RULE', businessDescription: 'v1' } }),
    );
    const p1 = apply(v1.document, ctx, publishComponentVersion({ versionId: v1.data.versionId, effectiveFrom: VIGENCIA_1 }));
    const v2 = apply(p1.document, ctx, createComponentDraft({ componentId: regraA }));
    const p2 = apply(v2.document, ctx, publishComponentVersion({ versionId: v2.data.versionId, effectiveFrom: VIGENCIA_2 }));

    const component = p2.document.components.find((c) => c.id === regraA)!;
    const timeline = getComponentTimeline(component);
    expect(timeline.map((s) => [s.number, s.state, s.effectiveFrom, s.effectiveTo])).toEqual([
      [1, 'SUPERSEDED', VIGENCIA_1, VIGENCIA_2],
      [2, 'PUBLISHED', VIGENCIA_2, null],
    ]);
  });

  it('componente sem nenhuma versão publicada devolve timeline vazia', () => {
    const { document, regraB } = policyTreeDoc();
    const component = document.components.find((c) => c.id === regraB)!;
    expect(getComponentTimeline(component)).toEqual([]);
  });
});

describe('getComponentEffectiveVersion e listComponentsEffectiveAt', () => {
  it('seção sem nenhuma versão nunca entra na consulta de vigência (I29) — não é "sem política vigente"', () => {
    const { document, cma } = policyTreeDoc();
    const secaoPura = document.components.find((c) => c.id === cma)!;
    expect(secaoPura.versions).toEqual([]);
    expect(getComponentEffectiveVersion(secaoPura, new Date(VIGENCIA_1))).toBeNull();

    const entries = listComponentsEffectiveAt(document, IDS.projectA, new Date(VIGENCIA_1));
    expect(entries.some((entry) => entry.component.id === cma)).toBe(false);
  });

  it('componente documentável sem versão vigente na data aparece com version: null', () => {
    const { ctx, document, regraA } = policyTreeDoc();
    const v1 = apply(
      document,
      ctx,
      createComponentDraft({ componentId: regraA, payload: { kind: 'RULE', businessDescription: 'v1' } }),
    );
    const publicado = apply(v1.document, ctx, publishComponentVersion({ versionId: v1.data.versionId, effectiveFrom: VIGENCIA_1 }));

    const antesDaFundacao = listComponentsEffectiveAt(publicado.document, IDS.projectA, new Date('2026-01-01T00:00:00.000Z'));
    const entry = antesDaFundacao.find((candidate) => candidate.component.id === regraA);
    expect(entry).toBeDefined();
    expect(entry!.version).toBeNull();
    expect(getComponentEffectiveVersion(entry!.component, new Date('2026-01-01T00:00:00.000Z'))).toBeNull();

    const depois = listComponentsEffectiveAt(publicado.document, IDS.projectA, new Date(VIGENCIA_2));
    expect(depois.find((candidate) => candidate.component.id === regraA)!.version!.number).toBe(1);
  });
});

describe('listPendingComponentVersions', () => {
  it('lista só os componentes com rascunho em aberto, na ordem de leitura da árvore', () => {
    const { ctx, document, regraA, regraB } = policyTreeDoc();
    const draftA = apply(
      document,
      ctx,
      createComponentDraft({ componentId: regraA, payload: { kind: 'RULE', businessDescription: 'A' } }),
    );
    const draftB = apply(
      draftA.document,
      ctx,
      createComponentDraft({ componentId: regraB, payload: { kind: 'RULE', businessDescription: 'B' } }),
    );

    const pending = listPendingComponentVersions(draftB.document, IDS.projectA);
    expect(pending.map((entry) => entry.component.id)).toEqual([regraA, regraB]);
    expect(pending.every((entry) => entry.version.state === 'DRAFT')).toBe(true);
  });

  it('componente publicado, sem rascunho, não aparece', () => {
    const { ctx, document, regraA } = policyTreeDoc();
    const v1 = apply(
      document,
      ctx,
      createComponentDraft({ componentId: regraA, payload: { kind: 'RULE', businessDescription: 'v1' } }),
    );
    const publicado = apply(v1.document, ctx, publishComponentVersion({ versionId: v1.data.versionId, effectiveFrom: VIGENCIA_1 }));

    expect(listPendingComponentVersions(publicado.document, IDS.projectA)).toEqual([]);
  });
});

describe('listPendingComponents (§2.1/§17.1, S44)', () => {
  it('soma rascunho aberto e reviewStatus PENDING_REVIEW, sem duplicar quem tem os dois', () => {
    const { ctx, document, regraA, regraB } = policyTreeDoc();
    // regraA já nasce PENDING_REVIEW no fixture; dá um rascunho também a ela
    // e só um rascunho (sem PENDING_REVIEW) a regraB.
    const draftA = apply(
      document,
      ctx,
      createComponentDraft({ componentId: regraA, payload: { kind: 'RULE', businessDescription: 'A' } }),
    );
    const draftB = apply(
      draftA.document,
      ctx,
      createComponentDraft({ componentId: regraB, payload: { kind: 'RULE', businessDescription: 'B' } }),
    );

    const pending = listPendingComponents(draftB.document, IDS.projectA);
    expect(pending.map((c) => c.id)).toEqual([regraA, regraB]);
  });

  it('vazio quando ninguém tem rascunho aberto nem revisão pendente', () => {
    const { document, regraA } = policyTreeDoc();
    const semRegraA = apply(document, testCtx(), archiveComponent({ componentId: regraA })).document;
    expect(listPendingComponents(semRegraA, IDS.projectA)).toEqual([]);
  });
});

describe('flattenComponentTree e navegação por teclado (§17.1, S44)', () => {
  it('achata na ordem de leitura, respeitando expandedIds e profundidade', () => {
    const { document, cma, fraude, regraA, regraB, grupos } = policyTreeDoc();
    const collapsed = flattenComponentTree(document, IDS.projectA, new Set());
    expect(collapsed.map((n) => n.id)).toEqual([cma, grupos]);
    expect(collapsed.find((n) => n.id === cma)?.hasChildren).toBe(true);
    expect(collapsed.find((n) => n.id === grupos)?.hasChildren).toBe(false);

    const expanded = flattenComponentTree(document, IDS.projectA, new Set([cma, fraude]));
    expect(expanded.map((n) => n.id)).toEqual([cma, fraude, regraA, regraB, grupos]);
    expect(expanded.find((n) => n.id === regraA)?.depth).toBe(2);
  });

  it('nextVisibleNodeId/previousVisibleNodeId: primeiro e último nó visível não estouram a lista', () => {
    const { document, cma, grupos } = policyTreeDoc();
    const nodes = flattenComponentTree(document, IDS.projectA, new Set());
    expect(nodes.map((n) => n.id)).toEqual([cma, grupos]);

    // No último nó, "próximo" fica parado nele — não sai da lista.
    expect(nextVisibleNodeId(nodes, grupos)).toBe(grupos);
    // No primeiro nó, "anterior" fica parado nele.
    expect(previousVisibleNodeId(nodes, cma)).toBe(cma);
    // Sem nó em foco ainda, os dois começam no primeiro visível.
    expect(nextVisibleNodeId(nodes, null)).toBe(cma);
    expect(previousVisibleNodeId(nodes, null)).toBe(cma);
    // Lista vazia não quebra.
    expect(nextVisibleNodeId([], null)).toBeNull();
  });

  it('findTypeaheadMatch acha o próximo nó cujo nome começa com o texto digitado, dando a volta', () => {
    const { document, cma, fraude, regraA, regraB, grupos } = policyTreeDoc();
    const nodes = flattenComponentTree(document, IDS.projectA, new Set([cma, fraude]));

    // A partir de CMA, "Regra" acha "Regra A" primeiro.
    expect(findTypeaheadMatch(nodes, cma, 'regra')).toBe(regraA);
    // A partir de Regra A, "Regra" dá a volta e continua achando Regra A de novo (só ela casa "regra a").
    expect(findTypeaheadMatch(nodes, regraA, 'regra a')).toBe(regraA);
    // A partir de Regra B, buscar "Grupos" dá a volta até o fim da lista.
    expect(findTypeaheadMatch(nodes, regraB, 'grupos')).toBe(grupos);
  });

  it('findTypeaheadMatch sem correspondência devolve null e não move o foco', () => {
    const { document, cma } = policyTreeDoc();
    const nodes = flattenComponentTree(document, IDS.projectA, new Set());
    expect(findTypeaheadMatch(nodes, cma, 'zzz')).toBeNull();
    expect(findTypeaheadMatch([], cma, 'a')).toBeNull();
    expect(findTypeaheadMatch(nodes, cma, '')).toBeNull();
  });
});

describe('nextPendingComponentId — Ctrl+Shift+N (§2.1, S44)', () => {
  it('sem nenhum pendente devolve null — não há para onde ir', () => {
    expect(nextPendingComponentId(['a', 'b', 'c'], new Set(), 'a')).toBeNull();
  });

  it('do último pendente, dá a volta para o primeiro sem entrar em loop', () => {
    const order = ['a', 'b', 'c', 'd'];
    const pending = new Set(['b', 'd']);
    expect(nextPendingComponentId(order, pending, 'd')).toBe('b');
    expect(nextPendingComponentId(order, pending, 'b')).toBe('d');
  });

  it('sem nó atual (ou fora da ordem), começa no primeiro pendente', () => {
    const order = ['a', 'b', 'c'];
    const pending = new Set(['c']);
    expect(nextPendingComponentId(order, pending, null)).toBe('c');
    expect(nextPendingComponentId(order, pending, 'nao-existe')).toBe('c');
  });
});

describe('getChangeRequestTimeline (docs/14 §4 US-GOV-08, S37)', () => {
  it('só DBs PUBLISHED entram, mais recente primeiro, com release e componentes afetados', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const comRelease = apply(cenario.document, ctx, createRelease({ code: '2026.09.01' }));
    const releaseId = comRelease.data.releaseId;

    const db515 = dbPublicavel(comRelease.document, ctx, cenario.goodlistId);
    const publicado515 = apply(
      db515.document,
      ctx,
      publishChangeRequest({ changeRequestId: db515.changeRequestId }),
    ).document;

    // DB-519, mais tarde, mas com vigência anterior — a ordem é por vigência, não por criação.
    const criado519 = criarDb(publicado515, ctx, {
      code: 'DB_519',
      proposedEffectiveDate: '2026-02-01T00:00:00.000Z',
    });
    let doc519 = apply(
      criado519.document,
      ctx,
      addChangeRequestItem({
        changeRequestId: criado519.changeRequestId,
        componentId: cenario.novaRegraId,
        changeType: 'CREATE',
        proposedSummary: 'Regra nova.',
      }),
    ).document;
    doc519 = apply(
      doc519,
      ctx,
      linkChangeRequestDraft({
        changeRequestId: criado519.changeRequestId,
        componentId: cenario.novaRegraId,
        payload: { kind: 'RULE', businessDescription: 'Regra nova.' },
      }),
    ).document;
    doc519 = avancarAte(doc519, ctx, criado519.changeRequestId, 'READY_FOR_RELEASE');
    const publicado519 = apply(
      doc519,
      ctx,
      publishChangeRequest({ changeRequestId: criado519.changeRequestId }),
    ).document;

    // Vincula o DB-515 (já publicado) à release, só para provar que a
    // timeline lê `releaseId` mesmo depois de publicado — o DB-519 fica solto.
    const comReleaseNoDb = structuredClone(publicado519);
    comReleaseNoDb.changeRequests[0]!.releaseId = releaseId;

    const timeline = getChangeRequestTimeline(comReleaseNoDb);
    expect(timeline.map((entry) => entry.changeRequest.code)).toEqual(['DB_515', 'DB_519']);
    expect(timeline[0]).toMatchObject({ effectiveFrom: VIGENCIA_PROPOSTA });
    expect(timeline[0]!.release?.id).toBe(releaseId);
    expect(timeline[0]!.affectedComponents.map((c) => c.id)).toEqual([cenario.goodlistId]);
    expect(timeline[0]!.publishedAt).not.toBeNull();
    expect(timeline[1]!.release).toBeNull();
    expect(timeline[1]!.affectedComponents.map((c) => c.id)).toEqual([cenario.novaRegraId]);

    // DB ainda não publicado não aparece.
    const dbAberto = dbSubmetivel(comReleaseNoDb, ctx, cenario.espelhoId, { code: 'DB_600' });
    expect(getChangeRequestTimeline(dbAberto.document).map((e) => e.changeRequest.code)).toEqual([
      'DB_515',
      'DB_519',
    ]);
  });

  it('filtra por projeto e por período', () => {
    const ctx = testCtx();
    const cenario = politica(ctx);
    const db = dbPublicavel(cenario.document, ctx, cenario.goodlistId);
    const publicado = apply(db.document, ctx, publishChangeRequest({ changeRequestId: db.changeRequestId })).document;

    expect(getChangeRequestTimeline(publicado, { projectId: IDS.projectA })).toHaveLength(1);
    expect(getChangeRequestTimeline(publicado, { projectId: 'outroproj12' })).toHaveLength(0);
    expect(getChangeRequestTimeline(publicado, { from: '2026-09-02T00:00:00.000Z' })).toHaveLength(0);
    expect(getChangeRequestTimeline(publicado, { to: '2026-08-31T00:00:00.000Z' })).toHaveLength(0);
    expect(getChangeRequestTimeline(publicado, { from: VIGENCIA_PROPOSTA, to: VIGENCIA_PROPOSTA })).toHaveLength(1);
  });
});
