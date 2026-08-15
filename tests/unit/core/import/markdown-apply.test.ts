import { describe, expect, it } from 'vitest';
import { createComponent, listChildren } from '@/core/document/components';
import { validateDocument } from '@/core/document/validate';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { applyMarkdownImport } from '@/core/import/markdown-apply';
import { parseMarkdownPolicy } from '@/core/import/markdown-policy';
import { planMarkdownImport, type MarkdownImportRow } from '@/core/import/markdown-plan';
import { createComponentDraft } from '@/core/versioning/component-lifecycle';
import { apply, baseDocument, expectFailure, IDS, testCtx } from '../versioning/fixtures';

/**
 * `component/importMarkdown` — CT-GOV-05 (docs/14 §10): carga inicial
 * preserva origem, e desfazer remove a carga inteira. Como o comando publica
 * de propósito (docs/14 §9 passo 4), o desfazer é dedicado — não a composição
 * genérica dos inversos dos subcomandos (ver o comentário no topo de
 * `markdown-apply.ts`); os testes de undo/redo cobrem exatamente essa parte.
 */

const EFFECTIVE_FROM = '2026-09-01T00:00:00.000Z';

function rowsFor(doc: PolicyOpsDocument, markdown: string, parentId?: string): MarkdownImportRow[] {
  const parsed = parseMarkdownPolicy(markdown);
  const plan = planMarkdownImport({ doc, projectId: IDS.projectA, parsed, ...(parentId === undefined ? {} : { parentId }) });
  expect(plan.blocked, `plano bloqueado: ${JSON.stringify(plan.issues)}`).toBe(false);
  return plan.rows.filter((row) => !row.excluded);
}

/** Um capítulo com 3 seções × 4 regras — o formato do CT-GOV-05. */
function chapterMarkdown(): string {
  const sections = ['Decisões Soberanas', 'Regras Duras', 'Segmentação'];
  const lines: string[] = [];
  for (const section of sections) {
    lines.push(`# ${section}`, `Visão geral de ${section}.`, '> Tipo: SECTION', '');
    for (let i = 1; i <= 4; i++) {
      lines.push(
        `## ${section} — Regra ${i}`,
        `Texto de negócio da regra ${i}.`,
        '> Tipo: RULE',
        `> Reason code: RC0${i}`,
        `> Fonte: Filtros e Critérios B2C, p. ${i}`,
        '',
      );
    }
  }
  return lines.join('\n');
}

describe('component/importMarkdown — CT-GOV-05', () => {
  it('3 seções e 12 regras entram com hierarquia, origin e reviewStatus PENDING_REVIEW, cada uma PUBLISHED v1', () => {
    const ctx = testCtx();
    const rows = rowsFor(baseDocument(), chapterMarkdown());
    const result = apply(
      baseDocument(),
      ctx,
      applyMarkdownImport({ projectId: IDS.projectA, rows, effectiveFrom: EFFECTIVE_FROM }),
    );

    expect(result.data.createdComponentIds).toHaveLength(15); // 3 seções + 12 regras
    const sections = result.document.components.filter((c) => c.type === 'SECTION');
    const rules = result.document.components.filter((c) => c.type === 'RULE');
    expect(sections).toHaveLength(3);
    expect(rules).toHaveLength(12);

    for (const component of result.document.components) {
      expect(component.reviewStatus).toBe('PENDING_REVIEW');
      expect(component.versions).toHaveLength(1);
      const version = component.versions[0]!;
      expect(version.state).toBe('PUBLISHED');
      expect(version.effectiveFrom).toBe(EFFECTIVE_FROM);
    }
    for (const rule of rules) {
      expect(rule.origin?.source).toBe('Filtros e Critérios B2C');
    }
    // Cada regra é filha da sua seção — nada nasce solto na raiz.
    for (const section of sections) {
      expect(listChildren(result.document, IDS.projectA, section.id)).toHaveLength(4);
    }
    expect(validateDocument(result.document).ok).toBe(true);
  });

  it('desfazer (undo) remove a carga inteira, devolvendo o documento ao estado anterior', () => {
    const ctx = testCtx();
    const before = baseDocument();
    const rows = rowsFor(before, chapterMarkdown());
    const applied = apply(before, ctx, applyMarkdownImport({ projectId: IDS.projectA, rows, effectiveFrom: EFFECTIVE_FROM }));

    const undone = apply(applied.document, ctx, applied.result.inverse);
    expect(undone.document.components).toEqual(before.components);
  });

  it('refazer (redo — o inverso do desfazer) recria a carga inteira, idêntica', () => {
    const ctx = testCtx();
    const rows = rowsFor(baseDocument(), chapterMarkdown());
    const applied = apply(baseDocument(), ctx, applyMarkdownImport({ projectId: IDS.projectA, rows, effectiveFrom: EFFECTIVE_FROM }));
    const undone = apply(applied.document, ctx, applied.result.inverse);
    const redone = apply(undone.document, ctx, undone.result.inverse);
    expect(redone.document.components).toEqual(applied.document.components);
  });
});

