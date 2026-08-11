import { applyToDocument, defineCommand, makeEvent, type Command, type Ctx } from '../command';
import { DomainError } from '../errors';
import { resnapshotAxisCommand } from '../versioning/axis-commands';
import { createDraft as createMatrixDraft } from '../versioning/lifecycle';
import { planImport, type ImportPlan } from './plan';
import type { DocumentWithProfiles, ImportProfile } from './profile';
import type { ImportTable } from './parse-table';
import {
  applyLibrarySteps,
  mergeCompatibilityChanges,
  mergeDomainChanges,
  planStructuralChanges,
  type StructuralPlan,
  type StructuralRun,
} from './structural';

/**
 * `import/applyStructural` — a aplicação da resolução assistida de divergência
 * estrutural (docs/12-carga-de-matrizes.md §5, S25).
 *
 * A ordem, para cada matriz `STRUCTURAL` selecionada, é a normativa do plano
 * (`docs/12` §5, S25): `variable/createDraft` + `saveDomains` + `publish` para
 * cada variável com domínio novo; `compat/createDraft` (ou `compat/create`
 * quando a regra ainda não existe) + `saveMap` + `publish` quando o mapa
 * mudou; `version/createDraft` na matriz; `axis/resnapshot` em cada eixo
 * afetado. Tudo-ou-nada: um erro no meio do lote propaga e nada do lote é
 * gravado (mesmo mecanismo de `import/apply`, §5.4).
 *
 * A carga **nunca publica a matriz** (RN-10): a resolução termina com a
 * matriz em rascunho, pronta para a revisão normal. E nunca remove domínio
 * nem tupla (escopo desta sessão): divergência de subtração — uma faixa que o
 * arquivo deixou de trazer — não é tocada aqui; ela segue `missingRowPolicy`
 * (RN-07) quando a carga normal for aplicada a esta matriz, depois.
 */

export type ApplyStructuralInput = {
  profile: ImportProfile;
  table: ImportTable;
  fileName?: string;
  /** O plano da carga que o usuário revisou (mesma guarda de RN-14/CT-11). */
  planHash: string;
  /** `MatrixPlan.key` das matrizes `STRUCTURAL` escolhidas no painel. */
  selectedKeys: string[];
};

export type ApplyStructuralData = {
  /** `MatrixPlan.key` resolvidas nesta rodada. */
  resolvedKeys: string[];
  /** `Variable.id` que ganharam uma versão nova nesta rodada. */
  updatedVariables: string[];
  /** `CompatibilityRule.id` que ganharam uma versão nova nesta rodada. */
  updatedCompatibilityRules: string[];
  /** `MatrixVersion.id` do rascunho criado em cada matriz resolvida. */
  createdDrafts: string[];
};

type Run = StructuralRun & {
  stampedVariables: Set<string>;
  stampedRules: Set<string>;
  createdDrafts: string[];
};

/**
 * A mudança de biblioteca do lote inteiro, aplicada **uma vez** — ver a nota
 * de `mergeDomainChanges`/`mergeCompatibilityChanges` em `structural.ts`.
 */
function applyBatchLibraryChanges(run: Run, ctx: Ctx, plans: readonly StructuralPlan[]): void {
  const before = new Set(run.doc.variables.flatMap((variable) => variable.versions.map((v) => v.id)));
  const beforeRules = new Set(run.doc.compatibility.flatMap((rule) => rule.versions.map((v) => v.id)));

  applyLibrarySteps(run, ctx, mergeDomainChanges(plans), mergeCompatibilityChanges(plans));

  for (const variable of run.doc.variables) {
    for (const version of variable.versions) {
      if (!before.has(version.id)) run.stampedVariables.add(variable.id);
    }
  }
  for (const rule of run.doc.compatibility) {
    for (const version of rule.versions) {
      if (!beforeRules.has(version.id)) run.stampedRules.add(rule.id);
    }
  }
}

/**
 * O rascunho e o resnapshot de uma matriz — a biblioteca já está pronta
 * (`applyBatchLibraryChanges` rodou antes, uma vez para o lote inteiro), então
 * `axis/resnapshot` encontra a variável/regra já publicada e adota.
 */
function applyOneMatrix(run: Run, ctx: Ctx, structuralPlan: StructuralPlan): void {
  const draftResult = step(
    run,
    ctx,
    createMatrixDraft({ matrixId: structuralPlan.matrixId, baseVersionId: structuralPlan.baseVersionId }),
  );
  run.createdDrafts.push(draftResult.versionId);

  const roles = Object.keys(structuralPlan.resnapshot) as Array<'X' | 'Y'>;
  for (const role of roles) {
    step(run, ctx, resnapshotAxisCommand({ versionId: draftResult.versionId, role }));
  }
}

function step<O>(run: Run, ctx: Ctx, command: Command<unknown, O>): O {
  const result = command.run(run.doc, ctx);
  if (!result.ok) throw result.error;
  run.doc = result.document;
  run.inverses.push(result.inverse);
  return result.data;
}

