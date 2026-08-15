import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCheck, ChevronDown, ChevronRight, Copy, FileUp, FolderInput, Grid3x3, Plus, Search } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TagFilterBar } from '@/components/projects/TagFilterBar';
import { MoveComponentDialog } from '@/components/tree/MoveComponentDialog';
import { AddMatrixNodeDialog } from '@/components/tree/AddMatrixNodeDialog';
import { PublishPendingComponentsDialog } from '@/components/dialogs/PublishPendingComponentsDialog';
import { MarkdownImportDialog } from '@/components/import/markdown/MarkdownImportDialog';
import {
  componentDepth,
  createComponent,
  duplicateComponent,
  listChildren,
  moveComponent,
  subtreeIds,
  updateComponent,
} from '@/core/document/components';
import {
  COMPONENT_REVIEW_STATUSES,
  POLICY_COMPONENT_MAX_DEPTH,
  POLICY_COMPONENT_TYPES,
  type ComponentReviewStatus,
  type PolicyComponent,
  type PolicyComponentType,
  type PolicyOpsDocument,
} from '@/core/document/schema';
import {
  filterComponentTree,
  listPendingComponentVersions,
  resolveOpenVersion,
  type ComponentTreeFilterResult,
} from '@/core/queries';
import { COMPONENT_REVIEW_STATUS_LABELS, COMPONENT_TYPE_ICONS, COMPONENT_TYPE_LABELS } from '@/lib/component-labels';
import { vigenciaText, versionBadge } from '@/lib/matrix-badges';
import { Badge } from '@/components/ui/badge';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

/**
 * Árvore da política — docs/07-ux-e-editor.md §17.1/§17.3. O painel que
 * transforma o projeto em sumário navegável: expandir/recolher, busca,
 * filtro por tipo/revisão/faceta, e a ergonomia de digitação em volume
 * (Enter cria irmão, Tab/Shift+Tab reparenta, Ctrl/Cmd+D duplica) — sem ela
 * a sessão não cumpre o objetivo de montar ~50 seções em menos de 30 min.
 */

const CREATABLE_TYPES = POLICY_COMPONENT_TYPES.filter((type) => type !== 'MATRIX');

// Referências estáveis para quando o filtro não é do projeto atual — um `[]`
// literal novo a cada render faria o `useMemo` do filtro recalcular sempre.
const EMPTY_TYPES: PolicyComponentType[] = [];
const EMPTY_REVIEW_STATUSES: ComponentReviewStatus[] = [];
const EMPTY_TAGS: string[] = [];

type DraftAnchor = { id: string; parentId: string | undefined; type: PolicyComponentType };

