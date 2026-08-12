import { describe, expect, it } from 'vitest';
import { encodeCellKey } from '@/core/axes/paths';
import type { Matrix, MatrixVersion, PolicyOpsDocument } from '@/core/document/schema';
import { hashTable, planImport, projectImportAxes, type ImportPlan } from '@/core/import/plan';
import { parseDelimitedTable, type ImportTable } from '@/core/import/parse-table';
import type { ImportProfile } from '@/core/import/profile';
import {
  cineminhaDocument,
  cineminhaProfile,
  deepFreeze,
  excerptCsv,
  excerptTable,
  fixedId,
  IDS,
  publishPlan,
  tableOf,
  T0,
} from './fixtures';

const HEADER =
  'CLUSTER_GRUPO;CEP_RISCO;DS_MOD_PRC;MOD_PRC;DS_MOD_ADC;MOD_ADC;OFERTA;OFERTA_GERAL;OFERTA_DIGITAL;OFERTA_URA;OFERTA_PAP;OFERTA_OUTBOUND';

function tableFrom(...lines: string[]): ImportTable {
  const parsed = parseDelimitedTable([HEADER, ...lines].join('\n'));
  expect(parsed.errors).toEqual([]);
  return { header: parsed.header, rows: parsed.rows, lines: parsed.lines };
}

function line(options: { x?: string; modelo?: string; faixa?: string; oferta?: string } = {}): string {
  return [
    'G1',
    'd. SEM RISCO',
    'HVI3',
    options.x ?? 'R01',
    options.modelo ?? 'G1 - BHV',
    options.faixa ?? 'R01',
    ...Array<string>(6).fill(options.oferta ?? '15'),
  ].join(';');
}

/** Uma carga mínima: uma partição, um canal por coluna, duas combinações. */
function smallTable(): ImportTable {
  return tableFrom(line(), line({ x: 'R02' }));
}

function planOf(
  doc: PolicyOpsDocument,
  table = smallTable(),
  profile = cineminhaProfile(),
  restoreKeys: readonly string[] = [],
): ImportPlan {
  return planImport(doc, table, profile, { restoreKeys });
}

function byCode(plan: ImportPlan, code: string) {
  const found = plan.matrices.find((entry) => entry.code === code);
  if (found === undefined) throw new Error(`Matriz "${code}" não está no plano.`);
  return found;
}

describe('planImport — matriz nova (NEW)', () => {
  it('classifica tudo como NEW, com código, nome, tags e eixos projetados', () => {
    const plan = planOf(cineminhaDocument());
    expect(plan.totals).toEqual({
      new: 6,
      changed: 0,
      unchanged: 0,
      structural: 0,
      absentInFile: 0,
      blocked: 0,
      archived: 0,
      cellsChanged: 12,
    });
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.name).toBe('G1 · Sem Risco · Digital');
    expect(digital.tags).toEqual(['CLUSTER_G1', 'CEP_SEM_RISCO', 'CANAL_DIGITAL']);
    expect(digital.combinations).toBe(2);
    expect(digital.changes).toHaveLength(2);
    expect(digital.changes.every((change) => change.kind === 'ADDED')).toBe(true);
    expect(digital.summary.combinationsAdded).toBe(2);
    expect(digital.matrixId).toBeUndefined();
    expect(digital.axes!.x.tuples).toEqual(['R01', 'R02']);
    expect(digital.axes!.y.tuples).toEqual(['BHV_G1|R01']);
    expect(digital.axes!.x.levels[0]).toMatchObject({
      variableId: IDS.hvi3,
      variableVersionId: IDS.hvi3V1,
      label: 'Score HVI3',
    });
    expect(digital.axes!.y.compatibilityVersionIds).toEqual([IDS.compatV1]);
  });

  it('suprime as tuplas que o arquivo não observa (RN-21, CT-16)', () => {
    const plan = planOf(cineminhaDocument());
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    // O produto dos eixos daria 21 × 110; o arquivo traz 2 × 1.
    expect(digital.suppressedCombinations).toBe(19 + 109);
    expect(digital.axes!.y.manualSuppressions).toHaveLength(109);
    expect(digital.axes!.y.manualSuppressions).toContain('RESTRITIVOS|SEM_REST');
    expect(digital.missingCombinations).toEqual([]);
    expect(plan.issues.some((issue) => issue.code === 'IMPORT_TUPLES_SUPPRESSED')).toBe(true);
  });

  it('sem suppressUnobserved, o grid inteiro nasce e as pendências são listadas', () => {
    const plan = planOf(cineminhaDocument(), smallTable(), cineminhaProfile({ suppressUnobserved: false }));
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.suppressedCombinations).toBe(0);
    expect(digital.axes!.y.manualSuppressions).toEqual([]);
    expect(digital.combinations).toBe(21 * 110);
    expect(digital.missingCombinations).toHaveLength(21 * 110 - 2);
    expect(plan.issues.some((issue) => issue.code === 'IMPORT_MISSING_ROW')).toBe(true);
  });

  it('projectImportAxes devolve os eixos antes da supressão', () => {
    const axes = projectImportAxes(cineminhaDocument(), cineminhaProfile());
    expect(axes.x.tuples).toHaveLength(21);
    expect(axes.y.tuples).toHaveLength(110);
    expect(axes.y.manualSuppressions).toEqual([]);
  });
});

