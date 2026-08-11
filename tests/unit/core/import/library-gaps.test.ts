import { describe, expect, it } from 'vitest';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { computeLibraryGaps, type CompatibilityGap, type DomainsGap } from '@/core/import/library-gaps';
import { parseDelimitedTable, type ImportTable } from '@/core/import/parse-table';
import { cineminhaDocument, cineminhaProfile, excerptTable, IDS } from './fixtures';

const HEADER =
  'CLUSTER_GRUPO;CEP_RISCO;DS_MOD_PRC;MOD_PRC;DS_MOD_ADC;MOD_ADC;OFERTA;OFERTA_GERAL;OFERTA_DIGITAL;OFERTA_URA;OFERTA_PAP;OFERTA_OUTBOUND';

function tableFrom(...lines: string[]): ImportTable {
  const parsed = parseDelimitedTable([HEADER, ...lines].join('\n'));
  return { header: parsed.header, rows: parsed.rows, lines: parsed.lines };
}

function line(x: string, modelo: string, faixa: string, oferta = '15'): string {
  return ['G1', 'd. SEM RISCO', 'HVI3', x, modelo, faixa, ...Array<string>(6).fill(oferta)].join(';');
}

function domainsGaps(gaps: ReturnType<typeof computeLibraryGaps>): DomainsGap[] {
  return gaps.filter((gap): gap is DomainsGap => gap.kind === 'DOMAINS');
}

function compatGaps(gaps: ReturnType<typeof computeLibraryGaps>): CompatibilityGap[] {
  return gaps.filter((gap): gap is CompatibilityGap => gap.kind === 'COMPATIBILITY');
}

