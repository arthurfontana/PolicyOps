import { useRef } from 'react';
import {
  CalendarClock,
  CheckCheck,
  FileUp,
  Filter,
  GitCompare,
  Grid3x3,
  Plus,
  Search,
  Target,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToolbarSeparator } from '@/components/shell/Toolbar';
import { useToolbarCompact } from '@/hooks/useToolbarCompact';
import { TagFilterBar } from '@/components/projects/TagFilterBar';
import {
  COMPONENT_REVIEW_STATUSES,
  POLICY_COMPONENT_TYPES,
  type ComponentReviewStatus,
  type PolicyComponentType,
} from '@/core/document/schema';
import type { TagFacetGroup } from '@/core/queries';
import { COMPONENT_REVIEW_STATUS_LABELS, COMPONENT_TYPE_LABELS } from '@/lib/component-labels';
import { formatDateInputBR } from '@/lib/timeline-dates';
import { cn } from '@/lib/utils';

/**
 * Barra de ferramentas da tela da política — docs/07-ux-e-editor.md §2.1.
 * Injetada no slot do shell por `ToolbarPortal` (quem monta é a `PolicyTree`,
 * dona do estado de criação e dos diálogos — DEC-UX-006). Quatro grupos, nesta
 * ordem: criação, publicação, busca/filtro e o chip de alvo.
 *
 * Componente de apresentação: nenhum comando é despachado aqui.
 */

export interface PolicyToolbarProps {
  /** Modo fotografia (§20): a barra troca criação por "voltar para hoje". */
  readOnly: boolean;
  snapshotDate: string | null;
  onSnapshotDateChange: (date: string | null) => void;
  onCompareDates: () => void;

  pendingCount: number;
  onNewSection: () => void;
  onNewRule: () => void;
  onAddMatrix: () => void;
  onImportMarkdown: () => void;
  onPublishPending: () => void;

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

  /** Caminho completo do nó selecionado (`Política › CMA › Fraude`) ou `null` para a raiz. */
  targetPath: string | null;
  onFocusTarget: () => void;
}

function ChipButton({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
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

export function PolicyToolbar(props: PolicyToolbarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const compact = useToolbarCompact(rootRef);
  const filterCount = props.types.length + props.reviewStatuses.length + props.tags.length;
  const publishLabel = `Publicar pendentes${props.pendingCount > 0 ? ` (${props.pendingCount})` : ''}`;

  /**
   * §2.1, "cabe numa linha": abaixo de ~1100px os itens de criação além do
   * primeiro colapsam — com os mesmos rótulos, para quem procura pelo nome.
   */
  // O chip cabe em duas pontas do caminho: `… › CMA › Fraude`. O caminho
  // inteiro fica no `title` — truncar pela direita esconderia justamente o nó.
  const targetSegments = props.targetPath === null ? [] : props.targetPath.split(' › ');
  const targetLabel =
    props.targetPath === null
      ? 'raiz da política'
      : targetSegments.length > 2
        ? `… › ${targetSegments.slice(-2).join(' › ')}`
        : props.targetPath;

  const extraCreation = [
    { label: 'Nova regra', icon: Plus, onSelect: props.onNewRule, title: 'Nova regra (Shift+Enter na árvore)' },
    { label: 'Pendurar matriz', icon: Grid3x3, onSelect: props.onAddMatrix, title: 'Pendurar uma matriz existente na árvore' },
    { label: 'Carregar Markdown', icon: FileUp, onSelect: props.onImportMarkdown, title: 'Carregar um recorte da política em Markdown' },
  ];

  return (
    <div ref={rootRef} data-testid="policy-toolbar" className="flex min-w-0 flex-1 items-center gap-1.5">
      {props.readOnly ? (
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="secondary" className="whitespace-nowrap">
            Fotografia de {formatDateInputBR(props.snapshotDate ?? '')} · somente leitura
          </Badge>
          <Button type="button" size="sm" variant="outline" onClick={() => props.onSnapshotDateChange(null)}>
            <X className="mr-1 h-3.5 w-3.5" /> Voltar para hoje
          </Button>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              title="Nova seção (Enter na árvore)"
              onClick={props.onNewSection}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Nova seção
            </Button>

            {compact ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" variant="outline" title="Mais ações de criação">
                    ⋯ Mais
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {extraCreation.map((item) => (
                    <DropdownMenuItem key={item.label} onSelect={item.onSelect}>
                      <item.icon className="mr-2 h-3.5 w-3.5" /> {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              extraCreation.map((item) => (
                <Button
                  key={item.label}
                  type="button"
                  size="sm"
                  variant="outline"
                  title={item.title}
                  onClick={item.onSelect}
                >
                  <item.icon className="mr-1 h-3.5 w-3.5" /> {item.label}
                </Button>
              ))
            )}
          </div>

          <ToolbarSeparator />

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={props.pendingCount === 0}
            title={
              props.pendingCount === 0
                ? 'Nenhum componente com rascunho aberto neste projeto'
                : 'Publicar pendentes (Ctrl+Shift+P)'
            }
            onClick={props.onPublishPending}
          >
            <CheckCheck className="mr-1 h-3.5 w-3.5" /> {publishLabel}
          </Button>
        </>
      )}

      <ToolbarSeparator />

      <label
        htmlFor="tree-snapshot-date"
        title="Ver a política como em uma data"
        className="flex shrink-0 items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400"
      >
        <CalendarClock className="h-3.5 w-3.5" />
        {/* Na barra compacta sobra o ícone: o campo ao lado já diz que é data. */}
        {compact ? <span className="sr-only">Ver como em…</span> : 'Ver como em…'}
      </label>
      {/* Contêiner de largura fixa: o `Input` do design system é `w-full`. */}
      <div className="w-32 shrink-0">
        <Input
          id="tree-snapshot-date"
          type="date"
          aria-label="Ver a política como em"
          value={props.snapshotDate ?? ''}
          onChange={(e) => props.onSnapshotDateChange(e.target.value === '' ? null : e.target.value)}
          className="h-7 text-xs"
        />
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 shrink-0"
        aria-label="Comparar datas"
        title="Comparar a política entre duas datas"
        onClick={props.onCompareDates}
      >
        <GitCompare className="h-3.5 w-3.5" />
      </Button>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <div className={cn('relative shrink-0', compact ? 'w-32' : 'w-44 xl:w-56')}>
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <Input
            value={props.search}
            onChange={(e) => props.onSearchChange(e.target.value)}
            placeholder="Buscar na política…"
            className="h-7 pl-7 text-xs"
            aria-label="Buscar na árvore"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="shrink-0">
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

        <button
          type="button"
          onClick={props.onFocusTarget}
          data-testid="policy-toolbar-target"
          title={
            props.targetPath === null
              ? 'Sem nó selecionado: a criação acontece na raiz da política'
              : `Criar irmão de ${props.targetPath} · clique para achar o nó na árvore`
          }
          className="flex w-[10rem] shrink-0 items-center gap-1 rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <Target className="h-3 w-3 shrink-0" />
          <span className="truncate">em: {targetLabel}</span>
        </button>
      </div>
    </div>
  );
}
