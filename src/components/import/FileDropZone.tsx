import { useState, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FileDropZoneProps {
  onFile: (file: File) => void;
  children?: ReactNode;
}

/**
 * Drop-zone escopada ao passo 1 do assistente — não é o `DropTarget` global
 * (`src/components/shell/DropTarget.tsx`), que escuta `window` inteiro e
 * sempre tenta abrir o arquivo solto **como documento**. `stopPropagation`
 * no `drop` impede que o mesmo evento chegue ao listener global, então os
 * dois convivem sem um arquivo `.csv` ser interpretado como um `.json` de
 * documento (docs/13-decisoes.md DEC-CARGA-014).
 */
export function FileDropZone({ onFile, children }: FileDropZoneProps) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      role="presentation"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        event.stopPropagation();
        setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        const file = event.dataTransfer.files.item(0);
        if (file !== null) onFile(file);
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
        dragging
          ? 'border-neutral-900 bg-neutral-100 dark:border-neutral-100 dark:bg-neutral-800'
          : 'border-neutral-300 dark:border-neutral-700',
      )}
    >
      <Upload className="h-6 w-6 text-neutral-400" aria-hidden />
      {children ?? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Arraste o arquivo aqui, ou selecione abaixo
        </p>
      )}
    </div>
  );
}
