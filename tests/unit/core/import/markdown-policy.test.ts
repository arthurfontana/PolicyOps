import { describe, expect, it } from 'vitest';
import { parseMarkdownPolicy } from '@/core/import/markdown-policy';

/**
 * Parser da carga por recorte — docs/14 §9/§9.1 (formato normativo),
 * docs/prompts/S40-carga-de-componentes.md.
 *
 * Cobertura: hierarquia por heading (inclusive pulo de nível), os dez
 * marcadores, heurística de tipo com aviso, derivação e colisão de `code`,
 * `Fonte:` → `origin`, listas, marcador não reconhecido (dobra em notas, não
 * some), e Markdown malformado — nunca lança.
 */

describe('parseMarkdownPolicy — heading vira hierarquia', () => {
  it('um heading de nível 1 sem filhos vira uma raiz só', () => {
    const result = parseMarkdownPolicy('# Regras Duras\nTexto de negócio.');
    expect(result.issues).toEqual([]);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.name).toBe('Regras Duras');
    expect(result.roots[0]!.children).toEqual([]);
  });

  it('headings aninhados (#, ##, ###) viram pai/filho/neto', () => {
    const result = parseMarkdownPolicy(
      ['# Regras Duras', '## Bloqueios por Dívida', '### Dívida Acima de R$ 5.000'].join('\n'),
    );
    expect(result.roots).toHaveLength(1);
    const secao = result.roots[0]!;
    expect(secao.name).toBe('Regras Duras');
    expect(secao.children).toHaveLength(1);
    const subsecao = secao.children[0]!;
    expect(subsecao.name).toBe('Bloqueios por Dívida');
    expect(subsecao.children).toHaveLength(1);
    expect(subsecao.children[0]!.name).toBe('Dívida Acima de R$ 5.000');
  });

  it('dois headings de nível 1 seguidos viram duas raízes irmãs', () => {
    const result = parseMarkdownPolicy('# Decisões Soberanas\n\n# Regras Duras\n');
    expect(result.roots.map((node) => node.name)).toEqual(['Decisões Soberanas', 'Regras Duras']);
  });

  it('pular de nível (# direto para ###) ainda produz pai/filho — recorte que começa em ### funciona', () => {
    const result = parseMarkdownPolicy(['# Bloqueios por Dívida', '### Dívida Acima de R$ 5.000'].join('\n'));
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.children).toHaveLength(1);
    expect(result.roots[0]!.children[0]!.name).toBe('Dívida Acima de R$ 5.000');
  });

  it('um recorte que começa direto em ### (sem # nem ##) vira uma raiz de nível 3', () => {
    const result = parseMarkdownPolicy('### Dívida Acima de R$ 5.000\nBloqueia o cliente com dívida alta.');
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.level).toBe(3);
    expect(result.roots[0]!.children).toEqual([]);
  });

  it('heading vazio ("# " sem título) é ignorado, com aviso, sem lançar', () => {
    const result = parseMarkdownPolicy('# \nTexto qualquer.');
    expect(result.roots).toEqual([]);
    expect(result.issues.some((issue) => issue.severity === 'WARNING')).toBe(true);
  });
});

describe('parseMarkdownPolicy — texto de negócio', () => {
  it('parágrafo solto vira businessDescription', () => {
    const result = parseMarkdownPolicy('# Dívida Acima de R$ 5.000\nBloqueia o cliente com dívida em aberto.');
    expect(result.roots[0]!.payload.businessDescription).toBe('Bloqueia o cliente com dívida em aberto.');
  });

  it('parágrafos separados por linha em branco viram blocos distintos', () => {
    const result = parseMarkdownPolicy(['# Regra', 'Primeiro parágrafo.', '', 'Segundo parágrafo.'].join('\n'));
    expect(result.roots[0]!.payload.businessDescription).toBe('Primeiro parágrafo.\n\nSegundo parágrafo.');
  });

  it('linhas de uma lista (-, *, 1.) viram blocos próprios, sem o marcador', () => {
    const result = parseMarkdownPolicy(
      ['# Lista de Exceções', '- Cliente Goodlist', '* Cliente PEP', '1. Override manual'].join('\n'),
    );
    expect(result.roots[0]!.payload.businessDescription).toBe(
      'Cliente Goodlist\n\nCliente PEP\n\nOverride manual',
    );
  });

  it('sem nenhum parágrafo, businessDescription cai no nome do heading — nunca fica vazio', () => {
    const result = parseMarkdownPolicy('# Reason Codes\n> Tipo: REASON_CODE');
    expect(result.roots[0]!.payload.businessDescription).toBe('Reason Codes');
  });
});

