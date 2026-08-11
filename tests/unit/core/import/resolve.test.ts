import { describe, expect, it } from 'vitest';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { parseDelimitedTable, type ImportTable } from '@/core/import/parse-table';
import { resolveImport } from '@/core/import/resolve';
import type { ColumnMapping, ImportProfile } from '@/core/import/profile';
import { cineminhaDocument, cineminhaProfile, excerptTable, IDS } from './fixtures';

const HEADER =
  'CLUSTER_GRUPO;CEP_RISCO;DS_MOD_PRC;MOD_PRC;DS_MOD_ADC;MOD_ADC;OFERTA;OFERTA_GERAL;OFERTA_DIGITAL;OFERTA_URA;OFERTA_PAP;OFERTA_OUTBOUND';

function tableFrom(...lines: string[]): ImportTable {
  const parsed = parseDelimitedTable([HEADER, ...lines].join('\n'));
  expect(parsed.errors).toEqual([]);
  return { header: parsed.header, rows: parsed.rows, lines: parsed.lines };
}

/** Uma linha do arquivo real, com as seis ofertas informadas. */
function row(options: {
  cluster?: string;
  cep?: string;
  check?: string;
  x?: string;
  modelo?: string;
  faixa?: string;
  offers?: string[];
} = {}): string {
  const offers = options.offers ?? ['15', '15', '15', '15', '15', '15'];
  return [
    options.cluster ?? 'G1',
    options.cep ?? 'd. SEM RISCO',
    options.check ?? 'HVI3',
    options.x ?? 'R01',
    options.modelo ?? 'G1 - BHV',
    options.faixa ?? 'R01',
    ...offers,
  ].join(';');
}

