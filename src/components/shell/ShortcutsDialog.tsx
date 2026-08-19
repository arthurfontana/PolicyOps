import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ShortcutGroup = { title: string; shortcuts: Array<{ keys: string; description: string }> };

/** docs/07-ux-e-editor.md §2, §4.3, §5, §12. */
const GROUPS: ShortcutGroup[] = [
  {
    title: 'Geral',
    shortcuts: [
      { keys: 'Ctrl+S', description: 'Salvar' },
      { keys: 'Ctrl+Shift+S', description: 'Salvar como' },
      { keys: '[', description: 'Recolher/expandir a barra lateral' },
      { keys: ']', description: 'Recolher/expandir o inspector' },
      { keys: '?', description: 'Abrir esta lista de atalhos' },
    ],
  },
  {
    title: 'Política — barra de ferramentas',
    shortcuts: [
      { keys: 'Enter', description: 'Nova seção: irmão do nó selecionado, já em edição de nome' },
      { keys: 'Shift+Enter', description: 'Nova regra: irmão do nó selecionado, do tipo Regra' },
      { keys: 'Ctrl+Shift+P', description: 'Publicar pendentes do projeto' },
      { keys: 'Ctrl+Shift+N', description: 'Ir para o próximo pendente (rascunho aberto ou revisão pendente), dando a volta' },
    ],
  },
  {
    title: 'Política — árvore',
    shortcuts: [
      { keys: '↑ / ↓', description: 'Move o foco entre os nós visíveis' },
      { keys: '→', description: 'Expande o nó em foco' },
      { keys: '←', description: 'Recolhe o nó em foco, ou salta para o pai se já estiver recolhido' },
      { keys: 'Home / End', description: 'Salta para o primeiro/último nó visível' },
      { keys: 'Digitar letras', description: 'Typeahead: salta para o próximo nó cujo nome começa com o texto digitado' },
      { keys: 'Tab / Shift+Tab', description: 'Na criação, desce/sobe um nível antes de gravar' },
      { keys: 'F2', description: 'Renomear o nó (duplo clique faz o mesmo)' },
      { keys: 'Ctrl/Cmd+D', description: 'Duplicar o nó como irmão logo abaixo' },
      { keys: 'Delete', description: 'Arquivar o nó em foco (com confirmação)' },
      { keys: 'Alt+clique no chevron', description: 'Abre ou fecha a subárvore inteira' },
      { keys: '← / →', description: 'Com a alça da navegação em foco, ajusta a largura em 16px' },
    ],
  },
  {
    title: 'Política — página do componente',
    shortcuts: [
      { keys: 'Alt+↑ / Alt+↓', description: 'Vai para o componente irmão anterior/próximo' },
      { keys: 'F2 / clique no nome', description: 'Renomear o componente' },
    ],
  },
  {
    title: 'Grid — seleção',
    shortcuts: [
      { keys: 'Clique', description: 'Seleciona uma célula e define a âncora' },
      { keys: 'Shift+clique', description: 'Retângulo entre a âncora e a célula clicada' },
      { keys: 'Ctrl/Cmd+clique', description: 'Alterna a célula na seleção' },
      { keys: 'Arrastar', description: 'Marquee retangular — substitui a seleção' },
      { keys: 'Ctrl/Cmd+arrastar', description: 'Marquee que soma à seleção' },
      { keys: 'Clique em cabeçalho', description: 'Seleciona todas as combinações sob o caminho' },
      { keys: 'Clique no canto superior esquerdo', description: 'Seleciona tudo' },
      { keys: 'Setas', description: 'Move a seleção única' },
      { keys: 'Shift+setas', description: 'Expande o retângulo a partir da âncora' },
      { keys: 'Ctrl/Cmd+A', description: 'Seleciona tudo' },
      { keys: 'Esc', description: 'Limpa a seleção' },
      { keys: 'Enter', description: 'Foca o primeiro campo do inspector' },
      { keys: 'Delete / Backspace', description: 'Limpa as células selecionadas' },
    ],
  },
  {
    title: 'Grid — zoom e edição',
    shortcuts: [
      { keys: 'Ctrl+scroll', description: 'Ajusta o zoom (50–200%)' },
      { keys: 'Ctrl+0', description: 'Redefine o zoom' },
      { keys: 'Ctrl+Z', description: 'Desfazer' },
      { keys: 'Ctrl+Shift+Z', description: 'Refazer' },
    ],
  },
];

/** Diálogo de atalhos — docs/07-ux-e-editor.md §12: aberto com `?`. */
export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Atalhos de teclado</DialogTitle>
          <DialogDescription>
            Atalhos só agem com o foco fora de campos de texto. Na árvore da política, a ordem
            reflete o documento de política — a sequência de avaliação do motor está descrita no
            texto de cada regra.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          {GROUPS.map((group) => (
            <div key={group.title} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                {group.title}
              </h3>
              <dl className="flex flex-col gap-1">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.keys} className="flex items-center justify-between gap-4 text-sm">
                    <dt className="text-neutral-600 dark:text-neutral-300">{shortcut.description}</dt>
                    <dd>
                      <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                        {shortcut.keys}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
