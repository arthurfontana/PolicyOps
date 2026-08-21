import { encodePath } from '../axes/paths';
import { changedFields } from '../diff/cells';
import { CODE_REGEX, DECIMAL_REGEX, type Cell, type CatalogItemKind, type PolicyOpsDocument } from '../document/schema';
import { importIssue, type ImportIssue } from './issues';
import { sourceLine, type ImportTable } from './parse-table';
import {
  axisColumns,
  columnsWithRole,
  decisionForOffer,
  humanizeValue,
  isIgnoredValue,
  mapColumnValue,
  sharedValueColumns,
  type ColumnMapping,
  type ImportProfile,
} from './profile';

/**
 * Do arquivo para as células — docs/12-carga-de-matrizes.md §5.4.
 *
 * `resolveImport` é o passo que traduz texto em conteúdo de política: cada
 * linha, para cada opção do desdobramento (§5.3), vira uma célula com a
 * coordenada (`matrixKey`, `xPath`, `yPath`) que a identifica. Aqui nada sabe
 * de matriz existente, versão ou diff — isso é `plan.ts`.
 *
 * Duas regras mandam no desenho: a chave da célula vem do valor **mapeado**,
 * nunca do texto cru (RN-04), e valor sem mapeamento **bloqueia** em vez de
 * sumir em silêncio (RN-16).
 */

export type ResolvedRow = {
  /** Valores de partição + opção do desdobramento, separados por `|`. */
  matrixKey: string;
  xPath: string;
  yPath: string;
  cell: Cell;
  source: { line: number; column: string };
};

/** A identidade de uma matriz citada pelo arquivo, pronta para os templates. */
export type ResolvedMatrixKey = {
  key: string;
  /** `code` por coluna de partição, mais o code da dimensão do desdobramento. */
  values: Record<string, string>;
  /** Rótulo de exibição dos mesmos marcadores — alimenta o `nameTemplate`. */
  labels: Record<string, string>;
};

export type ResolveImportResult = {
  rows: ResolvedRow[];
  /** Uma entrada por matriz citada, na ordem de primeira aparição. */
  keys: ResolvedMatrixKey[];
  issues: ImportIssue[];
  /** Linhas do arquivo descartadas por `ignoredValues`. */
  ignoredRows: number;
};

// ---------------------------------------------------------------------------
// Acumulador de problemas com deduplicação
// ---------------------------------------------------------------------------

/**
 * Um problema por (código, coluna, valor), com a **primeira** linha em que ele
 * aparece e a contagem total. Sem isso, um valor não mapeado numa coluna de
 * 6.678 linhas produziria 6.678 mensagens idênticas.
 */
class IssueLog {
  private readonly byKey = new Map<string, ImportIssue>();
  private readonly ordered: ImportIssue[] = [];

  add(issue: ImportIssue, dedupeKey?: string): void {
    if (dedupeKey === undefined) {
      this.ordered.push(issue);
      return;
    }
    const existing = this.byKey.get(dedupeKey);
    if (existing !== undefined) {
      const details = existing.details as { occurrences: number };
      details.occurrences += 1;
      return;
    }
    const withCount: ImportIssue = { ...issue, details: { ...issue.details, occurrences: 1 } };
    this.byKey.set(dedupeKey, withCount);
    this.ordered.push(withCount);
  }

  all(): ImportIssue[] {
    return this.ordered;
  }
}

// ---------------------------------------------------------------------------
// Índices do documento
// ---------------------------------------------------------------------------

/** Códigos de domínio da versão publicada de cada variável de eixo. */
function publishedDomainCodes(doc: PolicyOpsDocument, variableId: string): Set<string> | undefined {
  const variable = doc.variables.find((candidate) => candidate.id === variableId);
  const published = variable?.versions.find((version) => version.state === 'PUBLISHED');
  if (published === undefined) return undefined;
  return new Set(published.domains.map((domain) => domain.code));
}

/** Códigos ativos do catálogo por kind — item arquivado não entra em célula nova. */
function catalogCodes(doc: PolicyOpsDocument, kind: CatalogItemKind): Set<string> {
  return new Set(
    doc.catalog
      .filter((item) => item.kind === kind && item.archivedAt === undefined)
      .map((item) => item.code),
  );
}

type AxisLevelIndex = {
  mapping: ColumnMapping;
  columnIndex: number;
  domains: Set<string> | undefined;
  cache: Map<string, string>;
};

