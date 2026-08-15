import { applyToDocument, defineCommand, isoFrom, makeEvent, type Command, type Ctx } from '../command';
import { DomainError } from '../errors';
import { locateComponent } from './components';
import {
  assertChangeRequestOpen,
  assertItemsEditable,
  assertSubmittable,
  assertTransitionAllowed,
  isChangeRequestClosed,
} from './cr-workflow';
import {
  CODE_REGEX,
  ISO_DATE_REGEX,
  type ChangeRequest,
  type ChangeRequestChangeType,
  type ChangeRequestItem,
  type CrAcceptanceCriterion,
  type CrApproval,
  type CrApprovalDecision,
  type CrImpact,
  type CrPriority,
  type CrStatus,
  type CrTestScenario,
  type DocEvent,
  type PolicyOpsDocument,
  type RichDoc,
} from './schema';

/**
 * Comandos da Solicitação de Alteração — o "DB" (docs/14-governanca-de-alteracoes.md
 * §3.3, docs/08-camada-de-comandos.md §3). O grafo que os governa está em
 * `./cr-workflow.ts`; aqui ficam as escritas.
 *
 * Quatro decisões que valem para o arquivo inteiro:
 *
 * 1. **A trilha do DB é do DB.** Todo evento de solicitação é gravado em
 *    `changeRequest.events`, não em `doc.events` (DEC-GOV-019). É o que o
 *    schema chama de "trilha própria" (docs/03 §13), e é append-only pela mesma
 *    mecânica da auditoria do documento: desfazer restaura o status, nunca
 *    rebobina o histórico.
 * 2. **`code` é imutável.** `changeRequest/update` não aceita `code` — I31
 *    confere só a unicidade no documento parado, como I28 faz com o componente.
 * 3. **Congelamento é de escopo, não de metadado.** A partir de `APPROVED` (e
 *    portanto também em `REJECTED`/`CANCELLED`/`PUBLISHED`), `items` não muda
 *    mais (I30, `E-GOV-01`); título, dono, prioridade e vínculo de release
 *    continuam editáveis enquanto o DB não estiver **fechado** — sem isso,
 *    montar uma release (US-GOV-05) seria impossível, porque ela só recebe DB
 *    aprovado.
 * 4. **Aprovar não publica** (RN-GOV-04). `changeRequest/approve` mexe em
 *    `status` e `approvals`, e em mais nada: nenhuma versão muda de estado.
 */

// ---------------------------------------------------------------------------
// Localização e utilitários
// ---------------------------------------------------------------------------
// #region: localizacao-e-utilitarios

export type ChangeRequestLocation = { changeRequest: ChangeRequest; index: number };

export function locateChangeRequest(
  doc: PolicyOpsDocument,
  changeRequestId: string,
): ChangeRequestLocation {
  const index = doc.changeRequests.findIndex((candidate) => candidate.id === changeRequestId);
  if (index < 0) {
    throw new DomainError('NOT_FOUND', 'A solicitação de alteração informada não existe neste documento.', {
      changeRequestId,
    });
  }
  return { changeRequest: doc.changeRequests[index]!, index };
}

function crScope(cr: ChangeRequest, extra?: DocEvent['scope']): DocEvent['scope'] {
  return { changeRequestId: cr.id, ...extra };
}

/**
 * Escreve na solicitação e anexa os eventos **na trilha dela**. O documento
 * global não recebe evento nenhum de DB (DEC-GOV-019), por isso a chamada a
 * `applyToDocument` vai com a lista vazia.
 */
function applyToChangeRequest(
  doc: PolicyOpsDocument,
  index: number,
  events: DocEvent[],
  recipe: (cr: ChangeRequest) => void,
): PolicyOpsDocument {
  return applyToDocument(doc, [], (draft) => {
    const target = draft.changeRequests[index]!;
    recipe(target);
    for (const event of events) target.events.push(event);
  });
}

function assertText(value: string, what: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DomainError('INVALID_INPUT', `${what} não pode ficar em branco.`, { value });
  }
  return trimmed;
}

function assertIsoDate(value: string, what: string): string {
  if (!ISO_DATE_REGEX.test(value)) {
    throw new DomainError('INVALID_INPUT', `${what} precisa estar no formato ISO 8601 UTC.`, {
      value,
    });
  }
  return value;
}

/** Valor anterior de um campo opcional, no formato que o inverso precisa. */
function previous<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/**
 * Motivadores e categorias de impacto são `CatalogItem` (kinds `MOTIVATOR` e
 * `IMPACT_CATEGORY`, docs/03 §4) — a mesma mecânica de `Matrix.tags`: o
 * documento guarda o `code`, e o comando recusa código que não existe.
 */
