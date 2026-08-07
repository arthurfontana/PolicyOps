import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import {
  AddLevelDialog,
  RemoveLevelDialog,
  ReorderLevelsDialog,
} from '@/components/editor/AxisLevelDialogs';
import { ResnapshotDialog } from '@/components/editor/ResnapshotDialog';
import { StaleBadges } from '@/components/editor/StaleBadges';
import { readableTuple } from '@/lib/axis-labels';
import type { OnCollapse, OnExistingContent } from '@/core/axes/levels';
import type { AxisRole } from '@/core/document/schema';
import { MAX_AXIS_LEVELS } from '@/core/axes/tuples';
import { getErrorMessage } from '@/core/error-messages';
import type { EditorView } from '@/core/queries';
import { reasonsForLevel, reasonsForRules, type AxisStaleness } from '@/core/reconcile/stale';
import {
  addLevelCommand,
  previewReorderLevelsOn,
  removeLevelCommand,
  reorderLevelsCommand,
  resnapshotAxisCommand,
  restoreTuplesCommand,
} from '@/core/versioning/axis-commands';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

/**
 * Construtor de eixos editável no inspector — docs/07-ux-e-editor.md §7 e §8,
 * e o badge de defasagem de docs/05 §5.2.
 *
 * Toda alteração passa por um diálogo de preview antes de virar comando. A
 * única exceção é a reordenação que **não** muda o conjunto de tuplas: aí não
 * há o que prever — nenhuma célula se move — e o toast avisa que só a ordem
 * visual mudou.
 */

const ROLE_LABEL: Record<AxisRole, string> = { X: 'Eixo X (colunas)', Y: 'Eixo Y (linhas)' };

/** Acima disso, a supressão manual virou padrão e merece uma regra na biblioteca (§5.4). */
const SUPPRESSION_HINT_THRESHOLD = 3;

export interface AxisEditorProps {
  role: AxisRole;
  view: EditorView;
  /** `null` fora de rascunho: em versão publicada o badge não aparece (§5.2). */
  staleness: AxisStaleness | null;
}

