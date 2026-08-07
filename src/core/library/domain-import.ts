import { CODE_REGEX } from '../document/schema';
import type { Domain, GroupingDimension, GroupingOption, GroupingRange } from '../document/schema';
import { groupingPathKey } from '../document/grouping';
import { deriveDomainCode, normalizeText } from './text-normalize';

/**
 * Importação genérica de tabela colada — docs/05-regras-de-negocio.md §5.6.2.
 *
 * `parseDomainTable` é função **pura**: traduz o texto colado do Excel (TSV,
 * tabulação como separador de coluna) em `{ domains, groupingDimensions,
 * columns, warnings, errors }`. Não grava nada no documento e nunca lança —
 * problema de formato vira `errors` (fatal, nada é aproveitado); o que é
 * recuperável (linha com faixa incompleta, cor divergente numa repetição do
 * mesmo domínio) vira `warnings`.
 *
 * Contrato de colagem — tabela tidy, uma linha por combinação:
 *   Linha 1 — cabeçalho obrigatório. Reconhece (sem diferenciar
 *             maiúsculas/acentos): Domínio/Código (âncora obrigatória),
 *             Mínimo/Min/Mín, Máximo/Max/Máx, Cor/RGB/Hex. Toda coluna à
 *             **esquerda** de Domínio que não bata com um nome reconhecido é
 *             uma coluna de agrupamento, na ordem em que aparece — de 0 a 4
 *             (I19); acima disso é erro.
 *   Linhas seguintes — uma por combinação: valor de cada agrupamento, o
 *             domínio, a faixa e a cor (quando as colunas existirem).
 *             Sem colunas de agrupamento, cada `code` só pode aparecer uma vez.
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

/** Teto de níveis de agrupamento (I19) — o mesmo de `validate-domains.ts`. */
export const MAX_GROUPING_COLUMNS = 4;

type OptionalColumn = 'min' | 'max' | 'color' | 'grouping';

