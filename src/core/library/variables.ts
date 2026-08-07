import {
  applyToDocument,
  defineCommand,
  irreversible,
  isoFrom,
  makeEvent,
  type Command,
} from '../command';
import { CODE_REGEX } from '../document/schema';
import type {
  BoundaryMode,
  Domain,
  PolicyOpsDocument,
  RegionalDimension,
  Variable,
  VariableType,
  VariableVersion,
} from '../document/schema';
import { DomainError } from '../errors';
import { getVariableUsage } from '../queries';
import { validateDomains } from './validate-domains';

/**
 * Comandos da Biblioteca de Variáveis — docs/08-camada-de-comandos.md §3 e
 * docs/05-regras-de-negocio.md §5.1.
 *
 * Mesmo contrato da S04 (`src/core/command.ts`): puro, imutável, inversível,
 * valida antes de tocar, registra evento.
 *
 * Sobre eventos: `DocEventType` só tem um tipo dedicado à biblioteca de
 * variáveis, `VARIABLE_PUBLISHED` — é o que a Sessão 04 documenta como a ação
 * que importa auditar (docs/03 §8, docs/05 §7). `create`, `updateMeta`,
 * `createDraft`, `saveDomains`, `discardDraft` e `archive` gravam `events: []`,
 * pela mesma razão que `project/create` e `matrix/updateMeta` gravam (ver a
 * nota em `src/core/command.ts`): inventar um tipo de evento seria alterar o
 * schema do documento.
 *
 * `VariableVersion.state` não tem `ARCHIVED` (docs/03 §2) — ao contrário de
 * `MatrixVersion`, um rascunho de variável descartado não vira um registro
 * histórico: ele é removido de `versions` de verdade, e por isso `number`
 * pode ser reaproveitado pelo próximo rascunho.
 */

const VARIABLE_TYPES: readonly VariableType[] = ['ORDINAL', 'CATEGORICAL', 'RANGE', 'BOOLEAN'];

function assertText(value: string, what: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DomainError('INVALID_INPUT', `${what} não pode ficar em branco.`, { value });
  }
  return trimmed;
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

function assertVariableType(type: string): asserts type is VariableType {
  if (!VARIABLE_TYPES.includes(type as VariableType)) {
    throw new DomainError('INVALID_INPUT', `"${type}" não é um tipo de variável válido.`, { type });
  }
}

/** Valor anterior de um campo opcional, no formato que o inverso precisa. */
function previous(value: string | undefined): string | null {
  return value === undefined ? null : value;
}

function locateVariable(
  doc: PolicyOpsDocument,
  variableId: string,
): { variable: Variable; index: number } {
  const index = doc.variables.findIndex((candidate) => candidate.id === variableId);
  if (index < 0) {
    throw new DomainError('NOT_FOUND', 'A variável informada não existe neste documento.', {
      variableId,
    });
  }
  return { variable: doc.variables[index]!, index };
}

function locateVariableVersion(
  doc: PolicyOpsDocument,
  variableId: string,
  versionId: string,
): { variable: Variable; index: number; version: VariableVersion; versionIndex: number } {
  const { variable, index } = locateVariable(doc, variableId);
  const versionIndex = variable.versions.findIndex((candidate) => candidate.id === versionId);
  if (versionIndex < 0) {
    throw new DomainError(
      'NOT_FOUND',
      'A versão informada não pertence a esta variável.',
      { variableId, versionId },
    );
  }
  return { variable, index, version: variable.versions[versionIndex]!, versionIndex };
}

/** I10: uma `VariableVersion` fora de DRAFT é imutável. */
function assertVariableDraft(version: VariableVersion): void {
  if (version.state !== 'DRAFT') {
    throw new DomainError(
      'VARIABLE_VERSION_IMMUTABLE',
      `A versão ${version.number} já foi publicada e não pode mais ser alterada.`,
      { versionId: version.id, state: version.state },
    );
  }
}

