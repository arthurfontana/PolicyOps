import { describe, expect, it } from 'vitest';
import type { PolicyOpsDocument } from '@/core/document/schema';
import {
  axisColumns,
  columnsWithRole,
  decisionForOffer,
  documentProfiles,
  humanizeValue,
  isIgnoredValue,
  mapColumnValue,
  matchImportProfile,
  normalizeValue,
  renderTemplate,
  sharedValueColumns,
  tagsForKey,
  templatePlaceholders,
  validateProfile,
  validateProfileAgainstHeader,
  type ColumnMapping,
  type ImportProfile,
} from '@/core/import/profile';
import { cineminhaDocument, cineminhaProfile, IDS } from './fixtures';

function codes(issues: ReturnType<typeof validateProfile>): string[] {
  return issues.map((issue) => issue.code);
}

function messages(issues: ReturnType<typeof validateProfile>): string {
  return issues.map((issue) => issue.message).join(' | ');
}

describe('normalizeValue (§5.4)', () => {
  it('tira prefixo de ordenação, acento e pontuação', () => {
    expect(normalizeValue('a.RISCO BAIXO')).toBe('RISCO_BAIXO');
    expect(normalizeValue('d. SEM RISCO')).toBe('SEM_RISCO');
    expect(normalizeValue('y. Sem Rest')).toBe('SEM_REST');
    expect(normalizeValue('1) Análise Manual')).toBe('ANALISE_MANUAL');
    expect(normalizeValue('Não MEI (1 sócio)')).toBe('NAO_MEI_1_SOCIO');
  });

  it('não confunde traço de composição com prefixo de ordenação', () => {
    expect(normalizeValue('G1 - BHV')).toBe('G1_BHV');
    expect(normalizeValue('R01')).toBe('R01');
    expect(normalizeValue('R99')).toBe('R99');
  });

  it('devolve vazio quando não sobra nada aproveitável', () => {
    expect(normalizeValue('')).toBe('');
    expect(normalizeValue('   ')).toBe('');
    expect(normalizeValue('---')).toBe('');
  });
});

describe('humanizeValue', () => {
  it('produz o rótulo do nameTemplate', () => {
    expect(humanizeValue('c.RISCO ALTO')).toBe('Risco Alto');
    expect(humanizeValue('d. SEM RISCO')).toBe('Sem Risco');
    expect(humanizeValue('G4')).toBe('G4');
    expect(humanizeValue('HVI3')).toBe('HVI3');
    expect(humanizeValue('')).toBe('');
  });
});

describe('mapColumnValue e ignoredValues', () => {
  const mapping: ColumnMapping = {
    column: 'DS_MOD_ADC',
    role: 'AXIS',
    axis: { role: 'Y', level: 0, variableId: IDS.modelo },
    valueMap: { 'G1 - BHV': 'BHV_G1' },
    ignoredValues: ['n/a'],
  };

  it('usa o valueMap, tolera espaço em volta e cai na normalização', () => {
    expect(mapColumnValue(mapping, 'G1 - BHV')).toBe('BHV_G1');
    expect(mapColumnValue(mapping, ' G1 - BHV ')).toBe('BHV_G1');
    expect(mapColumnValue(mapping, 'HVI4')).toBe('HVI4');
    expect(mapColumnValue({ column: 'X', role: 'IGNORE' }, 'a.Risco Alto')).toBe('RISCO_ALTO');
  });

  it('reconhece valor ignorado pelo texto cru e pelo normalizado', () => {
    expect(isIgnoredValue(mapping, 'n/a')).toBe(true);
    expect(isIgnoredValue(mapping, 'N/A')).toBe(true);
    expect(isIgnoredValue(mapping, 'HVI4')).toBe(false);
    expect(isIgnoredValue({ column: 'X', role: 'IGNORE' }, 'n/a')).toBe(false);
  });
});