describe('planImport — matriz existente', () => {
  function published(): { doc: PolicyOpsDocument; plan: ImportPlan } {
    const doc = cineminhaDocument();
    const plan = planOf(doc);
    return { doc: publishPlan(doc, plan), plan };
  }

  it('volta UNCHANGED quando o conteúdo é idêntico (RN-02, RN-05)', () => {
    const { doc } = published();
    const plan = planOf(doc);
    expect(plan.totals.unchanged).toBe(6);
    expect(plan.totals.cellsChanged).toBe(0);
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.baseVersionNumber).toBe(1);
    expect(digital.matrixId).toBeDefined();
    expect(digital.axes).toBeUndefined();
    expect(digital.changes).toEqual([]);
  });

  it('marca CHANGED só a matriz cuja célula mudou, com resumo semântico', () => {
    const { doc } = published();
    const alterado = tableFrom(line(), line({ x: 'R02', oferta: '0' }));
    const plan = planOf(doc, alterado);
    expect(plan.totals.changed).toBe(6);
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.changes).toHaveLength(1);
    expect(digital.changes[0]).toMatchObject({
      kind: 'MODIFIED',
      key: encodeCellKey('R02', 'BHV_G1|R01'),
      fields: ['decision', 'offer'],
    });
    expect(digital.summary.cellsClosed).toBe(1);
    expect(digital.summary.offersChanged).toBe(1);
  });

  it('preserva o que o arquivo não traz (RN-07 KEEP) e esvazia com CLEAR', () => {
    const { doc } = published();
    // Uma observação escrita à mão na célula que o arquivo também menciona.
    const comNota = withCellNote(doc, 'MTZ_G1_SEM_RISCO_DIGITAL', encodeCellKey('R01', 'BHV_G1|R01'));
    const soUmaLinha = tableFrom(line());

    const keep = planOf(comNota, soUmaLinha);
    const digitalKeep = byCode(keep, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digitalKeep.status).toBe('UNCHANGED');
    expect(digitalKeep.missingCombinations).toEqual([encodeCellKey('R02', 'BHV_G1|R01')]);
    expect(keep.issues.some((issue) => issue.message.includes('conteúdo atual preservado'))).toBe(true);

    const clear = planOf(comNota, soUmaLinha, cineminhaProfile({ missingRowPolicy: 'CLEAR' }));
    const digitalClear = byCode(clear, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digitalClear.status).toBe('CHANGED');
    // A célula sem linha some, e a observação da célula recarregada também.
    expect(digitalClear.changes.map((change) => change.kind).sort()).toEqual(['MODIFIED', 'REMOVED']);
    expect(clear.issues.some((issue) => issue.message.includes('células esvaziadas'))).toBe(true);
  });

  it('preenche a combinação que estava em branco na versão publicada', () => {
    const { doc } = published();
    const key = encodeCellKey('R02', 'BHV_G1|R01');
    const comBuraco: PolicyOpsDocument = {
      ...doc,
      matrices: doc.matrices.map((matrix) =>
        matrix.code !== 'MTZ_G1_SEM_RISCO_DIGITAL'
          ? matrix
          : {
              ...matrix,
              versions: matrix.versions.map((version) => {
                const cells = { ...version.cells };
                delete cells[key];
                return { ...version, cells };
              }),
            },
      ),
    };
    const digital = byCode(planOf(comBuraco), 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.status).toBe('CHANGED');
    expect(digital.changes).toEqual([
      { kind: 'ADDED', key, reason: 'WAS_EMPTY', after: { offer: 'OFERTA_15', decision: 'APROVADO' } },
    ]);
  });

  it('lista como ABSENT_IN_FILE a matriz que o arquivo não cita (RN-09)', () => {
    const { doc } = published();
    const soDigital = doc.matrices.filter((matrix) => matrix.code.endsWith('DIGITAL'));
    const plan = planOf({ ...doc, matrices: soDigital }, tableFrom(line({ x: 'R03', faixa: 'R02' })));
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.status).toBe('STRUCTURAL');

    const outroArquivo = planOf(
      { ...doc, matrices: soDigital },
      tableFrom(['G2', 'd. SEM RISCO', 'HVI3', 'R01', 'G1 - BHV', 'R01', ...Array<string>(6).fill('15')].join(';')),
    );
    const ausente = byCode(outroArquivo, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(ausente.status).toBe('ABSENT_IN_FILE');
    expect(ausente.combinations).toBe(2);
    expect(ausente.baseVersionNumber).toBe(1);
    expect(outroArquivo.totals.absentInFile).toBe(1);
    expect(outroArquivo.totals.new).toBe(6);
  });

  it('usa a última versão da matriz ausente quando não há publicada, e 0 sem versão alguma', () => {
    const { doc } = published();
    const alvo = doc.matrices.find((matrix) => matrix.code.endsWith('DIGITAL'))!;
    const semPublicada: Matrix = {
      ...alvo,
      versions: alvo.versions.map((version) => ({ ...version, state: 'ARCHIVED' as const })),
    };
    const semVersao: Matrix = { ...alvo, id: fixedId('MTXVAZIA'), code: 'MTZ_VAZIA', versions: [] };
    const plan = planOf(
      { ...doc, matrices: [semPublicada, semVersao] },
      tableFrom(['G2', 'd. SEM RISCO', 'HVI3', 'R01', 'G1 - BHV', 'R01', ...Array<string>(6).fill('15')].join(';')),
    );
    expect(byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL').combinations).toBe(2);
    const vazia = byCode(plan, 'MTZ_VAZIA');
    expect(vazia).toMatchObject({ status: 'ABSENT_IN_FILE', combinations: 0 });
    expect('baseVersionId' in vazia).toBe(false);
  });
});

