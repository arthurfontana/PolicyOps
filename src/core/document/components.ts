import { applyToDocument, defineCommand, isoFrom, makeEvent, type Command } from '../command';
import { DomainError } from '../errors';
import {
  CODE_REGEX,
  POLICY_COMPONENT_MAX_DEPTH,
  type ComponentOrigin,
  type ComponentReviewStatus,
  type DocEvent,
  type PolicyComponent,
  type PolicyComponentType,
  type PolicyOpsDocument,
} from './schema';

/**
 * Comandos da árvore de política — docs/08-camada-de-comandos.md §3,
 * docs/14-governanca-de-alteracoes.md §3.1.
 *
 * A árvore é gravada **plana** em `doc.components` e reconstruída por
 * `parentId`; `position` ordena os irmãos, 0-based e sem buracos (I28). Isso
 * mantém a coleção igual a todas as outras do documento — sem estrutura
 * aninhada no `.json`, sem caminho para reindexar quando um nó se move.
 *
 * Três garantias em tempo de comando, que I27/I28 conferem depois no documento
 * parado:
 *
 * 1. **`code` é único no projeto e imutável** — `component/update` não aceita
 *    `code`, e `component/create` recusa duplicata com `COMPONENT_CODE_DUPLICATE`
 *    (`E-GOV-06`), que é o que a carga por recorte (S40) usa para bloquear o
 *    mesmo capítulo entrando duas vezes.
 * 2. **`MATRIX` é folha e espelho** — nunca ganha filho nem versão própria, e
 *    uma matriz entra na árvore uma vez só (I27).
 * 3. **Mover valida ciclo e profundidade** — mover um nó para dentro da
 *    própria subárvore é `COMPONENT_TREE_INVALID`, e a altura da subárvore
 *    movida conta no teto de `POLICY_COMPONENT_MAX_DEPTH` níveis.
 *
 * O inverso segue o padrão de `./commands.ts`: **o próprio comando com os
 * valores anteriores**, para que desfazer e refazer devolvam o documento byte a
 * byte sem depender de `ctx.now()` na hora do desfazer.
 */

// ---------------------------------------------------------------------------
// Localização e utilitários de árvore
// ---------------------------------------------------------------------------
// #region: localizacao-e-utilitarios-de-arvore

export type ComponentLocation = { component: PolicyComponent; index: number };

export function locateComponent(doc: PolicyOpsDocument, componentId: string): ComponentLocation {
  const index = doc.components.findIndex((candidate) => candidate.id === componentId);
  if (index < 0) {
    throw new DomainError('NOT_FOUND', 'O componente informado não existe neste documento.', {
      componentId,
    });
  }
  return { component: doc.components[index]!, index };
}

/** Filhos diretos de um nó (ou as raízes do projeto, com `parentId` ausente), já em ordem. */
export function listChildren(
  doc: PolicyOpsDocument,
  projectId: string,
  parentId: string | undefined,
): PolicyComponent[] {
  return doc.components
    .filter(
      (component) => component.projectId === projectId && (component.parentId ?? undefined) === parentId,
    )
    .sort((a, b) => a.position - b.position);
}

/** Nível do nó na árvore, 1-based (raiz = 1). Assume a árvore acíclica (I28). */
export function componentDepth(doc: PolicyOpsDocument, component: PolicyComponent): number {
  const byId = new Map(doc.components.map((candidate) => [candidate.id, candidate]));
  let depth = 1;
  let current = component;
  const seen = new Set<string>([component.id]);
  while (current.parentId !== undefined) {
    const parent = byId.get(current.parentId);
    if (parent === undefined || seen.has(parent.id)) break;
    seen.add(parent.id);
    depth++;
    current = parent;
  }
  return depth;
}

/** O nó e todos os seus descendentes — a subárvore que um `component/move` carrega junto. */
export function subtreeIds(doc: PolicyOpsDocument, componentId: string): Set<string> {
  const ids = new Set<string>([componentId]);
  // A árvore é rasa (teto de 6 níveis) e o documento é plano: varrer a coleção
  // até estabilizar custa menos do que manter um índice de filhos.
  let grew = true;
  while (grew) {
    grew = false;
    for (const component of doc.components) {
      if (component.parentId === undefined) continue;
      if (ids.has(component.id) || !ids.has(component.parentId)) continue;
      ids.add(component.id);
      grew = true;
    }
  }
  return ids;
}

