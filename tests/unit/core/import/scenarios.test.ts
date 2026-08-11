import { describe, expect, it } from 'vitest';
import { encodeCellKey } from '@/core/axes/paths';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { planImport, type ImportPlan } from '@/core/import/plan';
import { resolveImport } from '@/core/import/resolve';
import { parseDelimitedTable } from '@/core/import/parse-table';
import { matchImportProfile } from '@/core/import/profile';
import {
  cineminhaDocument,
  cineminhaProfile,
  editCsvCell,
  excerptCsv,
  excerptTable,
  fullCsv,
  publishPlan,
  tableOf,
} from './fixtures';

/**
 * Os cenários de docs/12-carga-de-matrizes.md §3, sobre o recorte real do
 * `CINEMINHA_20260708.csv` e sobre o arquivo inteiro.
 */

const profile = cineminhaProfile();

function planOfCsv(doc: PolicyOpsDocument, csv: string, fileName = 'recorte.csv'): ImportPlan {
  return planImport(doc, tableOf(csv), profile, { fileName });
}

/** Documento com o recorte já carregado e publicado. */
function loadedDocument(): PolicyOpsDocument {
  const doc = cineminhaDocument();
  return publishPlan(doc, planImport(doc, excerptTable(), profile));
}

describe('CT-01 — segunda carga do mesmo arquivo não muda nada', () => {
  it('devolve tudo INALTERADA, com zero células alteradas', () => {
    const plan = planOfCsv(loadedDocument(), excerptCsv());
    expect(plan.totals.unchanged).toBe(18);
    expect(plan.totals.changed).toBe(0);
    expect(plan.totals.new).toBe(0);
    expect(plan.totals.cellsChanged).toBe(0);
    expect(plan.matrices.every((entry) => entry.changes.length === 0)).toBe(true);
  });
});

describe('CT-02 — só a matriz alterada é versionada', () => {
  it('uma célula do arquivo produz uma matriz ALTERADA com uma alteração', () => {
    // Linha 2 do recorte: G1 · Sem Risco, R01 × BHV_G1|R01, canal Digital.
    const alterado = editCsvCell(excerptCsv(), 2, 'OFERTA_DIGITAL', '0');
    const plan = planOfCsv(loadedDocument(), alterado);

    expect(plan.totals.changed).toBe(1);
    expect(plan.totals.unchanged).toBe(17);
    expect(plan.totals.cellsChanged).toBe(1);

    const digital = plan.matrices.find((entry) => entry.status === 'CHANGED')!;
    expect(digital.code).toBe('MTZ_G1_SEM_RISCO_DIGITAL');
    expect(digital.baseVersionNumber).toBe(1);
    expect(digital.changes).toHaveLength(1);
    expect(digital.changes[0]).toMatchObject({
      kind: 'MODIFIED',
      key: encodeCellKey('R01', 'BHV_G1|R01'),
      before: { offer: 'OFERTA_15', decision: 'APROVADO' },
      after: { offer: 'OFERTA_0', decision: 'REPROVADO' },
      fields: ['decision', 'offer'],
    });
    expect(digital.summary).toMatchObject({ cellsClosed: 1, offersChanged: 1, cellsOpened: 0 });
  });
});

describe('CT-03 — linha do arquivo fora da estrutura do eixo', () => {
  it('deixa a matriz ESTRUTURA DIVERGENTE sem afetar as outras', () => {
    const doc = loadedDocument();
    // O recorte de G6 usa HVI4 com R01 e R99; R26 não existe na variável nem no eixo.
    const comR26 = `${excerptCsv().trimEnd()}\nG6;c.RISCO ALTO;HVI3;R01;HVI4;R21;15;15;15;15;15;15\n`;
    const plan = planOfCsv(doc, comR26);

    const divergentes = plan.matrices.filter((entry) => entry.status === 'STRUCTURAL');
    expect(divergentes).toHaveLength(6);
    expect(divergentes[0]!.code).toContain('MTZ_G6_RISCO_ALTO_');
    expect(divergentes[0]!.unknownTuples).toEqual([
      { path: 'SCORE_HVI4|R21', role: 'Y', lines: [233] },
    ]);
    expect(divergentes[0]!.changes).toEqual([]);
    expect(plan.totals.unchanged).toBe(12);
  });
});

