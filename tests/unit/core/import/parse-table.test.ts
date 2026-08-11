import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseDelimitedTable, sourceLine } from '@/core/import/parse-table';

const BOM = '\u{FEFF}';

describe('detecção de separador (§5.4)', () => {
  it('reconhece os quatro formatos pela contagem no cabeçalho', () => {
    const cases: Array<[string, string]> = [
      [';', 'A;B;C\n1;2;3'],
      [',', 'A,B,C\n1,2,3'],
      ['\t', 'A\tB\tC\n1\t2\t3'],
      ['|', 'A|B|C\n1|2|3'],
    ];
    for (const [delimiter, text] of cases) {
      const parsed = parseDelimitedTable(text);
      expect(parsed.format.delimiter).toBe(delimiter);
      expect(parsed.header).toEqual(['A', 'B', 'C']);
      expect(parsed.rows).toEqual([['1', '2', '3']]);
      expect(parsed.errors).toEqual([]);
    }
  });

  it('escolhe o separador mais frequente do cabeçalho', () => {
    const parsed = parseDelimitedTable('A;B;C,D\n1;2;3,4');
    expect(parsed.format.delimiter).toBe(';');
    expect(parsed.header).toEqual(['A', 'B', 'C,D']);
  });

  it('avisa e lê como coluna única quando não há separador nenhum', () => {
    const parsed = parseDelimitedTable('APENAS\numa\noutra');
    expect(parsed.format.delimiter).toBe(';');
    expect(parsed.warnings.map((issue) => issue.code)).toEqual(['IMPORT_DELIMITER_NOT_DETECTED']);
    expect(parsed.warnings[0]!.severity).toBe('WARNING');
    expect(parsed.rows).toEqual([['uma'], ['outra']]);
  });

  it('respeita o separador informado pelo chamador', () => {
    const parsed = parseDelimitedTable('A;B\n1;2', { delimiter: ',' });
    expect(parsed.format.delimiter).toBe(',');
    expect(parsed.header).toEqual(['A;B']);
  });

  it('detectDelimiter devolve indefinido para linha sem candidatos', () => {
    expect(detectDelimiter('SEM SEPARADOR')).toBeUndefined();
    expect(detectDelimiter('a|b')).toBe('|');
  });
});

describe('BOM, CRLF e linhas em branco', () => {
  it('lê arquivo com BOM e CRLF como se não tivesse nenhum dos dois', () => {
    const parsed = parseDelimitedTable(`${BOM}A;B\r\n1;2\r\n3;4\r\n`);
    expect(parsed.format.hasBom).toBe(true);
    expect(parsed.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parsed.errors).toEqual([]);
  });

  it('marca hasBom como falso sem BOM, e aceita o valor informado', () => {
    expect(parseDelimitedTable('A;B\n1;2').format.hasBom).toBe(false);
    expect(parseDelimitedTable('A;B\n1;2', { hasBom: true }).format.hasBom).toBe(true);
  });

  it('ignora linhas em branco no meio e no fim', () => {
    const parsed = parseDelimitedTable('A;B\n1;2\n\n3;4\n\n');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.lines).toEqual([2, 4]);
  });
});

describe('aspas', () => {
  it('aceita separador, aspas escapadas e quebra de linha dentro do campo', () => {
    const parsed = parseDelimitedTable('A;B\n"um;dois";"aspas ""x"""\n"uma\nlinha";fim');
    expect(parsed.rows[0]).toEqual(['um;dois', 'aspas "x"']);
    expect(parsed.rows[1]).toEqual(['uma\nlinha', 'fim']);
    // A linha 1-based é a do início do registro, mesmo com quebra dentro dele.
    expect(parsed.lines).toEqual([2, 3]);
  });

  it('trata aspa no meio do campo como texto', () => {
    const parsed = parseDelimitedTable('A;B\nab"c;d');
    expect(parsed.rows[0]).toEqual(['ab"c', 'd']);
  });

  it('aponta a linha certa depois de um campo com quebra de linha', () => {
    const parsed = parseDelimitedTable('A;B\n"uma\nlinha";x\n1;2;3');
    expect(parsed.errors[0]!.line).toBe(4);
  });
});

