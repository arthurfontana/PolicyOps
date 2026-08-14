import { useState } from 'react';
import { Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { getErrorMessage } from '@/core/error-messages';
import { setAcl } from '@/core/document/commands';
import { isOpenMode } from '@/core/document/roles';
import { ROLES, type AclEntry, type DefaultRole, type Role } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';
import { useEffectiveRole } from '@/hooks/useRole';

const ROLE_LABELS: Record<Role, string> = {
  READER: 'Leitor',
  EDITOR: 'Editor',
  PUBLISHER: 'Publicador',
  ADMIN: 'Administrador',
};

const DEFAULT_ROLE_OPTIONS: DefaultRole[] = ['READER', 'EDITOR'];

function RoleSelect({
  value,
  onChange,
  options,
}: {
  value: Role;
  onChange: (role: Role) => void;
  options: readonly Role[];
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Tela de administração da ACL (docs/14-plataforma-local.md §6, atrás do
 * papel `ADMIN`) — rota `#/acl`. Lista de usuários com papel, `defaultRole`
 * de quem não está na lista, e a invariante "nunca ficar sem ADMIN" travada
 * no botão de salvar (não só avisada depois).
 */
export function AclScreen() {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const effectiveRole = useEffectiveRole();
  const { toast } = useToast();

  const acl = document?.meta.acl;
  const [draftUsers, setDraftUsers] = useState<AclEntry[]>(() => acl?.users ?? []);
  const [draftDefaultRole, setDraftDefaultRole] = useState<DefaultRole>(() => acl?.defaultRole ?? 'EDITOR');
  const [newUsername, setNewUsername] = useState('');
  const [newRole, setNewRole] = useState<Role>('EDITOR');

  if (document === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum documento aberto.</p>
      </div>
    );
  }

  // Em modo aberto (sem ACL, ou ACL sem nenhum ADMIN) todo mundo é PUBLISHER
  // — mas alguém precisa poder criar o primeiro ADMIN, senão o controle nunca
  // liga (docs/14 §6). Fora do modo aberto, só ADMIN entra aqui.
  const canBootstrap = isOpenMode(document);
  if (effectiveRole !== 'ADMIN' && !canBootstrap) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>
            Requer papel ADMIN — você é {effectiveRole}. Só quem administra a lista de acesso pode
            vê-la ou alterá-la.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const wouldHaveNoAdmin = draftUsers.length > 0 && !draftUsers.some((u) => u.role === 'ADMIN');
  const duplicateUsernames = new Set(
    draftUsers.map((u) => u.username).filter((name, i, all) => all.indexOf(name) !== i),
  );
  const dirty =
    JSON.stringify(draftUsers) !== JSON.stringify(acl?.users ?? []) ||
    draftDefaultRole !== (acl?.defaultRole ?? 'EDITOR');
  const canSave = !wouldHaveNoAdmin && duplicateUsernames.size === 0 && dirty;

  function addUser() {
    const username = newUsername.trim();
    if (username === '') return;
    if (draftUsers.some((u) => u.username === username)) {
      toast({ variant: 'destructive', title: 'Usuário já está na lista', description: username });
      return;
    }
    setDraftUsers([...draftUsers, { username, role: newRole }]);
    setNewUsername('');
    setNewRole('EDITOR');
  }

  function removeUser(username: string) {
    setDraftUsers(draftUsers.filter((u) => u.username !== username));
  }

  function updateUserRole(username: string, role: Role) {
    setDraftUsers(draftUsers.map((u) => (u.username === username ? { ...u, role } : u)));
  }

  function save() {
    const nextAcl = draftUsers.length === 0 ? null : { users: draftUsers, defaultRole: draftDefaultRole };
    const result = dispatch(setAcl({ acl: nextAcl }));
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível salvar a lista de acesso',
        description: result.error.message || getErrorMessage(result.error.code),
      });
      return;
    }
    toast({ title: 'Lista de acesso atualizada' });
  }

  function discard() {
    setDraftUsers(acl?.users ?? []);
    setDraftDefaultRole(acl?.defaultRole ?? 'EDITOR');
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Administração › Acesso
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Quem pode editar rascunhos, publicar versões e administrar esta lista.
        </p>
      </div>

      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription>
          Isto é organização, não segurança: quem tem acesso de escrita à pasta de rede sempre pode
          editar o arquivo do documento na mão, por fora da aplicação. A lista de acesso evita
          acidente e dá controle organizacional — não é uma defesa contra alguém mal-intencionado
          (docs/14-plataforma-local.md §6).
        </AlertDescription>
      </Alert>

      {acl === undefined && (
        <Alert>
          <AlertDescription>
            Este documento está em <strong>modo aberto</strong>: sem lista de acesso, todo mundo é
            tratado como Publicador. Adicione usuários abaixo para ligar o controle.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="acl-new-username">Login (username)</Label>
              <Input
                id="acl-new-username"
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
                placeholder="jsilva"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addUser();
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Papel</Label>
              <RoleSelect value={newRole} onChange={setNewRole} options={ROLES} />
            </div>
            <Button type="button" onClick={addUser} disabled={newUsername.trim() === ''}>
              <Plus className="mr-1.5 h-4 w-4" /> Adicionar
            </Button>
          </div>

          {draftUsers.length === 0 ? (
            <p className="py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Nenhum usuário na lista — o documento fica em modo aberto.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
              {draftUsers.map((entry) => (
                <div key={entry.username} className="flex items-center gap-2 py-2">
                  <span className="flex-1 truncate text-sm">
                    {entry.username}
                    {duplicateUsernames.has(entry.username) && (
                      <Badge variant="amber" className="ml-2">
                        duplicado
                      </Badge>
                    )}
                  </span>
                  <RoleSelect
                    value={entry.role}
                    onChange={(role) => updateUserRole(entry.username, role)}
                    options={ROLES}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover ${entry.username}`}
                    onClick={() => removeUser(entry.username)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {wouldHaveNoAdmin && (
            <Alert variant="destructive">
              <AlertDescription>
                A lista precisa de pelo menos um Administrador — sem isso, ninguém poderia editá-la
                de volta. Torne alguém ADMIN antes de salvar.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
            <Label htmlFor="acl-default-role" className="shrink-0">
              Quem não está na lista é tratado como
            </Label>
            <div id="acl-default-role">
              <RoleSelect
                value={draftDefaultRole}
                onChange={(role) => setDraftDefaultRole(role as DefaultRole)}
                options={DEFAULT_ROLE_OPTIONS}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={discard} disabled={!dirty}>
          Descartar alterações
        </Button>
        <Button
          type="button"
          onClick={save}
          disabled={!canSave}
          title={
            wouldHaveNoAdmin
              ? 'A lista precisa de pelo menos um ADMIN.'
              : duplicateUsernames.size > 0
                ? 'Há usuários duplicados na lista.'
                : undefined
          }
        >
          Salvar lista de acesso
        </Button>
      </div>
    </div>
  );
}
