import { applyToDocument, defineCommand, makeEvent, type Command, type Ctx } from '../command';
import { DomainError } from '../errors';
import { createDraft, discardDraft } from '../versioning/lifecycle';
import {
  createComponentDraft,
  discardComponentDraft,
  updateComponentVersion,
} from '../versioning/component-lifecycle';
import { addChangeRequestItem, locateChangeRequest } from './change-requests';
import { createComponent, locateComponent } from './components';
import { assertItemsEditable } from './cr-workflow';
import type {
  ChangeRequest,
  ChangeRequestItem,
  ComponentPayload,
  MatrixVersion,
  PolicyComponent,
  PolicyComponentType,
  PolicyOpsDocument,
  RichDoc,
} from './schema';

/**
 * O vínculo entre item de DB e rascunho — docs/14-governanca-de-alteracoes.md
 * §3.3 e §6 (I25), docs/08 §3. É a metade da S36 que acontece **antes** da
 * aprovação; publicar o que foi vinculado está em `./cr-publish.ts`.
 *
 * Quatro regras valem para o arquivo inteiro:
 *
 * 1. **Um rascunho pertence a no máximo um DB.** Em versão de componente o
 *    vínculo é bilateral (`ComponentVersion.changeRequestId` aponta de volta,
 *    I30); em rascunho de matriz, que não tem esse campo (DEC-GOV-002), a
 *    exclusividade é conferida varrendo os itens dos demais DBs.
 * 2. **Vincular nunca inventa conteúdo.** Ou o rascunho já existe (e é
 *    adotado), ou ele nasce clonando a versão vigente — o mesmo
 *    `componentVersion/createDraft`/`version/createDraft` do resto do produto.
 *    Nada aqui reimplementa ciclo de vida.
 * 3. **Desvincular não descarta.** `changeRequest/unlinkDraft` solta o vínculo
 *    e devolve o rascunho ao mundo (limpando o `changeRequestId`); descartar é
 *    opção explícita do mesmo comando (`discardDraft: true`), que a interface
 *    só liga depois de confirmar (docs/07 §19.5).
 * 4. **Congelamento** (I25): todos os comandos daqui passam por
 *    `assertItemsEditable` — mexer no vínculo é mexer no escopo, e a partir de
 *    `APPROVED` isso é `E-GOV-01`.
 */

// ---------------------------------------------------------------------------
// Composição
// ---------------------------------------------------------------------------
// #region: cr-drafts-composicao

/**
 * Documento de trabalho + inversos, o padrão de `import/apply` (docs/08 §3):
 * cada passo é um comando existente aplicado sobre o documento imutável
 * anterior, e um `DomainError` no meio propaga para fora de `execute` deixando
 * o documento **recebido** intocado.
 */
export type Run = {
  doc: PolicyOpsDocument;
  inverses: Command[];
};

export function step<O>(run: Run, ctx: Ctx, command: Command<unknown, O>): O {
  const result = command.run(run.doc, ctx);
  if (!result.ok) throw result.error;
  run.doc = result.document;
  run.inverses.push(result.inverse);
  return result.data;
}

/** Inverso composto: os inversos dos subcomandos, na ordem contrária. */
export function undoSteps(input: { type: string; label: string; inverses: Command[] }): Command<
  { type: string; label: string; inverses: Command[] },
  void
