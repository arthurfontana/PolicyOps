import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateChangeRequest } from '@/core/document/change-requests';
import type { ChangeRequest, CrAcceptanceCriterion } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';
import { useToast } from '@/components/ui/use-toast';

export interface AcceptanceCriteriaEditorProps {
  changeRequest: ChangeRequest;
  editable: boolean;
}

/**
 * Critérios de aceite (Dado/Quando/Então) — docs/14 §3.3, incentivado mas não
 * imposto para submeter (RN-GOV-03 não exige nenhum). `given`/`then` são
 * obrigatórios no schema (`CrAcceptanceCriterionSchema`); uma linha em
 * digitação fica fora do array até os dois estarem preenchidos, mesmo
 * raciocínio de `ImpactsEditor`.
 */
export function AcceptanceCriteriaEditor({ changeRequest, editable }: AcceptanceCriteriaEditorProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const [draft, setDraft] = useState<CrAcceptanceCriterion | null>(null);

  function save(next: CrAcceptanceCriterion[]): boolean {
    const result = dispatch(updateChangeRequest({ changeRequestId: changeRequest.id, acceptanceCriteria: next }));
    if (!result.ok) {
      toast({ title: 'Não foi possível salvar o critério de aceite', description: result.error.message });
    }
    return result.ok;
  }

  function removeRow(index: number) {
    save(changeRequest.acceptanceCriteria.filter((_, i) => i !== index));
  }

  function confirmDraft() {
    if (draft === null || draft.given.trim() === '' || draft.then.trim() === '') return;
    const criterion: CrAcceptanceCriterion = {
      given: draft.given.trim(),
      then: draft.then.trim(),
      ...(draft.when !== undefined && draft.when.trim() !== '' ? { when: draft.when.trim() } : {}),
    };
    if (save([...changeRequest.acceptanceCriteria, criterion])) setDraft(null);
  }

  return (
    <div className="flex flex-col gap-2">
      {changeRequest.acceptanceCriteria.length === 0 && draft === null && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">Nenhum critério de aceite ainda.</p>
      )}
      {changeRequest.acceptanceCriteria.map((criterion, index) => (
        <div key={index} className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
          <div className="flex-1">
            <p>
              <span className="font-semibold">Dado</span> {criterion.given}
            </p>
            {criterion.when !== undefined && (
              <p>
                <span className="font-semibold">Quando</span> {criterion.when}
              </p>
            )}
            <p>
              <span className="font-semibold">Então</span> {criterion.then}
            </p>
          </div>
          {editable && (
            <Button type="button" variant="ghost" size="icon" aria-label="Remover critério" onClick={() => removeRow(index)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      {draft !== null && (
        <div className="flex flex-col gap-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
          <Input
            autoFocus
            value={draft.given}
            onChange={(e) => setDraft({ ...draft, given: e.target.value })}
            placeholder="Dado (obrigatório)"
            className="h-8 text-xs"
          />
          <Input
            value={draft.when ?? ''}
            onChange={(e) => setDraft({ ...draft, when: e.target.value })}
            placeholder="Quando (opcional)"
            className="h-8 text-xs"
          />
          <Input
            value={draft.then}
            onChange={(e) => setDraft({ ...draft, then: e.target.value })}
            placeholder="Então (obrigatório)"
            className="h-8 text-xs"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={draft.given.trim() === '' || draft.then.trim() === ''}
              onClick={confirmDraft}
            >
              Adicionar
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {editable && draft === null && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setDraft({ given: '', then: '' })}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar critério
        </Button>
      )}
    </div>
  );
}
