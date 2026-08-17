import { useEffect, useState } from 'react';
import { Link2, Link2Off, PencilLine, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ChangeRequestItemDiff } from '@/components/change-requests/ChangeRequestItemDiff';
import { UnlinkDraftDialog } from '@/components/change-requests/UnlinkDraftDialog';
import {
  removeChangeRequestItem,
  updateChangeRequestItem,
} from '@/core/document/change-requests';
import { linkChangeRequestDraft } from '@/core/document/cr-drafts';
import { PAYLOAD_KIND_BY_COMPONENT_TYPE } from '@/core/document/schema';
import type {
  ChangeRequest,
  ChangeRequestChangeType,
  ChangeRequestItem,
  ComponentPayload,
  PolicyOpsDocument,
} from '@/core/document/schema';
import { componentPath } from '@/core/queries';
import { CHANGE_TYPE_LABELS } from '@/lib/change-request-labels';
import { COMPONENT_TYPE_ICONS } from '@/lib/component-labels';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';
import { useToast } from '@/components/ui/use-toast';

const CHANGE_TYPES: readonly ChangeRequestChangeType[] = [
  'UPDATE',
  'CREATE',
  'DEACTIVATE',
  'REACTIVATE',
  'MOVE',
  'DOC_ONLY',
];

export interface ChangeRequestItemRowProps {
  document: PolicyOpsDocument;
  changeRequest: ChangeRequest;
  item: ChangeRequestItem;
  editable: boolean;
}

/**
 * Uma linha de item do DB (US-GOV-03): componente, tipo de alteração, "hoje" ×
 * "proposto" e — desde a S36 — o **rascunho vinculado**: criar/apontar,
 * desvincular, abrir para editar, e o comparativo rico do que ele propõe
 * (`ChangeRequestItemDiff`, docs/07 §19.5).
 */
