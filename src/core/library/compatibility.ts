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
  CompatibilityRule,
  CompatibilityVersion,
  DefaultForUnlisted,
  PolicyOpsDocument,
  Variable,
} from '../document/schema';
import { DomainError } from '../errors';

/**
 * Comandos da Biblioteca de Compatibilidade — docs/08-camada-de-comandos.md §3
 * e docs/05-regras-de-negocio.md §5.1.
 *
 * Mesmo contrato de `src/core/library/variables.ts`: puro, imutável,
 * inversível, valida antes de tocar, registra evento. A geração de tuplas em
 * si (`generateTuples`, `src/core/axes/tuples.ts`) já existe desde a S03 e
 * não é reimplementada aqui — esta camada só cadastra e versiona o mapa que
 * aquele motor consome.
 *
 * `CompatibilityVersion.state` não tem `ARCHIVED` (docs/03 §3), igual a
 * `VariableVersion`: um rascunho descartado é removido de `versions` de
 * verdade, e o `number` pode ser reaproveitado pelo próximo rascunho.
 */

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

function assertDefaultForUnlisted(value: string): asserts value is DefaultForUnlisted {
  if (value !== 'ALL' && value !== 'NONE') {
    throw new DomainError(
      'INVALID_INPUT',
      `"${value}" não é um valor válido para "quando o pai não está no mapa" — use ALL ou NONE.`,
      { value },
    );
  }
}

function assertAllowShape(allow: Record<string, string[]>): void {
  for (const [parentCode, childCodes] of Object.entries(allow)) {
    if (!Array.isArray(childCodes) || childCodes.some((code) => typeof code !== 'string')) {
      throw new DomainError(
        'INVALID_INPUT',
        `A lista de códigos permitidos para "${parentCode}" precisa ser uma lista de textos.`,
        { parentCode },
      );
    }
  }
}

/** Valor anterior de um campo opcional, no formato que o inverso precisa. */
function previous(value: string | undefined): string | null {
  return value === undefined ? null : value;
}

function locateRule(
  doc: PolicyOpsDocument,
  ruleId: string,
): { rule: CompatibilityRule; index: number } {
  const index = doc.compatibility.findIndex((candidate) => candidate.id === ruleId);
  if (index < 0) {
    throw new DomainError(
      'NOT_FOUND',
      'A regra de compatibilidade informada não existe neste documento.',
      { ruleId },
    );
  }
  return { rule: doc.compatibility[index]!, index };
}

function locateRuleVersion(
  doc: PolicyOpsDocument,
  ruleId: string,
  versionId: string,
): {
  rule: CompatibilityRule;
  index: number;
  version: CompatibilityVersion;
  versionIndex: number;
} {
  const { rule, index } = locateRule(doc, ruleId);
  const versionIndex = rule.versions.findIndex((candidate) => candidate.id === versionId);
  if (versionIndex < 0) {
    throw new DomainError(
      'NOT_FOUND',
      'A versão informada não pertence a esta regra de compatibilidade.',
      { ruleId, versionId },
    );
  }
  return { rule, index, version: rule.versions[versionIndex]!, versionIndex };
}

/** I10: uma `CompatibilityVersion` fora de DRAFT é imutável. */
function assertCompatibilityDraft(version: CompatibilityVersion): void {
  if (version.state !== 'DRAFT') {
    throw new DomainError(
      'COMPATIBILITY_VERSION_IMMUTABLE',
      `A versão ${version.number} já foi publicada e não pode mais ser alterada.`,
      { versionId: version.id, state: version.state },
    );
  }
}

function locateVariable(doc: PolicyOpsDocument, variableId: string): Variable {
  const variable = doc.variables.find((candidate) => candidate.id === variableId);
  if (variable === undefined) {
    throw new DomainError('NOT_FOUND', 'A variável informada não existe neste documento.', {
      variableId,
    });
  }
  return variable;
}

function requirePublishedVersion(variable: Variable): CompatibilityVersionSourcePin {
  const published = variable.versions.find((candidate) => candidate.state === 'PUBLISHED');
  if (published === undefined) {
    throw new DomainError(
      'VARIABLE_HAS_NO_PUBLISHED_VERSION',
      `A variável "${variable.code}" não tem versão publicada — publique uma versão antes de usá-la numa regra de compatibilidade.`,
      { variableId: variable.id },
    );
  }
  return { variableVersionId: published.id };
}

type CompatibilityVersionSourcePin = { variableVersionId: string };

/**
 * I12 (nesta ordem, `parentVariableId` → `childVariableId`): a interface
 * bloqueia o par já na criação da regra, apontando para a regra existente —
 * não há razão para deixar o usuário chegar ao fim do fluxo de edição para só
 * então descobrir o conflito.
 */
