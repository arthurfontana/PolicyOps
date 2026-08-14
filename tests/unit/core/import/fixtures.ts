import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeCellKey } from '@/core/axes/paths';
import type {
  CatalogItem,
  CompatibilityRule,
  Domain,
  Matrix,
  MatrixVersion,
  PolicyOpsDocument,
  Variable,
} from '@/core/document/schema';
import { parseDelimitedTable, type ImportTable } from '@/core/import/parse-table';
import type { ImportProfile } from '@/core/import/profile';
import type { ImportPlan, MatrixPlan } from '@/core/import/plan';

/**
 * Fixtures do motor de carga — o caso real de docs/12-carga-de-matrizes.md §8.
 *
 * A biblioteca é montada por código (e não por um `.json` congelado) para não
 * envelhecer junto com o schema; o **arquivo** é um recorte real do
 * `CINEMINHA_20260708.csv`, guardado em `tests/fixtures/`, porque é justamente
 * a forma do dado externo que o motor precisa aguentar.
 */

export const T0 = '2026-01-01T00:00:00.000Z';

/** Id legível e válido: `nanoid(12)` aceita `[A-Za-z0-9_-]`. */
export function fixedId(label: string): string {
  if (label.length > 12) throw new Error(`Rótulo de id longo demais: "${label}".`);
  return label.padEnd(12, '_');
}

export const IDS = {
  project: fixedId('PRJB2C'),
  hvi3: fixedId('VHVI3'),
  hvi3V1: fixedId('VHVI3V1'),
  modelo: fixedId('VMODADC'),
  modeloV1: fixedId('VMODADCV1'),
  faixa: fixedId('VFAIXA'),
  faixaV1: fixedId('VFAIXAV1'),
  compat: fixedId('CMODXFAIXA'),
  compatV1: fixedId('CMODFXV1'),
  profile: fixedId('PRFCINE'),
};

function domainsOf(codes: readonly string[], label = (code: string) => code): Domain[] {
  return codes.map((code, position) => ({ code, label: label(code), position }));
}

/** `R01`…`R20`, `R99` — os 21 valores de score do arquivo real. */
export const SCORE_CODES = [
  ...Array.from({ length: 20 }, (_unused, index) => `R${String(index + 1).padStart(2, '0')}`),
  'R99',
];

/** `R01`…`R25`, `R99`, `SEM_REST`, `COM_REST` — 28 domínios (§8.3). */
export const FAIXA_CODES = [
  ...Array.from({ length: 25 }, (_unused, index) => `R${String(index + 1).padStart(2, '0')}`),
  'R99',
  'SEM_REST',
  'COM_REST',
];

export const MODELO_CODES = [
  'BHV_G1',
  'BHV_G4',
  'BHV_G5',
  'BHV_G7',
  'SCORE_HVI4',
  'RESTRITIVOS',
];

/** O mapa de §8.3, deduzido do arquivo real: 110 tuplas em Y. */
export const COMPAT_ALLOW: Record<string, string[]> = {
  BHV_G1: FAIXA_CODES.slice(0, 20),
  BHV_G4: FAIXA_CODES.slice(0, 25),
  BHV_G5: [...FAIXA_CODES.slice(0, 20), 'R99'],
  BHV_G7: [...FAIXA_CODES.slice(0, 20), 'R99'],
  SCORE_HVI4: [...FAIXA_CODES.slice(0, 20), 'R99'],
  RESTRITIVOS: ['SEM_REST', 'COM_REST'],
};

function variable(
  id: string,
  versionId: string,
  code: string,
  name: string,
  type: Variable['type'],
  domains: Domain[],
): Variable {
  return {
    id,
    code,
    name,
    type,
    createdAt: T0,
    versions: [
      {
        id: versionId,
        number: 1,
        state: 'PUBLISHED',
        createdAt: T0,
        createdBy: 'Arthur',
        publishedAt: T0,
        publishedBy: 'Arthur',
        domains,
      },
    ],
  };
}

function catalogItem(
  kind: CatalogItem['kind'],
  code: string,
  label: string,
  position: number,
): CatalogItem {
  return { id: fixedId(`CAT${position}${kind[0]}`), kind, code, label, position, createdAt: T0 };
}

export const OFFER_CODES = ['OFERTA_0', 'OFERTA_3', 'OFERTA_5', 'OFERTA_8', 'OFERTA_12', 'OFERTA_15'];

/**
 * O documento de §8.3 com a biblioteca pronta e **nenhuma matriz** — a carga
 * inicial começa daqui.
 */