describe('planImport — estrutura divergente (RN-06, CT-03)', () => {
  it('bloqueia a matriz inteira e lista as linhas que produzem a tupla nova', () => {
    const doc = cineminhaDocument();
    const publicado = publishPlan(doc, planOf(doc));
    const comFaixaNova = tableFrom(line(), line({ x: 'R02' }), line({ x: 'R02', faixa: 'R05' }));
    const plan = planOf(publicado, comFaixaNova);
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.status).toBe('STRUCTURAL');
    expect(digital.unknownTuples).toEqual([
      { path: 'BHV_G1|R05', role: 'Y', lines: [4] },
    ]);
    expect(digital.reason).toContain('BHV_G1|R05');
    expect(digital.changes).toEqual([]);
    expect(plan.totals.structural).toBe(6);
  });

  it('resume as divergências quando são muitas', () => {
    const doc = cineminhaDocument();
    const publicado = publishPlan(doc, planOf(doc));
    const plan = planOf(
      publicado,
      tableFrom(
        line(),
        line({ x: 'R02' }),
        ...['R05', 'R06', 'R07', 'R08'].map((faixa) => line({ faixa })),
      ),
    );
    expect(byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL').reason).toMatch(/4 combinações.*…$/);
  });

  it('vale também para matriz nova cuja tupla a compatibilidade não gera', () => {
    const doc = cineminhaDocument();
    const semRestritivos: PolicyOpsDocument = {
      ...doc,
      compatibility: doc.compatibility.map((rule) => ({
        ...rule,
        versions: rule.versions.map((version) => ({
          ...version,
          allow: { ...version.allow, RESTRITIVOS: [] },
        })),
      })),
    };
    const plan = planOf(
      semRestritivos,
      tableFrom(line({ modelo: 'Restritivos', faixa: 'y. Sem Rest' })),
    );
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.status).toBe('STRUCTURAL');
    expect(digital.unknownTuples[0]!.path).toBe('RESTRITIVOS|SEM_REST');
  });
});