/** Reaproveita `validateDomains` (I8, I9, I18, I19) e embrulha o primeiro problema numa `DomainError`. */
function assertValidDomains(
  type: VariableType,
  domains: Domain[],
  regionalDimension?: RegionalDimension,
  boundaryMode?: BoundaryMode,
): void {
  const result = validateDomains(type, domains, regionalDimension, boundaryMode);
  if (!result.ok) {
    const [first, ...rest] = result.issues;
    throw new DomainError(first!.code, first!.message, { issues: [first, ...rest] });
  }
}

// ---------------------------------------------------------------------------
// variable/create
// ---------------------------------------------------------------------------

export type CreateVariableInput = {
  code: string;
  name: string;
  type: VariableType;
  description?: string;
};
export type CreateVariableData = { variableId: string; versionId: string };

/**
 * Cria a variável com a v1 em DRAFT e `domains: []` — o usuário preenche os
 * domínios com `variable/saveDomains` em seguida. Análogo a `matrix/create`,
 * que nasce com `cells: {}` (docs/05 §1.1.6): nenhum comando materializa
 * conteúdo que o usuário ainda não decidiu.
 */
export function createVariable(
  input: CreateVariableInput,
): Command<CreateVariableInput, CreateVariableData> {
  return defineCommand({
    type: 'variable/create',
    input,
    label: `Criar a variável "${input.code}"`,
    execute(doc, ctx) {
      assertCode(input.code);
      assertVariableType(input.type);
      const name = assertText(input.name, 'O nome da variável');
      if (doc.variables.some((candidate) => candidate.code === input.code)) {
        throw new DomainError(
          'DUPLICATE_CODE',
          `Já existe uma variável com o código "${input.code}".`,
          { code: input.code },
        );
      }

      const now = isoFrom(ctx.now());
      const variableId = ctx.newId();
      const versionId = ctx.newId();
      const version: VariableVersion = {
        id: versionId,
        number: 1,
        state: 'DRAFT',
        createdAt: now,
        createdBy: ctx.actor,
        domains: [],
      };
      const variable: Variable = {
        id: variableId,
        code: input.code,
        name,
        type: input.type,
        createdAt: now,
        versions: [version],
      };
      if (input.description !== undefined) {
        variable.description = assertText(input.description, 'A descrição da variável');
      }

      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.variables.push(variable);
        }),
        data: { variableId, versionId },
        events: [],
        inverse: removeCreatedVariable({ variableId, code: input.code }),
      };
    },
  });
}

/** Inverso de `variable/create`: só remove uma variável ainda intocada (v1 DRAFT, único). */
function removeCreatedVariable(
  input: { variableId: string; code: string },
): Command<{ variableId: string; code: string }, void> {
  return defineCommand({
    type: 'variable/_removeCreated',
    input,
    label: `Desfazer a criação da variável "${input.code}"`,
    scope: { variableId: input.variableId },
    execute(doc) {
      const { variable, index } = locateVariable(doc, input.variableId);
      if (variable.versions.length !== 1 || variable.versions[0]!.state !== 'DRAFT') {
        throw new DomainError(
          'VARIABLE_VERSION_IMMUTABLE',
          `A variável "${variable.code}" já tem histórico e não pode ser removida por um desfazer.`,
          { variableId: variable.id },
        );
      }
      const removed = structuredClone(variable);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.variables.splice(index, 1);
        }),
        data: undefined,
        events: [],
        inverse: restoreVariable({ variable: removed, index }),
      };
    },
  });
}

