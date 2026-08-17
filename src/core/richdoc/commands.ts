import { applyToDocument, defineCommand, isoFrom, type Command } from '../command';
import type {
  Attachment,
  Block,
  ChangeRequest,
  InlineImageAttachment,
  PolicyOpsDocument,
  RichDoc,
} from '../document/schema';
import { DomainError } from '../errors';
import { assertChangeRequestOpen } from '../document/cr-workflow';
import { locateChangeRequest } from '../document/change-requests';
import {
  assertComponentVersionEditable,
  locateComponentVersion,
} from '../versioning/component-lifecycle';
import { assertInlineImageWithinLimit, countInlineImageReferences } from './attachments';
import { findBlockIndex, imageBlock } from './model';
import { applyOp, type RichDocOp } from './operations';

/**
 * O editor rico na pilha de comandos — docs/08-camada-de-comandos.md §1, S34.
 *
 * Um comando só (`richdoc/apply`) carrega **toda** a edição de texto: ele
 * recebe uma `RichDocOp` de `./operations.ts`, aplica no `RichDoc` do alvo e
 * devolve como inverso o mesmo comando com a operação inversa. Nada de
 * snapshot do documento inteiro a cada tecla.
 *
 * **Coalescência** (`coalesceKey`, docs/08 §2): digitar num bloco emite um
 * comando por tecla, e todos eles compartilham a chave
 * `richdoc:<alvo>:<bloco>`. O store funde a sequência numa entrada só de undo,
 * preservando o inverso do **primeiro** comando — um Ctrl+Z devolve o
 * parágrafo ao que era antes de a digitação começar. Trocar de bloco, colar,
 * dividir, mover, desfazer ou refazer quebram a sequência, porque a chave muda
 * (ou some).
 *
 * Imagem tem comando próprio porque toca duas coisas numa transação: a coleção
 * `attachments` do documento e o bloco `image` do `RichDoc`. Remover o bloco
 * leva junto o anexo **quando ele fica órfão** — o byte da imagem mora no
 * `.json` (docs/03 §8.1) e um anexo sem bloco é peso morto que ninguém
 * consegue ver para apagar.
 */

// ---------------------------------------------------------------------------
// Alvo
// ---------------------------------------------------------------------------
// #region: alvo

/**
 * Onde o `RichDoc` mora. A S34 ligou **um** alvo — a especificação da versão
 * de componente; a S35 acrescenta os dois campos do DB (`motivationText`,
 * `spec`, docs/14 §3.3) sem tocar em nada além desta união e do que segue
 * abaixo, exatamente como o comentário original previa.
 */
export type RichDocTarget =
  | { kind: 'COMPONENT_VERSION_SPEC'; versionId: string }
  | { kind: 'CR_MOTIVATION'; changeRequestId: string }
  | { kind: 'CR_SPEC'; changeRequestId: string };

export function richDocTargetKey(target: RichDocTarget): string {
  switch (target.kind) {
    case 'COMPONENT_VERSION_SPEC':
      return `${target.kind}:${target.versionId}`;
    case 'CR_MOTIVATION':
    case 'CR_SPEC':
      return `${target.kind}:${target.changeRequestId}`;
  }
}

/** Chave de coalescência da digitação: mesmo alvo + mesmo bloco (+ mesma célula). */
export function typingCoalesceKey(target: RichDocTarget, blockId: string, slot = ''): string {
  return `richdoc:${richDocTargetKey(target)}:${blockId}:${slot}`;
}

function crFieldOf(kind: 'CR_MOTIVATION' | 'CR_SPEC'): 'motivationText' | 'spec' {
  return kind === 'CR_MOTIVATION' ? 'motivationText' : 'spec';
}

export function readRichDoc(doc: PolicyOpsDocument, target: RichDocTarget): RichDoc {
  if (target.kind === 'COMPONENT_VERSION_SPEC') {
    const { version } = locateComponentVersion(doc, target.versionId);
    return version.spec ?? { blocks: [] };
  }
  const { changeRequest } = locateChangeRequest(doc, target.changeRequestId);
  return changeRequest[crFieldOf(target.kind)] ?? { blocks: [] };
}

type TargetLocation =
  | { kind: 'COMPONENT_VERSION_SPEC'; componentIndex: number; versionIndex: number }
  | { kind: 'CR_MOTIVATION' | 'CR_SPEC'; changeRequestIndex: number };

function locateTarget(doc: PolicyOpsDocument, target: RichDocTarget): TargetLocation {
  if (target.kind === 'COMPONENT_VERSION_SPEC') {
    const { version, componentIndex, versionIndex } = locateComponentVersion(doc, target.versionId);
    // Especificação é conteúdo de versão: só se edita em rascunho (I3).
    assertComponentVersionEditable(version);
    return { kind: target.kind, componentIndex, versionIndex };
  }
  const { changeRequest, index } = locateChangeRequest(doc, target.changeRequestId);
  // Motivação e especificação do DB só se editam enquanto ele não está
  // fechado (`assertChangeRequestOpen`) — mesmo critério de `changeRequest/update`.
  assertChangeRequestOpen(changeRequest);
  return { kind: target.kind, changeRequestIndex: index };
}