describe('planImport — matriz bloqueada (BLOCKED)', () => {
  it('bloqueia matriz com rascunho aberto (RN-15, CT-10)', () => {
    const doc = cineminhaDocument();
    const publicado = publishPlan(doc, planOf(doc));
    const comRascunho: PolicyOpsDocument = {
      ...publicado,
      matrices: publicado.matrices.map((matrix) =>
        matrix.code === 'MTZ_G1_SEM_RISCO_DIGITAL'
          ? { ...matrix, versions: [...matrix.versions, draftOf(matrix.versions[0]!)] }
          : matrix,
      ),
    };
    const plan = planOf(comRascunho, tableFrom(line({ oferta: '0' }), line({ x: 'R02' })));
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.status).toBe('BLOCKED');
    expect(digital.reason).toContain('rascunho aberto');
    expect(digital.changes).toEqual([]);
    // As demais seguem aplicáveis normalmente.
    expect(plan.totals.changed).toBe(5);
    expect(plan.totals.blocked).toBe(1);
  });

  it('bloqueia matriz sem versão publicada para servir de base', () => {
    const doc = cineminhaDocument();
    const publicado = publishPlan(doc, planOf(doc));
    const semPublicada: PolicyOpsDocument = {
      ...publicado,
      matrices: publicado.matrices.map((matrix) =>
        matrix.code === 'MTZ_G1_SEM_RISCO_DIGITAL'
          ? { ...matrix, versions: [{ ...matrix.versions[0]!, state: 'ARCHIVED' as const }] }
          : matrix,
      ),
    };
    const plan = planOf(semPublicada);
    expect(byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL').status).toBe('BLOCKED');
    expect(plan.issues.some((issue) => issue.code === 'IMPORT_NO_BASE_VERSION')).toBe(true);
  });

  it('bloqueia matriz nova que estouraria o teto de 6.000 combinações (I16)', () => {
    // 60 faixas de score × 110 tuplas de modelo = 6.600 combinações.
    const doc = cineminhaDocument();
    const grande: PolicyOpsDocument = {
      ...doc,
      variables: doc.variables.map((variable) =>
        variable.id === IDS.hvi3
          ? {
              ...variable,
              versions: variable.versions.map((version) => ({
                ...version,
                domains: Array.from({ length: 60 }, (_unused, position) => ({
                  code: `R${String(position + 1).padStart(2, '0')}`,
                  label: `R${position + 1}`,
                  position,
                })),
              })),
            }
          : variable,
      ),
    };
    const plan = planOf(grande, smallTable(), cineminhaProfile({ suppressUnobserved: false }));
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.status).toBe('BLOCKED');
    expect(digital.combinations).toBe(60 * 110);
    expect(digital.reason).toContain('6000');
    expect(plan.totals.blocked).toBe(6);
  });

  it('bloqueia as matrizes novas quando a compatibilidade não deixa nenhuma tupla de pé', () => {
    const doc = cineminhaDocument();
    const semNada: PolicyOpsDocument = {
      ...doc,
      compatibility: doc.compatibility.map((rule) => ({
        ...rule,
        versions: rule.versions.map((version) => ({ ...version, allow: {} })),
      })),
    };
    const plan = planOf(semNada);
    expect(plan.totals.blocked).toBe(6);
    expect(byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL').reason).toContain('Nenhuma combinação válida');
  });

  it('projectImportAxes acusa a variável sem versão publicada', () => {
    const doc = cineminhaDocument();
    const rascunho: PolicyOpsDocument = {
      ...doc,
      variables: doc.variables.map((variable) =>
        variable.id === IDS.hvi3
          ? {
              ...variable,
              versions: variable.versions.map((version) => ({ ...version, state: 'DRAFT' as const })),
            }
          : variable,
      ),
    };
    expect(() => projectImportAxes(rascunho, cineminhaProfile())).toThrow('não tem versão publicada');
    const profile = cineminhaProfile({
      columns: cineminhaProfile().columns.map((column) =>
        column.column === 'MOD_PRC'
          ? { ...column, axis: { role: 'X' as const, level: 0, variableId: 'FANTASMA____' } }
          : column,
      ),
    });
    expect(() => projectImportAxes(doc, profile)).toThrow('não tem versão publicada');
  });

  it('bloqueia quando a variável do eixo não tem versão publicada', () => {
    const doc = cineminhaDocument();
    const rascunho: PolicyOpsDocument = {
      ...doc,
      variables: doc.variables.map((variable) =>
        variable.id === IDS.hvi3
          ? {
              ...variable,
              versions: [
                { ...variable.versions[0]!, state: 'PUBLISHED' as const },
                { ...variable.versions[0]!, id: fixedId('VHVI3V2'), number: 2, state: 'DRAFT' as const },
              ],
            }
          : variable,
      ),
    };
    // Com a publicada presente, o plano segue normal.
    expect(planOf(rascunho).totals.new).toBe(6);

    const semPublicada: PolicyOpsDocument = {
      ...doc,
      variables: doc.variables.map((variable) =>
        variable.id === IDS.hvi3
          ? {
              ...variable,
              versions: variable.versions.map((version) => ({ ...version, state: 'DRAFT' as const })),
            }
          : variable,
      ),
    };
    const plan = planOf(semPublicada);
    // Sem versão publicada, o valor do eixo nem chega a ser mapeado.
    expect(plan.matrices).toEqual([]);
    expect(plan.issues.some((issue) => issue.code === 'IMPORT_PROFILE_INVALID')).toBe(true);
  });

});

