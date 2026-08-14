import {
  applyToDocument,
  defineCommand,
  irreversible,
  isoFrom,
  makeEvent,
  type Command,
} from '../command';
import { locateComponent } from '../document/components';
import {
  ISO_DATE_REGEX,
  PAYLOAD_KIND_BY_COMPONENT_TYPE,
  type ComponentPayload,
  type ComponentVersion,
  type DocEvent,
  type PolicyComponent,
  type PolicyOpsDocument,
  type RichDoc,
} from '../document/schema';
import { DomainError } from '../errors';

/**
 * Ciclo de vida da versão de componente — docs/14-governanca-de-alteracoes.md
 * §3.2, RN-GOV-06. É o ciclo das matrizes (`./lifecycle.ts`, docs/05 §1)
 * aplicado à árvore de política:
 *
 * ```
 *   criar rascunho                       publicar
 *    v1 DRAFT ─────────────────────────► v1 PUBLISHED
 *                     criar rascunho ◄──────┤
 *                          v2 DRAFT         │
 *                     publicar ─► v2 PUBLISHED, v1 SUPERSEDED
 * ```
 *
 * Três diferenças em relação à matriz, todas ditadas pelo contrato de docs/14
 * §3.2 — e não por conveniência:
 *
 * 1. **Não existe `ARCHIVED`.** `ComponentVersion.state` tem três estados, e
 *    só. Descartar um rascunho o **remove** da lista; o número volta a ficar
 *    livre, e por isso `componentVersion/discardDraft` tem inverso exato — ao
 *    contrário do descarte de rascunho de matriz, que queima o número.
 * 2. **`effectiveFrom` é obrigatório ao publicar** (docs/14 §3.2), enquanto na
 *    matriz ele é opcional e cai em "agora".
 * 3. **Vigência retroativa é permitida.** É o que a RN-GOV-09 exige: a
 *    fundação cadastra ~100 regras que **já vigoram**, com a data em que a
 *    política entrou em vigor. A ordem continua valendo — a vigência nova
 *    precisa começar depois da vigente —, e é o que impede a linha do tempo de
 *    se sobrepor (I29).
 *
 * O que **não** muda: publicar é irreversível (I3), sobrescrever versão selada
 * é impossível, e a versão anterior vira `SUPERSEDED` com
 * `effectiveTo = effectiveFrom` da nova, sem nunca ser descartada.
 */

// ---------------------------------------------------------------------------
// Localização e guardas
// ---------------------------------------------------------------------------
// #region: localizacao-e-guardas

export type ComponentVersionLocation = {
  component: PolicyComponent;
  componentIndex: number;
  version: ComponentVersion;
  versionIndex: number;
};

export function locateComponentVersion(
  doc: PolicyOpsDocument,
  versionId: string,
): ComponentVersionLocation {
  for (let componentIndex = 0; componentIndex < doc.components.length; componentIndex++) {
    const component = doc.components[componentIndex]!;
    const versionIndex = component.versions.findIndex((candidate) => candidate.id === versionId);
    if (versionIndex >= 0) {
      return {
        component,
        componentIndex,
        version: component.versions[versionIndex]!,
        versionIndex,
      };
    }
  }
  throw new DomainError('NOT_FOUND', 'A versão de componente informada não existe neste documento.', {
    versionId,
  });
}

/** Espelho da guarda de `./lifecycle.ts`: conteúdo só se edita em rascunho (I3). */
export function assertComponentVersionEditable(version: ComponentVersion): void {
  if (version.state !== 'DRAFT') {
    throw new DomainError(
      'VERSION_IMMUTABLE',
      `A versão ${version.number} está em ${version.state} e não pode mais ser editada.`,
      { versionId: version.id, state: version.state },
    );
  }
}

/** Mesma condição, outro código: publicar e descartar mudam o estado, não o conteúdo. */
export function assertComponentVersionDraft(version: ComponentVersion): void {
  if (version.state !== 'DRAFT') {
    throw new DomainError(
      'VERSION_NOT_DRAFT',
      `A versão ${version.number} está em ${version.state}; esta ação só vale enquanto ela é um rascunho.`,
      { versionId: version.id, state: version.state },
    );
  }
}

function componentVersionScope(component: PolicyComponent, versionId: string): DocEvent['scope'] {
  return { projectId: component.projectId, componentId: component.id, componentVersionId: versionId };
}

/** A versão publicada vigente — I29 garante que há no máximo uma. */
function publishedVersionOf(component: PolicyComponent): ComponentVersion | undefined {
  return component.versions.find((version) => version.state === 'PUBLISHED');
}