function restoreVariable(
  input: { variable: Variable; index: number },
): Command<{ variable: Variable; index: number }, void> {
  return defineCommand({
    type: 'variable/_restore',
    input,
    label: `Refazer a criação da variável "${input.variable.code}"`,
    scope: { variableId: input.variable.id },
    execute(doc) {
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.variables.splice(input.index, 0, structuredClone(input.variable));
        }),
        data: undefined,
        events: [],
        inverse: removeCreatedVariable({ variableId: input.variable.id, code: input.variable.code }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// variable/updateMeta
// ---------------------------------------------------------------------------

export type UpdateVariableMetaInput = {
  variableId: string;
  name?: string;
  description?: string | null;
};

export function updateVariableMeta(
  input: UpdateVariableMetaInput,
): Command<UpdateVariableMetaInput, void> {
  return defineCommand({
    type: 'variable/updateMeta',
    input,
    label: 'Editar a variável',
    scope: { variableId: input.variableId },
    execute(doc) {
      const { variable, index } = locateVariable(doc, input.variableId);
      const name = input.name === undefined ? undefined : assertText(input.name, 'O nome da variável');
      const inverse = updateVariableMeta({
        variableId: variable.id,
        name: variable.name,
        description: previous(variable.description),
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.variables[index]!;
          if (name !== undefined) target.name = name;
          if (input.description !== undefined) {
            if (input.description === null) delete target.description;
            else target.description = assertText(input.description, 'A descrição da variável');
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
// variable/createDraft · variable/discardDraft
// ---------------------------------------------------------------------------

export type CreateVariableDraftInput = { variableId: string };
export type CreateVariableDraftData = { versionId: string; number: number; basedOnNumber: number };

/** Clona a versão PUBLISHED em DRAFT; falha com `DRAFT_ALREADY_EXISTS` se já houver (I11). */
export function createVariableDraft(
  input: CreateVariableDraftInput,
): Command<CreateVariableDraftInput, CreateVariableDraftData> {
  return defineCommand({
    type: 'variable/createDraft',
    input,
    label: 'Criar rascunho da variável',
    scope: { variableId: input.variableId },
    execute(doc, ctx) {
      const { variable, index } = locateVariable(doc, input.variableId);

      const existingDraft = variable.versions.find((version) => version.state === 'DRAFT');
      if (existingDraft !== undefined) {
        throw new DomainError(
          'DRAFT_ALREADY_EXISTS',
          `A variável "${variable.code}" já tem a versão ${existingDraft.number} em rascunho.`,
          { variableId: variable.id, versionId: existingDraft.id },
        );
      }

      const publishedVersion = variable.versions.find((version) => version.state === 'PUBLISHED');
      if (publishedVersion === undefined) {
        throw new DomainError(
          'NO_VERSION_TO_DERIVE',
          `A variável "${variable.code}" não tem versão publicada para derivar um rascunho.`,
          { variableId: variable.id },
        );
      }

      const number = Math.max(...variable.versions.map((version) => version.number)) + 1;
      const versionId = ctx.newId();
      const draft: VariableVersion = {
        id: versionId,
        number,
        state: 'DRAFT',
        createdAt: isoFrom(ctx.now()),
        createdBy: ctx.actor,
        domains: structuredClone(publishedVersion.domains),
      };
      if (publishedVersion.regionalDimension !== undefined) {
        draft.regionalDimension = structuredClone(publishedVersion.regionalDimension);
      }
      if (publishedVersion.boundaryMode !== undefined) {
        draft.boundaryMode = publishedVersion.boundaryMode;
      }

      return {
        document: applyToDocument(doc, [], (draftDoc) => {
          draftDoc.variables[index]!.versions.push(draft);
        }),
        data: { versionId, number, basedOnNumber: publishedVersion.number },
        events: [],
        inverse: discardVariableDraft({ variableId: variable.id, versionId }),
      };
    },
  });
}

export type DiscardVariableDraftInput = { variableId: string; versionId: string };
export type DiscardVariableDraftData = { versionId: string; number: number };

/**
 * Descarta o rascunho: como `VariableVersion` não tem estado `ARCHIVED`, a
 * versão é removida de verdade de `versions` (ao contrário do rascunho de
 * matriz, cujo número fica queimado — docs/05 §1.4).
 */
export function discardVariableDraft(
  input: DiscardVariableDraftInput,
): Command<DiscardVariableDraftInput, DiscardVariableDraftData> {
  return defineCommand({
    type: 'variable/discardDraft',
    input,
    label: 'Descartar rascunho da variável',
    scope: { variableId: input.variableId, versionId: input.versionId },
    execute(doc) {
      const { variable, index, version, versionIndex } = locateVariableVersion(
        doc,
        input.variableId,
        input.versionId,
      );
      assertVariableDraft(version);
      const removed = structuredClone(version);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.variables[index]!.versions.splice(versionIndex, 1);
        }),
        data: { versionId: version.id, number: version.number },
        events: [],
        inverse: restoreVariableVersion({ variableId: variable.id, version: removed, index: versionIndex }),
      };
    },
  });
}

function restoreVariableVersion(
  input: { variableId: string; version: VariableVersion; index: number },
): Command<{ variableId: string; version: VariableVersion; index: number }, void> {
  return defineCommand({
    type: 'variable/_restoreVersion',
    input,
    label: `Refazer a criação da versão ${input.version.number}`,
    scope: { variableId: input.variableId, versionId: input.version.id },
    execute(doc) {
      const { index } = locateVariable(doc, input.variableId);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.variables[index]!.versions.splice(input.index, 0, structuredClone(input.version));
        }),
        data: undefined,
        events: [],
        inverse: discardVariableDraft({ variableId: input.variableId, versionId: input.version.id }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// variable/saveDomains
// ---------------------------------------------------------------------------

export type SaveVariableDomainsInput = {
  variableId: string;
  versionId: string;
  domains: Domain[];
  /** Ausente = variável não usa regional (docs/05 §5.6.1). */
  regionalDimension?: RegionalDimension;
  /** Ausente = `HALF_OPEN` (docs/03 §2). */
  boundaryMode?: BoundaryMode;
};

/** Valor anterior de `regionalDimension`, no formato que o inverso precisa. */
function previousRegionalDimension(version: VariableVersion): RegionalDimension | null {
  return version.regionalDimension === undefined ? null : structuredClone(version.regionalDimension);
}

/** Valor anterior de `boundaryMode`, no formato que o inverso precisa. */
function previousBoundaryMode(version: VariableVersion): BoundaryMode | null {
  return version.boundaryMode === undefined ? null : version.boundaryMode;
}

/** Substitui o conjunto inteiro de domínios (e a dimensão regional); só em DRAFT, senão `VARIABLE_VERSION_IMMUTABLE` (I10). */
export function saveVariableDomains(
  input: SaveVariableDomainsInput,
): Command<SaveVariableDomainsInput, void> {
  return defineCommand({
    type: 'variable/saveDomains',
    input,
    label: 'Salvar domínios',
    scope: { variableId: input.variableId, versionId: input.versionId },
    execute(doc) {
      const { variable, index, version, versionIndex } = locateVariableVersion(
        doc,
        input.variableId,
        input.versionId,
      );
      assertVariableDraft(version);
      assertValidDomains(variable.type, input.domains, input.regionalDimension, input.boundaryMode);

      const previousDomains = structuredClone(version.domains);
      const previousRegional = previousRegionalDimension(version);
      const previousBoundary = previousBoundaryMode(version);
      const nextDomains = structuredClone(input.domains);
      const nextRegional = input.regionalDimension === undefined ? null : structuredClone(input.regionalDimension);
      const nextBoundary = input.boundaryMode ?? null;
      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.variables[index]!.versions[versionIndex]!;
          target.domains = nextDomains;
          if (nextRegional === null) delete target.regionalDimension;
          else target.regionalDimension = nextRegional;
          if (nextBoundary === null) delete target.boundaryMode;
          else target.boundaryMode = nextBoundary;
        }),
        data: undefined,
        events: [],
        // O inverso restaura os domínios (e a dimensão regional/boundaryMode)
        // exatos de antes, sem revalidar: um conjunto anterior pode ter sido
        // salvo antes de outra regra existir, ou pode ser o `[]` inicial de
        // um rascunho recém-criado, e desfazer nunca pode falhar por causa
        // disso.
        inverse: setVariableDomains({
          variableId: variable.id,
          versionId: version.id,
          domains: previousDomains,
          regionalDimension: previousRegional,
          boundaryMode: previousBoundary,
        }),
      };
    },
  });
}

function setVariableDomains(
  input: {
    variableId: string;
    versionId: string;
    domains: Domain[];
    regionalDimension: RegionalDimension | null;
    boundaryMode: BoundaryMode | null;
  },
): Command<
  {
    variableId: string;
    versionId: string;
    domains: Domain[];
    regionalDimension: RegionalDimension | null;
    boundaryMode: BoundaryMode | null;
  },
  void
> {
  return defineCommand({
    type: 'variable/_setDomains',
    input,
    label: 'Restaurar domínios',
    scope: { variableId: input.variableId, versionId: input.versionId },
    execute(doc) {
      const { variable, index, version, versionIndex } = locateVariableVersion(
        doc,
        input.variableId,
        input.versionId,
      );
      assertVariableDraft(version);
      const previousDomains = structuredClone(version.domains);
      const previousRegional = previousRegionalDimension(version);
      const previousBoundary = previousBoundaryMode(version);
      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.variables[index]!.versions[versionIndex]!;
          target.domains = structuredClone(input.domains);
          if (input.regionalDimension === null) delete target.regionalDimension;
          else target.regionalDimension = structuredClone(input.regionalDimension);
          if (input.boundaryMode === null) delete target.boundaryMode;
          else target.boundaryMode = input.boundaryMode;
        }),
        data: undefined,
        events: [],
        inverse: setVariableDomains({
          variableId: variable.id,
          versionId: version.id,
          domains: previousDomains,
          regionalDimension: previousRegional,
          boundaryMode: previousBoundary,
        }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// variable/publish
// ---------------------------------------------------------------------------

export type PublishVariableInput = { variableId: string; versionId: string; notes?: string };
export type PublishVariableData = { versionId: string; supersededVersionId: string | null };

function domainCodesOf(domains: Domain[]): Set<string> {
  return new Set(domains.map((domain) => domain.code));
}

/** Valida e promove; a anterior vira SUPERSEDED. Nunca toca matrizes (docs/05 §5.1). */
export function publishVariable(
  input: PublishVariableInput,
): Command<PublishVariableInput, PublishVariableData> {
  return defineCommand({
    type: 'variable/publish',
    input,
    label: 'Publicar variável',
    scope: { variableId: input.variableId, versionId: input.versionId },
    execute(doc, ctx) {
      const { variable, index, version, versionIndex } = locateVariableVersion(
        doc,
        input.variableId,
        input.versionId,
      );
      assertVariableDraft(version);
      assertValidDomains(variable.type, version.domains, version.regionalDimension, version.boundaryMode);

      const current = variable.versions.find((candidate) => candidate.state === 'PUBLISHED');
      const currentIndex =
        current === undefined ? -1 : variable.versions.findIndex((candidate) => candidate.id === current.id);

      const previousCodes = current === undefined ? new Set<string>() : domainCodesOf(current.domains);
      const nextCodes = domainCodesOf(version.domains);
      const domainsAdded = [...nextCodes].filter((code) => !previousCodes.has(code));
      const domainsRemoved = [...previousCodes].filter((code) => !nextCodes.has(code));

      const now = isoFrom(ctx.now());
      const notes = input.notes?.trim();

      const event = makeEvent(ctx, {
        type: 'VARIABLE_PUBLISHED',
        scope: { variableId: variable.id },
        summary: `${ctx.actor} publicou a versão ${version.number} de "${variable.code}".`,
        payload: {
          code: variable.code,
          versionNumber: version.number,
          domainsAdded,
          domainsRemoved,
        },
      });
      const events = [event];

      return {
        document: applyToDocument(doc, events, (draft) => {
          const versions = draft.variables[index]!.versions;
          if (currentIndex >= 0) versions[currentIndex]!.state = 'SUPERSEDED';
          const published = versions[versionIndex]!;
          published.state = 'PUBLISHED';
          published.publishedAt = now;
          published.publishedBy = ctx.actor;
          if (notes !== undefined && notes.length > 0) published.notes = notes;
        }),
        data: {
          versionId: version.id,
          supersededVersionId: current === undefined ? null : current.id,
        },
        events,
        inverse: irreversible(
          'Publicar uma versão de variável não pode ser desfeito. Para voltar atrás, crie um rascunho a partir da versão anterior e publique-o.',
        ),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// variable/archive
// ---------------------------------------------------------------------------

export type ArchiveVariableInput = { variableId: string };

/** Falha se a variável estiver pinada por alguma versão **publicada** de matriz. */
export function archiveVariable(input: ArchiveVariableInput): Command<ArchiveVariableInput, void> {
  return defineCommand({
    type: 'variable/archive',
    input,
    label: 'Arquivar a variável',
    scope: { variableId: input.variableId },
    execute(doc, ctx) {
      const { variable, index } = locateVariable(doc, input.variableId);

      const pinnedByPublished = getVariableUsage(doc, variable.id).some(
        (entry) => entry.versionState === 'PUBLISHED',
      );
      if (pinnedByPublished) {
        throw new DomainError(
          'INVALID_INPUT',
          `A variável "${variable.code}" está em uso por uma versão publicada de matriz e não pode ser arquivada.`,
          { variableId: variable.id },
        );
      }

      const archivedAt = isoFrom(ctx.now());
      const inverse = setVariableArchived({
        variableId: variable.id,
        archivedAt: previous(variable.archivedAt),
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.variables[index]!.archivedAt = archivedAt;
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}

function setVariableArchived(
  input: { variableId: string; archivedAt: string | null },
): Command<{ variableId: string; archivedAt: string | null }, void> {
  return defineCommand({
    type: 'variable/_setArchived',
    input,
    label: input.archivedAt === null ? 'Desarquivar a variável' : 'Arquivar a variável',
    scope: { variableId: input.variableId },
    execute(doc) {
      const { variable, index } = locateVariable(doc, input.variableId);
      const inverse = setVariableArchived({
        variableId: variable.id,
        archivedAt: previous(variable.archivedAt),
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.variables[index]!;
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

// ---------------------------------------------------------------------------
// variable/duplicate
// ---------------------------------------------------------------------------

export type DuplicateVariableInput = {
  sourceVariableId: string;
  sourceVersionId: string;
  code: string;
  name: string;
  description?: string;
};
export type DuplicateVariableData = { variableId: string; versionId: string };

/**
 * "Criar a partir de existente" — docs/05-regras-de-negocio.md §5.6.3. Cria
 * uma `Variable` nova (novo id, novo code) com o mesmo `type` da origem e uma
 * v1 `DRAFT` cujos `domains` e `regionalDimension` são cópia integral da
 * versão de origem. A origem não é tocada, e nada liga as duas depois — é
 * ponto de partida, não vínculo. Sem evento próprio, mesmo padrão de
 * `variable/create`.
 */
export function duplicateVariable(
  input: DuplicateVariableInput,
): Command<DuplicateVariableInput, DuplicateVariableData> {
  return defineCommand({
    type: 'variable/duplicate',
    input,
    label: `Criar "${input.code}" a partir de variável existente`,
    execute(doc, ctx) {
      const { variable: source } = locateVariable(doc, input.sourceVariableId);
      const sourceVersion = source.versions.find((candidate) => candidate.id === input.sourceVersionId);
      if (sourceVersion === undefined) {
        throw new DomainError(
          'NOT_FOUND',
          'A versão de origem informada não pertence a essa variável.',
          { variableId: source.id, versionId: input.sourceVersionId },
        );
      }

      assertCode(input.code);
      const name = assertText(input.name, 'O nome da variável');
      if (doc.variables.some((candidate) => candidate.code === input.code)) {
        throw new DomainError(
          'DUPLICATE_CODE',
          `Já existe uma variável com o código "${input.code}".`,
          { code: input.code },
        );
      }

      const now = isoFrom(ctx.now());
      const variableId = ctx.newId();
      const versionId = ctx.newId();
      const version: VariableVersion = {
        id: versionId,
        number: 1,
        state: 'DRAFT',
        createdAt: now,
        createdBy: ctx.actor,
        domains: structuredClone(sourceVersion.domains),
      };
      if (sourceVersion.regionalDimension !== undefined) {
        version.regionalDimension = structuredClone(sourceVersion.regionalDimension);
      }
      if (sourceVersion.boundaryMode !== undefined) {
        version.boundaryMode = sourceVersion.boundaryMode;
      }
      const variable: Variable = {
        id: variableId,
        code: input.code,
        name,
        type: source.type,
        createdAt: now,
        versions: [version],
      };
      if (input.description !== undefined) {
        variable.description = assertText(input.description, 'A descrição da variável');
      }

      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.variables.push(variable);
        }),
        data: { variableId, versionId },
        events: [],
        inverse: removeCreatedVariable({ variableId, code: input.code }),
      };
    },
  });
}
