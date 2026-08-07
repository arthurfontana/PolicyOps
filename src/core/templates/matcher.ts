import { decodePath } from '../axes/paths';
import type { PathMatcher } from '../document/schema';

/**
 * `PathMatcher` — docs/05-regras-de-negocio.md §8 e docs/03-modelo-do-documento.md §7.
 *
 * Casa por nível: `null` numa posição casa qualquer código naquele nível.
 * Matcher mais curto que o caminho casa por prefixo — `["VAREJO"]` pega todas
 * as faixas de faturamento do Varejo, o mesmo que `["VAREJO", null]`.
 * Matcher ausente (`undefined`) — `when.x`/`when.y` não informado — casa
 * qualquer caminho: é o que faz `when: {}` atingir tudo.
 */
export function matchesPathMatcher(matcher: PathMatcher | undefined, path: string): boolean {
  if (matcher === undefined) return true;
  const codes = decodePath(path);
  const length = Math.min(matcher.length, codes.length);
  for (let i = 0; i < length; i++) {
    const expected = matcher[i];
    if (expected !== null && expected !== codes[i]) return false;
  }
  return true;
}