describe('computeLibraryGaps — domínios de eixo (US-04)', () => {
  it('não acusa nada quando a biblioteca já cobre o arquivo', () => {
    const gaps = computeLibraryGaps(cineminhaDocument(), excerptTable(), cineminhaProfile());
    expect(domainsGaps(gaps)).toEqual([]);
    expect(compatGaps(gaps)).toEqual([]);
  });

  it('lista o domínio faltante com rótulo original e cor da paleta oficial', () => {
    const doc = cineminhaDocument();
    const semR20: PolicyOpsDocument = {
      ...doc,
      variables: doc.variables.map((variable) =>
        variable.id === IDS.hvi3
          ? {
              ...variable,
              versions: variable.versions.map((version) => ({
                ...version,
                domains: version.domains.filter((domain) => domain.code !== 'R20'),
              })),
            }
          : variable,
      ),
    };
    const gaps = domainsGaps(
      computeLibraryGaps(semR20, tableFrom(line('R20', 'G1 - BHV', 'R01')), cineminhaProfile()),
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      variableCode: 'SCORE_HVI3',
      column: 'MOD_PRC',
      axis: 'X',
      level: 0,
      variablePublished: true,
    });
    expect(gaps[0]!.domains).toEqual([
      { code: 'R20', label: 'R20', position: 20, color: '#FF0000' },
    ]);
  });

  it('junta num só item os domínios faltantes da mesma variável em níveis diferentes', () => {
    const doc = cineminhaDocument();
    const vazia: PolicyOpsDocument = {
      ...doc,
      variables: doc.variables.map((variable) =>
        variable.id === IDS.faixa
          ? { ...variable, versions: variable.versions.map((v) => ({ ...v, domains: [] })) }
          : variable,
      ),
    };
    const profile = cineminhaProfile({
      columns: cineminhaProfile().columns.map((column) =>
        column.column === 'MOD_PRC'
          ? { ...column, axis: { role: 'X' as const, level: 0, variableId: IDS.faixa } }
          : column,
      ),
    });
    const gaps = domainsGaps(
      computeLibraryGaps(vazia, tableFrom(line('R05', 'G1 - BHV', 'R07')), profile),
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.domains.map((domain) => domain.code)).toEqual(['R05', 'R07']);
  });

  it('acusa a variável sem versão publicada com todos os domínios do arquivo', () => {
    const doc = cineminhaDocument();
    const rascunho: PolicyOpsDocument = {
      ...doc,
      variables: doc.variables.map((variable) =>
        variable.id === IDS.modelo
          ? {
              ...variable,
              versions: variable.versions.map((version) => ({ ...version, state: 'DRAFT' as const })),
            }
          : variable,
      ),
    };
    const gaps = domainsGaps(
      computeLibraryGaps(rascunho, tableFrom(line('R01', 'G1 - BHV', 'R01')), cineminhaProfile()),
    );
    expect(gaps[0]).toMatchObject({ variablePublished: false, variableCode: 'MODELO_ADICIONAL' });
    expect(gaps[0]!.domains.map((domain) => domain.code)).toEqual(['BHV_G1']);
  });

  it('acusa domínios de uma variável que nem existe no documento (I22)', () => {
    const profile = cineminhaProfile({
      columns: cineminhaProfile().columns.map((column) =>
        column.column === 'MOD_PRC'
          ? { ...column, axis: { role: 'X' as const, level: 0, variableId: 'FANTASMA____' } }
          : column,
      ),
    });
    const gaps = domainsGaps(
      computeLibraryGaps(cineminhaDocument(), tableFrom(line('R01', 'G1 - BHV', 'R01')), profile),
    );
    expect(gaps[0]).toMatchObject({ variableCode: '', variableName: '', variablePublished: false });
    expect(gaps[0]!.domains.map((domain) => domain.code)).toEqual(['R01']);
  });

  it('tolera linha mais curta que o cabeçalho', () => {
    const doc = cineminhaDocument();
    const table: ImportTable = { header: tableFrom().header, rows: [['G1']], lines: [2] };
    const profile = cineminhaProfile({
      columns: cineminhaProfile().columns.map((column) =>
        column.column === 'DS_MOD_PRC' ? { ...column, ignoredValues: ['zzz'] } : column,
      ),
    });
    expect(() => computeLibraryGaps(doc, table, profile)).not.toThrow();
  });

  it('ignora valor sem código válido e variável fora do documento', () => {
    const doc = cineminhaDocument();
    const profile = cineminhaProfile({
      columns: cineminhaProfile().columns.map((column) =>
        column.column === 'DS_MOD_ADC'
          ? { ...column, axis: { role: 'Y' as const, level: 0, variableId: 'FANTASMA____' }, valueMap: {} }
          : column,
      ),
    });
    const gaps = domainsGaps(
      computeLibraryGaps(doc, tableFrom(line('R01', '...', 'R01')), profile),
    );
    expect(gaps).toEqual([]);
  });

  it('não propõe domínio para linha descartada por valor ignorado', () => {
    const doc = cineminhaDocument();
    const profile = cineminhaProfile({
      columns: cineminhaProfile().columns.map((column) =>
        column.column === 'DS_MOD_ADC'
          ? { ...column, ignoredValues: ['Modelo novo'], valueMap: { 'G1 - BHV': 'BHV_G1' } }
          : column,
      ),
    });
    const gaps = computeLibraryGaps(
      doc,
      tableFrom(line('R01', 'Modelo novo', 'R01'), line('R01', 'G1 - BHV', 'R01')),
      profile,
    );
    expect(domainsGaps(gaps)).toEqual([]);
  });
});

