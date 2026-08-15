import { useEffect, useState } from 'react';
import { Archive, Copy, FolderInput } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ComponentTagsEditor } from '@/components/inspector/ComponentTagsEditor';
import { ConfirmDialog } from '@/components/library/ConfirmDialog';
import { MoveComponentDialog } from '@/components/tree/MoveComponentDialog';
import {
  archiveComponent,
  duplicateComponent,
  updateComponent,
  setComponentReviewStatus,
} from '@/core/document/components';
import { listChildren } from '@/core/document/components';
import { COMPONENT_REVIEW_STATUSES, type ComponentReviewStatus } from '@/core/document/schema';
import {
  COMPONENT_REVIEW_STATUS_LABELS,
  COMPONENT_REVIEW_STATUS_VARIANTS,
  COMPONENT_TYPE_ICONS,
  COMPONENT_TYPE_LABELS,
} from '@/lib/component-labels';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';
import { useToast } from '@/components/ui/use-toast';

/**
 * Campo desabilitado com o motivo em tooltip — payload de regra, versões e
 * vigência são da S33b (docs/prompts/S33a, "Inspector mínimo").
 */
function StubField({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col gap-1 opacity-50">
          <Label className="text-xs">{label}</Label>
          <Input disabled placeholder="—" />
        </div>
      </TooltipTrigger>
      <TooltipContent>Disponível na Sessão 33b.</TooltipContent>
    </Tooltip>
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

  const Icon = COMPONENT_TYPE_ICONS[component.type];
  const childCount = listChildren(document, component.projectId, component.id).length;

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
        <StubField label="Descrição de negócio" />
        <StubField label="Definição técnica" />
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button type="button" variant="outline" size="sm" disabled className="w-full">
                Criar rascunho
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Disponível na Sessão 33b.</TooltipContent>
        </Tooltip>
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
    </div>
  );
}
