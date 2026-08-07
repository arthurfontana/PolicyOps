import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { StaleReason } from '@/core/reconcile/stale';

/**
 * Badges de defasagem — docs/05-regras-de-negocio.md §5.2 e
 * docs/prompts/S16, item 4.
 *
 * Um badge por nível e um por par com regra, **apenas em versões `DRAFT`**.
 * Em publicadas e históricas o badge não aparece: elas são registro, não
 * pendência — quem as renderiza simplesmente não recebe `staleness`.
 *
 * O texto é explícito e cabe no badge: *"Score HVI3 — v1 pinada, v2
 * disponível"*. Nada de "desatualizado" genérico: o usuário precisa saber qual
 * versão ele tem e qual poderia ter, sem abrir diálogo nenhum.
 */

/** "v1 pinada, v2 disponível" — a parte que muda entre os motivos. */
function shortText(reason: StaleReason): string {
  if (reason.kind === 'NEW_RULE_AVAILABLE') {
    return `regra nova, v${reason.availableNumber} disponível`;
  }
  if (reason.pinnedNumber === null) {
    return reason.availableNumber === null
      ? 'versão pinada indisponível'
      : `versão pinada indisponível, v${reason.availableNumber} disponível`;
  }
  return reason.availableNumber === null
    ? `v${reason.pinnedNumber} pinada, sem versão publicada`
    : `v${reason.pinnedNumber} pinada, v${reason.availableNumber} disponível`;
}

export interface StaleBadgesProps {
  reasons: StaleReason[];
  /** Nome exibido antes do traço: o rótulo do nível ou o nome da regra. */
  labelOf: (reason: StaleReason) => string;
}

export function StaleBadges({ reasons, labelOf }: StaleBadgesProps) {
  if (reasons.length === 0) return null;
  return (
    <>
      {reasons.map((reason, index) => (
        <Tooltip key={`${reason.kind}-${reason.ruleId ?? reason.variableId ?? index}`}>
          <TooltipTrigger asChild>
            <Badge
              variant="amber"
              className="max-w-full shrink-0 truncate px-1.5 py-0 text-[10px]"
              data-testid="stale-badge"
            >
              {labelOf(reason)} — {shortText(reason)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{reason.message}</TooltipContent>
        </Tooltip>
      ))}
    </>
  );
}
