import { createComponent } from '@/core/document/components';
import type { PolicyOpsDocument } from '@/core/document/schema';
import { allCombinations } from '@/core/axes/combinations';
import { applyCellPatch } from '@/core/versioning/cells';
import { createComponentDraft, publishComponentVersion } from '@/core/versioning/component-lifecycle';
import { createDraft, createMatrix, locateVersion, publishVersion } from '@/core/versioning/lifecycle';
import { MUDANCAS, VIGENCIA_V1 } from './governance-fixtures';
import { IDS, apply, baseDocument, testCtx } from '../versioning/fixtures';

/**
 * Um projeto do tamanho de um real — 300 componentes (o alerta de docs/14
 * §3.1) e 102 matrizes (a ordem de grandeza do cineminha) — montado por
 * comandos, como todas as fixtures do épico.
 *
 * Vive fora do teste que o criou (S39, `policy-diff.test.ts`) porque o mesmo
 * orçamento de 500 ms vale para as duas pontas da consulta: a comparação entre
 * duas datas e **abrir a data** na tela de Vigência (S43).
 */

export function projetoGrande(): PolicyOpsDocument {
  const ctx = testCtx();
  let document = baseDocument();

  for (let i = 0; i < 102; i++) {
    const criada = apply(
      document,
      ctx,
      createMatrix({
        projectId: IDS.projectA,
        code: `MTZ_${String(i).padStart(3, '0')}`,
        name: `Matriz ${i}`,
        x: { levels: [{ variableId: IDS.score }] },
        y: { levels: [{ variableId: IDS.restritivo }] },
      }),
    );
    document = criada.document;
    const coords = allCombinations(locateVersion(criada.document, criada.data.versionId).version).map(
      ({ xPath, yPath }) => ({ xPath, yPath }),
    );
    document = apply(
      document,
      ctx,
      applyCellPatch({ versionId: criada.data.versionId, patch: { coords, set: { decision: 'APROVADO' } } }),
    ).document;
    document = apply(
      document,
      ctx,
      publishVersion({ versionId: criada.data.versionId, notes: 'Primeira publicação.', effectiveFrom: VIGENCIA_V1 }),
    ).document;

    // Metade das matrizes muda no meio do período — o diff caro só existe aí.
    if (i % 2 === 0) {
      const v2 = apply(document, ctx, createDraft({ matrixId: criada.data.matrixId }));
      document = apply(
        v2.document,
        ctx,
        applyCellPatch({ versionId: v2.data.versionId, patch: { coords, set: { decision: 'REPROVADO' } } }),
      ).document;
      document = apply(
        document,
        ctx,
        publishVersion({ versionId: v2.data.versionId, notes: 'Fecha o corte.', effectiveFrom: MUDANCAS.matriz }),
      ).document;
    }

    const espelho = apply(
      document,
      ctx,
      createComponent({
        projectId: IDS.projectA,
        code: `ESPELHO_${String(i).padStart(3, '0')}`,
        name: `Espelho ${i}`,
        type: 'MATRIX',
        matrixId: criada.data.matrixId,
      }),
    );
    document = espelho.document;
  }

  let secaoId: string | undefined;
  for (let i = 0; i < 300; i++) {
    const criado = apply(
      document,
      ctx,
      createComponent({
        projectId: IDS.projectA,
        ...(i % 20 === 0 || secaoId === undefined ? {} : { parentId: secaoId }),
        code: `REGRA_${String(i).padStart(3, '0')}`,
        name: `Regra ${i}`,
        type: i % 20 === 0 ? 'SECTION' : 'RULE',
      }),
    );
    document = criado.document;
    if (i % 20 === 0) {
      secaoId = criado.data.componentId;
      continue;
    }
    const rascunho = apply(
      document,
      ctx,
      createComponentDraft({
        componentId: criado.data.componentId,
        payload: { kind: 'RULE', businessDescription: `Estado inicial da regra ${i}.` },
      }),
    );
    document = apply(
      rascunho.document,
      ctx,
      publishComponentVersion({ versionId: rascunho.data.versionId, effectiveFrom: VIGENCIA_V1 }),
    ).document;

    if (i % 3 === 0) {
      const v2 = apply(
        document,
        ctx,
        createComponentDraft({
          componentId: criado.data.componentId,
          payload: { kind: 'RULE', businessDescription: `Regra ${i} revista.`, outcome: 'Aprovar' },
        }),
      );
      document = apply(
        v2.document,
        ctx,
        publishComponentVersion({ versionId: v2.data.versionId, effectiveFrom: MUDANCAS.goodlist }),
      ).document;
    }
  }

  return document;
}