function codesOf(issues: { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe('resolveImport — a célula da carga', () => {
  const doc = cineminhaDocument();

  it('desdobra cada linha em seis células, uma por canal (CT-09)', () => {
    const result = resolveImport(doc, tableFrom(row()), cineminhaProfile());
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(6);
    expect(result.keys.map((key) => key.key)).toEqual([
      'G1|SEM_RISCO|TETO',
      'G1|SEM_RISCO|GERAL',
      'G1|SEM_RISCO|DIGITAL',
      'G1|SEM_RISCO|URA',
      'G1|SEM_RISCO|PAP',
      'G1|SEM_RISCO|OUTBOUND',
    ]);
    expect(result.rows[0]).toMatchObject({
      matrixKey: 'G1|SEM_RISCO|TETO',
      xPath: 'R01',
      yPath: 'BHV_G1|R01',
      cell: { offer: 'OFERTA_15', decision: 'APROVADO' },
      source: { line: 2, column: 'OFERTA' },
    });
    expect(result.keys[0]!.labels).toEqual({
      CLUSTER_GRUPO: 'G1',
      CEP_RISCO: 'Sem Risco',
      CANAL: 'Teto da política',
    });
  });

  it('deriva a decisão da oferta, canal a canal (CT-08)', () => {
    const result = resolveImport(
      doc,
      tableFrom(row({ offers: ['15', '12', '8', '0', '5', '3'] })),
      cineminhaProfile(),
    );
    const byChannel = Object.fromEntries(result.rows.map((entry) => [entry.matrixKey, entry.cell]));
    expect(byChannel['G1|SEM_RISCO|URA']).toEqual({ offer: 'OFERTA_0', decision: 'REPROVADO' });
    expect(byChannel['G1|SEM_RISCO|TETO']).toEqual({ offer: 'OFERTA_15', decision: 'APROVADO' });
    expect(result.rows.every((entry) => entry.cell.decision !== undefined)).toBe(true);
  });

  it('não produz célula para canal com coluna vazia', () => {
    const result = resolveImport(
      doc,
      tableFrom(row({ offers: ['15', '', '15', '15', '15', '15'] })),
      cineminhaProfile(),
    );
    expect(result.rows).toHaveLength(5);
    expect(result.rows.some((entry) => entry.matrixKey.endsWith('GERAL'))).toBe(false);
  });

  it('avisa quando a coluna de conferência diverge, uma vez por valor', () => {
    const result = resolveImport(
      doc,
      tableFrom(row({ check: 'HVI5' }), row({ check: 'HVI5', x: 'R02' })),
      cineminhaProfile(),
    );
    expect(codesOf(result.issues)).toEqual(['IMPORT_CHECK_MISMATCH']);
    expect(result.issues[0]!.line).toBe(2);
    expect(result.issues[0]!.details).toMatchObject({ expected: 'HVI3', found: 'HVI5', occurrences: 2 });
    expect(result.rows).toHaveLength(12);
  });

  it('descarta a linha inteira quando um valor está na lista de ignorados', () => {
    const profile = cineminhaProfile({
      columns: cineminhaProfile().columns.map((column) =>
        column.column === 'DS_MOD_ADC' ? { ...column, ignoredValues: ['Sem modelo'] } : column,
      ),
    });
    const result = resolveImport(
      doc,
      tableFrom(row(), row({ modelo: 'Sem modelo', x: 'R02' })),
      profile,
    );
    expect(result.ignoredRows).toBe(1);
    expect(result.rows).toHaveLength(6);
    expect(codesOf(result.issues)).toEqual(['IMPORT_ROW_IGNORED']);
    expect(result.issues[0]!.line).toBe(3);
  });
});

describe('resolveImport — valores sem mapeamento (RN-16, CT-07)', () => {
  const doc = cineminhaDocument();

  it('bloqueia valor de eixo inexistente na variável, nomeando coluna, valor e primeira linha', () => {
    const result = resolveImport(
      doc,
      tableFrom(row({ faixa: 'R30' }), row({ faixa: 'R30', x: 'R02' }), row()),
      cineminhaProfile(),
    );
    const unmapped = result.issues.filter((issue) => issue.code === 'IMPORT_UNMAPPED_VALUE');
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]!.severity).toBe('ERROR');
    expect(unmapped[0]!.column).toBe('MOD_ADC');
    expect(unmapped[0]!.line).toBe(2);
    expect(unmapped[0]!.details).toMatchObject({ value: 'R30', occurrences: 2 });
    // As linhas boas continuam resolvidas; quem bloqueia o plano é o erro.
    expect(result.rows).toHaveLength(6);
  });

  it('bloqueia valor de partição que não vira código', () => {
    const result = resolveImport(doc, tableFrom(row({ cluster: '...' })), cineminhaProfile());
    expect(codesOf(result.issues)).toEqual(['IMPORT_UNMAPPED_VALUE']);
    expect(result.issues[0]!.column).toBe('CLUSTER_GRUPO');
    expect(result.rows).toEqual([]);
  });

  it('bloqueia oferta fora do catálogo, inclusive item arquivado', () => {
    const semOferta: PolicyOpsDocument = {
      ...doc,
      catalog: doc.catalog.map((item) =>
        item.code === 'OFERTA_15' ? { ...item, archivedAt: '2026-02-01T00:00:00.000Z' } : item,
      ),
    };
    const result = resolveImport(semOferta, tableFrom(row()), cineminhaProfile());
    // Um problema por coluna: são seis colunas de oferta trazendo o mesmo 15.
    expect(codesOf(result.issues)).toEqual(Array<string>(6).fill('IMPORT_UNMAPPED_VALUE'));
    expect(result.issues[0]!.message).toContain('oferta');
    expect(result.issues.map((issue) => issue.column)).toEqual([
      'OFERTA',
      'OFERTA_GERAL',
      'OFERTA_DIGITAL',
      'OFERTA_URA',
      'OFERTA_PAP',
      'OFERTA_OUTBOUND',
    ]);
    expect(result.rows).toEqual([]);
  });

  it('bloqueia quando a decisão derivada não existe no catálogo, ou nenhuma regra se aplica', () => {
    const semDecisao: PolicyOpsDocument = {
      ...doc,
      catalog: doc.catalog.filter((item) => item.code !== 'APROVADO'),
    };
    const semCatalogo = resolveImport(semDecisao, tableFrom(row()), cineminhaProfile());
    expect(codesOf(semCatalogo.issues)).toEqual(['IMPORT_UNMAPPED_VALUE']);
    expect(semCatalogo.issues[0]!.message).toContain('não existe no catálogo');

    const semRegra = resolveImport(doc, tableFrom(row()), cineminhaProfile({ decisionRules: [] }));
    expect(semRegra.issues[0]!.message).toContain('otherwise');
    expect(semRegra.rows).toEqual([]);
  });

  it('bloqueia quando a variável do eixo não tem versão publicada', () => {
    const rascunho: PolicyOpsDocument = {
      ...doc,
      variables: doc.variables.map((variable) =>
        variable.id === IDS.faixa
          ? {
              ...variable,
              versions: variable.versions.map((version) => ({ ...version, state: 'DRAFT' as const })),
            }
          : variable,
      ),
    };
    const result = resolveImport(rascunho, tableFrom(row()), cineminhaProfile());
    expect(codesOf(result.issues)).toContain('IMPORT_PROFILE_INVALID');
    expect(result.rows).toEqual([]);
  });
});

