import { describe, expect, it } from 'vitest';
import type { PolicyOpsDocument } from '@/core/document/schema';
import {
  getAxisStaleness,
  getDraftsAdoptingRule,
  getDraftsAdoptingVariable,
  getStaleAxes,
  reasonsForLevel,
  reasonsForRules,
} from '@/core/reconcile/stale';
import { createMatrix, locateVersion } from '@/core/versioning/lifecycle';
import {
  apply,
  baseDocument,
  IDS,
  T0,
  testCtx,
} from '../versioning/fixtures';
import {
  domainsOf,
  nestedScenario,
  publishCompatibilityWith,
  publishVariableWith,
  SEG_X_FAT_ALLOW,
  simpleScenario,
} from './fixtures';

/**
 * Detecção de defasagem — docs/05-regras-de-negocio.md §5.2.
 */

describe('getAxisStaleness — os três motivos de §5.2', () => {
  it('não acusa nada num eixo recém-criado', () => {
    const ctx = testCtx();
    const { document, draft } = nestedScenario(ctx);
    const { version } = locateVersion(document, draft);
    expect(getAxisStaleness(document, version.axes.x)).toEqual({
      role: 'X',
      stale: false,
      reasons: [],
    });
    expect(getAxisStaleness(document, version.axes.y).stale).toBe(false);
    expect(getStaleAxes(document)).toEqual([]);
  });

  it('1) pino de variável que deixou de ser a versão publicada, com o texto do badge', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const evoluido = publishVariableWith(document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));

    const { version } = locateVersion(evoluido, draft);
    const staleness = getAxisStaleness(evoluido, version.axes.x);
    expect(staleness.stale).toBe(true);
    expect(staleness.reasons).toHaveLength(1);

    const [reason] = staleness.reasons;
    expect(reason).toMatchObject({
      kind: 'LEVEL_PIN_OUTDATED',
      levelIndex: 0,
      variableId: IDS.score,
      variableCode: 'SCORE',
      pinnedNumber: 1,
      availableNumber: 2,
    });
    // §5.2 pede o texto explícito: "<nível> — v1 pinada, v2 disponível".
    expect(reason!.message).toBe('Score — v1 pinada, v2 disponível.');
    expect(reasonsForLevel(staleness, 0)).toHaveLength(1);
    expect(reasonsForLevel(staleness, 1)).toHaveLength(0);
  });

  it('1) variável que sumiu inteira da biblioteca também é defasagem', () => {
    const ctx = testCtx();
    const { document, draft } = simpleScenario(ctx);
    const semVariavel: PolicyOpsDocument = structuredClone(document);
    semVariavel.variables = semVariavel.variables.filter((variable) => variable.id !== IDS.score);

    const { version } = locateVersion(semVariavel, draft);
    const staleness = getAxisStaleness(semVariavel, version.axes.x);
    expect(staleness.stale).toBe(true);
    expect(staleness.reasons[0]).toMatchObject({
      kind: 'LEVEL_PIN_OUTDATED',
      pinnedNumber: null,
      availableNumber: null,
    });
  });

  it('2) regra usada nas tuplas que deixou de estar publicada, com o texto do badge', () => {
    const ctx = testCtx();
    const { document, draft } = nestedScenario(ctx);
    const evoluido = publishCompatibilityWith(document, ctx, IDS.compatRule, {
      ...SEG_X_FAT_ALLOW,
      VAREJO: ['ATE_100K', '100K_500K', '500K_1M', '1M_10M'],
    });

    const { version } = locateVersion(evoluido, draft);
    const staleness = getAxisStaleness(evoluido, version.axes.y);
    expect(staleness.stale).toBe(true);
    expect(staleness.reasons[0]).toMatchObject({
      kind: 'RULE_OUTDATED',
      ruleId: IDS.compatRule,
      ruleCode: 'SEG_X_FATURAMENTO',
      pinnedNumber: 1,
      availableNumber: 2,
    });
    expect(staleness.reasons[0]!.message).toBe(
      'Regra Segmento × Faturamento — v1 pinada, v2 disponível.',
    );
    expect(reasonsForRules(staleness)).toHaveLength(1);
  });

  it('2) regra que sumiu da biblioteca', () => {
    const ctx = testCtx();
    const { document, draft } = nestedScenario(ctx);
    const semRegra: PolicyOpsDocument = structuredClone(document);
    semRegra.compatibility = [];

    const { version } = locateVersion(semRegra, draft);
    const staleness = getAxisStaleness(semRegra, version.axes.y);
    expect(staleness.reasons.map((reason) => reason.kind)).toEqual(['RULE_OUTDATED']);
    expect(staleness.reasons[0]!.pinnedNumber).toBeNull();
  });
});

/**
 * O terceiro caso tem bloco próprio porque é o mais fácil de esquecer: nada
 * mudou no eixo nem nas versões que ele pina. O que mudou foi a biblioteca
 * ganhar uma regra entre duas variáveis que o eixo já empilhava — e, sem esta
 * detecção, o rascunho seguiria exibindo combinações que o negócio acabou de
 * declarar inexistentes.
 */
