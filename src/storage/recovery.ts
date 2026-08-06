import { CURRENT_SCHEMA_VERSION, type PolicyOpsDocument } from '@/core/document/schema';
import { validateDocument, type ValidationIssue } from '@/core/document/validate';

/**
 * Modo de recuperação — docs/06-persistencia-e-concorrencia.md §10.
 *
 * Se `validateDocument` falhar na leitura, o arquivo **não é descartado**:
 * ele é aberto com a lista de problemas em português, agrupados por
 * gravidade, com correção automática do que tem `autoFix` e o caminho no
 * JSON do que não tem.
 *
 * Duas garantias que este módulo sustenta:
 * 1. **Nada é gravado** aqui — as funções são puras e devolvem cópias;
 *    quem grava é o adapter, e sempre por "salvar como" (§10).
 * 2. As correções são recalculadas a partir das invariantes, não aplicadas
 *    "por caminho de string": remover uma tupla inválida arrasta as células
 *    que dependiam dela, coisa que um patch por path não faria.
 */

export type SeverityGroup = {
  severity: ValidationIssue['severity'];
  label: string;
  issues: ValidationIssue[];
};

export function groupBySeverity(issues: ValidationIssue[]): SeverityGroup[] {
  const errors = issues.filter((i) => i.severity === 'ERROR');
  const warnings = issues.filter((i) => i.severity === 'WARNING');
  const groups: SeverityGroup[] = [];
  if (errors.length > 0) {
    groups.push({ severity: 'ERROR', label: 'Erros — impedem abrir e salvar', issues: errors });
  }
  if (warnings.length > 0) {
    groups.push({ severity: 'WARNING', label: 'Avisos — não impedem salvar', issues: warnings });
  }
  return groups;
}

export function autoFixableCount(issues: ValidationIssue[]): number {
  return issues.filter((issue) => issue.autoFix !== undefined).length;
}

const AUTO_FIX_LABEL: Record<NonNullable<ValidationIssue['autoFix']>, string> = {
  REMOVE: 'remover o registro inválido',
  RENUMBER: 'renumerar as posições',
  CLEAR_REF: 'limpar a referência inexistente',
};

export function describeAutoFix(issue: ValidationIssue): string | null {
  return issue.autoFix ? AUTO_FIX_LABEL[issue.autoFix] : null;
}

// ---------------------------------------------------------------------------
// Moldagem mínima: um arquivo que não valida ainda precisa ser exibível
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Dá ao documento inválido a *forma* de um `PolicyOpsDocument` para que a
 * interface consiga listá-lo sem quebrar. O conteúdo continua sendo o do
 * arquivo — nada é inventado além dos containers vazios que faltavam. O tipo
 * é uma promessa que este objeto não cumpre (é justamente isso que os
 * `issues` dizem), e por isso o retorno só é usado em modo de recuperação.
 */
export function coerceToDocumentShape(raw: unknown): PolicyOpsDocument {
  const doc = asRecord(raw);
  const meta = asRecord(doc.meta);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ...doc,
    meta: {
      id: typeof meta.id === 'string' ? meta.id : '',
      name: typeof meta.name === 'string' && meta.name !== '' ? meta.name : 'Documento sem nome',
      revision: typeof meta.revision === 'number' ? meta.revision : 0,
      savedAt: typeof meta.savedAt === 'string' ? meta.savedAt : null,
      savedBy: typeof meta.savedBy === 'string' ? meta.savedBy : null,
      appVersion: typeof meta.appVersion === 'string' ? meta.appVersion : '',
      createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : '',
      ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
    },
    variables: asArray(doc.variables),
    compatibility: asArray(doc.compatibility),
    catalog: asArray(doc.catalog),
    projects: asArray(doc.projects),
    matrices: asArray(doc.matrices),
    templates: asArray(doc.templates),
    events: asArray(doc.events),
  } as PolicyOpsDocument;
}

// ---------------------------------------------------------------------------
// Correções automáticas
// ---------------------------------------------------------------------------

export type RepairAction = {
  /** Invariante que motivou a correção: 'I5', 'I15', 'I17', 'POSITION'. */
  invariant: string;
  path: string;
  description: string;
};

export type RepairResult = {
  /** Cópia corrigida. O original nunca é tocado. */
  document: unknown;
  actions: RepairAction[];
  /** Problemas que sobraram depois da correção — precisam de mão humana. */
  remaining: ValidationIssue[];
  /** Problemas que a correção resolveu. */
  fixed: ValidationIssue[];
};

const CELL_KEY_SEP = '::';

type LooseCell = Record<string, unknown>;