export function ChangeRequestItemRow({ document, changeRequest, item, editable }: ChangeRequestItemRowProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const setSelectedComponent = useEditorStore((s) => s.setSelectedComponent);
  const setSelectedProject = useEditorStore((s) => s.setSelectedProject);
  const openMatrix = useEditorStore((s) => s.openMatrix);
  const setView = useUiStore((s) => s.setView);
  const { toast } = useToast();

  const [current, setCurrent] = useState(item.currentSummary ?? '');
  const [proposed, setProposed] = useState(item.proposedSummary);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  useEffect(() => setCurrent(item.currentSummary ?? ''), [item.currentSummary]);
  useEffect(() => setProposed(item.proposedSummary), [item.proposedSummary]);

  const component = document.components.find((candidate) => candidate.id === item.componentId);
  if (component === undefined) return null;
  const Icon = COMPONENT_TYPE_ICONS[component.type];
  const path = componentPath(document, component.id);
  const breadcrumb = path.slice(0, -1).map((ancestor) => ancestor.name).join(' › ');
  const hasDraft = item.draftVersionId !== undefined;

  function commitCurrent() {
    if (current === (item.currentSummary ?? '')) return;
    const result = dispatch(
      updateChangeRequestItem({
        changeRequestId: changeRequest.id,
        componentId: item.componentId,
        currentSummary: current.trim() === '' ? null : current,
      }),
    );
    if (!result.ok) {
      setCurrent(item.currentSummary ?? '');
      toast({ title: 'Não foi possível salvar o "hoje"', description: result.error.message });
    }
  }

  function commitProposed() {
    const trimmed = proposed.trim();
    if (trimmed === '') {
      setProposed(item.proposedSummary);
      return;
    }
    if (trimmed === item.proposedSummary) return;
    const result = dispatch(
      updateChangeRequestItem({
        changeRequestId: changeRequest.id,
        componentId: item.componentId,
        proposedSummary: trimmed,
      }),
    );
    if (!result.ok) {
      setProposed(item.proposedSummary);
      toast({ title: 'Não foi possível salvar o "proposto"', description: result.error.message });
    }
  }

  function handleChangeTypeChange(changeType: ChangeRequestChangeType) {
    const result = dispatch(
      updateChangeRequestItem({ changeRequestId: changeRequest.id, componentId: item.componentId, changeType }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível trocar o tipo de alteração', description: result.error.message });
    }
  }

  function handleRemove() {
    const result = dispatch(removeChangeRequestItem({ changeRequestId: changeRequest.id, componentId: item.componentId }));
    if (!result.ok) {
      toast({ title: 'Não foi possível remover o item', description: result.error.message });
    }
  }

  function handleLinkDraft() {
    if (component === undefined) return;
    // Primeira versão de um componente sem histórico: o rascunho precisa de
    // conteúdo para nascer (`NO_VERSION_TO_DERIVE`), e o texto do "proposto" é
    // o que o analista já escreveu — editável depois, no inspector.
    const semVersao = component.type !== 'MATRIX' && component.versions.length === 0;
    const payload: ComponentPayload | undefined =
      semVersao && component.type !== 'MATRIX'
        ? ({
            kind: PAYLOAD_KIND_BY_COMPONENT_TYPE[component.type],
            businessDescription: item.proposedSummary,
          } as ComponentPayload)
        : undefined;
    const result = dispatch(
      linkChangeRequestDraft({
        changeRequestId: changeRequest.id,
        componentId: item.componentId,
        ...(payload === undefined ? {} : { payload }),
      }),
    );
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível vincular o rascunho',
        description: result.error.message,
      });
      return;
    }
    setDiffOpen(true);
  }

  /** Abre o rascunho onde ele se edita: a árvore, ou o grid da matriz. */
  function handleOpenDraft() {
    if (component === undefined || item.draftVersionId === undefined) return;
    if (component.type === 'MATRIX' && component.matrixId !== undefined) {
      openMatrix(component.matrixId, item.draftVersionId);
      setView('matrix');
      return;
    }
    setSelectedProject(component.projectId);
    setSelectedComponent(component.id);
    setView('projects');
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">{component.name}</span>
              <span className="shrink-0 font-mono text-xs text-neutral-400">{component.code}</span>
            </div>
            {breadcrumb.length > 0 && (
              <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">{breadcrumb}</p>
            )}
          </div>
        </div>
        {editable && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remover ${component.name} do DB`}
            onClick={handleRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Tipo de alteração</Label>
        <Select
          value={item.changeType}
          onValueChange={(value) => handleChangeTypeChange(value as ChangeRequestChangeType)}
          disabled={!editable}
        >
          <SelectTrigger aria-label={`Tipo de alteração — ${component.name}`} className="h-8 w-56 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHANGE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {CHANGE_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`item-current-${item.componentId}`} className="text-xs">
            Hoje
          </Label>
          <Textarea
            id={`item-current-${item.componentId}`}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            onBlur={commitCurrent}
            disabled={!editable}
            className="min-h-[72px] text-sm"
            placeholder="Não existe (item de criação)."
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`item-proposed-${item.componentId}`} className="text-xs">
            Proposto <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id={`item-proposed-${item.componentId}`}
            value={proposed}
            onChange={(e) => setProposed(e.target.value)}
            onBlur={commitProposed}
            disabled={!editable}
            className="min-h-[72px] text-sm"
            required
          />
        </div>
      </div>

      {/* Rascunho vinculado (S36) — o conteúdo exato que vai entrar em vigor */}
      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-2 dark:border-neutral-800">
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-xs">Rascunho</Label>
          {hasDraft ? (
            <Badge variant="blue">Vinculado</Badge>
          ) : (
            <Badge variant="secondary">Sem rascunho</Badge>
          )}

          {!hasDraft && editable && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleLinkDraft}
            >
              <Link2 className="mr-1.5 h-3.5 w-3.5" /> Vincular rascunho
            </Button>
          )}

          {hasDraft && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleOpenDraft}
              >
                <PencilLine className="mr-1.5 h-3.5 w-3.5" />
                {editable ? 'Editar rascunho' : 'Ver rascunho'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setDiffOpen((open) => !open)}
              >
                {diffOpen ? 'Ocultar comparativo' : 'Ver atual × proposto'}
              </Button>
              {editable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  aria-label={`Desvincular o rascunho de ${component.name}`}
                  onClick={() => setUnlinkOpen(true)}
                >
                  <Link2Off className="mr-1.5 h-3.5 w-3.5" /> Desvincular
                </Button>
              )}
            </>
          )}
        </div>

        {!hasDraft && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {NO_DRAFT_HINT[item.changeType]}
          </p>
        )}

        {diffOpen && hasDraft && (
          <ChangeRequestItemDiff document={document} component={component} item={item} />
        )}
      </div>

      <UnlinkDraftDialog
        open={unlinkOpen}
        onOpenChange={setUnlinkOpen}
        changeRequest={changeRequest}
        component={component}
      />
    </div>
  );
}

/**
 * O que a ausência de rascunho significa depende do tipo de alteração: para
 * `UPDATE`/`CREATE` é pendência que trava a publicação (`E-GOV-04`); para os
 * demais é o esperado, e dizer isso evita o analista caçar um botão que não
 * precisa apertar.
 */
const NO_DRAFT_HINT: Record<ChangeRequestChangeType, string> = {
  UPDATE: 'Este item precisa de rascunho para ser publicado (E-GOV-04).',
  CREATE: 'Este item precisa de rascunho para ser publicado (E-GOV-04).',
  DOC_ONLY: 'Opcional: vincule um rascunho se a documentação da versão for mudar.',
  DEACTIVATE: 'Não precisa de rascunho — publicar o DB arquiva o componente.',
  REACTIVATE: 'Não precisa de rascunho — publicar o DB desarquiva o componente.',
  MOVE: 'Não precisa de rascunho — a mudança de lugar já vale na árvore.',
};
