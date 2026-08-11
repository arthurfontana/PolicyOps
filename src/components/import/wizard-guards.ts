import { MAX_COMBINATIONS } from '@/core/axes/tuples';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { hasBlockingIssue, type ImportIssue } from '@/core/import/issues';
import { computeLibraryGaps, type LibraryGap } from '@/core/import/library-gaps';
import { projectImportAxes } from '@/core/import/plan';
import {
  validateProfile,
  validateProfileAgainstHeader,
  type DocumentWithProfiles,
  type ImportProfile,
} from '@/core/import/profile';
import type { ImportTable } from '@/core/import/parse-table';

/**
 * Problemas do perfil, com e sem cabeçalho do arquivo — a mesma checagem que
 * `planImport` roda antes de tudo (docs/12-carga-de-matrizes.md §5.4). Usada
 * pelos passos 2 e 4 para decidir se "Avançar" fica liberado, sem duplicar a
 * lógica de validação do motor.
 */
export function profileIssues(
  doc: DocumentWithProfiles,
  profile: ImportProfile,
  header?: readonly string[],
): ImportIssue[] {
  const issues = validateProfile(doc, profile);
  if (header !== undefined) issues.push(...validateProfileAgainstHeader(profile, header));
  return issues;
}

/**
 * Problemas do perfil relevantes ao passo 2 (colunas/eixos/templates) — sem
 * o requisito de `decisionRules` ter uma regra "otherwise" (I21), que só é
 * preenchida no passo 4. Sem isso, o passo 2 nunca teria "Avançar" liberado
 * antes de o passo 4 ser visitado, travando o assistente antes de chegar lá.
 */
export function step2ProfileIssues(
  doc: DocumentWithProfiles,
  profile: ImportProfile,
  header: readonly string[],
): ImportIssue[] {
  const withPlaceholderRules: ImportProfile =
    profile.decisionRules.some((rule) => 'otherwise' in rule)
      ? profile
      : { ...profile, decisionRules: [{ otherwise: 'PLACEHOLDER' }] };
  return profileIssues(doc, withPlaceholderRules, header);
}

export type GridSizeCheck = { ok: true; combinations: number } | { ok: false; reason: string };

/**
 * O maior grid que o mapeamento atual produziria (I16). Os níveis de eixo são
 * os mesmos para toda matriz da carga — só o recorte de partição muda — então
 * uma única chamada a `projectImportAxes` já responde "o grid cabe?" para o
 * mapeamento inteiro (docs/12 §6.1, painel do passo 2).
 */
export function checkGridSize(doc: PolicyOpsDocument, profile: ImportProfile): GridSizeCheck {
  try {
    const { x, y } = projectImportAxes(doc, profile);
    const combinations = x.tuples.length * y.tuples.length;
    if (combinations > MAX_COMBINATIONS) {
      return {
        ok: false,
        reason: `O maior grid teria ${combinations} combinações; o limite é ${MAX_COMBINATIONS} (I16).`,
      };
    }
    return { ok: true, combinations };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

export function libraryGapsOf(
  doc: PolicyOpsDocument,
  table: ImportTable,
  profile: ImportProfile,
): LibraryGap[] {
  return computeLibraryGaps(doc, table, profile);
}

export { hasBlockingIssue };
