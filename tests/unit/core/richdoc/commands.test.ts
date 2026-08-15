import { describe, expect, it } from 'vitest';
import { createComponent } from '@/core/document/components';
import type { InlineImageAttachment, PolicyOpsDocument, RichDoc } from '@/core/document/schema';
import { INLINE_IMAGE_MAX_BYTES } from '@/core/document/schema';
import { deserialize, serialize } from '@/core/document/serialize';
import { validateDocument } from '@/core/document/validate';
import {
  applyRichDocOp,
  insertRichDocImage,
  readRichDoc,
  removeRichDocBlock,
  richDocTargetKey,
  typingCoalesceKey,
  type RichDocTarget,
} from '@/core/richdoc/commands';
import { paragraphFromText } from '@/core/richdoc/model';
import { createComponentDraft, publishComponentVersion } from '@/core/versioning/component-lifecycle';
import { apply, baseDocument, expectFailure, IDS, testCtx, type TestCtx } from '../versioning/fixtures';

/**
 * O editor rico na pilha de comandos — docs/08 §1 e docs/14 §7 (S34).
 *
 * O que estes testes protegem: **inverso exato** de toda edição (é o undo do
 * editor), **imagem é transação** — anexo e bloco entram e saem juntos —, e o
 * ciclo salvar → reabrir → validar Zod sem perda, que é critério de aceite da
 * sessão.
 */

const TARGET_ONLY_KIND = 'COMPONENT_VERSION_SPEC' as const;

function comRascunho(ctx: TestCtx): { document: PolicyOpsDocument; target: RichDocTarget; versionId: string } {
  const criado = apply(
    baseDocument(),
    ctx,
    createComponent({
      projectId: IDS.projectA,
      code: 'REGRA_DIVIDA_5000',
      name: 'Dívida acima de R$ 5.000',
      type: 'RULE',
    }),
  );
  const rascunho = apply(
    criado.document,
    ctx,
    createComponentDraft({
      componentId: criado.data.componentId,
      payload: { kind: 'RULE', businessDescription: 'Reprova dívida ≥ 5.000' },
    }),
  );
  return {
    document: rascunho.document,
    target: { kind: TARGET_ONLY_KIND, versionId: rascunho.data.versionId },
    versionId: rascunho.data.versionId,
  };
}

const imagem = (bytes = 1024) => ({
  fileName: 'fluxo.png',
  mimeType: 'image/png',
  data: 'QUJD'.repeat(Math.max(1, Math.round(bytes / 3))),
  bytes,
  width: 800,
  height: 600,
  addedBy: { username: 'arthur', displayName: 'Arthur' },
});

describe('richdoc/apply', () => {
  it('escreve a especificação no rascunho e o inverso devolve o documento anterior', () => {
    const ctx = testCtx();
    const { document, target } = comRascunho(ctx);

    const escrito = apply(document, ctx, applyRichDocOp({
      target,
      op: { kind: 'insertBlock', index: 0, block: paragraphFromText('b1__________', 'Primeiro parágrafo') },
    }));
    expect(readRichDoc(escrito.document, target).blocks).toHaveLength(1);

    const desfeito = apply(escrito.document, ctx, escrito.result.inverse);
    expect(desfeito.document).toEqual(document);
  });

  it('especificação vazia é ausência de especificação — o campo some do documento', () => {
    const ctx = testCtx();
    const { document, target, versionId } = comRascunho(ctx);
    const escrito = apply(document, ctx, applyRichDocOp({
      target,
      op: { kind: 'insertBlock', index: 0, block: paragraphFromText('b1__________', 'Texto') },
    }));
    const apagado = apply(escrito.document, ctx, applyRichDocOp({
      target,
      op: { kind: 'removeBlock', blockId: 'b1__________' },
    }));
    const version = apagado.document.components[0]!.versions.find((candidate) => candidate.id === versionId)!;
    expect(version.spec).toBeUndefined();
    expect(readRichDoc(apagado.document, target)).toEqual({ blocks: [] });
  });

  it('não escreve em versão publicada (I3)', () => {
    const ctx = testCtx();
    const { document, target } = comRascunho(ctx);
    const publicado = apply(
      document,
      ctx,
      publishComponentVersion({ versionId: target.versionId, effectiveFrom: '2026-02-01T00:00:00.000Z' }),
    );
    expectFailure(
      publicado.document,
      ctx,
      applyRichDocOp({ target, op: { kind: 'insertBlock', index: 0, block: paragraphFromText('b1__________', 'x') } }),
      'VERSION_IMMUTABLE',
    );
  });

  it('versão inexistente é NOT_FOUND e o documento fica intocado', () => {
    const ctx = testCtx();
    const { document } = comRascunho(ctx);
    expectFailure(
      document,
      ctx,
      applyRichDocOp({
        target: { kind: TARGET_ONLY_KIND, versionId: 'inexistente_' },
        op: { kind: 'insertBlock', index: 0, block: paragraphFromText('b1__________', 'x') },
      }),
      'NOT_FOUND',
    );
  });

  it('editar a especificação não gera evento — o que a linha do tempo registra é a publicação', () => {
    const ctx = testCtx();
    const { document, target } = comRascunho(ctx);
    const escrito = apply(document, ctx, applyRichDocOp({
      target,
      op: { kind: 'insertBlock', index: 0, block: paragraphFromText('b1__________', 'x') },
    }));
    expect(escrito.result.events).toEqual([]);
  });

  it('chaves de coalescência distinguem alvo, bloco e célula', () => {
    const target: RichDocTarget = { kind: TARGET_ONLY_KIND, versionId: 'v1__________' };
    const outro: RichDocTarget = { kind: TARGET_ONLY_KIND, versionId: 'v2__________' };
    expect(typingCoalesceKey(target, 'b1')).not.toBe(typingCoalesceKey(target, 'b2'));
    expect(typingCoalesceKey(target, 'b1')).not.toBe(typingCoalesceKey(outro, 'b1'));
    expect(typingCoalesceKey(target, 'b1', '0:1')).not.toBe(typingCoalesceKey(target, 'b1', '0:2'));
    expect(typingCoalesceKey(target, 'b1')).toBe(typingCoalesceKey(target, 'b1'));
    expect(richDocTargetKey(target)).toContain('v1__________');
  });
});