describe('erros de leitura (IMPORT_PARSE_ERROR)', () => {
  it('recusa linha com número de colunas diferente do cabeçalho', () => {
    const parsed = parseDelimitedTable('A;B;C\n1;2;3\n4;5\n6;7;8;9');
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors[0]!.line).toBe(3);
    expect(parsed.errors[0]!.column).toBe('C');
    expect(parsed.errors[0]!.details).toEqual({ expected: 3, found: 2 });
    expect(parsed.errors[1]!.line).toBe(4);
    expect(parsed.errors[1]!.column).toBe('C');
    // As linhas boas continuam aproveitadas para a tela de prévia.
    expect(parsed.rows).toEqual([['1', '2', '3']]);
  });

  it('recusa arquivo vazio, cabeçalho em branco e linha de cabeçalho inexistente', () => {
    for (const [text, headerRow] of [
      ['', 1],
      ['\nA;B\n1;2', 1],
      ['A;B\n1;2', 9],
      ['A;B\n1;2', 0],
    ] as Array<[string, number]>) {
      const parsed = parseDelimitedTable(text, { headerRow });
      expect(parsed.errors[0]!.code).toBe('IMPORT_PARSE_ERROR');
      expect(parsed.errors[0]!.severity).toBe('ERROR');
      expect(parsed.header).toEqual([]);
      expect(parsed.rows).toEqual([]);
    }
  });

  it('recusa arquivo só com cabeçalho', () => {
    const parsed = parseDelimitedTable('A;B\n');
    expect(parsed.errors[0]!.message).toContain('nenhuma linha de dados');
  });

  it('recusa coluna sem nome e coluna repetida no cabeçalho', () => {
    const semNome = parseDelimitedTable('A;;C\n1;2;3');
    expect(semNome.errors[0]!.message).toContain('coluna 2');
    const repetida = parseDelimitedTable('A;B;A\n1;2;3');
    expect(repetida.errors[0]!.column).toBe('A');
    expect(repetida.errors[0]!.message).toContain('duas vezes');
  });
});

describe('cabeçalho fora da primeira linha', () => {
  it('descarta o que vem antes e conta as linhas do arquivo original', () => {
    const parsed = parseDelimitedTable('relatório gerado em 08/07\nA;B\n1;2\n3;4', { headerRow: 2 });
    expect(parsed.header).toEqual(['A', 'B']);
    expect(parsed.lines).toEqual([3, 4]);
    expect(parsed.format.headerRow).toBe(2);
  });
});

describe('trimValues', () => {
  it('apara por padrão e preserva quando desligado', () => {
    expect(parseDelimitedTable('A;B\n 1 ; 2 ').rows[0]).toEqual(['1', '2']);
    const cru = parseDelimitedTable('A;B\n 1 ; 2 ', { trimValues: false });
    expect(cru.rows[0]).toEqual([' 1 ', ' 2 ']);
    expect(cru.format.trimValues).toBe(false);
  });

  it('preserva célula vazia', () => {
    expect(parseDelimitedTable('A;B;C\n1;;3').rows[0]).toEqual(['1', '', '3']);
  });
});

describe('sourceLine', () => {
  it('usa as linhas do parser e cai na aritmética quando elas não vieram', () => {
    const parsed = parseDelimitedTable('A;B\n1;2\n3;4');
    const table = { header: parsed.header, rows: parsed.rows, lines: parsed.lines };
    expect(sourceLine(table, 1)).toBe(3);
    expect(sourceLine({ header: table.header, rows: table.rows }, 1)).toBe(3);
    expect(sourceLine({ header: table.header, rows: table.rows }, 0, 3)).toBe(4);
  });
});