describe('leitura do perfil', () => {
  const profile = cineminhaProfile();

  it('ordena os níveis de eixo e separa as colunas de valor compartilhadas', () => {
    expect(axisColumns(profile, 'Y').map((column) => column.column)).toEqual([
      'DS_MOD_ADC',
      'MOD_ADC',
    ]);
    expect(columnsWithRole(profile, 'PARTITION')).toHaveLength(2);
    // Todas as colunas de valor entram no desdobramento — nenhuma sobra.
    expect(sharedValueColumns(profile)).toEqual([]);
    // Sem desdobramento, toda coluna de valor alimenta a mesma célula.
    expect(sharedValueColumns(cineminhaProfile({ unpivot: undefined }))).toHaveLength(6);
  });

  it('renderiza os templates e lista os marcadores', () => {
    expect(
      renderTemplate('MTZ_{CLUSTER_GRUPO}_{CEP_RISCO}_{CANAL}', {
        CLUSTER_GRUPO: 'G4',
        CEP_RISCO: 'RISCO_ALTO',
        CANAL: 'DIGITAL',
      }),
    ).toBe('MTZ_G4_RISCO_ALTO_DIGITAL');
    expect(renderTemplate('MTZ_{AUSENTE}', {})).toBe('MTZ_');
    expect(templatePlaceholders('{A} · {B}')).toEqual(['A', 'B']);
  });

  it('deriva a decisão da oferta (RN-11, DEC-CARGA-004)', () => {
    const rules = profile.decisionRules;
    expect(decisionForOffer(rules, 'OFERTA_0')).toBe('REPROVADO');
    expect(decisionForOffer(rules, 'OFERTA_15')).toBe('APROVADO');
    expect(decisionForOffer(rules, undefined)).toBe('APROVADO');
    expect(decisionForOffer([], 'OFERTA_0')).toBeUndefined();
    expect(
      decisionForOffer([{ when: { field: 'offer', equals: ['OFERTA_0'] }, setDecision: 'X' }], 'Y'),
    ).toBeUndefined();
  });

  it('monta as tags da matriz a partir das regras (US-09)', () => {
    expect(
      tagsForKey(profile, { CLUSTER_GRUPO: 'G4', CEP_RISCO: 'RISCO_ALTO', CANAL: 'DIGITAL' }),
    ).toEqual(['CLUSTER_G4', 'CEP_RISCO_ALTO', 'CANAL_DIGITAL']);
  });

  it('ignora regra sem valor, com código inválido, e não repete tag', () => {
    const custom = cineminhaProfile({
      tagRules: [
        { source: 'FIXED', group: 'Origem', code: 'CARGA' },
        { source: 'FIXED', group: 'Origem', code: 'CARGA' },
        { source: 'FIXED', group: 'Origem' },
        { source: 'PARTITION', group: 'Cluster' },
        { source: 'PARTITION', column: 'CLUSTER_GRUPO', group: 'Cluster', codePrefix: 'CLUSTER_' },
        { source: 'UNPIVOT', group: 'Canal', codePrefix: 'CANAL_' },
      ],
    });
    expect(tagsForKey(custom, { CLUSTER_GRUPO: 'G4' })).toEqual(['CARGA', 'CLUSTER_G4']);
    const semPrefixo = cineminhaProfile({
      tagRules: [{ source: 'PARTITION', column: 'CLUSTER_GRUPO', group: 'Cluster' }],
    });
    expect(tagsForKey(semPrefixo, { CLUSTER_GRUPO: 'G4' })).toEqual(['G4']);
    const semUnpivot = cineminhaProfile({
      unpivot: undefined,
      tagRules: [{ source: 'UNPIVOT', group: 'Canal', codePrefix: 'CANAL_' }],
    });
    expect(tagsForKey(semUnpivot, { CANAL: 'DIGITAL' })).toEqual([]);
    const invalida = cineminhaProfile({
      tagRules: [{ source: 'PARTITION', column: 'CEP_RISCO', group: 'Risco', codePrefix: 'CEP_' }],
    });
    expect(tagsForKey(invalida, { CEP_RISCO: 'com espaço' })).toEqual([]);
  });
});