function scopeFor(target: RichDocTarget): { componentVersionId?: string; changeRequestId?: string } {
  return target.kind === 'COMPONENT_VERSION_SPEC'
    ? { componentVersionId: target.versionId }
    : { changeRequestId: target.changeRequestId };
}

function writeRichDoc(
  draft: { components: PolicyOpsDocument['components']; changeRequests: PolicyOpsDocument['changeRequests'] },
  at: TargetLocation,
  value: RichDoc,
): void {
  if (at.kind === 'COMPONENT_VERSION_SPEC') {
    const version = draft.components[at.componentIndex]!.versions[at.versionIndex]!;
    // Vazio é ausência: o schema omite o campo (docs/03 §1), o arquivo não
    // guarda `{"blocks":[]}` por documento.
    if (value.blocks.length === 0) delete version.spec;
    else version.spec = value;
    return;
  }
  const changeRequest = draft.changeRequests[at.changeRequestIndex]! as ChangeRequest;
  const field = crFieldOf(at.kind);
  if (value.blocks.length === 0) delete changeRequest[field];
  else changeRequest[field] = value;
}

// ---------------------------------------------------------------------------
// richdoc/apply
// ---------------------------------------------------------------------------
// #region: richdoc-apply

export type ApplyRichDocOpInput = {
  target: RichDocTarget;
  op: RichDocOp;
  /** Rótulo do "Desfazer". Ausente = um rótulo pelo tipo da operação. */
  label?: string;
  /** Presente só na digitação — ver a nota de coalescência no topo. */
  coalesceKey?: string;
};

const OP_LABELS: Record<RichDocOp['kind'], string> = {
  insertBlock: 'Inserir bloco na especificação',
  removeBlock: 'Remover bloco da especificação',
  moveBlock: 'Mover bloco da especificação',
  replaceBlock: 'Editar a especificação',
  spliceBlocks: 'Editar a especificação',
};

