import { CODE_REGEX } from '../document/schema';
import type { Domain, RegionalOption, RegionalRange } from '../document/schema';

/**
 * Importação de tabela colada — docs/05-regras-de-negocio.md §5.6.2.
 *
 * Função **pura**: traduz o texto colado do Excel (TSV, tabulação como
 * separador de coluna) em `{ domains, regions, warnings, errors }`, prontos
 * para a interface popular o editor de domínios e passar por
 * `variable/saveDomains`. Não grava nada no documento e nunca lança — todo
 * problema vira entrada em `warnings` (recuperável) ou `errors` (fatal, nada
 * é aproveitado).
 *
 * Contrato de colagem:
 *   Linha 1 — um código de regional por bloco de 2 colunas (MIN, MAX); célula
 *             mesclada do Excel vira, ao colar, a primeira coluna do bloco
 *             preenchida e a segunda vazia — o parser faz *carry-forward*.
 *   Linha 2 — "MIN"/"MAX" (aceita acentos, case-insensitive), uma marca por
 *             coluna de dado.
 *   Linhas seguintes — uma por domínio: primeira coluna é o texto completo
 *             (ex.: "R20 - Altíssimo"), que vira `label` verbatim; `code` é o
 *             trecho antes do primeiro "-"/"–"/"—", maiúsculo.
 */

const DASH_SPLIT = /^(.*?)\s*[-–—]\s*(.*)$/;

export type ParseRegionalRangeTableResult = {
  domains: Domain[];
  regions: RegionalOption[];
  warnings: string[];
  errors: string[];
};

function fatal(message: string): ParseRegionalRangeTableResult {
  return { domains: [], regions: [], warnings: [], errors: [message] };
}

// Faixa Unicode dos diacríticos combinantes (U+0300–U+036F), construída por
// código de caractere para não depender de escapes de regex no arquivo-fonte.
const COMBINING_DIACRITICS = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  'g',
);

/** Remove acentos e normaliza para comparar "MIN"/"Mín" sem se importar com caixa. */
function normalizeMarker(value: string): string {
  return value.normalize('NFD').replace(COMBINING_DIACRITICS, '').trim().toUpperCase();
}

function deriveCode(domainText: string): string {
  const match = DASH_SPLIT.exec(domainText);
  const codeRaw = match ? match[1]! : domainText;
  return codeRaw.trim().toUpperCase();
}

export function parseRegionalRangeTable(text: string): ParseRegionalRangeTableResult {
  const lines = text.split(/\r\n|\n/).filter((line) => line.trim() !== '');
  if (lines.length < 2) {
    return fatal(
      'Cabeçalho ausente: a colagem precisa de duas linhas de cabeçalho (regional e MIN/MAX) antes das faixas.',
    );
  }

  const rows = lines.map((line) => line.split('\t'));
  const [headerRow1, headerRow2, ...dataRows] = rows as [string[], string[], ...string[][]];

  if (headerRow1.length !== headerRow2.length || headerRow2.length < 3) {
    return fatal(
      'Cabeçalho incompleto: as duas primeiras linhas precisam ter o mesmo número de colunas, com ao menos um par MIN/MAX.',
    );
  }

  const dataColumnCount = headerRow2.length - 1;
  if (dataColumnCount % 2 !== 0) {
    return fatal('Cabeçalho incompleto: o número de colunas de regional precisa ser par (um par MIN/MAX por regional).');
  }

  // Carry-forward: célula mesclada do Excel só preenche a primeira coluna do bloco.
  const carried = [...headerRow1];
  let lastRegion = '';
  for (let col = 1; col < carried.length; col++) {
    const cell = carried[col]!.trim();
    if (cell !== '') lastRegion = cell;
    carried[col] = lastRegion;
  }

  const regions: RegionalOption[] = [];
  // Índice de coluna → posição em `regions`, para achar o regional de cada célula de dado.
  const columnRegionIndex: number[] = new Array(headerRow2.length).fill(-1);

  for (let col = 1; col < headerRow2.length; col += 2) {
    const minMark = normalizeMarker(headerRow2[col] ?? '');
    const maxMark = normalizeMarker(headerRow2[col + 1] ?? '');
    if (minMark !== 'MIN' || maxMark !== 'MAX') {
      return fatal(
        `Cabeçalho incompleto: esperado "MIN"/"MAX" nas colunas ${col + 1} e ${col + 2}, encontrado "${headerRow2[col] ?? ''}"/"${headerRow2[col + 1] ?? ''}".`,
      );
    }
    const regionLabelA = carried[col]!.trim();
    const regionLabelB = carried[col + 1]!.trim();
    if (regionLabelA === '' || regionLabelA !== regionLabelB) {
      return fatal(
        `Cabeçalho incompleto: o regional das colunas ${col + 1} e ${col + 2} não está definido ou não é o mesmo em MIN e MAX.`,
      );
    }
    const code = regionLabelA.toUpperCase();
    if (!CODE_REGEX.test(code)) {
      return fatal(`O código de regional "${regionLabelA}" é inválido: precisa casar ^[A-Z0-9_]+$.`);
    }
    columnRegionIndex[col] = regions.length;
    columnRegionIndex[col + 1] = regions.length;
    regions.push({ code, label: regionLabelA });
  }

  const warnings: string[] = [];
  const domains: Domain[] = [];
  let position = 0;

  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
    const row = dataRows[rowIndex]!;
    const lineNumber = rowIndex + 3; // 1-based, após as duas linhas de cabeçalho
    if (row.length !== headerRow2.length) {
      return fatal(
        `Linha ${lineNumber}: número de colunas (${row.length}) não bate com o cabeçalho (${headerRow2.length}).`,
      );
    }

    const domainText = (row[0] ?? '').trim();
    if (domainText === '') {
      return fatal(`Linha ${lineNumber}: a primeira coluna (código/rótulo do domínio) está vazia.`);
    }

    const code = deriveCode(domainText);
    if (!CODE_REGEX.test(code)) {
      return fatal(
        `Linha ${lineNumber}: o código "${code}" derivado de "${domainText}" é inválido — precisa casar ^[A-Z0-9_]+$.`,
      );
    }

    const regionalRanges: Record<string, RegionalRange> = {};
    let incomplete = false;
    for (let col = 1; col < headerRow2.length; col += 2) {
      const region = regions[columnRegionIndex[col]!]!;
      const minText = (row[col] ?? '').trim();
      const maxText = (row[col + 1] ?? '').trim();
      if (minText === '' || maxText === '') {
        warnings.push(
          `Domínio "${code}": faixa vazia para o regional "${region.code}" na linha ${lineNumber} — domínio não incluído, complete manualmente ou recole.`,
        );
        incomplete = true;
        continue;
      }
      regionalRanges[region.code] = { min: minText, max: maxText };
    }

    if (incomplete) continue;

    domains.push({
      code,
      label: domainText,
      position,
      regionalRanges,
    });
    position += 1;
  }

  return { domains, regions, warnings, errors: [] };
}
