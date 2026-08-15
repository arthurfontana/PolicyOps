import type { Block, InlineText, RichDoc } from '@/core/document/schema';
import { findInlineImage } from '@/core/richdoc/attachments';
import { useDocumentStore } from '@/store/document-store';

/**
 * Leitura de um `RichDoc` — a mesma pintura usada pela versão publicada (que
 * não se edita, I3) e pelas duas colunas do diff (docs/07 §18.5).
 */

export function InlineTextView({ value }: { value: InlineText }) {
  return (
    <>
      {value.map((run, index) => {
        const marks = run.marks ?? [];
        let node = <>{run.text}</>;
        if (marks.includes('code')) node = <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[0.92em] dark:bg-neutral-800">{node}</code>;
        if (marks.includes('italic')) node = <em>{node}</em>;
        if (marks.includes('bold')) node = <strong>{node}</strong>;
        if (marks.includes('link')) {
          node = (
            <a href={run.href ?? ''} rel="noreferrer" className="text-blue-600 underline dark:text-blue-400">
              {node}
            </a>
          );
        }
        return <span key={index}>{node}</span>;
      })}
    </>
  );
}

export function InlineImageView({ attachmentId, caption }: { attachmentId: string; caption?: string }) {
  const document = useDocumentStore((s) => s.document);
  const attachment = document === null ? undefined : findInlineImage(document, attachmentId);
  if (attachment === undefined) {
    return (
      <p className="rounded-md border border-dashed border-neutral-300 p-2 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        Imagem não encontrada neste documento.
      </p>
    );
  }
  return (
    <figure className="flex flex-col gap-1">
      <img
        src={`data:${attachment.mimeType};base64,${attachment.data}`}
        alt={caption ?? attachment.fileName}
        className="max-w-full rounded-md border border-neutral-200 dark:border-neutral-800"
      />
      {caption !== undefined && (
        <figcaption className="text-xs text-neutral-500 dark:text-neutral-400">{caption}</figcaption>
      )}
    </figure>
  );
}

export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading1':
      return <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100"><InlineTextView value={block.text} /></h3>;
    case 'heading2':
      return <h4 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200"><InlineTextView value={block.text} /></h4>;
    case 'quote':
      return (
        <blockquote className="border-l-2 border-neutral-300 pl-3 text-sm italic text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
          <InlineTextView value={block.text} />
        </blockquote>
      );
    case 'callout':
      return (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          <InlineTextView value={block.text} />
        </div>
      );
    case 'bulletList':
    case 'numberList': {
      const List = block.type === 'bulletList' ? 'ul' : 'ol';
      return (
        <List className={`ml-5 flex flex-col gap-0.5 text-sm ${block.type === 'bulletList' ? 'list-disc' : 'list-decimal'}`}>
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineTextView value={item} />
            </li>
          ))}
        </List>
      );
    }
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th
                    key={index}
                    className="border border-neutral-200 bg-neutral-50 px-2 py-1 text-left font-semibold dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border border-neutral-200 px-2 py-1 dark:border-neutral-800">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'image':
      return <InlineImageView attachmentId={block.attachmentId} caption={block.caption} />;
    default:
      return <p className="text-sm text-neutral-700 dark:text-neutral-300"><InlineTextView value={block.text} /></p>;
  }
}

export interface RichDocViewProps {
  value: RichDoc | undefined;
  emptyLabel?: string;
}

export function RichDocView({ value, emptyLabel = 'Sem especificação.' }: RichDocViewProps) {
  const blocks = value?.blocks ?? [];
  if (blocks.length === 0) {
    return <p className="text-xs text-neutral-500 dark:text-neutral-400">{emptyLabel}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block) => (
        <BlockView key={block.id} block={block} />
      ))}
    </div>
  );
}