type Draft = {
  parentId: string | undefined;
  /** `null` = fim da lista de irmãos. */
  afterId: string | null;
  type: PolicyComponentType;
  value: string;
  /** Ausente para rascunhos criados pelo botão de raiz — sem Tab/Shift+Tab. */
  anchor?: DraftAnchor;
  levelOffset: -1 | 0 | 1;
};

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function suggestComponentCode(name: string, existingCodes: Set<string>): string {
  const slug = stripDiacritics(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = slug === '' ? 'COMPONENTE' : slug;
  if (!existingCodes.has(base)) return base;
  let suffix = 2;
  let candidate = `${base}_${suffix}`;
  while (existingCodes.has(candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  return candidate;
}

function siblingDraft(anchor: PolicyComponent, value = ''): Draft {
  return {
    parentId: anchor.parentId,
    afterId: anchor.id,
    type: anchor.type === 'MATRIX' ? 'SECTION' : anchor.type,
    value,
    anchor: { id: anchor.id, parentId: anchor.parentId, type: anchor.type },
    levelOffset: 0,
  };
}

function isFilterActive(state: { search: string; types: PolicyComponentType[]; reviewStatuses: ComponentReviewStatus[]; tags: string[] }): boolean {
  return (
    state.search.trim() !== '' || state.types.length > 0 || state.reviewStatuses.length > 0 || state.tags.length > 0
  );
}

export interface PolicyTreeProps {
  projectId: string;
}

export function PolicyTree({ projectId }: PolicyTreeProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const selectedComponentId = useEditorStore((s) => s.selectedComponentId);
  const setSelectedComponent = useEditorStore((s) => s.setSelectedComponent);
  const openMatrix = useEditorStore((s) => s.openMatrix);
  const setView = useUiStore((s) => s.setView);
  const componentTree = useUiStore((s) => s.componentTree);
  const setComponentTreeProject = useUiStore((s) => s.setComponentTreeProject);
  const toggleComponentExpanded = useUiStore((s) => s.toggleComponentExpanded);
  const expandComponents = useUiStore((s) => s.expandComponents);
  const setComponentTreeSearch = useUiStore((s) => s.setComponentTreeSearch);
  const toggleComponentTreeType = useUiStore((s) => s.toggleComponentTreeType);
  const toggleComponentTreeReviewStatus = useUiStore((s) => s.toggleComponentTreeReviewStatus);
  const toggleComponentTreeTag = useUiStore((s) => s.toggleComponentTreeTag);
  const clearComponentTreeFilter = useUiStore((s) => s.clearComponentTreeFilter);
  const { toast } = useToast();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' | 'inside' } | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
  const [matrixDialog, setMatrixDialog] = useState<{ open: boolean; parentId: string | undefined }>({
    open: false,
    parentId: undefined,
  });
  const [publishPendingOpen, setPublishPendingOpen] = useState(false);
  const [markdownImportDialog, setMarkdownImportDialog] = useState<{ open: boolean; parentId: string | undefined }>({
    open: false,
    parentId: undefined,
  });
  const suppressBlurRef = useRef(false);

  const pendingCount = useMemo(
    () => (document === null ? 0 : listPendingComponentVersions(document, projectId).length),
    [document, projectId],
  );

  useEffect(() => {
    setComponentTreeProject(projectId);
  }, [projectId, setComponentTreeProject]);

  useEffect(() => {
    suppressBlurRef.current = false;
  }, [draft]);

  const filterIsCurrent = componentTree.projectId === projectId;
  const search = filterIsCurrent ? componentTree.search : '';
  const types = filterIsCurrent ? componentTree.types : EMPTY_TYPES;
  const reviewStatuses = filterIsCurrent ? componentTree.reviewStatuses : EMPTY_REVIEW_STATUSES;
  const tags = filterIsCurrent ? componentTree.tags : EMPTY_TAGS;
  const expanded = filterIsCurrent ? componentTree.expanded : {};

  const filterActive = isFilterActive({ search, types, reviewStatuses, tags });

  const { matchedIds, visibleIds, facets } = useMemo<ComponentTreeFilterResult>(() => {
    if (document === null) return { matchedIds: new Set<string>(), visibleIds: new Set<string>(), facets: [] };
    return filterComponentTree(document, projectId, { search, types, reviewStatuses, tags });
  }, [document, projectId, search, types, reviewStatuses, tags]);

  if (document === null) return null;

  function existingCodes(doc: PolicyOpsDocument): Set<string> {
    return new Set(doc.components.map((c) => c.code));
  }

  function startCreateRoot() {
    const roots = listChildren(document!, projectId, undefined);
    const last = roots[roots.length - 1];
    setDraft({ parentId: undefined, afterId: last?.id ?? null, type: 'SECTION', value: '', levelOffset: 0 });
  }

  function startCreateSibling(component: PolicyComponent) {
    setDraft(siblingDraft(component));
    if (component.parentId !== undefined) expandComponents([component.parentId]);
  }

  function startCreateChild(component: PolicyComponent) {
    if (component.type === 'MATRIX') return;
    const draftValue: Draft = {
      parentId: component.id,
      afterId: null,
      type: 'SECTION',
      value: '',
      anchor: { id: component.id, parentId: component.parentId, type: component.type },
      levelOffset: 1,
    };
    setDraft(draftValue);
    expandComponents([component.id]);
  }

  function handleDraftTab(direction: 1 | -1) {
    setDraft((current) => {
      if (current === null || current.anchor === undefined) return current;
      const { anchor, levelOffset } = current;
      if (direction === 1) {
        if (levelOffset === 1) return current;
        if (levelOffset === -1) return { ...current, levelOffset: 0, parentId: anchor.parentId, afterId: anchor.id };
        // 0 -> 1: filho do anchor.
        if (anchor.type === 'MATRIX') return current;
        const anchorComponent = document!.components.find((c) => c.id === anchor.id);
        if (anchorComponent === undefined) return current;
        if (componentDepth(document!, anchorComponent) + 1 > POLICY_COMPONENT_MAX_DEPTH) return current;
        return { ...current, levelOffset: 1, parentId: anchor.id, afterId: null };
      }
      // Shift+Tab
      if (levelOffset === -1) return current;
      if (levelOffset === 1) return { ...current, levelOffset: 0, parentId: anchor.parentId, afterId: anchor.id };
      // 0 -> -1: sobe um nível, vira irmão do pai do anchor.
      if (anchor.parentId === undefined) return current;
      const parent = document!.components.find((c) => c.id === anchor.parentId);
      if (parent === undefined) return current;
      return { ...current, levelOffset: -1, parentId: parent.parentId, afterId: parent.id };
    });
  }

  // Lê `draft` do fechamento do render atual (não da forma funcional de
  // `setDraft`): esta função roda a partir de eventos (Enter/blur), nunca de
  // dentro de outro updater — despachar comando dentro de um updater seria
  // impuro (o StrictMode chama o updater duas vezes, dobrando a criação).
  function commitDraft(chain: boolean) {
    if (draft === null) return;
    const trimmed = draft.value.trim();
    if (trimmed.length === 0) {
      setDraft(null);
      return;
    }

    const doc = useDocumentStore.getState().document;
    if (doc === null) return;
    const code = suggestComponentCode(trimmed, existingCodes(doc));
    const result = dispatch(
      createComponent({
        projectId,
        code,
        name: trimmed,
        type: draft.type,
        ...(draft.parentId === undefined ? {} : { parentId: draft.parentId }),
      }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível criar o componente', description: result.error.message });
      return;
    }
    const newId = result.data.componentId;

    const freshDoc = useDocumentStore.getState().document;
    if (freshDoc !== null && draft.afterId !== null) {
      const siblings = listChildren(freshDoc, projectId, draft.parentId);
      const afterIndex = siblings.findIndex((c) => c.id === draft.afterId);
      const desired = afterIndex === -1 ? siblings.length - 1 : afterIndex + 1;
      const created = siblings.find((c) => c.id === newId);
      if (created !== undefined && created.position !== desired) {
        dispatch(moveComponent({ componentId: newId, position: desired }));
      }
    }
    if (draft.parentId !== undefined) expandComponents([draft.parentId]);
    setSelectedComponent(newId);

    if (!chain) {
      setDraft(null);
      return;
    }
    suppressBlurRef.current = true;
    setDraft({
      parentId: draft.parentId,
      afterId: newId,
      type: draft.type,
      value: '',
      anchor: { id: newId, parentId: draft.parentId, type: draft.type },
      levelOffset: 0,
    });
  }

  function cancelDraft() {
    suppressBlurRef.current = true;
    setDraft(null);
  }

  function startRename(component: PolicyComponent) {
    setRenaming({ id: component.id, value: component.name });
  }

  function commitRename() {
    if (renaming === null) return;
    const trimmed = renaming.value.trim();
    const target = document!.components.find((c) => c.id === renaming.id);
    setRenaming(null);
    if (target === undefined || trimmed.length === 0 || trimmed === target.name) return;
    const result = dispatch(updateComponent({ componentId: target.id, name: trimmed }));
    if (!result.ok) {
      toast({ title: 'Não foi possível renomear', description: result.error.message });
    }
  }

  function handleDuplicate(component: PolicyComponent) {
    const result = dispatch(duplicateComponent({ componentId: component.id }));
    if (!result.ok) {
      toast({ title: 'Não foi possível duplicar', description: result.error.message });
      return;
    }
    if (component.parentId !== undefined) expandComponents([component.parentId]);
    setSelectedComponent(result.data.componentId);
  }

  function handleSelect(component: PolicyComponent) {
    if (component.type === 'MATRIX') {
      if (component.matrixId === undefined) return;
      const matrix = document!.matrices.find((m) => m.id === component.matrixId);
      const version = matrix === undefined ? null : resolveOpenVersion(matrix);
      openMatrix(component.matrixId, version?.id ?? null);
      setView('matrix');
      return;
    }
    setSelectedComponent(component.id);
  }

  function handleDrop(targetId: string) {
    const sourceId = draggingId;
    setDraggingId(null);
    const target = dropTarget;
    setDropTarget(null);
    if (sourceId === null || target === null || sourceId === targetId) return;
    const doc = useDocumentStore.getState().document;
    if (doc === null) return;
    const targetComponent = doc.components.find((c) => c.id === targetId);
    if (targetComponent === undefined) return;
    if (subtreeIds(doc, sourceId).has(targetId)) return;

    let parentId: string | undefined;
    let position: number | undefined;
    if (target.position === 'inside') {
      if (targetComponent.type === 'MATRIX') return;
      parentId = targetComponent.id;
      position = undefined;
    } else {
      parentId = targetComponent.parentId;
      const siblings = listChildren(doc, projectId, parentId).filter((c) => c.id !== sourceId);
      const index = siblings.findIndex((c) => c.id === targetId);
      position = target.position === 'before' ? index : index + 1;
    }
    const result = dispatch(
      moveComponent({ componentId: sourceId, parentId: parentId ?? null, position }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível mover', description: result.error.message });
      return;
    }
    if (parentId !== undefined) expandComponents([parentId]);
  }

  function draftFor(parentId: string | undefined): Draft | null {
    return draft !== null && draft.parentId === parentId ? draft : null;
  }

  function renderChildren(parentId: string | undefined, depth: number): ReactNode[] {
    const children = listChildren(document!, projectId, parentId);
    const nodes: ReactNode[] = [];
    const pendingDraft = draftFor(parentId);

    if (pendingDraft !== null && pendingDraft.afterId === null && children.length === 0) {
      nodes.push(renderDraftRow(pendingDraft, depth));
    }

    children.forEach((child) => {
      if (filterActive && !visibleIds.has(child.id)) return;
      nodes.push(renderNode(child, depth));
      if (pendingDraft !== null && pendingDraft.afterId === child.id) {
        nodes.push(renderDraftRow(pendingDraft, depth));
      }
    });

    if (pendingDraft !== null && pendingDraft.afterId === null && children.length > 0) {
      nodes.push(renderDraftRow(pendingDraft, depth));
    }

    return nodes;
  }

  function renderDraftRow(current: Draft, depth: number) {
    return (
      <div
        key="__draft__"
        style={{ paddingLeft: depth * 16 }}
        className="flex items-center gap-1.5 rounded-md bg-blue-50 py-1 pr-2 dark:bg-blue-950/40"
      >
        <span className="w-5 shrink-0" />
        <select
          aria-label="Tipo do novo componente"
          value={current.type}
          // Escolher o tipo tira o foco do campo de nome antes do `onChange`
          // disparar — sem suprimir o blur, o nome (ainda vazio na primeira
          // interação) comitaria cedo demais e descartaria o rascunho, ou
          // gravaria com o tipo antigo. Mesmo padrão de supressão do Tab
          // acima; o `useEffect` que zera `suppressBlurRef` a cada troca de
          // `draft` cobre a troca de tipo também.
          onMouseDown={() => {
            suppressBlurRef.current = true;
          }}
          onChange={(e) => setDraft({ ...current, type: e.target.value as PolicyComponentType })}
          className="h-7 shrink-0 rounded border border-neutral-300 bg-white text-xs dark:border-neutral-700 dark:bg-neutral-900"
        >
          {CREATABLE_TYPES.map((type) => (
            <option key={type} value={type}>
              {COMPONENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <Input
          autoFocus
          aria-label="Nome do novo componente"
          value={current.value}
          placeholder="Nome…"
          onChange={(e) => setDraft({ ...current, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft(true);
            } else if (e.key === 'Tab') {
              e.preventDefault();
              suppressBlurRef.current = true;
              handleDraftTab(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelDraft();
            }
          }}
          onBlur={() => {
            if (suppressBlurRef.current) return;
            commitDraft(false);
          }}
          className="h-7 flex-1 text-sm"
        />
      </div>
    );
  }

  function renderNode(component: PolicyComponent, depth: number): ReactNode {
    const children = listChildren(document!, projectId, component.id);
    const hasChildren = children.length > 0;
    const isExpanded = filterActive || !!expanded[component.id] || draft?.parentId === component.id;
    const isDimmed = filterActive && !matchedIds.has(component.id);
    const isSelected = selectedComponentId === component.id;
    const Icon = COMPONENT_TYPE_ICONS[component.type];
    const isRenaming = renaming?.id === component.id;
    const descendantCount = hasChildren ? subtreeIds(document!, component.id).size - 1 : 0;
    const isDropTarget = dropTarget?.id === component.id;

    let matrixBadge: ReturnType<typeof versionBadge> | null = null;
    let matrixVigencia: string | null = null;
    if (component.type === 'MATRIX' && component.matrixId !== undefined) {
      const matrix = document!.matrices.find((m) => m.id === component.matrixId);
      const version = matrix === undefined ? null : resolveOpenVersion(matrix);
      if (version !== null) {
        matrixBadge = versionBadge(version);
        matrixVigencia = vigenciaText(version);
      }
    }

    // Regra/seção/etc versionada mostra o mesmo tipo de badge — rascunho tem
    // prioridade (é o que está sendo editado agora), senão a publicada.
    let componentBadge: ReturnType<typeof versionBadge> | null = null;
    if (component.type !== 'MATRIX' && component.versions.length > 0) {
      const shown =
        component.versions.find((v) => v.state === 'DRAFT') ??
        component.versions.find((v) => v.state === 'PUBLISHED') ??
        null;
      if (shown !== null) componentBadge = versionBadge(shown);
    }

    return (
      <Fragment key={component.id}>
        <div
          role="treeitem"
          aria-selected={isSelected}
          aria-expanded={hasChildren ? isExpanded : undefined}
          tabIndex={0}
          draggable={!isRenaming}
          style={{ paddingLeft: depth * 16 }}
          data-testid={`tree-node-${component.code}`}
          title={matrixVigencia ?? undefined}
          onDragStart={(e) => {
            e.stopPropagation();
            setDraggingId(component.id);
          }}
          onDragOver={(e) => {
            if (draggingId === null || draggingId === component.id) return;
            e.preventDefault();
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientY - rect.top) / rect.height;
            const position = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
            setDropTarget({ id: component.id, position: position === 'inside' && component.type === 'MATRIX' ? 'after' : position });
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDrop(component.id);
          }}
          onDragEnd={() => {
            setDraggingId(null);
            setDropTarget(null);
          }}
          onClick={() => handleSelect(component)}
          onDoubleClick={() => startRename(component)}
          onKeyDown={(e) => {
            if (isRenaming) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              startCreateSibling(component);
            } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
              e.preventDefault();
              handleDuplicate(component);
            } else if (e.key === 'F2') {
              e.preventDefault();
              startRename(component);
            } else if (e.key === 'ArrowRight' && hasChildren && !isExpanded) {
              e.preventDefault();
              toggleComponentExpanded(component.id);
            } else if (e.key === 'ArrowLeft' && hasChildren && isExpanded) {
              e.preventDefault();
              toggleComponentExpanded(component.id);
            }
          }}
          className={cn(
            'group flex items-center gap-1.5 rounded-md py-1 pr-1 text-sm outline-none',
            'focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600',
            isSelected && 'bg-neutral-200 dark:bg-neutral-800',
            !isSelected && 'hover:bg-neutral-100 dark:hover:bg-neutral-800/60',
            isDimmed && 'opacity-40',
            isDropTarget && dropTarget?.position === 'inside' && 'ring-2 ring-blue-400',
            isDropTarget && dropTarget?.position === 'before' && 'border-t-2 border-blue-500',
            isDropTarget && dropTarget?.position === 'after' && 'border-b-2 border-blue-500',
          )}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={isExpanded ? `Recolher ${component.name}` : `Expandir ${component.name}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleComponentExpanded(component.id);
              }}
              className="flex h-5 w-5 shrink-0 items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}

          <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />

          {isRenaming ? (
            <Input
              autoFocus
              aria-label={`Renomear ${component.name}`}
              value={renaming.value}
              onChange={(e) => setRenaming({ id: component.id, value: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenaming(null);
                }
              }}
              className="h-6 flex-1 text-sm"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-neutral-900 dark:text-neutral-100">{component.name}</span>
          )}

          {!isRenaming && (
            <span className="shrink-0 font-mono text-[10px] text-neutral-400">{component.code}</span>
          )}

          {(matrixBadge ?? componentBadge) !== null && (
            <Badge variant={(matrixBadge ?? componentBadge)!.variant} className="shrink-0 px-1.5 py-0 text-[10px]">
              {(matrixBadge ?? componentBadge)!.label}
            </Badge>
          )}

          {component.reviewStatus === 'PENDING_REVIEW' && (
            <span title="Aguardando revisão" className="shrink-0 text-amber-500">
              ⚠
            </span>
          )}

          {hasChildren && (
            <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-600">{descendantCount}</span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Mais ações para ${component.name}`}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 rounded p-0.5 text-neutral-400 opacity-0 group-hover:opacity-100 hover:text-neutral-700 focus:opacity-100 dark:hover:text-neutral-200"
              >
                ⋯
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {component.type !== 'MATRIX' && (
                <DropdownMenuItem onSelect={() => startCreateChild(component)}>
                  <Plus className="mr-2 h-3.5 w-3.5" /> Novo filho
                </DropdownMenuItem>
              )}
              {component.type !== 'MATRIX' && (
                <DropdownMenuItem onSelect={() => setMatrixDialog({ open: true, parentId: component.id })}>
                  <Grid3x3 className="mr-2 h-3.5 w-3.5" /> Adicionar matriz…
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => startRename(component)}>Renomear</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMoveTargetId(component.id)}>
                <FolderInput className="mr-2 h-3.5 w-3.5" /> Mover para…
              </DropdownMenuItem>
              {component.type !== 'MATRIX' && (
                <DropdownMenuItem onSelect={() => handleDuplicate(component)}>
                  <Copy className="mr-2 h-3.5 w-3.5" /> Duplicar
                </DropdownMenuItem>
              )}
              {component.type !== 'MATRIX' && (
                <DropdownMenuItem onSelect={() => setMarkdownImportDialog({ open: true, parentId: component.id })}>
                  <FileUp className="mr-2 h-3.5 w-3.5" /> Carregar Markdown aqui…
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {isExpanded && renderChildren(component.id, depth + 1)}
      </Fragment>
    );
  }

  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
      <div className="flex flex-col gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Árvore da política</h2>
          <div className="flex gap-1">
            <Button type="button" size="sm" variant="outline" onClick={startCreateRoot}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Nova seção
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setMatrixDialog({ open: true, parentId: undefined })}
            >
              <Grid3x3 className="mr-1 h-3.5 w-3.5" /> Pendurar matriz
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setMarkdownImportDialog({ open: true, parentId: undefined })}
            >
              <FileUp className="mr-1 h-3.5 w-3.5" /> Carregar Markdown
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pendingCount === 0}
              onClick={() => setPublishPendingOpen(true)}
            >
              <CheckCheck className="mr-1 h-3.5 w-3.5" /> Publicar pendentes{pendingCount > 0 ? ` (${pendingCount})` : ''}
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <Input
            value={search}
            onChange={(e) => setComponentTreeSearch(e.target.value)}
            placeholder="Buscar por nome ou código…"
            className="h-8 pl-7 text-sm"
            aria-label="Buscar na árvore"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {POLICY_COMPONENT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={types.includes(type)}
              onClick={() => toggleComponentTreeType(type)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                types.includes(type)
                  ? 'border-neutral-900 bg-neutral-900 text-neutral-50 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                  : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800',
              )}
            >
              {COMPONENT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {COMPONENT_REVIEW_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={reviewStatuses.includes(status)}
              onClick={() => toggleComponentTreeReviewStatus(status)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                reviewStatuses.includes(status)
                  ? 'border-neutral-900 bg-neutral-900 text-neutral-50 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                  : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800',
              )}
            >
              {COMPONENT_REVIEW_STATUS_LABELS[status]}
            </button>
          ))}
        </div>

        <TagFilterBar facets={facets} selected={tags} onToggle={toggleComponentTreeTag} onClear={clearComponentTreeFilter} />
      </div>

      <div role="tree" aria-label="Árvore da política" className="flex-1 overflow-y-auto p-2">
        {renderChildren(undefined, 0)}
        {listChildren(document, projectId, undefined).length === 0 && draft === null && (
          <p className="p-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Nenhum componente ainda. Comece pela primeira seção.
          </p>
        )}
      </div>

      <p className="border-t border-neutral-200 p-2 text-[11px] text-neutral-400 dark:border-neutral-800 dark:text-neutral-600">
        A ordem reflete o documento de política. A sequência de avaliação do motor está descrita no
        texto de cada regra.
      </p>

      {moveTargetId !== null && (
        <MoveComponentDialog
          open
          onOpenChange={(open) => {
            if (!open) setMoveTargetId(null);
          }}
          componentId={moveTargetId}
        />
      )}
      <AddMatrixNodeDialog
        open={matrixDialog.open}
        onOpenChange={(open) => setMatrixDialog((s) => ({ ...s, open }))}
        projectId={projectId}
        parentId={matrixDialog.parentId}
        onCreated={(componentId) => {
          if (matrixDialog.parentId !== undefined) expandComponents([matrixDialog.parentId]);
          setSelectedComponent(componentId);
        }}
      />
      <PublishPendingComponentsDialog
        open={publishPendingOpen}
        onOpenChange={setPublishPendingOpen}
        projectId={projectId}
        foundationEffectiveFrom={document.projects.find((p) => p.id === projectId)?.foundationEffectiveFrom}
        onPublished={(count) => {
          toast({ title: `${count} componente(s) publicado(s)` });
        }}
      />
      <MarkdownImportDialog
        open={markdownImportDialog.open}
        onOpenChange={(open) => setMarkdownImportDialog((s) => ({ ...s, open }))}
        projectId={projectId}
        initialParentId={markdownImportDialog.parentId}
        foundationEffectiveFrom={document.projects.find((p) => p.id === projectId)?.foundationEffectiveFrom}
        onImported={(count) => {
          if (markdownImportDialog.parentId !== undefined) expandComponents([markdownImportDialog.parentId]);
          toast({ title: `${count} componente(s) carregado(s)` });
        }}
      />
    </div>
  );
}
