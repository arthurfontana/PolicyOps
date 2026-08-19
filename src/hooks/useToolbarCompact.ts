import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Colapso dos itens de criação da barra de ferramentas — docs/07-ux-e-editor.md
 * §2.1, "cabe numa linha", DEC-UX-006.
 *
 * Duas condições, nesta ordem: abaixo de ~1100px de janela a barra já nasce
 * compacta (é a régua da §2.1); acima disso ela **mede** — se o conteúdo não
 * couber na linha, colapsa também. Medir importa porque a barra não tem sempre
 * o mesmo conteúdo: a mesma janela de 1280px cabe a barra de uma tela e não
 * cabe a de outra.
 *
 * A volta ao formato completo é por histerese: guarda a largura de janela em
 * que faltou espaço e só expande acima dela, para a barra não oscilar entre os
 * dois formatos a cada pixel de arrasto.
 */
export const TOOLBAR_COMPACT_WIDTH = 1100;

export function useToolbarCompact(ref: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < TOOLBAR_COMPACT_WIDTH,
  );
  /** Largura de janela a partir da qual vale a pena tentar o formato completo de novo. */
  const expandAtRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    function measure() {
      const element = ref.current;
      const narrowWindow = window.innerWidth < TOOLBAR_COMPACT_WIDTH;

      setCompact((current) => {
        if (narrowWindow) return true;
        if (element === null) return current;

        if (!current) {
          const missing = element.scrollWidth - element.clientWidth;
          if (missing > 1) {
            expandAtRef.current = window.innerWidth + missing;
            return true;
          }
          return false;
        }

        const expandAt = expandAtRef.current;
        if (expandAt === null || window.innerWidth >= expandAt) {
          expandAtRef.current = null;
          return false;
        }
        return current;
      });
    }

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  return compact;
}
