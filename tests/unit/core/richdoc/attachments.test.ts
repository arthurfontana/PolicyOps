import { describe, expect, it } from 'vitest';
import { createSampleDocument } from '@/core/document/create';
import type { InlineImageAttachment, PolicyOpsDocument, RichDoc } from '@/core/document/schema';
import {
  INLINE_IMAGE_MAX_BYTES,
  INLINE_IMAGE_TOTAL_WARN_BYTES,
} from '@/core/document/schema';
import { DomainError } from '@/core/errors';
import {
  assertInlineImageWithinLimit,
  base64Bytes,
  collectRichDocs,
  countInlineImageReferences,
  findInlineImage,
  fitWithin,
  inlineImagesBytes,
  listInlineImages,
  warnsOnInlineImageTotal,
} from '@/core/richdoc/attachments';

/**
 * Imagens embutidas — docs/14 §7 e docs/03 §8.1. Os dois números do contrato:
 * teto duro de 300 KB por imagem (`E-GOV-05`) e aviso — nunca bloqueio — a
 * partir de 3 MB de anexos no documento.
 */

function inlineImage(id: string, bytes: number, fileName = `${id}.png`): InlineImageAttachment {
  return {
    kind: 'INLINE_IMAGE',
    id: id.padEnd(12, '_'),
    fileName,
    mimeType: 'image/png',
    data: 'QUJD',
    bytes,
    addedBy: { username: 'arthur' },
    addedAt: '2026-01-01T00:00:00.000Z',
  };
}

function comAnexos(...attachments: InlineImageAttachment[]): PolicyOpsDocument {
  return { ...createSampleDocument(), attachments };
}

describe('fitWithin', () => {
  it('reduz o maior lado para o teto, preservando a proporção', () => {
    expect(fitWithin(3200, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWithin(1000, 4000)).toEqual({ width: 400, height: 1600 });
  });

  it('não amplia imagem menor que o teto', () => {
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 });
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
  });

  it('nunca produz lado zero por arredondamento', () => {
    expect(fitWithin(4000, 3, 100)).toEqual({ width: 100, height: 1 });
  });
});

describe('base64Bytes', () => {
  it('conta os bytes reais, descontando o preenchimento', () => {
    expect(base64Bytes('')).toBe(0);
    expect(base64Bytes('QUJD')).toBe(3);
    expect(base64Bytes('QUJDRA==')).toBe(4);
    expect(base64Bytes('QUJDREU=')).toBe(5);
    expect(base64Bytes('QUJD\nQUJD')).toBe(6);
  });
});

describe('teto por imagem', () => {
  it('aceita no limite e recusa acima, com o tamanho na mensagem', () => {
    expect(() => assertInlineImageWithinLimit(INLINE_IMAGE_MAX_BYTES, 'ok.png')).not.toThrow();
    try {
      assertInlineImageWithinLimit(INLINE_IMAGE_MAX_BYTES + 1, 'grande.png');
      expect.unreachable('deveria recusar');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('ATTACHMENT_TOO_LARGE');
      expect((error as DomainError).message).toContain('grande.png');
      expect((error as DomainError).message).toContain('300 KB');
    }
  });
});

describe('inventário de imagens embutidas', () => {
  it('lista e soma só as embutidas — evidência do acervo fica de fora', () => {
    const doc = comAnexos(inlineImage('a', 1000), inlineImage('b', 2000));
    expect(listInlineImages(doc)).toHaveLength(2);
    expect(inlineImagesBytes(doc)).toBe(3000);
    expect(findInlineImage(doc, 'a___________')?.fileName).toBe('a.png');
    expect(findInlineImage(doc, 'nada________')).toBeUndefined();
    expect(inlineImagesBytes(createSampleDocument())).toBe(0);
  });

  it('avisa a partir de 3 MB, contando a imagem que está prestes a entrar', () => {
    const doc = comAnexos(inlineImage('a', INLINE_IMAGE_TOTAL_WARN_BYTES - 1000));
    expect(warnsOnInlineImageTotal(doc)).toBe(false);
    expect(warnsOnInlineImageTotal(doc, 2000)).toBe(true);
  });
});

describe('referências entre `RichDoc` e anexo', () => {
  const spec = (attachmentId: string): RichDoc => ({
    blocks: [{ id: 'i1__________', type: 'image', attachmentId }],
  });

  it('varre especificação de componente, DB e boilerplate do projeto', () => {
    const base = createSampleDocument();
    const doc: PolicyOpsDocument = {
      ...base,
      projects: base.projects.map((project, index) =>
        index === 0
          ? { ...project, factoryTemplate: { boilerplate: spec('att_________') } }
          : project,
      ),
      components: [
        {
          id: 'c1__________',
          projectId: base.projects[0]!.id,
          code: 'REGRA',
          name: 'Regra',
          type: 'RULE',
          position: 0,
          reviewStatus: 'DRAFT',
          createdAt: '2026-01-01T00:00:00.000Z',
          versions: [
            {
              id: 'v1__________',
              number: 1,
              state: 'DRAFT',
              createdAt: '2026-01-01T00:00:00.000Z',
              createdBy: 'arthur',
              payload: { kind: 'RULE', businessDescription: 'x' },
              spec: spec('att_________'),
            },
          ],
        },
      ],
      changeRequests: [
        {
          id: 'cr1_________',
          code: 'DB_1',
          title: 'DB',
          status: 'DRAFT',
          motivators: [],
          requestedBy: 'arthur',
          items: [],
          acceptanceCriteria: [],
          testScenarios: [],
          impacts: [],
          approvals: [],
          events: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          motivationText: spec('outro_______'),
          spec: spec('att_________'),
        },
      ],
    };

    expect(collectRichDocs(doc)).toHaveLength(4);
    expect(countInlineImageReferences(doc, 'att_________')).toBe(3);
    expect(countInlineImageReferences(doc, 'outro_______')).toBe(1);
    expect(countInlineImageReferences(doc, 'ninguem_____')).toBe(0);
  });

  it('documento sem `RichDoc` nenhum não referencia nada', () => {
    expect(collectRichDocs(createSampleDocument())).toEqual([]);
  });
});
