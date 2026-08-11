import { describe, expect, it } from 'vitest';
import { encodeCellKey } from '@/core/axes/paths';
import { validateDocument } from '@/core/document/validate';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { applyStructural } from '@/core/import/apply-structural';
import { planImport, type ImportPlan } from '@/core/import/plan';
import { planStructuralChanges } from '@/core/import/structural';
import { applyCellPatches } from '@/core/versioning/cells';
import { publishVersion } from '@/core/versioning/lifecycle';
import { apply, expectFailure, testCtx } from '../versioning/fixtures';
import { cineminhaDocument, cineminhaProfile, excerptCsv, IDS, publishPlan, tableOf } from './fixtures';

/**
 * `import/applyStructural` — docs/12-carga-de-matrizes.md §5 (S25), o comando
 * que executa a resolução assistida de divergência estrutural.
 *
 * Cenário de base: G6 usa `SCORE_HVI4`, e o mapa de compatibilidade publicado
 * só libera `R01`–`R20` e `R99` para esse modelo. Uma linha nova com `R21`
 * (que já é domínio de `FAIXA_MODELO_ADICIONAL`) deixa as 6 matrizes de G6
 * `STRUCTURAL` — a divergência mais comum, resolvida só com compatibilidade e
 * resnapshot, sem criar domínio algum.
 */

const profile = cineminhaProfile();

function loadedDocument(): PolicyOpsDocument {
  const doc = cineminhaDocument();
  return publishPlan(doc, planImport(doc, tableOf(excerptCsv()), profile));
}

function withR21(): string {
  return `${excerptCsv().trimEnd()}\nG6;c.RISCO ALTO;HVI3;R01;HVI4;R21;15;15;15;15;15;15\n`;
}

function planOf(doc: PolicyOpsDocument, csv: string): ImportPlan {
  return planImport(doc, tableOf(csv), profile, { fileName: 'recorte.csv' });
}

function commandFor(
  doc: PolicyOpsDocument,
  csv: string,
  overrides: { selectedKeys?: string[]; planHash?: string } = {},
) {
  const plan = planOf(doc, csv);
  const structural = plan.matrices.filter((entry) => entry.status === 'STRUCTURAL').map((e) => e.key);
  return applyStructural({
    profile,
    table: tableOf(csv),
    fileName: 'recorte.csv',
    planHash: overrides.planHash ?? plan.planHash,
    selectedKeys: overrides.selectedKeys ?? structural,
  });
}

describe('import/applyStructural — resolve a divergência de compatibilidade', () => {
  it('publica uma versão nova da regra de compatibilidade, cria o rascunho e resnapshota — sem perder nada', () => {
    const doc = loadedDocument();
    const csv = withR21();
    const ctx = testCtx();

    // A matriz antes: célula em BHV_G1|R01 preservada, para comparar depois.
    const before = doc.matrices.find((m) => m.code === 'MTZ_G6_RISCO_ALTO_DIGITAL')!;
    const beforeVersion = before.versions[0]!;
    const beforeCellsSnapshot = JSON.stringify(beforeVersion.cells);

    const { document, data } = apply(doc, ctx, commandFor(doc, csv));

    expect(data.resolvedKeys).toHaveLength(6);
    expect(data.updatedCompatibilityRules).toEqual([IDS.compat]);
    expect(data.updatedVariables).toEqual([]);
    expect(data.createdDrafts).toHaveLength(6);

    const rule = document.compatibility.find((r) => r.id === IDS.compat)!;
    expect(rule.versions).toHaveLength(2);
    const published = rule.versions.find((v) => v.state === 'PUBLISHED')!;
    expect(published.allow.SCORE_HVI4).toContain('R21');

    const digital = document.matrices.find((m) => m.code === 'MTZ_G6_RISCO_ALTO_DIGITAL')!;
    expect(digital.versions).toHaveLength(2);
    const draft = digital.versions.find((v) => v.state === 'DRAFT')!;
    expect(draft.state).toBe('DRAFT'); // RN-10 — a resolução nunca publica a matriz.
    expect(draft.axes.y.tuples).toContain('SCORE_HVI4|R21');

    // Todas as células antigas sobrevivem, mapa inteiro — não só a contagem.
    const survivedCells = Object.fromEntries(
      Object.entries(draft.cells).filter(([key]) => key in beforeVersion.cells),
    );
    expect(JSON.stringify(survivedCells)).toBe(beforeCellsSnapshot);
    // A combinação nova nasce pendente (sem célula) até a carga normal preencher.
    expect(draft.cells['R01::SCORE_HVI4|R21']).toBeUndefined();

    expect(validateDocument(document).ok).toBe(true);
  });

  it('não publica nenhuma matriz (RN-10)', () => {
    const doc = loadedDocument();
    const ctx = testCtx();
    const { document } = apply(doc, ctx, commandFor(doc, withR21()));
    for (const matrix of document.matrices) {
      const publishedCount = matrix.versions.filter((v) => v.state === 'PUBLISHED').length;
      expect(publishedCount).toBeLessThanOrEqual(1);
    }
  });

  it('grava um evento IMPORT_RUN com as matrizes resolvidas', () => {
    const doc = loadedDocument();
    const ctx = testCtx();
    const { document } = apply(doc, ctx, commandFor(doc, withR21()));
    const events = document.events.filter((e) => e.type === 'IMPORT_RUN');
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as { resolvedKeys: string[] }).resolvedKeys).toHaveLength(6);
  });
});

