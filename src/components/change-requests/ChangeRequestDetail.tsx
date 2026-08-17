import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { AcceptanceCriteriaEditor } from '@/components/change-requests/AcceptanceCriteriaEditor';
import { AddChangeRequestItemDialog } from '@/components/change-requests/AddChangeRequestItemDialog';
import { CatalogChipPicker } from '@/components/change-requests/CatalogChipPicker';
import { ChangeRequestEventLog } from '@/components/change-requests/ChangeRequestEventLog';
import { ChangeRequestItemRow } from '@/components/change-requests/ChangeRequestItemRow';
import { DecisionDialog } from '@/components/change-requests/DecisionDialog';
import { PublishChangeRequestDialog } from '@/components/change-requests/PublishChangeRequestDialog';
import { ImpactsEditor } from '@/components/change-requests/ImpactsEditor';
import { TestScenariosEditor } from '@/components/change-requests/TestScenariosEditor';
import { ConfirmDialog } from '@/components/library/ConfirmDialog';
import { RichDocEditor } from '@/components/richdoc/RichDocEditor';
import {
  addChangeRequestItem,
  cancelChangeRequest,
  transitionChangeRequest,
  updateChangeRequest,
} from '@/core/document/change-requests';
import {
  allowedTransitions,
  isChangeRequestClosed,
  isChangeRequestFrozen,
  missingForSubmit,
} from '@/core/document/cr-workflow';
import type { CrApprovalDecision, CrPriority, CrStatus } from '@/core/document/schema';
import { RELEASE_READY_STATUSES } from '@/core/document/releases';
import { getComponentCurrentSummary } from '@/core/queries';
import { CR_PRIORITY_LABELS, CR_STATUS_CLOSED_CLASS, CR_STATUS_LABELS, CR_STATUS_VARIANTS } from '@/lib/change-request-labels';
import { dateInputToIso, formatDateTimeBR, isoToDateInputValue } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

const PRIORITIES: readonly CrPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const NO_PRIORITY = '__no_priority__';

const SUBMIT_REQUIREMENT_LABEL: Record<string, string> = {
  MOTIVATOR: 'ao menos um motivador',
  ITEM: 'ao menos um item com o texto do proposto',
  EFFECTIVE_DATE: 'a vigência pretendida',
};

