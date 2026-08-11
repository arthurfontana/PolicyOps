import Decimal from 'decimal.js-light';
import { z } from 'zod';
import {
  INTEGER_REGEX,
  PolicyOpsDocumentSchema,
  type BoundaryMode,
  type CatalogItemKind,
  type Domain,
  type PolicyOpsDocument,
} from './schema';
import {
  detectContiguityDirection,
  distinctGroupingPaths,
  formatGroupingPath,
  groupingPathKey,
  groupingRangeAt,
} from './grouping';
import { validateProfile } from '../import/profile';

/**
 * Validação do documento — schema estrutural (Zod) + invariantes de negócio
 * I1–I18 (docs/05-regras-de-negocio.md §9). Roda na leitura de um arquivo e
 * antes de todo salvamento (docs/03-modelo-do-documento.md §9).
 *
 * A validação NUNCA descarta o documento: devolve a lista de problemas para
 * que a Sessão 05 construa o modo de recuperação em cima dela.
 */

export type IssueSeverity = 'ERROR' | 'WARNING';
export type AutoFix = 'REMOVE' | 'RENUMBER' | 'CLEAR_REF';

export type ValidationIssue = {
  severity: IssueSeverity;
  invariant: string; // 'I5', ou 'SCHEMA' / 'POSITION' para checagens fora da tabela I1–I18 (ver abaixo)
  path: string; // 'matrices[2].versions[0].cells["R1::VAREJO|ATE_100K"]'
  message: string; // pt-BR
  autoFix?: AutoFix;
};

export type ValidateResult =
  | { ok: true; document: PolicyOpsDocument }
  | { ok: false; issues: ValidationIssue[] };

export function validateDocument(doc: unknown): ValidateResult {
  const parsed = PolicyOpsDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    return { ok: false, issues: zodErrorToIssues(parsed.error) };
  }

  const document = parsed.data;
  const issues = runAllChecks(document);
  if (issues.some((issue) => issue.severity === 'ERROR')) {
    return { ok: false, issues };
  }
  return { ok: true, document };
}

function zodErrorToIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    severity: 'ERROR',
    invariant: 'SCHEMA',
    path: formatZodPath(issue.path),
    message: issue.message,
  }));
}

function formatZodPath(path: (string | number)[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else {
      out += out === '' ? String(segment) : `.${segment}`;
    }
  }
  return out;
}

const CELL_KEY_SEP = '::';

function splitCellKey(key: string): { xPath: string; yPath: string } | null {
  const sepIndex = key.indexOf(CELL_KEY_SEP);
  if (sepIndex === -1) return null;
  return { xPath: key.slice(0, sepIndex), yPath: key.slice(sepIndex + CELL_KEY_SEP.length) };
}

// ---------------------------------------------------------------------------
// I1 — no máximo uma MatrixVersion em DRAFT por matriz
// ---------------------------------------------------------------------------