> {
  return defineCommand({
    type: input.type,
    input,
    label: input.label,
    execute(doc, ctx) {
      let working = doc;
      const redo: Command[] = [];
      for (let index = input.inverses.length - 1; index >= 0; index--) {
        const result = input.inverses[index]!.run(working, ctx);
        if (!result.ok) throw result.error;
        working = result.document;
        redo.push(result.inverse);
      }
      return {
        document: working,
        data: undefined,
        events: [],
        inverse: undoSteps({ ...input, inverses: redo }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Localização e exclusividade
// ---------------------------------------------------------------------------
// #region: cr-drafts-localizacao

function locateItem(cr: ChangeRequest, componentId: string): ChangeRequestItem {
  const item = cr.items.find((candidate) => candidate.componentId === componentId);
  if (item === undefined) {
    throw new DomainError('NOT_FOUND', `A solicitação "${cr.code}" não tem item para esse componente.`, {
      changeRequestId: cr.id,
      componentId,
    });
  }
  return item;
}

function matrixOf(doc: PolicyOpsDocument, component: PolicyComponent) {
  const matrix = doc.matrices.find((candidate) => candidate.id === component.matrixId);
  if (matrix === undefined) {
    throw new DomainError('NOT_FOUND', 'A matriz espelhada por este componente não existe mais.', {
      componentId: component.id,
      matrixId: component.matrixId,
    });
  }
  return matrix;
}

/** Regra 1: um rascunho não entra em dois DBs. */
function assertDraftFree(doc: PolicyOpsDocument, cr: ChangeRequest, versionId: string): void {
  const other = doc.changeRequests.find(
    (candidate) =>
      candidate.id !== cr.id && candidate.items.some((item) => item.draftVersionId === versionId),
  );
  if (other !== undefined) {
    throw new DomainError(
      'INVALID_INPUT',
      `Este rascunho já está vinculado à solicitação "${other.code}" — um rascunho pertence a no máximo um DB.`,
      { changeRequestId: other.id, versionId },
    );
  }
}

function publishedMatrixVersion(versions: readonly MatrixVersion[]): MatrixVersion | undefined {
  return versions.find((version) => version.state === 'PUBLISHED');
}

// ---------------------------------------------------------------------------
// changeRequest/_setItemDraft (interno)
// ---------------------------------------------------------------------------
// #region: cr-set-item-draft

type SetItemDraftInput = {
  changeRequestId: string;
  componentId: string;
  /** `null` desvincula. */
  draftVersionId: string | null;
  baseVersionId?: string | null;
};

/**
 * Escreve `draftVersionId`/`baseVersionId` do item **sem evento próprio** e com
 * inverso exato. Existe para que `linkDraft`/`unlinkDraft` não componham
 * `changeRequest/updateItem`, que gravaria um segundo `CR_ITEM_CHANGED`
 * genérico ("editou o item") ao lado do evento específico do vínculo — a
 * trilha do DB tem que dizer o que aconteceu, não duas versões da mesma
 * coisa. Mesmo padrão dos internos `_setStatus`/`_restoreDecision`
 * (`./change-requests.ts`).
 */
function setItemDraft(input: SetItemDraftInput): Command<SetItemDraftInput, void> {
  return defineCommand({
    type: 'changeRequest/_setItemDraft',
    input,
    label: input.draftVersionId === null ? 'Soltar o rascunho do item' : 'Apontar o rascunho no item',
    scope: { changeRequestId: input.changeRequestId, componentId: input.componentId },
    execute(doc) {
      const { changeRequest: cr, index } = locateChangeRequest(doc, input.changeRequestId);
      const item = locateItem(cr, input.componentId);
      const itemIndex = cr.items.findIndex((candidate) => candidate.componentId === input.componentId);

      const inverse = setItemDraft({
        changeRequestId: cr.id,
        componentId: input.componentId,
        draftVersionId: item.draftVersionId ?? null,
        baseVersionId: item.baseVersionId ?? null,
      });

      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.changeRequests[index]!.items[itemIndex]!;
          if (input.draftVersionId === null) delete target.draftVersionId;
          else target.draftVersionId = input.draftVersionId;
          if (input.baseVersionId !== undefined) {
            if (input.baseVersionId === null) delete target.baseVersionId;
            else target.baseVersionId = input.baseVersionId;
          }
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// changeRequest/linkDraft
// ---------------------------------------------------------------------------
// #region: cr-link-draft

export type LinkChangeRequestDraftInput = {
  changeRequestId: string;
  componentId: string;
  /** Conteúdo da versão — obrigatório quando o componente ainda não tem nenhuma. */
  payload?: ComponentPayload;
  spec?: RichDoc;
  /** Base a clonar; ausente = a versão vigente do componente/matriz. */
  baseVersionId?: string;
};

export type LinkChangeRequestDraftData = {
  draftVersionId: string;
  kind: 'COMPONENT' | 'MATRIX';
  /** `false` quando o rascunho já existia e só foi adotado pelo DB. */
  created: boolean;
};

/**
 * Vincula o rascunho ao item (docs/14 §3.3): cria um, ou adota o que já
 * existir. Em item sobre espelho `MATRIX`, o rascunho é **da matriz** — o
 * mecanismo original, sem duplicação (DEC-GOV-002).
 *
 * `baseVersionId` do item é preenchido de tabela quando ainda estiver vazio:
 * é ele que a detecção de base desatualizada (RN-GOV-02, `E-GOV-02`) compara
 * na hora de publicar.
 */
export function linkChangeRequestDraft(
  input: LinkChangeRequestDraftInput,
): Command<LinkChangeRequestDraftInput, LinkChangeRequestDraftData> {
  return defineCommand({
    type: 'changeRequest/linkDraft',
    input,
    label: 'Vincular rascunho ao item da solicitação',
    scope: { changeRequestId: input.changeRequestId, componentId: input.componentId },
    execute(doc, ctx) {
      const { changeRequest: cr } = locateChangeRequest(doc, input.changeRequestId);
      assertItemsEditable(cr);
      const item = locateItem(cr, input.componentId);
      const { component } = locateComponent(doc, input.componentId);

      if (item.draftVersionId !== undefined) {
        throw new DomainError(
          'INVALID_INPUT',
          `O item "${component.code}" já tem rascunho vinculado — desvincule antes de vincular outro.`,
          { changeRequestId: cr.id, componentId: component.id, draftVersionId: item.draftVersionId },
        );
      }

      const run: Run = { doc, inverses: [] };
      const linked =
        component.type === 'MATRIX'
          ? linkMatrixDraft(run, ctx, cr, component, input)
          : linkComponentDraft(run, ctx, cr, component, input);

      const currentBase = item.baseVersionId ?? linked.baseVersionId;
      step(
        run,
        ctx,
        setItemDraft({
          changeRequestId: cr.id,
          componentId: component.id,
          draftVersionId: linked.draftVersionId,
          baseVersionId: currentBase,
        }),
      );

      const events = [
        makeEvent(ctx, {
          type: 'CR_ITEM_CHANGED',
          scope: {
            changeRequestId: cr.id,
            componentId: component.id,
            projectId: component.projectId,
          },
          summary: linked.created
            ? `${ctx.actor} criou e vinculou o rascunho de "${component.code}" à solicitação "${cr.code}".`
            : `${ctx.actor} vinculou o rascunho de "${component.code}" à solicitação "${cr.code}".`,
          payload: {
            componentId: component.id,
            change: 'DRAFT_LINKED',
            draftVersionId: linked.draftVersionId,
            created: linked.created,
          },
        }),
      ];

      const crIndex = doc.changeRequests.findIndex((candidate) => candidate.id === cr.id);
      return {
        document: applyToDocument(run.doc, [], (draft) => {
          for (const event of events) draft.changeRequests[crIndex]!.events.push(event);
        }),
        data: {
          draftVersionId: linked.draftVersionId,
          kind: component.type === 'MATRIX' ? 'MATRIX' : 'COMPONENT',
          created: linked.created,
        },
        events,
        inverse: undoSteps({
          type: 'changeRequest/_undoLinkDraft',
          label: 'Desfazer o vínculo do rascunho',
          inverses: run.inverses,
        }),
      };
    },
  });
}

type LinkedDraft = { draftVersionId: string; created: boolean; baseVersionId: string | null };

function linkComponentDraft(
  run: Run,
  ctx: Ctx,
  cr: ChangeRequest,
  component: PolicyComponent,
  input: LinkChangeRequestDraftInput,
): LinkedDraft {
  const published = component.versions.find((version) => version.state === 'PUBLISHED');
  const existing = component.versions.find((version) => version.state === 'DRAFT');

  if (existing !== undefined) {
    assertDraftFree(run.doc, cr, existing.id);
    if (existing.changeRequestId !== undefined && existing.changeRequestId !== cr.id) {
      throw new DomainError(
        'INVALID_INPUT',
        `O rascunho da versão ${existing.number} de "${component.code}" pertence a outro DB.`,
        { componentId: component.id, versionId: existing.id, changeRequestId: existing.changeRequestId },
      );
    }
    // Rascunho solto que o analista já tinha começado: o DB o adota, e o
    // vínculo de volta (I30) passa a existir.
    if (existing.changeRequestId === undefined) {
      step(run, ctx, updateComponentVersion({ versionId: existing.id, changeRequestId: cr.id }));
    }
    if (input.payload !== undefined || input.spec !== undefined) {
      step(
        run,
        ctx,
        updateComponentVersion({
          versionId: existing.id,
          ...(input.payload === undefined ? {} : { payload: input.payload }),
          ...(input.spec === undefined ? {} : { spec: input.spec }),
        }),
      );
    }
    return { draftVersionId: existing.id, created: false, baseVersionId: published?.id ?? null };
  }

  const created = step(
    run,
    ctx,
    createComponentDraft({
      componentId: component.id,
      changeRequestId: cr.id,
      ...(input.baseVersionId === undefined ? {} : { baseVersionId: input.baseVersionId }),
      ...(input.payload === undefined ? {} : { payload: input.payload }),
      ...(input.spec === undefined ? {} : { spec: input.spec }),
    }),
  );
  return { draftVersionId: created.versionId, created: true, baseVersionId: published?.id ?? null };
}

function linkMatrixDraft(
  run: Run,
  ctx: Ctx,
  cr: ChangeRequest,
  component: PolicyComponent,
  input: LinkChangeRequestDraftInput,
): LinkedDraft {
  const matrix = matrixOf(run.doc, component);
  const published = publishedMatrixVersion(matrix.versions);
  const existing = matrix.versions.find((version) => version.state === 'DRAFT');

  if (existing !== undefined) {
    assertDraftFree(run.doc, cr, existing.id);
    return { draftVersionId: existing.id, created: false, baseVersionId: published?.id ?? null };
  }

  const created = step(
    run,
    ctx,
    createDraft({
      matrixId: matrix.id,
      ...(input.baseVersionId === undefined ? {} : { baseVersionId: input.baseVersionId }),
    }),
  );
  return { draftVersionId: created.versionId, created: true, baseVersionId: published?.id ?? null };
}

// ---------------------------------------------------------------------------
// changeRequest/unlinkDraft
// ---------------------------------------------------------------------------
// #region: cr-unlink-draft

export type UnlinkChangeRequestDraftInput = {
  changeRequestId: string;
  componentId: string;
  /**
   * `true` descarta o rascunho junto. **Nunca é o padrão**: desfazer o vínculo
   * não joga trabalho fora sem confirmação explícita (docs/14 §3.3).
   */
  discardDraft?: boolean;
};

export function unlinkChangeRequestDraft(
  input: UnlinkChangeRequestDraftInput,
): Command<UnlinkChangeRequestDraftInput, { discarded: boolean }> {
  return defineCommand({
    type: 'changeRequest/unlinkDraft',
    input,
    label: input.discardDraft === true ? 'Desvincular e descartar o rascunho' : 'Desvincular o rascunho',
    scope: { changeRequestId: input.changeRequestId, componentId: input.componentId },
    execute(doc, ctx) {
      const { changeRequest: cr } = locateChangeRequest(doc, input.changeRequestId);
      assertItemsEditable(cr);
      const item = locateItem(cr, input.componentId);
      const { component } = locateComponent(doc, input.componentId);

      const draftVersionId = item.draftVersionId;
      if (draftVersionId === undefined) {
        throw new DomainError(
          'INVALID_INPUT',
          `O item "${component.code}" não tem rascunho vinculado.`,
          { changeRequestId: cr.id, componentId: component.id },
        );
      }

      const run: Run = { doc, inverses: [] };

      // A ordem importa: o item solta o rascunho **antes** de qualquer coisa
      // acontecer com ele, para que nenhum estado intermediário tenha item
      // apontando versão inexistente (I30).
      step(
        run,
        ctx,
        setItemDraft({ changeRequestId: cr.id, componentId: component.id, draftVersionId: null }),
      );

      const isMatrix = component.type === 'MATRIX';
      if (!isMatrix) {
        step(run, ctx, updateComponentVersion({ versionId: draftVersionId, changeRequestId: null }));
      }
      if (input.discardDraft === true) {
        step(
          run,
          ctx,
          isMatrix ? discardDraft({ versionId: draftVersionId }) : discardComponentDraft({ versionId: draftVersionId }),
        );
      }

      const events = [
        makeEvent(ctx, {
          type: 'CR_ITEM_CHANGED',
          scope: {
            changeRequestId: cr.id,
            componentId: component.id,
            projectId: component.projectId,
          },
          summary:
            input.discardDraft === true
              ? `${ctx.actor} desvinculou e descartou o rascunho de "${component.code}" na solicitação "${cr.code}".`
              : `${ctx.actor} desvinculou o rascunho de "${component.code}" da solicitação "${cr.code}" — o rascunho continua no componente.`,
          payload: {
            componentId: component.id,
            change: 'DRAFT_UNLINKED',
            draftVersionId,
            discarded: input.discardDraft === true,
          },
        }),
      ];

      const crIndex = doc.changeRequests.findIndex((candidate) => candidate.id === cr.id);
      return {
        document: applyToDocument(run.doc, [], (draft) => {
          for (const event of events) draft.changeRequests[crIndex]!.events.push(event);
        }),
        data: { discarded: input.discardDraft === true },
        events,
        inverse: undoSteps({
          type: 'changeRequest/_undoUnlinkDraft',
          label: 'Refazer o vínculo do rascunho',
          inverses: run.inverses,
        }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// changeRequest/createComponentItem
// ---------------------------------------------------------------------------
// #region: cr-create-component-item

export type CreateChangeRequestComponentItemInput = {
  changeRequestId: string;
  projectId: string;
  code: string;
  name: string;
  type: Exclude<PolicyComponentType, 'MATRIX'>;
  parentId?: string;
  payload: ComponentPayload;
  spec?: RichDoc;
  proposedSummary: string;
};

export type CreateChangeRequestComponentItemData = {
  componentId: string;
  draftVersionId: string;
};

/**
 * Item `CREATE`: **cria o componente e o rascunho juntos** (docs/14 §3.3), numa
 * transação só. Sem isso, criar o nó na árvore, adicionar o item e vincular o
 * rascunho seriam três comandos separados — e desfazer o primeiro deixaria um
 * item de DB apontando um componente que não existe mais, quebrando I30.
 *
 * O componente nasce sem versão publicada: o "hoje" do item é "não existe", e a
 * v1 entra em vigor quando o DB for publicado (`./cr-publish.ts`).
 */
export function createChangeRequestComponentItem(
  input: CreateChangeRequestComponentItemInput,
): Command<CreateChangeRequestComponentItemInput, CreateChangeRequestComponentItemData> {
  return defineCommand({
    type: 'changeRequest/createComponentItem',
    input,
    label: `Criar "${input.name}" e incluir na solicitação`,
    scope: { changeRequestId: input.changeRequestId, projectId: input.projectId },
    execute(doc, ctx) {
      const { changeRequest: cr } = locateChangeRequest(doc, input.changeRequestId);
      assertItemsEditable(cr);

      const run: Run = { doc, inverses: [] };
      const component = step(
        run,
        ctx,
        createComponent({
          projectId: input.projectId,
          code: input.code,
          name: input.name,
          type: input.type,
          ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
        }),
      );

      step(
        run,
        ctx,
        addChangeRequestItem({
          changeRequestId: cr.id,
          componentId: component.componentId,
          changeType: 'CREATE',
          proposedSummary: input.proposedSummary,
        }),
      );

      const linked = step(
        run,
        ctx,
        linkChangeRequestDraft({
          changeRequestId: cr.id,
          componentId: component.componentId,
          payload: input.payload,
          ...(input.spec === undefined ? {} : { spec: input.spec }),
        }),
      );

      return {
        document: run.doc,
        data: { componentId: component.componentId, draftVersionId: linked.draftVersionId },
        events: [],
        inverse: undoSteps({
          type: 'changeRequest/_undoCreateComponentItem',
          label: `Desfazer a criação de "${input.name}"`,
          inverses: run.inverses,
        }),
      };
    },
  });
}