/** Altura da subárvore em níveis (nó folha = 1) — o que o teto de profundidade precisa saber. */
function subtreeHeight(doc: PolicyOpsDocument, componentId: string): number {
  const children = doc.components.filter((component) => component.parentId === componentId);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((child) => subtreeHeight(doc, child.id)));
}

function componentScope(component: PolicyComponent): DocEvent['scope'] {
  return { projectId: component.projectId, componentId: component.id };
}

function assertCode(code: string): void {
  if (!CODE_REGEX.test(code)) {
    throw new DomainError(
      'INVALID_INPUT',
      `"${code}" não é um código válido: um código casa ^[A-Z0-9_]+$.`,
      { code },
    );
  }
}

function assertText(value: string, what: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DomainError('INVALID_INPUT', `${what} não pode ficar em branco.`, { value });
  }
  return trimmed;
}

/** Valor anterior de um campo opcional, no formato que o inverso precisa. */
function previous<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/** I28: toda tag é `CatalogItem` de kind `TAG` existente, sem repetição no mesmo nó. */
function assertTags(doc: PolicyOpsDocument, tags: string[]): string[] {
  const out: string[] = [];
  for (const code of tags) {
    assertCode(code);
    const item = doc.catalog.find((candidate) => candidate.kind === 'TAG' && candidate.code === code);
    if (item === undefined) {
      throw new DomainError('TAG_NOT_FOUND', `A tag "${code}" não existe no catálogo.`, { code });
    }
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

/**
 * I27, na hora do comando: o espelho aponta uma matriz do mesmo projeto e é
 * exclusivo. `exceptComponentId` deixa o próprio nó de fora da checagem de
 * exclusividade, para que reescrever o mesmo vínculo não conflite consigo.
 */
function assertMirror(
  doc: PolicyOpsDocument,
  input: {
    type: PolicyComponentType;
    projectId: string;
    matrixId?: string;
    variableId?: string;
    exceptComponentId?: string;
  },
): void {
  const others = doc.components.filter((candidate) => candidate.id !== input.exceptComponentId);

  if (input.type === 'MATRIX') {
    if (input.matrixId === undefined) {
      throw new DomainError(
        'COMPONENT_TREE_INVALID',
        'Um componente do tipo MATRIX precisa apontar uma matriz existente do mesmo projeto.',
      );
    }
    const matrix = doc.matrices.find((candidate) => candidate.id === input.matrixId);
    if (matrix === undefined) {
      throw new DomainError('NOT_FOUND', 'A matriz informada não existe neste documento.', {
        matrixId: input.matrixId,
      });
    }
    if (matrix.projectId !== input.projectId) {
      throw new DomainError(
        'COMPONENT_TREE_INVALID',
        `A matriz "${matrix.code}" é de outro projeto e não pode entrar nesta árvore.`,
        { matrixId: matrix.id },
      );
    }
    const mirrored = others.find((candidate) => candidate.matrixId === matrix.id);
    if (mirrored !== undefined) {
      throw new DomainError(
        'COMPONENT_TREE_INVALID',
        `A matriz "${matrix.code}" já está na árvore, no componente "${mirrored.code}" — uma matriz entra uma vez só.`,
        { matrixId: matrix.id, componentId: mirrored.id },
      );
    }
  } else if (input.matrixId !== undefined) {
    throw new DomainError(
      'COMPONENT_TREE_INVALID',
      'Só um componente do tipo MATRIX aponta matriz.',
      { type: input.type },
    );
  }

  if (input.variableId === undefined) return;
  if (input.type !== 'POLICY_VARIABLE') {
    throw new DomainError(
      'COMPONENT_TREE_INVALID',
      'Só um componente do tipo POLICY_VARIABLE espelha variável da Biblioteca.',
      { type: input.type },
    );
  }
  const variable = doc.variables.find((candidate) => candidate.id === input.variableId);
  if (variable === undefined) {
    throw new DomainError('NOT_FOUND', 'A variável informada não existe neste documento.', {
      variableId: input.variableId,
    });
  }
  const mirrored = others.find((candidate) => candidate.variableId === variable.id);
  if (mirrored !== undefined) {
    throw new DomainError(
      'COMPONENT_TREE_INVALID',
      `A variável "${variable.code}" já é espelhada pelo componente "${mirrored.code}" — o espelho é único.`,
      { variableId: variable.id, componentId: mirrored.id },
    );
  }
}

/** O pai pretendido existe, é do mesmo projeto e aceita filhos (I27/I28). */
function resolveParent(
  doc: PolicyOpsDocument,
  projectId: string,
  parentId: string | undefined,
): PolicyComponent | undefined {
  if (parentId === undefined) return undefined;
  const { component: parent } = locateComponent(doc, parentId);
  if (parent.projectId !== projectId) {
    throw new DomainError(
      'COMPONENT_TREE_INVALID',
      `O componente "${parent.code}" é de outro projeto e não pode ser pai deste nó.`,
      { parentId },
    );
  }
  if (parent.type === 'MATRIX') {
    throw new DomainError(
      'COMPONENT_TREE_INVALID',
      `O componente "${parent.code}" é MATRIX e é sempre folha — ele não pode ter filhos.`,
      { parentId },
    );
  }
  return parent;
}

function assertDepthFits(doc: PolicyOpsDocument, parent: PolicyComponent | undefined, height: number): void {
  const parentDepth = parent === undefined ? 0 : componentDepth(doc, parent);
  const resulting = parentDepth + height;
  if (resulting > POLICY_COMPONENT_MAX_DEPTH) {
    throw new DomainError(
      'COMPONENT_TREE_INVALID',
      `A árvore da política tem no máximo ${POLICY_COMPONENT_MAX_DEPTH} níveis, e este destino levaria a ${resulting}.`,
      { resulting, maximum: POLICY_COMPONENT_MAX_DEPTH },
    );
  }
}

// ---------------------------------------------------------------------------
// component/create
// ---------------------------------------------------------------------------
// #region: component-create

export type CreateComponentInput = {
  projectId: string;
  code: string;
  name: string;
  type: PolicyComponentType;
  parentId?: string;
  matrixId?: string;
  variableId?: string;
  tags?: string[];
  origin?: ComponentOrigin;
  /** Ausente = `STRUCTURED` (nó cadastrado à mão; a carga do S40 usa `PENDING_REVIEW`). */
  reviewStatus?: ComponentReviewStatus;
};

export function createComponent(
  input: CreateComponentInput,
): Command<CreateComponentInput, { componentId: string }> {
  return defineCommand({
    type: 'component/create',
    input,
    label: `Criar o componente "${input.code}"`,
    scope: { projectId: input.projectId },
    execute(doc, ctx) {
      const project = doc.projects.find((candidate) => candidate.id === input.projectId);
      if (project === undefined) {
        throw new DomainError('NOT_FOUND', 'O projeto informado não existe neste documento.', {
          projectId: input.projectId,
        });
      }
      assertCode(input.code);
      const name = assertText(input.name, 'O nome do componente');

      // E-GOV-06: `code` único no projeto — o bloqueio de duplicata da carga.
      const duplicate = doc.components.find(
        (candidate) => candidate.projectId === project.id && candidate.code === input.code,
      );
      if (duplicate !== undefined) {
        throw new DomainError(
          'COMPONENT_CODE_DUPLICATE',
          `A política "${project.code}" já tem um componente com o código "${input.code}".`,
          { code: input.code, projectId: project.id, componentId: duplicate.id },
        );
      }

      const parent = resolveParent(doc, project.id, input.parentId);
      assertDepthFits(doc, parent, 1);
      assertMirror(doc, {
        type: input.type,
        projectId: project.id,
        matrixId: input.matrixId,
        variableId: input.variableId,
      });

      const componentId = ctx.newId();
      const component: PolicyComponent = {
        id: componentId,
        projectId: project.id,
        // Entra no fim dos irmãos: `position` é 0-based e sem buracos (I28).
        position: listChildren(doc, project.id, input.parentId).length,
        code: input.code,
        name,
        type: input.type,
        reviewStatus: input.reviewStatus ?? 'STRUCTURED',
        createdAt: isoFrom(ctx.now()),
        versions: [],
      };
      if (input.parentId !== undefined) component.parentId = input.parentId;
      if (input.matrixId !== undefined) component.matrixId = input.matrixId;
      if (input.variableId !== undefined) component.variableId = input.variableId;
      if (input.tags !== undefined) {
        const tags = assertTags(doc, input.tags);
        if (tags.length > 0) component.tags = tags;
      }
      if (input.origin !== undefined) {
        component.origin = {
          source: assertText(input.origin.source, 'A origem do componente'),
          ...(input.origin.locator === undefined ? {} : { locator: input.origin.locator }),
        };
      }

      const events = [
        makeEvent(ctx, {
          type: 'COMPONENT_CREATED',
          scope: componentScope(component),
          summary: `${ctx.actor} criou o componente "${input.code}" (${input.type}) em "${project.code}".`,
          payload: { code: input.code, name, componentType: input.type, parentId: input.parentId ?? null },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          draft.components.push(component);
        }),
        data: { componentId },
        events,
        inverse: removeCreatedComponent({ componentId, code: input.code }),
      };
    },
  });
}

/**
 * Inverso de `component/create`. Recusa se o nó já ganhou filho ou versão — um
 * desfazer não pode arrastar trabalho que veio depois —, e reindexa os irmãos
 * para que `position` continue 0-based e sem buracos.
 */
function removeCreatedComponent(input: { componentId: string; code: string }): Command<
  { componentId: string; code: string },
  void
> {
  return defineCommand({
    type: 'component/_removeCreated',
    input,
    label: `Desfazer a criação do componente "${input.code}"`,
    scope: { componentId: input.componentId },
    execute(doc) {
      const { component, index } = locateComponent(doc, input.componentId);
      if (doc.components.some((candidate) => candidate.parentId === component.id)) {
        throw new DomainError(
          'COMPONENT_TREE_INVALID',
          `O componente "${component.code}" já tem filhos e não pode ser removido por um desfazer.`,
          { componentId: component.id },
        );
      }
      if (component.versions.length > 0) {
        throw new DomainError(
          'COMPONENT_TREE_INVALID',
          `O componente "${component.code}" já tem histórico e não pode ser removido por um desfazer.`,
          { componentId: component.id },
        );
      }
      const removed = structuredClone(component);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.components.splice(index, 1);
          reindexSiblings(draft.components, component.projectId, component.parentId);
        }),
        data: undefined,
        events: [],
        inverse: restoreComponent({ component: removed, index }),
      };
    },
  });
}