function assertPairNotDuplicated(
  doc: PolicyOpsDocument,
  parentVariableId: string,
  childVariableId: string,
  excludeRuleId?: string,
): void {
  const existing = doc.compatibility.find(
    (candidate) =>
      candidate.id !== excludeRuleId &&
      candidate.archivedAt === undefined &&
      candidate.parentVariableId === parentVariableId &&
      candidate.childVariableId === childVariableId,
  );
  if (existing !== undefined) {
    throw new DomainError(
      'COMPATIBILITY_PAIR_DUPLICATE',
      `Já existe a regra "${existing.code}" — "${existing.name}" — para este par de variáveis.`,
      { existingRuleId: existing.id, existingRuleCode: existing.code },
    );
  }
}

/**
 * I12 na publicação: nenhuma outra regra (mesmo arquivada — o estado
 * `PUBLISHED` de uma versão sobrevive ao arquivamento da regra, igual
 * `checkI12` em `src/core/document/validate.ts` verifica) pode ter versão
 * publicada para o mesmo par ordenado.
 */
function assertPairNotPublishedElsewhere(
  doc: PolicyOpsDocument,
  ruleId: string,
  parentVariableId: string,
  childVariableId: string,
): void {
  const conflict = doc.compatibility.find(
    (candidate) =>
      candidate.id !== ruleId &&
      candidate.parentVariableId === parentVariableId &&
      candidate.childVariableId === childVariableId &&
      candidate.versions.some((version) => version.state === 'PUBLISHED'),
  );
  if (conflict !== undefined) {
    throw new DomainError(
      'COMPATIBILITY_PAIR_DUPLICATE',
      `A regra "${conflict.code}" já tem uma versão publicada para este par de variáveis.`,
      { existingRuleId: conflict.id, existingRuleCode: conflict.code },
    );
  }
}

// ---------------------------------------------------------------------------
// compat/create
// ---------------------------------------------------------------------------
// #region: compat-create

export type CreateCompatibilityInput = {
  code: string;
  name: string;
  parentVariableId: string;
  childVariableId: string;
  description?: string;
};
export type CreateCompatibilityData = { ruleId: string; versionId: string };

/**
 * Cria a regra com a v1 em DRAFT, mapa vazio (`allow: {}`,
 * `defaultForUnlisted: 'ALL'`) e as versões de variável **atualmente**
 * publicadas como pino inicial — `compat/saveMap` repina a cada salvamento
 * (rastreabilidade, docs/03 §3).
 */
export function createCompatibility(
  input: CreateCompatibilityInput,
): Command<CreateCompatibilityInput, CreateCompatibilityData> {
  return defineCommand({
    type: 'compat/create',
    input,
    label: `Criar a regra "${input.code}"`,
    execute(doc, ctx) {
      assertCode(input.code);
      const name = assertText(input.name, 'O nome da regra');

      if (input.parentVariableId === input.childVariableId) {
        throw new DomainError(
          'INVALID_INPUT',
          'A variável pai e a variável filho precisam ser distintas.',
          { variableId: input.parentVariableId },
        );
      }
      if (doc.compatibility.some((candidate) => candidate.code === input.code)) {
        throw new DomainError(
          'DUPLICATE_CODE',
          `Já existe uma regra de compatibilidade com o código "${input.code}".`,
          { code: input.code },
        );
      }

      const parent = locateVariable(doc, input.parentVariableId);
      const child = locateVariable(doc, input.childVariableId);
      const parentPin = requirePublishedVersion(parent);
      const childPin = requirePublishedVersion(child);
      assertPairNotDuplicated(doc, input.parentVariableId, input.childVariableId);

      const now = isoFrom(ctx.now());
      const ruleId = ctx.newId();
      const versionId = ctx.newId();
      const version: CompatibilityVersion = {
        id: versionId,
        number: 1,
        state: 'DRAFT',
        createdAt: now,
        createdBy: ctx.actor,
        parentVariableVersionId: parentPin.variableVersionId,
        childVariableVersionId: childPin.variableVersionId,
        allow: {},
        defaultForUnlisted: 'ALL',
      };
      const rule: CompatibilityRule = {
        id: ruleId,
        code: input.code,
        name,
        parentVariableId: input.parentVariableId,
        childVariableId: input.childVariableId,
        createdAt: now,
        versions: [version],
      };
      if (input.description !== undefined) {
        rule.description = assertText(input.description, 'A descrição da regra');
      }

      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.compatibility.push(rule);
        }),
        data: { ruleId, versionId },
        events: [],
        inverse: removeCreatedRule({ ruleId, code: input.code }),
      };
    },
  });
}