/**
 * I27/I29: `MATRIX` nunca versiona nada — nome, vigência e histórico do nó vêm
 * da `Matrix` referenciada —, e o `payload` casa com o tipo do componente.
 */
function assertPayloadFits(component: PolicyComponent, payload: ComponentPayload): void {
  if (component.type === 'MATRIX') {
    throw new DomainError(
      'COMPONENT_TREE_INVALID',
      `O componente "${component.code}" é um espelho de matriz: a vigência e o histórico dele são os da matriz, e ele não tem versão própria.`,
      { componentId: component.id },
    );
  }
  const expected = PAYLOAD_KIND_BY_COMPONENT_TYPE[component.type];
  if (payload.kind !== expected) {
    throw new DomainError(
      'INVALID_INPUT',
      `O componente "${component.code}" é do tipo ${component.type} e espera conteúdo do tipo ${expected} (veio ${payload.kind}).`,
      { componentId: component.id, expected, received: payload.kind },
    );
  }
}

// ---------------------------------------------------------------------------
// componentVersion/createDraft
// ---------------------------------------------------------------------------
// #region: component-version-create-draft

export type CreateComponentDraftInput = {
  componentId: string;
  /** Base a clonar; ausente = a publicada vigente, quando existe. */
  baseVersionId?: string;
  /** Conteúdo inicial. Obrigatório na **primeira** versão; vence a base quando ambos vêm. */
  payload?: ComponentPayload;
  spec?: RichDoc;
  /** Aceito e preservado; nada na S32a o preenche (RN-GOV-07). */
  changeRequestId?: string;
};

export type CreateComponentDraftData = {
  versionId: string;
  number: number;
  baseVersionNumber: number | null;
};

export function createComponentDraft(
  input: CreateComponentDraftInput,
): Command<CreateComponentDraftInput, CreateComponentDraftData> {
  return defineCommand({
    type: 'componentVersion/createDraft',
    input,
    label: 'Criar rascunho do componente',
    scope: { componentId: input.componentId },
    execute(doc, ctx) {
      const { component, index: componentIndex } = locateComponent(doc, input.componentId);

      // I29: no máximo um rascunho por componente.
      const existingDraft = component.versions.find((version) => version.state === 'DRAFT');
      if (existingDraft !== undefined) {
        throw new DomainError(
          'DRAFT_ALREADY_EXISTS',
          `O componente "${component.code}" já tem a versão ${existingDraft.number} em rascunho.`,
          { componentId: component.id, versionId: existingDraft.id },
        );
      }

      let base: ComponentVersion | undefined;
      if (input.baseVersionId === undefined) {
        base = publishedVersionOf(component);
      } else {
        base = component.versions.find((version) => version.id === input.baseVersionId);
        if (base === undefined) {
          throw new DomainError(
            'NOT_FOUND',
            'A versão de origem informada não pertence a este componente.',
            { componentId: component.id, baseVersionId: input.baseVersionId },
          );
        }
      }

      const payload = input.payload ?? base?.payload;
      if (payload === undefined) {
        throw new DomainError(
          'NO_VERSION_TO_DERIVE',
          `O componente "${component.code}" não tem versão para derivar — informe o conteúdo da primeira versão.`,
          { componentId: component.id },
        );
      }
      assertPayloadFits(component, payload);

      const number =
        component.versions.length === 0
          ? 1
          : Math.max(...component.versions.map((version) => version.number)) + 1;
      const versionId = ctx.newId();
      const draft: ComponentVersion = {
        id: versionId,
        number,
        state: 'DRAFT',
        createdAt: isoFrom(ctx.now()),
        createdBy: ctx.actor,
        payload: structuredClone(payload),
      };
      const spec = input.spec ?? base?.spec;
      if (spec !== undefined) draft.spec = structuredClone(spec);
      if (input.changeRequestId !== undefined) draft.changeRequestId = input.changeRequestId;

      const events = [
        makeEvent(ctx, {
          type: 'COMPONENT_DRAFT_CREATED',
          scope: componentVersionScope(component, versionId),
          summary:
            base === undefined
              ? `${ctx.actor} criou a versão 1 de "${component.code}".`
              : `${ctx.actor} criou a versão ${number} de "${component.code}" a partir da versão ${base.number}.`,
          payload: { baseVersionNumber: base?.number ?? null },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft2) => {
          draft2.components[componentIndex]!.versions.push(draft);
        }),
        data: { versionId, number, baseVersionNumber: base?.number ?? null },
        events,
        inverse: removeCreatedComponentVersion({
          componentId: component.id,
          versionId,
          number,
        }),
      };
    },
  });
}

