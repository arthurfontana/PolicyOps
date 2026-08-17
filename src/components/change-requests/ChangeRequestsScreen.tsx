import { useMemo, useState } from 'react';
import { BookOpenCheck, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChangeRequestDetail } from '@/components/change-requests/ChangeRequestDetail';
import { CreateChangeRequestDialog } from '@/components/change-requests/CreateChangeRequestDialog';
import { listChangeRequests } from '@/core/document/change-requests';
import { CR_STATUSES, type CrPriority, type CrStatus } from '@/core/document/schema';
import {
  CR_PRIORITY_LABELS,
  CR_STATUS_CLOSED_CLASS,
  CR_STATUS_LABELS,
  CR_STATUS_VARIANTS,
} from '@/lib/change-request-labels';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';

const ALL = '__all__';
const STATUSES = CR_STATUSES;
const PRIORITIES: readonly CrPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** Lista de DBs por projeto (US-GOV-03/04) — código, título, status, prioridade, solicitante, filtros. */
export function ChangeRequestsScreen() {
  const document = useDocumentStore((s) => s.document);
  const selectedChangeRequestId = useEditorStore((s) => s.selectedChangeRequestId);
  const setSelectedChangeRequest = useEditorStore((s) => s.setSelectedChangeRequest);

  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<CrStatus | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<CrPriority | null>(null);
  const [componentFilter, setComponentFilter] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const componentOptions = useMemo(
    () =>
      document === null
        ? []
        : document.components
            .filter((c) => c.archivedAt === undefined)
            .map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))
            .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    [document],
  );

  const results = useMemo(() => {
    if (document === null) return [];
    return listChangeRequests(document, {
      ...(projectFilter !== null ? { projectId: projectFilter } : {}),
      ...(statusFilter !== null ? { status: [statusFilter] } : {}),
      ...(priorityFilter !== null ? { priority: priorityFilter } : {}),
      ...(componentFilter !== null ? { componentId: componentFilter } : {}),
      ...(search.trim() !== '' ? { search } : {}),
    });
  }, [document, projectFilter, statusFilter, priorityFilter, componentFilter, search]);

  if (document === null) return null;

  if (selectedChangeRequestId !== null) {
    return <ChangeRequestDetail changeRequestId={selectedChangeRequestId} />;
  }

  const filterActive =
    search.trim() !== '' || projectFilter !== null || statusFilter !== null || priorityFilter !== null || componentFilter !== null;

  function clearFilters() {
    setSearch('');
    setProjectFilter(null);
    setStatusFilter(null);
    setPriorityFilter(null);
    setComponentFilter(null);
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpenCheck className="h-5 w-5 text-neutral-400" />
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Diário de Bordo</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Novo DB
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar por código ou título…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={projectFilter ?? ALL} onValueChange={(v) => setProjectFilter(v === ALL ? null : v)}>
          <SelectTrigger className="w-48" aria-label="Filtrar por projeto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os projetos</SelectItem>
            {document.projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter ?? ALL} onValueChange={(v) => setStatusFilter(v === ALL ? null : (v as CrStatus))}>
          <SelectTrigger className="w-44" aria-label="Filtrar por status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os status</SelectItem>
            {STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {CR_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter ?? ALL} onValueChange={(v) => setPriorityFilter(v === ALL ? null : (v as CrPriority))}>
          <SelectTrigger className="w-40" aria-label="Filtrar por prioridade">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Toda prioridade</SelectItem>
            {PRIORITIES.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {CR_PRIORITY_LABELS[priority]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Combobox
            options={componentOptions}
            value={componentFilter ?? undefined}
            onChange={setComponentFilter}
            placeholder="Filtrar por componente…"
            searchPlaceholder="Buscar componente…"
            aria-label="Filtrar por componente"
            className="w-56"
          />
          {componentFilter !== null && (
            <Button type="button" variant="ghost" size="icon" aria-label="Limpar filtro de componente" onClick={() => setComponentFilter(null)}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        {filterActive && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            Limpar filtros
          </Button>
        )}
      </div>

      {results.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <BookOpenCheck className="h-8 w-8 text-neutral-300 dark:text-neutral-700" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {filterActive ? 'Nenhum DB corresponde ao filtro.' : 'Nenhum DB ainda neste documento.'}
            </p>
            {filterActive ? (
              <Button variant="outline" onClick={clearFilters}>
                Limpar filtro
              </Button>
            ) : (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Novo DB
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2" data-testid="change-request-list">
          {results.map((cr) => (
            <button
              key={cr.id}
              type="button"
              data-testid={`change-request-row-${cr.code}`}
              onClick={() => setSelectedChangeRequest(cr.id)}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">{cr.title}</span>
                  <span className="shrink-0 font-mono text-xs text-neutral-400">{cr.code}</span>
                </div>
                <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {cr.requestedBy}
                  {cr.items.length > 0 ? ` · ${cr.items.length} item(ns)` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {cr.priority !== undefined && (
                  <Badge variant="outline" className="text-[10px]">
                    {CR_PRIORITY_LABELS[cr.priority]}
                  </Badge>
                )}
                <Badge
                  variant={CR_STATUS_VARIANTS[cr.status]}
                  className={cr.status === 'REJECTED' || cr.status === 'CANCELLED' ? CR_STATUS_CLOSED_CLASS : undefined}
                >
                  {CR_STATUS_LABELS[cr.status]}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      )}

      <CreateChangeRequestDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => setSelectedChangeRequest(id)} />
    </div>
  );
}
