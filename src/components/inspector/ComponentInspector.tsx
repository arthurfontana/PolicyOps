import { useEffect, useState } from 'react';
import { Archive, Copy, FolderInput, PencilLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ComponentPayloadFields } from '@/components/inspector/ComponentPayloadFields';
import { ComponentTagsEditor } from '@/components/inspector/ComponentTagsEditor';
import { ConfirmDialog } from '@/components/library/ConfirmDialog';
import { MoveComponentDialog } from '@/components/tree/MoveComponentDialog';
import { PublishComponentDialog } from '@/components/dialogs/PublishComponentDialog';
import { MatrixTimelineBar } from '@/components/timeline/MatrixTimelineBar';
import {
  archiveComponent,
  duplicateComponent,
  updateComponent,
  setComponentReviewStatus,
} from '@/core/document/components';
import { listChildren } from '@/core/document/components';
import {
  createComponentDraft,
  discardComponentDraft,
  updateComponentVersion,
} from '@/core/versioning/component-lifecycle';
import {
  COMPONENT_REVIEW_STATUSES,
  PAYLOAD_KIND_BY_COMPONENT_TYPE,
  type ComponentPayload,
  type ComponentReviewStatus,
  type PolicyComponentType,
} from '@/core/document/schema';
import { getComponentTimeline } from '@/core/queries';
import {
  COMPONENT_REVIEW_STATUS_LABELS,
  COMPONENT_REVIEW_STATUS_VARIANTS,
  COMPONENT_TYPE_ICONS,
  COMPONENT_TYPE_LABELS,
} from '@/lib/component-labels';
import { formatDateTimeBR } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';
import { useToast } from '@/components/ui/use-toast';

/** Campo desabilitado com o motivo em tooltip — só o que ainda não existe (editor rico, S34). */
function StubField({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col gap-1 opacity-50">
          <Label className="text-xs">{label}</Label>
          <Textarea disabled rows={2} placeholder={placeholder} />
        </div>
      </TooltipTrigger>
      <TooltipContent>Editor rico chega na Sessão 34.</TooltipContent>
    </Tooltip>
  );
}

/** Payload inicial de um componente novo — sempre com `businessDescription` preenchido (nunca vazio). */
function seedPayload(type: PolicyComponentType, name: string): ComponentPayload {
  const kind = PAYLOAD_KIND_BY_COMPONENT_TYPE[type as Exclude<PolicyComponentType, 'MATRIX'>];
  return { kind, businessDescription: name };
}

/** Espelho da variável na Biblioteca — docs/07 §17.5: sem duplicar domínios, só um link. */
function MirroredVariableCard({ variableId }: { variableId: string }) {
  const document = useDocumentStore((s) => s.document);
  const requestVariableFocus = useEditorStore((s) => s.requestVariableFocus);
  const setView = useUiStore((s) => s.setView);

  const variable = document?.variables.find((candidate) => candidate.id === variableId) ?? null;
  if (variable === null) return null;
  const published = variable.versions.find((version) => version.state === 'PUBLISHED') ?? null;

  return (
    <div className="flex flex-col gap-1 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
      <span className="font-semibold text-neutral-700 dark:text-neutral-300">Variável espelhada</span>
      <p className="text-neutral-600 dark:text-neutral-400">
        {variable.name} <span className="font-mono text-[10px] text-neutral-400">{variable.code}</span>
      </p>
      <p className="text-neutral-500 dark:text-neutral-400">
        {published === null ? 'Sem versão publicada' : `${published.domains.length} domínio(s) na versão publicada`}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => {
          requestVariableFocus(variableId);
          setView('library-variables');
        }}
      >
        Ir para a Biblioteca
      </Button>
    </div>
  );
}

