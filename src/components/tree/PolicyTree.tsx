import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Archive,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  FileUp,
  FolderInput,
  Grid3x3,
  Plus,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/library/ConfirmDialog';
import { ToolbarPortal } from '@/components/shell/Toolbar';
import { PolicyToolbar } from '@/components/tree/PolicyToolbar';
import { MoveComponentDialog } from '@/components/tree/MoveComponentDialog';
import { AddMatrixNodeDialog } from '@/components/tree/AddMatrixNodeDialog';
import { TreeNodeRow } from '@/components/tree/TreeNodeRow';
import { PublishPendingComponentsDialog } from '@/components/dialogs/PublishPendingComponentsDialog';
import { MarkdownImportDialog } from '@/components/import/markdown/MarkdownImportDialog';
import {
  archiveComponent,
  componentDepth,
  createComponent,
  duplicateComponent,
  listChildren,
  moveComponent,
  subtreeIds,
  updateComponent,
} from '@/core/document/components';
import {
  POLICY_COMPONENT_MAX_DEPTH,
  POLICY_COMPONENT_TYPES,
  type ComponentReviewStatus,
  type PolicyComponent,
  type PolicyComponentType,
  type PolicyOpsDocument,
} from '@/core/document/schema';
import {
  componentPath,
  filterComponentTree,
  listPendingComponentVersions,
  resolveOpenVersion,
  type ComponentTreeFilterResult,
} from '@/core/queries';
import { COMPONENT_TYPE_ICONS, COMPONENT_TYPE_LABELS } from '@/lib/component-labels';
import { vigenciaText, versionBadge } from '@/lib/matrix-badges';
import { Badge } from '@/components/ui/badge';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { SIDEBAR_CODE_VISIBLE_WIDTH, useUiStore } from '@/store/ui-store';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

/**
 * Árvore da política — docs/07-ux-e-editor.md §17.1/§17.3, DEC-UX-001.
 * **A árvore é a barra lateral**: renderizada dentro de `Sidebar`, sob o
 * projeto aberto, com todos os níveis. Não há segundo painel de árvore na
 * tela.
 *
 * O que fica aqui: a lista de nós e a ergonomia de digitação em volume
 * (Enter cria irmão, Shift+Enter cria regra, Tab/Shift+Tab reparenta,
 * Ctrl/Cmd+D duplica, F2 renomeia, arrastar move). O que saiu para a barra de
 * ferramentas do shell (§2.1): criação, publicação em lote, busca, filtros e o
 * chip de alvo — este componente ainda é quem os monta, por `ToolbarPortal`,
 * porque o estado de criação e os diálogos vivem aqui (DEC-UX-006).
 *
 * **A árvore é sempre hoje** (DEC-UX-004, S43): ver o passado é uma tela de
 * consulta (a de Vigência, §10), não um estado desta árvore — nada aqui entra
 * em somente leitura por data.
 */