describe('planImport — matriz arquivada (ARCHIVED, DEC-CARGA-018)', () => {
  function archive(doc: PolicyOpsDocument, code: string): PolicyOpsDocument {
    return {
      ...doc,
      matrices: doc.matrices.map((matrix) =>
        matrix.code === code ? { ...matrix, archivedAt: '2026-03-01T00:00:00.000Z' } : matrix,
      ),
    };
  }

  it('sem confirmação de restauração, fica ARCHIVED — o código continua ocupado', () => {
    const doc = cineminhaDocument();
    const publicado = publishPlan(doc, planOf(doc));
    const arquivada = archive(publicado, 'MTZ_G1_SEM_RISCO_DIGITAL');

    const plan = planOf(arquivada);
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.status).toBe('ARCHIVED');
    expect(digital.archived).toBe(true);
    expect(digital.reason).toContain('arquivada');
    expect(digital.changes).toEqual([]);
    expect(plan.totals.archived).toBe(1);
    expect(plan.totals.blocked).toBe(0);
    // As demais seguem aplicáveis normalmente — mesmo arquivo já publicado,
    // sem mudança nenhuma.
    expect(plan.totals.unchanged).toBe(5);
  });

  it('selecionar a chave sem confirmar restaurar não muda o status (defesa contra revivência acidental)', () => {
    const doc = cineminhaDocument();
    const publicado = publishPlan(doc, planOf(doc));
    const arquivada = archive(publicado, 'MTZ_G1_SEM_RISCO_DIGITAL');
    const key = byCode(planOf(arquivada), 'MTZ_G1_SEM_RISCO_DIGITAL').key;

    // `restoreKeys` com uma chave de outra matriz não desarquiva a nossa.
    const outra = byCode(planOf(arquivada), 'MTZ_G1_SEM_RISCO_GERAL').key;
    const plan = planOf(arquivada, undefined, undefined, [outra]);
    expect(byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL').status).toBe('ARCHIVED');
    expect(key).not.toBe(outra);
  });

  it('com restoreKeys confirmando a chave, volta a comparar como matriz existente (CHANGED)', () => {
    const doc = cineminhaDocument();
    const publicado = publishPlan(doc, planOf(doc));
    const arquivada = archive(publicado, 'MTZ_G1_SEM_RISCO_DIGITAL');
    const key = byCode(planOf(arquivada), 'MTZ_G1_SEM_RISCO_DIGITAL').key;

    const plan = planOf(arquivada, tableFrom(line({ oferta: '0' }), line({ x: 'R02' })), undefined, [key]);
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.status).toBe('CHANGED');
    expect(digital.archived).toBe(true);
    expect(digital.changes.length).toBeGreaterThan(0);
    expect(plan.totals.archived).toBe(0);
  });

  it('com restoreKeys e conteúdo idêntico, volta UNCHANGED — mas ainda marcada para restaurar', () => {
    const doc = cineminhaDocument();
    const publicado = publishPlan(doc, planOf(doc));
    const arquivada = archive(publicado, 'MTZ_G1_SEM_RISCO_DIGITAL');
    const key = byCode(planOf(arquivada), 'MTZ_G1_SEM_RISCO_DIGITAL').key;

    const plan = planOf(arquivada, smallTable(), undefined, [key]);
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.status).toBe('UNCHANGED');
    expect(digital.archived).toBe(true);
  });

  it('restaurar muda o planHash — um plano revisado sem restauração não aplica por engano', () => {
    const doc = cineminhaDocument();
    const publicado = publishPlan(doc, planOf(doc));
    const arquivada = archive(publicado, 'MTZ_G1_SEM_RISCO_DIGITAL');
    const key = byCode(planOf(arquivada), 'MTZ_G1_SEM_RISCO_DIGITAL').key;

    const semRestaurar = planOf(arquivada);
    const comRestaurar = planOf(arquivada, undefined, undefined, [key]);
    expect(semRestaurar.planHash).not.toBe(comRestaurar.planHash);
  });
});

