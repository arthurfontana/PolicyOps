import { useRef } from 'react';
import { CalendarClock, Filter, GitCompare, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToolbarSeparator } from '@/components/shell/Toolbar';
import { TagFilterBar } from '@/components/projects/TagFilterBar';
import { useToolbarCompact } from '@/hooks/useToolbarCompact';
import {
  COMPONENT_REVIEW_STATUSES,
  POLICY_COMPONENT_TYPES,
  type ComponentReviewStatus,
  type PolicyComponentType,
} from '@/core/document/schema';
import type { TagFacetGroup } from '@/core/queries';
import { COMPONENT_REVIEW_STATUS_LABELS, COMPONENT_TYPE_LABELS } from '@/lib/component-labels';
import { DATE_SHORTCUTS, toDateInputValue } from '@/lib/timeline-dates';
import { cn } from '@/lib/utils';

/**
 * Barra de ferramentas da tela de Vigência — docs/07-ux-e-editor.md §2.1/§10.
 * Injetada no slot do shell por `ToolbarPortal` (quem monta é a própria tela,
 * dona da data e do filtro — DEC-UX-006). Data e atalhos, projeto, busca e
 * `Filtrar (n)` da aba Estrutura, e o salto para a comparação.
 *
 * Componente de apresentação: nenhum comando é despachado aqui.
 */
export interface TimelineToolbarProps {
  date: string;
  onDateChange: (date: string) => void;

  projects: { id: string; name: string }[];
  projectId: string;
  onProjectChange: (projectId: string) => void;

  /** Busca e filtro só existem na aba Estrutura — "só o que a tela faz" (§2.1). */
  showFilters: boolean;
  search: string;
  onSearchChange: (search: string) => void;
  types: PolicyComponentType[];
  onToggleType: (type: PolicyComponentType) => void;
  reviewStatuses: ComponentReviewStatus[];
  onToggleReviewStatus: (status: ComponentReviewStatus) => void;
  facets: TagFacetGroup[];
  tags: string[];
  onToggleTag: (code: string) => void;
  onClearFilters: () => void;

  onCompareDates: () => void;
}

function ChipButton({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
        pressed
          ? 'border-neutral-900 bg-neutral-900 text-neutral-50 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
          : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800',
      )}
    >
      {label}
    </button>
  );
}

export function TimelineToolbar(props: TimelineToolbarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const compact = useToolbarCompact(rootRef);
  const filterCount = props.types.length + props.reviewStatuses.length + props.tags.length;

  return (
    <div ref={rootRef} data-testid="timeline-toolbar" className="flex min-w-0 flex-1 items-center gap-1.5">
      <CalendarClock className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
      {/* Contêiner de largura fixa: o `Input` do design system é `w-full`. */}
      <div className="w-32 shrink-0">
        <Input
          type="date"
          aria-label="Data"
          value={props.date}
          onChange={(event) => props.onDateChange(event.target.value)}
          className="h-7 text-xs"
        />
      </div>

      {/* Os atalhos da §10 ficam todos na linha: são cinco botões curtos, e a
          faixa do shell rola na horizontal quando a janela é estreita — colapsá-los
          num menu esconderia justamente o atalho que se procura pelo nome. */}
      {DATE_SHORTCUTS.map((shortcut) => (
        <Button
          key={shortcut.label}
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={() => props.onDateChange(toDateInputValue(shortcut.resolve()))}
        >
          {shortcut.label}
        </Button>
      ))}

      <ToolbarSeparator />

      <Select value={props.projectId} onValueChange={props.onProjectChange}>
        <SelectTrigger className="h-7 w-44 shrink-0 text-xs" aria-label="Selecionar projeto">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 shrink-0 px-2 text-xs"
        title="Comparar a política entre duas datas"
        onClick={props.onCompareDates}
      >
        <GitCompare className="mr-1 h-3.5 w-3.5" /> Comparar com outra data
      </Button>

      {props.showFilters && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div className={cn('relative shrink-0', compact ? 'w-32' : 'w-44 xl:w-56')}>
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            <Input
              value={props.search}
              onChange={(event) => props.onSearchChange(event.target.value)}
              placeholder="Buscar na política…"
              className="h-7 pl-7 text-xs"
              aria-label="Buscar na estrutura"
            />
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs">
                <Filter className="mr-1 h-3.5 w-3.5" /> Filtrar{filterCount > 0 ? ` (${filterCount})` : ''}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Tipo
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {POLICY_COMPONENT_TYPES.map((type) => (
                      <ChipButton
                        key={type}
                        label={COMPONENT_TYPE_LABELS[type]}
                        pressed={props.types.includes(type)}
                        onClick={() => props.onToggleType(type)}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Revisão
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {COMPONENT_REVIEW_STATUSES.map((status) => (
                      <ChipButton
                        key={status}
                        label={COMPONENT_REVIEW_STATUS_LABELS[status]}
                        pressed={props.reviewStatuses.includes(status)}
                        onClick={() => props.onToggleReviewStatus(status)}
                      />
                    ))}
                  </div>
                </div>

                <TagFilterBar
                  facets={props.facets}
                  selected={props.tags}
                  onToggle={props.onToggleTag}
                  onClear={props.onClearFilters}
                />

                <Button type="button" size="sm" variant="ghost" onClick={props.onClearFilters}>
                  Limpar filtros
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
}
