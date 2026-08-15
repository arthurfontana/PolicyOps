import { describe, expect, it } from 'vitest';
import { createComponent } from '@/core/document/components';
import { parseMarkdownPolicy } from '@/core/import/markdown-policy';
import { planMarkdownImport } from '@/core/import/markdown-plan';
import { apply, baseDocument, IDS, testCtx } from '../versioning/fixtures';

/**
 * Passo de revisão da carga por recorte — docs/14 §9 passo 2/3. Cobre o
 * destino (raiz, seção existente, seção inexistente, matriz recusada),
 * profundidade (I28), duplicata de `code` (E-GOV-06), exclusão de linha (e a
 * subárvore junto) e troca de tipo na revisão.
 */

function existingSection(name = 'Bloqueios por Dívida', code = 'BLOQUEIOS_POR_DIVIDA') {
  const ctx = testCtx();
  const created = apply(
    baseDocument(),
    ctx,
    createComponent({ projectId: IDS.projectA, code, name, type: 'SECTION' }),
  );
  return { doc: created.document, componentId: created.data.componentId, ctx };
}

describe('planMarkdownImport — destino', () => {
  it('raiz do projeto (sem parentId): profundidade absoluta = profundidade relativa do recorte', () => {
    const parsed = parseMarkdownPolicy('# Regra\nTexto.');
    const plan = planMarkdownImport({ doc: baseDocument(), projectId: IDS.projectA, parsed });
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]!.depth).toBe(1);
    expect(plan.parentId).toBeUndefined();
    expect(plan.blocked).toBe(false);
  });

  it('destino é uma seção existente: profundidade soma a profundidade do destino', () => {
    const { doc, componentId } = existingSection();
    const parsed = parseMarkdownPolicy('### Dívida Acima de R$ 5.000\nTexto.');
    const plan = planMarkdownImport({ doc, projectId: IDS.projectA, parentId: componentId, parsed });
    expect(plan.rows[0]!.depth).toBe(2); // destino é nível 1, recorte entra no nível 2
    expect(plan.parentId).toBe(componentId);
    expect(plan.blocked).toBe(false);
  });

  it('destino inexistente bloqueia o plano inteiro (nenhuma linha aplicável)', () => {
    const parsed = parseMarkdownPolicy('# Regra\nTexto.');
    const plan = planMarkdownImport({ doc: baseDocument(), projectId: IDS.projectA, parentId: 'nao-existe', parsed });
    expect(plan.blocked).toBe(true);
    expect(plan.issues.some((issue) => issue.code === 'COMPONENT_TREE_INVALID')).toBe(true);
    expect(plan.rows.every((row) => row.excluded)).toBe(true);
  });

  it('destino de outro projeto é tratado como inexistente', () => {
    const { componentId } = existingSection();
    const parsed = parseMarkdownPolicy('# Regra\nTexto.');
    const plan = planMarkdownImport({ doc: baseDocument(), projectId: IDS.projectB, parentId: componentId, parsed });
    expect(plan.blocked).toBe(true);
    expect(plan.issues.some((issue) => issue.code === 'COMPONENT_TREE_INVALID')).toBe(true);
  });

  it('destino do tipo MATRIX é recusado (matriz é sempre folha)', () => {
    // Só o suficiente para o teste do destino — não precisa de uma `Matrix`
    // real em `doc.matrices`, já que `planMarkdownImport` nunca chega a olhar
    // `matrixId`; ele recusa pelo `type` antes disso.
    const doc = baseDocument();
    doc.components.push({
      id: 'matriz-fake',
      projectId: IDS.projectA,
      position: 0,
      code: 'MTZ_TESTE',
      name: 'Matriz Teste',
      type: 'MATRIX',
      matrixId: 'nao-usado',
      reviewStatus: 'STRUCTURED',
      createdAt: '2026-01-01T00:00:00.000Z',
      versions: [],
    });
    const parsed = parseMarkdownPolicy('# Regra\nTexto.');
    const plan = planMarkdownImport({ doc, projectId: IDS.projectA, parentId: 'matriz-fake', parsed });
    expect(plan.blocked).toBe(true);
    expect(plan.issues.some((issue) => issue.code === 'COMPONENT_TREE_INVALID')).toBe(true);
  });
});

