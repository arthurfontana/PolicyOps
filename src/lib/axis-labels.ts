import { decodePath } from '@/core/axes/paths';
import type { AxisLevel } from '@/core/document/schema';

/** "VAREJO|ATE_100K" → "Varejo › Até R$ 100 mil", com os rótulos dos domínios. */
export function readableTuple(levels: AxisLevel[], path: string): string {
  return decodePath(path)
    .map((code, index) => levels[index]?.domains.find((domain) => domain.code === code)?.label ?? code)
    .join(' › ');
}
