/**
 * Hash estável do conteúdo e do plano — docs/12-carga-de-matrizes.md §5.4.
 *
 * FNV-1a de 64 bits, puro e determinístico. Nada de `crypto.subtle`: é Web API,
 * proibida em `src/core/` (docs/02-arquitetura.md §3), e o hash aqui não tem
 * propósito criptográfico — é identidade de conteúdo para detectar "o mesmo
 * arquivo" (RN-20) e "o mesmo plano" (RN-14).
 *
 * A aritmética de 64 bits é feita em quatro limbos de 16 bits com `number`
 * (exato, porque cada produto parcial cabe em 2^53) e só o resultado final vira
 * `bigint`. É a mesma sequência de estados que `BigInt` produziria — e ~6x mais
 * rápida, o que importa quando o plano hasheia 350 KB de arquivo dentro de um
 * orçamento de 1 s.
 */

const OFFSET_BASIS = [0xcbf2, 0x9ce4, 0x8422, 0x2325] as const;
/** 0x100000001b3 em limbos de 16 bits: [0x0000, 0x0100, 0x0000, 0x01b3]. */
const PRIME_LOW = 0x01b3;
const PRIME_HIGH = 0x0100;
const LIMB = 0x10000;
const LIMB_MASK = 0xffff;

/** Estado do hash: `[mais significativo, …, menos significativo]`. */
type Limbs = [number, number, number, number];

/** `h = h * 0x100000001b3 mod 2^64`, limbo a limbo. */
function multiplyByPrime(h: Limbs): void {
  const [a0, a1, a2, a3] = h;
  let r3 = a3 * PRIME_LOW;
  let r2 = a2 * PRIME_LOW;
  let r1 = a1 * PRIME_LOW + a3 * PRIME_HIGH;
  let r0 = a0 * PRIME_LOW + a2 * PRIME_HIGH;

  r2 += Math.floor(r3 / LIMB);
  r3 &= LIMB_MASK;
  r1 += Math.floor(r2 / LIMB);
  r2 &= LIMB_MASK;
  r0 += Math.floor(r1 / LIMB);
  r1 &= LIMB_MASK;
  r0 &= LIMB_MASK;

  h[0] = r0;
  h[1] = r1;
  h[2] = r2;
  h[3] = r3;
}

/**
 * FNV-1a de 64 bits sobre os **bytes** da string: cada unidade de código UTF-16
 * entra pelo byte baixo e, quando passa de 0xFF, também pelo byte alto.
 */
export function fnv1a64(text: string): bigint {
  const h: Limbs = [...OFFSET_BASIS];
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    h[3] ^= unit & 0xff;
    multiplyByPrime(h);
    if (unit > 0xff) {
      h[3] ^= unit >>> 8;
      multiplyByPrime(h);
    }
  }
  return (
    (BigInt(h[0]) << 48n) | (BigInt(h[1]) << 32n) | (BigInt(h[2]) << 16n) | BigInt(h[3])
  );
}

/** O hash em 16 dígitos hexadecimais minúsculos — a forma gravada no plano e no evento. */
export function toHashString(hash: bigint): string {
  return hash.toString(16).padStart(16, '0');
}

/**
 * RN-20: o hash do arquivo é calculado sobre o texto **normalizado** — sem BOM
 * e com quebras de linha em LF —, para que o mesmo conteúdo salvo no Windows e
 * no Linux produza o mesmo hash.
 */
export function normalizeForHash(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n?/g, '\n');
}

/** Hash do texto do arquivo, já normalizado (RN-20). */
export function hashText(text: string): string {
  return toHashString(fnv1a64(normalizeForHash(text)));
}

/**
 * Serialização canônica de um valor qualquer: chaves de objeto em ordem
 * alfabética, `undefined` omitido. Duas execuções do mesmo perfil produzem a
 * mesma string independentemente da ordem em que os campos foram escritos.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(',')}}`;
}

/** Hash de qualquer estrutura, pela serialização canônica. */
export function hashValue(value: unknown): string {
  return toHashString(fnv1a64(stableStringify(value)));
}
