import type { ApplicableCompatibility } from '@/core/axes/tuples';
import type {
  Axis,
  AxisLevel,
  Cell,
  CompatibilityVersion,
  Domain,
  MatrixVersion,
  MatrixVersionState,
} from '@/core/document/schema';

/**
 * Fixtures compartilhadas dos testes de `src/core/axes/`.
 *
 * Os ids aqui são legíveis (não nanoid) de propósito: nenhum destes objetos
 * passa por Zod, e um id legível deixa a falha do teste auto-explicativa.
 */

export function domains(...codes: string[]): Domain[] {
  return codes.map((code, position) => ({ code, label: `Rótulo ${code}`, position }));
}

/** Domínios com `shortLabel` e `color` — exercitam os campos opcionais do cabeçalho. */
export function richDomains(...codes: string[]): Domain[] {
  return codes.map((code, position) => ({
    code,
    label: `Rótulo ${code}`,
    shortLabel: code.slice(0, 3),
    color: '#123456',
    position,
  }));
}

export const SEGMENTO_DOMAINS = domains('VAREJO', 'ATACADO', 'CORPORATE');
export const FAT_DOMAINS = domains('ATE_100K', '100K_500K', '500K_1M', '1M_10M', 'ACIMA_10M');
export const SCORE_DOMAINS = domains('R1', 'R2', 'R3');

/** O mapa de compatibilidade do documento de exemplo (docs/03 §3). */
export const SEG_X_FAT_ALLOW: Record<string, string[]> = {
  VAREJO: ['ATE_100K', '100K_500K', '500K_1M'],
  ATACADO: ['500K_1M', '1M_10M', 'ACIMA_10M'],
  CORPORATE: ['1M_10M', 'ACIMA_10M'],
};

/** As 8 tuplas que `SEGMENTO › FAT` produz, na ordem do grid. */
export const SEG_X_FAT_TUPLES = [
  'VAREJO|ATE_100K',
  'VAREJO|100K_500K',
  'VAREJO|500K_1M',
  'ATACADO|500K_1M',
  'ATACADO|1M_10M',
  'ATACADO|ACIMA_10M',
  'CORPORATE|1M_10M',
  'CORPORATE|ACIMA_10M',
];

let compatSeq = 0;

export function compatVersion(
  allow: Record<string, string[]>,
  defaultForUnlisted: 'ALL' | 'NONE' = 'NONE',
): CompatibilityVersion {
  compatSeq += 1;
  return {
    id: `compatv-${compatSeq}`,
    number: 1,
    state: 'PUBLISHED',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'Teste',
    publishedAt: '2026-01-01T00:00:00.000Z',
    publishedBy: 'Teste',
    parentVariableVersionId: 'parent-v1',
    childVariableVersionId: 'child-v1',
    allow,
    defaultForUnlisted,
  };
}

export function compat(input: {
  parentVariableId: string;
  childVariableId: string;
  allow: Record<string, string[]>;
  defaultForUnlisted?: 'ALL' | 'NONE';
  ruleCode?: string;
}): ApplicableCompatibility {
  const version = compatVersion(input.allow, input.defaultForUnlisted);
  return {
    ruleId: `rule-${version.id}`,
    ruleCode: input.ruleCode ?? 'REGRA_TESTE',
    parentVariableId: input.parentVariableId,
    childVariableId: input.childVariableId,
    version,
  };
}

/** A regra do exemplo: SEGMENTO → FAT, `defaultForUnlisted: 'NONE'`. */
export function segXFat(defaultForUnlisted: 'ALL' | 'NONE' = 'NONE'): ApplicableCompatibility {
  return compat({
    parentVariableId: 'SEGMENTO',
    childVariableId: 'FAT',
    allow: SEG_X_FAT_ALLOW,
    defaultForUnlisted,
    ruleCode: 'SEG_X_FATURAMENTO',
  });
}

export function level(variableId: string, levelDomains: Domain[], suffix = ''): AxisLevel {
  return {
    id: `lvl-${variableId}${suffix}`,
    variableId,
    variableVersionId: `${variableId}-v1`,
    label: `Nível ${variableId}`,
    domains: levelDomains,
  };
}

export function axis(role: 'X' | 'Y', levels: AxisLevel[], tuples: string[], suppressions?: string[]): Axis {
  const built: Axis = { role, levels, tuples, derivedFrom: { compatibilityVersionIds: [] } };
  if (suppressions !== undefined) built.manualSuppressions = suppressions;
  return built;
}

export function makeVersion(input: {
  x: Axis;
  y: Axis;
  cells?: Record<string, Cell>;
  state?: MatrixVersionState;
}): MatrixVersion {
  return {
    id: 'version-1',
    number: 1,
    state: input.state ?? 'DRAFT',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'Teste',
    axes: { x: input.x, y: input.y },
    cells: input.cells ?? {},
  };
}

/** Preenche todas as combinações do grid com o que `fill` devolver. */
export function fillCells(
  x: Axis,
  y: Axis,
  fill: (xPath: string, yPath: string) => Cell | undefined,
): Record<string, Cell> {
  const cells: Record<string, Cell> = {};
  for (const yPath of y.tuples) {
    for (const xPath of x.tuples) {
      const cell = fill(xPath, yPath);
      if (cell !== undefined) cells[`${xPath}::${yPath}`] = cell;
    }
  }
  return cells;
}

/** N domínios sintéticos — usado nos testes de teto de combinações. */
export function manyDomains(count: number): Domain[] {
  return Array.from({ length: count }, (_unused, position) => ({
    code: `D${position}`,
    label: `Domínio ${position}`,
    position,
  }));
}