function assertCatalogCodes(
  doc: PolicyOpsDocument,
  kind: 'MOTIVATOR' | 'IMPACT_CATEGORY',
  codes: string[],
  what: string,
): string[] {
  const out: string[] = [];
  for (const code of codes) {
    if (!CODE_REGEX.test(code)) {
      throw new DomainError('INVALID_INPUT', `"${code}" não é um código válido: um código casa ^[A-Z0-9_]+$.`, {
        code,
      });
    }
    const item = doc.catalog.find((candidate) => candidate.kind === kind && candidate.code === code);
    if (item === undefined) {
      throw new DomainError('CATALOG_REF_MISSING', `${what} "${code}" não existe no catálogo.`, {
        code,
        kind,
      });
    }
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

function assertMotivators(doc: PolicyOpsDocument, codes: string[]): string[] {
  return assertCatalogCodes(doc, 'MOTIVATOR', codes, 'O motivador');
}

function assertImpacts(doc: PolicyOpsDocument, impacts: CrImpact[]): CrImpact[] {
  assertCatalogCodes(
    doc,
    'IMPACT_CATEGORY',
    impacts.map((impact) => impact.category),
    'A categoria de impacto',
  );
  return impacts.map((impact) => ({
    category: impact.category,
    ...(impact.description === undefined ? {} : { description: impact.description }),
  }));
}

// ---------------------------------------------------------------------------
// Itens: referências e RN-GOV-02
// ---------------------------------------------------------------------------
// #region: itens-referencias

export type ChangeRequestItemInput = {
  componentId: string;
  changeType: ChangeRequestChangeType;
  baseVersionId?: string;
  draftVersionId?: string;
  currentSummary?: string;
  proposedSummary: string;
};

/**
 * Valida as referências de um item (I30, metade estática):
 *
 * - o componente existe;
 * - `baseVersionId` aponta versão daquele componente (ou daquela matriz, no
 *   espelho `MATRIX`);
 * - `draftVersionId` aponta um **rascunho** e, quando é versão de componente,
 *   um rascunho cujo `changeRequestId` é este DB.
 *
 * Item sobre componente `MATRIX` vincula rascunho **da matriz** (docs/14 §3.3):
 * `MatrixVersion` não tem `changeRequestId`, então o vínculo que se confere ali
 * é o da matriz espelhada. A publicação que consome esses vínculos é da S36.
 */
function assertItemRefs(doc: PolicyOpsDocument, cr: ChangeRequest, item: ChangeRequestItemInput): void {
  const { component } = locateComponent(doc, item.componentId);

  if (component.type === 'MATRIX') {
    const matrix = doc.matrices.find((candidate) => candidate.id === component.matrixId);
    if (matrix === undefined) {
      throw new DomainError('NOT_FOUND', 'A matriz espelhada por este componente não existe mais.', {
        componentId: component.id,
        matrixId: component.matrixId,
      });
    }
    if (item.baseVersionId !== undefined && !matrix.versions.some((v) => v.id === item.baseVersionId)) {
      throw new DomainError('NOT_FOUND', `A versão base informada não pertence à matriz "${matrix.code}".`, {
        matrixId: matrix.id,
        baseVersionId: item.baseVersionId,
      });
    }
    if (item.draftVersionId !== undefined) {
      const draft = matrix.versions.find((v) => v.id === item.draftVersionId);
      if (draft === undefined) {
        throw new DomainError('NOT_FOUND', `O rascunho informado não pertence à matriz "${matrix.code}".`, {
          matrixId: matrix.id,
          draftVersionId: item.draftVersionId,
        });
      }
      if (draft.state !== 'DRAFT') {
        throw new DomainError(
          'VERSION_NOT_DRAFT',
          `A versão ${draft.number} de "${matrix.code}" está em ${draft.state}; um item de DB vincula rascunho.`,
          { matrixId: matrix.id, versionId: draft.id, state: draft.state },
        );
      }
    }
    return;
  }

  if (item.baseVersionId !== undefined && !component.versions.some((v) => v.id === item.baseVersionId)) {
    throw new DomainError(
      'NOT_FOUND',
      `A versão base informada não pertence ao componente "${component.code}".`,
      { componentId: component.id, baseVersionId: item.baseVersionId },
    );
  }
  if (item.draftVersionId === undefined) return;

  const draft = component.versions.find((v) => v.id === item.draftVersionId);
  if (draft === undefined) {
    throw new DomainError(
      'NOT_FOUND',
      `O rascunho informado não pertence ao componente "${component.code}".`,
      { componentId: component.id, draftVersionId: item.draftVersionId },
    );
  }
  if (draft.state !== 'DRAFT') {
    throw new DomainError(
      'VERSION_NOT_DRAFT',
      `A versão ${draft.number} de "${component.code}" está em ${draft.state}; um item de DB vincula rascunho.`,
      { componentId: component.id, versionId: draft.id, state: draft.state },
    );
  }
  // I30, segunda metade: o rascunho vinculado é deste DB, e de nenhum outro.
  if (draft.changeRequestId !== cr.id) {
    throw new DomainError(
      'INVALID_INPUT',
      draft.changeRequestId === undefined
        ? `O rascunho da versão ${draft.number} de "${component.code}" não aponta nenhum DB — vincule-o a "${cr.code}" antes.`
        : `O rascunho da versão ${draft.number} de "${component.code}" pertence a outro DB.`,
      { componentId: component.id, versionId: draft.id, changeRequestId: draft.changeRequestId ?? null },
    );
  }
}

/** RN-GOV-02: um componente aparece **uma vez** no mesmo DB. */
function assertComponentNotInCr(doc: PolicyOpsDocument, cr: ChangeRequest, componentId: string): void {
  if (!cr.items.some((item) => item.componentId === componentId)) return;
  const { component } = locateComponent(doc, componentId);
  throw new DomainError(
    'INVALID_INPUT',
    `O componente "${component.code}" já é item da solicitação "${cr.code}" — um componente entra uma vez só por DB.`,
    { changeRequestId: cr.id, componentId },
  );
}

function buildItem(input: ChangeRequestItemInput): ChangeRequestItem {
  const item: ChangeRequestItem = {
    componentId: input.componentId,
    changeType: input.changeType,
    proposedSummary: assertText(input.proposedSummary, 'O texto do proposto'),
  };
  if (input.baseVersionId !== undefined) item.baseVersionId = input.baseVersionId;
  if (input.draftVersionId !== undefined) item.draftVersionId = input.draftVersionId;
  if (input.currentSummary !== undefined) {
    item.currentSummary = assertText(input.currentSummary, 'O texto do hoje');
  }
  return item;
}

function locateItem(cr: ChangeRequest, componentId: string): { item: ChangeRequestItem; index: number } {
  const index = cr.items.findIndex((candidate) => candidate.componentId === componentId);
  if (index < 0) {
    throw new DomainError('NOT_FOUND', `A solicitação "${cr.code}" não tem item para esse componente.`, {
      changeRequestId: cr.id,
      componentId,
    });
  }
  return { item: cr.items[index]!, index };
}

// ---------------------------------------------------------------------------
// changeRequest/create
// ---------------------------------------------------------------------------
// #region: change-request-create

export type CreateChangeRequestInput = {
  /** "DB_519" — único no documento (I31) e imutável. */
  code: string;
  title: string;
  /** Ausente = `ctx.actor` (o carimbo é o nome informado, DEC-GOV-004). */
  requestedBy?: string;
  owner?: string;
  priority?: CrPriority;
  motivators?: string[];
  motivationText?: RichDoc;
  spec?: RichDoc;
  acceptanceCriteria?: CrAcceptanceCriterion[];
  testScenarios?: CrTestScenario[];
  impacts?: CrImpact[];
  proposedEffectiveDate?: string;
};

/**
 * Nasce sempre em `DRAFT` e **sem itens**: o escopo entra por
 * `changeRequest/addItem`, que é onde RN-GOV-02 e I30 são conferidos.
 */
export function createChangeRequest(
  input: CreateChangeRequestInput,
): Command<CreateChangeRequestInput, { changeRequestId: string }> {
  return defineCommand({
    type: 'changeRequest/create',
    input,
    label: `Criar a solicitação "${input.code}"`,
    execute(doc, ctx) {
      if (!CODE_REGEX.test(input.code)) {
        throw new DomainError(
          'INVALID_INPUT',
          `"${input.code}" não é um código válido: um código casa ^[A-Z0-9_]+$ (o "DB-519" do Word é escrito DB_519).`,
          { code: input.code },
        );
      }
      const duplicate = doc.changeRequests.find((candidate) => candidate.code === input.code);
      if (duplicate !== undefined) {
        throw new DomainError(
          'DUPLICATE_CODE',
          `Já existe uma solicitação com o código "${input.code}" neste documento.`,
          { code: input.code, changeRequestId: duplicate.id },
        );
      }

      const title = assertText(input.title, 'O título da solicitação');
      const motivators = assertMotivators(doc, input.motivators ?? []);
      const impacts = assertImpacts(doc, input.impacts ?? []);

      const changeRequestId = ctx.newId();
      const changeRequest: ChangeRequest = {
        id: changeRequestId,
        code: input.code,
        title,
        status: 'DRAFT',
        motivators,
        requestedBy: assertText(input.requestedBy ?? ctx.actor, 'O solicitante'),
        items: [],
        acceptanceCriteria: input.acceptanceCriteria ?? [],
        testScenarios: input.testScenarios ?? [],
        impacts,
        approvals: [],
        events: [],
        createdAt: isoFrom(ctx.now()),
      };
      if (input.owner !== undefined) changeRequest.owner = assertText(input.owner, 'O dono');
      if (input.priority !== undefined) changeRequest.priority = input.priority;
      if (input.motivationText !== undefined) {
        changeRequest.motivationText = structuredClone(input.motivationText);
      }
      if (input.spec !== undefined) changeRequest.spec = structuredClone(input.spec);
      if (input.proposedEffectiveDate !== undefined) {
        changeRequest.proposedEffectiveDate = assertIsoDate(
          input.proposedEffectiveDate,
          'A vigência proposta',
        );
      }

      const events = [
        makeEvent(ctx, {
          type: 'CR_CREATED',
          scope: { changeRequestId },
          summary: `${ctx.actor} criou a solicitação "${input.code}" — ${title}.`,
          payload: { code: input.code, title },
        }),
      ];
      changeRequest.events.push(...events);

      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.changeRequests.push(changeRequest);
        }),
        data: { changeRequestId },
        events,
        inverse: removeCreatedChangeRequest({ changeRequestId, code: input.code }),
      };
    },
  });
}