describe('matchImportProfile (RN-19)', () => {
  const profile = cineminhaProfile();
  const doc = { ...cineminhaDocument(), importProfiles: [profile] };

  it('reconhece só o cabeçalho idêntico, na mesma ordem', () => {
    expect(matchImportProfile(doc, profile.signature)?.code).toBe('CARGA_CINEMINHA');
    expect(matchImportProfile(doc, [...profile.signature, 'EXTRA'])).toBeUndefined();
    expect(matchImportProfile(doc, profile.signature.slice().reverse())).toBeUndefined();
    expect(matchImportProfile(cineminhaDocument(), profile.signature)).toBeUndefined();
  });

  it('trata documento sem importProfiles como lista vazia', () => {
    expect(documentProfiles(cineminhaDocument())).toEqual([]);
    expect(documentProfiles(doc)).toHaveLength(1);
  });
});

describe('validateProfile (I21, I22)', () => {
  const doc: PolicyOpsDocument = cineminhaDocument();

  it('aceita o perfil do caso real', () => {
    expect(validateProfile(doc, cineminhaProfile())).toEqual([]);
  });

  it('recusa perfil fora do schema', () => {
    const issues = validateProfile(doc, { ...cineminhaProfile(), code: 'minusculo' });
    expect(codes(issues)).toEqual(['IMPORT_PROFILE_INVALID']);
    expect(issues[0]!.details).toEqual({ path: 'code' });
    const raiz = validateProfile(doc, undefined as unknown as ImportProfile);
    expect(messages(raiz)).toContain('raiz');
  });

  it('recusa código de perfil já usado no documento', () => {
    const profile = cineminhaProfile();
    const withProfiles = {
      ...doc,
      importProfiles: [{ ...profile, id: 'OUTRO_______' }],
    };
    expect(codes(validateProfile(withProfiles, profile))).toEqual(['IMPORT_PROFILE_DUPLICATE']);
    // O mesmo perfil, sendo reeditado, não colide consigo mesmo.
    expect(validateProfile({ ...doc, importProfiles: [profile] }, profile)).toEqual([]);
  });

  it('recusa projeto inexistente', () => {
    const issues = validateProfile(doc, cineminhaProfile({ projectId: 'INEXISTENTE_' }));
    expect(messages(issues)).toContain('projeto que não existe');
  });

  it('recusa coluna mapeada duas vezes', () => {
    const profile = cineminhaProfile();
    const issues = validateProfile(
      doc,
      cineminhaProfile({ columns: [...profile.columns, { column: 'CEP_RISCO', role: 'IGNORE' }] }),
    );
    expect(messages(issues)).toContain('mapeada duas vezes');
  });

  it('exige de 1 a 4 colunas de partição', () => {
    const profile = cineminhaProfile();
    const semParticao = profile.columns.map((column) =>
      column.role === 'PARTITION' ? { ...column, role: 'IGNORE' as const } : column,
    );
    expect(messages(validateProfile(doc, cineminhaProfile({ columns: semParticao })))).toContain(
      'ao menos uma coluna de partição',
    );

    const demais = [
      ...profile.columns,
      ...['P1', 'P2', 'P3'].map((column) => ({ column, role: 'PARTITION' as const })),
    ];
    expect(messages(validateProfile(doc, cineminhaProfile({ columns: demais })))).toContain(
      'colunas de partição; o máximo é 4',
    );
  });

  it('exige eixo em X e Y, com níveis contíguos, sem repetir variável', () => {
    const profile = cineminhaProfile();
    const semX = profile.columns.filter((column) => column.axis?.role !== 'X');
    expect(messages(validateProfile(doc, cineminhaProfile({ columns: semX })))).toContain(
      'nenhum nível para o eixo X',
    );

    const buraco = profile.columns.map((column) =>
      column.column === 'MOD_ADC'
        ? { ...column, axis: { role: 'Y' as const, level: 2, variableId: IDS.faixa } }
        : column,
    );
    expect(messages(validateProfile(doc, cineminhaProfile({ columns: buraco })))).toContain(
      'contíguos a partir de 0',
    );

    const repetida = profile.columns.map((column) =>
      column.column === 'MOD_ADC'
        ? { ...column, axis: { role: 'Y' as const, level: 1, variableId: IDS.modelo } }
        : column,
    );
    expect(messages(validateProfile(doc, cineminhaProfile({ columns: repetida })))).toContain(
      'mesma variável em dois níveis',
    );

    const quatroNiveis = [
      ...profile.columns,
      { column: 'N3', role: 'AXIS' as const, axis: { role: 'Y' as const, level: 2, variableId: IDS.hvi3 } },
      { column: 'N4', role: 'AXIS' as const, axis: { role: 'Y' as const, level: 3, variableId: IDS.project } },
    ];
    expect(messages(validateProfile(doc, cineminhaProfile({ columns: quatroNiveis })))).toContain(
      'o máximo é 3',
    );
  });

  it('recusa variável inexistente (I22) e variável nos dois eixos (I14)', () => {
    const profile = cineminhaProfile();
    const fantasma = profile.columns.map((column) =>
      column.column === 'MOD_PRC'
        ? { ...column, axis: { role: 'X' as const, level: 0, variableId: 'FANTASMA____' } }
        : column,
    );
    expect(messages(validateProfile(doc, cineminhaProfile({ columns: fantasma })))).toContain('I22');

    const nosDois = profile.columns.map((column) =>
      column.column === 'MOD_PRC'
        ? { ...column, axis: { role: 'X' as const, level: 0, variableId: IDS.faixa } }
        : column,
    );
    expect(messages(validateProfile(doc, cineminhaProfile({ columns: nosDois })))).toContain('I14');
  });

  it('exige o detalhe do papel de cada coluna e ao menos uma coluna de valor', () => {
    const semDetalhe: ColumnMapping[] = [
      { column: 'CLUSTER_GRUPO', role: 'PARTITION' },
      { column: 'MOD_PRC', role: 'AXIS' },
      { column: 'DS_MOD_ADC', role: 'AXIS', axis: { role: 'Y', level: 0, variableId: IDS.modelo } },
      { column: 'OFERTA', role: 'VALUE' },
      { column: 'DS_MOD_PRC', role: 'CHECK' },
    ];
    const issues = validateProfile(
      doc,
      cineminhaProfile({ columns: semDetalhe, unpivot: undefined }),
    );
    const texto = messages(issues);
    expect(texto).toContain('não declara eixo e nível');
    expect(texto).toContain('não declara o campo alvo');
    expect(texto).toContain('não declara o valor esperado');

    const semValor = cineminhaProfile().columns.filter((column) => column.role !== 'VALUE');
    expect(
      messages(validateProfile(doc, cineminhaProfile({ columns: semValor, unpivot: undefined }))),
    ).toContain('ao menos uma coluna de valor');
  });

  it('exige exatamente uma regra otherwise, e ela por último', () => {
    expect(
      messages(validateProfile(doc, cineminhaProfile({ decisionRules: [] }))),
    ).toContain('encontrei 0');
    expect(
      messages(
        validateProfile(
          doc,
          cineminhaProfile({ decisionRules: [{ otherwise: 'APROVADO' }, { otherwise: 'REPROVADO' }] }),
        ),
      ),
    ).toContain('encontrei 2');
    expect(
      messages(
        validateProfile(
          doc,
          cineminhaProfile({
            decisionRules: [
              { otherwise: 'APROVADO' },
              { when: { field: 'offer', equals: ['OFERTA_0'] }, setDecision: 'REPROVADO' },
            ],
          }),
        ),
      ),
    ).toContain('precisa ser a última');
  });

  it('valida o desdobramento', () => {
    const profile = cineminhaProfile();
    expect(
      messages(
        validateProfile(doc, cineminhaProfile({ unpivot: { code: 'CANAL', label: 'Canal', options: [] } })),
      ),
    ).toContain('ao menos uma opção');

    const repetida = {
      ...profile.unpivot!,
      options: [profile.unpivot!.options[0]!, profile.unpivot!.options[0]!],
    };
    expect(messages(validateProfile(doc, cineminhaProfile({ unpivot: repetida })))).toContain(
      'aparece duas vezes',
    );

    const foraDeValor = {
      ...profile.unpivot!,
      options: [{ column: 'CEP_RISCO', code: 'TETO', label: 'Teto' }],
    };
    expect(messages(validateProfile(doc, cineminhaProfile({ unpivot: foraDeValor })))).toContain(
      'não é uma coluna de valor',
    );

    const colunaInexistente = {
      ...profile.unpivot!,
      options: [{ column: 'NAO_EXISTE', code: 'TETO', label: 'Teto' }],
    };
    expect(
      messages(validateProfile(doc, cineminhaProfile({ unpivot: colunaInexistente }))),
    ).toContain('não é uma coluna de valor');
  });

  it('valida os padrões de código e de nome', () => {
    expect(
      messages(validateProfile(doc, cineminhaProfile({ codeTemplate: 'MTZ_{FANTASMA}' }))),
    ).toContain('{FANTASMA}');
    expect(
      messages(validateProfile(doc, cineminhaProfile({ nameTemplate: '{FANTASMA}' }))),
    ).toContain('{FANTASMA}');
    expect(
      messages(validateProfile(doc, cineminhaProfile({ codeTemplate: 'mtz-{CANAL}' }))),
    ).toContain('fora de ^[A-Z0-9_]+$');
    // Sem desdobramento, o marcador do canal deixa de existir.
    expect(
      messages(
        validateProfile(doc, cineminhaProfile({ unpivot: undefined, codeTemplate: 'MTZ_{CANAL}' })),
      ),
    ).toContain('{CANAL}');
  });

  it('valida as regras de tag', () => {
    expect(
      messages(
        validateProfile(
          doc,
          cineminhaProfile({ tagRules: [{ source: 'PARTITION', column: 'MOD_PRC', group: 'X' }] }),
        ),
      ),
    ).toContain('não é de partição');
    expect(
      messages(
        validateProfile(
          doc,
          cineminhaProfile({
            unpivot: undefined,
            codeTemplate: 'MTZ_{CLUSTER_GRUPO}',
            nameTemplate: '{CLUSTER_GRUPO}',
            tagRules: [{ source: 'UNPIVOT', group: 'Canal' }],
          }),
        ),
      ),
    ).toContain('desdobramento, que este perfil não declara');
    expect(
      messages(validateProfile(doc, cineminhaProfile({ tagRules: [{ source: 'FIXED', group: 'X' }] }))),
    ).toContain('não informa o código da tag');
  });
});

describe('validateProfileAgainstHeader', () => {
  it('acusa coluna mapeada que o arquivo não tem, e ignora as de papel IGNORE', () => {
    const profile = cineminhaProfile({
      columns: [...cineminhaProfile().columns, { column: 'SOBRA', role: 'IGNORE' }],
    });
    expect(validateProfileAgainstHeader(profile, profile.signature)).toEqual([]);
    const issues = validateProfileAgainstHeader(
      profile,
      profile.signature.filter((name) => name !== 'MOD_ADC'),
    );
    expect(issues.map((issue) => issue.code)).toEqual(['IMPORT_PROFILE_INVALID']);
    expect(issues[0]!.message).toContain('MOD_ADC');
  });
});
