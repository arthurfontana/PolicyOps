import { describe, expect, it } from 'vitest';
import { diffVersions, orderForCompare } from '@/core/diff';
import type { Domain } from '@/core/document/schema';
import { fixedId, IDS, RESTRITIVO_DOMAINS, SCORE_DOMAINS } from '../versioning/fixtures';
import {
  axisOf,
  documentWith,
  oneCellChanged,
  restritivoAxis,
  scoreAxis,
  twoIdenticalVersions,
  V1,
  V2,
  versionOf,
} from './fixtures';

/** docs/05-regras-de-negocio.md §4.1, §4.2 e §4.4. */

describe('diffVersions — comparabilidade (§4.1, §4.4)', () => {
  it('diff de uma versão consigo mesma é vazio e comparable', () => {
    const doc = twoIdenticalVersions();
    const diff = diffVersions(doc, V1, V1);
    expect(diff.comparable).toBe(true);
    expect(diff.incomparableReason).toBeUndefined();
    expect(diff.cells).toEqual([]);
    expect(diff.summaryText).toEqual([]);
    expect(diff.a.versionId).toBe(diff.b.versionId);
  });

  it('duas versões idênticas não produzem nenhuma mudança', () => {
    const diff = diffVersions(twoIdenticalVersions(), V1, V2);
    expect(diff.comparable).toBe(true);
    expect(diff.cells).toEqual([]);
    expect(diff.axes.x.addedTuples).toEqual([]);
    expect(diff.axes.y.removedTuples).toEqual([]);
    expect(diff.axes.x.reorderedTuples).toBe(false);
  });

  it('pilha de variáveis diferente → comparable: false, sem diff de células', () => {
    // v2 troca o eixo X de SCORE para SEGMENTO: os caminhos passam a
    // significar outra coisa.
    const segmentoAxis = axisOf('X', {
      levels: [
        {
          variableId: IDS.segmento,
          variableVersionId: IDS.segmentoV1,
          label: 'Segmento',
          domains: [{ code: 'VAREJO', label: 'Varejo', position: 0 }],
        },
      ],
      tuples: ['VAREJO'],
    });
    const doc = documentWith(
      versionOf(V1, 1, { x: scoreAxis(), y: restritivoAxis() }, { 'R1::SEM': { decision: 'APROVADO' } }),
      versionOf(V2, 2, { x: segmentoAxis, y: restritivoAxis() }, { 'VAREJO::SEM': { decision: 'REPROVADO' } }),
    );

    const diff = diffVersions(doc, V1, V2);
    expect(diff.comparable).toBe(false);
    expect(diff.incomparableReason).toBe('DIFFERENT_LEVELS');
    expect(diff.axes.x.levelsChanged).toBe(true);
    expect(diff.axes.y.levelsChanged).toBe(false);
    expect(diff.cells).toEqual([]);
    expect(diff.summaryText).toEqual([]);
  });

  it('nível acrescentado num eixo → comparable: false (a pilha mudou)', () => {
    const nested = axisOf('Y', {
      levels: [
        {
          variableId: IDS.restritivo,
          variableVersionId: IDS.restritivoV1,
          label: 'Restritivo',
          domains: RESTRITIVO_DOMAINS,
        },
        {
          variableId: IDS.segmento,
          variableVersionId: IDS.segmentoV1,
          label: 'Segmento',
          domains: [{ code: 'VAREJO', label: 'Varejo', position: 0 }],
        },
      ],
      tuples: ['SEM|VAREJO', 'ALTO|VAREJO'],
    });
    const doc = documentWith(
      versionOf(V1, 1, { x: scoreAxis(), y: restritivoAxis() }, {}),
      versionOf(V2, 2, { x: scoreAxis(), y: nested }, {}),
    );

    const diff = diffVersions(doc, V1, V2);
    expect(diff.comparable).toBe(false);
    expect(diff.axes.y.levelsChanged).toBe(true);
    expect(diff.axes.y.levels).toEqual([]);
  });

  it('as mesmas variáveis em outra ordem também são incomparáveis', () => {
    const xy = (first: 'score' | 'restritivo') =>
      axisOf('X', {
        levels:
          first === 'score'
            ? [
                { variableId: IDS.score, variableVersionId: IDS.scoreV1, label: 'Score', domains: SCORE_DOMAINS },
                { variableId: IDS.restritivo, variableVersionId: IDS.restritivoV1, label: 'Restritivo', domains: RESTRITIVO_DOMAINS },
              ]
            : [
                { variableId: IDS.restritivo, variableVersionId: IDS.restritivoV1, label: 'Restritivo', domains: RESTRITIVO_DOMAINS },
                { variableId: IDS.score, variableVersionId: IDS.scoreV1, label: 'Score', domains: SCORE_DOMAINS },
              ],
        tuples: first === 'score' ? ['R1|SEM'] : ['SEM|R1'],
      });
    const doc = documentWith(
      versionOf(V1, 1, { x: xy('score'), y: restritivoAxis() }, {}),
      versionOf(V2, 2, { x: xy('restritivo'), y: restritivoAxis() }, {}),
    );
    expect(diffVersions(doc, V1, V2).comparable).toBe(false);
  });
});