describe('richdoc/insertImage', () => {
  it('cria o anexo embutido e o bloco numa transação; o inverso apaga os dois', () => {
    const ctx = testCtx();
    const { document, target } = comRascunho(ctx);

    const inserido = apply(document, ctx, insertRichDocImage({ target, image: imagem(), caption: 'Fluxo' }));
    const anexos = inserido.document.attachments ?? [];
    expect(anexos).toHaveLength(1);
    expect(anexos[0]).toMatchObject({ kind: 'INLINE_IMAGE', fileName: 'fluxo.png', width: 800, height: 600 });
    expect(readRichDoc(inserido.document, target).blocks[0]).toMatchObject({
      type: 'image',
      attachmentId: inserido.data.attachmentId,
      caption: 'Fluxo',
    });

    const desfeito = apply(inserido.document, ctx, inserido.result.inverse);
    expect(desfeito.document).toEqual(document);
    expect(desfeito.document.attachments).toBeUndefined();
  });

  it('entra depois do bloco de referência', () => {
    const ctx = testCtx();
    const { document, target } = comRascunho(ctx);
    const comTexto = apply(document, ctx, applyRichDocOp({
      target,
      op: { kind: 'insertBlock', index: 0, block: paragraphFromText('b1__________', 'Antes') },
    }));
    const comImagem = apply(comTexto.document, ctx, insertRichDocImage({
      target,
      image: imagem(),
      afterBlockId: 'b1__________',
    }));
    expect(readRichDoc(comImagem.document, target).blocks.map((block) => block.type)).toEqual(['paragraph', 'image']);
  });

  it('recusa imagem acima do teto de 300 KB (E-GOV-05) e imagem sem conteúdo', () => {
    const ctx = testCtx();
    const { document, target } = comRascunho(ctx);
    const erro = expectFailure(
      document,
      ctx,
      insertRichDocImage({ target, image: imagem(INLINE_IMAGE_MAX_BYTES + 1) }),
      'ATTACHMENT_TOO_LARGE',
    );
    expect(erro.details).toMatchObject({ limit: INLINE_IMAGE_MAX_BYTES });
    expectFailure(
      document,
      ctx,
      insertRichDocImage({ target, image: { ...imagem(), data: '' } }),
      'INVALID_INPUT',
    );
  });
});