describe('CT-04 — combinação do grid sem linha no arquivo', () => {
  it('preserva as células sem linha e avisa quantas são', () => {
    const doc = loadedDocument();
    const semUltimaLinha = excerptCsv()
      .trimEnd()
      .split('\n')
      .slice(0, -1)
      .join('\n');
    const plan = planOfCsv(doc, semUltimaLinha);

    expect(plan.totals.changed).toBe(0);
    expect(plan.totals.unchanged).toBe(18);
    const g6 = plan.matrices.find((entry) => entry.code === 'MTZ_G6_RISCO_ALTO_DIGITAL')!;
    expect(g6.missingCombinations).toHaveLength(1);
    const aviso = plan.issues.find(
      (issue) => issue.code === 'IMPORT_MISSING_ROW' && issue.message.includes('MTZ_G6_RISCO_ALTO_DIGITAL'),
    );
    expect(aviso!.message).toContain('conteúdo atual preservado');
  });
});

describe('CT-05 e CT-06 — chave duplicada', () => {
  const duplicada = (oferta: string): string =>
    `${excerptCsv().trimEnd()}\nG1;d. SEM RISCO;HVI3;R01;G1 - BHV;R01;${oferta};15;15;15;15;15\n`;

  it('CT-05: conteúdo divergente é erro e nenhuma matriz fica aplicável', () => {
    const plan = planOfCsv(cineminhaDocument(), duplicada('0'));
    const erros = plan.issues.filter((issue) => issue.code === 'IMPORT_DUPLICATE_KEY');
    expect(erros).toHaveLength(1);
    expect(erros[0]!.details).toMatchObject({ lines: [2, 233] });
    expect(plan.matrices).toEqual([]);
    expect(plan.totals.new).toBe(0);
  });

  it('CT-06: conteúdo idêntico é aviso, e a linha conta uma vez só', () => {
    const plan = planOfCsv(cineminhaDocument(), duplicada('15'));
    expect(plan.issues.every((issue) => issue.severity === 'WARNING')).toBe(true);
    expect(plan.issues.filter((issue) => issue.code === 'IMPORT_DUPLICATE_ROW')).toHaveLength(6);
    expect(plan.totals.new).toBe(18);
    expect(plan.totals.cellsChanged).toBe(231 * 6);
  });
});

describe('CT-07 — valor de eixo não mapeado bloqueia o plano', () => {
  it('nomeia a coluna, o valor e a primeira linha', () => {
    const comR30 = editCsvCell(excerptCsv(), 2, 'MOD_ADC', 'R30');
    const plan = planOfCsv(cineminhaDocument(), comR30);
    const erro = plan.issues.find((issue) => issue.code === 'IMPORT_UNMAPPED_VALUE')!;
    expect(erro.column).toBe('MOD_ADC');
    expect(erro.details).toMatchObject({ value: 'R30' });
    expect(erro.line).toBe(2);
    expect(plan.matrices).toEqual([]);
  });
});

describe('CT-08 — decisão derivada da oferta', () => {
  it('0 vira REPROVADO, 15 vira APROVADO, e nenhuma célula fica sem decisão', () => {
    const comZeroNaUra = editCsvCell(excerptCsv(), 2, 'OFERTA_URA', '0');
    const table = tableOf(comZeroNaUra);
    const resolved = resolveImport(cineminhaDocument(), table, profile);
    const primeiraLinha = resolved.rows.filter((row) => row.source.line === 2);
    expect(primeiraLinha).toHaveLength(6);
    const ura = primeiraLinha.find((row) => row.matrixKey.endsWith('URA'))!;
    expect(ura.cell).toEqual({ offer: 'OFERTA_0', decision: 'REPROVADO' });
    const teto = primeiraLinha.find((row) => row.matrixKey.endsWith('TETO'))!;
    expect(teto.cell).toEqual({ offer: 'OFERTA_15', decision: 'APROVADO' });
    expect(resolved.rows.every((row) => row.cell.decision !== undefined)).toBe(true);
  });
});

describe('CT-09 — desdobramento das colunas de valor', () => {
  it('cada linha produz seis células, e o arquivo real produz 102 matrizes', () => {
    const table = tableOf(fullCsv());
    const plan = planImport(cineminhaDocument(), table, profile, { fileName: 'CINEMINHA_20260708.csv' });
    expect(table.rows).toHaveLength(6678);
    expect(plan.matrices).toHaveLength(102);
    expect(plan.totals.new).toBe(102);
    expect(plan.totals.cellsChanged).toBe(40068);
    const digital = plan.matrices.find((entry) => entry.code === 'MTZ_G4_RISCO_ALTO_DIGITAL')!;
    expect(digital.combinations).toBe(567);
    expect(digital.axes!.x.tuples).toHaveLength(21);
    expect(digital.axes!.y.tuples).toHaveLength(27);
  });
});