describe('import/applyStructural — plano obsoleto (RN-14)', () => {
  it('recusa com IMPORT_PLAN_STALE quando o documento mudou desde o plano', () => {
    const doc = loadedDocument();
    const ctx = testCtx();
    expectFailure(
      doc,
      ctx,
      commandFor(doc, withR21(), { planHash: 'algo-que-nao-bate' }),
      'IMPORT_PLAN_STALE',
    );
  });
});

describe('import/applyStructural — seleção vazia', () => {
  it('recusa com IMPORT_NOTHING_TO_APPLY quando nada é selecionado', () => {
    const doc = loadedDocument();
    const ctx = testCtx();
    expectFailure(doc, ctx, commandFor(doc, withR21(), { selectedKeys: [] }), 'IMPORT_NOTHING_TO_APPLY');
  });
});

describe('import/applyStructural — lote com biblioteca compartilhada', () => {
  it('as 6 matrizes de G6 pedem a mesma mudança de compatibilidade e ela é aplicada uma vez só', () => {
    const doc = loadedDocument();
    const csv = withR21();
    const plan = planOf(doc, csv);
    const structural = planStructuralChanges(doc, plan);
    expect(structural).toHaveLength(6);
    // Mesma assinatura de mudança de biblioteca em todas — é o que o painel
    // agruparia como uma ação só.
    const ctx = testCtx();
    const { document } = apply(doc, ctx, commandFor(doc, csv));
    const rule = document.compatibility.find((r) => r.id === IDS.compat)!;
    // Uma única versão nova, não seis.
    expect(rule.versions).toHaveLength(2);
  });
});