describe('planMarkdownImport — profundidade (I28)', () => {
  it('recorte que estouraria o nível 6 gera aviso bloqueante na linha, sem travar as demais', () => {
    // Seção existente já no nível 5 (4 seções empilhadas): um recorte de dois
    // níveis (## dentro de #) chegaria ao nível 7 no segundo nó.
    let doc = baseDocument();
    let parentId: string | undefined;
    const ctx = testCtx();
    for (let i = 0; i < 4; i++) {
      const created = apply(
        doc,
        ctx,
        createComponent({
          projectId: IDS.projectA,
          code: `NIVEL_${i}`,
          name: `Nível ${i}`,
          type: 'SECTION',
          ...(parentId === undefined ? {} : { parentId }),
        }),
      );
      doc = created.document;
      parentId = created.data.componentId;
    }
    // `parentId` agora está no nível 4.
    const parsed = parseMarkdownPolicy('# Nível 5\n## Nível 6\n### Nível 7 — estoura');
    const plan = planMarkdownImport({ doc, projectId: IDS.projectA, parentId, parsed });
    const estourado = plan.rows.find((row) => row.name === 'Nível 7 — estoura')!;
    expect(estourado.depth).toBe(7);
    expect(estourado.issues.some((issue) => issue.code === 'COMPONENT_TREE_INVALID')).toBe(true);
    const nivel5 = plan.rows.find((row) => row.name === 'Nível 5')!;
    expect(nivel5.depth).toBe(5);
    expect(nivel5.issues.some((issue) => issue.code === 'COMPONENT_TREE_INVALID')).toBe(false);
    expect(plan.blocked).toBe(true);
  });
});

describe('planMarkdownImport — duplicata de code (E-GOV-06)', () => {
  it('code que já existe no projeto bloqueia a linha, apontando o componente existente', () => {
    const { doc, componentId } = existingSection('Bloqueios por Dívida', 'REGRA_DIVIDA_5000');
    const parsed = parseMarkdownPolicy('# Dívida Acima de R$ 5.000\nTexto.\n> Código: REGRA_DIVIDA_5000');
    const plan = planMarkdownImport({ doc, projectId: IDS.projectA, parsed });
    expect(plan.rows).toHaveLength(1);
    const row = plan.rows[0]!;
    const duplicateIssue = row.issues.find((issue) => issue.code === 'COMPONENT_CODE_DUPLICATE');
    expect(duplicateIssue).toBeDefined();
    expect(duplicateIssue!.details).toEqual({ componentId });
    expect(plan.blocked).toBe(true);
  });

  it('colar o mesmo recorte duas vezes no mesmo destino detecta a segunda como duplicata (sem duplicar)', () => {
    const parsed = parseMarkdownPolicy('# Override\nTexto.');
    const ctx = testCtx();
    const firstPlan = planMarkdownImport({ doc: baseDocument(), projectId: IDS.projectA, parsed });
    expect(firstPlan.blocked).toBe(false);
    const applied = apply(
      baseDocument(),
      ctx,
      createComponent({ projectId: IDS.projectA, code: firstPlan.rows[0]!.code, name: 'Override', type: 'RULE' }),
    );
    const secondParsed = parseMarkdownPolicy('# Override\nTexto colado de novo.');
    const secondPlan = planMarkdownImport({ doc: applied.document, projectId: IDS.projectA, parsed: secondParsed });
    expect(secondPlan.rows[0]!.issues.some((issue) => issue.code === 'COMPONENT_CODE_DUPLICATE')).toBe(true);
    expect(secondPlan.blocked).toBe(true);
  });

  it('excluir a linha duplicada desbloqueia o plano', () => {
    const { doc } = existingSection('Bloqueios por Dívida', 'REGRA_DIVIDA_5000');
    const parsed = parseMarkdownPolicy(
      ['# Dívida Acima de R$ 5.000', 'Texto.', '> Código: REGRA_DIVIDA_5000', '', '# Outra Regra', 'Texto.'].join('\n'),
    );
    const tempId = parsed.roots[0]!.tempId;
    const plan = planMarkdownImport({ doc, projectId: IDS.projectA, parsed, excludedTempIds: [tempId] });
    expect(plan.rows.find((row) => row.tempId === tempId)!.excluded).toBe(true);
    expect(plan.blocked).toBe(false);
  });
});

