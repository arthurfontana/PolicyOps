import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { isIrreversible, type Command, type CommandResult, type Ctx } from '@/core/command';
import type { PolicyOpsDocument, Role } from '@/core/document/schema';
import {
  isOpenMode,
  minRoleForCommand,
  resolveRole,
  roleAtLeast,
  describeRoleRequirement,
} from '@/core/document/roles';
import { DomainError } from '@/core/errors';
import type { SaveStamp } from '@/storage/document-io';

/**
 * Documento em memória e pilha de comandos — docs/08-camada-de-comandos.md §2.
 *
 * O store é a **única** fronteira de impureza da camada de comandos: é aqui
 * que `new Date()` e `nanoid()` são chamados, embrulhados no `Ctx` que o
 * comando recebe. `src/core/` continua totalmente determinístico.
 *
 * Sobre undo/redo: desfazer **não** rebobina o documento para um estado
 * guardado — ele *dispatcha o comando inverso*. A consequência é intencional e
 * a interface precisa dizê-la: **desfazer gera evento próprio na auditoria**.
 * O histórico registra o que aconteceu, inclusive os arrependimentos; ele não
 * é reescrito. Refazer segue a mesma lógica, aplicando o inverso do inverso —
 * que carrega o conteúdo exato de antes, e por isso devolve o documento
 * idêntico, sem depender de gerar ids ou datas novos.
 */

/** docs/08 §2: profundidade da pilha. Em memória, não custa quase nada. */
export const UNDO_STACK_DEPTH = 100;

export type UndoEntry = {
  /** O comando que foi aplicado. */
  command: Command;
  /** O que desfaz esse comando. */
  inverse: Command;
  /** Frase pronta em pt-BR: "Desfazer <label>". */
  label: string;
};

export type CtxFactory = (actor: string) => Ctx;

export const createRuntimeCtx: CtxFactory = (actor) => ({
  actor,
  now: () => new Date(),
  newId: () => nanoid(12),
});

/**
 * Identidade para resolução de papel (docs/14-plataforma-local.md §6,
 * ADR-003) — distinta do `actor` de exibição/auditoria porque `resolveRole`
 * precisa do **login** (`username`), nunca do nome de exibição, que pode
 * divergir. No modo `SERVER`, `username` vem de `GET /api/whoami` e
 * `source` é `'windows'`; nos demais modos é o nome digitado, com
 * `source: 'typed'` — sem diálogo próprio, é o mesmo nome de `actor`.
 */
export type Identity = { username: string; source: 'windows' | 'typed' };

const DEFAULT_IDENTITY: Identity = { username: '', source: 'typed' };

export interface DocumentStoreState {
  document: PolicyOpsDocument | null;
  dirty: boolean;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  canUndo: boolean;
  canRedo: boolean;
  /** Nome de exibição usado nos eventos de auditoria (docs/02 §6). */
  actor: string;
  /** Login usado para resolver o papel efetivo (docs/14 §6). */
  identity: Identity;
  /** Fábrica do `Ctx`. Os testes trocam por uma determinística. */
  ctxFactory: CtxFactory;

  setActor: (actor: string) => void;
  setIdentity: (identity: Identity) => void;
  /** Papel efetivo da identidade atual no documento aberto (`PUBLISHER` sem documento). */
  effectiveRole: () => Role;
  /** Abre um documento e zera as pilhas — elas pertencem ao documento aberto. */
  openDocument: (document: PolicyOpsDocument) => void;
  closeDocument: () => void;
  /**
   * Marca o documento como salvo. **Não** limpa as pilhas: o undo continua
   * disponível depois de salvar; o que muda é que desfazer volta a sujar
   * (docs/08 §2).
   *
   * O `stamp` opcional é o que a camada de persistência acabou de gravar no
   * arquivo (`revision`, `savedAt`, `savedBy`, `appVersion` —
   * docs/06-persistencia-e-concorrencia.md §4). Aplicá-lo aqui mantém o
   * documento em memória idêntico ao que está em disco, que é a premissa da
   * detecção de conflito por hash.
   */
  markSaved: (stamp?: SaveStamp) => void;