/** Inspector do componente selecionado na árvore (docs/07-ux-e-editor.md §17.5). */
export function ComponentInspector({ componentId }: { componentId: string }) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const setSelectedComponent = useEditorStore((s) => s.setSelectedComponent);
  const expandComponents = useUiStore((s) => s.expandComponents);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  const [source, setSource] = useState('');
  const [locator, setLocator] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const foundComponent = document?.components.find((candidate) => candidate.id === componentId) ?? null;

  useEffect(() => {
    if (foundComponent === null) return;
    setName(foundComponent.name);
    setSource(foundComponent.origin?.source ?? '');
    setLocator(foundComponent.origin?.locator ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- campos escalares de propósito, não o objeto (evita re-sincronizar a cada render)
  }, [foundComponent?.id, foundComponent?.name, foundComponent?.origin?.source, foundComponent?.origin?.locator]);

  if (document === null || foundComponent === null) return null;
  // Const derivada do valor já estreitado (não a mesma referência narrowed
  // por controle de fluxo): closures abaixo (commitName, handleArchive…)
  // continuam vendo `PolicyComponent`, não `PolicyComponent | null`.
  const component = foundComponent;
  const project = document.projects.find((candidate) => candidate.id === component.projectId);

  const Icon = COMPONENT_TYPE_ICONS[component.type];
  const childCount = listChildren(document, component.projectId, component.id).length;

  const draft = component.versions.find((version) => version.state === 'DRAFT') ?? null;
  const publishedVersion = component.versions.find((version) => version.state === 'PUBLISHED') ?? null;
  const displayedVersion = draft ?? publishedVersion;
  const isSectionUndocumented = component.type === 'SECTION' && component.versions.length === 0;
  const timeline = getComponentTimeline(component);

  function commitName() {
    setNameEditing(false);
    const trimmed = name.trim();
    if (trimmed === component.name) return;
    if (trimmed.length === 0) {
      setName(component.name);
      return;
    }
    const result = dispatch(updateComponent({ componentId: component.id, name: trimmed }));
    if (!result.ok) {
      setName(component.name);
      toast({ title: 'Não foi possível renomear', description: result.error.message });
    }
  }

  function commitOrigin() {
    const trimmedSource = source.trim();
    const trimmedLocator = locator.trim();
    const nextOrigin =
      trimmedSource.length === 0
        ? null
        : { source: trimmedSource, ...(trimmedLocator.length > 0 ? { locator: trimmedLocator } : {}) };
    const currentSource = component.origin?.source ?? '';
    const currentLocator = component.origin?.locator ?? '';
    if (trimmedSource === currentSource && trimmedLocator === currentLocator) return;
    const result = dispatch(updateComponent({ componentId: component.id, origin: nextOrigin }));
    if (!result.ok) {
      setSource(component.origin?.source ?? '');
      setLocator(component.origin?.locator ?? '');
      toast({ title: 'Não foi possível atualizar a origem', description: result.error.message });
    }
  }

  function handleReviewStatusChange(next: ComponentReviewStatus) {
    if (next === component.reviewStatus) return;
    const result = dispatch(setComponentReviewStatus({ componentId: component.id, reviewStatus: next }));
    if (!result.ok) {
      toast({ title: 'Não foi possível alterar a revisão', description: result.error.message });
    }
  }

  function handleDuplicate() {
    const result = dispatch(duplicateComponent({ componentId: component.id }));
    if (!result.ok) {
      toast({ title: 'Não foi possível duplicar', description: result.error.message });
      return;
    }
    if (component.parentId !== undefined) expandComponents([component.parentId]);
    setSelectedComponent(result.data.componentId);
  }

  function handleArchive() {
    const result = dispatch(archiveComponent({ componentId: component.id }));
    if (!result.ok) {
      toast({ title: 'Não foi possível arquivar', description: result.error.message });
      return;
    }
    setArchiveOpen(false);
    setSelectedComponent(null);
  }

  function handleCreateDraft() {
    const result = dispatch(
      createComponentDraft({ componentId: component.id, payload: seedPayload(component.type, component.name) }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível criar o rascunho', description: result.error.message });
    }
  }

  function handleDiscardDraft() {
    if (draft === null) return;
    const result = dispatch(discardComponentDraft({ versionId: draft.id }));
    if (!result.ok) {
      toast({ title: 'Não foi possível descartar o rascunho', description: result.error.message });
      return;
    }
    setDiscardOpen(false);
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-neutral-400" />
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Propriedades do componente</h2>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="component-name" className="text-xs">
          Nome
        </Label>
        <Input
          id="component-name"
          value={nameEditing ? name : component.name}
          onFocus={() => setNameEditing(true)}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setName(component.name);
              setNameEditing(false);
              e.currentTarget.blur();
            }
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Código</Label>
          <p className="rounded-md border border-transparent px-3 py-1.5 font-mono text-sm text-neutral-500 dark:text-neutral-400">
            {component.code}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Tipo</Label>
          <p className="px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-300">
            {COMPONENT_TYPE_LABELS[component.type]}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">Tags</Label>
        <ComponentTagsEditor component={component} />
      </div>

      <div className="flex flex-col gap-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
        <Label className="text-xs">Origem</Label>
        <Input
          placeholder="Fonte (ex.: Filtros e Critérios B2C)"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onBlur={commitOrigin}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label="Origem — fonte"
        />
        <Input
          placeholder="Locator (ex.: p. 10, opcional)"
          value={locator}
          onChange={(e) => setLocator(e.target.value)}
          onBlur={commitOrigin}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label="Origem — locator"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="component-review-status" className="text-xs">
          Revisão
        </Label>
        <Select value={component.reviewStatus} onValueChange={(v) => handleReviewStatusChange(v as ComponentReviewStatus)}>
          <SelectTrigger id="component-review-status" aria-label="Revisão">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMPONENT_REVIEW_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {COMPONENT_REVIEW_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant={COMPONENT_REVIEW_STATUS_VARIANTS[component.reviewStatus]} className="w-fit">
          {COMPONENT_REVIEW_STATUS_LABELS[component.reviewStatus]}
        </Badge>
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {childCount} {childCount === 1 ? 'item filho' : 'itens filhos'}
      </p>

      <div className="flex flex-wrap gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <Button type="button" variant="outline" size="sm" onClick={() => setMoveOpen(true)}>
          <FolderInput className="mr-1.5 h-3.5 w-3.5" /> Mover para…
        </Button>
        {component.type !== 'MATRIX' && (
          <Button type="button" variant="outline" size="sm" onClick={handleDuplicate}>
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Duplicar
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
          <Archive className="mr-1.5 h-3.5 w-3.5" /> Arquivar
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Conteúdo e versão</p>

        {timeline.length > 0 && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Linha do tempo</Label>
            <MatrixTimelineBar segments={timeline} now={new Date()} selectedAt={new Date()} onSelectVersion={() => {}} />
          </div>
        )}

        {isSectionUndocumented && (
          <>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Esta seção é uma pasta pura — sem texto, vigência nem histórico próprios.
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={handleCreateDraft}>
              <PencilLine className="mr-1.5 h-3.5 w-3.5" /> Documentar esta seção
            </Button>
          </>
        )}

        {!isSectionUndocumented && displayedVersion === null && (
          <Button type="button" variant="secondary" size="sm" onClick={handleCreateDraft}>
            Criar rascunho
          </Button>
        )}

        {displayedVersion !== null && (
          <>
            {draft === null && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Mostrando a versão {displayedVersion.number}, vigente desde{' '}
                {displayedVersion.effectiveFrom !== undefined ? formatDateTimeBR(displayedVersion.effectiveFrom) : '—'}.
              </p>
            )}
            {draft !== null && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Editando o rascunho da versão {draft.number}.
              </p>
            )}

            <ComponentPayloadFields
              key={displayedVersion.id}
              payload={displayedVersion.payload}
              editable={draft !== null}
              onChange={(payload) => {
                if (draft === null) return;
                const result = dispatch(updateComponentVersion({ versionId: draft.id, payload }));
                if (!result.ok) {
                  toast({ title: 'Não foi possível salvar o conteúdo', description: result.error.message });
                }
              }}
            />

            {component.type === 'POLICY_VARIABLE' && component.variableId !== undefined && (
              <MirroredVariableCard variableId={component.variableId} />
            )}

            <StubField label="Especificação (spec)" placeholder="Editor de especificação livre — Sessão 34." />

            {draft !== null && (
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={() => setPublishOpen(true)}>
                  Publicar
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setDiscardOpen(true)}>
                  Descartar rascunho
                </Button>
              </div>
            )}
            {draft === null && (
              <Button type="button" variant="outline" size="sm" onClick={handleCreateDraft} className="w-fit">
                Criar rascunho a partir desta versão
              </Button>
            )}
          </>
        )}
      </div>

      <MoveComponentDialog open={moveOpen} onOpenChange={setMoveOpen} componentId={component.id} />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Arquivar "${component.name}"?`}
        description="O componente some da árvore ativa. O histórico e os filhos continuam existindo e podem ser consultados."
        confirmLabel="Arquivar"
        destructive
        onConfirm={handleArchive}
      />
      {draft !== null && (
        <PublishComponentDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          component={component}
          version={draft}
          foundationEffectiveFrom={project?.foundationEffectiveFrom}
          onPublished={() => {
            toast({ title: `Versão ${draft.number} publicada` });
          }}
        />
      )}
      {draft !== null && (
        <ConfirmDialog
          open={discardOpen}
          onOpenChange={setDiscardOpen}
          title={`Descartar o rascunho da versão ${draft.number}?`}
          description="O conteúdo deste rascunho será perdido — esta ação não pode ser desfeita."
          confirmLabel="Descartar"
          destructive
          onConfirm={handleDiscardDraft}
        />
      )}
    </div>
  );
}
