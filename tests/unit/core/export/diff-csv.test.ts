import { describe, expect, it } from 'vitest';
import { diffVersions } from '@/core/diff';
import { diffCsvFileName, exportDiffCsv } from '@/core/export/diff-csv';
import { oneCellChanged, V1, V2 } from '../diff/fixtures';

/** docs/08-camada-de-comandos.md §5: `caminho_x;caminho_y;campo;antes;depois;tipo`. */

function parseCsv(csv: string): string[][] {
  return csv
    .replace(/^\uFEFF/, '')
    .trimEnd()
    .split('\r\n')
    .map((line) => line.split(';'));
}

describe('exportDiffCsv', () => {
  it('tem o cabeçalho exato de docs/08 §5', () => {
    const doc = oneCellChanged({ decision: 'APROVADO' }, { decision: 'REPROVADO' });
    const diff = diffVersions(doc, V1, V2);
    const [header] = parseCsv(exportDiffCsv(doc, diff));
    expect(header).toEqual(['caminho_x', 'caminho_y', 'campo', 'antes', 'depois', 'tipo']);
  });

  it('célula modificada: uma linha por campo alterado, com rótulo do catálogo em decisão', () => {
    const doc = oneCellChanged(
      { decision: 'APROVADO', offer: 'OFERTA_A' },
      { decision: 'REPROVADO', offer: 'OFERTA_A' },
    );
    const diff = diffVersions(doc, V1, V2);
    const rows = parseCsv(exportDiffCsv(doc, diff)).slice(1);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['R1', 'SEM', 'decisao', 'Aprovado', 'Reprovado', 'MODIFICADA']);
  });

  it('célula que passou a existir (WAS_EMPTY): antes vazio, depois com o valor', () => {
    // "Célula vazia não é gravada" (docs/03 §6.2): a chave fica ausente do
    // mapa de A, não presente com objeto vazio — é o que a produz `ADDED`.
    const doc = oneCellChanged({ decision: 'X' }, { decision: 'APROVADO' });
    doc.matrices[0]!.versions[0]!.cells = {};
    const diff = diffVersions(doc, V1, V2);
    const rows = parseCsv(exportDiffCsv(doc, diff)).slice(1);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['R1', 'SEM', 'decisao', '', 'Aprovado', 'ADICIONADA']);
  });

  it('célula que ficou vazia (NOW_EMPTY): antes com o valor, depois vazio', () => {
    const doc = oneCellChanged({ decision: 'APROVADO' }, { decision: 'X' });
    doc.matrices[0]!.versions[1]!.cells = {};
    const diff = diffVersions(doc, V1, V2);
    const rows = parseCsv(exportDiffCsv(doc, diff)).slice(1);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['R1', 'SEM', 'decisao', 'Aprovado', '', 'REMOVIDA']);
  });

  it('limite_valor usa decimal com vírgula', () => {
    const doc = oneCellChanged({ limitOverride: '1000.00' }, { limitOverride: '2500.50' });
    const diff = diffVersions(doc, V1, V2);
    const rows = parseCsv(exportDiffCsv(doc, diff)).slice(1);

    const row = rows.find((fields) => fields[2] === 'limite_valor')!;
    expect(row).toEqual(['R1', 'SEM', 'limite_valor', '1000,00', '2500,50', 'MODIFICADA']);
  });

  it('sem nenhuma mudança, só o cabeçalho', () => {
    const doc = oneCellChanged({ decision: 'APROVADO' }, { decision: 'APROVADO' });
    const diff = diffVersions(doc, V1, V2);
    expect(parseCsv(exportDiffCsv(doc, diff))).toHaveLength(1);
  });
});

describe('diffCsvFileName', () => {
  it('segue diff_{matrixCode}_v{a}_v{b}.csv', () => {
    expect(diffCsvFileName('MTZ_LIMITE_PJ', 11, 12)).toBe('diff_MTZ_LIMITE_PJ_v11_v12.csv');
  });
});