export function cineminhaDocument(): PolicyOpsDocument {
  const compat: CompatibilityRule = {
    id: IDS.compat,
    code: 'MOD_ADC_X_FAIXA',
    name: 'Modelo adicional × Faixa',
    parentVariableId: IDS.modelo,
    childVariableId: IDS.faixa,
    createdAt: T0,
    versions: [
      {
        id: IDS.compatV1,
        number: 1,
        state: 'PUBLISHED',
        createdAt: T0,
        createdBy: 'Arthur',
        publishedAt: T0,
        publishedBy: 'Arthur',
        parentVariableVersionId: IDS.modeloV1,
        childVariableVersionId: IDS.faixaV1,
        allow: COMPAT_ALLOW,
        defaultForUnlisted: 'NONE',
      },
    ],
  };

  return {
    schemaVersion: 5,
    meta: {
      id: fixedId('DOC1'),
      name: 'Políticas B2C',
      revision: 1,
      savedAt: null,
      savedBy: null,
      appVersion: '0.1.0',
      createdAt: T0,
    },
    variables: [
      variable(IDS.hvi3, IDS.hvi3V1, 'SCORE_HVI3', 'Score HVI3', 'ORDINAL', domainsOf(SCORE_CODES)),
      variable(
        IDS.modelo,
        IDS.modeloV1,
        'MODELO_ADICIONAL',
        'Modelo adicional',
        'CATEGORICAL',
        domainsOf(MODELO_CODES),
      ),
      variable(
        IDS.faixa,
        IDS.faixaV1,
        'FAIXA_MODELO_ADICIONAL',
        'Faixa do modelo adicional',
        'RANGE',
        domainsOf(FAIXA_CODES),
      ),
    ],
    compatibility: [compat],
    catalog: [
      catalogItem('DECISION', 'APROVADO', 'Aprovado', 0),
      catalogItem('DECISION', 'REPROVADO', 'Reprovado', 1),
      ...OFFER_CODES.map((code, index) => catalogItem('OFFER', code, code, index)),
    ],
    projects: [
      { id: IDS.project, code: 'POLITICA_B2C', name: 'Política B2C', position: 0, createdAt: T0 },
    ],
    matrices: [],
    templates: [],
    importProfiles: [],
    components: [],
    changeRequests: [],
    releases: [],
    events: [],
  };
}

