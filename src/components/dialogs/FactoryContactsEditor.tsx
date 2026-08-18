import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { updateProject } from '@/core/document/commands';
import type { Project } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';

type Contact = { name: string; role?: string; email?: string };

export interface FactoryContactsEditorProps {
  project: Project;
}

/**
 * Contatos do Pacote para a Fábrica (docs/14 §8, S38) — solicitante,
 * interessados e demais pessoas que o boilerplate dos DBs atuais lista.
 * `role` é texto livre: "Solicitante", "Interessado" ou qualquer papel que a
 * política use, sem vocabulário fechado (mesma filosofia de `owner`/`by` no
 * resto do épico, DEC-GOV-004).
 */
export function FactoryContactsEditor({ project }: FactoryContactsEditorProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const [draft, setDraft] = useState<Contact | null>(null);
  const contacts = project.factoryTemplate?.contacts ?? [];

  function save(next: Contact[]) {
    const result = dispatch(updateProject({ projectId: project.id, factoryContacts: next.length === 0 ? null : next }));
    if (!result.ok) {
      toast({ title: 'Não foi possível salvar os contatos', description: result.error.message });
    }
    return result.ok;
  }

  function updateRow(index: number, patch: Partial<Contact>) {
    const next = contacts.map((candidate, i) => (i === index ? { ...candidate, ...patch } : candidate));
    save(next);
  }

  function removeRow(index: number) {
    save(contacts.filter((_, i) => i !== index));
  }

  function confirmDraft() {
    if (draft === null || draft.name.trim() === '') return;
    const contact: Contact = { name: draft.name.trim() };
    if ((draft.role ?? '').trim() !== '') contact.role = draft.role!.trim();
    if ((draft.email ?? '').trim() !== '') contact.email = draft.email!.trim();
    if (save([...contacts, contact])) setDraft(null);
  }

  return (
    <div className="flex flex-col gap-2">
      {contacts.length === 0 && draft === null && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">Nenhum contato registrado.</p>
      )}
      {contacts.map((contact, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={contact.name}
            onChange={(e) => updateRow(index, { name: e.target.value })}
            placeholder="Nome"
            className="h-8 flex-1 text-xs"
          />
          <Input
            value={contact.role ?? ''}
            onChange={(e) => updateRow(index, { role: e.target.value === '' ? undefined : e.target.value })}
            placeholder="Papel (Solicitante, Interessado…)"
            className="h-8 flex-1 text-xs"
          />
          <Input
            value={contact.email ?? ''}
            onChange={(e) => updateRow(index, { email: e.target.value === '' ? undefined : e.target.value })}
            placeholder="E-mail (opcional)"
            className="h-8 flex-1 text-xs"
          />
          <Button type="button" variant="ghost" size="icon" aria-label="Remover contato" onClick={() => removeRow(index)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {draft !== null && (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Nome"
            className="h-8 flex-1 text-xs"
          />
          <Input
            value={draft.role ?? ''}
            onChange={(e) => setDraft({ ...draft, role: e.target.value })}
            placeholder="Papel (Solicitante, Interessado…)"
            className="h-8 flex-1 text-xs"
          />
          <Input
            value={draft.email ?? ''}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            placeholder="E-mail (opcional)"
            className="h-8 flex-1 text-xs"
          />
          <Button type="button" size="sm" disabled={draft.name.trim() === ''} onClick={confirmDraft}>
            Adicionar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
            Cancelar
          </Button>
        </div>
      )}
      {draft === null && (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setDraft({ name: '' })}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar contato
        </Button>
      )}
    </div>
  );
}
