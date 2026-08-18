import { useMemo, useState } from 'react';
import { ExternalLink, History, Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getChangeRequestTimeline, listProjects } from '@/core/queries';
import { COMPONENT_TYPE_ICONS } from '@/lib/component-labels';
import { formatDateBR } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

const ALL = '__all__';

/**
 * Timeline do Diário de Bordo (docs/07 §19.7, docs/14 §4 US-GOV-08 parcial):
 * DBs **publicados**, em ordem de vigência, com os componentes afetados e o
 * link para o DB e a release. Mesmo padrão visual de `TimelineScreen` (S15) —
 * cartão por entrada, filtro por período e projeto —, mas a régua aqui é a
 * história das mudanças (por DB), não a política vigente numa data.
 */
export function ChangeRequestTimelineScreen() {
  const document = useDocumentStore((s) => s.document);
  const setSelectedChangeRequest = useEditorStore((s) => s.setSelectedChangeRequest);
  const setSelectedRelease = useEditorStore((s) => s.setSelectedRelease);
  const setView = useUiStore((s) => s.setView);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const projects = useMemo(() => (document === null ? [] : listProjects(document)), [document]);

  const entries = useMemo(() => {
    if (document === null) return [];
    return getChangeRequestTimeline(document, {
      ...(projectId !== null ? { projectId } : {}),
      ...(from !== '' ? { from: `${from}T00:00:00.000Z` } : {}),
      ...(to !== '' ? { to: `${to}T23:59:59.999Z` } : {}),
    });
  }, [document, projectId, from, to]);

  if (document === null) return null;

  function openChangeRequest(changeRequestId: string) {
    setSelectedChangeRequest(changeRequestId);
    setView('change-requests');
  }

  function openRelease(releaseId: string) {
    setSelectedRelease(releaseId);
    setView('releases');
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
        <History className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
        <h1 className="shrink-0 font-semibold text-neutral-900 dark:text-neutral-100">
          Linha do tempo do Diário de Bordo
        </h1>

        <Select value={projectId ?? ALL} onValueChange={(v) => setProjectId(v === ALL ? null : v)}>
          <SelectTrigger className="ml-2 w-56" aria-label="Filtrar por projeto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os projetos</SelectItem>
            {projects.map(({ project }) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input type="date" aria-label="De" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <span className="text-xs text-neutral-400">até</span>
        <Input type="date" aria-label="Até" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        {(from !== '' || to !== '' || projectId !== null) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrom('');
              setTo('');
              setProjectId(null);
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      <div className="flex-1 p-4">
        {entries.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Nenhum DB publicado {from !== '' || to !== '' || projectId !== null ? 'neste filtro' : 'ainda'}.
          </p>
        ) : (
          <ul className="flex flex-col gap-4" data-testid="db-timeline-list">
            {entries.map((entry) => (
              <li key={entry.changeRequest.id}>
                <Card className="flex flex-col gap-2.5 p-3.5" data-testid={`db-timeline-row-${entry.changeRequest.code}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">
                      {entry.changeRequest.title}
                    </span>
                    <span className="font-mono text-xs text-neutral-400">{entry.changeRequest.code}</span>
                    <Badge variant="green">vigência {formatDateBR(entry.effectiveFrom)}</Badge>
                    {entry.release !== null && (
                      <button
                        type="button"
                        onClick={() => openRelease(entry.release!.id)}
                        className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/60"
                      >
                        <Package className="h-3 w-3" /> {entry.release.code}
                      </button>
                    )}
                  </div>

                  {entry.affectedComponents.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {entry.affectedComponents.map((component) => {
                        const Icon = COMPONENT_TYPE_ICONS[component.type];
                        return (
                          <span
                            key={component.id}
                            className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                          >
                            <Icon className="h-3 w-3" /> {component.name}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => openChangeRequest(entry.changeRequest.id)}>
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir o DB
                    </Button>
                    {entry.publishedAt !== null && (
                      <span className="text-xs text-neutral-400">publicado em {formatDateBR(entry.publishedAt)}</span>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
