import { useState } from 'react';
import { ArrowUpDown, FilePlus, ListTree, ShieldCheck, SquarePen, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { DocEvent, DocEventType } from '@/core/document/schema';
import { formatDateTimeBR, formatRelativeTime } from '@/lib/format';

/**
 * A trilha do DB é sempre um dos cinco tipos `CR_*` (DEC-GOV-019,
 * `src/core/document/change-requests.ts`) — nenhum outro `DocEventType`
 * chega a `ChangeRequest.events`.
 */
const EVENT_ICONS: Record<'CR_CREATED' | 'CR_UPDATED' | 'CR_ITEM_CHANGED' | 'CR_TRANSITIONED' | 'CR_DECIDED', LucideIcon> = {
  CR_CREATED: FilePlus,
  CR_UPDATED: SquarePen,
  CR_ITEM_CHANGED: ListTree,
  CR_TRANSITIONED: ArrowUpDown,
  CR_DECIDED: ShieldCheck,
};

function iconFor(type: DocEventType): LucideIcon {
  return type in EVENT_ICONS ? EVENT_ICONS[type as keyof typeof EVENT_ICONS] : SquarePen;
}

function EventRow({ event }: { event: DocEvent }) {
  const Icon = iconFor(event.type);
  const [payloadOpen, setPayloadOpen] = useState(false);

  return (
    <li className="flex flex-col gap-1 border-b border-neutral-100 py-2 last:border-b-0 dark:border-neutral-800">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-neutral-700 dark:text-neutral-300">{event.summary}</p>
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
            {event.actor} ·{' '}
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{formatRelativeTime(event.at)}</span>
              </TooltipTrigger>
              <TooltipContent>{formatDateTimeBR(event.at)}</TooltipContent>
            </Tooltip>
          </p>
        </div>
        {event.payload !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-[11px]"
            onClick={() => setPayloadOpen((current) => !current)}
          >
            {payloadOpen ? 'ocultar dados' : 'ver dados'}
          </Button>
        )}
      </div>
      {payloadOpen && event.payload !== undefined && (
        <pre className="ml-5 overflow-x-auto rounded-md bg-neutral-50 p-2 text-[10px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </li>
  );
}

/** Trilha do DB (US-GOV-03/04) — `ChangeRequest.events`, mais recente primeiro. */
export function ChangeRequestEventLog({ events }: { events: DocEvent[] }) {
  const ordered = [...events].reverse();
  if (ordered.length === 0) {
    return <p className="text-xs text-neutral-400 dark:text-neutral-500">Nenhum evento ainda.</p>;
  }
  return (
    <ul className="max-h-64 overflow-y-auto">
      {ordered.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
    </ul>
  );
}
