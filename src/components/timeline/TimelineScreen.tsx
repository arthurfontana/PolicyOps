import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ExternalLink, GitCompare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Grid } from '@/components/grid/Grid';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ExportMenu } from '@/components/shell/ExportMenu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { orderForCompare } from '@/core/diff';
import { exportPortfolioCanonical } from '@/core/export/canonical';
import type { Matrix, MatrixVersion, PolicyOpsDocument } from '@/core/document/schema';
import {
  axisStructureLabel,
  getEditorView,
  getMatrixTimeline,
  getPortfolioAt,
  listProjects,
  type PortfolioEntry,
} from '@/core/queries';
import { downloadJson } from '@/lib/download';
import { formatDateBR } from '@/lib/format';
import { DATE_SHORTCUTS, endOfDayInstant, formatDateInputBR, toDateInputValue } from '@/lib/timeline-dates';
import { buildTimelineHash, parseTimelineHash } from '@/lib/timeline-hash';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';
import { MatrixTimelineBar } from './MatrixTimelineBar';

/**
 * Tela de vigência — docs/07-ux-e-editor.md §10, docs/prompts/S15-vigencia-por-data.md.
 *
 * Responde "qual era a política vigente em dd/mm/aaaa?" com um clique.
 * `getEffectiveVersion`/`getPortfolioAt` (S04) fazem a consulta; esta tela só
 * lê o resultado e desenha — nenhuma regra de vigência mora aqui.
 */

type ViewMode = 'list' | 'portfolio';

