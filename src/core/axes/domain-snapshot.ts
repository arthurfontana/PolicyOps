import type { Domain } from '../document/schema';

/**
 * Cópia congelada de domínios para `AxisLevel.domains` — só os campos de
 * **identidade** (`code`, `label`, `shortLabel`, `position`, `color`,
 * `isCatchAll`, `rangeMin`/`rangeMax` quando existirem), nunca
 * `regionalRanges` (docs/03-modelo-do-documento.md §6.1).
 *
 * É o mecanismo que garante, no schema, que a matriz nunca carrega a
 * dimensão regional de uma variável RANGE: o snapshot de uma variável com 20
 * faixas × 9 regionais tem o mesmo tamanho que teria sem regional nenhum.
 * Usado por `matrix/create`, `axis/addLevel`, `axis/resnapshot` e
 * `template/instantiate` (via `resolveTemplateAxes`) — os quatro pontos que
 * copiam domínios da biblioteca de variáveis para dentro de uma matriz.
 */
export function snapshotDomains(domains: Domain[]): Domain[] {
  return domains.map((domain) => {
    const snapshot: Domain = {
      code: domain.code,
      label: domain.label,
      position: domain.position,
    };
    if (domain.shortLabel !== undefined) snapshot.shortLabel = domain.shortLabel;
    if (domain.color !== undefined) snapshot.color = domain.color;
    if (domain.rangeMin !== undefined) snapshot.rangeMin = domain.rangeMin;
    if (domain.rangeMax !== undefined) snapshot.rangeMax = domain.rangeMax;
    if (domain.minInclusive !== undefined) snapshot.minInclusive = domain.minInclusive;
    if (domain.maxInclusive !== undefined) snapshot.maxInclusive = domain.maxInclusive;
    if (domain.isCatchAll !== undefined) snapshot.isCatchAll = domain.isCatchAll;
    return snapshot;
  });
}