describe('planImport — matriz arquivada que nunca foi publicada (DEC-CARGA-019)', () => {
  /** Simula o rascunho descartado antes de publicar: a única versão vira ARCHIVED, sem PUBLISHED nenhuma. */
  function archiveNeverPublished(doc: PolicyOpsDocument, code: string): PolicyOpsDocument {
    return {
      ...doc,
      matrices: doc.matrices.map((matrix) =>
        matrix.code === code
          ? {
              ...matrix,
              archivedAt: '2026-03-01T00:00:00.000Z',
              versions: [{ ...matrix.versions[0]!, state: 'ARCHIVED' as const }],
            }
          : matrix,
      ),
    };
  }

  it('sem restoreKeys, fica ARCHIVED normalmente — mesmo sem versão publicada', () => {
    const doc = cineminhaDocument();
    const publicado = publishPlan(doc, planOf(doc));
    const arquivada = archiveNeverPublished(publicado, 'MTZ_G1_SEM_RISCO_DIGITAL');

    const plan = planOf(arquivada);
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.status).toBe('ARCHIVED');
    expect(digital.archived).toBe(true);
  });

  it('com restoreKeys confirmando, projeta eixos frescos e vira NEW — nunca mais trava em IMPORT_NO_BASE_VERSION', () => {
    const doc = cineminhaDocument();
    const publicado = publishPlan(doc, planOf(doc));
    const arquivada = archiveNeverPublished(publicado, 'MTZ_G1_SEM_RISCO_DIGITAL');
    const key = byCode(planOf(arquivada), 'MTZ_G1_SEM_RISCO_DIGITAL').key;

    const plan = planOf(arquivada, smallTable(), undefined, [key]);
    const digital = byCode(plan, 'MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.status).toBe('NEW');
    expect(digital.archived).toBe(true);
    expect(digital.matrixId).toBeDefined();
    expect(digital.axes).toBeDefined();
    expect(digital.combinations).toBeGreaterThan(0);
    expect(plan.issues.some((issue) => issue.code === 'IMPORT_NO_BASE_VERSION')).toBe(false);
  });
});