/** Inverso de `compat/create`: só remove uma regra ainda intocada (v1 DRAFT, única). */
function removeCreatedRule(
  input: { ruleId: string; code: string },
): Command<{ ruleId: string; code: string }, void> {
  return defineCommand({
    type: 'compat/_removeCreated',
    input,
    label: `Desfazer a criação da regra "${input.code}"`,
    scope: { compatibilityId: input.ruleId },
    execute(doc) {
      const { rule, index } = locateRule(doc, input.ruleId);
      if (rule.versions.length !== 1 || rule.versions[0]!.state !== 'DRAFT') {
        throw new DomainError(
          'COMPATIBILITY_VERSION_IMMUTABLE',
          `A regra "${rule.code}" já tem histórico e não pode ser removida por um desfazer.`,
          { ruleId: rule.id },
        );
      }
      const removed = structuredClone(rule);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.compatibility.splice(index, 1);
        }),
        data: undefined,
        events: [],
        inverse: restoreRule({ rule: removed, index }),
      };
    },
  });
}

function restoreRule(
  input: { rule: CompatibilityRule; index: number },
): Command<{ rule: CompatibilityRule; index: number }, void> {
  return defineCommand({
    type: 'compat/_restore',
    input,
    label: `Refazer a criação da regra "${input.rule.code}"`,
    scope: { compatibilityId: input.rule.id },
    execute(doc) {
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.compatibility.splice(input.index, 0, structuredClone(input.rule));
        }),
        data: undefined,
        events: [],
        inverse: removeCreatedRule({ ruleId: input.rule.id, code: input.rule.code }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// compat/createDraft · compat/discardDraft
// ---------------------------------------------------------------------------
// #region: compat-create-draft-compat-discard-draft

export type CreateCompatibilityDraftInput = { ruleId: string };
export type CreateCompatibilityDraftData = { versionId: string; number: number; basedOnNumber: number };

/** Clona a versão PUBLISHED em DRAFT; falha com `DRAFT_ALREADY_EXISTS` se já houver (I11). */
export function createCompatibilityDraft(
  input: CreateCompatibilityDraftInput,
): Command<CreateCompatibilityDraftInput, CreateCompatibilityDraftData> {
  return defineCommand({
    type: 'compat/createDraft',
    input,
    label: 'Criar rascunho da regra',
    scope: { compatibilityId: input.ruleId },
    execute(doc, ctx) {
      const { rule, index } = locateRule(doc, input.ruleId);

      const existingDraft = rule.versions.find((version) => version.state === 'DRAFT');
      if (existingDraft !== undefined) {
        throw new DomainError(
          'DRAFT_ALREADY_EXISTS',
          `A regra "${rule.code}" já tem a versão ${existingDraft.number} em rascunho.`,
          { ruleId: rule.id, versionId: existingDraft.id },
        );
      }

      const publishedVersion = rule.versions.find((version) => version.state === 'PUBLISHED');
      if (publishedVersion === undefined) {
        throw new DomainError(
          'NO_VERSION_TO_DERIVE',
          `A regra "${rule.code}" não tem versão publicada para derivar um rascunho.`,
          { ruleId: rule.id },
        );
      }

      const number = Math.max(...rule.versions.map((version) => version.number)) + 1;
      const versionId = ctx.newId();
      const draft: CompatibilityVersion = {
        id: versionId,
        number,
        state: 'DRAFT',
        createdAt: isoFrom(ctx.now()),
        createdBy: ctx.actor,
        parentVariableVersionId: publishedVersion.parentVariableVersionId,
        childVariableVersionId: publishedVersion.childVariableVersionId,
        allow: structuredClone(publishedVersion.allow),
        defaultForUnlisted: publishedVersion.defaultForUnlisted,
      };

      return {
        document: applyToDocument(doc, [], (draftDoc) => {
          draftDoc.compatibility[index]!.versions.push(draft);
        }),
        data: { versionId, number, basedOnNumber: publishedVersion.number },
        events: [],
        inverse: discardCompatibilityDraft({ ruleId: rule.id, versionId }),
      };
    },
  });
}

export type DiscardCompatibilityDraftInput = { ruleId: string; versionId: string };
export type DiscardCompatibilityDraftData = { versionId: string; number: number };

/**
 * Descarta o rascunho: como `CompatibilityVersion` não tem estado
 * `ARCHIVED`, a versão é removida de verdade de `versions` (ao contrário do
 * rascunho de matriz, cujo número fica queimado — docs/05 §1.4).
 */
export function discardCompatibilityDraft(
  input: DiscardCompatibilityDraftInput,
): Command<DiscardCompatibilityDraftInput, DiscardCompatibilityDraftData> {
  return defineCommand({
    type: 'compat/discardDraft',
    input,
    label: 'Descartar rascunho da regra',
    scope: { compatibilityId: input.ruleId, versionId: input.versionId },
    execute(doc) {
      const { rule, index, version, versionIndex } = locateRuleVersion(
        doc,
        input.ruleId,
        input.versionId,
      );
      assertCompatibilityDraft(version);
      const removed = structuredClone(version);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.compatibility[index]!.versions.splice(versionIndex, 1);
        }),
        data: { versionId: version.id, number: version.number },
        events: [],
        inverse: restoreRuleVersion({ ruleId: rule.id, version: removed, index: versionIndex }),
      };
    },
  });
}