describe('diffVersions — diff de eixos (§4.1)', () => {
  it('mudança só no conjunto de tuplas não torna incomparável', () => {
    // Compatibilidade passou a excluir R3 e a incluir uma tupla nova.
    const doc = documentWith(
      versionOf(V1, 1, { x: scoreAxis(['R1', 'R2', 'R3']), y: restritivoAxis() }, {}),
      versionOf(V2, 2, { x: scoreAxis(['R1', 'R2']), y: restritivoAxis(['SEM']) }, {}),
    );

    const diff = diffVersions(doc, V1, V2);
    expect(diff.comparable).toBe(true);
    expect(diff.axes.x.removedTuples).toEqual(['R3']);
    expect(diff.axes.x.addedTuples).toEqual([]);
    expect(diff.axes.y.removedTuples).toEqual(['ALTO']);
    // 3×2 = 6 combinações antes, 2×1 = 2 depois: 4 saíram, nenhuma entrou.
    expect(diff.summary.combinationsRemoved).toBe(4);
    expect(diff.summary.combinationsAdded).toBe(0);
    expect(diff.summaryText).toEqual(['4 combinações removidas']);
  });

  it('reordenar tuplas é reordenação, não entrada e saída', () => {
    const doc = documentWith(
      versionOf(V1, 1, { x: scoreAxis(['R1', 'R2', 'R3']), y: restritivoAxis() }, {}),
      versionOf(V2, 2, { x: scoreAxis(['R3', 'R1', 'R2']), y: restritivoAxis() }, {}),
    );
    const diff = diffVersions(doc, V1, V2);
    expect(diff.axes.x.reorderedTuples).toBe(true);
    expect(diff.axes.x.addedTuples).toEqual([]);
    expect(diff.axes.x.removedTuples).toEqual([]);
    expect(diff.summary.combinationsAdded).toBe(0);
    expect(diff.summary.combinationsRemoved).toBe(0);
  });

  it('acrescentar uma tupla no meio não é reordenação', () => {
    const doc = documentWith(
      versionOf(V1, 1, { x: scoreAxis(['R1', 'R3']), y: restritivoAxis() }, {}),
      versionOf(V2, 2, { x: scoreAxis(['R1', 'R2', 'R3']), y: restritivoAxis() }, {}),
    );
    const diff = diffVersions(doc, V1, V2);
    expect(diff.axes.x.reorderedTuples).toBe(false);
    expect(diff.axes.x.addedTuples).toEqual(['R2']);
  });

  it('domínio renomeado (mesmo code) não produz mudança de célula, só relabeled', () => {
    const renamed: Domain[] = SCORE_DOMAINS.map((domain) =>
      domain.code === 'R1' ? { ...domain, label: 'R1 — Risco muito baixo' } : domain,
    );
    const renamedAxis = axisOf('X', {
      levels: [{ variableId: IDS.score, variableVersionId: IDS.scoreV1, label: 'Score', domains: renamed }],
      tuples: SCORE_DOMAINS.map((domain) => domain.code),
    });
    const cells = { 'R1::SEM': { decision: 'APROVADO' } };
    const doc = documentWith(
      versionOf(V1, 1, { x: scoreAxis(), y: restritivoAxis() }, structuredClone(cells)),
      versionOf(V2, 2, { x: renamedAxis, y: restritivoAxis() }, structuredClone(cells)),
    );

    const diff = diffVersions(doc, V1, V2);
    expect(diff.cells).toEqual([]);
    expect(diff.axes.x.levels[0]!.relabeled).toEqual([
      { code: 'R1', from: 'Rótulo R1', to: 'R1 — Risco muito baixo' },
    ]);
    expect(diff.axes.x.levels[0]!.addedDomains).toEqual([]);
    expect(diff.axes.x.levels[0]!.removedDomains).toEqual([]);
  });

  it('domínio acrescentado, removido e pin alterado aparecem por nível', () => {
    const doc = documentWith(
      versionOf(V1, 1, { x: scoreAxis(), y: restritivoAxis() }, {}),
      versionOf(V2, 2, { x: scoreAxis(), y: restritivoAxis() }, {}),
    );
    // v2 pina a versão 2 da variável Score, com R4 no lugar de R3.
    const scoreVariable = doc.variables.find((candidate) => candidate.id === IDS.score)!;
    scoreVariable.versions.push({
      id: IDS.scoreV2,
      number: 2,
      state: 'PUBLISHED',
      createdAt: '2026-01-02T00:00:00.000Z',
      createdBy: 'Equipe',
      domains: [...SCORE_DOMAINS.slice(0, 2), { code: 'R4', label: 'Rótulo R4', position: 2 }],
    });
    const level = doc.matrices[0]!.versions[1]!.axes.x.levels[0]!;
    level.variableVersionId = IDS.scoreV2;
    level.domains = scoreVariable.versions[1]!.domains;

    const levelDiff = diffVersions(doc, V1, V2).axes.x.levels[0]!;
    expect(levelDiff.pinChanged).toEqual({ from: 1, to: 2 });
    expect(levelDiff.addedDomains).toEqual(['R4']);
    expect(levelDiff.removedDomains).toEqual(['R3']);
  });
});

