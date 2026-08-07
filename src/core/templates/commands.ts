import { applyToDocument, defineCommand, isoFrom, type Command } from '../command';
import { CODE_REGEX, TemplateSchema } from '../document/schema';
import type { PolicyOpsDocument, SeedRule, Template } from '../document/schema';
import { DomainError } from '../errors';
import { MAX_AXIS_LEVELS } from '../axes/tuples';

/**
 * `template/create`, `template/update`, `template/archive` —
 * docs/05-regras-de-negocio.md §8, docs/03-modelo-do-documento.md §7.
 *
 * Mesmo contrato de `src/core/command.ts`: puro, imutável, inversível, valida
 * antes de tocar. `DocEventType` não tem tipo dedicado a templates (docs/03
 * §8 é fechado), então estes comandos gravam `events: []` — mesma nota de
 * `variable/create` e `catalog/create` em `src/core/command.ts`.
 *
 * A validação de eixo aqui é estrutural (1–3 níveis, variável existente, sem
 * repetição no mesmo eixo nem nos dois eixos): um template não pina versão
 * nem resolve domínios — isso só acontece na instanciação (§8), contra a
 * versão publicada **atual** da variável.
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

/** Valor anterior de um campo opcional, no formato que o inverso precisa. */
function previous(value: string | undefined): string | null {
  return value === undefined ? null : value;
}

function assertTemplateAxisLevels(
  doc: PolicyOpsDocument,
  levels: Array<{ variableId: string; label?: string }>,
  axisLabel: string,
): void {
  if (levels.length === 0) {
    throw new DomainError('AXIS_NEEDS_ONE_LEVEL', `O eixo ${axisLabel} do template precisa de pelo menos um nível.`);
  }
  if (levels.length > MAX_AXIS_LEVELS) {
    throw new DomainError(
      'TOO_MANY_LEVELS',
      `Um eixo pode ter no máximo ${MAX_AXIS_LEVELS} níveis; foram informados ${levels.length}.`,
      { levels: levels.length },
    );
  }
  const seen = new Set<string>();
  for (const level of levels) {
    const variable = doc.variables.find((candidate) => candidate.id === level.variableId);
    if (variable === undefined) {
      throw new DomainError(
        'NOT_FOUND',
        'A variável informada para o template não existe neste documento.',
        { variableId: level.variableId },
      );
    }
    if (seen.has(level.variableId)) {
      throw new DomainError(
        'DUPLICATE_VARIABLE_IN_AXIS',
        'A mesma variável não pode ocupar dois níveis do mesmo eixo.',
        { variableId: level.variableId },
      );
    }
    seen.add(level.variableId);
  }
}

function assertTemplateAxesValid(doc: PolicyOpsDocument, axes: Template['axes']): void {
  assertTemplateAxisLevels(doc, axes.x.levels, 'X');
  assertTemplateAxisLevels(doc, axes.y.levels, 'Y');
  const onX = new Set(axes.x.levels.map((level) => level.variableId));
  for (const level of axes.y.levels) {
    if (onX.has(level.variableId)) {
      throw new DomainError(
        'VARIABLE_ON_BOTH_AXES',
        'A mesma variável não pode aparecer nos dois eixos do template.',
        { variableId: level.variableId },
      );
    }
  }
}

/** Valida com Zod na escrita (docs/prompts/S17, Parte A) — na leitura, `PolicyOpsDocumentSchema` já cobre. */
function assertValidTemplateShape(template: Template): void {
  const result = TemplateSchema.safeParse(template);
  if (!result.success) {
    const [first] = result.error.issues;
    throw new DomainError('INVALID_INPUT', first?.message ?? 'Template inválido.', {
      issues: result.error.issues,
    });
  }
}

function locateTemplate(doc: PolicyOpsDocument, templateId: string): { template: Template; index: number } {
  const index = doc.templates.findIndex((candidate) => candidate.id === templateId);
  if (index < 0) {
    throw new DomainError('NOT_FOUND', 'O template informado não existe neste documento.', { templateId });
  }
  return { template: doc.templates[index]!, index };
}

// ---------------------------------------------------------------------------
// template/create
// ---------------------------------------------------------------------------

export type CreateTemplateInput = {
  code: string;
  name: string;
  description?: string;
  axes: Template['axes'];
  defaults?: Template['defaults'];
  seedRules?: SeedRule[];
};
export type CreateTemplateData = { templateId: string };

