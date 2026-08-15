import {
  assertInlineImageWithinLimit,
  base64Bytes,
  fitWithin,
  INLINE_IMAGE_MAX_BYTES,
  INLINE_IMAGE_MAX_EDGE,
} from '@/core/richdoc/attachments';
import { DomainError } from '@/core/errors';

/**
 * Redimensionamento de imagem no cliente — docs/14-governanca-de-alteracoes.md
 * §7, S34.
 *
 * A conta (`fitWithin`) e a regra do teto (`assertInlineImageWithinLimit`) são
 * puras e moram em `src/core/richdoc/attachments.ts`; o que vive aqui é o que
 * só existe no browser: `FileReader`, `Image` e `<canvas>`. Zero rede (regra
 * 5) — nada sai da máquina, e não há biblioteca de imagem envolvida
 * (DEC-GOV-005).
 *
 * A imagem é reencodada até caber nos 300 KB: primeiro reduzida para no máximo
 * 1600px no maior lado, depois com a qualidade JPEG caindo em degraus. Se nem
 * assim couber, o erro é `E-GOV-05` — explícito, com o tamanho e o teto, em vez
 * de um `.json` de 40 MB que ninguém consegue abrir.
 */

export type PreparedInlineImage = {
  fileName: string;
  mimeType: string;
  /** base64 **sem** o prefixo `data:`. */
  data: string;
  bytes: number;
  width: number;
  height: number;
};

/** Degraus de qualidade do JPEG, do melhor para o mais econômico. */
const QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4];

export async function prepareInlineImage(
  file: File,
  maxEdge: number = INLINE_IMAGE_MAX_EDGE,
): Promise<PreparedInlineImage> {
  if (!file.type.startsWith('image/')) {
    throw new DomainError('INVALID_INPUT', `"${file.name}" não é uma imagem.`, { type: file.type });
  }

  const source = await readAsDataUrl(file);
  const image = await loadImage(source);
  const size = fitWithin(image.naturalWidth || image.width, image.naturalHeight || image.height, maxEdge);

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new DomainError('INVALID_INPUT', 'O navegador não conseguiu processar a imagem.', {
      fileName: file.name,
    });
  }
  context.drawImage(image, 0, 0, size.width, size.height);

  // PNG primeiro quando a origem é PNG (transparência sobrevive); se estourar
  // o teto, cai para JPEG, que é onde a economia de verdade está.
  const candidates: Array<{ mimeType: string; quality?: number }> =
    file.type === 'image/png' ? [{ mimeType: 'image/png' }] : [];
  for (const quality of QUALITY_STEPS) candidates.push({ mimeType: 'image/jpeg', quality });

  let smallest: PreparedInlineImage | null = null;
  for (const candidate of candidates) {
    const dataUrl = canvas.toDataURL(candidate.mimeType, candidate.quality);
    const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const prepared: PreparedInlineImage = {
      fileName: file.name,
      mimeType: candidate.mimeType,
      data,
      bytes: base64Bytes(data),
      width: size.width,
      height: size.height,
    };
    if (prepared.bytes <= INLINE_IMAGE_MAX_BYTES) return prepared;
    if (smallest === null || prepared.bytes < smallest.bytes) smallest = prepared;
  }

  // Nenhum degrau coube: o erro leva o menor tamanho que conseguimos, que é a
  // informação útil para a pessoa decidir recortar a imagem.
  assertInlineImageWithinLimit(smallest?.bytes ?? Number.POSITIVE_INFINITY, file.name);
  return smallest!;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new DomainError('INVALID_INPUT', `Não foi possível ler o arquivo "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new DomainError('INVALID_INPUT', 'O arquivo não é uma imagem válida.'));
    image.src = dataUrl;
  });
}