/** O perfil `CARGA_CINEMINHA` de §8, ponta a ponta. */
export function cineminhaProfile(overrides: Partial<ImportProfile> = {}): ImportProfile {
  const offerValueMap = {
    '0': 'OFERTA_0',
    '3': 'OFERTA_3',
    '5': 'OFERTA_5',
    '8': 'OFERTA_8',
    '12': 'OFERTA_12',
    '15': 'OFERTA_15',
  };
  const channels: Array<[string, string, string]> = [
    ['OFERTA', 'TETO', 'Teto da política'],
    ['OFERTA_GERAL', 'GERAL', 'Geral'],
    ['OFERTA_DIGITAL', 'DIGITAL', 'Digital'],
    ['OFERTA_URA', 'URA', 'URA'],
    ['OFERTA_PAP', 'PAP', 'PAP'],
    ['OFERTA_OUTBOUND', 'OUTBOUND', 'Outbound'],
  ];

  return {
    id: IDS.profile,
    code: 'CARGA_CINEMINHA',
    name: 'Carga do cineminha',
    createdAt: T0,
    format: { delimiter: ';', headerRow: 1, hasBom: false, trimValues: true },
    signature: [
      'CLUSTER_GRUPO',
      'CEP_RISCO',
      'DS_MOD_PRC',
      'MOD_PRC',
      'DS_MOD_ADC',
      'MOD_ADC',
      ...channels.map(([column]) => column),
    ],
    projectId: IDS.project,
    columns: [
      { column: 'CLUSTER_GRUPO', role: 'PARTITION' },
      { column: 'CEP_RISCO', role: 'PARTITION' },
      { column: 'DS_MOD_PRC', role: 'CHECK', check: { expected: 'HVI3' } },
      { column: 'MOD_PRC', role: 'AXIS', axis: { role: 'X', level: 0, variableId: IDS.hvi3 } },
      {
        column: 'DS_MOD_ADC',
        role: 'AXIS',
        axis: { role: 'Y', level: 0, variableId: IDS.modelo },
        valueMap: {
          'G1 - BHV': 'BHV_G1',
          'G4 - BHV': 'BHV_G4',
          'G5 - BHV': 'BHV_G5',
          'G7 - BHV': 'BHV_G7',
          HVI4: 'SCORE_HVI4',
          Restritivos: 'RESTRITIVOS',
        },
      },
      { column: 'MOD_ADC', role: 'AXIS', axis: { role: 'Y', level: 1, variableId: IDS.faixa } },
      ...channels.map(([column]) => ({
        column,
        role: 'VALUE' as const,
        value: { field: 'offer' as const },
        valueMap: offerValueMap,
      })),
    ],
    unpivot: {
      code: 'CANAL',
      label: 'Canal',
      options: channels.map(([column, code, label]) => ({ column, code, label })),
    },
    codeTemplate: 'MTZ_{CLUSTER_GRUPO}_{CEP_RISCO}_{CANAL}',
    nameTemplate: '{CLUSTER_GRUPO} · {CEP_RISCO} · {CANAL}',
    decisionRules: [
      { when: { field: 'offer', equals: ['OFERTA_0'] }, setDecision: 'REPROVADO' },
      { otherwise: 'APROVADO' },
    ],
    tagRules: [
      { source: 'PARTITION', column: 'CLUSTER_GRUPO', group: 'Cluster', codePrefix: 'CLUSTER_' },
      { source: 'PARTITION', column: 'CEP_RISCO', group: 'Risco CEP', codePrefix: 'CEP_' },
      { source: 'UNPIVOT', group: 'Canal', codePrefix: 'CANAL_' },
    ],
    missingRowPolicy: 'KEEP',
    suppressUnobserved: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Arquivos
// ---------------------------------------------------------------------------

/**
 * Caminho relativo à raiz do repositório. Usa `process.cwd()` (o Vitest roda
 * sempre da raiz) em vez de `import.meta.url`: no ambiente jsdom — que é o dos
 * testes de componente que também consomem estas fixtures — `import.meta.url`
 * não resolve para um caminho de arquivo.
 */
function repoFile(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8');
}

/** Recorte de 231 linhas: G1 com Restritivos, G4 com R21–R25 e G6 com HVI4. */
export function excerptCsv(): string {
  return repoFile('tests/fixtures/cineminha-recorte.csv');
}

/** O arquivo real inteiro — 6.678 linhas. Usado nos critérios de aceite e no desempenho. */
export function fullCsv(): string {
  return repoFile('CINEMINHA_20260708.csv');
}

export function tableOf(text: string): ImportTable {
  const parsed = parseDelimitedTable(text);
  if (parsed.errors.length > 0) {
    throw new Error(`Fixture não deveria falhar no parser: ${parsed.errors[0]!.message}`);
  }
  return { header: parsed.header, rows: parsed.rows, lines: parsed.lines };
}

export function excerptTable(): ImportTable {
  return tableOf(excerptCsv());
}

/** Troca o valor de uma célula do texto do arquivo, na linha e coluna informadas. */
export function editCsvCell(text: string, line: number, column: string, value: string): string {
  const lines = text.split('\n');
  const header = lines[0]!.split(';');
  const index = header.indexOf(column);
  if (index < 0) throw new Error(`Coluna "${column}" não existe no arquivo de teste.`);
  const fields = lines[line - 1]!.split(';');
  fields[index] = value;
  lines[line - 1] = fields.join(';');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Documento com as matrizes já publicadas
// ---------------------------------------------------------------------------

/**
 * Materializa o plano num documento: cada matriz `NEW` vira uma matriz com v1
 * `PUBLISHED`, com os eixos projetados (inclusive as supressões de RN-21) e as
 * células da carga. É o atalho para os cenários de segunda carga (CT-01, CT-02)
 * sem depender do comando de aplicação, que é a S24.
 */
export function publishPlan(doc: PolicyOpsDocument, plan: ImportPlan): PolicyOpsDocument {
  const matrices: Matrix[] = plan.matrices
    .filter((entry) => entry.status === 'NEW')
    .map((entry, index) => publishedMatrix(entry, index));
  return { ...doc, matrices: [...doc.matrices, ...matrices] };
}

function publishedMatrix(plan: MatrixPlan, index: number): Matrix {
  const axes = plan.axes!;
  const cells: Record<string, Cell> = {};
  for (const change of plan.changes) {
    if (change.kind !== 'ADDED') throw new Error('Matriz nova só produz células adicionadas.');
    cells[change.key] = change.after;
  }
  const version: MatrixVersion = {
    id: fixedId(`MV${index}`),
    number: 1,
    state: 'PUBLISHED',
    createdAt: T0,
    createdBy: 'Arthur',
    publishedAt: T0,
    publishedBy: 'Arthur',
    effectiveFrom: T0,
    axes: {
      x: axisOf(axes.x, index, 'x'),
      y: axisOf(axes.y, index, 'y'),
    },
    cells,
  };
  return {
    id: fixedId(`MTX${index}`),
    projectId: IDS.project,
    code: plan.code,
    name: plan.name,
    createdAt: T0,
    versions: [version],
  };
}

type Cell = MatrixVersion['cells'][string];

function axisOf(planned: NonNullable<MatrixPlan['axes']>['x'], index: number, role: string) {
  return {
    role: planned.role,
    levels: planned.levels.map((level, position) => ({
      id: fixedId(`L${role}${index}${position}`),
      variableId: level.variableId,
      variableVersionId: level.variableVersionId,
      label: level.label,
      domains: level.domains,
    })),
    tuples: planned.tuples,
    ...(planned.manualSuppressions.length > 0
      ? { manualSuppressions: planned.manualSuppressions }
      : {}),
    derivedFrom: { compatibilityVersionIds: planned.compatibilityVersionIds },
  };
}

/** A chave de célula de uma coordenada, para os testes lerem o conteúdo esperado. */
export function cellKey(xPath: string, yPath: string): string {
  return encodeCellKey(xPath, yPath);
}

/** Congela o documento inteiro — prova de que o plano não escreve nele (RN-13). */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return value;
}