export function checkI1(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.matrices.forEach((matrix, mi) => {
    const drafts = matrix.versions.filter((v) => v.state === 'DRAFT');
    if (drafts.length > 1) {
      issues.push({
        severity: 'ERROR',
        invariant: 'I1',
        path: `matrices[${mi}]`,
        message: `A matriz "${matrix.code}" tem ${drafts.length} versões em rascunho — no máximo uma é permitida.`,
      });
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I2 — no máximo uma MatrixVersion em PUBLISHED por matriz
// ---------------------------------------------------------------------------

export function checkI2(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.matrices.forEach((matrix, mi) => {
    const published = matrix.versions.filter((v) => v.state === 'PUBLISHED');
    if (published.length > 1) {
      issues.push({
        severity: 'ERROR',
        invariant: 'I2',
        path: `matrices[${mi}]`,
        message: `A matriz "${matrix.code}" tem ${published.length} versões publicadas — no máximo uma é permitida.`,
      });
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I3 — versão PUBLISHED/SUPERSEDED/ARCHIVED é imutável
//
// A imutabilidade em si é imposta em tempo de execução por `assertEditable`
// (docs/05-regras-de-negocio.md §1.5, Sessão 04) — validate.ts não tem duas
// versões do documento para comparar. O que dá para checar aqui, de forma
// estática, é a consistência estrutural que sustenta essa garantia: uma
// versão nesses estados precisa carregar os registros que a "selam".
// ---------------------------------------------------------------------------

export function checkI3(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.matrices.forEach((matrix, mi) => {
    matrix.versions.forEach((version, vi) => {
      const path = `matrices[${mi}].versions[${vi}]`;
      if (version.state === 'PUBLISHED' || version.state === 'SUPERSEDED') {
        if (!version.publishedAt || !version.publishedBy || !version.effectiveFrom) {
          issues.push({
            severity: 'ERROR',
            invariant: 'I3',
            path,
            message: `A versão ${version.number} da matriz "${matrix.code}" está ${version.state} mas não tem os registros de publicação (publishedAt, publishedBy, effectiveFrom) que a tornam imutável.`,
          });
        }
      }
      if (version.state === 'SUPERSEDED' && !version.effectiveTo) {
        issues.push({
          severity: 'ERROR',
          invariant: 'I3',
          path,
          message: `A versão ${version.number} da matriz "${matrix.code}" está SUPERSEDED mas não tem effectiveTo.`,
        });
      }
      if (version.state === 'ARCHIVED' && !version.archivedAt) {
        issues.push({
          severity: 'ERROR',
          invariant: 'I3',
          path,
          message: `A versão ${version.number} da matriz "${matrix.code}" está ARCHIVED mas não tem archivedAt.`,
        });
      }
    });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I4 — intervalos [effectiveFrom, effectiveTo) de uma matriz não se
// sobrepõem nem deixam buracos
// ---------------------------------------------------------------------------

export function checkI4(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.matrices.forEach((matrix, mi) => {
    const withEffectiveFrom = matrix.versions
      .map((v, vi) => ({ v, vi }))
      .filter(({ v }) => v.effectiveFrom !== undefined)
      .sort((a, b) => a.v.effectiveFrom!.localeCompare(b.v.effectiveFrom!));

    for (let i = 0; i < withEffectiveFrom.length - 1; i++) {
      const current = withEffectiveFrom[i]!;
      const next = withEffectiveFrom[i + 1]!;
      const path = `matrices[${mi}].versions[${current.vi}]`;
      if (current.v.effectiveTo === undefined) {
        issues.push({
          severity: 'ERROR',
          invariant: 'I4',
          path,
          message: `A versão ${current.v.number} da matriz "${matrix.code}" não tem effectiveTo mas existe uma versão posterior (${next.v.number}) — o intervalo de vigência ficaria sobreposto.`,
        });
      } else if (current.v.effectiveTo !== next.v.effectiveFrom) {
        issues.push({
          severity: 'ERROR',
          invariant: 'I4',
          path,
          message: `O intervalo de vigência da versão ${current.v.number} termina em ${current.v.effectiveTo}, mas a próxima versão (${next.v.number}) começa em ${next.v.effectiveFrom} — há uma sobreposição ou um buraco.`,
        });
      }
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I5 — toda chave de cells decompõe em xPath::yPath presentes nas tuplas
// ---------------------------------------------------------------------------

export function checkI5(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.matrices.forEach((matrix, mi) => {
    matrix.versions.forEach((version, vi) => {
      const xTuples = new Set(version.axes.x.tuples);
      const yTuples = new Set(version.axes.y.tuples);
      for (const key of Object.keys(version.cells)) {
        const split = splitCellKey(key);
        const path = `matrices[${mi}].versions[${vi}].cells[${JSON.stringify(key)}]`;
        if (!split || !xTuples.has(split.xPath) || !yTuples.has(split.yPath)) {
          issues.push({
            severity: 'ERROR',
            invariant: 'I5',
            path,
            message: `A chave de célula "${key}" não corresponde a uma combinação válida de axes.x.tuples × axes.y.tuples.`,
            autoFix: 'REMOVE',
          });
        }
      }
    });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I6 — publicar exige zero combinações sem decision
// ---------------------------------------------------------------------------

export function checkI6(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.matrices.forEach((matrix, mi) => {
    matrix.versions.forEach((version, vi) => {
      if (version.state !== 'PUBLISHED' && version.state !== 'SUPERSEDED') return;
      const path = `matrices[${mi}].versions[${vi}]`;
      const total = version.axes.x.tuples.length * version.axes.y.tuples.length;
      let filled = 0;
      for (const xPath of version.axes.x.tuples) {
        for (const yPath of version.axes.y.tuples) {
          if (version.cells[`${xPath}${CELL_KEY_SEP}${yPath}`]?.decision !== undefined) filled++;
        }
      }
      if (filled < total) {
        issues.push({
          severity: 'ERROR',
          invariant: 'I6',
          path,
          message: `A versão ${version.number} da matriz "${matrix.code}" está ${version.state} mas tem ${total - filled} combinação(ões) sem decisão.`,
        });
      }
    });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I7 — CatalogItem de kind LIMIT tem numericValue
// ---------------------------------------------------------------------------

export function checkI7(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.catalog.forEach((item, ci) => {
    if (item.kind === 'LIMIT' && item.numericValue === undefined) {
      issues.push({
        severity: 'ERROR',
        invariant: 'I7',
        path: `catalog[${ci}]`,
        message: `O item de catálogo "${item.code}" é do tipo LIMIT mas não tem numericValue.`,
      });
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I8 — BOOLEAN tem exatamente 2 domínios; demais tipos, ao menos 2
// ---------------------------------------------------------------------------

export function checkI8(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.variables.forEach((variable, vari) => {
    variable.versions.forEach((version, vi) => {
      const path = `variables[${vari}].versions[${vi}]`;
      const n = version.domains.length;
      if (variable.type === 'BOOLEAN' && n !== 2) {
        issues.push({
          severity: 'WARNING',
          invariant: 'I8',
          path,
          message: `A variável booleana "${variable.code}" precisa ter exatamente 2 domínios (tem ${n}).`,
        });
      } else if (variable.type !== 'BOOLEAN' && n < 2) {
        issues.push({
          severity: 'WARNING',
          invariant: 'I8',
          path,
          message: `A variável "${variable.code}" precisa ter ao menos 2 domínios (tem ${n}).`,
        });
      }
    });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I9 — RANGE: faixas contíguas, sem sobreposição, ordenadas por position;
// no máximo um isCatchAll, e ele é o último. Com `groupingDimensions`, a
// mesma regra vale independentemente para cada `path` distinto presente em
// `groupingRanges`, no lugar de `rangeMin`/`rangeMax` — e só para os caminhos
// que o usuário definiu, nunca para o produto cartesiano das opções.
// ---------------------------------------------------------------------------

function checkCatchAllIdentity(
  domains: Domain[],
  variableCode: string,
  path: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const catchAlls = domains.filter((d) => d.isCatchAll);
  if (catchAlls.length > 1) {
    issues.push({
      severity: 'WARNING',
      invariant: 'I9',
      path,
      message: `A variável "${variableCode}" tem ${catchAlls.length} domínios isCatchAll — no máximo um é permitido.`,
    });
  }
  if (catchAlls.length === 1 && domains[domains.length - 1] !== catchAlls[0]) {
    issues.push({
      severity: 'WARNING',
      invariant: 'I9',
      path,
      message: `O domínio isCatchAll de "${variableCode}" precisa ser o último por position.`,
    });
  }
  return issues;
}

function checkValueContiguity(
  domains: Domain[],
  accessor: { min: (d: Domain) => string | undefined; max: (d: Domain) => string | undefined },
  variableCode: string,
  path: string,
  groupingPath: string[] | undefined,
  boundaryMode: BoundaryMode,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const regionSuffix = groupingPath === undefined ? '' : ` em "${formatGroupingPath(groupingPath)}"`;
  const isInclusiveInteger = boundaryMode === 'INCLUSIVE_INTEGER';
  // Faixas por position podem crescer (o de sempre) ou decrescer (cortes de
  // score "melhor faixa primeiro") — ver detectContiguityDirection.
  const direction = detectContiguityDirection(domains.map((d) => ({ min: accessor.min(d) })));
  for (let i = 0; i < domains.length - 1; i++) {
    const current = domains[i]!;
    const next = domains[i + 1]!;
    if (current.isCatchAll) continue;
    const beforeDomain = direction === 'ASCENDING' ? current : next;
    const afterDomain = direction === 'ASCENDING' ? next : current;
    const beforeValue = direction === 'ASCENDING' ? accessor.max(current) : accessor.max(next);
    const afterValue = direction === 'ASCENDING' ? accessor.min(next) : accessor.min(current);
    if (beforeValue === undefined || afterValue === undefined) {
      issues.push({
        severity: 'WARNING',
        invariant: 'I9',
        path,
        message: `Os domínios "${current.code}" e "${next.code}" de "${variableCode}" precisam ter mínimo/máximo definidos${regionSuffix} para checar contiguidade.`,
      });
      continue;
    }
    if (isInclusiveInteger && (!INTEGER_REGEX.test(beforeValue) || !INTEGER_REGEX.test(afterValue))) {
      issues.push({
        severity: 'WARNING',
        invariant: 'I9',
        path,
        message: `Os domínios "${current.code}" e "${next.code}" de "${variableCode}" têm mínimo/máximo não inteiro${regionSuffix} — o modo de limites inclusivos exige inteiros.`,
      });
      continue;
    }
    const contiguous = isInclusiveInteger
      ? new Decimal(beforeValue).plus(1).eq(new Decimal(afterValue))
      : beforeValue === afterValue;
    if (!contiguous) {
      issues.push({
        severity: 'WARNING',
        invariant: 'I9',
        path,
        message: isInclusiveInteger
          ? `As faixas "${current.code}" e "${next.code}" de "${variableCode}" não são contíguas${regionSuffix} no modo de limites inclusivos: o máximo de "${beforeDomain.code}" (${beforeValue}) + 1 precisa ser igual ao mínimo de "${afterDomain.code}" (${afterValue}).`
          : `As faixas "${current.code}" e "${next.code}" de "${variableCode}" não são contíguas${regionSuffix}: o máximo de "${beforeDomain.code}" (${beforeValue}) precisa ser igual ao mínimo de "${afterDomain.code}" (${afterValue}).`,
      });
    }
  }
  return issues;
}

export function checkI9(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.variables.forEach((variable, vari) => {
    if (variable.type !== 'RANGE') return;
    variable.versions.forEach((version, vi) => {
      const path = `variables[${vari}].versions[${vi}]`;
      const domains = [...version.domains].sort((a, b) => a.position - b.position);
      const boundaryMode: BoundaryMode = version.boundaryMode ?? 'INCLUSIVE_INTEGER';

      issues.push(...checkCatchAllIdentity(domains, variable.code, path));

      if (version.groupingDimensions === undefined) {
        issues.push(
          ...checkValueContiguity(
            domains,
            { min: (d) => d.rangeMin, max: (d) => d.rangeMax },
            variable.code,
            path,
            undefined,
            boundaryMode,
          ),
        );
      } else {
        for (const groupingPath of distinctGroupingPaths(domains)) {
          const key = groupingPathKey(groupingPath);
          const rangeAt = (d: Domain) => groupingRangeAt(d, key);
          const present = domains.filter((d) => rangeAt(d) !== undefined);
          issues.push(
            ...checkValueContiguity(
              present,
              { min: (d) => rangeAt(d)?.min, max: (d) => rangeAt(d)?.max },
              variable.code,
              path,
              groupingPath,
              boundaryMode,
            ),
          );
        }
      }
    });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I19 — groupingDimensions: 1 a 4 níveis, `code` de nível único, `options`
// não vazio com `code` único dentro do nível, e todo `GroupingRange.path` com
// o comprimento certo apontando para opções existentes.
//
// Deliberadamente NÃO há checagem de completude entre combinações: hierarquias
// reais são assimétricas (nem toda Regional tem MEI), e o editor apenas avisa
// (docs/03-modelo-do-documento.md §9, nota após I19).
// ---------------------------------------------------------------------------

/** Teto de níveis de agrupamento (I19) — independente do teto de 3 de `AxisLevel` (I13). */
const MAX_GROUPING_LEVELS = 4;

export function checkI19(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.variables.forEach((variable, vari) => {
    if (variable.type !== 'RANGE') return;
    variable.versions.forEach((version, vi) => {
      if (version.groupingDimensions === undefined) return;
      const path = `variables[${vari}].versions[${vi}].groupingDimensions`;
      const dimensions = version.groupingDimensions;

      if (dimensions.length === 0 || dimensions.length > MAX_GROUPING_LEVELS) {
        issues.push({
          severity: 'WARNING',
          invariant: 'I19',
          path,
          message: `Os agrupamentos da variável "${variable.code}" precisam ter de 1 a ${MAX_GROUPING_LEVELS} níveis (tem ${dimensions.length}).`,
        });
      }

      const seenLevels = new Map<string, number>();
      dimensions.forEach((dimension) =>
        seenLevels.set(dimension.code, (seenLevels.get(dimension.code) ?? 0) + 1),
      );
      for (const [code, count] of seenLevels) {
        if (count > 1) {
          issues.push({
            severity: 'WARNING',
            invariant: 'I19',
            path,
            message: `O código de agrupamento "${code}" aparece ${count} vezes na variável "${variable.code}" — precisa ser único entre os níveis.`,
          });
        }
      }

      dimensions.forEach((dimension, li) => {
        if (dimension.options.length === 0) {
          issues.push({
            severity: 'WARNING',
            invariant: 'I19',
            path: `${path}[${li}]`,
            message: `O agrupamento "${dimension.code}" da variável "${variable.code}" precisa ter ao menos uma opção.`,
          });
        }
        const seenOptions = new Map<string, number>();
        dimension.options.forEach((option) =>
          seenOptions.set(option.code, (seenOptions.get(option.code) ?? 0) + 1),
        );
        for (const [code, count] of seenOptions) {
          if (count > 1) {
            issues.push({
              severity: 'WARNING',
              invariant: 'I19',
              path: `${path}[${li}]`,
              message: `A opção "${code}" aparece ${count} vezes no agrupamento "${dimension.code}" da variável "${variable.code}" — precisa ser única dentro do nível.`,
            });
          }
        }
      });

      const optionsByLevel = dimensions.map(
        (dimension) => new Set(dimension.options.map((option) => option.code)),
      );

      version.domains.forEach((domain, di) => {
        const domainPath = `variables[${vari}].versions[${vi}].domains[${di}]`;
        for (const range of domain.groupingRanges ?? []) {
          if (range.path.length !== dimensions.length) {
            issues.push({
              severity: 'WARNING',
              invariant: 'I19',
              path: domainPath,
              message: `O domínio "${domain.code}" da variável "${variable.code}" tem uma faixa com ${range.path.length} nível(is) de agrupamento, mas a versão tem ${dimensions.length}.`,
            });
            continue;
          }
          const unknownLevel = range.path.findIndex((code, level) => !optionsByLevel[level]!.has(code));
          if (unknownLevel >= 0) {
            issues.push({
              severity: 'WARNING',
              invariant: 'I19',
              path: domainPath,
              message: `O domínio "${domain.code}" da variável "${variable.code}" tem uma faixa em "${range.path[unknownLevel]}", que não é uma opção do agrupamento "${dimensions[unknownLevel]!.code}".`,
            });
          }
        }
      });
    });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I20 — toda entrada de Matrix.tags aponta para um CatalogItem existente de
// kind TAG, e não há repetição dentro da mesma matriz. Integridade
// referencial, não forma de domínio — por isso ERROR, não aviso (docs/03 §9).
// ---------------------------------------------------------------------------

export function checkI20(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tagCodes = new Set(doc.catalog.filter((item) => item.kind === 'TAG').map((item) => item.code));
  doc.matrices.forEach((matrix, mi) => {
    if (matrix.tags === undefined) return;
    const path = `matrices[${mi}].tags`;
    const seen = new Set<string>();
    for (const tag of matrix.tags) {
      if (!tagCodes.has(tag)) {
        issues.push({
          severity: 'ERROR',
          invariant: 'I20',
          path,
          message: `A matriz "${matrix.code}" tem a tag "${tag}", que não existe no catálogo (kind TAG).`,
        });
      }
      if (seen.has(tag)) {
        issues.push({
          severity: 'ERROR',
          invariant: 'I20',
          path,
          message: `A tag "${tag}" aparece repetida na matriz "${matrix.code}".`,
        });
      }
      seen.add(tag);
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I21 / I22 — ImportProfile: code único no documento, projectId existente,
// colunas e regras de decisão estruturalmente corretas (I21), variableId de
// cada coluna de eixo apontando para variável existente (I22). A checagem em
// si vive em `import/profile.ts` (`validateProfile`) — o motor de carga (S21)
// já a escreveu contra este mesmo contrato; aqui só se roda para todo
// `ImportProfile` do documento e se traduz `ImportIssue` em `ValidationIssue`.
// ---------------------------------------------------------------------------

function classifyProfileIssueInvariant(message: string): 'I21' | 'I22' {
  return message.includes('(I22)') ? 'I22' : 'I21';
}

function checkImportProfiles(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.importProfiles.forEach((profile, pi) => {
    const path = `importProfiles[${pi}]`;
    for (const issue of validateProfile(doc, profile)) {
      issues.push({
        severity: 'ERROR',
        invariant: classifyProfileIssueInvariant(issue.message),
        path,
        message: issue.message,
      });
    }
  });
  return issues;
}

export function checkI21(doc: PolicyOpsDocument): ValidationIssue[] {
  return checkImportProfiles(doc).filter((issue) => issue.invariant === 'I21');
}

export function checkI22(doc: PolicyOpsDocument): ValidationIssue[] {
  return checkImportProfiles(doc).filter((issue) => issue.invariant === 'I22');
}

// ---------------------------------------------------------------------------
// I10 — VariableVersion / CompatibilityVersion publicada é imutável
// (mesma checagem estrutural de I3, aplicada às bibliotecas)
// ---------------------------------------------------------------------------

export function checkI10(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.variables.forEach((variable, vari) => {
    variable.versions.forEach((version, vi) => {
      if (
        (version.state === 'PUBLISHED' || version.state === 'SUPERSEDED') &&
        (!version.publishedAt || !version.publishedBy)
      ) {
        issues.push({
          severity: 'ERROR',
          invariant: 'I10',
          path: `variables[${vari}].versions[${vi}]`,
          message: `A versão ${version.number} da variável "${variable.code}" está ${version.state} mas não tem publishedAt/publishedBy.`,
        });
      }
    });
  });
  doc.compatibility.forEach((rule, ri) => {
    rule.versions.forEach((version, vi) => {
      if (
        (version.state === 'PUBLISHED' || version.state === 'SUPERSEDED') &&
        (!version.publishedAt || !version.publishedBy)
      ) {
        issues.push({
          severity: 'ERROR',
          invariant: 'I10',
          path: `compatibility[${ri}].versions[${vi}]`,
          message: `A versão ${version.number} da regra "${rule.code}" está ${version.state} mas não tem publishedAt/publishedBy.`,
        });
      }
    });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I11 — no máximo uma versão DRAFT e uma PUBLISHED por variável e por
// regra de compatibilidade
// ---------------------------------------------------------------------------

export function checkI11(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.variables.forEach((variable, vari) => {
    const path = `variables[${vari}]`;
    const drafts = variable.versions.filter((v) => v.state === 'DRAFT');
    const published = variable.versions.filter((v) => v.state === 'PUBLISHED');
    if (drafts.length > 1) {
      issues.push({
        severity: 'ERROR',
        invariant: 'I11',
        path,
        message: `A variável "${variable.code}" tem ${drafts.length} versões em rascunho — no máximo uma é permitida.`,
      });
    }
    if (published.length > 1) {
      issues.push({
        severity: 'ERROR',
        invariant: 'I11',
        path,
        message: `A variável "${variable.code}" tem ${published.length} versões publicadas — no máximo uma é permitida.`,
      });
    }
  });
  doc.compatibility.forEach((rule, ri) => {
    const path = `compatibility[${ri}]`;
    const drafts = rule.versions.filter((v) => v.state === 'DRAFT');
    const published = rule.versions.filter((v) => v.state === 'PUBLISHED');
    if (drafts.length > 1) {
      issues.push({
        severity: 'ERROR',
        invariant: 'I11',
        path,
        message: `A regra "${rule.code}" tem ${drafts.length} versões em rascunho — no máximo uma é permitida.`,
      });
    }
    if (published.length > 1) {
      issues.push({
        severity: 'ERROR',
        invariant: 'I11',
        path,
        message: `A regra "${rule.code}" tem ${published.length} versões publicadas — no máximo uma é permitida.`,
      });
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I12 — uma única regra de compatibilidade publicada por par (parent, child)
// ---------------------------------------------------------------------------

export function checkI12(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const groups = new Map<string, number[]>();
  doc.compatibility.forEach((rule, ri) => {
    if (!rule.versions.some((v) => v.state === 'PUBLISHED')) return;
    const key = `${rule.parentVariableId}|${rule.childVariableId}`;
    const list = groups.get(key) ?? [];
    list.push(ri);
    groups.set(key, list);
  });
  for (const indices of groups.values()) {
    if (indices.length <= 1) continue;
    for (const ri of indices) {
      issues.push({
        severity: 'ERROR',
        invariant: 'I12',
        path: `compatibility[${ri}]`,
        message: `Existem ${indices.length} regras de compatibilidade publicadas para o mesmo par (parent, child).`,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// I13 — axes.*.levels tem de 1 a 3 elementos, sem variável repetida no
// mesmo eixo
// ---------------------------------------------------------------------------

export function checkI13(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.matrices.forEach((matrix, mi) => {
    matrix.versions.forEach((version, vi) => {
      (['x', 'y'] as const).forEach((role) => {
        const axis = version.axes[role];
        const path = `matrices[${mi}].versions[${vi}].axes.${role}`;
        if (axis.levels.length < 1 || axis.levels.length > 3) {
          issues.push({
            severity: 'ERROR',
            invariant: 'I13',
            path,
            message: `O eixo ${role.toUpperCase()} da versão ${version.number} da matriz "${matrix.code}" tem ${axis.levels.length} níveis — o permitido é de 1 a 3.`,
          });
        }
        const seen = new Set<string>();
        for (const level of axis.levels) {
          if (seen.has(level.variableId)) {
            issues.push({
              severity: 'ERROR',
              invariant: 'I13',
              path,
              message: `A mesma variável aparece em mais de um nível do eixo ${role.toUpperCase()} da versão ${version.number} da matriz "${matrix.code}".`,
            });
          }
          seen.add(level.variableId);
        }
      });
    });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I14 — nenhuma variável aparece nos dois eixos da mesma versão
// ---------------------------------------------------------------------------

export function checkI14(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.matrices.forEach((matrix, mi) => {
    matrix.versions.forEach((version, vi) => {
      const xVars = new Set(version.axes.x.levels.map((l) => l.variableId));
      const sharesVariable = version.axes.y.levels.some((l) => xVars.has(l.variableId));
      if (sharesVariable) {
        issues.push({
          severity: 'ERROR',
          invariant: 'I14',
          path: `matrices[${mi}].versions[${vi}]`,
          message: `A versão ${version.number} da matriz "${matrix.code}" tem a mesma variável nos eixos X e Y.`,
        });
      }
    });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I15 — tuples não tem duplicatas, e todo código de cada caminho existe
// nos domínios do nível correspondente
// ---------------------------------------------------------------------------

export function checkI15(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.matrices.forEach((matrix, mi) => {
    matrix.versions.forEach((version, vi) => {
      (['x', 'y'] as const).forEach((role) => {
        const axis = version.axes[role];
        const path = `matrices[${mi}].versions[${vi}].axes.${role}.tuples`;
        const seen = new Set<string>();
        for (const tuple of axis.tuples) {
          if (seen.has(tuple)) {
            issues.push({
              severity: 'ERROR',
              invariant: 'I15',
              path,
              message: `A tupla "${tuple}" aparece duplicada no eixo ${role.toUpperCase()}.`,
              autoFix: 'REMOVE',
            });
          }
          seen.add(tuple);

          const codes = tuple.split('|');
          if (codes.length !== axis.levels.length) {
            issues.push({
              severity: 'ERROR',
              invariant: 'I15',
              path,
              message: `A tupla "${tuple}" tem ${codes.length} código(s), mas o eixo ${role.toUpperCase()} tem ${axis.levels.length} nível(is).`,
              autoFix: 'REMOVE',
            });
            continue;
          }
          codes.forEach((code, li) => {
            const level = axis.levels[li]!;
            if (!level.domains.some((d) => d.code === code)) {
              issues.push({
                severity: 'ERROR',
                invariant: 'I15',
                path,
                message: `O código "${code}" da tupla "${tuple}" não existe nos domínios do nível ${li} (${level.label}) do eixo ${role.toUpperCase()}.`,
                autoFix: 'REMOVE',
              });
            }
          });
        }
      });
    });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I16 — xTuples.length * yTuples.length ≤ 6.000
// ---------------------------------------------------------------------------

export function checkI16(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  doc.matrices.forEach((matrix, mi) => {
    matrix.versions.forEach((version, vi) => {
      const total = version.axes.x.tuples.length * version.axes.y.tuples.length;
      if (total > 6000) {
        issues.push({
          severity: 'ERROR',
          invariant: 'I16',
          path: `matrices[${mi}].versions[${vi}]`,
          message: `A versão ${version.number} da matriz "${matrix.code}" tem ${total} combinações — o teto é 6.000.`,
        });
      }
    });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I17 — toda referência a catálogo em cells aponta para um code existente
// do kind correto
// ---------------------------------------------------------------------------

export function checkI17(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const codesByKind = (kind: CatalogItemKind) =>
    new Set(doc.catalog.filter((c) => c.kind === kind).map((c) => c.code));
  const decisionCodes = codesByKind('DECISION');
  const offerCodes = codesByKind('OFFER');
  const limitCodes = codesByKind('LIMIT');

  doc.matrices.forEach((matrix, mi) => {
    matrix.versions.forEach((version, vi) => {
      for (const [key, cell] of Object.entries(version.cells)) {
        const path = `matrices[${mi}].versions[${vi}].cells[${JSON.stringify(key)}]`;
        if (cell.decision !== undefined && !decisionCodes.has(cell.decision)) {
          issues.push({
            severity: 'ERROR',
            invariant: 'I17',
            path,
            message: `A célula referencia a decisão "${cell.decision}", que não existe no catálogo (kind DECISION).`,
            autoFix: 'CLEAR_REF',
          });
        }
        if (cell.offer !== undefined && !offerCodes.has(cell.offer)) {
          issues.push({
            severity: 'ERROR',
            invariant: 'I17',
            path,
            message: `A célula referencia a oferta "${cell.offer}", que não existe no catálogo (kind OFFER).`,
            autoFix: 'CLEAR_REF',
          });
        }
        if (cell.limit !== undefined && !limitCodes.has(cell.limit)) {
          issues.push({
            severity: 'ERROR',
            invariant: 'I17',
            path,
            message: `A célula referencia o limite "${cell.limit}", que não existe no catálogo (kind LIMIT).`,
            autoFix: 'CLEAR_REF',
          });
        }
      }
    });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// I18 — todo code é único no seu escopo
// ---------------------------------------------------------------------------

function checkUniqueCodes(
  entries: Array<{ code: string; path: string }>,
  scopeLabel: string,
  severity: IssueSeverity = 'ERROR',
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const firstSeenAt = new Map<string, string>();
  for (const entry of entries) {
    const firstPath = firstSeenAt.get(entry.code);
    if (firstPath) {
      issues.push({
        severity,
        invariant: 'I18',
        path: entry.path,
        message: `O código "${entry.code}" já está em uso em ${scopeLabel} (primeira ocorrência em ${firstPath}).`,
      });
    } else {
      firstSeenAt.set(entry.code, entry.path);
    }
  }
  return issues;
}

export function checkI18(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  issues.push(
    ...checkUniqueCodes(
      doc.variables.map((v, i) => ({ code: v.code, path: `variables[${i}]` })),
      'variáveis',
    ),
  );

  doc.variables.forEach((variable, vari) => {
    variable.versions.forEach((version, vi) => {
      issues.push(
        ...checkUniqueCodes(
          version.domains.map((d, di) => ({
            code: d.code,
            path: `variables[${vari}].versions[${vi}].domains[${di}]`,
          })),
          `domínios da versão ${version.number} de "${variable.code}"`,
          'WARNING',
        ),
      );
    });
  });

  issues.push(
    ...checkUniqueCodes(
      doc.compatibility.map((r, i) => ({ code: r.code, path: `compatibility[${i}]` })),
      'regras de compatibilidade',
    ),
  );

  (['DECISION', 'OFFER', 'LIMIT', 'TAG'] as const).forEach((kind) => {
    const entries = doc.catalog
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => item.kind === kind)
      .map(({ item, i }) => ({ code: item.code, path: `catalog[${i}]` }));
    issues.push(...checkUniqueCodes(entries, `catálogo (kind ${kind})`));
  });

  issues.push(
    ...checkUniqueCodes(
      doc.projects.map((p, i) => ({ code: p.code, path: `projects[${i}]` })),
      'projetos',
    ),
  );

  doc.projects.forEach((project) => {
    const entries = doc.matrices
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.projectId === project.id)
      .map(({ m, i }) => ({ code: m.code, path: `matrices[${i}]` }));
    issues.push(...checkUniqueCodes(entries, `matrizes do projeto "${project.code}"`));
  });

  issues.push(
    ...checkUniqueCodes(
      doc.templates.map((t, i) => ({ code: t.code, path: `templates[${i}]` })),
      'templates',
    ),
  );

  return issues;
}

// ---------------------------------------------------------------------------
// Checagem adicional (fora da tabela I1–I18): `position` 0-based sem
// buracos, convenção de docs/03-modelo-do-documento.md §1 aplicada a
// Domain, CatalogItem e Project. Usa o mesmo formato de ValidationIssue,
// com invariant: 'POSITION' e autoFix: 'RENUMBER'.
// ---------------------------------------------------------------------------

function checkPositionSequence(
  entries: Array<{ position: number; path: string }>,
  scopeLabel: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sorted = [...entries].sort((a, b) => a.position - b.position);
  sorted.forEach((entry, expected) => {
    if (entry.position !== expected) {
      issues.push({
        severity: 'ERROR',
        invariant: 'POSITION',
        path: entry.path,
        message: `A posição de ${scopeLabel} tem um buraco: esperada ${expected}, encontrada ${entry.position}. Posições devem ser 0-based e sem buracos.`,
        autoFix: 'RENUMBER',
      });
    }
  });
  return issues;
}

export function checkPositions(doc: PolicyOpsDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  issues.push(
    ...checkPositionSequence(
      doc.projects.map((p, i) => ({ position: p.position, path: `projects[${i}]` })),
      'projetos',
    ),
  );

  const catalogKinds = [...new Set(doc.catalog.map((c) => c.kind))] as CatalogItemKind[];
  for (const kind of catalogKinds) {
    issues.push(
      ...checkPositionSequence(
        doc.catalog
          .map((c, i) => ({ ...c, index: i }))
          .filter((c) => c.kind === kind)
          .map((c) => ({ position: c.position, path: `catalog[${c.index}]` })),
        `itens do catálogo do tipo ${kind}`,
      ),
    );
  }

  doc.variables.forEach((variable, vari) => {
    variable.versions.forEach((version, vi) => {
      issues.push(
        ...checkPositionSequence(
          version.domains.map((d, di) => ({
            position: d.position,
            path: `variables[${vari}].versions[${vi}].domains[${di}]`,
          })),
          `domínios da versão ${version.number} de "${variable.code}"`,
        ),
      );
    });
  });

  return issues;
}

function runAllChecks(doc: PolicyOpsDocument): ValidationIssue[] {
  return [
    ...checkI1(doc),
    ...checkI2(doc),
    ...checkI3(doc),
    ...checkI4(doc),
    ...checkI5(doc),
    ...checkI6(doc),
    ...checkI7(doc),
    ...checkI8(doc),
    ...checkI9(doc),
    ...checkI10(doc),
    ...checkI11(doc),
    ...checkI12(doc),
    ...checkI13(doc),
    ...checkI14(doc),
    ...checkI15(doc),
    ...checkI16(doc),
    ...checkI17(doc),
    ...checkI18(doc),
    ...checkI19(doc),
    ...checkI20(doc),
    ...checkImportProfiles(doc),
    ...checkPositions(doc),
  ];
}