describe('computeLibraryGaps — catálogo', () => {
  it('lista ofertas, decisões e tags que faltam, por kind', () => {
    const doc = cineminhaDocument();
    const vazio: PolicyOpsDocument = { ...doc, catalog: [] };
    const gaps = computeLibraryGaps(vazio, excerptTable(), cineminhaProfile());
    const catalog = Object.fromEntries(
      gaps
        .filter((gap) => gap.kind === 'CATALOG')
        .map((gap) => [gap.catalogKind, gap.items.map((item) => item.code)]),
    );
    expect([...catalog.OFFER!].sort()).toEqual([
      'OFERTA_0',
      'OFERTA_12',
      'OFERTA_15',
      'OFERTA_3',
      'OFERTA_5',
      'OFERTA_8',
    ]);
    expect(catalog.DECISION).toEqual(['REPROVADO', 'APROVADO']);
    expect(catalog.TAG).toContain('CANAL_DIGITAL');
    expect(catalog.TAG).toContain('CLUSTER_G4');
  });

  it('lista limites faltantes e ignora valor que não vira código', () => {
    const parsed = parseDelimitedTable(
      [`${HEADER};LIMITE`, `${line('R01', 'G1 - BHV', 'R01', '---')};LIM_2000`].join('\n'),
    );
    const profile = cineminhaProfile({
      columns: [
        ...cineminhaProfile().columns,
        { column: 'LIMITE', role: 'VALUE', value: { field: 'limit' } },
      ],
    });
    const gaps = computeLibraryGaps(
      cineminhaDocument(),
      { header: parsed.header, rows: parsed.rows, lines: parsed.lines },
      profile,
    );
    const catalog = gaps.filter((gap) => gap.kind === 'CATALOG');
    const limites = catalog.find((gap) => gap.catalogKind === 'LIMIT');
    expect(limites!.kind === 'CATALOG' && limites.items).toEqual([
      { code: 'LIM_2000', label: 'LIM_2000' },
    ]);
    // "---" não vira código e não é proposto como item de catálogo.
    expect(catalog.some((gap) => gap.catalogKind === 'OFFER')).toBe(false);
  });

  it('não lista o que já existe no catálogo', () => {
    const gaps = computeLibraryGaps(cineminhaDocument(), excerptTable(), cineminhaProfile());
    const kinds = gaps.filter((gap) => gap.kind === 'CATALOG').map((gap) => gap.catalogKind);
    expect(kinds).toEqual(['TAG']);
  });

  it('lista as tags de um perfil sem desdobramento', () => {
    const profile = cineminhaProfile({
      unpivot: undefined,
      codeTemplate: 'MTZ_{CLUSTER_GRUPO}',
      nameTemplate: '{CLUSTER_GRUPO}',
      tagRules: [{ source: 'PARTITION', column: 'CLUSTER_GRUPO', group: 'Cluster', codePrefix: 'CLUSTER_' }],
    });
    const gaps = computeLibraryGaps(cineminhaDocument(), excerptTable(), profile);
    const tags = gaps.find((gap) => gap.kind === 'CATALOG' && gap.catalogKind === 'TAG');
    expect(tags!.kind === 'CATALOG' && tags.items.map((item) => item.code)).toEqual([
      'CLUSTER_G1',
      'CLUSTER_G4',
      'CLUSTER_G6',
    ]);
  });
});