type ValueTarget = {
  mapping: ColumnMapping;
  columnIndex: number;
  field: string;
};

// ---------------------------------------------------------------------------
// resolveImport
// ---------------------------------------------------------------------------

export function resolveImport(
  doc: PolicyOpsDocument,
  table: ImportTable,
  profile: ImportProfile,
): ResolveImportResult {
  const log = new IssueLog();
  const headerIndex = new Map(table.header.map((name, index) => [name, index]));
  const indexOf = (column: string): number => headerIndex.get(column) ?? -1;

  const partitions = columnsWithRole(profile, 'PARTITION').map((mapping) => ({
    mapping,
    columnIndex: indexOf(mapping.column),
    cache: new Map<string, string>(),
  }));

  const buildAxis = (role: 'X' | 'Y'): AxisLevelIndex[] =>
    axisColumns(profile, role).map((mapping) => {
      const domains = publishedDomainCodes(doc, mapping.axis!.variableId);
      if (domains === undefined) {
        log.add(
          importIssue(
            'IMPORT_PROFILE_INVALID',
            `A variável do eixo ${role} usada pela coluna "${mapping.column}" não tem versão publicada — publique uma antes de carregar.`,
            { column: mapping.column, details: { variableId: mapping.axis!.variableId } },
          ),
        );
      }
      return { mapping, columnIndex: indexOf(mapping.column), domains, cache: new Map<string, string>() };
    });

  const axes = { X: buildAxis('X'), Y: buildAxis('Y') };
  const checks = columnsWithRole(profile, 'CHECK').map((mapping) => ({
    mapping,
    columnIndex: indexOf(mapping.column),
  }));
  const ignorable = profile.columns
    .filter((mapping) => mapping.ignoredValues !== undefined && mapping.ignoredValues.length > 0)
    .map((mapping) => ({ mapping, columnIndex: indexOf(mapping.column) }));

  const shared: ValueTarget[] = sharedValueColumns(profile).map((mapping) => ({
    mapping,
    columnIndex: indexOf(mapping.column),
    field: mapping.value!.field,
  }));

  const unpivot = profile.unpivot;
  const options = (unpivot?.options ?? []).map((option) => {
    const mapping = profile.columns.find((candidate) => candidate.column === option.column)!;
    return {
      option,
      target: { mapping, columnIndex: indexOf(option.column), field: mapping.value!.field },
    };
  });

  const offers = catalogCodes(doc, 'OFFER');
  const limits = catalogCodes(doc, 'LIMIT');
  const decisions = catalogCodes(doc, 'DECISION');
  const decisionCache = new Map<string, string | undefined>();

  const rows: ResolvedRow[] = [];
  const keys: ResolvedMatrixKey[] = [];
  const keyIndex = new Map<string, ResolvedMatrixKey>();
  /** Chave de célula já vista → linha e conteúdo, para RN-08. */
  const seen = new Map<string, { line: number; cell: Cell }>();
  let ignoredRows = 0;

  for (let index = 0; index < table.rows.length; index++) {
    const row = table.rows[index]!;
    const line = sourceLine(table, index, profile.format.headerRow);

    // 1. Linhas descartadas por valor ignorado (US-03).
    const ignored = ignorable.find(
      (entry) => entry.columnIndex >= 0 && isIgnoredValue(entry.mapping, row[entry.columnIndex] ?? ''),
    );
    if (ignored !== undefined) {
      const raw = row[ignored.columnIndex] ?? '';
      ignoredRows += 1;
      log.add(
        importIssue(
          'IMPORT_ROW_IGNORED',
          `Linha ${line}: descartada porque "${ignored.mapping.column}" traz o valor ignorado "${raw}".`,
          { line, column: ignored.mapping.column, details: { value: raw } },
        ),
        `IMPORT_ROW_IGNORED|${ignored.mapping.column}|${raw}`,
      );
      continue;
    }

    // 2. Colunas de conferência (§5.2).
    for (const check of checks) {
      const raw = (row[check.columnIndex] ?? '').trim();
      const expected = check.mapping.check!.expected;
      if (raw === expected) continue;
      log.add(
        importIssue(
          'IMPORT_CHECK_MISMATCH',
          `Linha ${line}: a coluna de conferência "${check.mapping.column}" traz "${raw}" onde o perfil espera "${expected}".`,
          { line, column: check.mapping.column, details: { expected, found: raw } },
        ),
        `IMPORT_CHECK_MISMATCH|${check.mapping.column}|${raw}`,
      );
    }

    // 3. Identidade da matriz (RN-04).
    const values: Record<string, string> = {};
    const labels: Record<string, string> = {};
    let keyOk = true;
    for (const partition of partitions) {
      const raw = row[partition.columnIndex] ?? '';
      let code = partition.cache.get(raw);
      if (code === undefined) {
        code = mapColumnValue(partition.mapping, raw);
        partition.cache.set(raw, code);
      }
      if (!CODE_REGEX.test(code)) {
        keyOk = false;
        log.add(unmapped(partition.mapping.column, raw, line, 'partição'), `IMPORT_UNMAPPED_VALUE|${partition.mapping.column}|${raw}`);
        continue;
      }
      values[partition.mapping.column] = code;
      labels[partition.mapping.column] = humanizeValue(raw);
    }

    // 4. Coordenada nos eixos.
    const paths: Record<'X' | 'Y', string> = { X: '', Y: '' };
    for (const role of ['X', 'Y'] as const) {
      const codes: string[] = [];
      for (const level of axes[role]) {
        const raw = row[level.columnIndex] ?? '';
        let code = level.cache.get(raw);
        if (code === undefined) {
          code = mapColumnValue(level.mapping, raw);
          level.cache.set(raw, code);
        }
        if (!CODE_REGEX.test(code) || level.domains === undefined || !level.domains.has(code)) {
          keyOk = false;
          log.add(
            unmapped(level.mapping.column, raw, line, `eixo ${role}`),
            `IMPORT_UNMAPPED_VALUE|${level.mapping.column}|${raw}`,
          );
          continue;
        }
        codes.push(code);
      }
      if (codes.length === axes[role].length && codes.length > 0) paths[role] = encodePath(codes);
      else keyOk = false;
    }
    if (!keyOk) continue;

    // 5. Uma célula por opção do desdobramento (§5.3); sem desdobramento, uma
    //    célula por linha alimentada por todas as colunas de valor.
    const targets: Array<{ code: string; label: string; column: string; own: ValueTarget[] }> =
      unpivot === undefined
        ? [{ code: '', label: '', column: shared[0]?.mapping.column ?? '', own: [] }]
        : options.map((entry) => ({
            code: entry.option.code,
            label: entry.option.label,
            column: entry.option.column,
            own: [entry.target],
          }));

    for (const target of targets) {
      const built = buildCell(row, [...target.own, ...shared], {
        line,
        log,
        offers,
        limits,
        decisions,
        decisionCache,
        profile,
      });
      if (built === undefined) continue;

      const keyValues = unpivot === undefined ? values : { ...values, [unpivot.code]: target.code };
      const keyLabels = unpivot === undefined ? labels : { ...labels, [unpivot.code]: target.label };
      const matrixKey = Object.values(keyValues).join('|');
      if (!keyIndex.has(matrixKey)) {
        const entry: ResolvedMatrixKey = { key: matrixKey, values: keyValues, labels: keyLabels };
        keyIndex.set(matrixKey, entry);
        keys.push(entry);
      }

      // RN-08: mesma chave duas vezes — idêntica é aviso, divergente é erro.
      const cellKey = `${matrixKey}::${paths.X}::${paths.Y}`;
      const previous = seen.get(cellKey);
      if (previous !== undefined) {
        if (changedFields(previous.cell, built).length === 0) {
          log.add(
            importIssue(
              'IMPORT_DUPLICATE_ROW',
              `Linha ${line}: repete a combinação da linha ${previous.line} com o mesmo conteúdo — contada uma vez só.`,
              { line, column: target.column, details: { firstLine: previous.line, matrixKey } },
            ),
            `IMPORT_DUPLICATE_ROW|${matrixKey}|${paths.X}|${paths.Y}`,
          );
        } else {
          log.add(
            importIssue(
              'IMPORT_DUPLICATE_KEY',
              `Linhas ${previous.line} e ${line}: a mesma combinação aparece duas vezes com conteúdo diferente.`,
              {
                line,
                column: target.column,
                details: { lines: [previous.line, line], matrixKey, xPath: paths.X, yPath: paths.Y },
              },
            ),
          );
        }
        continue;
      }
      seen.set(cellKey, { line, cell: built });
      rows.push({
        matrixKey,
        xPath: paths.X,
        yPath: paths.Y,
        cell: built,
        source: { line, column: target.column },
      });
    }
  }

  return { rows, keys, issues: log.all(), ignoredRows };
}

