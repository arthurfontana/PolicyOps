import { Hammer } from 'lucide-react';
import type { View } from '@/store/ui-store';

const VIEW_LABELS: Partial<Record<View, string>> = {
  projects: 'Projetos',
  'library-variables': 'Biblioteca › Variáveis',
  'library-compatibility': 'Biblioteca › Compatibilidade',
  'library-content': 'Biblioteca › Conteúdo',
  templates: 'Templates',
  timeline: 'Vigência',
  drafts: 'Rascunhos',
  matrix: 'Matriz',
};

export function UnderConstruction({ view }: { view: View }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Hammer className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
      <h1 className="text-lg font-semibold text-neutral-700 dark:text-neutral-300">
        {VIEW_LABELS[view] ?? view}
      </h1>
      <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
        Esta seção ainda está em construção. Ela chega numa sessão futura de implementação.
      </p>
    </div>
  );
}
