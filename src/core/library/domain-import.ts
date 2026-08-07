import { CODE_REGEX } from '../document/schema';
import type { Domain } from '../document/schema';
import { deriveDomainCode, normalizeText } from './text-normalize';

/**
 * Importação genérica de tabela colada — docs/05-regras-de-negocio.md §5.6.2,
 * restrita nesta sessão a 0 colunas de agrupamento (chegam na sessão 20).
 *
 * `parseDomainTable` é função **pura**: traduz o texto colado do Excel (TSV,
 * tabulação como separador de coluna) em `{ domains, columns, warnings,
 * errors }`. Não grava nada no documento e nunca lança — todo problema vira
 * `errors` (fatal, nada é aproveitado); `warnings` fica reservado para os
 * casos não-fatais de sessões futuras (colunas de agrupamento incompletas).
 *
 * Contrato de colagem — tabela tidy, uma linha por domínio:
 *   Linha 1 — cabeçalho obrigatório. Reconhece (sem diferenciar
 *             maiúsculas/acentos): Domínio/Código (âncora obrigatória, deve
 *             ser a primeira coluna), Mínimo/Min/Mín, Máximo/Max/Máx,
 *             Cor/RGB/Hex — todas exceto Domínio são opcionais, em qualquer
 *             ordem entre si.
 *   Linhas seguintes — uma por domínio: `code`/`label` extraídos da coluna
 *             Domínio como em `regional-import.ts`; sem colunas de
 *             agrupamento, cada `code` só pode aparecer uma vez.
 */

const HEADER_ROLES: Record<string, 'anchor' | 'min' | 'max' | 'color'> = {
  DOMINIO: 'anchor',
  CODIGO: 'anchor',
  MINIMO: 'min',
  MIN: 'min',
  MAXIMO: 'max',
  MAX: 'max',
  COR: 'color',
  RGB: 'color',
  HEX: 'color',
};

type OptionalColumn = 'min' | 'max' | 'color';

/** `undefined` para colunas que a colagem não reconhece (fica ignorada). */
function classifyHeaderCell(cell: string): 'anchor' | OptionalColumn | undefined {
  return HEADER_ROLES[normalizeText(cell)];
}

const HEX_COLOR = /^#([0-9A-Fa-f]{6})$/;