describe('resolveImport — chave repetida (RN-08)', () => {
  const doc = cineminhaDocument();

  it('conta uma vez e avisa quando o conteúdo é idêntico (CT-06)', () => {
    const result = resolveImport(doc, tableFrom(row(), row()), cineminhaProfile());
    expect(result.rows).toHaveLength(6);
    const avisos = result.issues.filter((issue) => issue.code === 'IMPORT_DUPLICATE_ROW');
    expect(avisos).toHaveLength(6);
    expect(avisos[0]!.details).toMatchObject({ firstLine: 2, occurrences: 1 });
    expect(avisos[0]!.severity).toBe('WARNING');
  });

  it('é erro quando o conteúdo diverge, apontando as duas linhas (CT-05)', () => {
    const result = resolveImport(
      doc,
      tableFrom(row(), row({ offers: ['0', '15', '15', '15', '15', '15'] })),
      cineminhaProfile(),
    );
    const erros = result.issues.filter((issue) => issue.code === 'IMPORT_DUPLICATE_KEY');
    expect(erros).toHaveLength(1);
    expect(erros[0]!.severity).toBe('ERROR');
    expect(erros[0]!.details).toMatchObject({ lines: [2, 3], matrixKey: 'G1|SEM_RISCO|TETO' });
    // Os outros cinco canais vieram idênticos: aviso, não erro.
    expect(result.issues.filter((issue) => issue.code === 'IMPORT_DUPLICATE_ROW')).toHaveLength(5);
  });
});