describe('richdoc/removeBlock', () => {
  it('remove o anexo junto quando o bloco era a última referência, e o inverso repõe os dois', () => {
    const ctx = testCtx();
    const { document, target } = comRascunho(ctx);
    const inserido = apply(document, ctx, insertRichDocImage({ target, image: imagem() }));

    const removido = apply(inserido.document, ctx, removeRichDocBlock({ target, blockId: inserido.data.blockId }));
    expect(removido.document.attachments).toBeUndefined();

    const desfeito = apply(removido.document, ctx, removido.result.inverse);
    expect(desfeito.document).toEqual(inserido.document);
  });

  it('mantém o anexo quando outro bloco ainda o referencia', () => {
    const ctx = testCtx();
    const { document, target } = comRascunho(ctx);
    const inserido = apply(document, ctx, insertRichDocImage({ target, image: imagem() }));
    const segundo = apply(inserido.document, ctx, applyRichDocOp({
      target,
      op: {
        kind: 'insertBlock',
        index: 1,
        block: { id: 'b2__________', type: 'image', attachmentId: inserido.data.attachmentId },
      },
    }));

    const removido = apply(segundo.document, ctx, removeRichDocBlock({ target, blockId: 'b2__________' }));
    expect(removido.document.attachments).toHaveLength(1);
  });

  it('preserva a ordem de `attachments` ao desfazer a remoção do meio da lista', () => {
    const ctx = testCtx();
    const { document, target } = comRascunho(ctx);
    const primeira = apply(document, ctx, insertRichDocImage({ target, image: imagem() }));
    const segunda = apply(primeira.document, ctx, insertRichDocImage({ target, image: { ...imagem(), fileName: 'b.png' } }));
    const terceira = apply(segunda.document, ctx, insertRichDocImage({ target, image: { ...imagem(), fileName: 'c.png' } }));

    const removido = apply(terceira.document, ctx, removeRichDocBlock({ target, blockId: segunda.data.blockId }));
    expect((removido.document.attachments ?? []).map((a) => (a as InlineImageAttachment).fileName)).toEqual([
      'fluxo.png',
      'c.png',
    ]);

    const desfeito = apply(removido.document, ctx, removido.result.inverse);
    expect(desfeito.document).toEqual(terceira.document);
  });

  it('recusa bloco inexistente', () => {
    const ctx = testCtx();
    const { document, target } = comRascunho(ctx);
    expectFailure(document, ctx, removeRichDocBlock({ target, blockId: 'nada________' }), 'NOT_FOUND');
  });
});

describe('salvar → reabrir → validar', () => {
  it('documento com especificação e imagem sobrevive ao ciclo sem perda', () => {
    const ctx = testCtx();
    const { document, target } = comRascunho(ctx);

    const spec: RichDoc = {
      blocks: [
        { id: 'h1__________', type: 'heading1', text: [{ text: 'Regra de dívida' }] },
        { id: 'p1__________', type: 'paragraph', text: [{ text: 'Reprova ' }, { text: 'sempre', marks: ['bold'] }] },
        { id: 'l1__________', type: 'bulletList', items: [[{ text: 'Serasa' }], [{ text: 'SPC' }]] },
        { id: 't1__________', type: 'table', header: ['Faixa', 'Limite'], rows: [['A', '1000']] },
        {
          id: 'a1__________',
          type: 'paragraph',
          text: [{ text: 'manual', marks: ['link'], href: 'file://politica' }],
        },
      ],
    };
    let atual = document;
    for (const [index, block] of spec.blocks.entries()) {
      atual = apply(atual, ctx, applyRichDocOp({ target, op: { kind: 'insertBlock', index, block } })).document;
    }
    atual = apply(atual, ctx, insertRichDocImage({ target, image: imagem(), caption: 'Fluxo' })).document;

    const reaberto = deserialize(serialize(atual));
    const validado = validateDocument(reaberto);
    expect(validado.ok, JSON.stringify(validado.ok ? [] : validado.issues)).toBe(true);
    if (!validado.ok) return;
    expect(readRichDoc(validado.document, target).blocks).toEqual(readRichDoc(atual, target).blocks);
  });
});

describe('bordas dos comandos de imagem', () => {
  it('bloco de imagem cujo anexo já sumiu do documento é removido sem drama', () => {
    const ctx = testCtx();
    const { document, target } = comRascunho(ctx);
    const comBloco = apply(document, ctx, applyRichDocOp({
      target,
      op: {
        kind: 'insertBlock',
        index: 0,
        block: { id: 'i1__________', type: 'image', attachmentId: 'fantasma____' },
      },
      label: 'Inserir imagem órfã',
    }));

    const removido = apply(comBloco.document, ctx, removeRichDocBlock({ target, blockId: 'i1__________' }));
    expect(readRichDoc(removido.document, target).blocks).toHaveLength(0);

    const desfeito = apply(removido.document, ctx, removido.result.inverse);
    expect(desfeito.document).toEqual(comBloco.document);
  });

  it('o rótulo informado vale também para o comando que desfaz', () => {
    const ctx = testCtx();
    const { document, target } = comRascunho(ctx);
    const escrito = apply(document, ctx, applyRichDocOp({
      target,
      op: { kind: 'insertBlock', index: 0, block: paragraphFromText('b1__________', 'x') },
      label: 'Dividir bloco da especificação',
      coalesceKey: 'richdoc:teste',
    }));
    expect(escrito.result.inverse.label).toBe('Dividir bloco da especificação');
    expect(escrito.result.inverse.coalesceKey).toBeUndefined();
  });
});