describe('planMarkdownImport — exclusão em lote', () => {
  it('excluir um nó com filhos leva a subárvore inteira junto (exclusão transitiva)', () => {
    const parsed = parseMarkdownPolicy(['# Bloqueios por Dívida', '## Dívida Acima de R$ 5.000', 'Texto.'].join('\n'));
    const pai = parsed.roots[0]!;
    const filho = pai.children[0]!;
    const plan = planMarkdownImport({ doc: baseDocument(), projectId: IDS.projectA, parsed, excludedTempIds: [pai.tempId] });
    expect(plan.rows.find((row) => row.tempId === pai.tempId)!.excluded).toBe(true);
    expect(plan.rows.find((row) => row.tempId === filho.tempId)!.excluded).toBe(true);
    expect(plan.totals.total).toBe(0);
  });

  it('excluir tudo bloqueia o plano ("nada para aplicar")', () => {
    const parsed = parseMarkdownPolicy('# Regra\nTexto.');
    const plan = planMarkdownImport({
      doc: baseDocument(),
      projectId: IDS.projectA,
      parsed,
      excludedTempIds: [parsed.roots[0]!.tempId],
    });
    expect(plan.blocked).toBe(true);
  });
});

describe('planMarkdownImport — troca de tipo na revisão', () => {
  it('sem override, mantém tipo e payload do parser', () => {
    const parsed = parseMarkdownPolicy('# Goodlist\nLista de aprovação automática.');
    const plan = planMarkdownImport({ doc: baseDocument(), projectId: IDS.projectA, parsed });
    const row = plan.rows[0]!;
    expect(row.type).toBe('RULE');
    expect(row.typeSource).toBe('HEURISTIC');
    expect(row.payload.kind).toBe('RULE');
  });

  it('com override, reconstrói o payload para o novo tipo e marca typeSource EXPLICIT', () => {
    const parsed = parseMarkdownPolicy(
      ['# Goodlist', 'Lista de aprovação automática.', '> Reason code: GD01'].join('\n'),
    );
    const tempId = parsed.roots[0]!.tempId;
    const plan = planMarkdownImport({
      doc: baseDocument(),
      projectId: IDS.projectA,
      parsed,
      typeOverrides: new Map([[tempId, 'LIST']]),
    });
    const row = plan.rows[0]!;
    expect(row.type).toBe('LIST');
    expect(row.typeSource).toBe('EXPLICIT');
    expect(row.payload).toEqual({
      kind: 'LIST',
      businessDescription: 'Lista de aprovação automática.',
      notes: 'Reason code: GD01',
    });
  });
});

describe('planMarkdownImport — totais e issues de documento', () => {
  it('conta por tipo só as linhas não excluídas', () => {
    const parsed = parseMarkdownPolicy(
      ['# Seção', 'Texto.', '> Tipo: SECTION', '## Regra A', 'Texto.', '## Regra B', 'Texto.'].join('\n'),
    );
    const regraB = parsed.roots[0]!.children[1]!;
    const plan = planMarkdownImport({
      doc: baseDocument(),
      projectId: IDS.projectA,
      parsed,
      excludedTempIds: [regraB.tempId],
    });
    expect(plan.totals).toEqual({ total: 2, byType: { SECTION: 1, RULE: 1 } });
  });

  it('propaga os avisos do parser (heurística, malformado) para `plan.issues`', () => {
    const parsed = parseMarkdownPolicy('Texto sem nenhum heading.');
    const plan = planMarkdownImport({ doc: baseDocument(), projectId: IDS.projectA, parsed });
    expect(plan.issues.some((issue) => issue.code === 'MARKDOWN_NO_HEADINGS')).toBe(true);
    expect(plan.rows).toEqual([]);
    expect(plan.blocked).toBe(true);
  });
});