/** `undefined` para colunas que a colagem não reconhece (candidatas a agrupamento). */
function classifyHeaderCell(cell: string): 'anchor' | 'min' | 'max' | 'color' | undefined {
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

/**
 * Código de uma opção de agrupamento a partir do texto da célula — maiúsculo,
 * sem acento, espaço vira `_` (docs/05 §5.6.2 item 5). Tudo que sobrar fora de
 * `^[A-Z0-9_]+$` é descartado, para que "Não MEI (1 sócio)" vire um `code`
 * válido sem o usuário precisar limpar a planilha antes de colar.
 */
export function groupingOptionCode(text: string): string {
  return normalizeText(text)
    .replace(/[\s/-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export type ParseDomainTableResult = {
  domains: Domain[];
  /** Vazio = a colagem não trouxe coluna de agrupamento (docs/05 §5.6.2 item 7). */
  groupingDimensions: GroupingDimension[];
  columns: Set<OptionalColumn>;
  warnings: string[];
  errors: string[];
};

function fatal(message: string): ParseDomainTableResult {
  return {
    domains: [],
    groupingDimensions: [],
    columns: new Set(),
    warnings: [],
    errors: [message],
  };
}

/** Acumulador por domínio enquanto a tabela é percorrida — vira `Domain` no fim. */
type DomainAccumulator = {
  domain: Domain;
  groupingRanges: GroupingRange[];
  seenPaths: Set<string>;
};

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

  // Colunas de agrupamento: tudo à esquerda de Domínio que não é um nome
  // reconhecido, na ordem em que aparece (docs/05 §5.6.2 item 1).
  const groupingIndexes: number[] = [];
  for (let col = 0; col < anchorIndex; col++) {
    // Coluna reconhecida (Mínimo, Cor…) continua sendo ela mesma onde quer que
    // esteja — só o que o cabeçalho não reconhece vira nível de agrupamento.
    if (roles[col] !== undefined) continue;
    if ((headerRow[col] ?? '').trim() === '') {
      return fatal(`A coluna ${col + 1}, à esquerda de "Domínio", está sem nome no cabeçalho.`);
    }
    groupingIndexes.push(col);
  }
  if (groupingIndexes.length > MAX_GROUPING_COLUMNS) {
    return fatal(
      `A tabela tem ${groupingIndexes.length} colunas de agrupamento — o máximo é ${MAX_GROUPING_COLUMNS}.`,
    );
  }

  const columns = new Set<OptionalColumn>();
  for (const role of roles) {
    if (role === 'min' || role === 'max' || role === 'color') columns.add(role);
  }
  if (groupingIndexes.length > 0) columns.add('grouping');
  const minIndex = roles.indexOf('min');
  const maxIndex = roles.indexOf('max');
  const colorIndex = roles.indexOf('color');
  const hasRangeColumns = minIndex >= 0 && maxIndex >= 0;

  // Um nível por coluna de agrupamento; `options` cresce por ordem de primeira
  // aparição do valor na tabela (docs/05 §5.6.2 item 5).
  const levels = groupingIndexes.map((col) => {
    const label = (headerRow[col] ?? '').trim();
    const code = groupingOptionCode(label);
    return { label, code, options: [] as GroupingOption[], seen: new Set<string>() };
  });
  for (let i = 0; i < levels.length; i++) {
    if (!CODE_REGEX.test(levels[i]!.code)) {
      return fatal(
        `O cabeçalho de agrupamento "${levels[i]!.label}" não gera um código válido — use letras, números ou "_".`,
      );
    }
    if (levels.findIndex((level) => level.code === levels[i]!.code) !== i) {
      return fatal(`Há duas colunas de agrupamento com o mesmo código "${levels[i]!.code}".`);
    }
  }

  const warnings: string[] = [];
  const accumulators = new Map<string, DomainAccumulator>();
  const order: string[] = [];

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

    // Caminho desta linha, registrando as opções novas de cada nível.
    const path: string[] = [];
    for (let level = 0; level < levels.length; level++) {
      const cell = (row[groupingIndexes[level]!] ?? '').trim();
      if (cell === '') {
        return fatal(
          `Linha ${lineNumber}: a coluna de agrupamento "${levels[level]!.label}" está vazia.`,
        );
      }
      const optionCode = groupingOptionCode(cell);
      if (!CODE_REGEX.test(optionCode)) {
        return fatal(
          `Linha ${lineNumber}: "${cell}" não gera um código de agrupamento válido — use letras, números ou "_".`,
        );
      }
      if (!levels[level]!.seen.has(optionCode)) {
        levels[level]!.seen.add(optionCode);
        levels[level]!.options.push({ code: optionCode, label: cell });
      }
      path.push(optionCode);
    }

    const minText = minIndex >= 0 ? (row[minIndex] ?? '').trim() : '';
    const maxText = maxIndex >= 0 ? (row[maxIndex] ?? '').trim() : '';

    let parsedColor: string | undefined;
    if (colorIndex >= 0) {
      const colorText = (row[colorIndex] ?? '').trim();
      const candidate = parseColorCell(colorText);
      if (candidate === false) {
        return fatal(
          `Linha ${lineNumber}: a cor "${colorText}" não é válida — use #RRGGBB ou "R G B" (0–255).`,
        );
      }
      parsedColor = candidate;
    }

    // Identidade e cor vêm da PRIMEIRA linha em que o code aparece; uma cor
    // diferente e não vazia numa linha posterior é aviso (docs/05 §5.6.2 item 6).
    let accumulator = accumulators.get(code);
    if (accumulator === undefined) {
      const domain: Domain = { code, label: domainText, position: order.length };
      if (parsedColor !== undefined) domain.color = parsedColor;
      accumulator = { domain, groupingRanges: [], seenPaths: new Set() };
      accumulators.set(code, accumulator);
      order.push(code);
    } else {
      if (levels.length === 0) {
        return fatal(
          `Linha ${lineNumber}: o código "${code}" já apareceu antes — sem colunas de agrupamento, cada domínio só pode aparecer uma vez.`,
        );
      }
      if (parsedColor !== undefined && parsedColor !== accumulator.domain.color) {
        warnings.push(
          `Linha ${lineNumber}: o domínio "${code}" já tinha a cor ${accumulator.domain.color ?? '(nenhuma)'} — a cor ${parsedColor} desta linha foi ignorada.`,
        );
      }
    }

    if (levels.length === 0) {
      if (minText !== '') accumulator.domain.rangeMin = minText;
      if (maxText !== '') accumulator.domain.rangeMax = maxText;
      continue;
    }

    if (!hasRangeColumns) continue;

    // Faixa incompleta numa linha com agrupamento é aviso: a combinação não
    // entra no resultado (docs/05 §5.6.2 item 8).
    if (minText === '' || maxText === '') {
      warnings.push(
        `Linha ${lineNumber}: o domínio "${code}" está sem mínimo/máximo em "${path.join(' › ')}" — combinação não incluída, complete manualmente ou recole.`,
      );
      continue;
    }

    const key = groupingPathKey(path);
    if (accumulator.seenPaths.has(key)) {
      return fatal(
        `Linha ${lineNumber}: o domínio "${code}" já tem uma faixa para a combinação "${path.join(' › ')}".`,
      );
    }
    accumulator.seenPaths.add(key);
    accumulator.groupingRanges.push({ path, min: minText, max: maxText });
  }

  const domains = order.map((code) => {
    const accumulator = accumulators.get(code)!;
    if (levels.length > 0 && hasRangeColumns) {
      accumulator.domain.groupingRanges = accumulator.groupingRanges;
    }
    return accumulator.domain;
  });

  const groupingDimensions: GroupingDimension[] = levels.map((level) => ({
    code: level.code,
    label: level.label,
    options: level.options,
  }));

  return { domains, groupingDimensions, columns, warnings, errors: [] };
}

/**
 * Preservação de atributos existentes ao recolar — docs/05-regras-de-negocio.md
 * §5.6.3. Casa por `code` com a lista existente (e, quando há agrupamento, por
 * `(code, path)` dentro de `groupingRanges`); decide campo a campo, só a
 * partir de `parsed.columns` (o que a colagem de fato trouxe):
 *   - `label`/`shortLabel`: sempre vêm da colagem;
 *   - `color`: só é sobrescrita se `columns.has('color')`;
 *   - `rangeMin`/`rangeMax`/`groupingRanges`: só são sobrescritos se
 *     `Mínimo`/`Máximo` estavam presentes.
 * Com agrupamento, a substituição de `groupingRanges` é **por caminho**: uma
 * colagem que só traz `["SP","MEI"]` atualiza aquela entrada e mantém intactas
 * as dos demais caminhos do mesmo domínio.
 * Domínio colado sem correspondência entra só com os campos que a colagem
 * trouxe. Domínio existente não mencionado na colagem fica de fora do
 * resultado — é o usuário quem decide, revisando o preview.
 */
export function mergeImportedDomains(
  existingDomains: Domain[],
  parsed: { domains: Domain[]; columns: Set<OptionalColumn> },
): Domain[] {
  const existingByCode = new Map(existingDomains.map((domain) => [domain.code, domain]));
  const hasRangeColumns = parsed.columns.has('min') && parsed.columns.has('max');

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

    if (hasRangeColumns) {
      if (parsed.columns.has('grouping')) {
        const byPath = new Map(
          (existing.groupingRanges ?? []).map((range) => [groupingPathKey(range.path), range]),
        );
        for (const range of pasted.groupingRanges ?? []) {
          byPath.set(groupingPathKey(range.path), range);
        }
        merged.groupingRanges = [...byPath.values()];
        delete merged.rangeMin;
        delete merged.rangeMax;
      } else {
        if (pasted.rangeMin !== undefined) merged.rangeMin = pasted.rangeMin;
        else delete merged.rangeMin;
        if (pasted.rangeMax !== undefined) merged.rangeMax = pasted.rangeMax;
        else delete merged.rangeMax;
        // Colar faixas sem coluna de agrupamento é a versão saindo do modo
        // agrupado (interruptor por versão, docs/05 §5.6).
        delete merged.groupingRanges;
      }
    }

    return merged;
  });
}