function restoreComponent(input: { component: PolicyComponent; index: number }): Command<
  { component: PolicyComponent; index: number },
  void
> {
  return defineCommand({
    type: 'component/_restore',
    input,
    label: `Refazer a criação do componente "${input.component.code}"`,
    scope: { componentId: input.component.id },
    execute(doc) {
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.components.splice(input.index, 0, structuredClone(input.component));
          reindexSiblings(draft.components, input.component.projectId, input.component.parentId);
        }),
        data: undefined,
        events: [],
        inverse: removeCreatedComponent({
          componentId: input.component.id,
          code: input.component.code,
        }),
      };
    },
  });
}

/**
 * Renumera um grupo de irmãos para 0..n-1 preservando a ordem relativa. O
 * `position` gravado é a única fonte de ordem entre irmãos (I28); a ordem do
 * array `components` é irrelevante para a árvore.
 */
function reindexSiblings(
  components: PolicyComponent[],
  projectId: string,
  parentId: string | undefined,
): void {
  components
    .filter(
      (component) => component.projectId === projectId && (component.parentId ?? undefined) === parentId,
    )
    .sort((a, b) => a.position - b.position)
    .forEach((component, position) => {
      component.position = position;
    });
}

// ---------------------------------------------------------------------------
// component/update
// ---------------------------------------------------------------------------
// #region: component-update

