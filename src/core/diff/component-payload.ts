import type { ComponentPayload } from '../document/schema';

/**
 * Diff de payload de componente, campo a campo — docs/14 §8 (US-GOV-08), a
 * metade estruturada do "atual × proposto rico" que a revisão do DB mostra
 * (docs/07 §19.5). A outra metade é o diff de `spec` por bloco, que já existe
 * desde a S34 (`src/core/richdoc/diff.ts`).
 *
 * Função pura sobre os dois payloads, sem conhecer componente nem documento: é
 * o mesmo vocabulário do diff de matriz (`ADDED`/`REMOVED`/`CHANGED`), num
 * nível mais simples porque payload é um objeto raso de textos e listas de
 * texto. Sem diff intra-texto — a fase 1 do épico compara valores inteiros
 * (docs/14 §11).
 */

export type PayloadFieldChangeKind = 'ADDED' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';

export type PayloadFieldChange = {
  /** Nome do campo no payload (`businessDescription`, `outcome`, …). */
  field: string;
  kind: PayloadFieldChangeKind;
  /** Texto legível do valor — listas viram itens separados por vírgula. */
  before: string | null;
  after: string | null;
};

export type ComponentPayloadDiff = {
  /** `false` quando os dois payloads são de tipos diferentes (troca de tipo). */
  comparable: boolean;
  changes: PayloadFieldChange[];
  hasChanges: boolean;
};

function readable(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.length === 0 ? null : value.join(', ');
  const text = String(value);
  return text.trim() === '' ? null : text;
}

/** A ordem em que os campos aparecem: a do formulário, não a alfabética. */
function fieldsOf(payload: ComponentPayload | undefined): string[] {
  if (payload === undefined) return [];
  return Object.keys(payload).filter((key) => key !== 'kind');
}

function kindOf(before: string | null, after: string | null): PayloadFieldChangeKind {
  if (before === after) return 'UNCHANGED';
  if (before === null) return 'ADDED';
  if (after === null) return 'REMOVED';
  return 'CHANGED';
}

/**
 * Compara dois payloads. `before` ausente é o caso do item `CREATE`: tudo o que
 * o proposto tem aparece como `ADDED`, que é literalmente "não existia".
 */
export function diffComponentPayloads(
  before: ComponentPayload | undefined,
  after: ComponentPayload | undefined,
): ComponentPayloadDiff {
  const comparable = before === undefined || after === undefined || before.kind === after.kind;

  const fields: string[] = [];
  for (const field of [...fieldsOf(before), ...fieldsOf(after)]) {
    if (!fields.includes(field)) fields.push(field);
  }

  const changes: PayloadFieldChange[] = fields.map((field) => {
    const beforeValue = readable((before as Record<string, unknown> | undefined)?.[field]);
    const afterValue = readable((after as Record<string, unknown> | undefined)?.[field]);
    return { field, kind: kindOf(beforeValue, afterValue), before: beforeValue, after: afterValue };
  });

  return {
    comparable,
    changes,
    hasChanges: changes.some((change) => change.kind !== 'UNCHANGED'),
  };
}
