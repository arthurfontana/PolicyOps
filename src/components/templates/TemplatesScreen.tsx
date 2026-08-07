import { useEffect, useState } from 'react';
import { TemplateEditor } from './TemplateEditor';
import { TemplatesList } from './TemplatesList';
import type { ExtractedTemplateSeed } from '@/core/templates/extract';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

type Mode = { kind: 'list' } | { kind: 'new'; seed?: ExtractedTemplateSeed } | { kind: 'edit'; templateId: string };

/** Rota `/templates` — docs/07-ux-e-editor.md §11. */
export function TemplatesScreen() {
  const document = useDocumentStore((s) => s.document);
  const pendingSeed = useEditorStore((s) => s.pendingTemplateSeed);
  const requestTemplateFromMatrix = useEditorStore((s) => s.requestTemplateFromMatrix);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  // "Criar template a partir desta matriz" deixou um pedido pendente — abre
  // direto no editor de template novo, já semeado, e limpa o pedido.
  useEffect(() => {
    if (pendingSeed === null) return;
    setMode({ kind: 'new', seed: pendingSeed });
    requestTemplateFromMatrix(null);
  }, [pendingSeed, requestTemplateFromMatrix]);

  if (document === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum documento aberto.</p>
      </div>
    );
  }

  if (mode.kind === 'new') {
    return (
      <TemplateEditor
        template={null}
        {...(mode.seed !== undefined ? { seed: mode.seed } : {})}
        onBack={() => setMode({ kind: 'list' })}
        onSaved={(templateId) => setMode({ kind: 'edit', templateId })}
      />
    );
  }

  if (mode.kind === 'edit') {
    const template = document.templates.find((candidate) => candidate.id === mode.templateId);
    if (template === undefined) {
      return <TemplatesList onSelect={(id) => setMode({ kind: 'edit', templateId: id })} onCreate={() => setMode({ kind: 'new' })} />;
    }
    return (
      <TemplateEditor
        template={template}
        onBack={() => setMode({ kind: 'list' })}
        onSaved={() => setMode({ kind: 'list' })}
      />
    );
  }

  return (
    <TemplatesList onSelect={(id) => setMode({ kind: 'edit', templateId: id })} onCreate={() => setMode({ kind: 'new' })} />
  );
}
