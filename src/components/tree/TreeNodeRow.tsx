import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  ComponentPropsWithoutRef,
  ComponentType,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * A linha de um nó da árvore da política — docs/07-ux-e-editor.md §17.1, §10.
 *
 * Só apresentação: recuo, chevron, ícone, nome, `code`, badges e um slot final.
 * Existe para a árvore que se edita (barra lateral, `PolicyTree`) e a árvore
 * que só se lê (aba **Estrutura** da tela de Vigência) desenharem o **mesmo**
 * nó — a consulta histórica não redesenha a árvore por conta própria
 * (DEC-UX-004). O que muda entre as duas é o que entra em `badges`/`trailing`
 * e quais gestos o chamador liga na `div`; nada aqui sabe de edição, de
 * fotografia ou de store.
 */
export interface TreeNodeRowProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'ref'> {
  /** 0-based: o recuo é `depth * 16px`, como a árvore sempre desenhou. */
  depth: number;
  icon: ComponentType<{ className?: string }>;
  name: string;
  code?: string;
  /** §17.1: abaixo de 340px de barra lateral o `code` sai da linha. */
  showCode?: boolean;
  selected?: boolean;
  /** Fora do filtro, mas mantido por ser ancestral de quem passou. */
  dimmed?: boolean;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggleExpanded?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  expandTitle?: string;
  collapseTitle?: string;
  /** Substitui o rótulo do nome — o campo de renomear da árvore editável. */
  nameSlot?: ReactNode;
  /** Badges de versão/estado, à direita do nome. */
  badges?: ReactNode;
  /** Fim da linha: o menu `⋯` na árvore editável, nada na consulta. */
  trailing?: ReactNode;
}

export function TreeNodeRow({
  depth,
  icon: Icon,
  name,
  code,
  showCode = false,
  selected = false,
  dimmed = false,
  hasChildren = false,
  expanded = false,
  onToggleExpanded,
  expandTitle,
  collapseTitle,
  nameSlot,
  badges,
  trailing,
  className,
  style,
  ...rest
}: TreeNodeRowProps) {
  return (
    <div
      {...rest}
      style={{ paddingLeft: depth * 16, ...style }}
      className={cn(
        'group flex items-center gap-1.5 rounded-md py-1 pr-1 text-sm outline-none',
        'focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600',
        selected && 'bg-neutral-200 dark:bg-neutral-800',
        !selected && 'hover:bg-neutral-100 dark:hover:bg-neutral-800/60',
        dimmed && 'opacity-40',
        className,
      )}
    >
      {hasChildren && onToggleExpanded !== undefined ? (
        <button
          type="button"
          aria-label={expanded ? `Recolher ${name}` : `Expandir ${name}`}
          title={expanded ? collapseTitle : expandTitle}
          onClick={onToggleExpanded}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}

      <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />

      {nameSlot ?? (
        <span className="min-w-0 flex-1 truncate text-neutral-900 dark:text-neutral-100">{name}</span>
      )}

      {nameSlot === undefined && showCode && code !== undefined && (
        <span className="shrink-0 font-mono text-[10px] text-neutral-400">{code}</span>
      )}

      {badges}
      {trailing}
    </div>
  );
}