function catalogCodes(doc: Record<string, unknown>, kind: string): Set<string> {
  const codes = new Set<string>();
  for (const item of asArray(doc.catalog)) {
    const record = asRecord(item);
    if (record.kind === kind && typeof record.code === 'string') codes.add(record.code);
  }
  return codes;
}

/** I15 — tupla duplicada, com aridade errada ou com código inexistente. */
function repairTuples(doc: Record<string, unknown>, actions: RepairAction[]): void {
  asArray(doc.matrices).forEach((rawMatrix, mi) => {
    const matrix = asRecord(rawMatrix);
    asArray(matrix.versions).forEach((rawVersion, vi) => {
      const version = asRecord(rawVersion);
      const axes = asRecord(version.axes);
      (['x', 'y'] as const).forEach((role) => {
        const axis = asRecord(axes[role]);
        const levels = asArray(axis.levels).map((level) => {
          const codes = new Set<string>();
          for (const domain of asArray(asRecord(level).domains)) {
            const code = asRecord(domain).code;
            if (typeof code === 'string') codes.add(code);
          }
          return codes;
        });
        const tuples = asArray(axis.tuples).filter((t): t is string => typeof t === 'string');
        const seen = new Set<string>();
        const kept: string[] = [];
        for (const tuple of tuples) {
          const codes = tuple.split('|');
          const duplicated = seen.has(tuple);
          const wrongArity = codes.length !== levels.length;
          const unknownCode = codes.some((code, li) => !levels[li]?.has(code));
          seen.add(tuple);
          if (duplicated || wrongArity || unknownCode) {
            actions.push({
              invariant: 'I15',
              path: `matrices[${mi}].versions[${vi}].axes.${role}.tuples`,
              description: `Remover a tupla inválida "${tuple}" do eixo ${role.toUpperCase()}.`,
            });
            continue;
          }
          kept.push(tuple);
        }
        if (kept.length !== tuples.length) axis.tuples = kept;
      });
    });
  });
}

/** I5 — chave de célula que não corresponde a uma combinação existente. */
function repairCellKeys(doc: Record<string, unknown>, actions: RepairAction[]): void {
  asArray(doc.matrices).forEach((rawMatrix, mi) => {
    const matrix = asRecord(rawMatrix);
    asArray(matrix.versions).forEach((rawVersion, vi) => {
      const version = asRecord(rawVersion);
      const axes = asRecord(version.axes);
      const xTuples = new Set(asArray(asRecord(axes.x).tuples));
      const yTuples = new Set(asArray(asRecord(axes.y).tuples));
      const cells = asRecord(version.cells);
      for (const key of Object.keys(cells)) {
        const sepIndex = key.indexOf(CELL_KEY_SEP);
        const xPath = sepIndex === -1 ? null : key.slice(0, sepIndex);
        const yPath = sepIndex === -1 ? null : key.slice(sepIndex + CELL_KEY_SEP.length);
        if (xPath === null || !xTuples.has(xPath) || !yTuples.has(yPath)) {
          delete cells[key];
          actions.push({
            invariant: 'I5',
            path: `matrices[${mi}].versions[${vi}].cells[${JSON.stringify(key)}]`,
            description: `Remover a célula "${key}", que não cai em nenhuma combinação da matriz.`,
          });
        }
      }
    });
  });
}

/** I17 — referência a item de catálogo inexistente. */
function repairCatalogRefs(doc: Record<string, unknown>, actions: RepairAction[]): void {
  const byField: Array<{ field: 'decision' | 'offer' | 'limit'; codes: Set<string>; what: string }> =
    [
      { field: 'decision', codes: catalogCodes(doc, 'DECISION'), what: 'decisão' },
      { field: 'offer', codes: catalogCodes(doc, 'OFFER'), what: 'oferta' },
      { field: 'limit', codes: catalogCodes(doc, 'LIMIT'), what: 'limite' },
    ];

  asArray(doc.matrices).forEach((rawMatrix, mi) => {
    const matrix = asRecord(rawMatrix);
    asArray(matrix.versions).forEach((rawVersion, vi) => {
      const version = asRecord(rawVersion);
      const cells = asRecord(version.cells);
      for (const [key, rawCell] of Object.entries(cells)) {
        const cell = asRecord(rawCell) as LooseCell;
        const path = `matrices[${mi}].versions[${vi}].cells[${JSON.stringify(key)}]`;
        for (const { field, codes, what } of byField) {
          const value = cell[field];
          if (typeof value === 'string' && !codes.has(value)) {
            delete cell[field];
            actions.push({
              invariant: 'I17',
              path,
              description: `Limpar a ${what} "${value}" da célula "${key}" — ela não existe no catálogo.`,
            });
          }
        }
        // Célula que ficou sem nenhum campo não é gravada (docs/03 §6).
        if (Object.keys(cell).length === 0) {
          delete cells[key];
          actions.push({
            invariant: 'I17',
            path,
            description: `Remover a célula "${key}", que ficou sem conteúdo depois da limpeza.`,
          });
        }
      }
    });
  });
}

