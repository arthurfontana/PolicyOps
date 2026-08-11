import type { Command, CommandResult } from '@/core/command';
import type { CatalogItemKind, DefaultForUnlisted, Domain, PolicyOpsDocument } from '@/core/document/schema';
import { createCatalogItem } from '@/core/library/catalog';
import {
  createCompatibility,
  createCompatibilityDraft,
  publishCompatibility,
  saveCompatibilityMap,
} from '@/core/library/compatibility';
import { createVariableDraft, publishVariable, saveVariableDomains } from '@/core/library/variables';
import type { CompatibilityGap, DomainsGap } from '@/core/import/library-gaps';

/**
 * Orquestração dos comandos de biblioteca acionados pelo passo 3 — sempre
 * pelos comandos normais (`variable/*`, `compat/*`, `catalog/*`), nunca por
 * escrita direta no documento (RN-17, DEC-CARGA-008). Cada função devolve um
 * resultado simples para o card decidir o toast; quem chama já tem o
 * `dispatch` do `document-store`.
 */

export type Dispatch = <O>(command: Command<unknown, O>) => CommandResult<O>;

export type ActionResult = { ok: true } | { ok: false; message: string };

export function applyDomainsGap(dispatch: Dispatch, doc: PolicyOpsDocument, gap: DomainsGap, domains: Domain[]): ActionResult {
  const variable = doc.variables.find((candidate) => candidate.id === gap.variableId);
  if (variable === undefined) {
    return { ok: false, message: 'A variável não existe mais neste documento — refaça o mapeamento do passo 2.' };
  }

  let versionId = variable.versions.find((version) => version.state === 'DRAFT')?.id;
  if (versionId === undefined) {
    if (!variable.versions.some((version) => version.state === 'PUBLISHED')) {
      return { ok: false, message: 'A variável não tem versão em rascunho nem publicada para receber os domínios.' };
    }
    const created = dispatch(createVariableDraft({ variableId: variable.id }));
    if (!created.ok) return { ok: false, message: created.error.message };
    versionId = created.data.versionId;
  }

  const saved = dispatch(saveVariableDomains({ variableId: variable.id, versionId, domains }));
  if (!saved.ok) return { ok: false, message: saved.error.message };

  const published = dispatch(
    publishVariable({ variableId: variable.id, versionId, notes: 'Domínios criados pelo assistente de carga.' }),
  );
  if (!published.ok) return { ok: false, message: published.error.message };

  return { ok: true };
}

export function applyCompatibilityGap(
  dispatch: Dispatch,
  doc: PolicyOpsDocument,
  gap: CompatibilityGap,
  allow: Record<string, string[]>,
  defaultForUnlisted: DefaultForUnlisted,
): ActionResult {
  const rule = doc.compatibility.find(
    (candidate) =>
      candidate.archivedAt === undefined &&
      candidate.parentVariableId === gap.parentVariableId &&
      candidate.childVariableId === gap.childVariableId,
  );

  let ruleId: string;
  let versionId: string;

  if (rule === undefined) {
    const created = dispatch(
      createCompatibility({
        code: `${gap.parentVariableCode}_${gap.childVariableCode}`,
        name: `${gap.parentVariableCode} × ${gap.childVariableCode}`,
        parentVariableId: gap.parentVariableId,
        childVariableId: gap.childVariableId,
      }),
    );
    if (!created.ok) return { ok: false, message: created.error.message };
    ruleId = created.data.ruleId;
    versionId = created.data.versionId;
  } else {
    ruleId = rule.id;
    const draft = rule.versions.find((version) => version.state === 'DRAFT');
    if (draft !== undefined) {
      versionId = draft.id;
    } else {
      const createdDraft = dispatch(createCompatibilityDraft({ ruleId }));
      if (!createdDraft.ok) return { ok: false, message: createdDraft.error.message };
      versionId = createdDraft.data.versionId;
    }
  }

  const saved = dispatch(saveCompatibilityMap({ ruleId, versionId, allow, defaultForUnlisted }));
  if (!saved.ok) return { ok: false, message: saved.error.message };

  const published = dispatch(
    publishCompatibility({ ruleId, versionId, notes: 'Mapa criado pelo assistente de carga a partir do arquivo.' }),
  );
  if (!published.ok) return { ok: false, message: published.error.message };

  return { ok: true };
}

export function applyCatalogItems(
  dispatch: Dispatch,
  kind: CatalogItemKind,
  items: ReadonlyArray<{ code: string; label: string }>,
): ActionResult {
  for (const item of items) {
    const result = dispatch(createCatalogItem({ kind, code: item.code, label: item.label }));
    if (!result.ok) {
      return { ok: false, message: `${item.code}: ${result.error.message}` };
    }
  }
  return { ok: true };
}