/** §17.1: a ordem é de leitura, e a tela diz isso — no `title`, não em duas linhas fixas. */
export const READING_ORDER_NOTE =
  'A ordem reflete o documento de política. A sequência de avaliação do motor está descrita no texto de cada regra.';

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
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const componentTree = useUiStore((s) => s.componentTree);
  const setComponentTreeProject = useUiStore((s) => s.setComponentTreeProject);
  const toggleComponentExpanded = useUiStore((s) => s.toggleComponentExpanded);
  const expandComponents = useUiStore((s) => s.expandComponents);
  const collapseComponents = useUiStore((s) => s.collapseComponents);
  const collapseAllComponents = useUiStore((s) => s.collapseAllComponents);
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
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null);
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

  // §17.1: nome truncado é pior que código ausente — abaixo de 340px o `code`
  // sai da linha e fica só no `title`.
  const showCode = sidebarWidth >= SIDEBAR_CODE_VISIBLE_WIDTH;

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

  // Nó de destino da criação pela barra (§2.1): o selecionado, se for deste
  // projeto; senão, a raiz da política.
  const targetComponent =
    document === null || selectedComponentId === null
      ? null
      : (document.components.find(
          (candidate) => candidate.id === selectedComponentId && candidate.projectId === projectId,
        ) ?? null);
  /** Destino de "pendurar matriz"/"carregar Markdown" pela barra: um nó `MATRIX` não recebe filhos (I27). */
  const targetParentId =
    targetComponent === null
      ? undefined
      : targetComponent.type === 'MATRIX'
        ? targetComponent.parentId
        : targetComponent.id;
  const targetPath =
    document === null || targetComponent === null
      ? null
      : componentPath(document, targetComponent.id)
          .map((component) => component.name)
          .join(' › ');

  // `Ctrl+Shift+P` publica os pendentes do projeto (§2.1, "teclado"). Só na
  // tela da política, e só quando existe o que publicar — o mesmo gate do
  // botão da barra.
  const publishPendingArmed = view === 'projects' && pendingCount > 0;
  useEffect(() => {
    if (!publishPendingArmed) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== 'p') return;
      event.preventDefault();
      setPublishPendingOpen(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [publishPendingArmed]);

  if (document === null) return null;

  function existingCodes(doc: PolicyOpsDocument): Set<string> {
    return new Set(doc.components.map((c) => c.code));
  }

  function startCreateRoot(type: PolicyComponentType = 'SECTION') {
    const roots = listChildren(document!, projectId, undefined);
    const last = roots[roots.length - 1];
    setDraft({ parentId: undefined, afterId: last?.id ?? null, type, value: '', levelOffset: 0 });
  }

  function startCreateSibling(component: PolicyComponent, type?: PolicyComponentType) {
    const base = siblingDraft(component);
    setDraft(type === undefined ? base : { ...base, type });
    if (component.parentId !== undefined) expandComponents([component.parentId]);
  }

  function startCreateChild(component: PolicyComponent, type: PolicyComponentType = 'SECTION') {
    if (component.type === 'MATRIX') return;
    const draftValue: Draft = {
      parentId: component.id,
      afterId: null,
      type,
      value: '',
      anchor: { id: component.id, parentId: component.parentId, type: component.type },
      levelOffset: 1,
    };
    setDraft(draftValue);
    expandComponents([component.id]);
  }

  /**
   * Criação disparada pela barra de ferramentas (§2.1): sem nó selecionado
   * nasce na raiz; com nó selecionado nasce **irmão** dele — a mesma semântica
   * do `Enter` na árvore, para a barra e a árvore nunca discordarem.
   */
  function startCreateAtTarget(type: PolicyComponentType) {
    if (targetComponent === null) {
      startCreateRoot(type);
      return;
    }
    startCreateSibling(targetComponent, type);
  }

  function handleArchive() {
    if (archiveTarget === null) return;
    const result = dispatch(archiveComponent({ componentId: archiveTarget.id }));
    if (!result.ok) {
      toast({ title: 'Não foi possível arquivar', description: result.error.message });
    } else if (selectedComponentId === archiveTarget.id) {
      setSelectedComponent(null);
    }
    setArchiveTarget(null);
  }

  /** `Recolher tudo` / `Expandir tudo` do cabeçalho do projeto (§17.1). */
  function expandAll() {
    expandComponents(
      document!.components
        .filter((component) => component.projectId === projectId && component.archivedAt === undefined)
        .map((component) => component.id),
    );
  }

  /** `Alt+clique` no chevron: a subárvore inteira daquele nó (§17.1). */
  function toggleSubtree(component: PolicyComponent, isExpanded: boolean) {
    const ids = [...subtreeIds(document!, component.id)];
    if (isExpanded) collapseComponents(ids);
    else expandComponents(ids);
  }

  /** Chip de alvo: rola a árvore até o nó, abrindo os ancestrais fechados. */
  function focusTarget() {
    if (targetComponent === null) return;
    const ancestors = componentPath(document!, targetComponent.id)
      .slice(0, -1)
      .map((component) => component.id);
    if (ancestors.length > 0) expandComponents(ancestors);
    const id = targetComponent.id;
    window.requestAnimationFrame(() => {
      const node = window.document.querySelector(`[data-component-id="${id}"]`);
      node?.scrollIntoView({ block: 'nearest' });
    });
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
    // A árvore é a barra lateral: pode ser clicada de qualquer tela, e o nó
    // selecionado só faz sentido na tela da política (§17.1).
    setView('projects');
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
        <TreeNodeRow
          role="treeitem"
          aria-selected={isSelected}
          aria-expanded={hasChildren ? isExpanded : undefined}
          tabIndex={0}
          draggable={!isRenaming}
          data-testid={`tree-node-${component.code}`}
          data-component-id={component.id}
          title={matrixVigencia ?? `${component.name} · ${component.code}`}
          depth={depth}
          icon={Icon}
          name={component.name}
          code={component.code}
          showCode={showCode}
          selected={isSelected}
          dimmed={isDimmed}
          hasChildren={hasChildren}
          expanded={isExpanded}
          expandTitle="Expandir (Alt+clique expande a subárvore inteira)"
          collapseTitle="Recolher (Alt+clique recolhe a subárvore inteira)"
          onToggleExpanded={(e) => {
            e.stopPropagation();
            if (e.altKey) {
              toggleSubtree(component, isExpanded);
              return;
            }
            toggleComponentExpanded(component.id);
          }}
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
              // Shift+Enter nasce regra; Enter herda o tipo do nó (§2.1/§17.3).
              startCreateSibling(component, e.shiftKey ? 'RULE' : undefined);
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
            isDropTarget && dropTarget?.position === 'inside' && 'ring-2 ring-blue-400',
            isDropTarget && dropTarget?.position === 'before' && 'border-t-2 border-blue-500',
            isDropTarget && dropTarget?.position === 'after' && 'border-b-2 border-blue-500',
          )}
          nameSlot={
            isRenaming ? (
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
            ) : undefined
          }
          badges={
            <>
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
            </>
          }
          trailing={
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
                  <DropdownMenuItem onSelect={() => startCreateChild(component, 'RULE')}>
                    <Plus className="mr-2 h-3.5 w-3.5" /> Nova regra
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
                <DropdownMenuItem onSelect={() => setArchiveTarget({ id: component.id, name: component.name })}>
                  <Archive className="mr-2 h-3.5 w-3.5" /> Arquivar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        {isExpanded && renderChildren(component.id, depth + 1)}
      </Fragment>
    );
  }

  return (
    <div data-testid="policy-tree" className="flex min-w-0 flex-col">
      {/*
        A barra de ferramentas da tela da política (§2.1) é montada aqui e
        injetada no slot do shell — só enquanto a tela da política está ativa:
        "só o que a tela faz". Navegar para a biblioteca ou para o grid deixa a
        faixa para quem estiver na frente.
      */}
      {view === 'projects' && (
        <ToolbarPortal>
          <PolicyToolbar
            pendingCount={pendingCount}
            onNewSection={() => startCreateAtTarget('SECTION')}
            onNewRule={() => startCreateAtTarget('RULE')}
            onAddMatrix={() => setMatrixDialog({ open: true, parentId: targetParentId })}
            onImportMarkdown={() => setMarkdownImportDialog({ open: true, parentId: targetParentId })}
            onPublishPending={() => setPublishPendingOpen(true)}
            search={search}
            onSearchChange={setComponentTreeSearch}
            types={types}
            onToggleType={toggleComponentTreeType}
            reviewStatuses={reviewStatuses}
            onToggleReviewStatus={toggleComponentTreeReviewStatus}
            facets={facets}
            tags={tags}
            onToggleTag={toggleComponentTreeTag}
            onClearFilters={clearComponentTreeFilter}
            targetPath={targetPath}
            onFocusTarget={focusTarget}
          />
        </ToolbarPortal>
      )}

      <div
        title={READING_ORDER_NOTE}
        className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500"
      >
        <span className="flex-1 truncate">Árvore da política</span>
        <button
          type="button"
          aria-label="Recolher tudo"
          title="Recolher tudo"
          onClick={collapseAllComponents}
          className="rounded p-0.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          <ChevronsDownUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Expandir tudo"
          title="Expandir tudo"
          onClick={expandAll}
          className="rounded p-0.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
        </button>
      </div>

      <div role="tree" aria-label="Árvore da política" className="flex flex-col">
        {renderChildren(undefined, 0)}
        {listChildren(document, projectId, undefined).length === 0 && draft === null && (
          <p className="px-2 py-3 text-center text-xs text-neutral-500 dark:text-neutral-400">
            Nenhum componente ainda. Comece pela primeira seção.
          </p>
        )}
      </div>

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
      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        title={`Arquivar "${archiveTarget?.name ?? ''}"?`}
        description="O componente e a subárvore dele sumem da árvore da política. O histórico de versões fica preservado no arquivo, e Ctrl+Z desfaz agora."
        confirmLabel="Arquivar"
        destructive
        onConfirm={handleArchive}
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
