import { produce, type Draft } from 'immer';
import type { DocEvent, DocEventType, PolicyOpsDocument } from './document/schema';
import { DomainError, isDomainError } from './errors';

/**
 * Contrato da camada de comandos — docs/08-camada-de-comandos.md §1.
 *
 * Toda mutação do documento é um comando. As cinco regras invioláveis:
 *
 * 1. **Puro.** Sem `Date.now()`, sem `Math.random()`, sem `window` — a hora e
 *    os ids vêm de `Ctx`. É o que torna os testes determinísticos, e é
 *    verificado por regra de lint própria (eslint.config.js).
 * 2. **Imutável.** Devolve documento novo; nunca muta o recebido. Toda escrita
 *    passa por `applyToDocument`, que é `produce` do Immer — o documento
 *    devolvido é congelado, então uma tentativa de mutação estoura na hora.
 * 3. **Inversível.** Todo comando que altera dados devolve o `inverse`.
 *    Os que não têm inverso natural (`version/publish`, `version/discardDraft`)
 *    devolvem `irreversible(...)`, um comando que falha com mensagem clara.
 * 4. **Valida antes de tocar.** A validação inteira acontece antes do
 *    `produce`; em caso de erro nada é escrito e não há estado parcial.
 * 5. **Registra.** Todo comando produz seus `DocEvent`, com `summary` em frase
 *    pronta pt-BR.
 *
 * Sobre a regra 5 e o catálogo de eventos: `DocEventType`
 * (docs/03-modelo-do-documento.md §8) é normativo e fechado. Ele não tem tipo
 * para criação/edição de **projeto**, para **metadados de matriz** nem para as
 * remoções que só existem como inverso de um desfazer. Esses comandos gravam,
 * portanto, `events: []` — inventar um tipo de evento seria alterar o schema do
 * documento, decisão fora do escopo desta sessão.
 */

// ---------------------------------------------------------------------------
// §1 Contrato
// ---------------------------------------------------------------------------

/**
 * O que o comando precisa do mundo exterior. É a fronteira da pureza: a hora e
 * os ids entram por aqui, e só por aqui. O store é quem constrói o `Ctx` real
 * (`new Date()` e `nanoid(12)`); os testes constroem um determinístico.
 */
export type Ctx = {
  actor: string;
  now: () => Date;
  newId: () => string;
};

export type CommandResult<O = void> =
  | { ok: true; document: PolicyOpsDocument; data: O; events: DocEvent[]; inverse: Command }
  | { ok: false; error: DomainError };

/**
 * `O` tem `unknown` por padrão para que `Command` cru — o tipo do `inverse` e
 * o da pilha de undo — aceite qualquer comando: `I` e `O` só aparecem em
 * posição de saída, então `Command<X, Y>` é atribuível a `Command`.
 */
export type Command<I = unknown, O = unknown> = {
  type: string;
  input: I;
  /** Frase pronta em pt-BR — é o rótulo do "Desfazer" na interface. */
  label: string;
  /**
   * Escopo afetado. O store usa `scope.versionId` para limpar a pilha de undo
   * da versão publicada (docs/08 §2).
   */
  scope?: DocEvent['scope'];
  /**
   * Coalescência de digitação (S34, docs/08 §2). Dois comandos **seguidos**
   * com a mesma chave viram uma entrada só na pilha de undo: o comando novo
   * substitui o do topo, mas o `inverse` guardado continua sendo o do
   * primeiro da sequência. É o que faz um Ctrl+Z desfazer o parágrafo
   * inteiro, e não letra por letra.
   *
   * A chave é responsabilidade de quem cria o comando e precisa identificar
   * **o que** está sendo digitado (documento, versão, bloco, célula): chaves
   * diferentes nunca coalescem. Qualquer comando sem chave — ou com chave
   * diferente — quebra a sequência, assim como desfazer, refazer e trocar de
   * documento.
   */
  coalesceKey?: string;
  run(doc: PolicyOpsDocument, ctx: Ctx): CommandResult<O>;
};

/** O que `execute` devolve quando dá certo — o `run` embrulha em `{ ok: true }`. */
export type CommandOutcome<O> = {
  document: PolicyOpsDocument;
  data: O;
  events: DocEvent[];
  inverse: Command;
};

export type CommandSpec<I, O> = {
  type: string;
  input: I;
  label: string;
  scope?: DocEvent['scope'];
  coalesceKey?: string;
  execute(doc: PolicyOpsDocument, ctx: Ctx): CommandOutcome<O>;
};

/**
 * Monta um `Command` a partir de um `execute` que **lança** `DomainError`.
 *
 * Escrever regra de negócio com `throw` mantém o código linear (nada de
 * encadear `Result` a cada checagem) e reaproveita `src/core/axes/`, que já
 * lança `DomainError`. A conversão para `{ ok: false }` acontece aqui, num
 * lugar só. Erro que não é `DomainError` é bug de programação e sobe: engolir
 * um `TypeError` como se fosse regra de negócio esconde o defeito.
 */
export function defineCommand<I, O = void>(spec: CommandSpec<I, O>): Command<I, O> {
  const command: Command<I, O> = {
    type: spec.type,
    input: spec.input,
    label: spec.label,
    run(doc, ctx) {
      try {
        const outcome = spec.execute(doc, ctx);
        return { ok: true, ...outcome };
      } catch (error) {
        if (isDomainError(error)) return { ok: false, error };
        throw error;
      }
    },
  };
  if (spec.scope !== undefined) command.scope = spec.scope;
  if (spec.coalesceKey !== undefined) command.coalesceKey = spec.coalesceKey;
  return command;
}

// ---------------------------------------------------------------------------
// Inverso ausente
// ---------------------------------------------------------------------------

export const IRREVERSIBLE_COMMAND = 'command/irreversible';

/**
 * Inverso dos comandos que não têm um: publicar e descartar rascunho. Falha
 * sempre, com a mensagem que a interface mostra ao desabilitar o desfazer.
 */
export function irreversible(message: string): Command<{ reason: string }, never> {
  return {
    type: IRREVERSIBLE_COMMAND,
    input: { reason: message },
    label: message,
    run: () => ({ ok: false, error: new DomainError('INVALID_INPUT', message) }),
  };
}

export function isIrreversible(command: Command): boolean {
  return command.type === IRREVERSIBLE_COMMAND;
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/** Toda data do documento é ISO 8601 UTC (docs/03 §1). */
export function isoFrom(date: Date): string {
  return date.toISOString();
}

export function makeEvent(
  ctx: Ctx,
  input: {
    type: DocEventType;
    scope: DocEvent['scope'];
    summary: string;
    payload?: Record<string, unknown>;
  },
): DocEvent {
  const event: DocEvent = {
    id: ctx.newId(),
    at: isoFrom(ctx.now()),
    actor: ctx.actor,
    type: input.type,
    scope: input.scope,
    summary: input.summary,
  };
  if (input.payload !== undefined) event.payload = input.payload;
  return event;
}

/**
 * Aplica a mutação e anexa os eventos numa única passada do Immer. `events` é
 * append-only (docs/03 §8), então os eventos entram sempre no fim.
 */
export function applyToDocument(
  doc: PolicyOpsDocument,
  events: DocEvent[],
  recipe: (draft: Draft<PolicyOpsDocument>) => void,
): PolicyOpsDocument {
  return produce(doc, (draft) => {
    recipe(draft);
    for (const event of events) draft.events.push(event);
  });
}
