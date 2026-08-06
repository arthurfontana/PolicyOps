import { useEffect, useState, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { usePersistenceStore } from '@/store/persistence-store';

/**
 * Arrastar-e-soltar em **qualquer lugar da janela** (docs/07-ux-e-editor.md §1).
 *
 * O componente só captura o arquivo e entrega ao store; quem sabe lê-lo é o
 * adapter. Vale nos dois modos — é o único jeito de abrir sem seletor quando
 * a File System Access API não está disponível.
 */
export function DropTarget({ children }: { children: ReactNode }) {
  const openDroppedFile = usePersistenceStore((s) => s.openDroppedFile);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;

    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      depth += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      // Sem isto o navegador abre o arquivo largado, trocando a página.
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const file = event.dataTransfer.files.item(0);
      if (file !== null) void openDroppedFile(file);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [openDroppedFile]);

  return (
    <>
      {children}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-neutral-900/40">
          <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-white bg-neutral-900/80 px-8 py-6 text-white">
            <Upload className="h-6 w-6" aria-hidden />
            <span className="text-sm">Solte o arquivo para abrir</span>
          </div>
        </div>
      )}
    </>
  );
}