/** Inverso de `changeRequest/create`. Recusa se o DB já andou — desfazer não arrasta trabalho novo. */
function removeCreatedChangeRequest(input: { changeRequestId: string; code: string }): Command<
  { changeRequestId: string; code: string },
  void
> {
  return defineCommand({
    type: 'changeRequest/_removeCreated',
    input,
    label: `Desfazer a criação da solicitação "${input.code}"`,
    scope: { changeRequestId: input.changeRequestId },
    execute(doc) {
      const { changeRequest, index } = locateChangeRequest(doc, input.changeRequestId);
      if (changeRequest.status !== 'DRAFT' || changeRequest.items.length > 0) {
        throw new DomainError(
          'CR_TRANSITION_INVALID',
          `A solicitação "${changeRequest.code}" já tem escopo ou já saiu de DRAFT e não pode ser removida por um desfazer.`,
          { changeRequestId: changeRequest.id, status: changeRequest.status },
        );
      }
      const removed = structuredClone(changeRequest);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.changeRequests.splice(index, 1);
        }),
        data: undefined,
        events: [],
        inverse: restoreChangeRequest({ changeRequest: removed, index }),
      };
    },
  });
}

function restoreChangeRequest(input: { changeRequest: ChangeRequest; index: number }): Command<
  { changeRequest: ChangeRequest; index: number },
  void