export function applyRichDocOp(input: ApplyRichDocOpInput): Command<ApplyRichDocOpInput, void> {
  return defineCommand({
    type: 'richdoc/apply',
    input,
    label: input.label ?? OP_LABELS[input.op.kind],
    scope: scopeFor(input.target),
    ...(input.coalesceKey !== undefined ? { coalesceKey: input.coalesceKey } : {}),
    execute(doc) {
      const at = locateTarget(doc, input.target);
      const applied = applyOp(readRichDoc(doc, input.target), input.op);
      return {
        document: applyToDocument(doc, [], (draft) => {
          writeRichDoc(draft, at, applied.doc);
        }),
        data: undefined,
        // Editar rascunho não gera evento — como `componentVersion/update`
        // também não gera. O que a linha do tempo registra é a publicação.
        events: [],
        // O inverso nunca carrega `coalesceKey`: desfazer é sempre um passo
        // próprio, jamais fundido com a digitação que veio antes.
        inverse: applyRichDocOp({
          target: input.target,
          op: applied.inverse,
          ...(input.label !== undefined ? { label: input.label } : {}),
        }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// richdoc/insertImage
// ---------------------------------------------------------------------------
// #region: richdoc-insert-image

export type InlineImageInput = {
  fileName: string;
  mimeType: string;
  /** base64 **sem** o prefixo `data:` (docs/03 §8.1). */
  data: string;
  bytes: number;
  width?: number;
  height?: number;
  addedBy: { username: string; displayName?: string };
};

export type InsertRichDocImageInput = {
  target: RichDocTarget;
  image: InlineImageInput;
  caption?: string;
  /** A imagem entra logo depois deste bloco; ausente/`null` = no fim. */
  afterBlockId?: string | null;
};

export type InsertRichDocImageData = { blockId: string; attachmentId: string };

export function insertRichDocImage(
  input: InsertRichDocImageInput,
): Command<InsertRichDocImageInput, InsertRichDocImageData> {
  return defineCommand({
    type: 'richdoc/insertImage',
    input,
    label: 'Inserir imagem na especificação',
    scope: scopeFor(input.target),
    execute(doc, ctx) {
      const at = locateTarget(doc, input.target);
      assertInlineImageWithinLimit(input.image.bytes, input.image.fileName);
      if (input.image.data.length === 0) {
        throw new DomainError('INVALID_INPUT', 'A imagem chegou sem conteúdo.', {
          fileName: input.image.fileName,
        });
      }

      const attachment: InlineImageAttachment = {
        kind: 'INLINE_IMAGE',
        id: ctx.newId(),
        fileName: input.image.fileName,
        mimeType: input.image.mimeType,
        data: input.image.data,
        bytes: input.image.bytes,
        addedBy: input.image.addedBy,
        addedAt: isoFrom(ctx.now()),
      };
      if (input.image.width !== undefined) attachment.width = input.image.width;
      if (input.image.height !== undefined) attachment.height = input.image.height;

      const current = readRichDoc(doc, input.target);
      const block = imageBlock(ctx.newId(), attachment.id, input.caption);
      const index = insertIndexFor(current, input.afterBlockId ?? null);
      const applied = applyOp(current, { kind: 'insertBlock', index, block });

      return {
        document: applyToDocument(doc, [], (draft) => {
          writeRichDoc(draft, at, applied.doc);
          if (draft.attachments === undefined) draft.attachments = [];
          draft.attachments.push(attachment);
        }),
        data: { blockId: block.id, attachmentId: attachment.id },
        events: [],
        inverse: removeRichDocBlock({ target: input.target, blockId: block.id }),
      };
    },
  });
}

function insertIndexFor(doc: RichDoc, afterBlockId: string | null): number {
  if (afterBlockId === null) return doc.blocks.length;
  const index = findBlockIndex(doc, afterBlockId);
  return index < 0 ? doc.blocks.length : index + 1;
}

// ---------------------------------------------------------------------------
// richdoc/removeBlock
// ---------------------------------------------------------------------------
// #region: richdoc-remove-block

export type RemoveRichDocBlockInput = { target: RichDocTarget; blockId: string };

/**
 * Remove um bloco e, se ele era a **última** referência a uma imagem embutida,
 * remove o anexo junto. O inverso devolve os dois na posição exata — inclusive
 * o índice do anexo em `attachments`, que é uma lista ordenada (docs/03 §8.1).
 */
export function removeRichDocBlock(
  input: RemoveRichDocBlockInput,
): Command<RemoveRichDocBlockInput, void> {
  return defineCommand({
    type: 'richdoc/removeBlock',
    input,
    label: 'Remover bloco da especificação',
    scope: scopeFor(input.target),
    execute(doc) {
      const at = locateTarget(doc, input.target);
      const current = readRichDoc(doc, input.target);
      const index = findBlockIndex(current, input.blockId);
      if (index < 0) {
        throw new DomainError('NOT_FOUND', 'O bloco informado não existe nesta especificação.', {
          blockId: input.blockId,
        });
      }
      const block = current.blocks[index]!;
      const applied = applyOp(current, { kind: 'removeBlock', blockId: input.blockId });

      const orphan =
        block.type === 'image' && countInlineImageReferences(doc, block.attachmentId) === 1
          ? findAttachment(doc, block.attachmentId)
          : null;

      return {
        document: applyToDocument(doc, [], (draft) => {
          writeRichDoc(draft, at, applied.doc);
          if (orphan !== null && draft.attachments !== undefined) {
            draft.attachments.splice(orphan.index, 1);
            if (draft.attachments.length === 0) delete draft.attachments;
          }
        }),
        data: undefined,
        events: [],
        inverse: restoreRichDocBlock({
          target: input.target,
          index,
          block: structuredClone(block),
          ...(orphan !== null
            ? { attachment: structuredClone(orphan.attachment), attachmentIndex: orphan.index }
            : {}),
        }),
      };
    },
  });
}

function findAttachment(
  doc: PolicyOpsDocument,
  attachmentId: string,
): { attachment: Attachment; index: number } | null {
  const index = (doc.attachments ?? []).findIndex((candidate) => candidate.id === attachmentId);
  if (index < 0) return null;
  return { attachment: doc.attachments![index]!, index };
}

type RestoreRichDocBlockInput = {
  target: RichDocTarget;
  index: number;
  block: Block;
  attachment?: Attachment;
  attachmentIndex?: number;
};

/** Inverso de `richdoc/removeBlock` — interno, nunca despachado pela interface. */
function restoreRichDocBlock(input: RestoreRichDocBlockInput): Command<RestoreRichDocBlockInput, void> {
  return defineCommand({
    type: 'richdoc/_restoreBlock',
    input,
    label: 'Restaurar bloco da especificação',
    scope: scopeFor(input.target),
    execute(doc) {
      const at = locateTarget(doc, input.target);
      const current = readRichDoc(doc, input.target);
      const applied = applyOp(current, {
        kind: 'insertBlock',
        index: Math.min(input.index, current.blocks.length),
        block: input.block,
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          writeRichDoc(draft, at, applied.doc);
          if (input.attachment === undefined) return;
          if (draft.attachments === undefined) draft.attachments = [];
          draft.attachments.splice(input.attachmentIndex ?? draft.attachments.length, 0, input.attachment);
        }),
        data: undefined,
        events: [],
        inverse: removeRichDocBlock({ target: input.target, blockId: input.block.id }),
      };
    },
  });
}
