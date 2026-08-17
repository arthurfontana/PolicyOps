import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateChangeRequest } from '@/core/document/change-requests';
import type { ChangeRequest, CrTestScenario } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';
import { useToast } from '@/components/ui/use-toast';

export interface TestScenariosEditorProps {
  changeRequest: ChangeRequest;
  editable: boolean;
}

/** Cenários de teste (docs/14 §3.3): tipo livre (ex. "Funcional", "Regressão") + descrição. */
export function TestScenariosEditor({ changeRequest, editable }: TestScenariosEditorProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const [draft, setDraft] = useState<CrTestScenario | null>(null);

  function save(next: CrTestScenario[]): boolean {
    const result = dispatch(updateChangeRequest({ changeRequestId: changeRequest.id, testScenarios: next }));
    if (!result.ok) {
      toast({ title: 'Não foi possível salvar o cenário de teste', description: result.error.message });
    }
    return result.ok;
  }

  function removeRow(index: number) {
    save(changeRequest.testScenarios.filter((_, i) => i !== index));
  }

  function confirmDraft() {
    if (draft === null || draft.kind.trim() === '' || draft.description.trim() === '') return;
    if (save([...changeRequest.testScenarios, { kind: draft.kind.trim(), description: draft.description.trim() }])) {
      setDraft(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {changeRequest.testScenarios.length === 0 && draft === null && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">Nenhum cenário de teste ainda.</p>
      )}
      {changeRequest.testScenarios.map((scenario, index) => (
        <div key={index} className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
          <div className="flex-1">
            <p className="font-semibold">{scenario.kind}</p>
            <p>{scenario.description}</p>
          </div>
          {editable && (
            <Button type="button" variant="ghost" size="icon" aria-label="Remover cenário" onClick={() => removeRow(index)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      {draft !== null && (
        <div className="flex flex-col gap-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
          <Input
            autoFocus
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            placeholder="Tipo (ex.: Funcional, Regressão)"
            className="h-8 text-xs"
          />
          <Input
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Descrição"
            className="h-8 text-xs"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={draft.kind.trim() === '' || draft.description.trim() === ''}
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
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setDraft({ kind: '', description: '' })}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar cenário
        </Button>
      )}
    </div>
  );
}