describe('CT-10 — matriz com rascunho aberto', () => {
  it('fica BLOQUEADA e as demais seguem aplicáveis', () => {
    const doc = loadedDocument();
    const alvo = doc.matrices.find((matrix) => matrix.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    const comRascunho: PolicyOpsDocument = {
      ...doc,
      matrices: doc.matrices.map((matrix) =>
        matrix.id !== alvo.id
          ? matrix
          : {
              ...matrix,
              versions: [
                ...matrix.versions,
                {
                  ...alvo.versions[0]!,
                  id: 'DRAFTG1DIGIT',
                  number: 2,
                  state: 'DRAFT' as const,
                  baseVersionId: alvo.versions[0]!.id,
                },
              ],
            },
      ),
    };
    const alterado = editCsvCell(excerptCsv(), 2, 'OFERTA_DIGITAL', '0');
    const plan = planOfCsv(comRascunho, alterado);
    const digital = plan.matrices.find((entry) => entry.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    expect(digital.status).toBe('BLOCKED');
    expect(digital.reason).toContain('publique-o ou descarte-o');
    expect(plan.totals.blocked).toBe(1);
    expect(plan.totals.unchanged).toBe(17);
  });
});

describe('CT-16 — matriz nova nasce sem pendência artificial (RN-21)', () => {
  it('o eixo Y do G1 nasce com as tuplas observadas e o resto suprimido', () => {
    const plan = planImport(cineminhaDocument(), excerptTable(), profile);
    const g1 = plan.matrices.find((entry) => entry.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    // O recorte de G1 traz o BHV do G1 (R01, R02) e os dois restritivos.
    expect(g1.axes!.y.tuples).toEqual([
      'BHV_G1|R01',
      'BHV_G1|R02',
      'RESTRITIVOS|SEM_REST',
      'RESTRITIVOS|COM_REST',
    ]);
    expect(g1.axes!.y.manualSuppressions).toHaveLength(106);
    expect(g1.suppressedCombinations).toBe(106);
    expect(g1.combinations).toBe(21 * 4);
    // Zero combinações pendentes: a matriz nasce publicável (I6).
    expect(g1.missingCombinations).toEqual([]);
    expect(g1.changes).toHaveLength(21 * 4);
    expect(
      plan.issues.some(
        (issue) =>
          issue.code === 'IMPORT_TUPLES_SUPPRESSED' &&
          issue.message.includes('MTZ_G1_SEM_RISCO_DIGITAL') &&
          issue.message.includes('106 combinações marcadas como inexistentes'),
      ),
    ).toBe(true);
  });

  it('no arquivo inteiro, o G1 fica com 22 tuplas de Y e 88 suprimidas', () => {
    const plan = planImport(cineminhaDocument(), tableOf(fullCsv()), profile);
    const g1 = plan.matrices.find((entry) => entry.code === 'MTZ_G1_SEM_RISCO_DIGITAL')!;
    expect(g1.axes!.y.tuples).toHaveLength(22);
    expect(g1.axes!.y.manualSuppressions).toHaveLength(88);
    expect(g1.missingCombinations).toEqual([]);
    const g4 = plan.matrices.find((entry) => entry.code === 'MTZ_G4_RISCO_ALTO_DIGITAL')!;
    expect(g4.axes!.y.manualSuppressions).toHaveLength(83);
  });
});

describe('critérios de aceite da sessão', () => {
  it('o arquivo real, aplicado sobre si mesmo, volta todo INALTERADO', () => {
    const doc = cineminhaDocument();
    const table = tableOf(fullCsv());
    const publicado = publishPlan(doc, planImport(doc, table, profile));
    const segunda = planImport(publicado, table, profile);
    expect(segunda.totals.unchanged).toBe(102);
    expect(segunda.totals.cellsChanged).toBe(0);
    expect(segunda.totals.changed).toBe(0);
    expect(segunda.totals.blocked).toBe(0);
  });

  it('reconhece o perfil pelo cabeçalho do arquivo real (RN-19)', () => {
    const header = parseDelimitedTable(fullCsv()).header;
    const doc = { ...cineminhaDocument(), importProfiles: [profile] };
    expect(matchImportProfile(doc, header)?.code).toBe('CARGA_CINEMINHA');
  });

  it('lê o mesmo conteúdo com BOM, CRLF e outro separador', () => {
    const csv = excerptCsv();
    const variantes = [
      csv,
      `\u{FEFF}${csv.replace(/\n/g, '\r\n')}`,
      csv.replace(/;/g, '\t'),
      csv.replace(/;/g, '|'),
    ];
    const planos = variantes.map((texto) => planImport(cineminhaDocument(), tableOf(texto), profile));
    for (const plan of planos) {
      expect(plan.totals.new).toBe(18);
      expect(plan.source.contentHash).toBe(planos[0]!.source.contentHash);
      expect(plan.planHash).toBe(planos[0]!.planHash);
    }
  });
});