function unmapped(column: string, raw: string, line: number, what: string): ImportIssue {
  return importIssue(
    'IMPORT_UNMAPPED_VALUE',
    `A coluna de ${what} "${column}" traz o valor "${raw}", sem correspondência na biblioteca (primeira ocorrência: linha ${line}).`,
    { line, column, details: { value: raw } },
  );
}

function invalidDecimal(column: string, raw: string, line: number, what: string): ImportIssue {
  return importIssue(
    'IMPORT_UNMAPPED_VALUE',
    `A coluna de ${what} "${column}" traz o valor "${raw}", que não é um decimal não negativo válido (primeira ocorrência: linha ${line}).`,
    { line, column, details: { value: raw } },
  );
}

type BuildContext = {
  line: number;
  log: IssueLog;
  offers: Set<string>;
  limits: Set<string>;
  decisions: Set<string>;
  decisionCache: Map<string, string | undefined>;
  profile: ImportProfile;
};

/**
 * A célula de uma linha do arquivo. `undefined` quando nenhuma coluna de valor
 * trouxe conteúdo — a combinação simplesmente não é observada por esta matriz,
 * e é isso que RN-21 usa para decidir o que suprimir.
 */
function buildCell(row: string[], targets: ValueTarget[], ctx: BuildContext): Cell | undefined {
  const cell: Cell = {};
  let filled = false;

  for (const target of targets) {
    const raw = (row[target.columnIndex] ?? '').trim();
    if (raw === '') continue;
    const field = target.field;

    if (field === 'note') {
      cell.note = raw;
      filled = true;
      continue;
    }
    if (field.startsWith('attr:')) {
      cell.attrs = { ...cell.attrs, [field.slice(5)]: raw };
      filled = true;
      continue;
    }
    if (field === 'limitMin' || field === 'limitMax') {
      const decimal = raw.replace(',', '.');
      if (!DECIMAL_REGEX.test(decimal) || Number(decimal) < 0) {
        ctx.log.add(
          invalidDecimal(target.mapping.column, raw, ctx.line, field === 'limitMin' ? 'limite mínimo' : 'limite máximo'),
          `IMPORT_UNMAPPED_VALUE|${target.mapping.column}|${raw}`,
        );
        continue;
      }
      if (field === 'limitMin') cell.limitMin = decimal;
      else cell.limitMax = decimal;
      filled = true;
      continue;
    }

    const code = mapColumnValue(target.mapping, raw);
    const catalog = field === 'offer' ? ctx.offers : ctx.limits;
    if (!CODE_REGEX.test(code) || !catalog.has(code)) {
      ctx.log.add(
        unmapped(target.mapping.column, raw, ctx.line, field === 'offer' ? 'oferta' : 'limite'),
        `IMPORT_UNMAPPED_VALUE|${target.mapping.column}|${raw}`,
      );
      continue;
    }
    if (field === 'offer') cell.offer = code;
    else cell.limit = code;
    filled = true;
  }

  if (!filled) return undefined;

  // RN-11: toda célula da carga sai com decisão, derivada da oferta.
  const cacheKey = cell.offer ?? '';
  let decision = ctx.decisionCache.get(cacheKey);
  if (!ctx.decisionCache.has(cacheKey)) {
    decision = decisionForOffer(ctx.profile.decisionRules, cell.offer);
    ctx.decisionCache.set(cacheKey, decision);
  }
  if (decision === undefined || !ctx.decisions.has(decision)) {
    ctx.log.add(
      importIssue(
        'IMPORT_UNMAPPED_VALUE',
        decision === undefined
          ? `Nenhuma regra de decisão se aplica à oferta "${cell.offer ?? '(vazia)'}" — falta a regra "otherwise".`
          : `A decisão "${decision}", derivada da oferta "${cell.offer ?? '(vazia)'}", não existe no catálogo.`,
        { line: ctx.line, details: { offer: cell.offer, decision } },
      ),
      `IMPORT_UNMAPPED_VALUE|decision|${cacheKey}`,
    );
    return undefined;
  }
  cell.decision = decision;
  return cell;
}
