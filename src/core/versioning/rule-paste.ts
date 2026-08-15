/**
 * Entrada em volume — docs/07-ux-e-editor.md §17.3, item 5,
 * docs/14-governanca-de-alteracoes.md §9.1 (anatomia do documento real).
 *
 * Reconhece um bloco de texto colado direto do documento de política (não o
 * Markdown convertido do §9 — este é mais simples, sobre o texto cru): um
 * parágrafo solto vira `businessDescription`, uma linha `Definição técnica:`
 * vira `technicalDefinition`, e uma linha `Observação:` se distribui entre
 * `reasonCodes`, `outcome` e `notes` — a mesma divisão que o prompt de
 * conversão do §9.1 pede para o Markdown, aplicada aqui por regex sobre o
 * texto colado. **Sem parser de Markdown e sem lib**: reconhecimento de
 * prefixo de linha, nada mais.
 */

const TECHNICAL_DEFINITION_PREFIX = 'Definição técnica:';
const OBSERVATION_PREFIX = 'Observação:';

export type RulePasteRecognition = {
  businessDescription: string;
  technicalDefinition?: string;
  outcome?: string;
  reasonCodes?: string[];
  notes?: string;
};

/** "Reason code DV01, DV02 — reprovado, Oferta = 0." → códigos + resultado + notas. */
function parseObservation(text: string): { reasonCodes: string[]; outcome?: string; notes?: string } {
  const match = /reason codes?\s+([^—-]+)[—-]\s*(.*)$/i.exec(text);
  if (match === null) {
    return { reasonCodes: [], notes: text };
  }

  const reasonCodes = match[1]!
    .split(/,| e /i)
    .map((code) => code.trim())
    .filter((code) => code.length > 0);

  const rest = match[2]!.trim();
  const [outcomePart, ...noteParts] = rest.split(',');
  const outcome = outcomePart?.trim();
  const notes = noteParts.join(',').trim();

  const result: { reasonCodes: string[]; outcome?: string; notes?: string } = { reasonCodes };
  if (outcome !== undefined && outcome.length > 0) {
    result.outcome = outcome.charAt(0).toUpperCase() + outcome.slice(1);
  }
  if (notes.length > 0) result.notes = notes;
  return result;
}

/**
 * Reconhece o bloco colado. Linhas em branco só separam parágrafos — nunca
 * viram parte do texto reconhecido. Linha sem prefixo reconhecido acumula em
 * `businessDescription`, na ordem em que aparece.
 */
export function recognizeRulePaste(text: string): RulePasteRecognition {
  const businessLines: string[] = [];
  let technicalDefinition: string | undefined;
  let observation: string | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    if (line.startsWith(TECHNICAL_DEFINITION_PREFIX)) {
      technicalDefinition = line.slice(TECHNICAL_DEFINITION_PREFIX.length).trim();
      continue;
    }
    if (line.startsWith(OBSERVATION_PREFIX)) {
      observation = line.slice(OBSERVATION_PREFIX.length).trim();
      continue;
    }
    businessLines.push(line);
  }

  const result: RulePasteRecognition = { businessDescription: businessLines.join(' ') };
  if (technicalDefinition !== undefined && technicalDefinition.length > 0) {
    result.technicalDefinition = technicalDefinition;
  }
  if (observation !== undefined && observation.length > 0) {
    const parsed = parseObservation(observation);
    if (parsed.reasonCodes.length > 0) result.reasonCodes = parsed.reasonCodes;
    if (parsed.outcome !== undefined) result.outcome = parsed.outcome;
    if (parsed.notes !== undefined) result.notes = parsed.notes;
  }
  return result;
}