function restoreRuleVersion(
  input: { ruleId: string; version: CompatibilityVersion; index: number },
): Command<{ ruleId: string; version: CompatibilityVersion; index: number }, void> {
  return defineCommand({
    type: 'compat/_restoreVersion',
    input,
    label: `Refazer a criação da versão ${input.version.number}`,
    scope: { compatibilityId: input.ruleId, versionId: input.version.id },
    execute(doc) {
      const { index } = locateRule(doc, input.ruleId);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.compatibility[index]!.versions.splice(input.index, 0, structuredClone(input.version));
        }),
        data: undefined,
        events: [],
        inverse: discardCompatibilityDraft({ ruleId: input.ruleId, versionId: input.version.id }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// compat/saveMap
// ---------------------------------------------------------------------------
// #region: compat-save-map

export type SaveCompatibilityMapInput = {
  ruleId: string;
  versionId: string;
  allow: Record<string, string[]>;
  defaultForUnlisted: DefaultForUnlisted;
};

/**
 * Substitui o mapa inteiro; só em DRAFT, senão `COMPATIBILITY_VERSION_IMMUTABLE`
 * (I10). Repina `parentVariableVersionId`/`childVariableVersionId` para as
 * versões **atualmente publicadas** — são as versões usadas para escrever o
 * mapa, para rastreabilidade (docs/03 §3). Códigos de domínio desconhecidos
 * não são validados aqui: viram aviso na interface (`generateTuples`,
 * `RULE_REFERENCES_UNKNOWN_DOMAIN`), nunca erro — a variável pode ter evoluído.
 */
export function saveCompatibilityMap(
  input: SaveCompatibilityMapInput,
): Command<SaveCompatibilityMapInput, void> {
  return defineCommand({
    type: 'compat/saveMap',
    input,
    label: 'Salvar mapa de compatibilidade',
    scope: { compatibilityId: input.ruleId, versionId: input.versionId },
    execute(doc) {
      const { rule, index, version, versionIndex } = locateRuleVersion(
        doc,
        input.ruleId,
        input.versionId,
      );
      assertCompatibilityDraft(version);
      assertDefaultForUnlisted(input.defaultForUnlisted);
      assertAllowShape(input.allow);

      const parent = locateVariable(doc, rule.parentVariableId);
      const child = locateVariable(doc, rule.childVariableId);
      const parentPin = requirePublishedVersion(parent);
      const childPin = requirePublishedVersion(child);

      const previousAllow = structuredClone(version.allow);
      const previousDefault = version.defaultForUnlisted;
      const previousParentPin = version.parentVariableVersionId;
      const previousChildPin = version.childVariableVersionId;
      const nextAllow = structuredClone(input.allow);

      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.compatibility[index]!.versions[versionIndex]!;
          target.allow = nextAllow;
          target.defaultForUnlisted = input.defaultForUnlisted;
          target.parentVariableVersionId = parentPin.variableVersionId;
          target.childVariableVersionId = childPin.variableVersionId;
        }),
        data: undefined,
        events: [],
        // O inverso restaura o mapa e os pinos exatos de antes, sem revalidar
        // publicação atual — mesmo raciocínio de `setVariableDomains`: um
        // desfazer nunca pode falhar por causa de estado que mudou depois.
        inverse: setCompatibilityMap({
          ruleId: rule.id,
          versionId: version.id,
          allow: previousAllow,
          defaultForUnlisted: previousDefault,
          parentVariableVersionId: previousParentPin,
          childVariableVersionId: previousChildPin,
        }),
      };
    },
  });
}