/** Destinos de transição decididos pela fila (`DecisionDialog`), nunca pelo botão genérico daqui. */
const DECISION_STATUSES = new Set<CrStatus>(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']);

/** Onde `changeRequest/publish` é aceito — `RELEASE_READY_STATUSES` do núcleo. */
const PUBLISHABLE_STATUSES = new Set<CrStatus>(RELEASE_READY_STATUSES);

export interface ChangeRequestDetailProps {
  changeRequestId: string;
}

/**
 * Tela do DB (US-GOV-03/04): metadados, workflow por estado, motivadores,
 * itens, impactos, critérios, testes, vigência, motivação/especificação
 * (`RichDocEditor`) e a trilha própria de eventos.
 */
export function ChangeRequestDetail({ changeRequestId }: ChangeRequestDetailProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const setSelectedChangeRequest = useEditorStore((s) => s.setSelectedChangeRequest);
  const selectedProjectId = useEditorStore((s) => s.selectedProjectId);
  const { toast } = useToast();

  const [titleEditing, setTitleEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState<CrApprovalDecision | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  // Estado local só para escopar o seletor de componente antes do primeiro
  // item existir (docs/14 §3.3 — o DB não guarda `projectId`); inicializado
  // uma vez, na montagem, para nunca alternar de controlado para não
  // controlado no `<Select>` do projeto.
  const [itemProjectId, setItemProjectId] = useState<string | null>(
    () => selectedProjectId ?? document?.projects[0]?.id ?? null,
  );

  const changeRequest = document?.changeRequests.find((candidate) => candidate.id === changeRequestId) ?? null;

  useEffect(() => {
    if (changeRequest === null) return;
    setTitle(changeRequest.title);
    setOwner(changeRequest.owner ?? '');
    setEffectiveDate(
      changeRequest.proposedEffectiveDate === undefined ? '' : isoToDateInputValue(changeRequest.proposedEffectiveDate),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- campos escalares de propósito (evita re-sincronizar a cada render)
  }, [changeRequest?.id, changeRequest?.title, changeRequest?.owner, changeRequest?.proposedEffectiveDate]);

  const firstItemProjectId = useMemo(() => {
    if (document === null || changeRequest === null || changeRequest.items.length === 0) return null;
    const component = document.components.find((c) => c.id === changeRequest.items[0]!.componentId);
    return component?.projectId ?? null;
  }, [document, changeRequest]);

  if (document === null || changeRequest === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Este DB não existe mais.</p>
        <Button onClick={() => setSelectedChangeRequest(null)}>Voltar à lista</Button>
      </div>
    );
  }

  const closed = isChangeRequestClosed(changeRequest.status);
  const frozen = isChangeRequestFrozen(changeRequest.status);
  const metadataEditable = !closed;
  const itemsEditable = !frozen;
  const effectiveProjectId = firstItemProjectId ?? itemProjectId;
  const missing = missingForSubmit(changeRequest);
  const genericTransitions = allowedTransitions(changeRequest.status).filter((to) => !DECISION_STATUSES.has(to));
  const canDecide = changeRequest.status === 'IN_REVIEW';
  // Publicar é a aresta `SCHEDULED → PUBLISHED` do grafo, mais a entrada por
  // `READY_FOR_RELEASE` (docs/14 §3.4): antes disso o botão aparece
  // desabilitado, dizendo o que falta.
  const canPublish = PUBLISHABLE_STATUSES.has(changeRequest.status);
  const canShowDisabledPublish = !closed && !canPublish && changeRequest.status !== 'DRAFT';

  function commitTitle() {
    setTitleEditing(false);
    const trimmed = title.trim();
    if (trimmed === changeRequest!.title || trimmed === '') {
      setTitle(changeRequest!.title);
      return;
    }
    const result = dispatch(updateChangeRequest({ changeRequestId, title: trimmed }));
    if (!result.ok) {
      setTitle(changeRequest!.title);
      toast({ title: 'Não foi possível renomear', description: result.error.message });
    }
  }

  function commitOwner() {
    const trimmed = owner.trim();
    if (trimmed === (changeRequest!.owner ?? '')) return;
    const result = dispatch(updateChangeRequest({ changeRequestId, owner: trimmed === '' ? null : trimmed }));
    if (!result.ok) {
      setOwner(changeRequest!.owner ?? '');
      toast({ title: 'Não foi possível salvar o dono', description: result.error.message });
    }
  }

  function commitEffectiveDate(value: string) {
    setEffectiveDate(value);
    const result = dispatch(
      updateChangeRequest({
        changeRequestId,
        proposedEffectiveDate: value === '' ? null : dateInputToIso(value),
      }),
    );
    if (!result.ok) {
      setEffectiveDate(
        changeRequest!.proposedEffectiveDate === undefined ? '' : isoToDateInputValue(changeRequest!.proposedEffectiveDate),
      );
      toast({ title: 'Não foi possível salvar a vigência', description: result.error.message });
    }
  }

  function handlePriorityChange(value: string) {
    const priority = value === NO_PRIORITY ? null : (value as CrPriority);
    const result = dispatch(updateChangeRequest({ changeRequestId, priority }));
    if (!result.ok) toast({ title: 'Não foi possível salvar a prioridade', description: result.error.message });
  }

  function handleMotivatorsChange(motivators: string[]) {
    const result = dispatch(updateChangeRequest({ changeRequestId, motivators }));
    if (!result.ok) toast({ title: 'Não foi possível salvar os motivadores', description: result.error.message });
  }

  function handleTransition(to: CrStatus) {
    const result = dispatch(transitionChangeRequest({ changeRequestId, to }));
    if (!result.ok) {
      toast({ variant: 'destructive', title: 'Não foi possível mudar o status', description: result.error.message });
    }
  }

  function handleCancel() {
    const result = dispatch(cancelChangeRequest({ changeRequestId }));
    if (!result.ok) {
      toast({ title: 'Não foi possível cancelar', description: result.error.message });
    }
    setCancelOpen(false);
  }

  function handlePickItem(componentId: string) {
    const component = document!.components.find((c) => c.id === componentId);
    if (component === undefined) return;
    const { version, summary } = getComponentCurrentSummary(component, new Date());
    const result = dispatch(
      addChangeRequestItem({
        changeRequestId,
        componentId,
        changeType: version === null ? 'CREATE' : 'UPDATE',
        currentSummary: summary,
        proposedSummary: 'A definir.',
        ...(version !== null ? { baseVersionId: version.id } : {}),
      }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível adicionar o item', description: result.error.message });
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-start gap-2">
        <Button type="button" variant="ghost" size="icon" aria-label="Voltar à lista" onClick={() => setSelectedChangeRequest(null)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 font-mono text-sm text-neutral-400">{changeRequest.code}</span>
            <Badge
              variant={CR_STATUS_VARIANTS[changeRequest.status]}
              className={changeRequest.status === 'REJECTED' || changeRequest.status === 'CANCELLED' ? CR_STATUS_CLOSED_CLASS : undefined}
            >
              {CR_STATUS_LABELS[changeRequest.status]}
            </Badge>
          </div>
          <Input
            value={titleEditing ? title : changeRequest.title}
            onFocus={() => setTitleEditing(true)}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            disabled={!metadataEditable}
            className="mt-1 h-auto border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
            aria-label="Título do DB"
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setTitle(changeRequest.title);
                setTitleEditing(false);
                e.currentTarget.blur();
              }
            }}
          />
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            solicitado por {changeRequest.requestedBy} em {formatDateTimeBR(changeRequest.createdAt)}
          </p>
        </div>
      </div>

      {/* Workflow — ações visíveis conforme o grafo de 12 estados (docs/14 §5) */}
      <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Workflow</p>
        {changeRequest.status === 'DRAFT' && missing.length > 0 && (
          <Alert>
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>
              Falta para submeter: {missing.map((requirement) => SUBMIT_REQUIREMENT_LABEL[requirement]).join(', ')}.
            </AlertDescription>
          </Alert>
        )}
        {changeRequest.status === 'APPROVED' && (
          <Alert>
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>
              Aprovar não publica nada (RN-GOV-04): nenhuma versão de componente ou matriz mudou de estado.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {canDecide && (
            <>
              <Button type="button" size="sm" onClick={() => setDecisionOpen('APPROVED')}>
                Aprovar
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setDecisionOpen('RETURNED')}>
                Devolver
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={() => setDecisionOpen('REJECTED')}>
                Rejeitar
              </Button>
            </>
          )}
          {genericTransitions
            .filter((to) => to !== 'CANCELLED')
            .map((to) => (
              <Button key={to} type="button" variant="secondary" size="sm" onClick={() => handleTransition(to)}>
                {to === 'SUBMITTED' ? 'Submeter' : `Mover para ${CR_STATUS_LABELS[to]}`}
              </Button>
            ))}
          {canPublish && (
            <Button type="button" size="sm" onClick={() => setPublishOpen(true)}>
              Publicar
            </Button>
          )}
          {canShowDisabledPublish && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button type="button" variant="secondary" size="sm" disabled>
                    Publicar
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Publicar só a partir de {CR_STATUS_LABELS.READY_FOR_RELEASE} — hoje o DB está em{' '}
                {CR_STATUS_LABELS[changeRequest.status]}.
              </TooltipContent>
            </Tooltip>
          )}
          {genericTransitions.includes('CANCELLED') && (
            <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setCancelOpen(true)}>
              Cancelar DB
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Prioridade</Label>
          <Select
            value={changeRequest.priority ?? NO_PRIORITY}
            onValueChange={handlePriorityChange}
            disabled={!metadataEditable}
          >
            <SelectTrigger aria-label="Prioridade" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PRIORITY}>Sem prioridade</SelectItem>
              {PRIORITIES.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {CR_PRIORITY_LABELS[priority]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="db-owner" className="text-xs">
            Dono (gestor responsável)
          </Label>
          <Input
            id="db-owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            onBlur={commitOwner}
            disabled={!metadataEditable}
            placeholder="Nome livre — papel é declarativo (DEC-GOV-004)"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="db-effective-date" className="text-xs">
            Vigência proposta <span className="text-red-500">*</span>
          </Label>
          <Input
            id="db-effective-date"
            type="date"
            value={effectiveDate}
            onChange={(e) => commitEffectiveDate(e.target.value)}
            disabled={!metadataEditable}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">
          Motivadores <span className="text-red-500">*</span>
        </Label>
        <CatalogChipPicker
          kind="MOTIVATOR"
          selected={changeRequest.motivators}
          onChange={handleMotivatorsChange}
          itemLabel="Motivador"
          disabled={!metadataEditable}
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Itens ({changeRequest.items.length})</Label>
          {itemsEditable && effectiveProjectId !== null && (
            <Button type="button" variant="outline" size="sm" onClick={() => setAddItemOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar item
            </Button>
          )}
        </div>
        {changeRequest.items.length === 0 && firstItemProjectId === null && document.projects.length > 1 && (
          <div className="flex items-center gap-2">
            <Label htmlFor="db-item-project" className="text-xs">
              Projeto
            </Label>
            <Select value={itemProjectId ?? undefined} onValueChange={setItemProjectId}>
              <SelectTrigger id="db-item-project" className="h-8 w-64 text-xs">
                <SelectValue placeholder="Escolha o projeto…" />
              </SelectTrigger>
              <SelectContent>
                {document.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {changeRequest.items.length === 0 && (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">Nenhum item ainda.</p>
        )}
        {changeRequest.items.map((item) => (
          <ChangeRequestItemRow
            key={item.componentId}
            document={document}
            changeRequest={changeRequest}
            item={item}
            editable={itemsEditable}
          />
        ))}
      </div>

      <div className="flex flex-col gap-1 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <Label className="text-xs">Impactos</Label>
        <ImpactsEditor changeRequest={changeRequest} editable={metadataEditable} />
      </div>

      <div className="flex flex-col gap-1 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <Label className="text-xs">Critérios de aceite (incentivado, não obrigatório para submeter)</Label>
        <AcceptanceCriteriaEditor changeRequest={changeRequest} editable={metadataEditable} />
      </div>

      <div className="flex flex-col gap-1 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <Label className="text-xs">Cenários de teste</Label>
        <TestScenariosEditor changeRequest={changeRequest} editable={metadataEditable} />
      </div>

      <div className="flex flex-col gap-1 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <Label className="text-xs">Motivação — contexto, evidência, objetivo</Label>
        <RichDocEditor
          key={`motivation-${changeRequest.id}`}
          target={{ kind: 'CR_MOTIVATION', changeRequestId: changeRequest.id }}
          value={changeRequest.motivationText}
          editable={metadataEditable}
          emptyLabel="Sem motivação registrada ainda."
        />
      </div>

      <div className="flex flex-col gap-1 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <Label className="text-xs">Especificação livre</Label>
        <RichDocEditor
          key={`spec-${changeRequest.id}`}
          target={{ kind: 'CR_SPEC', changeRequestId: changeRequest.id }}
          value={changeRequest.spec}
          editable={metadataEditable}
          emptyLabel="Sem especificação livre ainda."
        />
      </div>

      <div className="flex flex-col gap-1 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <Label className="text-xs">Trilha</Label>
        <ChangeRequestEventLog events={changeRequest.events} />
      </div>

      {effectiveProjectId !== null && (
        <AddChangeRequestItemDialog
          open={addItemOpen}
          onOpenChange={setAddItemOpen}
          projectId={effectiveProjectId}
          changeRequestId={changeRequest.id}
          excludeComponentIds={changeRequest.items.map((item) => item.componentId)}
          onPick={handlePickItem}
        />
      )}

      <PublishChangeRequestDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        changeRequest={changeRequest}
      />

      {decisionOpen !== null && (
        <DecisionDialog
          open={decisionOpen !== null}
          onOpenChange={(open) => {
            if (!open) setDecisionOpen(null);
          }}
          changeRequest={changeRequest}
          decision={decisionOpen}
          onDecided={() => setDecisionOpen(null)}
        />
      )}

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancelar "${changeRequest.code}"?`}
        description="O DB vai para CANCELLED — estado final, sem volta. O histórico permanece consultável."
        confirmLabel="Cancelar DB"
        destructive
        onConfirm={handleCancel}
      />
    </div>
  );
}
