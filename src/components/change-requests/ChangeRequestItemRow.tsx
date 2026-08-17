import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  removeChangeRequestItem,
  updateChangeRequestItem,
} from '@/core/document/change-requests';
import type {
  ChangeRequest,
  ChangeRequestChangeType,
  ChangeRequestItem,
  PolicyOpsDocument,
} from '@/core/document/schema';
import { componentPath } from '@/core/queries';
import { CHANGE_TYPE_LABELS } from '@/lib/change-request-labels';
import { COMPONENT_TYPE_ICONS } from '@/lib/component-labels';
import { useDocumentStore } from '@/store/document-store';
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

/** Uma linha de item do DB (US-GOV-03): componente, tipo de alteração, "hoje" × "proposto". */
export function ChangeRequestItemRow({ document, changeRequest, item, editable }: ChangeRequestItemRowProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const [current, setCurrent] = useState(item.currentSummary ?? '');
  const [proposed, setProposed] = useState(item.proposedSummary);

  useEffect(() => setCurrent(item.currentSummary ?? ''), [item.currentSummary]);
  useEffect(() => setProposed(item.proposedSummary), [item.proposedSummary]);

  const component = document.components.find((candidate) => candidate.id === item.componentId);
  if (component === undefined) return null;
  const Icon = COMPONENT_TYPE_ICONS[component.type];
  const path = componentPath(document, component.id);
  const breadcrumb = path.slice(0, -1).map((ancestor) => ancestor.name).join(' › ');

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
    </div>
  );
}