/** `#RRGGBB` ou `R G B` / `R, G, B` (0–255) — convertida para `#RRGGBB` (docs/05 §5.6.2 item 4). `false` = inválida. */
function parseColorCell(raw: string): string | undefined | false {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  const hexMatch = HEX_COLOR.exec(trimmed);
  if (hexMatch) return `#${hexMatch[1]!.toUpperCase()}`;

  const parts = trimmed.split(/[\s,]+/).filter((part) => part !== '');
  if (parts.length === 3 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const [r, g, b] = parts.map(Number) as [number, number, number];
    if (r <= 255 && g <= 255 && b <= 255) {
      const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
  }

  return false;
}

export type ParseDomainTableResult = {
  domains: Domain[];
  columns: Set<OptionalColumn>;
  warnings: string[];
  errors: string[];
};

function fatal(message: string): ParseDomainTableResult {
  return { domains: [], columns: new Set(), warnings: [], errors: [message] };
}

export function parseDomainTable(text: string): ParseDomainTableResult {
  const lines = text.split(/\r\n|\n/).filter((line) => line.trim() !== '');
  if (lines.length < 1) {
    return fatal('A colagem está vazia: inclua ao menos a linha de cabeçalho.');
  }

  const rows = lines.map((line) => line.split('\t'));
  const [headerRow, ...dataRows] = rows as [string[], ...string[][]];

  const roles = headerRow.map((cell) => classifyHeaderCell(cell));
  const anchorIndex = roles.indexOf('anchor');
  if (anchorIndex < 0) {
    return fatal(
      'Cabeçalho sem a coluna "Domínio" (ou "Código") — ela é a âncora obrigatória da tabela.',
    );
  }
  if (anchorIndex > 0) {
    return fatal(
      'Há coluna(s) antes de "Domínio" no cabeçalho — colunas de agrupamento (Regional, Porte…) chegam em uma sessão futura.',
    );
  }

  const columns = new Set<OptionalColumn>();
  for (const role of roles) {
    if (role === 'min' || role === 'max' || role === 'color') columns.add(role);
  }
  const minIndex = roles.indexOf('min');
  const maxIndex = roles.indexOf('max');
  const colorIndex = roles.indexOf('color');

  const warnings: string[] = [];
  const domains: Domain[] = [];
  const seenCodes = new Set<string>();
  let position = 0;

  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
    const row = dataRows[rowIndex]!;
    const lineNumber = rowIndex + 2; // 1-based, após o cabeçalho
    if (row.length !== headerRow.length) {
      return fatal(
        `Linha ${lineNumber}: número de colunas (${row.length}) não bate com o cabeçalho (${headerRow.length}).`,
      );
    }

    const domainText = (row[anchorIndex] ?? '').trim();
    if (domainText === '') {
      return fatal(`Linha ${lineNumber}: a coluna "Domínio" está vazia.`);
    }

    const code = deriveDomainCode(domainText);
    if (!CODE_REGEX.test(code)) {
      return fatal(
        `Linha ${lineNumber}: o código "${code}" derivado de "${domainText}" é inválido — precisa casar ^[A-Z0-9_]+$.`,
      );
    }
    if (seenCodes.has(code)) {
      return fatal(
        `Linha ${lineNumber}: o código "${code}" já apareceu antes — sem colunas de agrupamento, cada domínio só pode aparecer uma vez.`,
      );
    }
    seenCodes.add(code);

    const domain: Domain = { code, label: domainText, position };

    if (minIndex >= 0) {
      const minText = (row[minIndex] ?? '').trim();
      if (minText !== '') domain.rangeMin = minText;
    }
    if (maxIndex >= 0) {
      const maxText = (row[maxIndex] ?? '').trim();
      if (maxText !== '') domain.rangeMax = maxText;
    }
    if (colorIndex >= 0) {
      const colorText = (row[colorIndex] ?? '').trim();
      const parsedColor = parseColorCell(colorText);
      if (parsedColor === false) {
        return fatal(
          `Linha ${lineNumber}: a cor "${colorText}" não é válida — use #RRGGBB ou "R G B" (0–255).`,
        );
      }
      if (parsedColor !== undefined) domain.color = parsedColor;
    }

    domains.push(domain);
    position += 1;
  }

  return { domains, columns, warnings, errors: [] };
}

/**
 * Preservação de atributos existentes ao recolar — docs/05-regras-de-negocio.md
 * §5.6.3. Casa por `code` com a lista existente; decide campo a campo, só a
 * partir de `parsed.columns` (o que a colagem de fato trouxe):
 *   - `label`/`shortLabel`: sempre vêm da colagem;
 *   - `color`: só é sobrescrita se `columns.has('color')`;
 *   - `rangeMin`/`rangeMax`: só são sobrescritos se `columns` tiver os dois.
 * Domínio colado sem correspondência entra só com os campos que a colagem
 * trouxe. Domínio existente não mencionado na colagem fica de fora do
 * resultado — é o usuário quem decide, revisando o preview.
 */
export function mergeImportedDomains(
  existingDomains: Domain[],
  parsed: { domains: Domain[]; columns: Set<OptionalColumn> },
): Domain[] {
  const existingByCode = new Map(existingDomains.map((domain) => [domain.code, domain]));

  return parsed.domains.map((pasted) => {
    const existing = existingByCode.get(pasted.code);
    if (existing === undefined) return pasted;

    const merged: Domain = {
      ...existing,
      code: pasted.code,
      label: pasted.label,
      position: pasted.position,
    };

    if (parsed.columns.has('color')) {
      if (pasted.color !== undefined) merged.color = pasted.color;
      else delete merged.color;
    }

    if (parsed.columns.has('min') && parsed.columns.has('max')) {
      if (pasted.rangeMin !== undefined) merged.rangeMin = pasted.rangeMin;
      else delete merged.rangeMin;
      if (pasted.rangeMax !== undefined) merged.rangeMax = pasted.rangeMax;
      else delete merged.rangeMax;
    }

    return merged;
  });
}