function renumber(
  entries: Array<Record<string, unknown>>,
  scope: { path: (index: number) => string; label: string },
  actions: RepairAction[],
): void {
  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const pa = typeof a.entry.position === 'number' ? a.entry.position : Number.MAX_SAFE_INTEGER;
      const pb = typeof b.entry.position === 'number' ? b.entry.position : Number.MAX_SAFE_INTEGER;
      return pa - pb || a.index - b.index;
    });
  ordered.forEach(({ entry, index }, expected) => {
    if (entry.position !== expected) {
      actions.push({
        invariant: 'POSITION',
        path: scope.path(index),
        description: `Renumerar ${scope.label}: position ${String(entry.position)} → ${expected}.`,
      });
      entry.position = expected;
    }
  });
}

/** POSITION — `position` 0-based sem buracos (docs/03 §1). */
function repairPositions(doc: Record<string, unknown>, actions: RepairAction[]): void {
  renumber(
    asArray(doc.projects).map(asRecord),
    { path: (i) => `projects[${i}]`, label: 'os projetos' },
    actions,
  );
  renumber(
    asArray(doc.catalog).map(asRecord),
    { path: (i) => `catalog[${i}]`, label: 'o catálogo' },
    actions,
  );
  asArray(doc.variables).forEach((rawVariable, vari) => {
    const variable = asRecord(rawVariable);
    asArray(variable.versions).forEach((rawVersion, vi) => {
      const version = asRecord(rawVersion);
      renumber(
        asArray(version.domains).map(asRecord),
        {
          path: (di) => `variables[${vari}].versions[${vi}].domains[${di}]`,
          label: 'os domínios',
        },
        actions,
      );
    });
  });
}

function issueKey(issue: ValidationIssue): string {
  return `${issue.invariant}|${issue.path}|${issue.message}`;
}

/**
 * Aplica **só** as correções seguras de §10 sobre uma cópia do documento:
 * remover referência a catálogo inexistente, remover célula de coordenada
 * inválida, remover tupla órfã e renumerar `position` com buraco.
 *
 * A ordem importa: tuplas primeiro (remover uma tupla pode invalidar
 * células), depois as chaves de célula, depois as referências de catálogo.
 *
 * Corrigir pode **revelar** outro problema, e isso é intencional: limpar a
 * referência a uma decisão inexistente deixa a célula sem decisão, e uma
 * versão publicada sem decisão viola I6. Qual decisão entra ali é pergunta
 * para quem escreveu a política — então o problema vai para `remaining`, em
 * vez de a aplicação escolher um valor por conta própria.
 */
export function repairDocument(raw: unknown, issues: ValidationIssue[]): RepairResult {
  const copy = structuredClone(raw) as Record<string, unknown>;
  const actions: RepairAction[] = [];

  repairTuples(copy, actions);
  repairCellKeys(copy, actions);
  repairCatalogRefs(copy, actions);
  repairPositions(copy, actions);

  const revalidated = validateDocument(copy);
  const remaining = revalidated.ok ? [] : revalidated.issues;
  const remainingKeys = new Set(remaining.map(issueKey));
  const fixed = issues.filter((issue) => !remainingKeys.has(issueKey(issue)));

  return { document: copy, actions, remaining, fixed };
}

// ---------------------------------------------------------------------------
// Relatório de diagnóstico exportável (§10)
// ---------------------------------------------------------------------------

export function diagnosticReport(
  fileName: string,
  issues: ValidationIssue[],
  at: Date,
): string {
  const lines: string[] = [
    'Relatório de diagnóstico — PolicyOps',
    `Arquivo: ${fileName}`,
    `Gerado em: ${at.toISOString()}`,
    `Problemas encontrados: ${issues.length} (${autoFixableCount(issues)} com correção automática)`,
    '',
  ];
  for (const group of groupBySeverity(issues)) {
    lines.push(`## ${group.label} (${group.issues.length})`, '');
    for (const issue of group.issues) {
      lines.push(`- [${issue.invariant}] ${issue.message}`);
      lines.push(`  caminho: ${issue.path}`);
      const fix = describeAutoFix(issue);
      lines.push(`  correção automática: ${fix ?? 'não disponível — corrija manualmente'}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
