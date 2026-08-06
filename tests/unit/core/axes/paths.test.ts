import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AXIS_SEP,
  LEVEL_SEP,
  decodeCellKey,
  decodePath,
  encodeCellKey,
  encodePath,
  isDescendantOf,
  pathDepth,
  pathPrefix,
} from '@/core/axes/paths';
import { isDomainError } from '@/core/errors';

describe('encodePath / decodePath', () => {
  it('faz round-trip com 1, 2 e 3 níveis', () => {
    const cases = [['R1'], ['VAREJO', '500K_1M'], ['VAREJO', 'MEDIO', 'ACIMA_10M']];
    for (const codes of cases) {
      expect(decodePath(encodePath(codes))).toEqual(codes);
    }
  });

  it('aceita códigos com "_" e dígitos', () => {
    expect(encodePath(['100K_500K', 'R6', 'A_1_B'])).toBe('100K_500K|R6|A_1_B');
    expect(decodePath('100K_500K|R6|A_1_B')).toEqual(['100K_500K', 'R6', 'A_1_B']);
  });

  it('rejeita código contendo o separador de nível', () => {
    expect(() => encodePath(['VAREJO|ATACADO'])).toThrowError(/Código inválido/);
    try {
      encodePath(['VAREJO|ATACADO']);
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe('INVALID_INPUT');
    }
  });

  it('rejeita código contendo o separador de eixo', () => {
    expect(() => encodePath(['VAREJO::R1'])).toThrowError(/Código inválido/);
    expect(() => encodePath(['A:B'])).toThrowError(/Código inválido/);
  });

  it('rejeita código fora de ^[A-Z0-9_]+$ e caminho sem nenhum código', () => {
    expect(() => encodePath(['varejo'])).toThrowError(/Código inválido/);
    expect(() => encodePath([''])).toThrowError(/Código inválido/);
    expect(() => encodePath([])).toThrowError(/pelo menos um código/);
  });

  it('rejeita caminho vazio na decodificação', () => {
    expect(() => decodePath('')).toThrowError(/Caminho vazio/);
  });

  it('conta a profundidade do caminho', () => {
    expect(pathDepth('R1')).toBe(1);
    expect(pathDepth('VAREJO|500K_1M')).toBe(2);
  });
});

describe('injetividade da codificação', () => {
  const codeArb = fc.stringMatching(/^[A-Z0-9_]{1,8}$/);
  const pathArb = fc.array(codeArb, { minLength: 1, maxLength: 3 });

  it('decode(encode(codes)) === codes para qualquer código válido', () => {
    fc.assert(
      fc.property(pathArb, (codes) => {
        expect(decodePath(encodePath(codes))).toEqual(codes);
      }),
    );
  });

  it('caminhos diferentes nunca colidem na mesma string', () => {
    fc.assert(
      fc.property(pathArb, pathArb, (a, b) => {
        fc.pre(JSON.stringify(a) !== JSON.stringify(b));
        expect(encodePath(a)).not.toBe(encodePath(b));
      }),
    );
  });

  it('a chave de célula sempre se decompõe de volta nos dois caminhos', () => {
    fc.assert(
      fc.property(pathArb, pathArb, (x, y) => {
        const xPath = encodePath(x);
        const yPath = encodePath(y);
        expect(decodeCellKey(encodeCellKey(xPath, yPath))).toEqual({ xPath, yPath });
      }),
    );
  });
});

describe('encodeCellKey / decodeCellKey', () => {
  it('usa os separadores documentados', () => {
    expect(LEVEL_SEP).toBe('|');
    expect(AXIS_SEP).toBe('::');
    expect(encodeCellKey('R1', 'VAREJO|500K_1M')).toBe('R1::VAREJO|500K_1M');
  });

  it('faz round-trip com caminhos de níveis diferentes nos dois eixos', () => {
    const key = encodeCellKey('R1', 'VAREJO|500K_1M');
    expect(decodeCellKey(key)).toEqual({ xPath: 'R1', yPath: 'VAREJO|500K_1M' });
  });

  it('rejeita chave sem o separador de eixo', () => {
    expect(() => decodeCellKey('R1|VAREJO')).toThrowError(/Chave de célula inválida/);
  });
});

describe('pathPrefix', () => {
  it('recorta o caminho até o nível pedido', () => {
    expect(pathPrefix('VAREJO|500K_1M|ALTO', 1)).toBe('VAREJO');
    expect(pathPrefix('VAREJO|500K_1M|ALTO', 2)).toBe('VAREJO|500K_1M');
    expect(pathPrefix('VAREJO|500K_1M|ALTO', 3)).toBe('VAREJO|500K_1M|ALTO');
  });

  it('devolve o caminho inteiro quando o nível pedido passa da profundidade', () => {
    expect(pathPrefix('VAREJO', 3)).toBe('VAREJO');
  });

  it('rejeita prefixo de zero níveis', () => {
    expect(() => pathPrefix('VAREJO', 0)).toThrowError(/pelo menos 1 nível/);
  });
});

describe('isDescendantOf', () => {
  it('um caminho é descendente do próprio prefixo', () => {
    expect(isDescendantOf('VAREJO', 'VAREJO')).toBe(true);
    expect(isDescendantOf('VAREJO|500K_1M', 'VAREJO')).toBe(true);
    expect(isDescendantOf('VAREJO|500K_1M|X', 'VAREJO|500K_1M')).toBe(true);
  });

  it('não confunde prefixo textual com prefixo de nível', () => {
    expect(isDescendantOf('VAREJO_ONLINE|X', 'VAREJO')).toBe(false);
    expect(isDescendantOf('ATACADO|500K_1M', 'VAREJO')).toBe(false);
    expect(isDescendantOf('VAREJO', 'VAREJO|500K_1M')).toBe(false);
  });
});
