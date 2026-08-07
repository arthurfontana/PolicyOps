import { type Command, defineCommand } from '../command';
import { DomainError } from '../errors';
import { createMatrix, type AxisLevelRef } from '../versioning/lifecycle';
import type { SkippedSeedRule } from './seed';

/**
 * `template/instantiate` — docs/05-regras-de-negocio.md §8.
 *
 * Não duplica a lógica de criação: monta o `CreateMatrixInput` a partir do
 * template e delega inteiramente a `matrix/create` (`createMatrix`), que —
 * desde a extensão feita nesta sessão — já sabe resolver as versões
 * publicadas atuais das variáveis e aplicar `defaults`/`seedRules` quando
 * recebe `templateId`. Este comando só resolve qual template usar e
 * repassa o resultado.
 */

export type InstantiateTemplateInput = {
  templateId: string;
  projectId: string;
  code: string;
  name: string;
  description?: string;
};

export type InstantiateTemplateData = {
  matrixId: string;
  versionId: string;
  combinations: number;
  skippedRules: SkippedSeedRule[];
};

export function instantiateTemplate(
  input: InstantiateTemplateInput,
): Command<InstantiateTemplateInput, InstantiateTemplateData> {
  return defineCommand({
    type: 'template/instantiate',
    input,
    label: `Criar a matriz "${input.code}" a partir de um template`,
    scope: { projectId: input.projectId },
    execute(doc, ctx) {
      const template = doc.templates.find((candidate) => candidate.id === input.templateId);
      if (template === undefined) {
        throw new DomainError('NOT_FOUND', 'O template informado não existe neste documento.', {
          templateId: input.templateId,
        });
      }

      const x: { levels: AxisLevelRef[] } = template.axes.x;
      const y: { levels: AxisLevelRef[] } = template.axes.y;

      const result = createMatrix({
        projectId: input.projectId,
        code: input.code,
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        x,
        y,
        templateId: template.id,
      }).run(doc, ctx);

      if (!result.ok) throw result.error;

      return {
        document: result.document,
        data: {
          matrixId: result.data.matrixId,
          versionId: result.data.versionId,
          combinations: result.data.combinations,
          skippedRules: result.data.skippedRules ?? [],
        },
        events: result.events,
        inverse: result.inverse,
      };
    },
  });
}
