import { Badge } from '@/components/ui/badge';
import type { RichDoc } from '@/core/document/schema';
import { diffRichDoc, type RichDocChangeKind } from '@/core/richdoc/diff';
import { BlockView } from './RichDocView';

/**
 * Diff de especificação lado a lado — docs/07-ux-e-editor.md §18.5.
 *
 * Mesmo vocabulário visual do diff de matriz (§9): à esquerda a base, à
 * direita a comparada, uma linha por mudança e um `Badge` dizendo o que
 * aconteceu. O diff é **por bloco** (docs/14 §7) — não há realce dentro do
 * parágrafo, e é por isso que a linha inteira aparece dos dois lados.
 *
 * Bloco que não mudou fica fora por padrão: numa especificação de trinta
 * parágrafos, mostrar os trinta esconde os três que mudaram.
 */

const KIND_LABEL: Record<RichDocChangeKind, string> = {
  ADDED: 'Novo',
  REMOVED: 'Removido',
  CHANGED: 'Alterado',
  MOVED: 'Movido',
  UNCHANGED: 'Sem mudança',
};

const KIND_VARIANT: Record<RichDocChangeKind, 'blue' | 'amber' | 'secondary'> = {
  ADDED: 'blue',
  REMOVED: 'secondary',
  CHANGED: 'amber',
  MOVED: 'secondary',
  UNCHANGED: 'secondary',
};

export interface RichDocDiffViewProps {
  before: RichDoc | undefined;
  after: RichDoc | undefined;
  beforeLabel: string;
  afterLabel: string;
  /** `true` mostra também os blocos idênticos, na ordem do documento. */
  showUnchanged?: boolean;
}

export function RichDocDiffView({
  before,
  after,
  beforeLabel,
  afterLabel,
  showUnchanged = false,
}: RichDocDiffViewProps) {
  const diff = diffRichDoc(before, after);
  const rows = showUnchanged ? diff.changes : diff.changes.filter((change) => change.kind !== 'UNCHANGED');

  if (rows.length === 0) {
    return (
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {diff.hasChanges ? 'Nenhum bloco a mostrar.' : 'A especificação não mudou.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
        <span>{beforeLabel}</span>
        <span>{afterLabel}</span>
      </div>
      {rows.map((change) => (
        <div key={change.blockId} className="grid grid-cols-2 gap-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
          <div className="min-w-0">
            {change.before === null ? (
              <span className="text-xs text-neutral-400">—</span>
            ) : (
              <BlockView block={change.before} />
            )}
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex justify-end">
              <Badge variant={KIND_VARIANT[change.kind]}>
                {KIND_LABEL[change.kind]}
                {change.moved === true ? ' e movido' : ''}
              </Badge>
            </div>
            {change.after === null ? (
              <span className="text-xs text-neutral-400">—</span>
            ) : (
              <BlockView block={change.after} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