describe('§5.2, caso 3 — regra publicada que passou a existir para um par sem regra', () => {
  function semRegraEntreSegmentoERestritivo() {
    const ctx = testCtx();
    const created = apply(
      baseDocument(),
      ctx,
      createMatrix({
        projectId: IDS.projectA,
        code: 'MTZ_SEM_REGRA',
        name: 'Matriz sem regra no par',
        x: { levels: [{ variableId: IDS.score }] },
        y: { levels: [{ variableId: IDS.segmento }, { variableId: IDS.restritivo }] },
      }),
    );
    return { ctx, document: created.document, versionId: created.data.versionId };
  }

  /** Publica `SEGMENTO × RESTRITIVO`, um par que a matriz já empilhava sem regra. */
  function comRegraNova(document: PolicyOpsDocument, archived = false): PolicyOpsDocument {
    const next: PolicyOpsDocument = structuredClone(document);
    next.compatibility.push({
      id: 'segxrestr___',
      code: 'SEG_X_RESTRITIVO',
      name: 'Segmento × Restritivo',
      parentVariableId: IDS.segmento,
      childVariableId: IDS.restritivo,
      createdAt: T0,
      ...(archived ? { archivedAt: T0 } : {}),
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
    return next;
  }

  it('acusa NEW_RULE_AVAILABLE mesmo com todos os pinos em dia', () => {
    const { document, versionId } = semRegraEntreSegmentoERestritivo();

    // Antes: o par não tinha regra, e nada estava defasado.
    const antes = locateVersion(document, versionId).version;
    expect(getAxisStaleness(document, antes.axes.y).stale).toBe(false);
    expect(antes.axes.y.derivedFrom.compatibilityVersionIds).toEqual([]);
    expect(antes.axes.y.tuples).toHaveLength(6);

    const evoluido = comRegraNova(document);
    const { version } = locateVersion(evoluido, versionId);
    const staleness = getAxisStaleness(evoluido, version.axes.y);

    expect(staleness.stale).toBe(true);
    expect(staleness.reasons).toHaveLength(1);
    expect(staleness.reasons[0]).toMatchObject({
      kind: 'NEW_RULE_AVAILABLE',
      levelIndex: 1,
      ruleCode: 'SEG_X_RESTRITIVO',
      pinnedNumber: null,
      availableNumber: 1,
    });
    // Nenhum pino mudou: a defasagem não vem de versão nova de variável.
    expect(staleness.reasons.some((reason) => reason.kind === 'LEVEL_PIN_OUTDATED')).toBe(false);
  });

  it('regra arquivada não conta como novidade', () => {
    const { document, versionId } = semRegraEntreSegmentoERestritivo();
    const arquivada = comRegraNova(document, true);
    const { version } = locateVersion(arquivada, versionId);
    expect(getAxisStaleness(arquivada, version.axes.y).stale).toBe(false);
  });

  it('regra publicada num par que o eixo não empilha em ordem adjacente é ignorada', () => {
    const { document, versionId } = semRegraEntreSegmentoERestritivo();
    const invertida: PolicyOpsDocument = structuredClone(comRegraNova(document));
    const regra = invertida.compatibility.find((rule) => rule.code === 'SEG_X_RESTRITIVO')!;
    // Invertendo pai e filho, a regra deixa de valer para o par (SEGMENTO → RESTRITIVO).
    regra.parentVariableId = IDS.restritivo;
    regra.childVariableId = IDS.segmento;
    const { version } = locateVersion(invertida, versionId);
    expect(getAxisStaleness(invertida, version.axes.y).stale).toBe(false);
  });
});

describe('getStaleAxes e as listas de adoção', () => {
  it('lista apenas rascunhos — versão publicada é registro, não pendência', () => {
    const ctx = testCtx();
    const { document, draft, published, matrixId } = simpleScenario(ctx);
    const evoluido = publishVariableWith(document, ctx, IDS.score, domainsOf('R1', 'R2', 'R3', 'R4'));

    // A versão publicada está tão "defasada" quanto o rascunho…
    const publicada = locateVersion(evoluido, published).version;
    expect(getAxisStaleness(evoluido, publicada.axes.x).stale).toBe(true);

    // …mas não aparece na varredura: badge só em DRAFT (§5.2).
    const entries = getStaleAxes(evoluido);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      matrixId,
      matrixCode: 'MTZ_SIMPLES',
      versionId: draft,
      role: 'X',
    });
  });

  it('filtra por variável e por regra, para a tela de impacto da biblioteca', () => {
    const ctx = testCtx();
    const { document, draft } = nestedScenario(ctx);

    const comVariavelNova = publishVariableWith(
      document,
      ctx,
      IDS.fat,
      domainsOf('ATE_100K', '100K_500K', '500K_1M', '1M_10M', 'ACIMA_10M', 'ACIMA_50M'),
    );
    const adotamVariavel = getDraftsAdoptingVariable(comVariavelNova, IDS.fat);
    expect(adotamVariavel.map((entry) => entry.versionId)).toEqual([draft]);
    expect(adotamVariavel[0]!.role).toBe('Y');
    expect(getDraftsAdoptingVariable(comVariavelNova, IDS.restritivo)).toEqual([]);

    const comRegraNova = publishCompatibilityWith(document, ctx, IDS.compatRule, {
      ...SEG_X_FAT_ALLOW,
      VAREJO: ['ATE_100K', '100K_500K', '500K_1M', '1M_10M'],
    });
    const adotamRegra = getDraftsAdoptingRule(comRegraNova, IDS.compatRule);
    expect(adotamRegra.map((entry) => entry.versionId)).toEqual([draft]);
    expect(getDraftsAdoptingRule(comRegraNova, 'inexistente')).toEqual([]);
  });
});
