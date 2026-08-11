import { nanoid } from 'nanoid';
import { collectPublishedCompatibility, generateTuples } from '../axes/tuples';
import type {
  Axis,
  AxisLevel,
  CatalogItem,
  Cell,
  CompatibilityRule,
  Domain,
  DocEvent,
  Matrix,
  MatrixVersion,
  PolicyOpsDocument,
  Project,
  Template,
  Variable,
  VariableVersion,
} from './schema';
import { CURRENT_SCHEMA_VERSION } from './schema';

/**
 * `createEmptyDocument` e `createSampleDocument` — docs/03-modelo-do-documento.md §11.
 * `createSampleDocument` é gerado por código (nunca um JSON fixo) para nunca
 * ficar desatualizado em relação ao schema, e precisa passar por
 * `validateDocument` sem nenhum ERROR.
 */

// Sincronizar manualmente com a versão em package.json — src/core/ não pode
// importar package.json (isolatedModules/resolução de bundler) nem window.
export const APP_VERSION = '0.1.0';

const genId = (): string => nanoid(12);
const nowISO = (): string => new Date().toISOString();
const daysAgoISO = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

export function createEmptyDocument(name: string, actor: string): PolicyOpsDocument {
  const now = nowISO();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: {
      id: genId(),
      name,
      revision: 0,
      savedAt: null,
      savedBy: null,
      appVersion: APP_VERSION,
      createdAt: now,
    },
    variables: [],
    compatibility: [],
    catalog: [],
    projects: [],
    matrices: [],
    templates: [],
    importProfiles: [],
    events: [
      {
        id: genId(),
        at: now,
        actor,
        type: 'DOCUMENT_CREATED',
        scope: {},
        summary: `${actor} criou o documento "${name}".`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// createSampleDocument — docs/03-modelo-do-documento.md §11
// ---------------------------------------------------------------------------

const SAMPLE_ACTOR = 'Equipe de Políticas';

function domain(code: string, label: string, position: number, extra: Partial<Domain> = {}): Domain {
  return { code, label, position, ...extra };
}

function publishedVersion(
  id: string,
  domains: Domain[],
  createdAt: string,
  boundaryMode?: VariableVersion['boundaryMode'],
): VariableVersion {
  return {
    id,
    number: 1,
    state: 'PUBLISHED',
    createdAt,
    createdBy: SAMPLE_ACTOR,
    publishedAt: createdAt,
    publishedBy: SAMPLE_ACTOR,
    domains,
    ...(boundaryMode === undefined ? {} : { boundaryMode }),
  };
}

export function createSampleDocument(): PolicyOpsDocument {
  const t0 = daysAgoISO(90); // criação inicial da biblioteca e da matriz PF
  const tNow = nowISO(); // matriz PJ e rascunho v2 da PF, criados "hoje"

  // --- Variáveis -----------------------------------------------------------

  const scoreId = genId();
  const scoreV1Id = genId();
  const scoreDomains: Domain[] = [
    domain('R1', 'R1 — Risco muito baixo', 0),
    domain('R2', 'R2 — Risco baixo', 1),
    domain('R3', 'R3 — Risco moderado-baixo', 2),
    domain('R4', 'R4 — Risco moderado-alto', 3),
    domain('R5', 'R5 — Risco alto', 4),
    domain('R6', 'R6 — Risco muito alto', 5),
  ];
  const scoreVariable: Variable = {
    id: scoreId,
    code: 'SCORE_HVI3',
    name: 'Score HVI3',
    type: 'ORDINAL',
    createdAt: t0,
    versions: [publishedVersion(scoreV1Id, scoreDomains, t0)],
  };

  const restritivoId = genId();
  const restritivoV1Id = genId();
  const restritivoDomains: Domain[] = [
    domain('SEM', 'Sem restritivo', 0),
    domain('BAIXO', 'Restritivo baixo', 1),
    domain('MEDIO', 'Restritivo médio', 2),
    domain('ALTO', 'Restritivo alto', 3),
  ];
  const restritivoVariable: Variable = {
    id: restritivoId,
    code: 'RESTRITIVO',
    name: 'Restritivo Externo',
    type: 'CATEGORICAL',
    createdAt: t0,
    versions: [publishedVersion(restritivoV1Id, restritivoDomains, t0)],
  };

  const segmentoId = genId();
  const segmentoV1Id = genId();
  const segmentoDomains: Domain[] = [
    domain('VAREJO', 'Varejo', 0),
    domain('ATACADO', 'Atacado', 1),
    domain('CORPORATE', 'Corporate', 2),
  ];
  const segmentoVariable: Variable = {
    id: segmentoId,
    code: 'SEGMENTO',
    name: 'Segmento',
    type: 'CATEGORICAL',
    createdAt: t0,
    versions: [publishedVersion(segmentoV1Id, segmentoDomains, t0)],
  };

  const fatId = genId();
  const fatV1Id = genId();
  const fatDomains: Domain[] = [
    domain('ATE_100K', 'Até R$ 100 mil', 0, { rangeMin: '0', rangeMax: '100000', minInclusive: true, maxInclusive: false }),
    domain('100K_500K', 'R$ 100 mil a R$ 500 mil', 1, { rangeMin: '100000', rangeMax: '500000', minInclusive: true, maxInclusive: false }),
    domain('500K_1M', 'R$ 500 mil a R$ 1 milhão', 2, { rangeMin: '500000', rangeMax: '1000000', minInclusive: true, maxInclusive: false }),
    domain('1M_10M', 'R$ 1 milhão a R$ 10 milhões', 3, { rangeMin: '1000000', rangeMax: '10000000', minInclusive: true, maxInclusive: false }),
    domain('ACIMA_10M', 'Acima de R$ 10 milhões', 4, { rangeMin: '10000000', minInclusive: true, isCatchAll: true }),
  ];
  const fatVariable: Variable = {
    id: fatId,
    code: 'FAT',
    name: 'Faixa de Faturamento',
    type: 'RANGE',
    createdAt: t0,
    versions: [publishedVersion(fatV1Id, fatDomains, t0, 'HALF_OPEN')],
  };

  const faixaRendaId = genId();
  const faixaRendaV1Id = genId();
  const faixaRendaDomains: Domain[] = [
    domain('ATE_2K', 'Até R$ 2 mil', 0, { rangeMin: '0', rangeMax: '2000', minInclusive: true, maxInclusive: false }),
    domain('2K_4K', 'R$ 2 mil a R$ 4 mil', 1, { rangeMin: '2000', rangeMax: '4000', minInclusive: true, maxInclusive: false }),
    domain('4K_6K', 'R$ 4 mil a R$ 6 mil', 2, { rangeMin: '4000', rangeMax: '6000', minInclusive: true, maxInclusive: false }),
    domain('ACIMA_6K', 'Acima de R$ 6 mil', 3, { rangeMin: '6000', minInclusive: true, isCatchAll: true }),
  ];
  const faixaRendaVariable: Variable = {
    id: faixaRendaId,
    code: 'FAIXA_RENDA',
    name: 'Faixa de Renda',
    type: 'RANGE',
    createdAt: t0,
    versions: [publishedVersion(faixaRendaV1Id, faixaRendaDomains, t0, 'HALF_OPEN')],
  };

  const tempoEmpresaId = genId();
  const tempoEmpresaV1Id = genId();
  const tempoEmpresaDomains: Domain[] = [
    domain('ATE_6M', 'Até 6 meses', 0, { rangeMin: '0', rangeMax: '6', minInclusive: true, maxInclusive: false }),
    domain('6M_12M', '6 a 12 meses', 1, { rangeMin: '6', rangeMax: '12', minInclusive: true, maxInclusive: false }),
    domain('1A_3A', '1 a 3 anos', 2, { rangeMin: '12', rangeMax: '36', minInclusive: true, maxInclusive: false }),
    domain('ACIMA_3A', 'Acima de 3 anos', 3, { rangeMin: '36', minInclusive: true, isCatchAll: true }),
  ];
  const tempoEmpresaVariable: Variable = {
    id: tempoEmpresaId,
    code: 'TEMPO_EMPRESA',
    name: 'Tempo de Empresa',
    type: 'RANGE',
    createdAt: t0,
    versions: [publishedVersion(tempoEmpresaV1Id, tempoEmpresaDomains, t0, 'HALF_OPEN')],
  };

  const variables: Variable[] = [
    scoreVariable,
    restritivoVariable,
    segmentoVariable,
    fatVariable,
    faixaRendaVariable,
    tempoEmpresaVariable,
  ];

  // --- Compatibilidade -------------------------------------------------------

  const compatRuleId = genId();
  const compatV1Id = genId();
  const compatibilityRule: CompatibilityRule = {
    id: compatRuleId,
    code: 'SEG_X_FATURAMENTO',
    name: 'Segmento × Faixa de Faturamento',
    parentVariableId: segmentoId,
    childVariableId: fatId,
    createdAt: t0,
    versions: [
      {
        id: compatV1Id,
        number: 1,
        state: 'PUBLISHED',
        createdAt: t0,
        createdBy: SAMPLE_ACTOR,
        publishedAt: t0,
        publishedBy: SAMPLE_ACTOR,
        parentVariableVersionId: segmentoV1Id,
        childVariableVersionId: fatV1Id,
        allow: {
          VAREJO: ['ATE_100K', '100K_500K', '500K_1M'],
          ATACADO: ['500K_1M', '1M_10M', 'ACIMA_10M'],
          CORPORATE: ['1M_10M', 'ACIMA_10M'],
        },
        defaultForUnlisted: 'NONE',
      },
    ],
  };

  // --- Catálogo --------------------------------------------------------------

  const catalogPositions: Record<CatalogItem['kind'], number> = {
    DECISION: 0,
    OFFER: 0,
    LIMIT: 0,
    TAG: 0,
  };

  const catalogItem = (
    kind: CatalogItem['kind'],
    code: string,
    label: string,
    extra: Partial<CatalogItem> = {},
  ): CatalogItem => ({
    id: genId(),
    kind,
    code,
    label,
    position: catalogPositions[kind]++,
    createdAt: t0,
    ...extra,
  });

  const decisionAprovado = catalogItem('DECISION', 'APROVADO', 'Aprovado', { color: '#16A34A' });
  const decisionReprovado = catalogItem('DECISION', 'REPROVADO', 'Reprovado', { color: '#DC2626' });
  const decisionAnaliseManual = catalogItem('DECISION', 'ANALISE_MANUAL', 'Análise manual', {
    color: '#F59E0B',
  });
  const decisionExcecao = catalogItem('DECISION', 'EXCECAO', 'Exceção', { color: '#7C3AED' });

  const offers = [
    catalogItem('OFFER', 'OFERTA_BASICA', 'Oferta Básica'),
    catalogItem('OFFER', 'OFERTA_INTERMEDIARIA', 'Oferta Intermediária'),
    catalogItem('OFFER', 'OFERTA_PREMIUM', 'Oferta Premium'),
    catalogItem('OFFER', 'OFERTA_GOLD', 'Oferta Gold'),
    catalogItem('OFFER', 'OFERTA_PLATINUM', 'Oferta Platinum'),
    catalogItem('OFFER', 'OFERTA_BLACK', 'Oferta Black'),
  ];

  const limits = [
    catalogItem('LIMIT', 'LIM_500', 'Limite R$ 500', { numericValue: '500' }),
    catalogItem('LIMIT', 'LIM_1000', 'Limite R$ 1.000', { numericValue: '1000' }),
    catalogItem('LIMIT', 'LIM_2000', 'Limite R$ 2.000', { numericValue: '2000' }),
    catalogItem('LIMIT', 'LIM_5000', 'Limite R$ 5.000', { numericValue: '5000' }),
  ];

  const catalog: CatalogItem[] = [
    decisionAprovado,
    decisionReprovado,
    decisionAnaliseManual,
    decisionExcecao,
    ...offers,
    ...limits,
  ];

  // --- Projetos ----------------------------------------------------------

  const projectPF: Project = {
    id: genId(),
    code: 'POLITICA_PF',
    name: 'Política PF',
    position: 0,
    createdAt: t0,
  };
  const projectPJ: Project = {
    id: genId(),
    code: 'POLITICA_PJ',
    name: 'Política PJ',
    position: 1,
    createdAt: t0,
  };

  // --- Matriz 1: MTZ_LIMITE_PF (eixos de 1 nível) -----------------------

  // Decisão determinística: quanto pior o score e mais restritivo, mais
  // conservadora a decisão. É dado de exemplo, não regra de negócio real.
  function decisionForPF(scoreIndex: number, restritivoIndex: number): CatalogItem {
    const severity = scoreIndex + restritivoIndex * 1.5;
    if (restritivoIndex === 3 && scoreIndex >= 3) return decisionReprovado;
    if (severity <= 2) return decisionAprovado;
    if (severity <= 5) return decisionAnaliseManual;
    return decisionReprovado;
  }

  function limitForScore(scoreIndex: number): CatalogItem {
    const byIndex = [limits[3], limits[3], limits[2], limits[2], limits[1], limits[0]];
    return byIndex[scoreIndex]!;
  }

  // Todas as tuplas — inclusive as dos eixos de 1 nível — saem do motor de
  // eixos (src/core/axes/tuples.ts). O caso simples é o caso geral com
  // `levels.length === 1` (docs/03 §6.1).
  const publishedCompatibility = collectPublishedCompatibility([compatibilityRule]);

  function buildAxis(role: Axis['role'], levels: AxisLevel[]): Axis {
    const { tuples, usedRuleIds } = generateTuples({
      levels,
      compatibility: publishedCompatibility,
    });
    return { role, levels, tuples, derivedFrom: { compatibilityVersionIds: usedRuleIds } };
  }

  const pfXAxis = buildAxis('X', [
    {
      id: genId(),
      variableId: scoreId,
      variableVersionId: scoreV1Id,
      label: scoreVariable.name,
      domains: scoreDomains,
    },
  ]);

  const pfYAxis = buildAxis('Y', [
    {
      id: genId(),
      variableId: restritivoId,
      variableVersionId: restritivoV1Id,
      label: restritivoVariable.name,
      domains: restritivoDomains,
    },
  ]);

  function buildPFCells(): Record<string, Cell> {
    const cells: Record<string, Cell> = {};
    scoreDomains.forEach((scoreDomain, si) => {
      restritivoDomains.forEach((restritivoDomain, ri) => {
        const decision = decisionForPF(si, ri);
        const cell: Cell = { decision: decision.code };
        if (decision.code === decisionAprovado.code) {
          cell.limit = limitForScore(si).code;
        }
        cells[`${scoreDomain.code}::${restritivoDomain.code}`] = cell;
      });
    });
    return cells;
  }

  const pfV1Id = genId();
  const pfV1: MatrixVersion = {
    id: pfV1Id,
    number: 1,
    state: 'PUBLISHED',
    notes: 'Publicação inicial da política de limite PF.',
    createdAt: t0,
    createdBy: SAMPLE_ACTOR,
    publishedAt: t0,
    publishedBy: SAMPLE_ACTOR,
    effectiveFrom: t0,
    axes: { x: pfXAxis, y: pfYAxis },
    cells: buildPFCells(),
  };

  // v2 DRAFT derivada de v1, com exatamente 3 células alteradas — para
  // exercitar o diff desde o primeiro uso (docs/03 §11). As três coordenadas
  // partem de decisão APROVADO (com limit) em v1 e recebem uma decisão
  // diferente em v2, sem limit — mudança real e verificável célula a célula.
  const pfV2Cells: Record<string, Cell> = { ...pfV1.cells };
  const pfChanges: Record<string, string> = {
    'R1::SEM': decisionAnaliseManual.code,
    'R1::BAIXO': decisionReprovado.code,
    'R2::SEM': decisionAnaliseManual.code,
  };
  for (const [key, newDecisionCode] of Object.entries(pfChanges)) {
    pfV2Cells[key] = { decision: newDecisionCode };
  }

  const pfV2Id = genId();
  const pfV2: MatrixVersion = {
    id: pfV2Id,
    number: 2,
    state: 'DRAFT',
    baseVersionId: pfV1Id,
    createdAt: tNow,
    createdBy: SAMPLE_ACTOR,
    axes: {
      x: { ...pfXAxis, levels: pfXAxis.levels.map((l) => ({ ...l, id: genId() })) },
      y: { ...pfYAxis, levels: pfYAxis.levels.map((l) => ({ ...l, id: genId() })) },
    },
    cells: pfV2Cells,
  };

  const matrixPF: Matrix = {
    id: genId(),
    projectId: projectPF.id,
    code: 'MTZ_LIMITE_PF',
    name: 'Limite de Crédito — Pessoa Física',
    createdAt: t0,
    versions: [pfV1, pfV2],
  };

  // --- Matriz 2: MTZ_LIMITE_PJ (eixo Y com 2 níveis) ----------------------

  const pjXAxis = buildAxis('X', [
    {
      id: genId(),
      variableId: scoreId,
      variableVersionId: scoreV1Id,
      label: scoreVariable.name,
      domains: scoreDomains,
    },
  ]);

  const segmentoLevel: AxisLevel = {
    id: genId(),
    variableId: segmentoId,
    variableVersionId: segmentoV1Id,
    label: segmentoVariable.name,
    domains: segmentoDomains,
  };
  const fatLevel: AxisLevel = {
    id: genId(),
    variableId: fatId,
    variableVersionId: fatV1Id,
    label: fatVariable.name,
    domains: fatDomains,
  };

  // Eixo Y aninhado: SEGMENTO › FAT com SEG_X_FATURAMENTO aplicada. São 8
  // tuplas (não 15) — o caso que valida o aninhamento ponta a ponta.
  const pjYAxis = buildAxis('Y', [segmentoLevel, fatLevel]);
  const pjYTuples = pjYAxis.tuples;

  function decisionForPJ(scoreIndex: number, yPath: string): CatalogItem {
    const [segmentoCode] = yPath.split('|');
    const segmentoWeight = segmentoCode === 'CORPORATE' ? 0 : segmentoCode === 'ATACADO' ? 1 : 2;
    const severity = scoreIndex + segmentoWeight;
    if (severity <= 2) return decisionAprovado;
    if (severity <= 5) return decisionAnaliseManual;
    return decisionReprovado;
  }

  function buildPJCells(): Record<string, Cell> {
    const cells: Record<string, Cell> = {};
    scoreDomains.forEach((scoreDomain, si) => {
      pjYTuples.forEach((yPath) => {
        const decision = decisionForPJ(si, yPath);
        const cell: Cell = { decision: decision.code };
        if (decision.code === decisionAprovado.code) {
          cell.limit = limitForScore(si).code;
        }
        cells[`${scoreDomain.code}::${yPath}`] = cell;
      });
    });
    return cells;
  }

  const pjV1: MatrixVersion = {
    id: genId(),
    number: 1,
    state: 'PUBLISHED',
    notes: 'Publicação inicial da política de limite PJ, com faturamento segmentado.',
    createdAt: tNow,
    createdBy: SAMPLE_ACTOR,
    publishedAt: tNow,
    publishedBy: SAMPLE_ACTOR,
    effectiveFrom: tNow,
    axes: { x: pjXAxis, y: pjYAxis },
    cells: buildPJCells(),
  };

  const matrixPJ: Matrix = {
    id: genId(),
    projectId: projectPJ.id,
    code: 'MTZ_LIMITE_PJ',
    name: 'Limite de Crédito — Pessoa Jurídica',
    createdAt: tNow,
    versions: [pjV1],
  };

  // --- Templates -----------------------------------------------------------

  const templates: Template[] = [
    {
      id: genId(),
      code: 'TPL_PF_PADRAO',
      name: 'Matriz padrão PF',
      description: 'Score HVI3 × Restritivo Externo, sem compatibilidade entre eixos.',
      axes: {
        x: { levels: [{ variableId: scoreId }] },
        y: { levels: [{ variableId: restritivoId }] },
      },
      defaults: { decision: decisionAnaliseManual.code },
      // Demonstra "a última vencendo": R1×ALTO cai nas duas primeiras regras
      // (aprovado por R1, reprovado por ALTO) e a terceira, mais específica e
      // por último, decide o caso — análise manual.
      seedRules: [
        { when: { x: ['R1'] }, set: { decision: decisionAprovado.code, offer: offers[0]!.code } },
        { when: { y: ['ALTO'] }, set: { decision: decisionReprovado.code } },
        { when: { x: ['R1'], y: ['ALTO'] }, set: { decision: decisionAnaliseManual.code } },
      ],
      createdAt: t0,
    },
    {
      id: genId(),
      code: 'TPL_PJ_SEGMENTADO',
      name: 'Limite PJ segmentado',
      description: 'Score HVI3 × Segmento aninhado com Faixa de Faturamento, com regras por segmento.',
      axes: {
        x: { levels: [{ variableId: scoreId }] },
        y: { levels: [{ variableId: segmentoId }, { variableId: fatId }] },
      },
      defaults: { decision: decisionAnaliseManual.code },
      // Regras por segmento — Corporate e Atacado entram aprovados, Varejo
      // fica em análise (redundante com o default, mas explícito). A última
      // regra, por score, vence por cima de qualquer segmento: R6 é sempre
      // reprovado, mesmo em Corporate.
      seedRules: [
        { when: { y: ['CORPORATE', null] }, set: { decision: decisionAprovado.code, offer: offers[4]!.code } },
        { when: { y: ['ATACADO', null] }, set: { decision: decisionAprovado.code, offer: offers[2]!.code } },
        { when: { y: ['VAREJO', null] }, set: { decision: decisionAnaliseManual.code } },
        { when: { x: ['R6'] }, set: { decision: decisionReprovado.code } },
      ],
      createdAt: t0,
    },
  ];

  // --- Eventos ---------------------------------------------------------------

  const events: DocEvent[] = [
    {
      id: genId(),
      at: t0,
      actor: SAMPLE_ACTOR,
      type: 'DOCUMENT_CREATED',
      scope: {},
      summary: `${SAMPLE_ACTOR} criou o documento de exemplo.`,
    },
    {
      id: genId(),
      at: t0,
      actor: SAMPLE_ACTOR,
      type: 'MATRIX_CREATED',
      scope: { projectId: projectPF.id, matrixId: matrixPF.id },
      summary: `${SAMPLE_ACTOR} criou a matriz "${matrixPF.code}".`,
      payload: { code: matrixPF.code, combinations: pfXAxis.tuples.length * pfYAxis.tuples.length },
    },
    {
      id: genId(),
      at: t0,
      actor: SAMPLE_ACTOR,
      type: 'VERSION_PUBLISHED',
      scope: { projectId: projectPF.id, matrixId: matrixPF.id, versionId: pfV1Id },
      summary: `${SAMPLE_ACTOR} publicou a versão 1 de "${matrixPF.code}".`,
      payload: { effectiveFrom: t0 },
    },
    {
      id: genId(),
      at: tNow,
      actor: SAMPLE_ACTOR,
      type: 'DRAFT_CREATED',
      scope: { projectId: projectPF.id, matrixId: matrixPF.id, versionId: pfV2Id },
      summary: `${SAMPLE_ACTOR} criou um rascunho a partir da versão 1 de "${matrixPF.code}".`,
      payload: { baseVersionNumber: 1 },
    },
    {
      id: genId(),
      at: tNow,
      actor: SAMPLE_ACTOR,
      type: 'MATRIX_CREATED',
      scope: { projectId: projectPJ.id, matrixId: matrixPJ.id },
      summary: `${SAMPLE_ACTOR} criou a matriz "${matrixPJ.code}".`,
      payload: { code: matrixPJ.code, combinations: pjXAxis.tuples.length * pjYAxis.tuples.length },
    },
    {
      id: genId(),
      at: tNow,
      actor: SAMPLE_ACTOR,
      type: 'VERSION_PUBLISHED',
      scope: { projectId: projectPJ.id, matrixId: matrixPJ.id, versionId: pjV1.id },
      summary: `${SAMPLE_ACTOR} publicou a versão 1 de "${matrixPJ.code}".`,
      payload: { effectiveFrom: tNow },
    },
  ];

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: {
      id: genId(),
      name: 'Documento de exemplo — Políticas de Crédito',
      description: 'Gerado por createSampleDocument() para exploração sem arquivo.',
      revision: 0,
      savedAt: null,
      savedBy: null,
      appVersion: APP_VERSION,
      createdAt: t0,
    },
    variables,
    compatibility: [compatibilityRule],
    catalog,
    projects: [projectPF, projectPJ],
    matrices: [matrixPF, matrixPJ],
    templates,
    importProfiles: [],
    events,
  };
}