function setCompatibilityMap(
  input: {
    ruleId: string;
    versionId: string;
    allow: Record<string, string[]>;
    defaultForUnlisted: DefaultForUnlisted;
    parentVariableVersionId: string;
    childVariableVersionId: string;
  },
): Command<typeof input, void> {
  return defineCommand({
    type: 'compat/_setMap',
    input,
    label: 'Restaurar mapa de compatibilidade',
    scope: { compatibilityId: input.ruleId, versionId: input.versionId },
    execute(doc) {
      const { rule, index, version, versionIndex } = locateRuleVersion(
        doc,
        input.ruleId,
        input.versionId,
      );
      assertCompatibilityDraft(version);
      const previousAllow = structuredClone(version.allow);
      const previousDefault = version.defaultForUnlisted;
      const previousParentPin = version.parentVariableVersionId;
      const previousChildPin = version.childVariableVersionId;
      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.compatibility[index]!.versions[versionIndex]!;
          target.allow = structuredClone(input.allow);
          target.defaultForUnlisted = input.defaultForUnlisted;
          target.parentVariableVersionId = input.parentVariableVersionId;
          target.childVariableVersionId = input.childVariableVersionId;
        }),
        data: undefined,
        events: [],
        inverse: setCompatibilityMap({
          ruleId: rule.id,
          versionId: version.id,
          allow: previousAllow,
          defaultForUnlisted: previousDefault,
          parentVariableVersionId: previousParentPin,
          childVariableVersionId: previousChildPin,
        }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// compat/publish
// ---------------------------------------------------------------------------
// #region: compat-publish

export type PublishCompatibilityInput = { ruleId: string; versionId: string; notes?: string };
export type PublishCompatibilityData = { versionId: string; supersededVersionId: string | null };

/** Valida I12 e promove; a anterior vira SUPERSEDED. Nunca toca matrizes (docs/05 §5.1). */
export function publishCompatibility(
  input: PublishCompatibilityInput,
): Command<PublishCompatibilityInput, PublishCompatibilityData> {
  return defineCommand({
    type: 'compat/publish',
    input,
    label: 'Publicar regra de compatibilidade',
    scope: { compatibilityId: input.ruleId, versionId: input.versionId },
    execute(doc, ctx) {
      const { rule, index, version, versionIndex } = locateRuleVersion(
        doc,
        input.ruleId,
        input.versionId,
      );
      assertCompatibilityDraft(version);
      assertPairNotPublishedElsewhere(doc, rule.id, rule.parentVariableId, rule.childVariableId);

      const current = rule.versions.find((candidate) => candidate.state === 'PUBLISHED');
      const currentIndex =
        current === undefined ? -1 : rule.versions.findIndex((candidate) => candidate.id === current.id);

      const now = isoFrom(ctx.now());
      const notes = input.notes?.trim();

      const event = makeEvent(ctx, {
        type: 'COMPATIBILITY_PUBLISHED',
        scope: { compatibilityId: rule.id },
        summary: `${ctx.actor} publicou a versão ${version.number} de "${rule.code}".`,
        payload: { code: rule.code, versionNumber: version.number },
      });
      const events = [event];

      return {
        document: applyToDocument(doc, events, (draft) => {
          const versions = draft.compatibility[index]!.versions;
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
          'Publicar uma versão de regra de compatibilidade não pode ser desfeito. Para voltar atrás, crie um rascunho a partir da versão anterior e publique-o.',
        ),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// compat/archive
// ---------------------------------------------------------------------------
// #region: compat-archive

export type ArchiveCompatibilityInput = { ruleId: string };

export function archiveCompatibility(
  input: ArchiveCompatibilityInput,
): Command<ArchiveCompatibilityInput, void> {
  return defineCommand({
    type: 'compat/archive',
    input,
    label: 'Arquivar a regra de compatibilidade',
    scope: { compatibilityId: input.ruleId },
    execute(doc, ctx) {
      const { rule, index } = locateRule(doc, input.ruleId);
      const archivedAt = isoFrom(ctx.now());
      const inverse = setCompatibilityArchived({
        ruleId: rule.id,
        archivedAt: previous(rule.archivedAt),
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.compatibility[index]!.archivedAt = archivedAt;
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}

function setCompatibilityArchived(
  input: { ruleId: string; archivedAt: string | null },
): Command<{ ruleId: string; archivedAt: string | null }, void> {
  return defineCommand({
    type: 'compat/_setArchived',
    input,
    label: input.archivedAt === null ? 'Desarquivar a regra' : 'Arquivar a regra',
    scope: { compatibilityId: input.ruleId },
    execute(doc) {
      const { rule, index } = locateRule(doc, input.ruleId);
      const inverse = setCompatibilityArchived({
        ruleId: rule.id,
        archivedAt: previous(rule.archivedAt),
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.compatibility[index]!;
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
