import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Barra de ferramentas contextual do shell — docs/07-ux-e-editor.md §2.1,
 * DEC-UX-003/DEC-UX-006. Uma faixa de 40px abaixo do cabeçalho, preenchida
 * pela tela ativa por **portal**: o slot é do shell, os itens são de quem
 * está na tela, e nenhum `ReactNode` passa por store.
 *
 * Tela que não usa o portal não renderiza a faixa — o contêiner existe no DOM
 * (o portal precisa de um alvo estável), mas só ganha altura, borda e papel de
 * `toolbar` quando alguém o preenche.
 */

interface ToolbarSlotContextValue {
  element: HTMLElement | null;
  setElement: (element: HTMLDivElement | null) => void;
  /** Quem monta um `ToolbarPortal` se registra; a faixa aparece com o primeiro. */
  register: () => () => void;
  filled: boolean;
}

const ToolbarSlotContext = createContext<ToolbarSlotContextValue | null>(null);

export function ToolbarHost({ children }: { children: ReactNode }) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [count, setCount] = useState(0);

  const register = useCallback(() => {
    setCount((current) => current + 1);
    return () => setCount((current) => current - 1);
  }, []);

  const value = useMemo<ToolbarSlotContextValue>(
    () => ({ element, setElement, register, filled: count > 0 }),
    [element, register, count],
  );

  return <ToolbarSlotContext.Provider value={value}>{children}</ToolbarSlotContext.Provider>;
}

/** O contêiner de 40px. Renderizado pelo `Shell`, logo abaixo do cabeçalho. */
export function ToolbarSlot() {
  const context = useContext(ToolbarSlotContext);
  if (context === null) return null;
  const { filled, setElement } = context;

  return (
    <div
      ref={setElement}
      {...(filled ? { role: 'toolbar', 'aria-label': 'Ações da tela' } : { hidden: true })}
      data-testid="shell-toolbar"
      className={
        filled
          ? 'flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-neutral-200 px-3 print:hidden dark:border-neutral-800'
          : undefined
      }
    />
  );
}

/** Injeta os itens da tela ativa na faixa do shell. */
export function ToolbarPortal({ children }: { children: ReactNode }) {
  const context = useContext(ToolbarSlotContext);
  const register = context?.register;

  useEffect(() => {
    if (register === undefined) return undefined;
    return register();
  }, [register]);

  if (context === null || context.element === null) return null;
  return createPortal(children, context.element);
}

/** Separador vertical entre grupos da barra (§2.1). */
export function ToolbarSeparator() {
  return <span aria-hidden className="h-5 w-px shrink-0 bg-neutral-200 dark:bg-neutral-800" />;
}
