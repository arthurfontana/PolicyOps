import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { createChangeRequestComponentItem } from '@/core/document/cr-drafts';
import { componentPath, filterComponentTree } from '@/core/queries';
import {
  PAYLOAD_KIND_BY_COMPONENT_TYPE,
  type ComponentPayload,
  type PolicyComponent,
  type PolicyComponentType,
} from '@/core/document/schema';
import { COMPONENT_TYPE_ICONS, COMPONENT_TYPE_LABELS } from '@/lib/component-labels';
import { useDocumentStore } from '@/store/document-store';

/** Tipos que um componente **novo** pode ter aqui — `MATRIX` é espelho e nasce na árvore (I27). */
const NEW_COMPONENT_TYPES: ReadonlyArray<Exclude<PolicyComponentType, 'MATRIX'>> = [
  'RULE',
  'LIST',
  'REASON_CODE',
  'POLICY_VARIABLE',
  'SECTION',
  'OTHER',
];

/** `code` sugerido a partir do nome — mesma convenção da carga por recorte (docs/14 §9). */
function suggestCode(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface AddChangeRequestItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Componentes já presentes no DB — RN-GOV-02, um componente entra uma vez só. */
  excludeComponentIds: string[];
  onPick: (componentId: string) => void;
  /** O DB que recebe o item — necessário para o caminho "criar componente novo". */
  changeRequestId: string;
}

/**
 * Seletor de componente para item do DB (US-GOV-03) — o mesmo padrão de
 * busca + lista clicável de `AddMatrixNodeDialog` (docs/07 §17.2), sobre a
 * árvore do projeto (`filterComponentTree`) em vez das matrizes livres.
 *
 * **Item `CREATE` (S36)**: quando o componente ainda não existe, a segunda aba
 * o cria **junto com o item e o rascunho**, numa transação só
 * (`changeRequest/createComponentItem`, docs/14 §3.3). Criar o nó pela árvore e
 * depois adicioná-lo aqui daria no mesmo, mas em três comandos — e desfazer o
 * primeiro deixaria o item apontando um componente que não existe mais (I30).
 */
export function AddChangeRequestItemDialog({
  open,
  onOpenChange,
  projectId,
  excludeComponentIds,
  onPick,
  changeRequestId,
}: AddChangeRequestItemDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<Exclude<PolicyComponentType, 'MATRIX'>>('RULE');
  const [proposed, setProposed] = useState('');

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setCreating(false);
    setName('');
    setCode('');
    setType('RULE');
    setProposed('');
  }, [open]);

  const excluded = useMemo(() => new Set(excludeComponentIds), [excludeComponentIds]);

  const candidates = useMemo<PolicyComponent[]>(() => {
    if (document === null) return [];
    const { matchedIds } = filterComponentTree(document, projectId, { search });
    return document.components.filter((component) => matchedIds.has(component.id) && !excluded.has(component.id));
  }, [document, projectId, search, excluded]);

  if (document === null) return null;

  const effectiveCode = code.trim() === '' ? suggestCode(name) : code.trim();
  const canCreate = name.trim() !== '' && effectiveCode !== '' && proposed.trim() !== '';

  function handleCreate() {
    const payload = {
      kind: PAYLOAD_KIND_BY_COMPONENT_TYPE[type],
      businessDescription: proposed.trim(),
    } as ComponentPayload;
    const result = dispatch(
      createChangeRequestComponentItem({
        changeRequestId,
        projectId,
        code: effectiveCode,
        name: name.trim(),
        type,
        payload,
        proposedSummary: proposed.trim(),
      }),
    );
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível criar o componente',
        description: result.error.message,
      });
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar item ao DB</DialogTitle>
          <DialogDescription>
            Escolha o componente afetado — regra, matriz, lista, reason code ou variável de política. Um
            componente entra uma vez só neste DB (RN-GOV-02).
          </DialogDescription>
        </DialogHeader>

        {creating ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              O componente nasce na raiz do projeto, sem versão vigente, e já com o rascunho da v1
              vinculado a este DB — tudo numa transação só. A v1 entra em vigor quando o DB for
              publicado.
            </p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-item-name" className="text-xs">
                Nome <span className="text-red-500">*</span>
              </Label>
              <Input
                id="new-item-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Cineminha do G7"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="new-item-code" className="text-xs">
                  Código
                </Label>
                <Input
                  id="new-item-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={suggestCode(name) === '' ? 'REGRA_NOVA' : suggestCode(name)}
                  className="font-mono"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Tipo</Label>
                <Select
                  value={type}
                  onValueChange={(value) => setType(value as Exclude<PolicyComponentType, 'MATRIX'>)}
                >
                  <SelectTrigger aria-label="Tipo do componente novo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NEW_COMPONENT_TYPES.map((candidate) => (
                      <SelectItem key={candidate} value={candidate}>
                        {COMPONENT_TYPE_LABELS[candidate]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-item-proposed" className="text-xs">
                O que a nova regra faz <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="new-item-proposed"
                value={proposed}
                onChange={(e) => setProposed(e.target.value)}
                className="min-h-[72px] text-sm"
                placeholder="Vira o texto do 'proposto' e a descrição de negócio da v1."
              />
            </div>
          </div>
        ) : (
        <div className="flex flex-col gap-3">
          <Input
            placeholder="Buscar por código ou nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />

          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto" role="listbox" aria-label="Componentes disponíveis">
            {candidates.length === 0 && (
              <li className="rounded-md bg-neutral-50 p-3 text-center text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                Nenhum componente corresponde ao filtro.
              </li>
            )}
            {candidates.map((component) => {
              const Icon = COMPONENT_TYPE_ICONS[component.type];
              const path = componentPath(document, component.id);
              const breadcrumb = path.slice(0, -1).map((ancestor) => ancestor.name).join(' › ');
              return (
                <li key={component.id}>
                  <button
                    type="button"
                    role="option"
                    onClick={() => {
                      onOpenChange(false);
                      onPick(component.id);
                    }}
                    className="flex w-full items-start gap-2 rounded-md border border-neutral-200 p-2 text-left text-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                          {component.name}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-neutral-400">{component.code}</span>
                      </div>
                      {breadcrumb.length > 0 && (
                        <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">{breadcrumb}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-neutral-400">{COMPONENT_TYPE_LABELS[component.type]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {creating ? (
            <>
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                Voltar à busca
              </Button>
              <Button type="button" onClick={handleCreate} disabled={!canCreate}>
                Criar e incluir
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Criar componente novo
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