describe('parseMarkdownPolicy — marcadores', () => {
  it('reconhece os dez marcadores de uma RULE completa', () => {
    const result = parseMarkdownPolicy(
      [
        '### Dívida Acima de R$ 5.000',
        'Bloqueia o cliente com dívida em aberto igual ou superior a R$ 5.000.',
        '> Tipo: RULE',
        '> Código: REGRA_DIVIDA_5000',
        '> Definição técnica: Aging > 0 e Valor >= 5000',
        '> Entradas: Aging, Valor em aberto',
        '> Condições: dívida vencida',
        '> Resultado: Reprovar',
        '> Reason code: DV01, DV02',
        '> Dependências: NG01',
        '> Fonte: Filtros e Critérios B2C, p. 10',
        '> Notas: revisar limite anualmente',
      ].join('\n'),
    );
    const node = result.roots[0]!;
    expect(node.type).toBe('RULE');
    expect(node.typeSource).toBe('EXPLICIT');
    expect(node.code).toBe('REGRA_DIVIDA_5000');
    expect(node.payload).toEqual({
      kind: 'RULE',
      businessDescription: 'Bloqueia o cliente com dívida em aberto igual ou superior a R$ 5.000.',
      technicalDefinition: 'Aging > 0 e Valor >= 5000',
      inputs: ['Aging', 'Valor em aberto'],
      conditions: 'dívida vencida',
      outcome: 'Reprovar',
      reasonCodes: ['DV01', 'DV02'],
      dependencies: ['NG01'],
      notes: 'revisar limite anualmente',
    });
    expect(node.origin).toEqual({ source: 'Filtros e Critérios B2C', locator: 'p. 10' });
    expect(node.issues).toEqual([]);
  });

  it('"> Fonte:" sem vírgula vira só "source", sem "locator"', () => {
    const result = parseMarkdownPolicy('# Regra\nTexto.\n> Fonte: Documento Interno');
    expect(result.roots[0]!.origin).toEqual({ source: 'Documento Interno' });
  });

  it('"> Fonte:" com vírgula final e nada depois também vira só "source"', () => {
    const result = parseMarkdownPolicy('# Regra\nTexto.\n> Fonte: Documento Interno,');
    expect(result.roots[0]!.origin).toEqual({ source: 'Documento Interno' });
  });

  it('blockquote com dois-pontos mas rótulo não reconhecido dobra em notas, com aviso', () => {
    const result = parseMarkdownPolicy(['# Regra', 'Texto.', '> Rótulo Desconhecido: algum valor'].join('\n'));
    const node = result.roots[0]!;
    expect(node.payload.notes).toBe('Rótulo Desconhecido: algum valor');
    expect(node.issues.some((issue) => issue.code === 'MARKDOWN_MARKER_IGNORED')).toBe(true);
  });

  it('marcadores são reconhecidos sem acento e em qualquer caixa', () => {
    const result = parseMarkdownPolicy(['# Regra', 'Texto.', '> CODIGO: teste_acento', '> definicao tecnica: X > 0'].join('\n'));
    expect(result.roots[0]!.code).toBe('TESTE_ACENTO');
    expect(result.roots[0]!.payload).toMatchObject({ technicalDefinition: 'X > 0' });
  });
});

