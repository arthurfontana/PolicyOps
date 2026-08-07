import { nanoid } from 'nanoid';
import { collectPublishedCompatibility, generateTuples } from '../axes/tuples';
import type { Axis, AxisLevel, AxisRole, Cell, PolicyOpsDocument, Template } from '../document/schema';
import { DomainError } from '../errors';
import { buildSeedCells, type SkippedSeedRule } from './seed';

/**
 * `previewTemplate` — docs/prompts/S17-templates-merge-export.md Parte A.
 *
 * Resolve os eixos do template contra as versões **publicadas atuais** das
 * variáveis (o mesmo pin que `instantiateTemplate` vai usar — §8) e aplica
 * `defaults`/`seedRules` exatamente como `matrix/create` faria. Não usa
 * `matrix/create` porque não há matriz nem `Ctx` aqui: é leitura pura, sem
 * `projectId`/`code`/`actor`, e **não grava nada** — não há `applyToDocument`
 * em lugar nenhum deste arquivo.
 */

function resolveTemplateLevel(
  doc: PolicyOpsDocument,
  ref: { variableId: string; label?: string },
): AxisLevel {
  const variable = doc.variables.find((candidate) => candidate.id === ref.variableId);
  if (variable === undefined) {
    throw new DomainError(
      'NOT_FOUND',
      'A variável referenciada pelo template não existe neste documento.',
      { variableId: ref.variableId },
    );
  }
  const published = variable.versions.find((candidate) => candidate.state === 'PUBLISHED');
  if (published === undefined) {
    throw new DomainError(
      'VARIABLE_HAS_NO_PUBLISHED_VERSION',
      `A variável "${variable.code}" não tem versão publicada — publique uma antes de usar este template.`,
      { variableId: variable.id, code: variable.code },
    );
  }
  return {
    id: nanoid(12),
    variableId: variable.id,
    variableVersionId: published.id,
    label: ref.label ?? variable.name,
    domains: structuredClone(published.domains),
  };
}

function buildTemplateAxis(doc: PolicyOpsDocument, role: AxisRole, levels: AxisLevel[]): Axis {
  const generated = generateTuples({
    levels: levels.map((level) => ({ variableId: level.variableId, domains: level.domains })),
    compatibility: collectPublishedCompatibility(doc.compatibility),
  });
  return { role, levels, tuples: generated.tuples, derivedFrom: { compatibilityVersionIds: generated.usedRuleIds } };
}

/**
 * Os eixos que o template produziria hoje. Reaproveitado por `previewTemplate`
 * e pela interface (editor de template, wizard de criação) para mostrar a
 * mesma estrutura sem precisar instanciar nada.
 */
export function resolveTemplateAxes(doc: PolicyOpsDocument, template: Template): { x: Axis; y: Axis } {
  const xLevels = template.axes.x.levels.map((ref) => resolveTemplateLevel(doc, ref));
  const yLevels = template.axes.y.levels.map((ref) => resolveTemplateLevel(doc, ref));
  return { x: buildTemplateAxis(doc, 'X', xLevels), y: buildTemplateAxis(doc, 'Y', yLevels) };
}

export type TemplatePreview = {
  template: Template;
  x: Axis;
  y: Axis;
  combinations: number;
  cells: Record<string, Cell>;
  filledCount: number;
  pendingCount: number;
  skippedRules: SkippedSeedRule[];
};

function locateTemplate(doc: PolicyOpsDocument, templateId: string): Template {
  const template = doc.templates.find((candidate) => candidate.id === templateId);
  if (template === undefined) {
    throw new DomainError('NOT_FOUND', 'O template informado não existe neste documento.', { templateId });
  }
  return template;
}

/**
 * O grid que `instantiateTemplate` produziria agora, sem gravar nada. O
 * critério de aceite é que este resultado bata exatamente com a instanciação
 * real — os dois caminhos usam a mesma resolução de versão publicada e a
 * mesma `buildSeedCells`.
 */
export function previewTemplate(doc: PolicyOpsDocument, templateId: string): TemplatePreview {
  const template = locateTemplate(doc, templateId);
  const { x, y } = resolveTemplateAxes(doc, template);
  const { cells, skippedRules } = buildSeedCells({
    xTuples: x.tuples,
    yTuples: y.tuples,
    defaults: template.defaults,
    seedRules: template.seedRules,
    catalog: doc.catalog,
  });
  const combinations = x.tuples.length * y.tuples.length;
  const filledCount = Object.values(cells).filter((cell) => cell.decision !== undefined).length;
  return {
    template,
    x,
    y,
    combinations,
    cells,
    filledCount,
    pendingCount: combinations - filledCount,
    skippedRules,
  };
}