/** Inverso de `componentVersion/createDraft`: apaga o rascunho recém-criado, sem deixar rastro. */
function removeCreatedComponentVersion(input: {
  componentId: string;
  versionId: string;
  number: number;
}): Command<{ componentId: string; versionId: string; number: number }, void> {
  return defineCommand({
    type: 'componentVersion/_removeCreated',
    input,
    label: `Desfazer a criação da versão ${input.number}`,
    scope: { componentId: input.componentId, componentVersionId: input.versionId },
    execute(doc) {
      const { component, componentIndex, version, versionIndex } = locateComponentVersion(
        doc,
        input.versionId,
      );
      assertComponentVersionEditable(version);
      const removed = structuredClone(version);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.components[componentIndex]!.versions.splice(versionIndex, 1);
        }),
        data: undefined,
        events: [],
        inverse: restoreComponentVersion({
          componentId: component.id,
          version: removed,
          index: versionIndex,
        }),
      };
    },
  });
}

/** Refazer: devolve a versão idêntica, na posição em que estava. */
function restoreComponentVersion(input: {
  componentId: string;
  version: ComponentVersion;
  index: number;
}): Command<{ componentId: string; version: ComponentVersion; index: number }, void> {
  return defineCommand({
    type: 'componentVersion/_restore',
    input,
    label: `Refazer a criação da versão ${input.version.number}`,
    scope: { componentId: input.componentId, componentVersionId: input.version.id },
    execute(doc) {
      const { index: componentIndex } = locateComponent(doc, input.componentId);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.components[componentIndex]!.versions.splice(
            input.index,
            0,
            structuredClone(input.version),
          );
        }),
        data: undefined,
        events: [],
        inverse: removeCreatedComponentVersion({
          componentId: input.componentId,
          versionId: input.version.id,
          number: input.version.number,
        }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// componentVersion/update
// ---------------------------------------------------------------------------
// #region: component-version-update

export type UpdateComponentVersionInput = {
  versionId: string;
  payload?: ComponentPayload;
  /** Ausente = não mexe; `null` = apaga a especificação. */
  spec?: RichDoc | null;
  changeRequestId?: string | null;
};

export function updateComponentVersion(
  input: UpdateComponentVersionInput,
): Command<UpdateComponentVersionInput, void> {
  return defineCommand({
    type: 'componentVersion/update',
    input,
    label: 'Editar o rascunho do componente',
    scope: { componentVersionId: input.versionId },
    execute(doc) {
      const { component, componentIndex, version, versionIndex } = locateComponentVersion(
        doc,
        input.versionId,
      );
      assertComponentVersionEditable(version);
      if (input.payload !== undefined) assertPayloadFits(component, input.payload);

      const inverse = updateComponentVersion({
        versionId: version.id,
        payload: structuredClone(version.payload),
        spec: version.spec === undefined ? null : structuredClone(version.spec),
        changeRequestId: version.changeRequestId ?? null,
      });

      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.components[componentIndex]!.versions[versionIndex]!;
          if (input.payload !== undefined) target.payload = structuredClone(input.payload);
          if (input.spec !== undefined) {
            if (input.spec === null) delete target.spec;
            else target.spec = structuredClone(input.spec);
          }
          if (input.changeRequestId !== undefined) {
            if (input.changeRequestId === null) delete target.changeRequestId;
            else target.changeRequestId = input.changeRequestId;
          }
        }),
        data: undefined,
        // Editar rascunho não gera evento, como `version/applyCellPatch` também
        // não gera: o que a linha do tempo registra é a publicação.
        events: [],
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// componentVersion/publish
// ---------------------------------------------------------------------------
// #region: component-version-publish

export type PublishComponentVersionInput = {
  versionId: string;
  /** Obrigatória (docs/14 §3.2). Pode ser retroativa — é o caminho da RN-GOV-09. */
  effectiveFrom: string;
};

export type PublishComponentVersionData = {
  versionId: string;
  effectiveFrom: string;
  supersededVersionId: string | null;
};

export function publishComponentVersion(
  input: PublishComponentVersionInput,
): Command<PublishComponentVersionInput, PublishComponentVersionData> {
  return defineCommand({
    type: 'componentVersion/publish',
    input,
    label: 'Publicar versão do componente',
    scope: { componentVersionId: input.versionId },
    execute(doc, ctx) {
      const { component, componentIndex, version, versionIndex } = locateComponentVersion(
        doc,
        input.versionId,
      );

      assertComponentVersionDraft(version);
      assertPayloadFits(component, version.payload);

      if (!ISO_DATE_REGEX.test(input.effectiveFrom)) {
        throw new DomainError(
          'INVALID_INPUT',
          'A data de vigência precisa estar no formato ISO 8601 UTC.',
          { effectiveFrom: input.effectiveFrom },
        );
      }
      const effectiveFrom = input.effectiveFrom;

      const current = publishedVersionOf(component);
      if (current !== undefined && effectiveFrom <= current.effectiveFrom!) {
        throw new DomainError(
          'EFFECTIVE_DATE_INVALID',
          `A vigência precisa começar depois de ${current.effectiveFrom}, início da versão ${current.number}.`,
          { effectiveFrom, currentEffectiveFrom: current.effectiveFrom },
        );
      }

      const nowISO = isoFrom(ctx.now());
      const events: DocEvent[] = [];
      if (current !== undefined) {
        events.push(
          makeEvent(ctx, {
            type: 'COMPONENT_VERSION_SUPERSEDED',
            scope: componentVersionScope(component, current.id),
            summary: `A versão ${current.number} de "${component.code}" foi substituída pela versão ${version.number}.`,
            payload: { byVersionNumber: version.number, effectiveTo: effectiveFrom },
          }),
        );
      }
      events.push(
        makeEvent(ctx, {
          type: 'COMPONENT_VERSION_PUBLISHED',
          scope: componentVersionScope(component, version.id),
          summary:
            version.changeRequestId === undefined
              ? `${ctx.actor} publicou a versão ${version.number} de "${component.code}" (publicação direta), vigente a partir de ${effectiveFrom}.`
              : `${ctx.actor} publicou a versão ${version.number} de "${component.code}", vigente a partir de ${effectiveFrom}.`,
          payload: {
            effectiveFrom,
            // RN-GOV-07: a timeline distingue o que veio de um DB do que foi
            // publicado direto. `null` é "publicação direta", e é informação,
            // não ausência de dado.
            changeRequestId: version.changeRequestId ?? null,
          },
        }),
      );

      const currentIndex =
        current === undefined
          ? -1
          : component.versions.findIndex((candidate) => candidate.id === current.id);

      return {
        document: applyToDocument(doc, events, (draft) => {
          const versions = draft.components[componentIndex]!.versions;
          if (currentIndex >= 0) {
            const superseded = versions[currentIndex]!;
            superseded.state = 'SUPERSEDED';
            superseded.effectiveTo = effectiveFrom;
          }
          const published = versions[versionIndex]!;
          published.state = 'PUBLISHED';
          published.publishedAt = nowISO;
          published.publishedBy = ctx.actor;
          published.effectiveFrom = effectiveFrom;
        }),
        data: {
          versionId: version.id,
          effectiveFrom,
          supersededVersionId: current === undefined ? null : current.id,
        },
        events,
        inverse: irreversible(
          'Publicar uma versão não pode ser desfeito. Para voltar atrás, crie um rascunho a partir da versão anterior e publique-o.',
        ),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// componentVersion/discardDraft
// ---------------------------------------------------------------------------
// #region: component-version-discard-draft

export type DiscardComponentDraftInput = { versionId: string };
export type DiscardComponentDraftData = { versionId: string; number: number };

/**
 * Remove o rascunho da lista. Diferente do descarte de rascunho de matriz, tem
 * inverso exato: sem estado `ARCHIVED` no contrato (docs/14 §3.2), a versão
 * some inteira e o número volta a ficar livre — então desfazer é devolver o
 * mesmo registro na mesma posição, byte a byte.
 */
export function discardComponentDraft(
  input: DiscardComponentDraftInput,
): Command<DiscardComponentDraftInput, DiscardComponentDraftData> {
  return defineCommand({
    type: 'componentVersion/discardDraft',
    input,
    label: 'Descartar o rascunho do componente',
    scope: { componentVersionId: input.versionId },
    execute(doc, ctx) {
      const { component, componentIndex, version, versionIndex } = locateComponentVersion(
        doc,
        input.versionId,
      );
      assertComponentVersionDraft(version);
      const removed = structuredClone(version);

      const events = [
        makeEvent(ctx, {
          type: 'COMPONENT_DRAFT_DISCARDED',
          scope: componentVersionScope(component, version.id),
          summary: `${ctx.actor} descartou o rascunho da versão ${version.number} de "${component.code}".`,
          payload: { componentId: component.id, number: version.number },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          draft.components[componentIndex]!.versions.splice(versionIndex, 1);
        }),
        data: { versionId: version.id, number: version.number },
        events,
        inverse: restoreComponentVersion({
          componentId: component.id,
          version: removed,
          index: versionIndex,
        }),
      };
    },
  });
}
