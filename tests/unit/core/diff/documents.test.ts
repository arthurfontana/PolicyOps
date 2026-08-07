import { describe, expect, it } from 'vitest';
import { diffDocuments } from '@/core/diff/documents';
import { fixedId } from '../versioning/fixtures';
import { twoIdenticalVersions, V1, V2 } from './fixtures';

/**
 * Diff entre documentos — docs/06-persistencia-e-concorrencia.md §5, o que o
 * conflito de salvamento mostra em "Ver o que mudou".
 */

describe('diffDocuments', () => {
  it('documentos iguais não têm nenhuma versão divergente', () => {
    const mine = twoIdenticalVersions();
    expect(diffDocuments(mine, structuredClone(mine))).toEqual([]);
  });

  it('lista a versão que mudou, com o remoto como base', () => {
    const theirs = twoIdenticalVersions();
    const mine = structuredClone(theirs);
    mine.matrices[0]!.versions[1]!.cells['R1::SEM'] = { decision: 'REPROVADO' };

    const entries = diffDocuments(mine, theirs);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry!.status).toBe('CHANGED');
    expect(entry!.versionId).toBe(V2);
    expect(entry!.matrixCode).toBe('MTZ_DIFF');
    // A base é o remoto: o diff descreve o que o **meu** salvamento faria.
    expect(entry!.diff!.a.versionId).toBe(V2);
    expect(entry!.diff!.summary.cellsClosed).toBe(1);
    expect(entry!.diff!.summaryText).toEqual(['1 célula fechada']);
  });

  it('mudança estrutural de eixo também entra, mesmo sem célula diferente', () => {
    const theirs = twoIdenticalVersions();
    const mine = structuredClone(theirs);
    mine.matrices[0]!.versions[0]!.axes.x.tuples = ['R1', 'R2'];

    const entries = diffDocuments(mine, theirs);
    expect(entries.map((entry) => entry.versionId)).toEqual([V1]);
    expect(entries[0]!.diff!.axes.x.removedTuples).toEqual(['R3']);
  });

  it('versão que existe só de um lado entra sem diff', () => {
    const theirs = twoIdenticalVersions();
    const mine = structuredClone(theirs);
    const extra = structuredClone(mine.matrices[0]!.versions[1]!);
    extra.id = fixedId('v3');
    extra.number = 3;
    mine.matrices[0]!.versions.push(extra);

    const entries = diffDocuments(mine, theirs);
    expect(entries).toEqual([
      expect.objectContaining({ versionId: fixedId('v3'), status: 'ONLY_MINE', diff: null }),
    ]);

    const reversed = diffDocuments(theirs, mine);
    expect(reversed).toEqual([
      expect.objectContaining({ versionId: fixedId('v3'), status: 'ONLY_THEIRS', diff: null }),
    ]);
  });
});