describe('computeLibraryGaps — compatibilidade (US-04)', () => {
  const table = tableFrom(
    line('R01', 'G1 - BHV', 'R01'),
    line('R01', 'G1 - BHV', 'R02'),
    line('R01', 'Restritivos', 'y. Sem Rest'),
  );

  it('deduz o mapa dos pares adjacentes quando não há regra publicada', () => {
    const doc = cineminhaDocument();
    const semRegra: PolicyOpsDocument = { ...doc, compatibility: [] };
    const gaps = compatGaps(computeLibraryGaps(semRegra, table, cineminhaProfile()));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      exists: false,
      axis: 'Y',
      parentVariableCode: 'MODELO_ADICIONAL',
      childVariableCode: 'FAIXA_MODELO_ADICIONAL',
      defaultForUnlisted: 'NONE',
      missingPairs: [],
    });
    expect(gaps[0]!.allow).toEqual({ BHV_G1: ['R01', 'R02'], RESTRITIVOS: ['SEM_REST'] });
  });

  it('ordena os filhos pela posição do domínio na variável', () => {
    const doc = cineminhaDocument();
    const semRegra: PolicyOpsDocument = { ...doc, compatibility: [] };
    const invertida = tableFrom(line('R01', 'G1 - BHV', 'R03'), line('R01', 'G1 - BHV', 'R02'));
    const gaps = compatGaps(computeLibraryGaps(semRegra, invertida, cineminhaProfile()));
    expect(gaps[0]!.allow['BHV_G1']).toEqual(['R02', 'R03']);
  });

  it('acusa só os pares que a regra publicada não permite', () => {
    const doc = cineminhaDocument();
    const restrita: PolicyOpsDocument = {
      ...doc,
      compatibility: doc.compatibility.map((rule) => ({
        ...rule,
        versions: rule.versions.map((version) => ({
          ...version,
          allow: { BHV_G1: ['R01'] },
        })),
      })),
    };
    const gaps = compatGaps(computeLibraryGaps(restrita, table, cineminhaProfile()));
    expect(gaps[0]!.exists).toBe(true);
    expect(gaps[0]!.missingPairs).toEqual([
      ['BHV_G1', 'R02'],
      ['RESTRITIVOS', 'SEM_REST'],
    ]);
  });

  it('nada acusa quando o pai ausente é liberado por defaultForUnlisted ALL', () => {
    const doc = cineminhaDocument();
    const permissiva: PolicyOpsDocument = {
      ...doc,
      compatibility: doc.compatibility.map((rule) => ({
        ...rule,
        versions: rule.versions.map((version) => ({
          ...version,
          allow: { BHV_G1: ['R01', 'R02'] },
          defaultForUnlisted: 'ALL' as const,
        })),
      })),
    };
    expect(compatGaps(computeLibraryGaps(permissiva, table, cineminhaProfile()))).toEqual([]);
  });

  it('não acusa nada quando o arquivo não traz par adjacente algum', () => {
    const doc = cineminhaDocument();
    const semRegra: PolicyOpsDocument = { ...doc, compatibility: [] };
    const vazia: ImportTable = { header: tableFrom().header, rows: [], lines: [] };
    expect(compatGaps(computeLibraryGaps(semRegra, vazia, cineminhaProfile()))).toEqual([]);
  });

  it('ignora tupla com código inválido num dos níveis', () => {
    const doc = cineminhaDocument();
    const semRegra: PolicyOpsDocument = { ...doc, compatibility: [] };
    const comLixo = tableFrom(line('R01', 'G1 - BHV', '---'), line('R01', 'G1 - BHV', 'R01'));
    const gaps = compatGaps(computeLibraryGaps(semRegra, comLixo, cineminhaProfile()));
    expect(gaps[0]!.allow).toEqual({ BHV_G1: ['R01'] });
  });

  it('descreve o par mesmo quando as variáveis não existem no documento', () => {
    const doc = cineminhaDocument();
    const semRegra: PolicyOpsDocument = { ...doc, compatibility: [] };
    const profile = cineminhaProfile({
      columns: cineminhaProfile().columns.map((column) => {
        if (column.column === 'DS_MOD_ADC') {
          return { ...column, axis: { role: 'Y' as const, level: 0, variableId: 'FANTASMA_P__' } };
        }
        if (column.column === 'MOD_ADC') {
          return { ...column, axis: { role: 'Y' as const, level: 1, variableId: 'FANTASMA_C__' } };
        }
        return column;
      }),
    });
    const gaps = compatGaps(computeLibraryGaps(semRegra, table, profile));
    expect(gaps[0]).toMatchObject({ parentVariableCode: '', childVariableCode: '', exists: false });
  });

  it('ordena filhos desconhecidos no fim quando a variável não tem versão publicada', () => {
    const doc = cineminhaDocument();
    const semNada: PolicyOpsDocument = {
      ...doc,
      compatibility: [],
      variables: doc.variables.map((variable) =>
        variable.id === IDS.faixa
          ? {
              ...variable,
              versions: variable.versions.map((version) => ({ ...version, state: 'DRAFT' as const })),
            }
          : variable,
      ),
    };
    const gaps = compatGaps(
      computeLibraryGaps(semNada, tableFrom(line('R01', 'G1 - BHV', 'R02'), line('R01', 'G1 - BHV', 'R01')), cineminhaProfile()),
    );
    expect(gaps[0]!.allow['BHV_G1']).toEqual(['R02', 'R01']);
  });
});