describe('import/applyStructural — atomicidade', () => {
  it('erro no meio do lote não deixa a regra de compatibilidade publicada sem o resnapshot correspondente', () => {
    const doc = loadedDocument();
    const csv = withR21();
    const plan = planOf(doc, csv);
    const structuralKeys = plan.matrices.filter((entry) => entry.status === 'STRUCTURAL').map((e) => e.key);

    // Força a matriz de URA a já ter um rascunho aberto: o resnapshot dela
    // falha (DRAFT_ALREADY_EXISTS em `version/createDraft`) depois que a
    // biblioteca do lote já teria sido publicada.
    const uraCode = 'MTZ_G6_RISCO_ALTO_URA';
    const withOpenDraft: PolicyOpsDocument = {
      ...doc,
      matrices: doc.matrices.map((matrix) => {
        if (matrix.code !== uraCode) return matrix;
        const published = matrix.versions[0]!;
        return {
          ...matrix,
          versions: [
            published,
            {
              ...published,
              id: 'MV_OPEN_DRAFT',
              number: 2,
              state: 'DRAFT' as const,
              publishedAt: undefined,
              publishedBy: undefined,
            },
          ],
        };
      }),
    };

    const ctx = testCtx();
    const command = applyStructural({
      profile,
      table: tableOf(csv),
      fileName: 'recorte.csv',
      planHash: planImport(withOpenDraft, tableOf(csv), profile, { fileName: 'recorte.csv' }).planHash,
      selectedKeys: structuralKeys,
    });

    // Um erro no meio do lote (aqui, `version/createDraft` recusando porque a
    // matriz de URA já tem rascunho aberto) propaga para fora de `execute` e
    // `defineCommand` devolve `{ ok: false }` com o documento **recebido**
    // intocado — nenhuma das matrizes já processadas no lote fica gravada.
    const error = expectFailure(withOpenDraft, ctx, command, 'DRAFT_ALREADY_EXISTS');
    expect(error).toBeDefined();

    // A regra de compatibilidade segue com uma única versão — nada publicado.
    const rule = withOpenDraft.compatibility.find((r) => r.id === IDS.compat)!;
    expect(rule.versions).toHaveLength(1);
  });
});

describe('import/applyStructural — reclassificação (idempotência de CT-01)', () => {
  it('depois de resolver e publicar, a mesma carga aplica normalmente e a segunda passada volta UNCHANGED', () => {
    const doc = loadedDocument();
    const csv = withR21();
    const ctx = testCtx();

    const resolved = apply(doc, ctx, commandFor(doc, csv)).document;

    // O resnapshot abre 21 combinações novas por matriz (a tupla Y nova ×
    // todo o eixo X) — só a de `X = R01` tem linha no arquivo; as outras 20
    // não têm dado nenhum na carga real (não são "linha ausente" de RN-07,
    // são combinação que não existia até agora). RN-11 exige decisão em toda
    // célula publicável, então o teste preenche todas antes de publicar —
    // como faria alguém revisando o rascunho antes de decidir a política
    // nova — e mantém `X = R01` idêntico ao que o arquivo traz, para que a
    // recarga do mesmo arquivo depois continue batendo (`missingRowPolicy:
    // KEEP` preserva as outras 20, que o arquivo não menciona).
    let filled = resolved;
    for (const matrix of resolved.matrices) {
      const draft = matrix.versions.find((v) => v.state === 'DRAFT');
      if (draft === undefined) continue;
      const pendingX = draft.axes.x.tuples.filter(
        (xPath) => draft.cells[encodeCellKey(xPath, 'SCORE_HVI4|R21')] === undefined,
      );
      if (pendingX.length === 0) continue;
      filled = apply(
        filled,
        ctx,
        applyCellPatches(
          {
            versionId: draft.id,
            patches: [
              {
                coords: pendingX.map((xPath) => ({ xPath, yPath: 'SCORE_HVI4|R21' })),
                set: { decision: 'APROVADO', offer: 'OFERTA_15' },
              },
            ],
          },
          'Preenche as combinações novas',
        ),
      ).document;
    }

    // Publica os rascunhos que a resolução criou (fluxo normal, RN-10).
    ctx.advance(24 * 60 * 60 * 1000);
    let published = filled;
    for (const matrix of filled.matrices) {
      const draft = matrix.versions.find((v) => v.state === 'DRAFT');
      if (draft === undefined) continue;
      published = apply(published, ctx, publishVersion({ versionId: draft.id, notes: 'Resolução de estrutura' }))
        .document;
    }

    // A mesma carga agora reclassifica: nada mais é STRUCTURAL — a matriz saiu
    // de "estrutura divergente" para o caminho normal de comparação de
    // células (CT-01), e como o conteúdo já bate com o arquivo, ela volta
    // UNCHANGED, exatamente a idempotência que CT-01 exige.
    const secondPlan = planImport(published, tableOf(csv), profile, { fileName: 'recorte.csv' });
    expect(secondPlan.totals.structural).toBe(0);
    expect(secondPlan.totals.changed).toBe(0);
    expect(secondPlan.totals.unchanged).toBe(18);
    expect(validateDocument(published).ok).toBe(true);
  });
});