describe('resolveImport — formato canônico, sem desdobramento', () => {
  const doc = cineminhaDocument();

  function canonicalProfile(extra: ColumnMapping[] = []): ImportProfile {
    const base = cineminhaProfile();
    return cineminhaProfile({
      unpivot: undefined,
      codeTemplate: 'MTZ_{CLUSTER_GRUPO}',
      nameTemplate: '{CLUSTER_GRUPO}',
      tagRules: [],
      columns: [
        ...base.columns.filter(
          (column) => column.role !== 'VALUE' || column.column === 'OFERTA',
        ),
        ...base.columns
          .filter((column) => column.role === 'VALUE' && column.column !== 'OFERTA')
          .map((column) => ({ ...column, role: 'IGNORE' as const })),
        ...extra,
      ],
    });
  }

  it('junta todas as colunas de valor na mesma célula', () => {
    const profile = canonicalProfile();
    const result = resolveImport(doc, tableFrom(row()), profile);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.matrixKey).toBe('G1|SEM_RISCO');
    expect(result.rows[0]!.cell).toEqual({ offer: 'OFERTA_15', decision: 'APROVADO' });
  });

  it('preenche note, attrs e limite pelas colunas de valor', () => {
    const header = `${HEADER};NOTA;CANAL_ORIGEM;PRIORIDADE;LIMITE`;
    const parsed = parseDelimitedTable(
      [header, `${row()};revisar;digital;alta;LIM_2000`].join('\n'),
    );
    const doc2: PolicyOpsDocument = {
      ...doc,
      catalog: [
        ...doc.catalog,
        {
          id: 'CATLIM______',
          kind: 'LIMIT',
          code: 'LIM_2000',
          label: 'Limite 2000',
          numericValue: '2000.00',
          position: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    const profile = canonicalProfile([
      { column: 'NOTA', role: 'VALUE', value: { field: 'note' } },
      { column: 'CANAL_ORIGEM', role: 'VALUE', value: { field: 'attr:canal' } },
      { column: 'PRIORIDADE', role: 'VALUE', value: { field: 'attr:prioridade' } },
      { column: 'LIMITE', role: 'VALUE', value: { field: 'limit' } },
    ]);
    const result = resolveImport(
      doc2,
      { header: parsed.header, rows: parsed.rows, lines: parsed.lines },
      profile,
    );
    expect(result.issues).toEqual([]);
    expect(result.rows[0]!.cell).toEqual({
      offer: 'OFERTA_15',
      note: 'revisar',
      attrs: { canal: 'digital', prioridade: 'alta' },
      limit: 'LIM_2000',
      decision: 'APROVADO',
    });
  });

  it('bloqueia limite fora do catálogo', () => {
    const header = `${HEADER};LIMITE`;
    const parsed = parseDelimitedTable([header, `${row()};LIM_9999`].join('\n'));
    const profile = canonicalProfile([{ column: 'LIMITE', role: 'VALUE', value: { field: 'limit' } }]);
    const result = resolveImport(
      doc,
      { header: parsed.header, rows: parsed.rows, lines: parsed.lines },
      profile,
    );
    expect(result.issues[0]!.message).toContain('limite');
  });

  it('não produz célula alguma quando o perfil não tem coluna de valor', () => {
    const profile = cineminhaProfile({
      unpivot: undefined,
      codeTemplate: 'MTZ_{CLUSTER_GRUPO}',
      nameTemplate: '{CLUSTER_GRUPO}',
      columns: cineminhaProfile().columns.map((column) =>
        column.role === 'VALUE' ? { ...column, role: 'IGNORE' as const } : column,
      ),
    });
    const result = resolveImport(doc, tableFrom(row()), profile);
    expect(result.rows).toEqual([]);
    expect(result.keys).toEqual([]);
  });
});

describe('resolveImport — perfil desalinhado do arquivo', () => {
  it('ignora coluna mapeada que não existe no cabeçalho', () => {
    const doc = cineminhaDocument();
    const profile = cineminhaProfile({
      columns: [
        ...cineminhaProfile().columns,
        { column: 'FANTASMA', role: 'CHECK', check: { expected: 'X' }, ignoredValues: ['zzz'] },
      ],
    });
    const result = resolveImport(doc, tableFrom(row()), profile);
    expect(result.issues.map((issue) => issue.code)).toEqual(['IMPORT_CHECK_MISMATCH']);
    expect(result.rows).toHaveLength(6);
  });

  it('não resolve linha alguma quando o eixo do perfil está vazio', () => {
    const doc = cineminhaDocument();
    const profile = cineminhaProfile({
      columns: cineminhaProfile().columns.map((column) =>
        column.axis?.role === 'X' ? { ...column, role: 'IGNORE' as const, axis: undefined } : column,
      ),
    });
    expect(resolveImport(doc, tableFrom(row()), profile).rows).toEqual([]);
  });
});

describe('resolveImport — tabela montada fora do parser', () => {
  const doc = cineminhaDocument();
  const header = parseDelimitedTable(`${HEADER}\n${row()}`).header;

  it('trata célula ausente como vazia, sem quebrar', () => {
    const curta: ImportTable = { header, rows: [['G1']], lines: [2] };
    const result = resolveImport(doc, curta, cineminhaProfile());
    expect(result.rows).toEqual([]);
    expect(result.issues.map((issue) => issue.column)).toEqual([
      'DS_MOD_PRC',
      'CEP_RISCO',
      'MOD_PRC',
      'DS_MOD_ADC',
      'MOD_ADC',
    ]);
  });

  it('não produz célula quando faltam as colunas de valor da linha', () => {
    const semOfertas: ImportTable = {
      header,
      rows: [['G1', 'd. SEM RISCO', 'HVI3', 'R01', 'G1 - BHV', 'R01']],
      lines: [2],
    };
    const result = resolveImport(doc, semOfertas, cineminhaProfile());
    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('descarta a linha quando a célula ausente é justamente um valor ignorado', () => {
    const profile = cineminhaProfile({
      columns: cineminhaProfile().columns.map((column) =>
        column.column === 'DS_MOD_PRC' ? { ...column, ignoredValues: [''] } : column,
      ),
    });
    const result = resolveImport(doc, { header, rows: [['G1']], lines: [2] }, profile);
    expect(result.ignoredRows).toBe(1);
    expect(result.issues.map((issue) => issue.code)).toEqual(['IMPORT_ROW_IGNORED']);
  });
});

describe('resolveImport — célula sem oferta', () => {
  const doc = cineminhaDocument();
  const header = parseDelimitedTable(`${HEADER};NOTA\n${row()};x`).header;

  function noteOnlyProfile(decisionRules: ImportProfile['decisionRules']): ImportProfile {
    return cineminhaProfile({
      unpivot: undefined,
      codeTemplate: 'MTZ_{CLUSTER_GRUPO}',
      nameTemplate: '{CLUSTER_GRUPO}',
      tagRules: [],
      decisionRules,
      columns: [
        ...cineminhaProfile().columns.map((column) =>
          column.role === 'VALUE' ? { ...column, role: 'IGNORE' as const } : column,
        ),
        { column: 'NOTA', role: 'VALUE', value: { field: 'note' } },
      ],
    });
  }

  function noteTable(): ImportTable {
    const parsed = parseDelimitedTable(`${HEADER};NOTA\n${row()};revisar`);
    return { header: parsed.header, rows: parsed.rows, lines: parsed.lines };
  }

  it('acusa a falta de regra otherwise nomeando a oferta vazia', () => {
    expect(header).toContain('NOTA');
    const result = resolveImport(doc, noteTable(), noteOnlyProfile([]));
    expect(result.issues[0]!.message).toContain('oferta "(vazia)"');
    expect(result.issues[0]!.message).toContain('otherwise');
  });

  it('acusa decisão inexistente no catálogo mesmo sem oferta', () => {
    const result = resolveImport(doc, noteTable(), noteOnlyProfile([{ otherwise: 'INEXISTENTE' }]));
    expect(result.issues[0]!.message).toContain('A decisão "INEXISTENTE"');
    expect(result.issues[0]!.message).toContain('(vazia)');
  });
});

describe('resolveImport — o recorte real', () => {
  it('resolve 231 linhas em 1.386 células, sem problema algum', () => {
    const result = resolveImport(cineminhaDocument(), excerptTable(), cineminhaProfile());
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(231 * 6);
    expect(result.keys).toHaveLength(18);
    expect(result.ignoredRows).toBe(0);
  });
});