  dispatch: <O>(command: Command<unknown, O>) => CommandResult<O>;
  undo: () => CommandResult<unknown> | null;
  redo: () => CommandResult<unknown> | null;
  /**
   * Encerra a sequência de digitação corrente (docs/08 §2, S34): o próximo
   * comando entra como entrada nova na pilha mesmo que traga a mesma
   * `coalesceKey`. A interface chama isto quando o gesto acaba — sair do
   * bloco, colar, salvar — para que o Ctrl+Z seguinte não engula duas
   * digitações separadas de uma vez.
   */
  breakCoalescing: () => void;
}

const NO_DOCUMENT = (): DomainError =>
  new DomainError('NOT_FOUND', 'Nenhum documento aberto — abra ou crie um antes de editar.');

export const useDocumentStore = create<DocumentStoreState>((set, get) => {
  /**
   * Chave da sequência de digitação em curso (docs/08 §2, S34). Fica fora do
   * estado do Zustand de propósito: é detalhe da pilha, nada na interface
   * renderiza a partir dela, e mudá-la não deve custar um render.
   */
  let coalescingKey: string | null = null;

  /**
   * Executa um comando contra o documento aberto e devolve o resultado.
   * Não mexe em nenhuma pilha: quem chama decide o que empilhar.
   */
  function execute<O>(command: Command<unknown, O>): CommandResult<O> {
    const { document, actor, ctxFactory } = get();
    if (document === null) return { ok: false, error: NO_DOCUMENT() };
    const result = command.run(document, ctxFactory(actor));
    // Erro não altera o documento e não empilha nada (docs/08 §2).
    if (result.ok) set({ document: result.document, dirty: true });
    return result;
  }

  function entryFor<O>(
    command: Command<unknown, O>,
    result: Extract<CommandResult<O>, { ok: true }>,
  ): UndoEntry {
    return { command: command as Command, inverse: result.inverse, label: command.label };
  }

  return {
    document: null,
    dirty: false,
    undoStack: [],
    redoStack: [],
    canUndo: false,
    canRedo: false,
    actor: '',
    identity: DEFAULT_IDENTITY,
    ctxFactory: createRuntimeCtx,

    setActor: (actor) => set({ actor }),
    setIdentity: (identity) => set({ identity }),
    effectiveRole: () => {
      const { document, identity } = get();
      return document === null ? 'PUBLISHER' : resolveRole(document, identity.username);
    },

    openDocument: (document) => {
      coalescingKey = null;
      set({ document, dirty: false, undoStack: [], redoStack: [], canUndo: false, canRedo: false });
    },

    closeDocument: () => {
      coalescingKey = null;
      set({
        document: null,
        dirty: false,
        undoStack: [],
        redoStack: [],
        canUndo: false,
        canRedo: false,
      });
    },

    markSaved: (stamp) =>
      set((state) => {
        if (stamp === undefined || state.document === null) return { dirty: false };
        return {
          dirty: false,
          document: { ...state.document, meta: { ...state.document.meta, ...stamp } },
        };
      }),

    dispatch: (command) => {
      // Gate central de papéis (docs/14 §6, docs/08 §3): checado só aqui, no
      // dispatcher público — undo/redo chamam `execute` direto e reaplicam um
      // comando que o próprio usuário já tinha permissão de disparar.
      const { document, identity } = get();
      if (document !== null) {
        const required = minRoleForCommand(command.type);
        const effective = resolveRole(document, identity.username);
        // Exceção estreita: em modo aberto, ninguém tem ADMIN (todos são
        // PUBLISHER), mas alguém precisa poder criar o primeiro ADMIN — senão
        // a ACL nunca liga (docs/14 §6, `isOpenMode`).
        const bootstrappingAcl = command.type === 'acl/set' && isOpenMode(document);
        if (!bootstrappingAcl && !roleAtLeast(effective, required)) {
          return {
            ok: false,
            error: new DomainError('ROLE_REQUIRED', describeRoleRequirement(required, effective), {
              commandType: command.type,
              required,
              effective,
            }),
          };
        }
      }

      const result = execute(command);
      if (!result.ok) return result;

      // Coalescência de digitação (docs/08 §2, S34): comando novo com a mesma
      // chave do anterior **substitui** a entrada do topo e mantém o `inverse`
      // do primeiro da sequência — é o que faz um Ctrl+Z desfazer o parágrafo
      // inteiro. Qualquer outro comando (chave diferente ou ausente) fecha a
      // sequência.
      const previousKey = coalescingKey;
      coalescingKey = command.coalesceKey ?? null;

      const currentStack = get().undoStack;
      const top = currentStack[currentStack.length - 1];
      const coalesces =
        command.coalesceKey !== undefined &&
        command.coalesceKey === previousKey &&
        top !== undefined &&
        !isIrreversible(result.inverse);

      if (coalesces) {
        const merged: UndoEntry = { command: command as Command, inverse: top!.inverse, label: top!.label };
        const undoStack = [...currentStack.slice(0, -1), merged];
        set({ undoStack, redoStack: [], canUndo: true, canRedo: false });
        return result;
      }

      // Comando sem inverso natural (publicar, descartar rascunho) não entra
      // na pilha: oferecer um "Desfazer" que só sabe falhar seria mentira.
      let undoStack = isIrreversible(result.inverse)
        ? currentStack
        : [...currentStack, entryFor(command, result)].slice(-UNDO_STACK_DEPTH);

      // Publicar limpa a pilha de undo daquela versão: o que foi publicado é
      // imutável, e desfazer por cima dele falharia com VERSION_IMMUTABLE.
      if (command.type === 'version/publish') {
        const versionId = command.scope?.versionId;
        undoStack = undoStack.filter((entry) => entry.command.scope?.versionId !== versionId);
      }

      set({
        undoStack,
        // Qualquer comando novo invalida o caminho de volta.
        redoStack: [],
        canUndo: undoStack.length > 0,
        canRedo: false,
      });
      return result;
    },

    breakCoalescing: () => {
      coalescingKey = null;
    },

    undo: () => {
      const { undoStack, redoStack } = get();
      const entry = undoStack[undoStack.length - 1];
      if (entry === undefined) return null;
      // Desfazer fecha a sequência: o comando seguinte, mesmo que seja
      // digitação no mesmo bloco, começa uma entrada nova.
      coalescingKey = null;

      const result = execute(entry.inverse);
      if (!result.ok) return result;

      const nextUndo = undoStack.slice(0, -1);
      const nextRedo = [
        ...redoStack,
        { command: entry.inverse, inverse: result.inverse, label: entry.label },
      ].slice(-UNDO_STACK_DEPTH);
      set({
        undoStack: nextUndo,
        redoStack: nextRedo,
        canUndo: nextUndo.length > 0,
        canRedo: true,
      });
      return result;
    },

    redo: () => {
      const { undoStack, redoStack } = get();
      const entry = redoStack[redoStack.length - 1];
      if (entry === undefined) return null;
      coalescingKey = null;

      const result = execute(entry.inverse);
      if (!result.ok) return result;

      const nextRedo = redoStack.slice(0, -1);
      const nextUndo = [
        ...undoStack,
        { command: entry.inverse, inverse: result.inverse, label: entry.label },
      ].slice(-UNDO_STACK_DEPTH);
      set({
        undoStack: nextUndo,
        redoStack: nextRedo,
        canUndo: true,
        canRedo: nextRedo.length > 0,
      });
      return result;
    },
  };
});
