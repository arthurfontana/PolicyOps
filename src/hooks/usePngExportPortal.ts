import { useCallback, useEffect, useRef, useState } from 'react';
import { exportNodeAsPng } from '@/lib/export-png';

/**
 * Ciclo de vida do export PNG (docs/08 §5): o nó a capturar só existe fora da
 * tela (`position: fixed; left: -99999px`) enquanto a captura está em
 * andamento — é o que deixa `GridExportSnapshot` montar com título, versão,
 * vigência e legenda sem afetar o layout visível.
 */
export function usePngExportPortal(onError?: (error: unknown) => void) {
  const [pending, setPending] = useState<{ fileName: string } | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);

  const requestExport = useCallback((fileName: string) => setPending({ fileName }), []);

  useEffect(() => {
    if (pending === null) return;
    const node = nodeRef.current;
    if (node === null) return;
    let cancelled = false;
    void exportNodeAsPng(node, pending.fileName)
      .catch((error: unknown) => {
        if (!cancelled) onError?.(error);
      })
      .finally(() => {
        if (!cancelled) setPending(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  return { nodeRef, pending, requestExport };
}
