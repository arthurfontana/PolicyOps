import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ExternalLink, GitCompare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Grid } from '@/components/grid/Grid';
import { ExportMenu } from '@/components/shell/ExportMenu';
import { ToolbarPortal } from '@/components/shell/Toolbar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TimelineToolbar } from '@/components/timeline/TimelineToolbar';
import { PolicyStructureDetail, PolicyStructureTree } from '@/components/timeline/PolicyStructureView';
import {
  buildStructureRows,
  type StructureFilter,
} from '@/components/timeline/policy-structure-rows';
import { orderForCompare } from '@/core/diff';
import { exportPortfolioCanonical } from '@/core/export/canonical';
import type {
  ComponentReviewStatus,
  Matrix,
  MatrixVersion,
  PolicyComponentType,
  PolicyOpsDocument,
} from '@/core/document/schema';
import {
  axisStructureLabel,
  filterComponentTree,
  getEditorView,
  getMatrixTimeline,
  getPortfolioAt,
  listProjects,
  resolveOpenVersion,
  type PortfolioEntry,
} from '@/core/queries';
import { getPolicyAt, type PolicySnapshotNode } from '@/core/timeline/policy-at';
import { downloadJson } from '@/lib/download';
import { formatDateBR } from '@/lib/format';
import { endOfDayInstant, formatDateInputBR, toDateInputValue } from '@/lib/timeline-dates';
import { buildTimelineHash, parseTimelineHash } from '@/lib/timeline-hash';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';
import { MatrixTimelineBar } from './MatrixTimelineBar';

/**
 * Tela de vigência — docs/07-ux-e-editor.md §10, DEC-UX-004.
 *
 * A tela de leitura do passado: **toda a estrutura do projeto na data
 * escolhida**, não só as matrizes. Três abas sobre a mesma data — Estrutura
 * (padrão), Matrizes e Portfólio —, e é aqui que mora o antigo "ver como
 * em…" da barra da árvore: a árvore da barra lateral é sempre hoje e nunca
 * entra em somente leitura (§20.1).
 *
 * `getEffectiveVersion`/`getPortfolioAt` (S04) e `getPolicyAt` (S39) fazem a
 * consulta; esta tela só lê o resultado e desenha — nenhuma regra de vigência
 * mora aqui.
 */

type ViewMode = 'structure' | 'matrices' | 'portfolio';

type FilterState = {
  search: string;
  types: PolicyComponentType[];
  reviewStatuses: ComponentReviewStatus[];
  tags: string[];
};

const EMPTY_FILTER: FilterState = { search: '', types: [], reviewStatuses: [], tags: [] };

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];
}