export function AxisEditor({ role, view, staleness }: AxisEditorProps) {
  const doc = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const selectCoords = useEditorStore((s) => s.selectCoords);
  const pendingResnapshot = useEditorStore((s) => s.pendingResnapshot);
  const requestResnapshot = useEditorStore((s) => s.requestResnapshot);
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const [reorder, setReorder] = useState<{ from: number; to: number } | null>(null);
  const [resnapshotOpen, setResnapshotOpen] = useState(false);

  // Link direto da tela de impacto das bibliotecas: abrir a matriz já com o
  // diálogo de reconciliação do eixo certo (docs/prompts/S16, item 4).
  const stale = staleness?.stale ?? false;
  const requested =
    pendingResnapshot !== null &&
    pendingResnapshot.versionId === view.version.id &&
    pendingResnapshot.role === role;
  useEffect(() => {
    if (!requested) return;
    if (stale) setResnapshotOpen(true);
    requestResnapshot(null);
  }, [requested, stale, requestResnapshot]);

  if (doc === null) return null;

  const versionId = view.version.id;
  const axisView = role === 'X' ? view.x : view.y;
  const otherView = role === 'X' ? view.y : view.x;
  const levels = axisView.axis.levels;
  const editable = view.editable;
  const suppressed = axisView.axis.manualSuppressions ?? [];

  function fail(code: string, message: string) {
    toast({ variant: 'destructive', title: 'Não foi possível aplicar', description: message || code });
  }

  /** Aplica, avisa, e seleciona as combinações novas (docs/prompts/S12, item 4). */
  function run(
    command: Parameters<typeof dispatch>[0],
    describe: (data: { newTuples: string[]; pendingCells: number }) => string,
  ) {
    const result = dispatch(command);
    if (!result.ok) {
      fail(result.error.code, result.error.message || getErrorMessage(result.error.code));
      return;
    }
    const data = result.data as { newTuples: string[]; pendingCells: number };
    const coords = data.newTuples.flatMap((tuple) =>
      otherView.axis.tuples.map((otherPath) =>
        role === 'X' ? { xPath: tuple, yPath: otherPath } : { xPath: otherPath, yPath: tuple },
      ),
    );
    if (coords.length > 0) selectCoords(coords);
    toast({ title: 'Eixo atualizado', description: describe(data) });
  }

  function applyAdd(input: { variableId: string; position: number; onExisting: OnExistingContent }) {
    setAddOpen(false);
    run(
      addLevelCommand({ versionId, role, ...input }),
      (data) =>
        `${data.newTuples.length} combinações novas neste eixo. ` +
        (data.pendingCells === 0
          ? 'Nenhuma combinação ficou pendente.'
          : `${data.pendingCells} combinações precisam ser preenchidas.`),
    );
  }

  function applyRemove(input: { levelIndex: number; onCollapse: OnCollapse }) {
    setRemoveIndex(null);
    run(
      removeLevelCommand({ versionId, role, ...input }),
      (data) =>
        data.pendingCells === 0
          ? 'Nível removido sem deixar pendências.'
          : `Nível removido; ${data.pendingCells} combinações precisam ser preenchidas.`,
    );
  }

  /** Sem mudança de conjunto aplica direto; com mudança, abre o preview (§5.3). */
  function tryReorder(from: number, to: number) {
    if (from === to || to < 0 || to >= levels.length) return;
    try {
      const { preview } = previewReorderLevelsOn(doc!, { versionId, role, from, to });
      if (preview.tuplesChanged) {
        setReorder({ from, to });
        return;
      }
    } catch {
      // O preview falhou (configuração impossível): o diálogo mostra o motivo.
      setReorder({ from, to });
      return;
    }
    const result = dispatch(reorderLevelsCommand({ versionId, role, from, to }));
    if (!result.ok) {
      fail(result.error.code, result.error.message);
      return;
    }
    toast({
      title: 'Níveis reordenados',
      description: 'Nenhuma célula mudou de valor — só a ordem visual do eixo.',
    });
  }

  function applyReorderConfirmed() {
    if (reorder === null) return;
    const { from, to } = reorder;
    setReorder(null);
    run(reorderLevelsCommand({ versionId, role, from, to, confirm: true }), (data) =>
      data.pendingCells === 0
        ? 'Níveis reordenados.'
        : `Níveis reordenados; ${data.pendingCells} combinações precisam ser preenchidas.`,
    );
  }

  /** Adoção da evolução da biblioteca — docs/05 §5.4. */
  function applyResnapshot() {
    setResnapshotOpen(false);
    run(
      resnapshotAxisCommand({ versionId, role }),
      (data) =>
        (data.newTuples.length === 0
          ? 'Eixo atualizado para as versões mais recentes da biblioteca. '
          : `${data.newTuples.length} combinações novas neste eixo. `) +
        (data.pendingCells === 0
          ? 'Nenhuma combinação ficou pendente.'
          : `${data.pendingCells} combinações precisam ser preenchidas.`),
    );
  }

  function restore(path: string) {
    const result = dispatch(restoreTuplesCommand({ versionId, role, paths: [path] }));
    if (!result.ok) {
      fail(result.error.code, result.error.message);
      return;
    }
    toast({ title: 'Combinação restaurada', description: readableTuple(levels, path) });
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          {ROLE_LABEL[role]}
        </span>
        {stale && <Badge variant="amber">defasado</Badge>}
      </div>

      <ul className="flex flex-col gap-1">
        {levels.map((level, index) => (
          <li
            key={level.id}
            className="flex flex-col gap-0.5 rounded-md border border-neutral-200 px-1.5 py-1 text-xs dark:border-neutral-800"
          >
            <div className="flex items-center gap-1">
              <span className="flex-1 truncate">
                <span className="text-neutral-500 dark:text-neutral-400">Nível {index}: </span>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">{level.label}</span>
                <span className="ml-1 text-neutral-400">{level.domains.length} domínios</span>
              </span>
              {editable && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Mover "${level.label}" para fora`}
                    disabled={index === 0}
                    onClick={() => tryReorder(index, index - 1)}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Mover "${level.label}" para dentro`}
                    disabled={index === levels.length - 1}
                    onClick={() => tryReorder(index, index + 1)}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover o nível "${level.label}"`}
                    disabled={levels.length === 1}
                    onClick={() => setRemoveIndex(index)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
            {staleness !== null && (
              <div className="flex flex-wrap gap-1">
                <StaleBadges
                  reasons={reasonsForLevel(staleness, index)}
                  labelOf={() => level.label}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      {staleness !== null && reasonsForRules(staleness).length > 0 && (
        <div className="flex flex-wrap gap-1">
          <StaleBadges
            reasons={reasonsForRules(staleness)}
            labelOf={(reason) => `Regra ${reason.ruleName ?? reason.ruleCode ?? ''}`}
          />
        </div>
      )}

      {editable && stale && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid={`resnapshot-${role}`}
          onClick={() => setResnapshotOpen(true)}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar para as versões mais recentes
        </Button>
      )}

      <p className="text-xs text-neutral-500 dark:text-neutral-400">{axisView.tupleCount} tuplas</p>

      {editable && levels.length < MAX_AXIS_LEVELS && (
        <Button type="button" variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar nível
        </Button>
      )}

      {suppressed.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-neutral-100 pt-1.5 dark:border-neutral-800">
          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
            {suppressed.length === 1
              ? '1 combinação suprimida'
              : `${suppressed.length} combinações suprimidas`}
          </span>
          <ul className="flex flex-col gap-0.5">
            {suppressed.map((path) => (
              <li key={path} className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                <span className="flex-1 truncate line-through">{readableTuple(levels, path)}</span>
                {editable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Restaurar ${readableTuple(levels, path)}`}
                    onClick={() => restore(path)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {suppressed.length >= SUPPRESSION_HINT_THRESHOLD && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Esse padrão se repete: talvez valha criar uma regra de compatibilidade na biblioteca em vez de suprimir
              combinação a combinação.
            </p>
          )}
        </div>
      )}

      {addOpen && (
        <AddLevelDialog
          open
          onOpenChange={setAddOpen}
          doc={doc}
          versionId={versionId}
          role={role}
          levels={levels}
          otherTuples={otherView.axis.tuples}
          excludedVariableIds={[
            ...view.x.axis.levels.map((level) => level.variableId),
            ...view.y.axis.levels.map((level) => level.variableId),
          ]}
          onApply={applyAdd}
        />
      )}

      {removeIndex !== null && (
        <RemoveLevelDialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoveIndex(null);
          }}
          doc={doc}
          versionId={versionId}
          role={role}
          levels={levels}
          otherTuples={otherView.axis.tuples}
          levelIndex={removeIndex}
          onApply={applyRemove}
        />
      )}

      {resnapshotOpen && stale && (
        <ResnapshotDialog
          open
          onOpenChange={setResnapshotOpen}
          doc={doc}
          versionId={versionId}
          role={role}
          levels={levels}
          otherTuples={otherView.axis.tuples}
          onApply={applyResnapshot}
        />
      )}

      {reorder !== null && (
        <ReorderLevelsDialog
          open
          onOpenChange={(open) => {
            if (!open) setReorder(null);
          }}
          doc={doc}
          versionId={versionId}
          role={role}
          levels={levels}
          otherTuples={otherView.axis.tuples}
          from={reorder.from}
          to={reorder.to}
          onApply={applyReorderConfirmed}
        />
      )}
    </div>
  );
}
