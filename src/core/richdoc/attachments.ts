import {
  INLINE_IMAGE_MAX_BYTES,
  INLINE_IMAGE_TOTAL_WARN_BYTES,
  type InlineImageAttachment,
  type PolicyOpsDocument,
  type RichDoc,
} from '../document/schema';
import { DomainError } from '../errors';
import { referencedAttachmentIds } from './model';

/**
 * Imagens embutidas — docs/14-governanca-de-alteracoes.md §7,
 * docs/03-modelo-do-documento.md §8.1.
 *
 * O byte da imagem mora no próprio `.json` (`INLINE_IMAGE`), o que faz do
 * tamanho um problema de arquitetura, não de estética: o alvo do documento é
 * 10 MB. Daí os dois números do contrato — **300 KB por imagem** (teto duro,
 * `E-GOV-05`) e **3 MB de anexos no documento** (aviso, não bloqueio).
 *
 * O redimensionamento em si acontece no browser (`src/lib/image.ts`, canvas):
 * o que é puro — e portanto mora aqui — é a **conta** do novo tamanho e a
 * regra do teto.
 */

export { INLINE_IMAGE_MAX_BYTES, INLINE_IMAGE_TOTAL_WARN_BYTES };

/** Maior lado de uma imagem embutida, em pixels (docs/14 §7). */
export const INLINE_IMAGE_MAX_EDGE = 1600;

/** Novo tamanho preservando a proporção. Imagem menor que o teto não cresce. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = INLINE_IMAGE_MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * Tamanho real de um conteúdo base64, em bytes. Cada 4 caracteres carregam 3
 * bytes, e o `=` do fim é preenchimento — contar o comprimento da string
 * superestimaria a imagem em um terço, e o teto de 300 KB recusaria imagem que
 * cabe.
 */
export function base64Bytes(data: string): number {
  const clean = data.replace(/[\r\n]/g, '');
  if (clean.length === 0) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export function assertInlineImageWithinLimit(bytes: number, fileName: string): void {
  if (bytes > INLINE_IMAGE_MAX_BYTES) {
    throw new DomainError(
      'ATTACHMENT_TOO_LARGE',
      `A imagem "${fileName}" tem ${formatKB(bytes)} depois de redimensionada e o teto por imagem é ${formatKB(
        INLINE_IMAGE_MAX_BYTES,
      )}. Recorte a imagem ou salve-a com menos qualidade antes de anexar.`,
      { bytes, limit: INLINE_IMAGE_MAX_BYTES, fileName },
    );
  }
}

function formatKB(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

/** Todos os `RichDoc` do documento — é onde um bloco `image` pode referenciar um anexo. */
export function collectRichDocs(doc: PolicyOpsDocument): RichDoc[] {
  const docs: RichDoc[] = [];
  for (const project of doc.projects) {
    if (project.factoryTemplate !== undefined) docs.push(project.factoryTemplate.boilerplate);
  }
  for (const component of doc.components) {
    for (const version of component.versions) {
      if (version.spec !== undefined) docs.push(version.spec);
    }
  }
  for (const changeRequest of doc.changeRequests) {
    if (changeRequest.motivationText !== undefined) docs.push(changeRequest.motivationText);
    if (changeRequest.spec !== undefined) docs.push(changeRequest.spec);
  }
  return docs;
}

/** Quantos blocos `image`, no documento inteiro, apontam este anexo. */
export function countInlineImageReferences(doc: PolicyOpsDocument, attachmentId: string): number {
  return collectRichDocs(doc)
    .flatMap(referencedAttachmentIds)
    .filter((id) => id === attachmentId).length;
}

export function listInlineImages(doc: PolicyOpsDocument): InlineImageAttachment[] {
  return (doc.attachments ?? []).filter(
    (attachment): attachment is InlineImageAttachment => attachment.kind === 'INLINE_IMAGE',
  );
}

export function findInlineImage(
  doc: PolicyOpsDocument,
  attachmentId: string,
): InlineImageAttachment | undefined {
  return listInlineImages(doc).find((attachment) => attachment.id === attachmentId);
}

/** Total em bytes das imagens embutidas — o número que dispara o aviso de 3 MB. */
export function inlineImagesBytes(doc: PolicyOpsDocument): number {
  return listInlineImages(doc).reduce((total, attachment) => total + attachment.bytes, 0);
}

/**
 * `true` quando os anexos embutidos passam do limite de aviso — contando
 * `extraBytes`, que é a imagem prestes a entrar. Aviso, nunca bloqueio: quem
 * escreve a política decide se o documento pode engordar (docs/14 §7).
 */
export function warnsOnInlineImageTotal(doc: PolicyOpsDocument, extraBytes = 0): boolean {
  return inlineImagesBytes(doc) + extraBytes > INLINE_IMAGE_TOTAL_WARN_BYTES;
}
