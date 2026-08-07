import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { StaleAxisEntry } from '@/core/reconcile/stale';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/**
 * "Rascunhos que podem adotar esta versão" — docs/prompts/S16, item 4.
 *
 * Complementa a lista de **uso** (quem pina esta variável ou esta regra) com a
 * lista de **adoção**: os rascunhos em que a novidade ainda não entrou, cada um
 * com link direto para o próprio diálogo de reconciliação.
 *
 * **Nada em lote.** Não há botão "atualizar todas": a adoção é sempre matriz a
 * matriz, por decisão de produto (§5.4). Cada uma cria e destrói combinações de
 * um jeito diferente, e quem decide o que fazer com as células novas é o
 * usuário, olhando aquele grid.
 */

const ROLE_LABEL: Record<'X' | 'Y', string> = { X: 'eixo X', Y: 'eixo Y' };

export interface AdoptionListProps {
  entries: StaleAxisEntry[];
  /** Frase mostrada quando não há nenhum rascunho a adotar. */
  emptyText: string;
}

export function AdoptionList({ entries, emptyText }: AdoptionListProps) {
  const openMatrix = useEditorStore((s) => s.openMatrix);
  const requestResnapshot = useEditorStore((s) => s.requestResnapshot);
  const setView = useUiStore((s) => s.setView);

  if (entries.length === 0) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">{emptyText}</p>;
  }

  return (
    <ul className="flex flex-col gap-1.5" data-testid="adoption-list">
      {entries.map((entry) => (
        <li
          key={`${entry.versionId}-${entry.role}`}
          className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/20"
        >
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            {entry.matrixCode}
          </span>
          <Badge variant="amber">
            v{entry.versionNumber} · {ROLE_LABEL[entry.role]}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-neutral-600 dark:text-neutral-400">
            {entry.staleness.reasons.map((reason) => reason.message).join(' ')}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={() => {
              requestResnapshot({ versionId: entry.versionId, role: entry.role });
              openMatrix(entry.matrixId, entry.versionId);
              setView('matrix');
            }}
          >
            <RefreshCw className="mr-1 h-3 w-3" /> Reconciliar
          </Button>
        </li>
      ))}
    </ul>
  );
}