function selectStructuralPlans(
  plan: ImportPlan,
  structuralPlans: readonly StructuralPlan[],
  selectedKeys: readonly string[],
): StructuralPlan[] {
  const byKey = new Map(structuralPlans.map((entry) => [entry.key, entry]));
  const planByKey = new Map(plan.matrices.map((entry) => [entry.key, entry]));
  const selected: StructuralPlan[] = [];

  for (const key of selectedKeys) {
    const matrixPlan = planByKey.get(key);
    if (matrixPlan === undefined || matrixPlan.status !== 'STRUCTURAL') {
      throw new DomainError(
        'IMPORT_PLAN_STALE',
        `A matriz "${key}" não está mais divergente no plano recalculado — revise o plano antes de aplicar.`,
        { key },
      );
    }
    const structuralPlan = byKey.get(key);
    if (structuralPlan === undefined) {
      throw new DomainError(
        'IMPORT_STRUCTURE_RESOLUTION_INVALID',
        `Não foi possível calcular a resolução de estrutura de "${matrixPlan.code}".`,
        { key },
      );
    }
    selected.push(structuralPlan);
  }

  if (selected.length === 0) {
    throw new DomainError(
      'IMPORT_NOTHING_TO_APPLY',
      'Nenhuma matriz de estrutura divergente foi selecionada.',
      { selected: selectedKeys.length },
    );
  }
  return selected;
}

export function applyStructural(
  input: ApplyStructuralInput,
): Command<ApplyStructuralInput, ApplyStructuralData> {
  return defineCommand({
    type: 'import/applyStructural',
    input,
    label: 'Resolver estrutura divergente',
    execute(doc, ctx) {
      // A mesma guarda de RN-14/CT-11: o plano é recalculado sobre o
      // documento corrente antes de qualquer escrita.
      const plan = planImport(doc as DocumentWithProfiles, input.table, input.profile, {
        ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
      });
      if (plan.planHash !== input.planHash) {
        throw new DomainError(
          'IMPORT_PLAN_STALE',
          'O documento mudou depois que o plano foi calculado — revise o plano recalculado antes de resolver a estrutura.',
          { expected: input.planHash, actual: plan.planHash },
        );
      }

      const structuralPlans = planStructuralChanges(doc, plan);
      const selected = selectStructuralPlans(plan, structuralPlans, input.selectedKeys);

      const run: Run = {
        doc,
        inverses: [],
        stampedVariables: new Set(),
        stampedRules: new Set(),
        createdDrafts: [],
      };

      applyBatchLibraryChanges(run, ctx, selected);
      for (const structuralPlan of selected) {
        applyOneMatrix(run, ctx, structuralPlan);
      }

      const summary = makeEvent(ctx, {
        type: 'IMPORT_RUN',
        scope: { projectId: input.profile.projectId },
        summary:
          `${ctx.actor} resolveu a estrutura divergente de ${plural(selected.length)} a partir de ` +
          `"${plan.source.fileName ?? 'a tabela colada'}": ` +
          `${run.stampedVariables.size} variável(is) e ${run.stampedRules.size} regra(s) de compatibilidade ganharam versão nova.`,
        payload: {
          kind: 'STRUCTURAL_RESOLUTION',
          profileCode: plan.profileCode,
          resolvedKeys: selected.map((entry) => entry.key),
          updatedVariables: [...run.stampedVariables],
          updatedCompatibilityRules: [...run.stampedRules],
        },
      });

      const document = applyToDocument(run.doc, [summary], () => {});

      return {
        document,
        data: {
          resolvedKeys: selected.map((entry) => entry.key),
          updatedVariables: [...run.stampedVariables],
          updatedCompatibilityRules: [...run.stampedRules],
          createdDrafts: run.createdDrafts,
        },
        events: [summary],
        inverse: undoStructural({ inverses: run.inverses, count: selected.length }),
      };
    },
  });
}

function plural(count: number): string {
  return count === 1 ? '1 matriz' : `${count} matrizes`;
}

type UndoStructuralInput = { inverses: Command[]; count: number };

/**
 * Desfaz o que é reversível por desenho: o rascunho da matriz, o resnapshot e
 * os rascunhos de variável/compatibilidade **enquanto ainda não publicados**.
 * A publicação da variável e da regra de compatibilidade é irreversível em
 * todo o PolicyOps (I3 — `variable/publish` e `compat/publish` devolvem
 * `irreversible(...)`), e esta sessão não muda isso: desfazer uma resolução
 * já aplicada some com o rascunho da matriz e o resnapshot, mas a biblioteca
 * segue evoluída — do mesmo jeito que desfazer não reverte nenhuma outra
 * publicação no sistema.
 */
function undoStructural(input: UndoStructuralInput): Command<UndoStructuralInput, void> {
  return defineCommand({
    type: 'import/_undoApplyStructural',
    input,
    label: `Desfazer a resolução de estrutura (${plural(input.count)})`,
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
        inverse: undoStructural({ ...input, inverses: redo }),
      };
    },
  });
}
