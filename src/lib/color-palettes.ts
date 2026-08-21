import type { Domain } from '@/core/document/schema';
import { normalizeText } from '@/core/library/text-normalize';

/**
 * Paletas oficiais de cor de **domínio** — docs/05-regras-de-negocio.md §5.6.4
 * (dados fornecidos pelo usuário em §5.6.4.1/§5.6.4.2). Dados estáticos, sem
 * I/O, sem servidor — independentes das 12 cores de célula de `colors.ts`
 * (domínio e célula têm resoluções de cor independentes, docs/05 §3).
 */

export type ColorPaletteEntry = {
  /** Código canônico da entrada (ex.: "R01", "BAIXISSIMO"). */
  code: string;
  /** Rótulo de exibição (ex.: "R01", "Baixíssimo"). */
  label: string;
  /** `#RRGGBB`. */
  color: string;
};

export type ColorPalette = {
  id: string;
  name: string;
  entries: ColorPaletteEntry[];
};

// docs/05-regras-de-negocio.md §5.6.4.1 — RGB convertidos para #RRGGBB.
const RISCO_R01_R20_HEX: Record<string, string> = {
  R01: '#00FF2A',
  R02: '#24FF48',
  R03: '#48FF66',
  R04: '#6CFF84',
  R05: '#90FFA2',
  R06: '#B4FFC0',
  R07: '#D8FFDE',
  R08: '#F0FFF6',
  R09: '#FFEAC0',
  R10: '#FFD280',
  R11: '#FFBA40',
  R12: '#FFA200',
  R13: '#FFE0E0',
  R14: '#FFC0C0',
  R15: '#FFA0A0',
  R16: '#FF8080',
  R17: '#FF6060',
  R18: '#FF4040',
  R19: '#FF2020',
  R20: '#FF0000',
};

// docs/05-regras-de-negocio.md §5.6.4.2
const RISCO_SIMPLIFICADO_HEX: Array<[string, string, string]> = [
  ['BAIXISSIMO', 'Baixíssimo', '#2ECC71'],
  ['BAIXO', 'Baixo', '#8BC34A'],
  ['MEDIO', 'Médio', '#FFC107'],
  ['ALTO', 'Alto', '#FF7043'],
  ['ALTISSIMO', 'Altíssimo', '#D32F2F'],
];

export const COLOR_PALETTES: ColorPalette[] = [
  {
    id: 'RISCO_R01_R20',
    name: 'Risco R01–R20',
    entries: Object.entries(RISCO_R01_R20_HEX).map(([code, color]) => ({ code, label: code, color })),
  },
  {
    id: 'RISCO_SIMPLIFICADO',
    name: 'Risco simplificado',
    entries: RISCO_SIMPLIFICADO_HEX.map(([code, label, color]) => ({ code, label, color })),
  },
];

/**
 * Normaliza um código tolerando zero à esquerda no bloco numérico final —
 * "R1" e "R01" precisam casar com a mesma entrada (docs/05 §5.6.4). Textos
 * sem bloco numérico (ex.: "Baixíssimo") caem no fallback de igualdade
 * direta de `normalizeText`.
 */
function normalizeNumericKey(value: string): string {
  const normalized = normalizeText(value);
  const match = /^([A-Z_]*?)0*(\d+)$/.exec(normalized);
  return match === null ? normalized : `${match[1]}${match[2]}`;
}

function matchesEntry(candidate: string, entry: ColorPaletteEntry): boolean {
  if (candidate === '') return false;
  const normalized = normalizeText(candidate);
  if (normalized === normalizeText(entry.code) || normalized === normalizeText(entry.label)) return true;
  return normalizeNumericKey(candidate) === normalizeNumericKey(entry.code);
}

/**
 * Aplica `color` a todo domínio cujo `code` **ou** `label` bater com uma
 * entrada da paleta — docs/05-regras-de-negocio.md §5.6.4. Domínios sem
 * correspondência saem intocados; domínios com correspondência têm a cor
 * sobrescrita mesmo se já tinham uma (ação explícita de "Aplicar paleta").
 * `paletteId` desconhecido devolve `domains` sem alterações.
 */
export function suggestPaletteColors(domains: Domain[], paletteId: string): Domain[] {
  const palette = COLOR_PALETTES.find((candidate) => candidate.id === paletteId);
  if (palette === undefined) return domains;

  return domains.map((domain) => {
    const entry = palette.entries.find(
      (candidate) => matchesEntry(domain.code, candidate) || matchesEntry(domain.label, candidate),
    );
    if (entry === undefined) return domain;
    return { ...domain, color: entry.color };
  });
}