describe('planImport — plano bloqueado por erro', () => {
  it('não classifica matriz alguma quando o perfil é inválido', () => {
    const plan = planOf(cineminhaDocument(), smallTable(), cineminhaProfile({ projectId: 'FANTASMA____' }));
    expect(plan.matrices).toEqual([]);
    expect(plan.libraryGaps).toEqual([]);
    expect(plan.totals.new).toBe(0);
    expect(plan.issues[0]!.code).toBe('IMPORT_PROFILE_INVALID');
  });

  it('não classifica matriz alguma quando há valor não mapeado, mas já descreve a biblioteca', () => {
    const plan = planOf(cineminhaDocument(), tableFrom(line({ faixa: 'R30' })));
    expect(plan.matrices).toEqual([]);
    expect(plan.issues.some((issue) => issue.code === 'IMPORT_UNMAPPED_VALUE')).toBe(true);
    expect(plan.libraryGaps.length).toBeGreaterThan(0);
  });

  it('acusa colisão de código entre chaves diferentes', () => {
    const plan = planOf(
      cineminhaDocument(),
      tableFrom(line(), ['G2', 'd. SEM RISCO', 'HVI3', 'R01', 'G1 - BHV', 'R01', ...Array<string>(6).fill('15')].join(';')),
      cineminhaProfile({ codeTemplate: 'MTZ_{CEP_RISCO}_{CANAL}' }),
    );
    expect(plan.matrices).toEqual([]);
    expect(plan.issues.some((issue) => issue.message.includes('gera o mesmo código'))).toBe(true);
  });

  it('acusa coluna do perfil que o arquivo não tem', () => {
    const table = tableFrom(line());
    const semColuna: ImportTable = {
      header: table.header.filter((name) => name !== 'MOD_ADC'),
      rows: table.rows.map((row) => row.filter((_unused, index) => index !== 5)),
      lines: table.lines,
    };
    const plan = planOf(cineminhaDocument(), semColuna);
    expect(plan.issues[0]!.message).toContain('MOD_ADC');
    expect(plan.matrices).toEqual([]);
  });
});