describe('parseMarkdownPolicy — heurística de tipo', () => {
  it('sem "> Tipo:", assume RULE por heurística e avisa', () => {
    const result = parseMarkdownPolicy('# Cadastro Positivo\nConsidera o histórico do cliente.');
    const node = result.roots[0]!;
    expect(node.type).toBe('RULE');
    expect(node.typeSource).toBe('HEURISTIC');
    expect(node.issues).toHaveLength(1);
    expect(node.issues[0]!.code).toBe('MARKDOWN_TYPE_HEURISTIC');
    expect(node.issues[0]!.severity).toBe('WARNING');
  });

  it.each(['SECTION', 'RULE', 'LIST', 'REASON_CODE', 'POLICY_VARIABLE', 'OTHER'])(
    '"> Tipo: %s" explícito vence a heurística, sem aviso de heurística',
    (tipo) => {
      const result = parseMarkdownPolicy(`# Nó\nTexto.\n> Tipo: ${tipo}`);
      const node = result.roots[0]!;
      expect(node.type).toBe(tipo);
      expect(node.typeSource).toBe('EXPLICIT');
      expect(node.issues.some((issue) => issue.code === 'MARKDOWN_TYPE_HEURISTIC')).toBe(false);
    },
  );

  it('"> Tipo:" com valor não reconhecido (ex. MATRIX) cai na heurística, com aviso', () => {
    const result = parseMarkdownPolicy('# Cineminha Digital\nDescrição.\n> Tipo: MATRIX');
    const node = result.roots[0]!;
    expect(node.type).toBe('RULE');
    expect(node.typeSource).toBe('HEURISTIC');
    expect(node.issues.some((issue) => issue.code === 'MARKDOWN_MARKER_IGNORED')).toBe(true);
  });
});

describe('parseMarkdownPolicy — payload por tipo fora de RULE', () => {
  it('LIST só recebe businessDescription/notes; os demais marcadores dobram em notas rotuladas', () => {
    const result = parseMarkdownPolicy(
      ['# Goodlist', 'Lista de clientes com aprovação automática.', '> Tipo: LIST', '> Reason code: GD01'].join('\n'),
    );
    const node = result.roots[0]!;
    expect(node.payload.kind).toBe('LIST');
    expect(node.payload).toEqual({
      kind: 'LIST',
      businessDescription: 'Lista de clientes com aprovação automática.',
      notes: 'Reason code: GD01',
    });
  });

  it('fora de RULE, todos os marcadores técnicos capturados dobram em notas, rotulados e concatenados', () => {
    const result = parseMarkdownPolicy(
      [
        '# Reason Codes de Fraude',
        'Catálogo de reason codes.',
        '> Tipo: REASON_CODE',
        '> Definição técnica: score < 300',
        '> Entradas: score',
        '> Condições: sempre',
        '> Resultado: Reprovar',
        '> Reason code: FR01',
        '> Dependências: NG01',
        '> Notas: revisar',
      ].join('\n'),
    );
    expect(result.roots[0]!.payload.notes).toBe(
      'revisar | Definição técnica: score < 300 | Entradas: score | Condições: sempre | Resultado: Reprovar | Reason code: FR01 | Dependências: NG01',
    );
  });

  it('fora de RULE, sem nenhum marcador extra nem notas, "notes" fica ausente', () => {
    const result = parseMarkdownPolicy('# Variável X\nTexto.\n> Tipo: POLICY_VARIABLE');
    expect(result.roots[0]!.payload).toEqual({ kind: 'POLICY_VARIABLE', businessDescription: 'Texto.' });
  });

  it('SECTION usa o payload OTHER (docs/03 §12)', () => {
    const result = parseMarkdownPolicy('# Decisões Soberanas\nVisão geral do capítulo.\n> Tipo: SECTION');
    expect(result.roots[0]!.payload.kind).toBe('OTHER');
  });
});

