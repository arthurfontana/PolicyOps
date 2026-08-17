import { GitCompare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RichDocDiffView } from '@/components/richdoc/RichDocDiffView';
import { diffComponentPayloads, type PayloadFieldChangeKind } from '@/core/diff/component-payload';
import type {
  ChangeRequestItem,
  ComponentVersion,
  MatrixVersion,
  PolicyComponent,
  PolicyOpsDocument,
} from '@/core/document/schema';
import { PAYLOAD_FIELD_LABELS } from '@/lib/component-labels';
import { formatDateBR } from '@/lib/format';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/**
 * "Atual × proposto" rico de um item do DB — docs/07-ux-e-editor.md §19.5,
 * US-GOV-08. Três leituras, uma por natureza de conteúdo:
 *
 * - **payload**: diff campo a campo (`diffComponentPayloads`), com o rótulo em
 *   pt-BR de cada campo e o mesmo vocabulário de badge do diff de matriz;
 * - **especificação**: diff por bloco, o `RichDocDiffView` da S34 (§18.5),
 *   reusado sem alteração;
 * - **matriz**: nada disso — o espelho não tem payload nem `spec`, e a
 *   comparação honesta é a tela de comparação de versões que já existe
 *   (`CompareView`, §9). O botão leva para lá com o par já escolhido.
 *
 * O texto livre "hoje × proposto" (`currentSummary`/`proposedSummary`, S35)
 * continua sendo a **intenção** declarada pelo analista; isto aqui é o
 * conteúdo real que vai entrar em vigor. Os dois convivem: um é a promessa, o
 * outro é o que está no rascunho.
 */

const KIND_LABEL: Record<PayloadFieldChangeKind, string> = {
  ADDED: 'Novo',
  REMOVED: 'Removido',
  CHANGED: 'Alterado',
  UNCHANGED: 'Sem mudança',
};

const KIND_VARIANT: Record<PayloadFieldChangeKind, 'blue' | 'amber' | 'secondary'> = {
  ADDED: 'blue',
  REMOVED: 'secondary',
  CHANGED: 'amber',
  UNCHANGED: 'secondary',
};

export interface ChangeRequestItemDiffProps {
  document: PolicyOpsDocument;
  component: PolicyComponent;
  item: ChangeRequestItem;
}

export function ChangeRequestItemDiff({ document, component, item }: ChangeRequestItemDiffProps) {
  const openMatrix = useEditorStore((s) => s.openMatrix);
  const setCompareVersions = useEditorStore((s) => s.setCompareVersions);
  const setView = useUiStore((s) => s.setView);

  if (item.draftVersionId === undefined) {
    return (
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Sem rascunho vinculado: o comparativo mostra só o texto do &quot;hoje&quot; e do
        &quot;proposto&quot; acima.
      </p>
    );
  }

  if (component.type === 'MATRIX') {
    const matrix = document.matrices.find((candidate) => candidate.id === component.matrixId);
    if (matrix === undefined) return null;
    const draft = matrix.versions.find((version) => version.id === item.draftVersionId);
    const base = resolveBase<MatrixVersion>(matrix.versions, item.baseVersionId);
    if (draft === undefined) return null;

    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {base === undefined
            ? `Matriz "${matrix.code}": a versão ${draft.number} é a primeira a entrar em vigor.`
            : `Matriz "${matrix.code}": versão ${base.number} (vigente) × versão ${draft.number} (proposta).`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (base !== undefined) setCompareVersions(base.id, draft.id);
              openMatrix(matrix.id, draft.id);
              setView(base === undefined ? 'matrix' : 'compare');
            }}
          >
            <GitCompare className="mr-1.5 h-3.5 w-3.5" />
            {base === undefined ? 'Abrir a matriz proposta' : 'Comparar as duas versões'}
          </Button>
        </div>
      </div>
    );
  }

  const draft = component.versions.find((version) => version.id === item.draftVersionId);
  const base = resolveBase<ComponentVersion>(component.versions, item.baseVersionId);
  if (draft === undefined) return null;

  const diff = diffComponentPayloads(base?.payload, draft.payload);
  const changes = diff.changes.filter((change) => change.kind !== 'UNCHANGED');
  const beforeLabel = base === undefined ? 'Não existe hoje' : `Versão ${base.number} (vigente)`;
  const afterLabel = `Versão ${draft.number} (proposta)`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          Conteúdo — campo a campo
        </p>
        {!diff.comparable && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            O tipo de conteúdo mudou entre as duas versões: os campos são listados lado a lado, sem
            correspondência garantida.
          </p>
        )}
        {changes.length === 0 ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Nenhum campo mudou — a proposta está só na especificação ou no texto do item.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
              <span>{beforeLabel}</span>
              <span>{afterLabel}</span>
            </div>
            {changes.map((change) => (
              <div
                key={change.field}
                className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    {PAYLOAD_FIELD_LABELS[change.field] ?? change.field}
                  </span>
                  <Badge variant={KIND_VARIANT[change.kind]}>{KIND_LABEL[change.kind]}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="whitespace-pre-wrap break-words text-neutral-500 dark:text-neutral-400">
                    {change.before ?? '—'}
                  </span>
                  <span className="whitespace-pre-wrap break-words text-neutral-900 dark:text-neutral-100">
                    {change.after ?? '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          Especificação — bloco a bloco
        </p>
        <RichDocDiffView
          before={base?.spec}
          after={draft.spec}
          beforeLabel={beforeLabel}
          afterLabel={afterLabel}
        />
      </div>

      {base?.effectiveFrom !== undefined && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          A versão {base.number} vigora desde {formatDateBR(base.effectiveFrom)}.
        </p>
      )}
    </div>
  );
}

/**
 * A base do comparativo: a versão que o item declarou (`baseVersionId`) ou,
 * na falta dela, a vigente. Não é detalhe — comparar contra a vigente quando o
 * item aponta outra esconderia exatamente o que `E-GOV-02` denuncia.
 */
function resolveBase<T extends { id: string; state: string }>(
  versions: readonly T[],
  baseVersionId: string | undefined,
): T | undefined {
  if (baseVersionId !== undefined) {
    const declared = versions.find((version) => version.id === baseVersionId);
    if (declared !== undefined) return declared;
  }
  return versions.find((version) => version.state === 'PUBLISHED');
}
