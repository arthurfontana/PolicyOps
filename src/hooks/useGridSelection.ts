import { useMemo } from 'react';
import type { AxisRole } from '@/core/document/schema';
import type { Coord, Direction, SelectionView } from '@/core/axes/selection';
import type { GridModifiers, GridSelectionApi } from '@/components/grid/Grid';
import { useEditorStore } from '@/store/editor-store';

/**
 * Liga o `editor-store` ao grid — docs/07-ux-e-editor.md §5.
 *
 * O grid não conhece o store (é componente de apresentação, S09) e o store não
 * conhece a view (a geometria vem por argumento, S10). Este hook é a única
 * costura entre os dois, e é aqui que cada gesto vira a ação da tabela de §5:
 *
 * | Gesto | Ação |
 * |---|---|
 * | clique | `selectSingle` + começa o marquee |
 * | Shift + clique | `extendTo` (parte da **âncora**) |
 * | Ctrl/Cmd + clique | marquee aditivo; no `mouseup` sem arrasto, `toggle` |
 * | arrastar | `selectRect` substituindo |
 * | Ctrl/Cmd + arrastar | `selectRect` somando |
 * | clique em cabeçalho | `selectHeader` (qualquer nível) |
 * | Shift + clique em cabeçalho | `extendHeader` (faixa do mesmo nível) |
 * | Ctrl/Cmd + clique em cabeçalho | `toggleHeader` |
 */
export function useGridSelection(view: SelectionView): GridSelectionApi {
  const selection = useEditorStore((state) => state.selection);
  const anchor = useEditorStore((state) => state.anchor);
  const focus = useEditorStore((state) => state.focus);
  const marquee = useEditorStore((state) => state.marquee);

  return useMemo<GridSelectionApi>(() => {
    const store = () => useEditorStore.getState();
    return {
      selection,
      anchor,
      focus,
      marquee,

      pressCell(coord: Coord, modifiers: GridModifiers) {
        if (modifiers.shift) {
          store().extendTo(view, coord);
          return;
        }
        if (modifiers.ctrl) {
          // Nada muda ainda: só no `mouseup` se sabe se foi clique (alterna a
          // célula) ou arrasto aditivo (soma o retângulo).
          store().startMarquee(coord, true);
          return;
        }
        store().selectSingle(coord);
        store().startMarquee(coord, false);
      },

      hoverCell(coord: Coord) {
        store().updateMarquee(coord);
      },

      releasePointer() {
        store().endMarquee(view);
      },

      pressHeader(role: AxisRole, level: number, prefixPath: string, modifiers: GridModifiers) {
        if (modifiers.shift) store().extendHeader(view, role, level, prefixPath);
        else if (modifiers.ctrl) store().toggleHeader(view, role, level, prefixPath);
        else store().selectHeader(view, role, level, prefixPath);
      },

      selectAll() {
        store().selectAll(view);
      },

      clear() {
        store().clear();
      },

      moveFocus(direction: Direction, shift: boolean) {
        store().moveFocus(view, direction, { shift });
      },
    };
  }, [selection, anchor, focus, marquee, view]);
}