describe('diffVersions — diff de células (§4.2)', () => {
  it('tupla adicionada por compatibilidade → ADDED com reason NEW_TUPLE', () => {
    const doc = documentWith(
      versionOf(V1, 1, { x: scoreAxis(['R1', 'R2']), y: restritivoAxis() }, {}),
      versionOf(
        V2,
        2,
        { x: scoreAxis(['R1', 'R2', 'R3']), y: restritivoAxis() },
        { 'R3::SEM': { decision: 'APROVADO' } },
      ),
    );
    const diff = diffVersions(doc, V1, V2);
    expect(diff.cells).toEqual([
      { kind: 'ADDED', key: 'R3::SEM', reason: 'NEW_TUPLE', after: { decision: 'APROVADO' } },
    ]);
    expect(diff.summary.combinationsAdded).toBe(2);
  });

  it('combinação que existia e estava vazia → ADDED com reason WAS_EMPTY', () => {
    const doc = documentWith(
      versionOf(V1, 1, { x: scoreAxis(), y: restritivoAxis() }, {}),
      versionOf(V2, 2, { x: scoreAxis(), y: restritivoAxis() }, { 'R1::SEM': { decision: 'APROVADO' } }),
    );
    const diff = diffVersions(doc, V1, V2);
    expect(diff.cells).toEqual([
      { kind: 'ADDED', key: 'R1::SEM', reason: 'WAS_EMPTY', after: { decision: 'APROVADO' } },
    ]);
    expect(diff.summary.combinationsAdded).toBe(0);
  });

  it('célula limpa → REMOVED com reason NOW_EMPTY; tupla que sumiu → DROPPED_TUPLE', () => {
    const doc = documentWith(
      versionOf(
        V1,
        1,
        { x: scoreAxis(['R1', 'R2']), y: restritivoAxis() },
        { 'R1::SEM': { decision: 'APROVADO' }, 'R2::SEM': { decision: 'APROVADO' } },
      ),
      versionOf(V2, 2, { x: scoreAxis(['R1']), y: restritivoAxis() }, {}),
    );
    const diff = diffVersions(doc, V1, V2);
    const byKey = Object.fromEntries(diff.cells.map((change) => [change.key, change]));
    expect(byKey['R1::SEM']).toMatchObject({ kind: 'REMOVED', reason: 'NOW_EMPTY' });
    expect(byKey['R2::SEM']).toMatchObject({ kind: 'REMOVED', reason: 'DROPPED_TUPLE' });
  });

  it('MODIFIED nomeia exatamente os campos que mudaram', () => {
    const doc = oneCellChanged(
      { decision: 'APROVADO', offer: 'OFERTA_A', limit: 'LIM_1000', note: 'antes' },
      { decision: 'REPROVADO', offer: 'OFERTA_A', limit: 'LIM_1000', note: 'depois' },
    );
    const [change] = diffVersions(doc, V1, V2).cells;
    expect(change).toMatchObject({ kind: 'MODIFIED', key: 'R1::SEM', fields: ['decision', 'note'] });
  });

  it('mudança só em limitOverride entra no resultado com o campo nomeado', () => {
    const doc = oneCellChanged(
      { decision: 'APROVADO', limit: 'LIM_1000' },
      { decision: 'APROVADO', limit: 'LIM_1000', limitOverride: '2500' },
    );
    const diff = diffVersions(doc, V1, V2);
    expect(diff.cells).toHaveLength(1);
    expect(diff.cells[0]).toMatchObject({ kind: 'MODIFIED', fields: ['limitOverride'] });
    expect(diff.summary.limitsIncreased).toBe(1);
  });

  it('attrs é comparado por conteúdo, não por identidade', () => {
    const same = oneCellChanged(
      { decision: 'APROVADO', attrs: { canal: 'APP', prioridade: 3 } },
      { decision: 'APROVADO', attrs: { prioridade: 3, canal: 'APP' } },
    );
    expect(diffVersions(same, V1, V2).cells).toEqual([]);

    const different = oneCellChanged(
      { decision: 'APROVADO', attrs: { canal: 'APP' } },
      { decision: 'APROVADO', attrs: { canal: 'WEB' } },
    );
    expect(diffVersions(different, V1, V2).cells[0]).toMatchObject({ fields: ['attrs'] });

    const dropped = oneCellChanged(
      { decision: 'APROVADO', attrs: { canal: 'APP' } },
      { decision: 'APROVADO' },
    );
    expect(diffVersions(dropped, V1, V2).cells[0]).toMatchObject({ fields: ['attrs'] });
  });
});

describe('orderForCompare', () => {
  it('na mesma matriz, a versão de número menor é a base', () => {
    const doc = twoIdenticalVersions();
    expect(orderForCompare(doc, V2, V1)).toEqual({ aId: V1, bId: V2 });
    expect(orderForCompare(doc, V1, V2)).toEqual({ aId: V1, bId: V2 });
  });

  it('entre matrizes diferentes, a mais antiga por data de criação', () => {
    const doc = twoIdenticalVersions();
    const other = structuredClone(doc.matrices[0]!);
    other.id = fixedId('mtz2');
    other.code = 'MTZ_OUTRA';
    other.versions = [
      { ...other.versions[0]!, id: fixedId('outraV1'), createdAt: '2027-01-01T00:00:00.000Z' },
    ];
    doc.matrices.push(other);
    expect(orderForCompare(doc, fixedId('outraV1'), V1)).toEqual({
      aId: V1,
      bId: fixedId('outraV1'),
    });
  });
});