describe('component/importMarkdown — recorte dentro de uma seção existente (S33a)', () => {
  it('convive com os componentes já cadastrados, sem duplicar nem reordenar o que já existia', () => {
    const ctx = testCtx();
    const withSection = apply(
      baseDocument(),
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'BLOQUEIOS_POR_DIVIDA', name: 'Bloqueios por Dívida', type: 'SECTION' }),
    );
    const sectionId = withSection.data.componentId;
    const withHandMade = apply(
      withSection.document,
      ctx,
      createComponent({
        projectId: IDS.projectA,
        code: 'REGRA_CADASTRADA_A_MAO',
        name: 'Regra Cadastrada à Mão',
        type: 'RULE',
        parentId: sectionId,
      }),
    );

    const rows = rowsFor(withHandMade.document, '### Dívida Acima de R$ 5.000\nBloqueia dívida alta.\n> Reason code: DV01', sectionId);
    const result = apply(
      withHandMade.document,
      ctx,
      applyMarkdownImport({ projectId: IDS.projectA, parentId: sectionId, rows, effectiveFrom: EFFECTIVE_FROM }),
    );

    const children = listChildren(result.document, IDS.projectA, sectionId);
    expect(children.map((c) => c.code)).toEqual(['REGRA_CADASTRADA_A_MAO', 'DIVIDA_ACIMA_DE_R_5_000']);
    expect(children.map((c) => c.position)).toEqual([0, 1]);

    const undone = apply(result.document, ctx, result.result.inverse);
    const survivors = listChildren(undone.document, IDS.projectA, sectionId);
    expect(survivors.map((c) => c.code)).toEqual(['REGRA_CADASTRADA_A_MAO']);
    expect(survivors[0]!.position).toBe(0);
    expect(undone.document.components).toEqual(withHandMade.document.components);
  });

  it('colar dois recortes seguidos no mesmo destino não duplica nada além do esperado (o segundo bloqueia por code)', () => {
    const ctx = testCtx();
    const rows1 = rowsFor(baseDocument(), '### Dívida Acima de R$ 5.000\nTexto.');
    const applied1 = apply(baseDocument(), ctx, applyMarkdownImport({ projectId: IDS.projectA, rows: rows1, effectiveFrom: EFFECTIVE_FROM }));

    const parsed2 = parseMarkdownPolicy('### Dívida Acima de R$ 5.000\nTexto colado de novo.');
    const plan2 = planMarkdownImport({ doc: applied1.document, projectId: IDS.projectA, parsed: parsed2 });
    expect(plan2.blocked).toBe(true);
    expect(plan2.rows[0]!.issues.some((issue) => issue.code === 'COMPONENT_CODE_DUPLICATE')).toBe(true);
  });
});

describe('component/importMarkdown — validação', () => {
  it('lista de linhas vazia falha com INVALID_INPUT, documento intocado', () => {
    expectFailure(baseDocument(), testCtx(), applyMarkdownImport({ projectId: IDS.projectA, rows: [], effectiveFrom: EFFECTIVE_FROM }), 'INVALID_INPUT');
  });

  it('vigência fora do formato ISO 8601 UTC falha com INVALID_INPUT', () => {
    const rows = rowsFor(baseDocument(), '# Regra\nTexto.');
    expectFailure(baseDocument(), testCtx(), applyMarkdownImport({ projectId: IDS.projectA, rows, effectiveFrom: '2026-09-01' }), 'INVALID_INPUT');
  });

  it('linha com code já existente no documento falha atomicamente — nada é criado', () => {
    // O passo de revisão já bloquearia isto (E-GOV-06 no plano — ver
    // `markdown-plan.test.ts`); este teste prova que `component/create`
    // continua sendo a última linha de defesa mesmo se o chamador ignorar
    // `plan.blocked` e mandar aplicar a linha duplicada assim mesmo.
    const ctx = testCtx();
    const existing = apply(
      baseDocument(),
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'REGRA_EXISTENTE', name: 'Regra Existente', type: 'RULE' }),
    );
    const parsed = parseMarkdownPolicy('# Regra Existente\nTexto.\n> Código: REGRA_EXISTENTE');
    const plan = planMarkdownImport({ doc: existing.document, projectId: IDS.projectA, parsed });
    expect(plan.blocked).toBe(true);
    const rows = plan.rows;
    const before = existing.document;
    const error = expectFailure(
      before,
      ctx,
      applyMarkdownImport({ projectId: IDS.projectA, rows, effectiveFrom: EFFECTIVE_FROM }),
      'COMPONENT_CODE_DUPLICATE',
    );
    expect(error.message).toContain('REGRA_EXISTENTE');
  });

  it('linha fora de pré-ordem (pai referenciado antes de existir) falha com COMPONENT_TREE_INVALID', () => {
    const rows = rowsFor(baseDocument(), '# Seção\nTexto.\n> Tipo: SECTION\n## Regra\nTexto.');
    const [secao, regra] = rows as [MarkdownImportRow, MarkdownImportRow];
    expectFailure(
      baseDocument(),
      testCtx(),
      applyMarkdownImport({ projectId: IDS.projectA, rows: [regra, secao], effectiveFrom: EFFECTIVE_FROM }),
      'COMPONENT_TREE_INVALID',
    );
  });
});

