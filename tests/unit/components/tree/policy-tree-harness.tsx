import { render } from '@testing-library/react';
import { PolicyTree } from '@/components/tree/PolicyTree';
import { ToolbarHost, ToolbarSlot } from '@/components/shell/Toolbar';
import { Toaster } from '@/components/ui/toaster';
import { useUiStore } from '@/store/ui-store';

/**
 * A árvore é a barra lateral e a barra de ferramentas é um slot do shell
 * (docs/07-ux-e-editor.md §2.1/§17.1, S41): renderizar `PolicyTree` sozinha
 * deixaria as ações da política sem destino de portal. Este harness monta o
 * par mínimo — `ToolbarHost` + `ToolbarSlot` + a árvore — na largura de tela
 * em que a barra não colapsa e o `code` do nó aparece.
 */
export function renderPolicyTree(projectId: string, expanded: Record<string, boolean> = {}) {
  window.innerWidth = 1400;
  useUiStore.setState((s) => ({
    view: 'projects',
    sidebarWidth: 360,
    componentTree: { ...s.componentTree, projectId, expanded },
  }));

  return render(
    <ToolbarHost>
      <ToolbarSlot />
      <PolicyTree projectId={projectId} />
      <Toaster />
    </ToolbarHost>,
  );
}
