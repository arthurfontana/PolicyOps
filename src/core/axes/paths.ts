import { CODE_REGEX } from '../document/schema';
import { DomainError } from '../errors';

/**
 * Codificação de caminhos e de chaves de célula — docs/04-eixos-aninhados.md §2.
 *
 * A codificação é injetiva **sem escape** porque `code` casa `^[A-Z0-9_]+$`
 * (docs/03-modelo-do-documento.md §1) e portanto nunca contém `|` nem `:`.
 * `encodePath` revalida cada código: se essa garantia se perder na criação do
 * domínio, o erro aparece aqui e não como caminho ambíguo dentro do grid.
 */

export const LEVEL_SEP = '|';
export const AXIS_SEP = '::';

/** `['VAREJO','500K_1M']` → `'VAREJO|500K_1M'`. */
export function encodePath(codes: string[]): string {
  if (codes.length === 0) {
    throw new DomainError('INVALID_INPUT', 'Um caminho precisa de pelo menos um código.');
  }
  for (const code of codes) {
    if (!CODE_REGEX.test(code)) {
      throw new DomainError(
        'INVALID_INPUT',
        `Código inválido em caminho: "${code}". Um código casa ^[A-Z0-9_]+$ e nunca contém "${LEVEL_SEP}" nem ":".`,
        { code },
      );
    }
  }
  return codes.join(LEVEL_SEP);
}

/** `'VAREJO|500K_1M'` → `['VAREJO','500K_1M']`. */
export function decodePath(path: string): string[] {
  if (path.length === 0) {
    throw new DomainError('INVALID_INPUT', 'Caminho vazio não é um caminho válido.');
  }
  return path.split(LEVEL_SEP);
}

/** Quantidade de níveis de um caminho. */
export function pathDepth(path: string): number {
  return decodePath(path).length;
}

export function encodeCellKey(xPath: string, yPath: string): string {
  return `${xPath}${AXIS_SEP}${yPath}`;
}

export function decodeCellKey(key: string): { xPath: string; yPath: string } {
  const at = key.indexOf(AXIS_SEP);
  if (at < 0) {
    throw new DomainError(
      'INVALID_INPUT',
      `Chave de célula inválida: "${key}". O formato é "\${xPath}${AXIS_SEP}\${yPath}".`,
      { key },
    );
  }
  return { xPath: key.slice(0, at), yPath: key.slice(at + AXIS_SEP.length) };
}

/**
 * Prefixo do caminho até `levels` níveis — é a chave de seleção de um
 * cabeçalho (§4). `levels` maior que a profundidade devolve o caminho inteiro.
 */
export function pathPrefix(path: string, levels: number): string {
  if (levels < 1) {
    throw new DomainError('INVALID_INPUT', 'Um prefixo de caminho tem pelo menos 1 nível.', {
      levels,
    });
  }
  return decodePath(path).slice(0, levels).join(LEVEL_SEP);
}

/**
 * Um caminho é descendente do próprio prefixo — clicar no cabeçalho de último
 * nível seleciona exatamente a tupla dele (§7).
 */
export function isDescendantOf(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + LEVEL_SEP);
}
