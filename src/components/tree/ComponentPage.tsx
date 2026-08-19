import { useEffect, useRef, useState } from 'react';
import { Archive, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Copy, FolderInput } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ComponentBreadcrumb } from '@/components/tree/ComponentBreadcrumb';
import { ComponentPayloadFields } from '@/components/inspector/ComponentPayloadFields';
import { ComponentTagsEditor } from '@/components/inspector/ComponentTagsEditor';
import { RichDocDiffView } from '@/components/richdoc/RichDocDiffView';
import { RichDocEditor } from '@/components/richdoc/RichDocEditor';
import { ConfirmDialog } from '@/components/library/ConfirmDialog';
import { MoveComponentDialog } from '@/components/tree/MoveComponentDialog';
import { PublishComponentDialog } from '@/components/dialogs/PublishComponentDialog';
import { MatrixTimelineBar } from '@/components/timeline/MatrixTimelineBar';
import {
  archiveComponent,
  duplicateComponent,
  listChildren,
  updateComponent,
  setComponentReviewStatus,
} from '@/core/document/components';
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
import { componentPath, getComponentTimeline } from '@/core/queries';
import { versionBadge } from '@/lib/matrix-badges';
import { toDateInputValue } from '@/lib/timeline-dates';
import {
  COMPONENT_REVIEW_STATUS_LABELS,
  COMPONENT_REVIEW_STATUS_VARIANTS,
  COMPONENT_TYPE_ICONS,
  COMPONENT_TYPE_LABELS,
} from '@/lib/component-labels';
import { formatDateBR, formatDateTimeBR } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';
import { usePersistenceStore, SAVE_STATUS_LABEL } from '@/store/persistence-store';
import { useToast } from '@/components/ui/use-toast';

export interface ComponentPageProps {
  projectId: string;
  projectName: string;
  componentId: string;
}