/**
 * `code` e `type` **não** entram: `code` é imutável depois da criação (I28), e
 * trocar `type` viraria um nó `MATRIX` sem espelho ou uma regra com versões de
 * outro payload (I27/I29). As duas mudanças se fazem criando outro nó.
 *
 * Semântica de três estados nos opcionais, igual à dos metadados de matriz:
 * ausente = não mexe, `null` = apaga, valor = define.
 */
export type UpdateComponentInput = {
  componentId: string;
  name?: string;
  tags?: string[] | null;
  origin?: ComponentOrigin | null;
  variableId?: string | null;
};

export function updateComponent(input: UpdateComponentInput): Command<UpdateComponentInput, void> {
  return defineCommand({
    type: 'component/update',
    input,
    label: 'Editar o componente',
    scope: { componentId: input.componentId },
    execute(doc, ctx) {
      const { component, index } = locateComponent(doc, input.componentId);
      const name = input.name === undefined ? undefined : assertText(input.name, 'O nome do componente');
      const tags = input.tags === undefined || input.tags === null ? input.tags : assertTags(doc, input.tags);

      if (input.variableId !== undefined) {
        assertMirror(doc, {
          type: component.type,
          projectId: component.projectId,
          matrixId: component.matrixId,
          variableId: input.variableId ?? undefined,
          exceptComponentId: component.id,
        });
      }

      const inverse = updateComponent({
        componentId: component.id,
        name: component.name,
        tags: component.tags === undefined ? null : [...component.tags],
        origin: previous(component.origin),
        variableId: previous(component.variableId),
      });

      const events = [
        makeEvent(ctx, {
          type: 'COMPONENT_UPDATED',
          scope: componentScope(component),
          summary: `${ctx.actor} editou o componente "${component.code}".`,
          payload: { componentId: component.id },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          const target = draft.components[index]!;
          if (name !== undefined) target.name = name;
          if (tags !== undefined) {
            if (tags === null || tags.length === 0) delete target.tags;
            else target.tags = tags;
          }
          if (input.origin !== undefined) {
            if (input.origin === null) delete target.origin;
            else target.origin = input.origin;
          }
          if (input.variableId !== undefined) {
            if (input.variableId === null) delete target.variableId;
            else target.variableId = input.variableId;
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
// component/move
// ---------------------------------------------------------------------------
// #region: component-move

export type MoveComponentInput = {
  componentId: string;
  /** Ausente = não muda de pai; `null` = vira raiz do projeto. */
  parentId?: string | null;
  /** Ausente = fim da lista de irmãos do destino. */
  position?: number;
};

export function moveComponent(input: MoveComponentInput): Command<MoveComponentInput, void> {
  return defineCommand({
    type: 'component/move',
    input,
    label: 'Mover o componente',
    scope: { componentId: input.componentId },
    execute(doc, ctx) {
      const { component, index } = locateComponent(doc, input.componentId);
      const fromParentId = component.parentId;
      const toParentId =
        input.parentId === undefined ? fromParentId : (input.parentId ?? undefined);

      // Ciclo (I28): o destino não pode estar dentro da própria subárvore.
      if (toParentId !== undefined && subtreeIds(doc, component.id).has(toParentId)) {
        throw new DomainError(
          'COMPONENT_TREE_INVALID',
          `"${component.code}" não pode ser movido para dentro de si mesmo.`,
          { componentId: component.id, parentId: toParentId },
        );
      }

      const parent = resolveParent(doc, component.projectId, toParentId);
      assertDepthFits(doc, parent, subtreeHeight(doc, component.id));

      const sameParent = toParentId === fromParentId;
      const siblings = listChildren(doc, component.projectId, toParentId).filter(
        (candidate) => candidate.id !== component.id,
      );
      const requested = input.position ?? siblings.length;
      if (requested < 0) {
        throw new DomainError('INVALID_INPUT', 'A posição de destino não pode ser negativa.', {
          position: requested,
        });
      }
      const target = Math.min(requested, siblings.length);

      const inverse = moveComponent({
        componentId: component.id,
        parentId: fromParentId ?? null,
        position: component.position,
      });

      // Nada muda: sem evento e sem escrita, para que um "mover para onde já
      // estava" não suje a auditoria (mesmo padrão de `matrix/setTags`).
      if (sameParent && target === component.position) {
        return { document: doc, data: undefined, events: [], inverse };
      }

      const events = [
        makeEvent(ctx, {
          type: 'COMPONENT_MOVED',
          scope: componentScope(component),
          summary: `${ctx.actor} moveu o componente "${component.code}" na árvore da política.`,
          payload: {
            componentId: component.id,
            fromParentId: fromParentId ?? null,
            toParentId: toParentId ?? null,
            fromPosition: component.position,
            toPosition: target,
          },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          const moved = draft.components[index]!;
          if (toParentId === undefined) delete moved.parentId;
          else moved.parentId = toParentId;
          // Fora da faixa dos irmãos enquanto o grupo é reordenado: garante que
          // o nó movido caia exatamente em `target` na reinserção abaixo.
          moved.position = Number.MAX_SAFE_INTEGER;

          if (!sameParent) reindexSiblings(draft.components, component.projectId, fromParentId);

          const group = draft.components
            .filter(
              (candidate) =>
                candidate.projectId === component.projectId &&
                (candidate.parentId ?? undefined) === toParentId &&
                candidate.id !== moved.id,
            )
            .sort((a, b) => a.position - b.position);
          group.splice(target, 0, moved);
          group.forEach((candidate, position) => {
            candidate.position = position;
          });
        }),
        data: undefined,
        events,
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// component/archive
// ---------------------------------------------------------------------------
// #region: component-archive

export type ArchiveComponentInput = { componentId: string };

export function archiveComponent(
  input: ArchiveComponentInput,
): Command<ArchiveComponentInput, void> {
  return defineCommand({
    type: 'component/archive',
    input,
    label: 'Arquivar o componente',
    scope: { componentId: input.componentId },
    execute(doc, ctx) {
      const { component, index } = locateComponent(doc, input.componentId);
      const archivedAt = isoFrom(ctx.now());
      const inverse = setComponentArchived({
        componentId: component.id,
        archivedAt: previous(component.archivedAt),
      });

      const events = [
        makeEvent(ctx, {
          type: 'COMPONENT_ARCHIVED',
          scope: componentScope(component),
          summary: `${ctx.actor} arquivou o componente "${component.code}".`,
          payload: { componentId: component.id, archivedAt },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          draft.components[index]!.archivedAt = archivedAt;
        }),
        data: undefined,
        events,
        inverse,
      };
    },
  });
}

/**
 * Grava `archivedAt` com um valor exato (ou o remove). É o inverso de
 * `component/archive`: desfazer não pode chamar `ctx.now()` de novo, senão
 * refazer produziria um carimbo diferente do original.
 */
function setComponentArchived(input: { componentId: string; archivedAt: string | null }): Command<
  { componentId: string; archivedAt: string | null },
  void
> {
  return defineCommand({
    type: 'component/_setArchived',
    input,
    label: input.archivedAt === null ? 'Desarquivar o componente' : 'Arquivar o componente',
    scope: { componentId: input.componentId },
    execute(doc) {
      const { component, index } = locateComponent(doc, input.componentId);
      const inverse = setComponentArchived({
        componentId: component.id,
        archivedAt: previous(component.archivedAt),
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.components[index]!;
          if (input.archivedAt === null) delete target.archivedAt;
          else target.archivedAt = input.archivedAt;
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}

/** Desarquiva um componente — o mesmo comando interno que o desfazer de `component/archive` usa. */
export function restoreArchivedComponent(input: { componentId: string }): Command<
  { componentId: string; archivedAt: string | null },
  void
> {
  return setComponentArchived({ componentId: input.componentId, archivedAt: null });
}

// ---------------------------------------------------------------------------
// component/setReviewStatus
// ---------------------------------------------------------------------------
// #region: component-set-review-status

export type SetComponentReviewStatusInput = {
  componentId: string;
  reviewStatus: ComponentReviewStatus;
};

/**
 * Promover a `VALIDATED` é ação explícita (docs/14 §9, passo 4) — nunca efeito
 * colateral de editar o componente, por isso é comando próprio.
 */
export function setComponentReviewStatus(
  input: SetComponentReviewStatusInput,
): Command<SetComponentReviewStatusInput, void> {
  return defineCommand({
    type: 'component/setReviewStatus',
    input,
    label: 'Alterar o estado de revisão do componente',
    scope: { componentId: input.componentId },
    execute(doc, ctx) {
      const { component, index } = locateComponent(doc, input.componentId);
      const inverse = setComponentReviewStatus({
        componentId: component.id,
        reviewStatus: component.reviewStatus,
      });

      if (component.reviewStatus === input.reviewStatus) {
        return { document: doc, data: undefined, events: [], inverse };
      }

      const events = [
        makeEvent(ctx, {
          type: 'COMPONENT_UPDATED',
          scope: componentScope(component),
          summary: `${ctx.actor} marcou o componente "${component.code}" como ${input.reviewStatus}.`,
          payload: {
            componentId: component.id,
            from: component.reviewStatus,
            to: input.reviewStatus,
          },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          draft.components[index]!.reviewStatus = input.reviewStatus;
        }),
        data: undefined,
        events,
        inverse,
      };
    },
  });
}
