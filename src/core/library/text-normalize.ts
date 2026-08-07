/**
 * Normalização de texto compartilhada entre `regional-import.ts`,
 * `domain-import.ts` e `color-palettes.ts` — remove acentos e uniformiza
 * caixa para comparar nomes de coluna, códigos de domínio e entradas de
 * paleta sem se importar com maiúsculas/minúsculas ou diacríticos.
 */

// Faixa Unicode dos diacríticos combinantes (U+0300–U+036F), construída por
// código de caractere para não depender de escapes de regex no arquivo-fonte.
const COMBINING_DIACRITICS = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  'g',
);

export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(COMBINING_DIACRITICS, '').trim().toUpperCase();
}

/** `code` é o trecho antes do primeiro "-"/"–"/"—" de um texto "R20 - Altíssimo"; sem separador, o texto inteiro. */
const DASH_SPLIT = /^(.*?)\s*[-–—]\s*(.*)$/;

export function deriveDomainCode(domainText: string): string {
  const match = DASH_SPLIT.exec(domainText);
  return (match ? match[1]! : domainText).trim().toUpperCase();
}