describe('planImport — hashes (RN-14, RN-20)', () => {
  const doc = cineminhaDocument();

  it('é estável entre duas leituras iguais e muda com o arquivo', () => {
    const primeiro = planOf(doc);
    expect(planOf(doc).planHash).toBe(primeiro.planHash);
    expect(planOf(doc).source.contentHash).toBe(primeiro.source.contentHash);

    const outro = planOf(doc, tableFrom(line(), line({ x: 'R02', oferta: '0' })));
    expect(outro.source.contentHash).not.toBe(primeiro.source.contentHash);
    expect(outro.planHash).not.toBe(primeiro.planHash);
  });

  it('muda quando o documento muda o suficiente para mudar o plano', () => {
    const primeiro = planOf(doc);
    const publicado = publishPlan(doc, primeiro);
    expect(planOf(publicado).planHash).not.toBe(primeiro.planHash);
  });

  it('muda quando o perfil muda', () => {
    expect(planOf(doc).planHash).not.toBe(
      planOf(doc, smallTable(), cineminhaProfile({ suppressUnobserved: false })).planHash,
    );
  });

  it('aceita o hash do texto do arquivo informado pelo chamador (RN-20)', () => {
    const plan = planImport(doc, smallTable(), cineminhaProfile(), {
      fileName: 'CINEMINHA.csv',
      contentHash: 'abc123',
    });
    expect(plan.source).toEqual({ fileName: 'CINEMINHA.csv', rowCount: 2, contentHash: 'abc123' });
    expect(plan.profileCode).toBe('CARGA_CINEMINHA');
  });

  it('hashTable independe de BOM, CRLF e do separador', () => {
    const csv = excerptCsv();
    const comCrlf = `\u{FEFF}${csv.replace(/\n/g, '\r\n')}`;
    expect(hashTable(tableOf(comCrlf))).toBe(hashTable(tableOf(csv)));
    const comVirgula = csv.replace(/;/g, ',');
    expect(hashTable(tableOf(comVirgula))).toBe(hashTable(tableOf(csv)));
  });
});

describe('planImport — pureza (RN-13)', () => {
  it('não escreve no documento, nem com ele congelado', () => {
    const doc = deepFreeze(cineminhaDocument());
    const antes = JSON.stringify(doc);
    const plan = planImport(doc, excerptTable(), cineminhaProfile(), { fileName: 'recorte.csv' });
    expect(plan.totals.new).toBe(18);
    expect(JSON.stringify(doc)).toBe(antes);

    const publicado = deepFreeze(publishPlan(cineminhaDocument(), plan));
    const antesPublicado = JSON.stringify(publicado);
    expect(planImport(publicado, excerptTable(), cineminhaProfile()).totals.unchanged).toBe(18);
    expect(JSON.stringify(publicado)).toBe(antesPublicado);
  });
});

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

function draftOf(base: MatrixVersion): MatrixVersion {
  return {
    ...base,
    id: fixedId('MVDRAFT'),
    number: base.number + 1,
    state: 'DRAFT',
    baseVersionId: base.id,
    publishedAt: undefined,
    publishedBy: undefined,
    effectiveFrom: undefined,
  };
}

function withCellNote(doc: PolicyOpsDocument, code: string, key: string): PolicyOpsDocument {
  return {
    ...doc,
    matrices: doc.matrices.map((matrix) =>
      matrix.code !== code
        ? matrix
        : {
            ...matrix,
            versions: matrix.versions.map((version) => ({
              ...version,
              cells: { ...version.cells, [key]: { ...version.cells[key], note: 'revisar' } },
            })),
          },
    ),
  };
}

describe('fixtures', () => {
  it('o documento de teste tem a biblioteca de §8.3 e nenhuma matriz', () => {
    const doc = cineminhaDocument();
    expect(doc.matrices).toEqual([]);
    expect(doc.meta.createdAt).toBe(T0);
    expect(doc.variables.map((variable) => variable.code)).toEqual([
      'SCORE_HVI3',
      'MODELO_ADICIONAL',
      'FAIXA_MODELO_ADICIONAL',
    ]);
  });

  it('o perfil de teste é o CARGA_CINEMINHA de §8', () => {
    const profile: ImportProfile = cineminhaProfile();
    expect(profile.code).toBe('CARGA_CINEMINHA');
    expect(profile.unpivot!.options).toHaveLength(6);
  });
});
