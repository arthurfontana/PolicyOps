import type { TimelineSegment } from '@/core/queries';
import { formatDateBR } from '@/lib/format';

/**
 * Faixa de linha do tempo por matriz — docs/07-ux-e-editor.md §10: um
 * segmento por versão publicada, largura proporcional à duração, cor por
 * estado, marcador na data selecionada. Clicar num segmento navega para
 * aquela versão.
 */

const SEGMENT_COLOR = {
  vigente: 'bg-green-500 dark:bg-green-600',
  agendado: 'bg-blue-500 dark:bg-blue-600',
  historico: 'bg-neutral-300 dark:bg-neutral-700',
};

function segmentTone(segment: TimelineSegment, now: Date): keyof typeof SEGMENT_COLOR {
  if (segment.state === 'SUPERSEDED') return 'historico';
  if (new Date(segment.effectiveFrom).getTime() > now.getTime()) return 'agendado';
  return 'vigente';
}

function segmentPeriodLabel(segment: TimelineSegment): string {
  const from = formatDateBR(segment.effectiveFrom);
  const to = segment.effectiveTo === null ? 'hoje' : formatDateBR(segment.effectiveTo);
  return `v${segment.number} · ${from} a ${to}`;
}

export interface MatrixTimelineBarProps {
  segments: TimelineSegment[];
  now: Date;
  selectedAt: Date;
  onSelectVersion: (versionId: string) => void;
}

/** Peso mínimo de largura para um segmento não desaparecer visualmente numa faixa longa. */
const MIN_SEGMENT_PERCENT = 2;

export function MatrixTimelineBar({ segments, now, selectedAt, onSelectVersion }: MatrixTimelineBarProps) {
  if (segments.length === 0) {
    return <p className="text-xs text-neutral-400 dark:text-neutral-500">Nenhuma versão publicada ainda.</p>;
  }

  const domainStart = new Date(segments[0]!.effectiveFrom).getTime();
  const domainEnd = Math.max(
    now.getTime(),
    ...segments.map((segment) =>
      segment.effectiveTo !== null ? new Date(segment.effectiveTo).getTime() : new Date(segment.effectiveFrom).getTime(),
    ),
  );
  const domainLength = Math.max(domainEnd - domainStart, 1);
  const markerPercent = Math.min(
    100,
    Math.max(0, ((selectedAt.getTime() - domainStart) / domainLength) * 100),
  );

  return (
    <div className="relative py-1.5" data-testid="matrix-timeline">
      <div
        role="list"
        aria-label="Linha do tempo de versões"
        className="flex h-3 w-full overflow-hidden rounded-full border border-neutral-200 dark:border-neutral-800"
      >
        {segments.map((segment) => {
          const start = new Date(segment.effectiveFrom).getTime();
          const end = segment.effectiveTo !== null ? new Date(segment.effectiveTo).getTime() : domainEnd;
          const widthPercent = Math.max(((end - start) / domainLength) * 100, MIN_SEGMENT_PERCENT);
          const tone = segmentTone(segment, now);
          return (
            <button
              key={segment.versionId}
              type="button"
              role="listitem"
              data-testid={`timeline-segment-v${segment.number}`}
              title={segmentPeriodLabel(segment)}
              aria-label={`Versão ${segment.number}, vigente de ${formatDateBR(segment.effectiveFrom)} a ${segment.effectiveTo === null ? 'hoje' : formatDateBR(segment.effectiveTo)}`}
              onClick={() => onSelectVersion(segment.versionId)}
              className={`h-full shrink-0 border-r border-white/60 transition-opacity last:border-r-0 hover:opacity-80 dark:border-neutral-950/60 ${SEGMENT_COLOR[tone]}`}
              style={{ width: `${widthPercent}%` }}
            />
          );
        })}
      </div>
      <div
        aria-hidden
        data-testid="timeline-marker"
        className="absolute top-0 h-3 w-0.5 -translate-x-1/2 bg-neutral-900 dark:bg-neutral-100"
        style={{ left: `${markerPercent}%` }}
      />
    </div>
  );
}
