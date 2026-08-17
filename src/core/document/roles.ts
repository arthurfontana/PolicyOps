import { ROLES, type PolicyOpsDocument, type Role } from './schema';

/**
 * Papéis efetivos e o papel mínimo por comando — docs/14-plataforma-local.md
 * §6, docs/08-camada-de-comandos.md §3. Puro: nenhuma dependência de `window`
 * nem de `Ctx` — a camada de comandos usa isto para o gate central em
 * `src/store/document-store.ts`.
 */

const ROLE_RANK: Record<Role, number> = Object.fromEntries(
  ROLES.map((role, index) => [role, index]),
) as Record<Role, number>;

/** `role` alcança (é igual ou mais poderoso que) `min`. */
export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * Papel efetivo de `username` no documento (docs/14 §6):
 * - ACL ausente ou com `users` vazio → `PUBLISHER` (modo aberto);
 * - ACL populada mas sem nenhum `ADMIN` → também `PUBLISHER` (modo aberto —
 *   a invariante "nunca ficar sem ADMIN" é travada na interface, §6; um
 *   documento externo que chegue assim não pode travar todo mundo fora.
 *   `checkI24`, em `validate.ts`, é o `WARNING` correspondente);
 * - `username` listado → o papel da lista;
 * - `username` não listado → `acl.defaultRole`.
 */
export function resolveRole(doc: PolicyOpsDocument, username: string): Role {
  const acl = doc.meta.acl;
  if (acl === undefined || acl.users.length === 0) return 'PUBLISHER';
  if (!acl.users.some((candidate) => candidate.role === 'ADMIN')) return 'PUBLISHER';
  const entry = acl.users.find((candidate) => candidate.username === username);
  return entry?.role ?? acl.defaultRole;
}

/**
 * "Modo aberto": ACL ausente, vazia, ou sem nenhum `ADMIN` — as três
 * condições em que `resolveRole` devolve `PUBLISHER` para todo mundo. Existe
 * separado de `resolveRole` só para resolver o "ovo e a galinha" de
 * `acl/set`: se todo mundo é `PUBLISHER` em modo aberto e editar a ACL exige
 * `ADMIN`, ninguém jamais poderia criar o primeiro `ADMIN` — "o controle liga
 * quando um ADMIN é definido" (docs/14 §6) precisa de alguém que ligue. O
 * gate do dispatcher (`src/store/document-store.ts`) e a tela de acesso
 * usam isto para liberar `acl/set` nesse caso específico, mesmo com o papel
 * efetivo em `PUBLISHER`.
 */
export function isOpenMode(doc: PolicyOpsDocument): boolean {
  const acl = doc.meta.acl;
  if (acl === undefined || acl.users.length === 0) return true;
  return !acl.users.some((candidate) => candidate.role === 'ADMIN');
}

/**
 * Papel mínimo por tipo de comando (docs/14 §6, tabela de papéis):
 * rascunho/biblioteca/tags = `EDITOR`; publicar, aplicar carga e
 * arquivar/restaurar matriz = `PUBLISHER`; editar a ACL = `ADMIN`. Todo
 * comando fora destas listas (a maioria — rascunhos, biblioteca, tags,
 * templates, eixos) tem o piso padrão `EDITOR`: só leitura é permitida a
 * `READER`, e nenhum comando de mutação existe para esse papel. Comandos
 * internos (prefixo `_`, usados só como inverso de undo/redo) não passam
 * pelo gate — só o `dispatch` público do store checa o papel.
 */
const PUBLISHER_COMMANDS: ReadonlySet<string> = new Set([
  'version/publish',
  'import/apply',
  'matrix/archive',
  // Componentes de política (schema 5): mesmo critério das matrizes — publicar
  // e tirar de circulação são atos de publicação, o resto da árvore é edição.
  'componentVersion/publish',
  'componentVersion/publishPending',
  'component/archive',
  // Carga por recorte (S40, docs/14 §9): a primeira versão de cada linha
  // nasce PUBLISHED direto — mesmo critério de `import/apply`.
  'component/importMarkdown',
  // Publicação do DB (S36, docs/14 §5): aprovar é `EDITOR` porque aprovar não
  // publica (RN-GOV-04); **publicar** muda a política vigente, e é aqui que o
  // épico Governança encosta na linha do `PUBLISHER` (docs/08 §6).
  'changeRequest/publish',
]);

const ADMIN_COMMANDS: ReadonlySet<string> = new Set(['acl/set']);

const DEFAULT_MIN_ROLE: Role = 'EDITOR';

export function minRoleForCommand(commandType: string): Role {
  if (ADMIN_COMMANDS.has(commandType)) return 'ADMIN';
  if (PUBLISHER_COMMANDS.has(commandType)) return 'PUBLISHER';
  return DEFAULT_MIN_ROLE;
}

/** *"Requer papel PUBLISHER — você é EDITOR."* — o texto que a interface mostra (docs/14 §6). */
export function describeRoleRequirement(required: Role, effective: Role): string {
  return `Requer papel ${required} — você é ${effective}.`;
}
