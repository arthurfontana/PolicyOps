import type { Cell } from '../document/schema';
import { CELL_FIELDS, type CellField, type CellPatch, type CellPatchSet, type PatchCoord } from './cells';

/**
 * Semântica de três estados do inspector — docs/07-ux-e-editor.md §6.2 e
 * docs/05-regras-de-negocio.md §2.1.
 *
 * `computeFieldState` olha as células selecionadas e diz se o campo é
 * uniforme (todas iguais), divergente (difere entre células, inclusive
 * "algumas têm, outras não têm") ou vazio (nenhuma célula tem o campo). É só
 * leitura — quem decide o que entra no patch é `buildPatchFromForm`.
 *
 * `buildPatchFromForm` é a função pura coberta pelos testes: ela **não**
 * conhece o estado uniforme/divergente/vazio, só o `Set` de campos tocados
 * pelo usuário e os valores atuais do formulário. É essa separação que faz
 * "o usuário não mexeu" nunca vazar pro patch, mesmo quando o valor inicial
 * do campo era o placeholder sintético de um campo divergente.
 */

export type FieldState =
  | { kind: 'uniform'; value: string }
  | { kind: 'divergent' }
  | { kind: 'empty' };

/** Estado de um campo escalar através de um conjunto de células. */
export function computeFieldState(cells: Array<Cell | undefined>, field: CellField): FieldState {
  if (cells.length === 0) return { kind: 'empty' };
  const values = cells.map((cell) => (cell as Partial<Record<CellField, string>> | undefined)?.[field]);
  const present = values.filter((value): value is string => value !== undefined);
  if (present.length === 0) return { kind: 'empty' };
  if (present.length < values.length) return { kind: 'divergent' };
  const [first] = present;
  return present.every((value) => value === first) ? { kind: 'uniform', value: first! } : { kind: 'divergent' };
}

/** Campos tocados pelo usuário — `attrs` conta como um campo à parte. */
export type TouchedFieldKey = CellField | 'attrs';
export type TouchedFields = ReadonlySet<TouchedFieldKey>;

export type CellFormValues = Partial<Record<CellField, string | null>> & {
  attrs?: Record<string, string | number | boolean | null>;
};

/**
 * Constrói o `CellPatch` a partir do formulário — pura, sem acesso a
 * `cells`. Só os campos em `touched` entram no `set`; o restante (uniforme,
 * divergente ou vazio) fica de fora, exatamente como "chave ausente" pede
 * (docs/05 §2.1). Um campo tocado com valor `null` entra como `null` (limpa).
 *
 * Devolve `null` quando não há nada a aplicar — nem campo tocado, nem
 * coordenada — para que quem chama não precise validar isso de novo.
 */
export function buildPatchFromForm(
  touched: TouchedFields,
  values: CellFormValues,
  coords: PatchCoord[],
): CellPatch | null {
  if (coords.length === 0) return null;

  const set: CellPatchSet = {};
  for (const field of CELL_FIELDS) {
    if (!touched.has(field)) continue;
    set[field] = values[field] ?? null;
  }
  if (touched.has('attrs') && values.attrs !== undefined) {
    set.attrs = values.attrs;
  }

  if (Object.keys(set).length === 0) return null;
  return { coords, set };
}