> {
  return defineCommand({
    type: 'changeRequest/_restore',
    input,
    label: `Refazer a criação da solicitação "${input.changeRequest.code}"`,
    scope: { changeRequestId: input.changeRequest.id },
    execute(doc) {
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.changeRequests.splice(input.index, 0, structuredClone(input.changeRequest));
        }),
        data: undefined,
        events: [],
        inverse: removeCreatedChangeRequest({
          changeRequestId: input.changeRequest.id,
          code: input.changeRequest.code,
        }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// changeRequest/update
// ---------------------------------------------------------------------------
// #region: change-request-update

/**
 * Semântica de três estados nos opcionais: ausente = não mexe, `null` = apaga,
 * valor = define. **Não aceita `code`** (imutável, I31), **nem `status`** (só o
 * workflow move status) **nem `items`** (comandos próprios) **nem `releaseId`**
 * (`changeRequest/setRelease`).
 */
export type UpdateChangeRequestInput = {
  changeRequestId: string;
  title?: string;
  owner?: string | null;
  priority?: CrPriority | null;
  motivators?: string[];
  motivationText?: RichDoc | null;
  spec?: RichDoc | null;
  acceptanceCriteria?: CrAcceptanceCriterion[];
  testScenarios?: CrTestScenario[];
  impacts?: CrImpact[];
  proposedEffectiveDate?: string | null;
};

export function updateChangeRequest(
  input: UpdateChangeRequestInput,
): Command<UpdateChangeRequestInput, void> {
  return defineCommand({
    type: 'changeRequest/update',
    input,
    label: 'Editar a solicitação',
    scope: { changeRequestId: input.changeRequestId },
    execute(doc, ctx) {
      const { changeRequest: cr, index } = locateChangeRequest(doc, input.changeRequestId);
      assertChangeRequestOpen(cr);

      const title = input.title === undefined ? undefined : assertText(input.title, 'O título da solicitação');
      const owner =
        input.owner === undefined || input.owner === null ? input.owner : assertText(input.owner, 'O dono');
      const motivators = input.motivators === undefined ? undefined : assertMotivators(doc, input.motivators);
      const impacts = input.impacts === undefined ? undefined : assertImpacts(doc, input.impacts);
      const proposedEffectiveDate =
        input.proposedEffectiveDate === undefined || input.proposedEffectiveDate === null
          ? input.proposedEffectiveDate
          : assertIsoDate(input.proposedEffectiveDate, 'A vigência proposta');

      const inverse = updateChangeRequest({
        changeRequestId: cr.id,
        title: cr.title,
        owner: previous(cr.owner),
        priority: previous(cr.priority),
        motivators: [...cr.motivators],
        motivationText: cr.motivationText === undefined ? null : structuredClone(cr.motivationText),
        spec: cr.spec === undefined ? null : structuredClone(cr.spec),
        acceptanceCriteria: structuredClone(cr.acceptanceCriteria),
        testScenarios: structuredClone(cr.testScenarios),
        impacts: structuredClone(cr.impacts),
        proposedEffectiveDate: previous(cr.proposedEffectiveDate),
      });

      const events = [
        makeEvent(ctx, {
          type: 'CR_UPDATED',
          scope: crScope(cr),
          summary: `${ctx.actor} editou a solicitação "${cr.code}".`,
          payload: { changeRequestId: cr.id },
        }),
      ];

      return {
        document: applyToChangeRequest(doc, index, events, (target) => {
          if (title !== undefined) target.title = title;
          if (owner !== undefined) {
            if (owner === null) delete target.owner;
            else target.owner = owner;
          }
          if (input.priority !== undefined) {
            if (input.priority === null) delete target.priority;
            else target.priority = input.priority;
          }
          if (motivators !== undefined) target.motivators = motivators;
          if (input.motivationText !== undefined) {
            if (input.motivationText === null) delete target.motivationText;
            else target.motivationText = structuredClone(input.motivationText);
          }
          if (input.spec !== undefined) {
            if (input.spec === null) delete target.spec;
            else target.spec = structuredClone(input.spec);
          }
          if (input.acceptanceCriteria !== undefined) {
            target.acceptanceCriteria = structuredClone(input.acceptanceCriteria);
          }
          if (input.testScenarios !== undefined) {
            target.testScenarios = structuredClone(input.testScenarios);
          }
          if (impacts !== undefined) target.impacts = impacts;
          if (proposedEffectiveDate !== undefined) {
            if (proposedEffectiveDate === null) delete target.proposedEffectiveDate;
            else target.proposedEffectiveDate = proposedEffectiveDate;
          }
        }),
        data: undefined,
        events,
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// changeRequest/addItem · removeItem · updateItem
// ---------------------------------------------------------------------------
// #region: change-request-itens

export type AddChangeRequestItemInput = { changeRequestId: string } & ChangeRequestItemInput;

export function addChangeRequestItem(
  input: AddChangeRequestItemInput,
): Command<AddChangeRequestItemInput, { index: number }> {
  return defineCommand({
    type: 'changeRequest/addItem',
    input,
    label: 'Adicionar item à solicitação',
    scope: { changeRequestId: input.changeRequestId, componentId: input.componentId },
    execute(doc, ctx) {
      const { changeRequest: cr, index } = locateChangeRequest(doc, input.changeRequestId);
      assertItemsEditable(cr);
      assertComponentNotInCr(doc, cr, input.componentId);
      assertItemRefs(doc, cr, input);

      const item = buildItem(input);
      const at = cr.items.length;
      const { component } = locateComponent(doc, input.componentId);

      const events = [
        makeEvent(ctx, {
          type: 'CR_ITEM_CHANGED',
          scope: crScope(cr, { componentId: component.id, projectId: component.projectId }),
          summary: `${ctx.actor} incluiu "${component.code}" no escopo da solicitação "${cr.code}".`,
          payload: { componentId: component.id, changeType: item.changeType, change: 'ADDED' },
        }),
      ];

      return {
        document: applyToChangeRequest(doc, index, events, (target) => {
          target.items.push(structuredClone(item));
        }),
        data: { index: at },
        events,
        inverse: removeChangeRequestItem({
          changeRequestId: cr.id,
          componentId: item.componentId,
        }),
      };
    },
  });
}

export type RemoveChangeRequestItemInput = { changeRequestId: string; componentId: string };

export function removeChangeRequestItem(
  input: RemoveChangeRequestItemInput,
): Command<RemoveChangeRequestItemInput, void> {
  return defineCommand({
    type: 'changeRequest/removeItem',
    input,
    label: 'Remover item da solicitação',
    scope: { changeRequestId: input.changeRequestId, componentId: input.componentId },
    execute(doc, ctx) {
      const { changeRequest: cr, index } = locateChangeRequest(doc, input.changeRequestId);
      assertItemsEditable(cr);
      const { item, index: itemIndex } = locateItem(cr, input.componentId);
      const removed = structuredClone(item);
      const { component } = locateComponent(doc, input.componentId);

      const events = [
        makeEvent(ctx, {
          type: 'CR_ITEM_CHANGED',
          scope: crScope(cr, { componentId: component.id, projectId: component.projectId }),
          summary: `${ctx.actor} tirou "${component.code}" do escopo da solicitação "${cr.code}".`,
          payload: { componentId: component.id, change: 'REMOVED' },
        }),
      ];

      return {
        document: applyToChangeRequest(doc, index, events, (target) => {
          target.items.splice(itemIndex, 1);
        }),
        data: undefined,
        events,
        inverse: restoreChangeRequestItem({
          changeRequestId: cr.id,
          item: removed,
          index: itemIndex,
        }),
      };
    },
  });
}

/** Inverso de `removeItem` (e de `addItem` desfeito duas vezes): devolve o item na posição exata. */
function restoreChangeRequestItem(input: {
  changeRequestId: string;
  item: ChangeRequestItem;
  index: number;
}): Command<{ changeRequestId: string; item: ChangeRequestItem; index: number }, void> {
  return defineCommand({
    type: 'changeRequest/_restoreItem',
    input,
    label: 'Devolver o item à solicitação',
    scope: { changeRequestId: input.changeRequestId, componentId: input.item.componentId },
    execute(doc) {
      const { index } = locateChangeRequest(doc, input.changeRequestId);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.changeRequests[index]!.items.splice(input.index, 0, structuredClone(input.item));
        }),
        data: undefined,
        events: [],
        inverse: removeChangeRequestItem({
          changeRequestId: input.changeRequestId,
          componentId: input.item.componentId,
        }),
      };
    },
  });
}

/** `componentId` identifica o item (RN-GOV-02 garante que ele é único no DB) e **não** muda. */
export type UpdateChangeRequestItemInput = {
  changeRequestId: string;
  componentId: string;
  changeType?: ChangeRequestChangeType;
  baseVersionId?: string | null;
  draftVersionId?: string | null;
  currentSummary?: string | null;
  proposedSummary?: string;
};

export function updateChangeRequestItem(
  input: UpdateChangeRequestItemInput,
): Command<UpdateChangeRequestItemInput, void> {
  return defineCommand({
    type: 'changeRequest/updateItem',
    input,
    label: 'Editar item da solicitação',
    scope: { changeRequestId: input.changeRequestId, componentId: input.componentId },
    execute(doc, ctx) {
      const { changeRequest: cr, index } = locateChangeRequest(doc, input.changeRequestId);
      assertItemsEditable(cr);
      const { item, index: itemIndex } = locateItem(cr, input.componentId);

      const merged: ChangeRequestItemInput = {
        componentId: item.componentId,
        changeType: input.changeType ?? item.changeType,
        proposedSummary: input.proposedSummary ?? item.proposedSummary,
      };
      const baseVersionId =
        input.baseVersionId === undefined ? item.baseVersionId : (input.baseVersionId ?? undefined);
      const draftVersionId =
        input.draftVersionId === undefined ? item.draftVersionId : (input.draftVersionId ?? undefined);
      const currentSummary =
        input.currentSummary === undefined ? item.currentSummary : (input.currentSummary ?? undefined);
      if (baseVersionId !== undefined) merged.baseVersionId = baseVersionId;
      if (draftVersionId !== undefined) merged.draftVersionId = draftVersionId;
      if (currentSummary !== undefined) merged.currentSummary = currentSummary;

      assertItemRefs(doc, cr, merged);
      const next = buildItem(merged);
      const { component } = locateComponent(doc, item.componentId);

      const inverse = updateChangeRequestItem({
        changeRequestId: cr.id,
        componentId: item.componentId,
        changeType: item.changeType,
        baseVersionId: previous(item.baseVersionId),
        draftVersionId: previous(item.draftVersionId),
        currentSummary: previous(item.currentSummary),
        proposedSummary: item.proposedSummary,
      });

      const events = [
        makeEvent(ctx, {
          type: 'CR_ITEM_CHANGED',
          scope: crScope(cr, { componentId: component.id, projectId: component.projectId }),
          summary: `${ctx.actor} editou o item "${component.code}" da solicitação "${cr.code}".`,
          payload: { componentId: component.id, changeType: next.changeType, change: 'UPDATED' },
        }),
      ];

      return {
        document: applyToChangeRequest(doc, index, events, (target) => {
          target.items[itemIndex] = structuredClone(next);
        }),
        data: undefined,
        events,
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// changeRequest/setRelease
// ---------------------------------------------------------------------------
// #region: change-request-set-release

export type SetChangeRequestReleaseInput = {
  changeRequestId: string;
  /** `null` desvincula. */
  releaseId: string | null;
};

/**
 * Vínculo `ChangeRequest.releaseId` (docs/14 §3.4). Comando próprio, e não um
 * campo de `changeRequest/update`, porque acontece **depois** da aprovação —
 * quando o metadado do DB já está estável e o que se monta é a release.
 */
export function setChangeRequestRelease(
  input: SetChangeRequestReleaseInput,
): Command<SetChangeRequestReleaseInput, void> {
  return defineCommand({
    type: 'changeRequest/setRelease',
    input,
    label: input.releaseId === null ? 'Tirar a solicitação da release' : 'Vincular a solicitação à release',
    scope: { changeRequestId: input.changeRequestId },
    execute(doc, ctx) {
      const { changeRequest: cr, index } = locateChangeRequest(doc, input.changeRequestId);
      assertChangeRequestOpen(cr);

      let releaseCode: string | null = null;
      if (input.releaseId !== null) {
        const release = doc.releases.find((candidate) => candidate.id === input.releaseId);
        if (release === undefined) {
          throw new DomainError('NOT_FOUND', 'A release informada não existe neste documento.', {
            releaseId: input.releaseId,
          });
        }
        if (release.status === 'PUBLISHED' || release.status === 'CANCELLED') {
          throw new DomainError(
            'CR_TRANSITION_INVALID',
            `A release "${release.code}" está em ${release.status} e não recebe mais solicitações.`,
            { releaseId: release.id, status: release.status },
          );
        }
        releaseCode = release.code;
      }

      const inverse = setChangeRequestRelease({
        changeRequestId: cr.id,
        releaseId: cr.releaseId ?? null,
      });

      // Nada mudou: sem evento e sem escrita (mesmo padrão de `matrix/setTags`).
      if ((cr.releaseId ?? null) === input.releaseId) {
        return { document: doc, data: undefined, events: [], inverse };
      }

      const events = [
        makeEvent(ctx, {
          type: 'CR_UPDATED',
          scope: crScope(cr, input.releaseId === null ? undefined : { releaseId: input.releaseId }),
          summary:
            releaseCode === null
              ? `${ctx.actor} tirou a solicitação "${cr.code}" da release.`
              : `${ctx.actor} vinculou a solicitação "${cr.code}" à release "${releaseCode}".`,
          payload: { releaseId: input.releaseId },
        }),
      ];

      return {
        document: applyToChangeRequest(doc, index, events, (target) => {
          if (input.releaseId === null) delete target.releaseId;
          else target.releaseId = input.releaseId;
        }),
        data: undefined,
        events,
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// changeRequest/transition e changeRequest/cancel
// ---------------------------------------------------------------------------
// #region: change-request-workflow

export type TransitionChangeRequestInput = {
  changeRequestId: string;
  to: CrStatus;
  /** Observação livre, gravada no evento da trilha. */
  note?: string;
};

/**
 * RN-GOV-01: valida **exclusivamente** o grafo de docs/14 §5, com a única
 * exigência extra que o próprio §5 impõe — RN-GOV-03 ao entrar em `SUBMITTED`.
 * `PUBLISHED` não é alcançável por aqui (`./cr-workflow.ts`).
 *
 * Decidir (aprovar/devolver/rejeitar) usa os comandos de decisão: eles fazem a
 * mesma transição **e** gravam `{by, at, decision, comment}` em `approvals`.
 */
export function transitionChangeRequest(
  input: TransitionChangeRequestInput,
): Command<TransitionChangeRequestInput, { from: CrStatus; to: CrStatus }> {
  return defineCommand({
    type: 'changeRequest/transition',
    input,
    label: `Mover a solicitação para ${input.to}`,
    scope: { changeRequestId: input.changeRequestId },
    execute(doc, ctx) {
      const { changeRequest: cr, index } = locateChangeRequest(doc, input.changeRequestId);
      assertTransitionAllowed(cr, input.to);
      if (input.to === 'SUBMITTED') assertSubmittable(cr);

      const events = [transitionEvent(ctx, cr, input.to, input.note)];

      return {
        document: applyToChangeRequest(doc, index, events, (target) => {
          target.status = input.to;
        }),
        data: { from: cr.status, to: input.to },
        events,
        inverse: setChangeRequestStatus({ changeRequestId: cr.id, status: cr.status }),
      };
    },
  });
}

export type CancelChangeRequestInput = { changeRequestId: string; reason?: string };

/** Cancelar é a transição para `CANCELLED` com um motivo — permitida de qualquer estado não terminal. */
export function cancelChangeRequest(
  input: CancelChangeRequestInput,
): Command<CancelChangeRequestInput, { from: CrStatus }> {
  return defineCommand({
    type: 'changeRequest/cancel',
    input,
    label: 'Cancelar a solicitação',
    scope: { changeRequestId: input.changeRequestId },
    execute(doc, ctx) {
      const { changeRequest: cr, index } = locateChangeRequest(doc, input.changeRequestId);
      assertTransitionAllowed(cr, 'CANCELLED');
      const reason = input.reason === undefined ? undefined : assertText(input.reason, 'O motivo do cancelamento');

      const events = [transitionEvent(ctx, cr, 'CANCELLED', reason)];

      return {
        document: applyToChangeRequest(doc, index, events, (target) => {
          target.status = 'CANCELLED';
        }),
        data: { from: cr.status },
        events,
        inverse: setChangeRequestStatus({ changeRequestId: cr.id, status: cr.status }),
      };
    },
  });
}

function transitionEvent(ctx: Ctx, cr: ChangeRequest, to: CrStatus, note?: string): DocEvent {
  return makeEvent(ctx, {
    type: 'CR_TRANSITIONED',
    scope: { changeRequestId: cr.id },
    summary:
      note === undefined
        ? `${ctx.actor} moveu a solicitação "${cr.code}" de ${cr.status} para ${to}.`
        : `${ctx.actor} moveu a solicitação "${cr.code}" de ${cr.status} para ${to}: ${note}`,
    payload: { from: cr.status, to, ...(note === undefined ? {} : { note }) },
  });
}

/**
 * Inverso das transições: devolve o status exato de antes, **sem** rebobinar a
 * trilha (ela é append-only, docs/03 §8). Refazer volta a passar pelo comando
 * original, que é quem grava o evento — então desfazer/refazer não duplica
 * registro nenhum.
 */
function setChangeRequestStatus(input: { changeRequestId: string; status: CrStatus }): Command<
  { changeRequestId: string; status: CrStatus },
  void
> {
  return defineCommand({
    type: 'changeRequest/_setStatus',
    input,
    label: `Voltar a solicitação para ${input.status}`,
    scope: { changeRequestId: input.changeRequestId },
    execute(doc) {
      const { changeRequest: cr, index } = locateChangeRequest(doc, input.changeRequestId);
      const inverse = setChangeRequestStatus({ changeRequestId: cr.id, status: cr.status });
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.changeRequests[index]!.status = input.status;
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// changeRequest/approve · return · reject
// ---------------------------------------------------------------------------
// #region: change-request-decisoes

export type DecideChangeRequestInput = { changeRequestId: string; comment?: string };

const DECISION_TARGET: Record<CrApprovalDecision, CrStatus> = {
  APPROVED: 'APPROVED',
  RETURNED: 'CHANGES_REQUESTED',
  REJECTED: 'REJECTED',
};

const DECISION_VERB: Record<CrApprovalDecision, string> = {
  APPROVED: 'aprovou',
  RETURNED: 'devolveu para ajuste',
  REJECTED: 'rejeitou',
};

/**
 * Aprovar / devolver / rejeitar: a transição do grafo **mais** o registro
 * `{by, at, decision, comment}` em `approvals` (US-GOV-04).
 *
 * RN-GOV-04: aprovar **não** publica. O comando toca `status`, `approvals` e a
 * trilha — nenhuma versão de componente ou de matriz muda de estado aqui.
 */
function decideChangeRequest(
  type: string,
  decision: CrApprovalDecision,
  input: DecideChangeRequestInput,
): Command<DecideChangeRequestInput, { status: CrStatus }> {
  return defineCommand({
    type,
    input,
    label:
      decision === 'APPROVED'
        ? 'Aprovar a solicitação'
        : decision === 'RETURNED'
          ? 'Devolver a solicitação para ajuste'
          : 'Rejeitar a solicitação',
    scope: { changeRequestId: input.changeRequestId },
    execute(doc, ctx) {
      const { changeRequest: cr, index } = locateChangeRequest(doc, input.changeRequestId);
      const to = DECISION_TARGET[decision];
      assertTransitionAllowed(cr, to);

      // Devolução exige comentário (US-GOV-04): sem ele o autor não sabe o que
      // corrigir, e a devolução vira um estado sem instrução.
      if (decision === 'RETURNED' && (input.comment === undefined || input.comment.trim() === '')) {
        throw new DomainError(
          'INVALID_INPUT',
          'Devolver a solicitação exige um comentário dizendo o que precisa ser ajustado.',
          { changeRequestId: cr.id },
        );
      }

      const approval: CrApproval = {
        by: ctx.actor,
        at: isoFrom(ctx.now()),
        decision,
      };
      if (input.comment !== undefined) {
        approval.comment = assertText(input.comment, 'O comentário da decisão');
      }

      const events = [
        makeEvent(ctx, {
          type: 'CR_DECIDED',
          scope: { changeRequestId: cr.id },
          summary:
            approval.comment === undefined
              ? `${ctx.actor} ${DECISION_VERB[decision]} a solicitação "${cr.code}".`
              : `${ctx.actor} ${DECISION_VERB[decision]} a solicitação "${cr.code}": ${approval.comment}`,
          payload: { decision, from: cr.status, to },
        }),
      ];

      return {
        document: applyToChangeRequest(doc, index, events, (target) => {
          target.status = to;
          target.approvals.push(approval);
        }),
        data: { status: to },
        events,
        inverse: restoreChangeRequestDecision({
          changeRequestId: cr.id,
          status: cr.status,
          approvals: structuredClone(cr.approvals),
        }),
      };
    },
  });
}

export function approveChangeRequest(
  input: DecideChangeRequestInput,
): Command<DecideChangeRequestInput, { status: CrStatus }> {
  return decideChangeRequest('changeRequest/approve', 'APPROVED', input);
}

export function returnChangeRequest(
  input: DecideChangeRequestInput,
): Command<DecideChangeRequestInput, { status: CrStatus }> {
  return decideChangeRequest('changeRequest/return', 'RETURNED', input);
}

export function rejectChangeRequest(
  input: DecideChangeRequestInput,
): Command<DecideChangeRequestInput, { status: CrStatus }> {
  return decideChangeRequest('changeRequest/reject', 'REJECTED', input);
}

/**
 * Inverso das decisões: status e `approvals` exatamente como estavam. O
 * histórico de aprovação **não** é preservado por acidente — devolver por
 * `CHANGES_REQUESTED` mantém as decisões anteriores (CT-GOV-04), e é só o
 * desfazer que as remove.
 */
function restoreChangeRequestDecision(input: {
  changeRequestId: string;
  status: CrStatus;
  approvals: CrApproval[];
}): Command<{ changeRequestId: string; status: CrStatus; approvals: CrApproval[] }, void> {
  return defineCommand({
    type: 'changeRequest/_restoreDecision',
    input,
    label: 'Desfazer a decisão sobre a solicitação',
    scope: { changeRequestId: input.changeRequestId },
    execute(doc) {
      const { changeRequest: cr, index } = locateChangeRequest(doc, input.changeRequestId);
      const inverse = restoreChangeRequestDecision({
        changeRequestId: cr.id,
        status: cr.status,
        approvals: structuredClone(cr.approvals),
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.changeRequests[index]!;
          target.status = input.status;
          target.approvals = structuredClone(input.approvals);
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------
// #region: change-request-consultas

/** Os DBs que tocam um componente — `abertos` no sentido da RN-GOV-02 (status < `APPROVED`). */
export function listChangeRequestsForComponent(
  doc: PolicyOpsDocument,
  componentId: string,
  options: { openOnly?: boolean } = {},
): ChangeRequest[] {
  return doc.changeRequests.filter(
    (cr) =>
      cr.items.some((item) => item.componentId === componentId) &&
      (options.openOnly !== true || !isChangeRequestClosed(cr.status)),
  );
}