/** Payload inicial de um componente novo — sempre com `businessDescription` preenchido (nunca vazio). */
function seedPayload(type: PolicyComponentType, name: string): ComponentPayload {
  const kind = PAYLOAD_KIND_BY_COMPONENT_TYPE[type as Exclude<PolicyComponentType, 'MATRIX'>];
  return { kind, businessDescription: name };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
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
    <div className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <span className="font-semibold text-neutral-700 dark:text-neutral-300">Variável espelhada</span>
      <p className="text-neutral-600 dark:text-neutral-400">
        {variable.name} <span className="font-mono text-xs text-neutral-400">{variable.code}</span>
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

/**
 * Página do componente selecionado na árvore — docs/07-ux-e-editor.md §17.5,
 * DEC-UX-002. Substitui `ComponentContentPanel` + `ComponentInspector`: um
 * documento único no centro, do nome à vigência, sem painel lateral — coluna
 * de leitura de até 960px, centralizada.
 */
export function ComponentPage({ projectId, projectName, componentId }: ComponentPageProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const setSelectedComponent = useEditorStore((s) => s.setSelectedComponent);
  const expandComponents = useUiStore((s) => s.expandComponents);
  const openPolicyAt = useUiStore((s) => s.openPolicyAt);
  const saveStatus = usePersistenceStore((s) => s.status);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  const [source, setSource] = useState('');
  const [locator, setLocator] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [specDiffOpen, setSpecDiffOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const component = document?.components.find((candidate) => candidate.id === componentId) ?? null;

  useEffect(() => {
    if (component === null) return;
    setName(component.name);
    setSource(component.origin?.source ?? '');
    setLocator(component.origin?.locator ?? '');
    setNameEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- campos escalares de propósito, não o objeto (evita re-sincronizar a cada render)
  }, [component?.id, component?.name, component?.origin?.source, component?.origin?.locator]);

  useEffect(() => {
    if (nameEditing) nameInputRef.current?.focus();
  }, [nameEditing]);

  const siblings = component === null ? [] : listChildren(document!, projectId, component.parentId);
  const siblingIndex = component === null ? -1 : siblings.findIndex((candidate) => candidate.id === component.id);
  const previousSibling = siblingIndex > 0 ? siblings[siblingIndex - 1]! : null;
  const nextSibling = siblingIndex >= 0 && siblingIndex < siblings.length - 1 ? siblings[siblingIndex + 1]! : null;

  // `Alt+↑`/`Alt+↓` navegam entre irmãos, na ordem da árvore (docs/07 §17.5).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (isTypingTarget(event.target)) return;
      const target = event.key === 'ArrowUp' ? previousSibling : nextSibling;
      if (target === null) return;
      event.preventDefault();
      setSelectedComponent(target.id);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previousSibling, nextSibling, setSelectedComponent]);

  if (document === null || component === null) {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Este componente não existe mais (pode ter sido arquivado ou desfeito).
        </p>
        <button
          type="button"
          onClick={() => setSelectedComponent(null)}
          className="text-sm text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
        >
          Voltar às matrizes do projeto
        </button>
      </div>
    );
  }

  const path = componentPath(document, componentId);
  const project = document.projects.find((candidate) => candidate.id === component.projectId);
  const Icon = COMPONENT_TYPE_ICONS[component.type];
  const childCount = listChildren(document, projectId, component.id).length;

  const openDraft = component.versions.find((version) => version.state === 'DRAFT') ?? null;
  const publishedVersion = component.versions.find((version) => version.state === 'PUBLISHED') ?? null;
  const isSectionUndocumented = component.type === 'SECTION' && component.versions.length === 0;
  const timeline = getComponentTimeline(component);

  // A página do componente é **sempre hoje** (DEC-UX-004): ver o passado é a
  // tela de Vigência (§10), que abre pela faixa de vigência lá embaixo.
  const draft = openDraft;
  const displayedVersion = openDraft ?? publishedVersion;

  function commitName() {
    setNameEditing(false);
    const trimmed = name.trim();
    if (trimmed === component!.name) return;
    if (trimmed.length === 0) {
      setName(component!.name);
      return;
    }
    const result = dispatch(updateComponent({ componentId: component!.id, name: trimmed }));
    if (!result.ok) {
      setName(component!.name);
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
    const currentSource = component!.origin?.source ?? '';
    const currentLocator = component!.origin?.locator ?? '';
    if (trimmedSource === currentSource && trimmedLocator === currentLocator) return;
    const result = dispatch(updateComponent({ componentId: component!.id, origin: nextOrigin }));
    if (!result.ok) {
      setSource(component!.origin?.source ?? '');
      setLocator(component!.origin?.locator ?? '');
      toast({ title: 'Não foi possível atualizar a origem', description: result.error.message });
    }
  }

  function handleReviewStatusChange(next: ComponentReviewStatus) {
    if (next === component!.reviewStatus) return;
    const result = dispatch(setComponentReviewStatus({ componentId: component!.id, reviewStatus: next }));
    if (!result.ok) {
      toast({ title: 'Não foi possível alterar a revisão', description: result.error.message });
    }
  }

  function handleDuplicate() {
    const result = dispatch(duplicateComponent({ componentId: component!.id }));
    if (!result.ok) {
      toast({ title: 'Não foi possível duplicar', description: result.error.message });
      return;
    }
    if (component!.parentId !== undefined) expandComponents([component!.parentId]);
    setSelectedComponent(result.data.componentId);
  }

  function handleArchive() {
    const result = dispatch(archiveComponent({ componentId: component!.id }));
    if (!result.ok) {
      toast({ title: 'Não foi possível arquivar', description: result.error.message });
      return;
    }
    setArchiveOpen(false);
    setSelectedComponent(null);
  }

  function handleCreateDraft() {
    const result = dispatch(
      createComponentDraft({ componentId: component!.id, payload: seedPayload(component!.type, component!.name) }),
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

  const versionBadgeInfo = displayedVersion === null ? null : versionBadge(displayedVersion);

  function stickyStateLabel(): string {
    if (displayedVersion === null) return 'Sem conteúdo';
    if (draft !== null) return `Rascunho v${draft.number} · desde ${formatDateBR(draft.createdAt)}`;
    if (displayedVersion.effectiveFrom !== undefined) {
      return `Vigente v${displayedVersion.number} desde ${formatDateBR(displayedVersion.effectiveFrom)}`;
    }
    return `v${displayedVersion.number}`;
  }

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-4 p-8" data-testid="component-page">
      {/* --- Cabeçalho: breadcrumb, ícone, nome, code, badges, navegação entre irmãos --- */}
      <div className="flex items-start justify-between gap-3">
        <ComponentBreadcrumb
          projectName={projectName}
          path={path}
          onNavigateRoot={() => setSelectedComponent(null)}
          onNavigate={(id) => setSelectedComponent(id)}
        />
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={previousSibling === null}
            onClick={() => previousSibling !== null && setSelectedComponent(previousSibling.id)}
            title="Componente anterior (Alt+↑)"
            aria-label="Componente anterior"
          >
            <ChevronLeft className="mr-1 h-3.5 w-3.5" /> anterior
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={nextSibling === null}
            onClick={() => nextSibling !== null && setSelectedComponent(nextSibling.id)}
            title="Próximo componente (Alt+↓)"
            aria-label="Próximo componente"
          >
            próximo <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Icon className="h-5 w-5 shrink-0 text-neutral-400" />
        {nameEditing ? (
          <Input
            ref={nameInputRef}
            aria-label="Nome"
            value={name}
            className="h-8 max-w-sm text-lg font-semibold"
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
        ) : (
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            <button
              type="button"
              data-testid="component-name-button"
              onClick={() => setNameEditing(true)}
              onKeyDown={(e) => {
                if (e.key === 'F2') {
                  e.preventDefault();
                  setNameEditing(true);
                }
              }}
              title="Clique ou F2 para renomear"
              className="rounded px-1 hover:bg-neutral-100 disabled:hover:bg-transparent dark:hover:bg-neutral-800"
            >
              {component.name}
            </button>
          </h1>
        )}
        <span className="shrink-0 font-mono text-xs text-neutral-400">{component.code}</span>
        <Badge variant="outline">{COMPONENT_TYPE_LABELS[component.type]}</Badge>
        <Badge variant={COMPONENT_REVIEW_STATUS_VARIANTS[component.reviewStatus]}>
          {COMPONENT_REVIEW_STATUS_LABELS[component.reviewStatus]}
        </Badge>
        {versionBadgeInfo !== null && (
          <Badge variant={versionBadgeInfo.variant} className={versionBadgeInfo.strike === true ? 'line-through' : undefined}>
            {versionBadgeInfo.label}
          </Badge>
        )}
      </div>

      {/* --- Barra de ações grudenta --- */}
      <div className="sticky top-0 z-10 -mx-8 flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white/95 px-8 py-2.5 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{stickyStateLabel()}</span>
        {displayedVersion !== null && (
          <span className="text-xs text-neutral-400 dark:text-neutral-500" data-testid="component-save-status">
            {SAVE_STATUS_LABEL[saveStatus]}
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {isSectionUndocumented && (
            <Button type="button" variant="secondary" size="sm" onClick={handleCreateDraft}>
              Documentar esta seção
            </Button>
          )}
          {!isSectionUndocumented && displayedVersion === null && (
            <Button type="button" variant="secondary" size="sm" onClick={handleCreateDraft}>
              Criar rascunho
            </Button>
          )}
          {displayedVersion !== null && draft === null && (
            <Button type="button" variant="outline" size="sm" onClick={handleCreateDraft}>
              Criar rascunho a partir desta versão
            </Button>
          )}
          {draft !== null && (
            <>
              <Button type="button" size="sm" onClick={() => setPublishOpen(true)}>
                Publicar
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setDiscardOpen(true)}>
                Descartar rascunho
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={`Mais ações para ${component.name}`}>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                <FolderInput className="mr-2 h-3.5 w-3.5" /> Mover para…
              </DropdownMenuItem>
              {component.type !== 'MATRIX' && (
                <DropdownMenuItem onSelect={handleDuplicate}>
                  <Copy className="mr-2 h-3.5 w-3.5" /> Duplicar
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>
                <Archive className="mr-2 h-3.5 w-3.5" /> Arquivar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* --- Identidade: tags, origem, revisão, filhos, em grade de 2 colunas --- */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border border-neutral-200 p-4 sm:grid-cols-2 dark:border-neutral-800">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Tags</Label>
          <ComponentTagsEditor component={component} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Origem</Label>
          <div className="flex flex-col gap-1.5">
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
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="component-review-status" className="text-xs">
            Revisão
          </Label>
          <Select
            value={component.reviewStatus}
            onValueChange={(v) => handleReviewStatusChange(v as ComponentReviewStatus)}
          >
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
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Itens filhos</Label>
          <p className="px-1 text-sm text-neutral-500 dark:text-neutral-400">
            {childCount} {childCount === 1 ? 'item filho' : 'itens filhos'}
          </p>
        </div>
      </div>

      {isSectionUndocumented && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Esta seção é uma pasta pura — sem texto, vigência nem histórico próprios.
        </p>
      )}

      {displayedVersion !== null && (
        <>
          {/* --- Conteúdo da versão --- */}
          {draft === null && (
            <div className="rounded-md border border-dashed border-neutral-300 p-3 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              Versão {displayedVersion.number}{' '}
              {displayedVersion.effectiveFrom !== undefined
                ? `vigente desde ${formatDateTimeBR(displayedVersion.effectiveFrom)}`
                : ''}
              {' — crie um rascunho para editar.'}
            </div>
          )}

          <ComponentPayloadFields
            key={displayedVersion.id}
            payload={displayedVersion.payload}
            editable={draft !== null}
            layout="wide"
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

          {/* --- Especificação --- */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Especificação</Label>
              {draft !== null && publishedVersion !== null && publishedVersion.id !== draft.id && (
                <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setSpecDiffOpen((open) => !open)}>
                  {specDiffOpen ? 'Ocultar mudanças' : 'Comparar com a publicada'}
                </Button>
              )}
            </div>
            {specDiffOpen && draft !== null && publishedVersion !== null ? (
              <RichDocDiffView
                before={publishedVersion.spec}
                after={draft.spec}
                beforeLabel={`Versão ${publishedVersion.number} (publicada)`}
                afterLabel={`Versão ${draft.number} (rascunho)`}
              />
            ) : (
              <RichDocEditor
                key={displayedVersion.id}
                target={{ kind: 'COMPONENT_VERSION_SPEC', versionId: displayedVersion.id }}
                value={displayedVersion.spec}
                editable={draft !== null}
                emptyLabel="Esta versão não tem especificação livre."
              />
            )}
          </div>

          {/* --- Vigência e versões --- */}
          {timeline.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm font-semibold">Vigência e versões</Label>
              {/* Clicar num segmento abre a **tela de Vigência** naquela data,
                  sem mexer nesta página nem na árvore: a pergunta que vem
                  depois de "quando esta regra mudou?" é sempre "e o que mais
                  valia naquele dia?" (docs/07 §10/§20.2, US-GOV-07). */}
              <MatrixTimelineBar
                segments={timeline}
                now={new Date()}
                selectedAt={new Date()}
                onSelectVersion={(versionId) => {
                  const segment = timeline.find((candidate) => candidate.versionId === versionId);
                  if (segment === undefined) return;
                  openPolicyAt(toDateInputValue(new Date(segment.effectiveFrom)));
                }}
              />
              {displayedVersion.effectiveFrom !== undefined && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit px-1 text-xs"
                  onClick={() => openPolicyAt(toDateInputValue(new Date(displayedVersion.effectiveFrom!)))}
                >
                  <CalendarClock className="mr-1.5 h-3.5 w-3.5" /> Ver a política inteira nesta data
                </Button>
              )}
            </div>
          )}
        </>
      )}

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