describe('parseMarkdownPolicy — código', () => {
  it('sem "> Código:", deriva do nome: maiúsculas, sem acento, "_" no lugar de espaço/pontuação', () => {
    const result = parseMarkdownPolicy('# Dívida Acima de R$ 5.000\nTexto.');
    expect(result.roots[0]!.code).toBe('DIVIDA_ACIMA_DE_R_5_000');
  });

  it('duas raízes com o mesmo nome recebem códigos únicos (sufixo numérico)', () => {
    const result = parseMarkdownPolicy(['# Override', 'Primeiro.', '', '# Override', 'Segundo.'].join('\n'));
    expect(result.roots.map((node) => node.code)).toEqual(['OVERRIDE', 'OVERRIDE_2']);
  });

  it('três raízes com o mesmo nome avançam o sufixo até achar um código livre', () => {
    const result = parseMarkdownPolicy(
      ['# Override', 'Um.', '', '# Override', 'Dois.', '', '# Override', 'Três.'].join('\n'),
    );
    expect(result.roots.map((node) => node.code)).toEqual(['OVERRIDE', 'OVERRIDE_2', 'OVERRIDE_3']);
  });

  it('nome sem nenhum caractere aproveitável cai no código de reserva', () => {
    const result = parseMarkdownPolicy('# ...\nTexto.');
    expect(result.roots[0]!.code).toBe('COMPONENTE');
  });
});

describe('parseMarkdownPolicy — Markdown malformado nunca lança', () => {
  it('texto vazio devolve zero raízes e um aviso, sem exceção', () => {
    expect(() => parseMarkdownPolicy('')).not.toThrow();
    const result = parseMarkdownPolicy('');
    expect(result.roots).toEqual([]);
    expect(result.issues.some((issue) => issue.code === 'MARKDOWN_NO_HEADINGS')).toBe(true);
  });

  it('texto sem nenhum heading devolve zero raízes e aviso', () => {
    const result = parseMarkdownPolicy('Só um parágrafo solto, sem título nenhum.');
    expect(result.roots).toEqual([]);
    expect(result.issues.some((issue) => issue.code === 'MARKDOWN_NO_HEADINGS')).toBe(true);
  });

  it('texto antes do primeiro heading é ignorado, com aviso, e não quebra o resto', () => {
    const result = parseMarkdownPolicy(['Texto perdido antes do título.', '# Regra', 'Texto válido.'].join('\n'));
    expect(result.roots).toHaveLength(1);
    expect(result.issues.some((issue) => issue.code === 'MARKDOWN_MARKER_IGNORED')).toBe(true);
  });

  it('blockquote sem marcador reconhecido dobra em notas — não desaparece — com aviso', () => {
    const result = parseMarkdownPolicy(['# Regra', 'Texto.', '> Isto não é um marcador conhecido'].join('\n'));
    const node = result.roots[0]!;
    expect(node.payload.notes).toBe('Isto não é um marcador conhecido');
    expect(node.issues.some((issue) => issue.code === 'MARKDOWN_MARKER_IGNORED')).toBe(true);
  });

  it('duas linhas de blockquote não reconhecidas se acumulam em notas, separadas por " | "', () => {
    const result = parseMarkdownPolicy(
      ['# Regra', 'Texto.', '> Primeira observação solta', '> Segunda observação solta'].join('\n'),
    );
    expect(result.roots[0]!.payload.notes).toBe('Primeira observação solta | Segunda observação solta');
  });

  it('linha de blockquote vazia ("> ") é ignorada, sem virar nem marcador nem nota', () => {
    const result = parseMarkdownPolicy(['# Regra', 'Texto.', '>', '> Tipo: RULE'].join('\n'));
    expect(result.roots[0]!.payload.notes).toBeUndefined();
    expect(result.roots[0]!.typeSource).toBe('EXPLICIT');
  });

  it('caracteres estranhos, emojis e tabelas soltas não lançam exceção', () => {
    const gibberish = ['# 🚀 Título com emoji', '| a | b |', '|---|---|', '~~~ bloco de código não suportado ~~~', '```js', 'x'];
    expect(() => parseMarkdownPolicy(gibberish.join('\n'))).not.toThrow();
  });

  it('heading até nível 6 é aceito; um "########" (nível 8) não casa e vira parágrafo, sem lançar', () => {
    expect(() => parseMarkdownPolicy('###### Nível 6\nTexto.\n######## Não é heading válido')).not.toThrow();
    const result = parseMarkdownPolicy('###### Nível 6\nTexto.');
    expect(result.roots[0]!.level).toBe(6);
  });
});