export function TimelineScreen() {
  const document = useDocumentStore((s) => s.document);
  const openMatrix = useEditorStore((s) => s.openMatrix);
  const setCompareVersions = useEditorStore((s) => s.setCompareVersions);
  const editorSelectedProjectId = useEditorStore((s) => s.selectedProjectId);
  const setView = useUiStore((s) => s.setView);

  // Lido uma vez, no primeiro render: os efeitos abaixo cuidam do resto.
  const [initial] = useState(() =>
    parseTimelineHash(typeof window !== 'undefined' ? window.location.hash : ''),
  );
  const [date, setDate] = useState<string>(initial.date ?? toDateInputValue(new Date()));
  const [projectId, setProjectId] = useState<string | null>(initial.projectId);
  const [mode, setMode] = useState<ViewMode>('list');

  const projects = useMemo(() => (document === null ? [] : listProjects(document)), [document]);

  // Sem projeto no hash: cai no selecionado no editor, ou no primeiro da lista.
  useEffect(() => {
    if (projectId !== null) return;
    const fallback =
      editorSelectedProjectId !== null && projects.some((entry) => entry.project.id === editorSelectedProjectId)
        ? editorSelectedProjectId
        : (projects[0]?.project.id ?? null);
    if (fallback !== null) setProjectId(fallback);
  }, [projectId, projects, editorSelectedProjectId]);

  // Grava data/projeto no hash — link compartilhável (docs/07 §10).
  useEffect(() => {
    const nextHash = buildTimelineHash({ date, projectId });
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
  }, [date, projectId]);

  // Voltar/avançar no navegador também deve atualizar a tela.
  useEffect(() => {
    function onHashChange() {
      const parsed = parseTimelineHash(window.location.hash);
      if (parsed.date !== null) setDate(parsed.date);
      if (parsed.projectId !== null) setProjectId(parsed.projectId);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (document === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum documento aberto.</p>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Este documento ainda não tem projetos.</p>
      </div>
    );
  }

  const now = new Date();
  const selectedAt = endOfDayInstant(date);
  const activeProjectId = projectId ?? projects[0]!.project.id;
  const activeProject = projects.find((entry) => entry.project.id === activeProjectId)?.project ?? projects[0]!.project;

  const portfolio = getPortfolioAt(document, activeProjectId, selectedAt);
  const todayByMatrix = new Map(
    getPortfolioAt(document, activeProjectId, now).map((entry) => [entry.matrix.id, entry.version]),
  );

  function openVersion(matrixId: string, versionId: string): void {
    openMatrix(matrixId, versionId);
    setView('matrix');
  }

  function compareWithToday(dateVersionId: string, todayVersionId: string): void {
    const ordered = orderForCompare(document!, dateVersionId, todayVersionId);
    setCompareVersions(ordered.aId, ordered.bId);
    setView('compare');
  }

  function exportView(): void {
    const data = exportPortfolioCanonical(document!, activeProjectId, selectedAt);
    downloadJson(`vigencia-${activeProject.code}-${date}.json`, data);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
        <CalendarClock className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
        <h1 className="shrink-0 font-semibold text-neutral-900 dark:text-neutral-100">Vigência</h1>

        <Select value={activeProjectId} onValueChange={setProjectId}>
          <SelectTrigger className="ml-2 w-56" aria-label="Selecionar projeto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {projects.map(({ project }) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="date"
          aria-label="Data"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="w-40"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {DATE_SHORTCUTS.map((shortcut) => (
            <Button
              key={shortcut.label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDate(toDateInputValue(shortcut.resolve()))}
            >
              {shortcut.label}
            </Button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Tabs value={mode} onValueChange={(value) => setMode(value as ViewMode)}>
            <TabsList>
              <TabsTrigger value="list">Lista</TabsTrigger>
              <TabsTrigger value="portfolio">Portfólio</TabsTrigger>
            </TabsList>
          </Tabs>
          <ExportMenu
            label="Exportar esta visão"
            items={[{ key: 'json', label: 'Exportar JSON', onSelect: exportView }]}
          />
        </div>
      </div>

      <div className="flex-1 p-4">
        {mode === 'list' ? (
          <TimelineList
            entries={portfolio}
            date={date}
            now={now}
            selectedAt={selectedAt}
            todayByMatrix={todayByMatrix}
            onOpenVersion={openVersion}
            onCompareWithToday={compareWithToday}
          />
        ) : (
          <PortfolioGrid document={document} entries={portfolio} date={date} onOpenVersion={openVersion} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista de matrizes
// ---------------------------------------------------------------------------

function TimelineList({
  entries,
  date,
  now,
  selectedAt,
  todayByMatrix,
  onOpenVersion,
  onCompareWithToday,
}: {
  entries: PortfolioEntry[];
  date: string;
  now: Date;
  selectedAt: Date;
  todayByMatrix: Map<string, MatrixVersion | null>;
  onOpenVersion: (matrixId: string, versionId: string) => void;
  onCompareWithToday: (dateVersionId: string, todayVersionId: string) => void;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">Este projeto ainda não tem matrizes.</p>;
  }

  return (
    <ul className="flex flex-col gap-4">
      {entries.map(({ matrix, version }) => {
        const timeline = getMatrixTimeline(matrix);
        const todayVersion = todayByMatrix.get(matrix.id) ?? null;
        const compareEnabled = version !== null && todayVersion !== null;

        return (
          <li key={matrix.id}>
            <Card className="flex flex-col gap-2.5 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-neutral-900 dark:text-neutral-100">{matrix.name}</span>
                <span className="font-mono text-xs text-neutral-400">{matrix.code}</span>
                {version === null ? (
                  <Badge variant="secondary">sem política vigente em {formatDateInputBR(date)}</Badge>
                ) : (
                  <>
                    <Badge variant={version.state === 'SUPERSEDED' ? 'secondary' : 'green'}>
                      v{version.number}
                      {todayVersion?.id === version.id ? ' · vigente hoje' : ''}
                    </Badge>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      vigente de {formatDateBR(version.effectiveFrom!)} a{' '}
                      {version.effectiveTo === undefined ? 'hoje' : formatDateBR(version.effectiveTo)}
                    </span>
                    {version.publishedBy !== undefined && (
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">
                        publicada por {version.publishedBy}
                      </span>
                    )}
                  </>
                )}
              </div>

              {version !== null && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {axisStructureLabel(version.axes.x)} × {axisStructureLabel(version.axes.y)}
                </p>
              )}

              <MatrixTimelineBar
                segments={timeline}
                now={now}
                selectedAt={selectedAt}
                onSelectVersion={(versionId) => onOpenVersion(matrix.id, versionId)}
              />

              <div className="flex flex-wrap items-center gap-2">
                {version !== null && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenVersion(matrix.id, version.id)}
                  >
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir no viewer
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!compareEnabled}
                  onClick={() => compareEnabled && onCompareWithToday(version!.id, todayVersion!.id)}
                >
                  <GitCompare className="mr-1.5 h-3.5 w-3.5" /> Comparar com hoje
                </Button>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Visão de portfólio — miniaturas
// ---------------------------------------------------------------------------

function PortfolioGrid({
  document,
  entries,
  date,
  onOpenVersion,
}: {
  document: PolicyOpsDocument;
  entries: PortfolioEntry[];
  date: string;
  onOpenVersion: (matrixId: string, versionId: string) => void;
}) {
  const withVersion = entries.filter(
    (entry): entry is { matrix: Matrix; version: MatrixVersion } => entry.version !== null,
  );

  if (withVersion.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Nenhuma matriz deste projeto tinha política vigente em {formatDateInputBR(date)}.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {withVersion.map(({ matrix, version }) => {
        const view = getEditorView(document, version.id);
        return (
          <Card key={matrix.id} className="flex flex-col gap-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {matrix.name}
              </span>
              <Badge variant="secondary">v{version.number}</Badge>
            </div>
            <div className="h-36 w-full overflow-auto rounded border border-neutral-200 dark:border-neutral-800">
              <Grid view={view} zoom={1} variant="thumbnail" />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-end"
              onClick={() => onOpenVersion(matrix.id, version.id)}
            >
              Abrir <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </Card>
        );
      })}
    </div>
  );
}
