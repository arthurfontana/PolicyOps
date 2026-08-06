import { beforeEach, describe, expect, it } from 'vitest';
import type { PolicyOpsDocument } from '@/core/document/schema';
import {
  countPending,
  getAxisStaleness,
  getEditorView,
  getEditorViewComputations,
  getEffectiveVersion,
  getPortfolioAt,
  getStaleAxes,
  getVariableUsage,
  getVersionEvents,
  listMatrixVersions,
  listVariables,
  resetEditorViewComputations,
} from '@/core/queries';
import { applyCellPatch } from '@/core/versioning/cells';
import { createDraft, createMatrix, locateVersion, publishVersion } from '@/core/versioning/lifecycle';
import {
  apply,
  baseDocument,
  coordsOf,
  createTestMatrix,
  documentWithAllStates,
  fillAllCells,
  IDS,
  SEG_X_FAT_TUPLES,
  T0,
  testCtx,
} from './versioning/fixtures';

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