describe('parseMarkdownPolicy — fixture derivada do documento real (Filtros e Critérios B2C)', () => {
  const FIXTURE = [
    '# Decisões Soberanas',
    '',
    '## Goodlist',
    'Clientes na lista de aprovação automática entram direto, sem passar pelas demais regras.',
    '> Tipo: RULE',
    '> Código: DECISAO_GOODLIST',
    '> Definição técnica: cliente.cpf IN (GOODLIST)',
    '> Resultado: Aprovar',
    '> Reason code: GD01',
    '> Fonte: Filtros e Critérios B2C, p. 4',
    '',
    '## PEP',
    'Cliente Pessoa Exposta Politicamente é sempre derivado para a Mesa.',
    '> Tipo: RULE',
    '> Código: DECISAO_PEP',
    '> Resultado: Derivar para Mesa',
    '> Reason code: PP01',
    '> Fonte: Filtros e Critérios B2C, p. 4',
    '',
    '## Override',
    'Decisão manual registrada substitui o resultado automático.',
    '> Tipo: RULE',
    '> Código: DECISAO_OVERRIDE',
    '> Resultado: Conforme registrado',
    '> Fonte: Filtros e Critérios B2C, p. 5',
    '',
    '# Regras Duras',
    '',
    '## Bloqueios por Dívida',
    '',
    '### Dívida Acima de R$ 5.000',
    'Bloqueia o cliente com dívida em aberto igual ou superior a R$ 5.000.',
    '> Tipo: RULE',
    '> Código: REGRA_DIVIDA_5000',
    '> Definição técnica: Aging > 0 e Valor >= 5000',
    '> Resultado: Reprovar',
    '> Reason code: DV01',
    '> Fonte: Filtros e Critérios B2C, p. 10',
  ].join('\n');

  it('reconstrói os quatro níveis do sumário com hierarquia, payloads e origem corretos', () => {
    const result = parseMarkdownPolicy(FIXTURE);
    expect(result.issues).toEqual([]);
    expect(result.roots.map((node) => node.name)).toEqual(['Decisões Soberanas', 'Regras Duras']);

    const soberanas = result.roots[0]!;
    expect(soberanas.children.map((node) => node.name)).toEqual(['Goodlist', 'PEP', 'Override']);
    expect(soberanas.children.every((node) => node.type === 'RULE' && node.typeSource === 'EXPLICIT')).toBe(true);

    const goodlist = soberanas.children[0]!;
    expect(goodlist.code).toBe('DECISAO_GOODLIST');
    expect(goodlist.origin).toEqual({ source: 'Filtros e Critérios B2C', locator: 'p. 4' });
    expect(goodlist.payload).toMatchObject({
      businessDescription:
        'Clientes na lista de aprovação automática entram direto, sem passar pelas demais regras.',
      technicalDefinition: 'cliente.cpf IN (GOODLIST)',
      outcome: 'Aprovar',
      reasonCodes: ['GD01'],
    });

    const durasChapter = result.roots[1]!;
    expect(durasChapter.children).toHaveLength(1);
    const bloqueios = durasChapter.children[0]!;
    expect(bloqueios.name).toBe('Bloqueios por Dívida');
    expect(bloqueios.children).toHaveLength(1);
    const divida5000 = bloqueios.children[0]!;
    expect(divida5000.code).toBe('REGRA_DIVIDA_5000');
    expect(divida5000.payload).toMatchObject({
      technicalDefinition: 'Aging > 0 e Valor >= 5000',
      outcome: 'Reprovar',
      reasonCodes: ['DV01'],
    });
    expect(divida5000.origin).toEqual({ source: 'Filtros e Critérios B2C', locator: 'p. 10' });
  });

  it('todos os códigos do documento real ficam únicos, sem colisão', () => {
    const result = parseMarkdownPolicy(FIXTURE);
    const codes: string[] = [];
    const collect = (nodes: typeof result.roots) => {
      for (const node of nodes) {
        codes.push(node.code);
        collect(node.children);
      }
    };
    collect(result.roots);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