export function createTemplate(input: CreateTemplateInput): Command<CreateTemplateInput, CreateTemplateData> {
  return defineCommand({
    type: 'template/create',
    input,
    label: `Criar o template "${input.code}"`,
    execute(doc, ctx) {
      assertCode(input.code);
      const name = assertText(input.name, 'O nome do template');
      if (doc.templates.some((candidate) => candidate.code === input.code)) {
        throw new DomainError('DUPLICATE_CODE', `Já existe um template com o código "${input.code}".`, {
          code: input.code,
        });
      }
      assertTemplateAxesValid(doc, input.axes);

      const now = isoFrom(ctx.now());
      const templateId = ctx.newId();
      const template: Template = {
        id: templateId,
        code: input.code,
        name,
        axes: input.axes,
        seedRules: input.seedRules ?? [],
        createdAt: now,
      };
      if (input.description !== undefined) {
        template.description = assertText(input.description, 'A descrição do template');
      }
      if (input.defaults !== undefined) template.defaults = input.defaults;
      assertValidTemplateShape(template);

      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.templates.push(template);
        }),
        data: { templateId },
        events: [],
        inverse: removeCreatedTemplate({ templateId, code: input.code }),
      };
    },
  });
}

function removeCreatedTemplate(
  input: { templateId: string; code: string },
): Command<{ templateId: string; code: string }, void> {
  return defineCommand({
    type: 'template/_removeCreated',
    input,
    label: `Desfazer a criação do template "${input.code}"`,
    execute(doc) {
      const { template, index } = locateTemplate(doc, input.templateId);
      const removed = structuredClone(template);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.templates.splice(index, 1);
        }),
        data: undefined,
        events: [],
        inverse: restoreTemplate({ template: removed, index }),
      };
    },
  });
}

function restoreTemplate(
  input: { template: Template; index: number },
): Command<{ template: Template; index: number }, void> {
  return defineCommand({
    type: 'template/_restore',
    input,
    label: `Refazer a criação do template "${input.template.code}"`,
    execute(doc) {
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.templates.splice(input.index, 0, structuredClone(input.template));
        }),
        data: undefined,
        events: [],
        inverse: removeCreatedTemplate({ templateId: input.template.id, code: input.template.code }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// template/update
// ---------------------------------------------------------------------------

export type UpdateTemplateInput = {
  templateId: string;
  name?: string;
  description?: string | null;
  axes?: Template['axes'];
  defaults?: Template['defaults'] | null;
  seedRules?: SeedRule[];
};

export function updateTemplate(input: UpdateTemplateInput): Command<UpdateTemplateInput, void> {
  return defineCommand({
    type: 'template/update',
    input,
    label: 'Editar o template',
    execute(doc) {
      const { template: current, index } = locateTemplate(doc, input.templateId);
      if (input.axes !== undefined) assertTemplateAxesValid(doc, input.axes);
      const name = input.name === undefined ? undefined : assertText(input.name, 'O nome do template');

      const inverse = updateTemplate({
        templateId: current.id,
        name: current.name,
        description: previous(current.description),
        axes: current.axes,
        defaults: current.defaults ?? null,
        seedRules: current.seedRules,
      });

      const next: Template = structuredClone(current);
      if (name !== undefined) next.name = name;
      if (input.description !== undefined) {
        if (input.description === null) delete next.description;
        else next.description = assertText(input.description, 'A descrição do template');
      }
      if (input.axes !== undefined) next.axes = input.axes;
      if (input.defaults !== undefined) {
        if (input.defaults === null) delete next.defaults;
        else next.defaults = input.defaults;
      }
      if (input.seedRules !== undefined) next.seedRules = input.seedRules;
      assertValidTemplateShape(next);

      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.templates[index] = next;
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// template/archive
// ---------------------------------------------------------------------------

export type ArchiveTemplateInput = { templateId: string };

export function archiveTemplate(input: ArchiveTemplateInput): Command<ArchiveTemplateInput, void> {
  return defineCommand({
    type: 'template/archive',
    input,
    label: 'Arquivar o template',
    execute(doc, ctx) {
      const { template, index } = locateTemplate(doc, input.templateId);
      if (template.archivedAt !== undefined) {
        throw new DomainError('INVALID_INPUT', `O template "${template.code}" já está arquivado.`, {
          templateId: input.templateId,
        });
      }
      const archivedAt = isoFrom(ctx.now());
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.templates[index]!.archivedAt = archivedAt;
        }),
        data: undefined,
        events: [],
        inverse: unarchiveTemplate({ templateId: template.id }),
      };
    },
  });
}

function unarchiveTemplate(input: { templateId: string }): Command<{ templateId: string }, void> {
  return defineCommand({
    type: 'template/_unarchive',
    input,
    label: 'Restaurar o template',
    execute(doc) {
      const { template, index } = locateTemplate(doc, input.templateId);
      if (template.archivedAt === undefined) {
        throw new DomainError('INVALID_INPUT', `O template "${template.code}" não está arquivado.`, {
          templateId: input.templateId,
        });
      }
      return {
        document: applyToDocument(doc, [], (draft) => {
          delete draft.templates[index]!.archivedAt;
        }),
        data: undefined,
        events: [],
        inverse: archiveTemplate({ templateId: template.id }),
      };
    },
  });
}