export function TimelineScreen() {
  const document = useDocumentStore((s) => s.document);
  const openMatrix = useEditorStore((s) => s.openMatrix);
  const setCompareVersions = useEditorStore((s) => s.setCompareVersions);
  const setSelectedComponent = useEditorStore((s) => s.setSelectedComponent);
  const setSelectedProject = useEditorStore((s) => s.setSelectedProject);
  const editorSelectedProjectId = useEditorStore((s) => s.selectedProjectId);
  const setView = useUiStore((s) => s.setView);
  const expandComponents = useUiStore((s) => s.expandComponents);
  // A data é da store (docs/07 §20.2/§20.3): os saltos que abrem esta tela vêm
  // da página do componente e da comparação, e chegam com a data escolhida.
  const policyAtDate = useUiStore((s) => s.policyAtDate);
  const setPolicyAtDate = useUiStore((s) => s.setPolicyAtDate);

  // Lido uma vez, no primeiro render: os efeitos abaixo cuidam do resto.
  const [initial] = useState(() =>
    parseTimelineHash(typeof window !== 'undefined' ? window.location.hash : ''),
  );
  const date = policyAtDate ?? initial.date ?? toDateInputValue(new Date());
  const [projectId, setProjectId] = useState<string | null>(initial.projectId);
  const [mode, setMode] = useState<ViewMode>('structure');
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const projects = useMemo(() => (document === null ? [] : listProjects(document)), [document]);

  useEffect(() => {
    if (policyAtDate === null) setPolicyAtDate(date);
  }, [policyAtDate, date, setPolicyAtDate]);

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
      if (parsed.date !== null) setPolicyAtDate(parsed.date);
      if (parsed.projectId !== null) setProjectId(parsed.projectId);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [setPolicyAtDate]);

  const activeProjectId = projectId ?? projects[0]?.project.id ?? null;

  const snapshot = useMemo(
    () =>
      document === null || activeProjectId === null
        ? null
        : getPolicyAt(document, activeProjectId, endOfDayInstant(date)),
    [document, activeProjectId, date],
  );

  const treeFilter = useMemo(
    () =>
      document === null || activeProjectId === null
        ? null
        : filterComponentTree(document, activeProjectId, filter),
    [document, activeProjectId, filter],
  );

  const filterActive =
    filter.search.trim() !== '' ||
    filter.types.length > 0 ||
    filter.reviewStatuses.length > 0 ||
    filter.tags.length > 0;

  const rows = useMemo(() => {
    if (snapshot === null) return [];
    const structureFilter: StructureFilter | null =
      filterActive && treeFilter !== null
        ? {
            matchedIds: treeFilter.matchedIds,
            visibleIds: treeFilter.visibleIds,
            search: filter.search.trim(),
            types: filter.types,
            componentOnly: filter.reviewStatuses.length > 0 || filter.tags.length > 0,
          }
        : null;
    return buildStructureRows(snapshot, structureFilter);
  }, [snapshot, treeFilter, filterActive, filter]);

  const selectedRow = rows.find((row) => row.key === selectedKey) ?? null;

  if (document === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum documento aberto.</p>
      </div>
    );
  }

  if (projects.length === 0 || activeProjectId === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Este documento ainda não tem projetos.</p>
      </div>
    );
  }

  const now = new Date();
  const selectedAt = endOfDayInstant(date);
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
    const data = exportPortfolioCanonical(document!, activeProjectId!, selectedAt);
    downloadJson(`vigencia-${activeProject.code}-${date}.json`, data);
  }

  /**
   * "Abrir no editor (hoje)" (§10): sai da consulta e vai ao **presente** —
   * a matriz abre no grid na versão de hoje, o componente abre na tela da
   * política, com os ancestrais expandidos.
   */
  function openInEditor(node: PolicySnapshotNode): void {
    if (node.matrix !== null) {
      const version = resolveOpenVersion(node.matrix);
      openMatrix(node.matrix.id, version?.id ?? null);
      setView('matrix');
      return;
    }
    if (node.component === null) return;
    setSelectedProject(node.component.projectId);
    expandComponents(node.ancestors.map((ancestor) => ancestor.id));
    setSelectedComponent(node.component.id);
    setView('projects');
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ToolbarPortal>
        <TimelineToolbar
          date={date}
          onDateChange={setPolicyAtDate}
          projects={projects.map(({ project }) => ({ id: project.id, name: project.name }))}
          projectId={activeProjectId}
          onProjectChange={setProjectId}
          showFilters={mode === 'structure'}
          search={filter.search}
          onSearchChange={(search) => setFilter((current) => ({ ...current, search }))}
          types={filter.types}
          onToggleType={(type) => setFilter((current) => ({ ...current, types: toggle(current.types, type) }))}
          reviewStatuses={filter.reviewStatuses}
          onToggleReviewStatus={(status) =>
            setFilter((current) => ({ ...current, reviewStatuses: toggle(current.reviewStatuses, status) }))
          }
          facets={treeFilter?.facets ?? []}
          tags={filter.tags}
          onToggleTag={(code) => setFilter((current) => ({ ...current, tags: toggle(current.tags, code) }))}
          onClearFilters={() => setFilter(EMPTY_FILTER)}
          onCompareDates={() => setView('policy-compare')}
        />
      </ToolbarPortal>

      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
        <CalendarClock className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
        <h1 className="shrink-0 font-semibold text-neutral-900 dark:text-neutral-100">Vigência</h1>
        <span className="text-sm text-neutral-500 dark:text-neutral-400">
          {activeProject.name} em {formatDateInputBR(date)}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <Tabs value={mode} onValueChange={(value) => setMode(value as ViewMode)}>
            <TabsList>
              <TabsTrigger value="structure">Estrutura</TabsTrigger>
              <TabsTrigger value="matrices">Matrizes</TabsTrigger>
              <TabsTrigger value="portfolio">Portfólio</TabsTrigger>
            </TabsList>
          </Tabs>
          <ExportMenu
            label="Exportar esta visão"
            items={[{ key: 'json', label: 'Exportar JSON', onSelect: exportView }]}
          />
        </div>
      </div>

      {mode === 'structure' ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(18rem,26rem)_1fr]">
          <div
            data-testid="policy-at-tree"
            className="min-h-0 overflow-y-auto border-b border-neutral-200 p-2 lg:border-b-0 lg:border-r dark:border-neutral-800"
          >
            <PolicyStructureTree
              rows={rows}
              date={date}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
            />
          </div>
          <div className="min-h-0 overflow-hidden">
            <PolicyStructureDetail
              document={document}
              row={selectedRow}
              date={date}
              onOpenEditor={openInEditor}
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {mode === 'matrices' ? (
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
      )}
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