describe('component/importMarkdown — guardas do desfazer', () => {
  it('recusa desfazer se um componente da carga ganhou filho depois dela', () => {
    const ctx = testCtx();
    const rows = rowsFor(baseDocument(), '# Seção\nTexto.\n> Tipo: SECTION');
    const applied = apply(baseDocument(), ctx, applyMarkdownImport({ projectId: IDS.projectA, rows, effectiveFrom: EFFECTIVE_FROM }));
    const sectionId = applied.data.createdComponentIds[0]!;
    const withExtraChild = apply(
      applied.document,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'FILHO_MANUAL', name: 'Filho Manual', type: 'RULE', parentId: sectionId }),
    );
    expectFailure(withExtraChild.document, ctx, applied.result.inverse, 'COMPONENT_TREE_INVALID');
  });

  it('recusa desfazer se um componente da carga ganhou outra versão depois dela', () => {
    const ctx = testCtx();
    const rows = rowsFor(baseDocument(), '# Regra\nTexto.');
    const applied = apply(baseDocument(), ctx, applyMarkdownImport({ projectId: IDS.projectA, rows, effectiveFrom: EFFECTIVE_FROM }));
    const componentId = applied.data.createdComponentIds[0]!;
    const withDraft = apply(applied.document, ctx, createComponentDraft({ componentId }));
    expectFailure(withDraft.document, ctx, applied.result.inverse, 'COMPONENT_TREE_INVALID');
  });

  it('recusa desfazer se um componente da carga já não existe mais no documento', () => {
    const ctx = testCtx();
    const rows = rowsFor(baseDocument(), '# Regra\nTexto.');
    const applied = apply(baseDocument(), ctx, applyMarkdownImport({ projectId: IDS.projectA, rows, effectiveFrom: EFFECTIVE_FROM }));
    // Um documento onde o componente desta carga nunca existiu (o resultado
    // sem o próprio import) — o mesmo efeito de "já foi removido por fora".
    expectFailure(baseDocument(), ctx, applied.result.inverse, 'NOT_FOUND');
  });

  it('irmão adicionado depois da carga, na mesma seção, sobrevive ao desfazer e ao refazer sem trocar de posição', () => {
    const ctx = testCtx();
    const rows = rowsFor(baseDocument(), ['# Regra A', 'Texto.', '', '# Regra B', 'Texto.'].join('\n'));
    const applied = apply(baseDocument(), ctx, applyMarkdownImport({ projectId: IDS.projectA, rows, effectiveFrom: EFFECTIVE_FROM }));
    const withLateSibling = apply(
      applied.document,
      ctx,
      createComponent({ projectId: IDS.projectA, code: 'REGRA_TARDIA', name: 'Regra Tardia', type: 'RULE' }),
    );

    const undone = apply(withLateSibling.document, ctx, applied.result.inverse);
    const survivors = listChildren(undone.document, IDS.projectA, undefined);
    expect(survivors.map((c) => c.code)).toEqual(['REGRA_TARDIA']);
    expect(survivors[0]!.position).toBe(0);

    const redone = apply(undone.document, ctx, undone.result.inverse);
    const restored = listChildren(redone.document, IDS.projectA, undefined);
    expect(restored.map((c) => c.code)).toEqual(['REGRA_A', 'REGRA_B', 'REGRA_TARDIA']);
    expect(restored.map((c) => c.position)).toEqual([0, 1, 2]);
    expect(validateDocument(redone.document).ok).toBe(true);
  });
});
