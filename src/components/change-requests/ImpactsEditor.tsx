import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createCatalogItem } from '@/core/library/catalog';
import { CODE_REGEX, type ChangeRequest, type CrImpact } from '@/core/document/schema';
import { updateChangeRequest } from '@/core/document/change-requests';
import { normalizeValue } from '@/core/import/profile';
import { useDocumentStore } from '@/store/document-store';
import { useToast } from '@/components/ui/use-toast';

const NEW_CATEGORY = '__new_impact_category__';

function uniqueCode(label: string, existingCodes: Set<string>): string {
  const base = normalizeValue(label) || 'IMPACTO';
  if (!existingCodes.has(base)) return base;
  let suffix = 2;
  while (existingCodes.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function CategoryPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');

  if (document === null) return null;
  const allItems = document.catalog.filter((item) => item.kind === 'IMPACT_CATEGORY');
  const activeItems = allItems.filter((item) => item.archivedAt === undefined);

  function createAndSelect() {
    const label = newLabel.trim();
    if (label.length === 0) return;
    if (!CODE_REGEX.test(label) && normalizeValue(label) === '') {
      toast({ title: 'Não foi possível criar a categoria', description: 'Digite um nome com ao menos uma letra ou número.' });
      return;
    }
    const code = uniqueCode(label, new Set(allItems.map((item) => item.code)));
    const created = dispatch(createCatalogItem({ kind: 'IMPACT_CATEGORY', code, label }));
    if (!created.ok) {
      toast({ title: 'Não foi possível criar a categoria', description: created.error.message });
      return;
    }
    onChange(code);
    setCreating(false);
    setNewLabel('');
  }

  if (creating) {
    return (
      <div className="flex gap-1">
        <Input
          autoFocus
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Nome da categoria"
          className="h-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter') createAndSelect();
            if (e.key === 'Escape') setCreating(false);
          }}
        />
        <Button type="button" size="sm" className="h-8" onClick={createAndSelect}>
          Criar
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={value === '' ? undefined : value}
      onValueChange={(next) => (next === NEW_CATEGORY ? setCreating(true) : onChange(next))}
    >
      <SelectTrigger aria-label="Categoria de impacto" className="h-8 w-56 text-xs">
        <SelectValue placeholder="Categoria…" />
      </SelectTrigger>
      <SelectContent>
        {activeItems.map((item) => (
          <SelectItem key={item.code} value={item.code}>
            {item.label}
          </SelectItem>
        ))}
        <SelectItem value={NEW_CATEGORY}>+ Nova categoria…</SelectItem>
      </SelectContent>
    </Select>
  );
}

export interface ImpactsEditorProps {
  changeRequest: ChangeRequest;
  editable: boolean;
}

/**
 * Impactos do DB (docs/14 §3.3): categoria (catálogo `IMPACT_CATEGORY`) +
 * descrição opcional, por linha. `category` vazia nunca chega a
 * `changeRequest/update` — `assertCatalogCodes` recusaria (`CODE_REGEX` não
 * casa string vazia) — por isso uma linha nova fica **fora** do array até o
 * usuário escolher a categoria; só então ela entra de fato.
 */
export function ImpactsEditor({ changeRequest, editable }: ImpactsEditorProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const [draft, setDraft] = useState<{ category: string; description: string } | null>(null);

  function save(next: CrImpact[]) {
    const result = dispatch(updateChangeRequest({ changeRequestId: changeRequest.id, impacts: next }));
    if (!result.ok) {
      toast({ title: 'Não foi possível salvar os impactos', description: result.error.message });
    }
    return result.ok;
  }

  function updateRow(index: number, patch: Partial<CrImpact>) {
    const impact = changeRequest.impacts[index];
    if (impact === undefined) return;
    const next = changeRequest.impacts.map((candidate, i) => (i === index ? { ...candidate, ...patch } : candidate));
    save(next);
  }

  function removeRow(index: number) {
    save(changeRequest.impacts.filter((_, i) => i !== index));
  }

  function confirmDraft() {
    if (draft === null || draft.category === '') return;
    const impact: CrImpact = draft.description.trim() === '' ? { category: draft.category } : { category: draft.category, description: draft.description };
    if (save([...changeRequest.impacts, impact])) setDraft(null);
  }

  return (
    <div className="flex flex-col gap-2">
      {changeRequest.impacts.length === 0 && draft === null && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">Nenhum impacto registrado.</p>
      )}
      {changeRequest.impacts.map((impact, index) => (
        <div key={index} className="flex items-center gap-2">
          <CategoryPicker value={impact.category} onChange={(category) => updateRow(index, { category })} />
          <Input
            value={impact.description ?? ''}
            onChange={(e) => updateRow(index, { description: e.target.value === '' ? undefined : e.target.value })}
            placeholder="Descrição (opcional)"
            disabled={!editable}
            className="h-8 flex-1 text-xs"
          />
          {editable && (
            <Button type="button" variant="ghost" size="icon" aria-label="Remover impacto" onClick={() => removeRow(index)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      {draft !== null && (
        <div className="flex items-center gap-2">
          <CategoryPicker value={draft.category} onChange={(category) => setDraft({ ...draft, category })} />
          <Input
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Descrição (opcional)"
            className="h-8 flex-1 text-xs"
            autoFocus
          />
          <Button type="button" size="sm" disabled={draft.category === ''} onClick={confirmDraft}>
            Adicionar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
            Cancelar
          </Button>
        </div>
      )}
      {editable && draft === null && (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setDraft({ category: '', description: '' })}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar impacto
        </Button>
      )}
    </div>
  );
}
