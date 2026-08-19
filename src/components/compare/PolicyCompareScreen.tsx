import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, GitCompare, Grid3x3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { orderForCompare } from '@/core/diff';
import {
  ROOT_SECTION_LABEL,
  diffPolicySnapshots,
  type PolicyNodeChange,
  type PolicySectionGroup,
} from '@/core/diff/policy-diff';
import {
  getPolicyAt,
  getPolicyPeriodCounters,
  getReleaseSnapshotWindow,
} from '@/core/timeline/policy-at';
import { listProjects } from '@/core/queries';
import { COMPONENT_TYPE_ICONS, COMPONENT_TYPE_LABELS } from '@/lib/component-labels';
import { formatDateBR } from '@/lib/format';
import { DATE_SHORTCUTS, endOfDayInstant, formatDateInputBR, toDateInputValue } from '@/lib/timeline-dates';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

/**
 * Comparação da política inteira — docs/07-ux-e-editor.md §20, US-GOV-08.
 *
 * Dois modos, o mesmo motor: em **data × data** os dois seletores são datas;
 * em **release × release** eles são releases, e cada uma vira data pela sua
 * janela de vigência (`getReleaseSnapshotWindow`) — a base entra pelo instante
 * *antes* dela, a comparada pelo instante *depois*. Escolher a mesma release
 * dos dois lados responde "o que esta release mudou", que é a pergunta mais
 * frequente; escolher duas responde "o que mudou entre uma e outra".
 *
 * Nenhuma regra mora aqui: a tela lê `diffPolicySnapshots` e desenha.
 */

type Mode = 'dates' | 'releases';

export function PolicyCompareScreen() {
  const document = useDocumentStore((s) => s.document);
  const editorSelectedProjectId = useEditorStore((s) => s.selectedProjectId);
  const openMatrix = useEditorStore((s) => s.openMatrix);
  const setCompareVersions = useEditorStore((s) => s.setCompareVersions);
  const setSelectedComponent = useEditorStore((s) => s.setSelectedComponent);
  const setSelectedProject = useEditorStore((s) => s.setSelectedProject);
  const setView = useUiStore((s) => s.setView);
  const openPolicyAt = useUiStore((s) => s.openPolicyAt);
  const policyAtDate = useUiStore((s) => s.policyAtDate);

  const projects = useMemo(() => (document === null ? [] : listProjects(document)), [document]);
  const [projectId, setProjectId] = useState<string | null>(editorSelectedProjectId);
  const [mode, setMode] = useState<Mode>('dates');
  const [dateA, setDateA] = useState(() => toDateInputValue(startOfYear()));
  // "Comparar com outra data" (§10) chega da tela de Vigência: a data que se
  // estava olhando já entra de um lado, e só a outra ponta fica a escolher.
  const [dateB, setDateB] = useState(() => policyAtDate ?? toDateInputValue(new Date()));
  const [releaseA, setReleaseA] = useState<string | null>(null);
  const [releaseB, setReleaseB] = useState<string | null>(null);

  const publishedReleases = useMemo(
    () =>
      document === null
        ? []
        : document.releases
            .filter((release) => getReleaseSnapshotWindow(document, release.id) !== null)
            .sort((a, b) => b.code.localeCompare(a.code)),
    [document],
  );

  useEffect(() => {
    if (projectId !== null && projects.some((entry) => entry.project.id === projectId)) return;
    setProjectId(projects[0]?.project.id ?? null);
  }, [projectId, projects]);

  useEffect(() => {
    if (releaseA !== null || publishedReleases.length === 0) return;
    const latest = publishedReleases[0]!.id;
    setReleaseA(latest);
    setReleaseB(latest);
  }, [releaseA, publishedReleases]);

  const result = useMemo(() => {
    if (document === null || projectId === null) return null;
    if (mode === 'dates') {
      // A base é sempre a mais antiga, venha na ordem que vier (docs/07 §9).
      const inOrder = dateA <= dateB ? [dateA, dateB] : [dateB, dateA];
      return {
        a: endOfDayInstant(inOrder[0]!),
        b: endOfDayInstant(inOrder[1]!),
        labelA: formatDateInputBR(inOrder[0]!),
        labelB: formatDateInputBR(inOrder[1]!),
      };
    }
    if (releaseA === null || releaseB === null) return null;
    const windowA = getReleaseSnapshotWindow(document, releaseA);
    const windowB = getReleaseSnapshotWindow(document, releaseB);
    if (windowA === null || windowB === null) return null;
    const releaseCodeA = windowA.release.code;
    const releaseCodeB = windowB.release.code;
    return {
      a: windowA.before,
      b: windowB.after,
      labelA: `antes da release ${releaseCodeA}`,
      labelB: `depois da release ${releaseCodeB}`,
    };
  }, [document, projectId, mode, dateA, dateB, releaseA, releaseB]);

  const diff = useMemo(() => {
    if (document === null || projectId === null || result === null) return null;
    return diffPolicySnapshots(
      document,
      getPolicyAt(document, projectId, result.a),
      getPolicyAt(document, projectId, result.b),
    );
  }, [document, projectId, result]);

  const counters = useMemo(() => {
    if (document === null || projectId === null || result === null) return null;
    return getPolicyPeriodCounters(document, projectId, result.a, result.b);
  }, [document, projectId, result]);

  if (document === null) {
    return <EmptyState message="Nenhum documento aberto." />;
  }
  if (projects.length === 0 || projectId === null) {
    return <EmptyState message="Este documento ainda não tem projetos." />;
  }

  function openMatrixCompare(change: PolicyNodeChange): void {
    if (change.beforeMatrixVersion === null || change.afterMatrixVersion === null) return;
    const ordered = orderForCompare(document!, change.beforeMatrixVersion.id, change.afterMatrixVersion.id);
    setCompareVersions(ordered.aId, ordered.bId);
    setView('compare');
  }

  function openComponent(change: PolicyNodeChange): void {
    if (change.component === null) {
      if (change.matrix !== null) {
        openMatrix(change.matrix.id, change.afterMatrixVersion?.id ?? change.beforeMatrixVersion?.id ?? null);
        setView('matrix');
      }
      return;
    }
    setSelectedProject(change.component.projectId);
    setSelectedComponent(change.component.id);
    setView('projects');
  }

  /** §20.3: o atalho abre a **tela de Vigência** na data — não congela a árvore (DEC-UX-004). */
  function seePolicyAt(instant: Date): void {
    setSelectedProject(projectId!);
    openPolicyAt(toDateInputValue(instant));
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
        <GitCompare className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
        <h1 className="shrink-0 font-semibold text-neutral-900 dark:text-neutral-100">Comparar a política</h1>

        <Select value={projectId} onValueChange={setProjectId}>
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

        <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
          <TabsList>
            <TabsTrigger value="dates">Data × data</TabsTrigger>
            <TabsTrigger value="releases">Release × release</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
        {mode === 'dates' ? (
          <>
            <Input
              type="date"
              aria-label="Data base"
              value={dateA}
              onChange={(event) => setDateA(event.target.value)}
              className="w-40"
            />
            <span className="text-sm text-neutral-400">×</span>
            <Input
              type="date"
              aria-label="Data comparada"
              value={dateB}
              onChange={(event) => setDateB(event.target.value)}
              className="w-40"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {DATE_SHORTCUTS.map((shortcut) => (
                <Button
                  key={shortcut.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDateA(toDateInputValue(shortcut.resolve()))}
                >
                  {shortcut.label}
                </Button>
              ))}
            </div>
          </>
        ) : publishedReleases.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Nenhuma release publicada ainda — publique uma release para comparar por release.
          </p>
        ) : (
          <>
            <Select value={releaseA ?? ''} onValueChange={setReleaseA}>
              <SelectTrigger className="w-52" aria-label="Release base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {publishedReleases.map((release) => (
                  <SelectItem key={release.id} value={release.id}>
                    {release.code}
                    {release.name === undefined ? '' : ` — ${release.name}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-neutral-400">×</span>
            <Select value={releaseB ?? ''} onValueChange={setReleaseB}>
              <SelectTrigger className="w-52" aria-label="Release comparada">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {publishedReleases.map((release) => (
                  <SelectItem key={release.id} value={release.id}>
                    {release.code}
                    {release.name === undefined ? '' : ` — ${release.name}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              A mesma release dos dois lados mostra o que ela mudou.
            </span>
          </>
        )}
      </div>

      {result === null || diff === null ? (
        <EmptyState message="Escolha as duas pontas da comparação." />
      ) : (
        <div className="flex flex-col gap-4 p-4">
          <Card className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <span className="text-neutral-500 dark:text-neutral-400">
              {result.labelA} <span className="px-1 text-neutral-400">×</span> {result.labelB}
            </span>
            <Badge variant="green">{diff.totals.added} adicionados</Badge>
            <Badge variant="blue">{diff.totals.changed} alterados</Badge>
            <Badge variant="amber">{diff.totals.removed} removidos</Badge>
            {counters !== null && (
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {counters.effectiveComponents} componentes e {counters.effectiveMatrices} matrizes vigentes no fim
                do período · {counters.publishedChangeRequests} DB(s) publicado(s) no período ·{' '}
                {counters.inFlightChangeRequests} em andamento
              </span>
            )}
            <div className="ml-auto flex gap-1.5">
              <Button type="button" variant="outline" size="sm" onClick={() => seePolicyAt(result.a)}>
                <CalendarClock className="mr-1.5 h-3.5 w-3.5" /> Ver a política em {formatDateBR(result.a.toISOString())}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => seePolicyAt(result.b)}>
                <CalendarClock className="mr-1.5 h-3.5 w-3.5" /> Ver em {formatDateBR(result.b.toISOString())}
              </Button>
            </div>
          </Card>

          {!diff.hasChanges ? (
            <p className="p-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Nada mudou na política entre as duas pontas.
            </p>
          ) : (
            diff.groups.map((group) => (
              <SectionGroup
                key={group.section?.id ?? '__root__'}
                group={group}
                onOpenComponent={openComponent}
                onOpenMatrixCompare={openMatrixCompare}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function startOfYear(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1);
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{message}</p>
    </div>
  );
}

const KIND_LABEL: Record<PolicyNodeChange['kind'], { label: string; variant: 'green' | 'blue' | 'amber' }> = {
  ADDED: { label: 'adicionado', variant: 'green' },
  CHANGED: { label: 'alterado', variant: 'blue' },
  REMOVED: { label: 'removido', variant: 'amber' },
};

function SectionGroup({
  group,
  onOpenComponent,
  onOpenMatrixCompare,
}: {
  group: PolicySectionGroup;
  onOpenComponent: (change: PolicyNodeChange) => void;
  onOpenMatrixCompare: (change: PolicyNodeChange) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {group.section?.name ?? ROOT_SECTION_LABEL}
        </h2>
        <span className="text-xs text-neutral-400">
          {group.totals.total} {group.totals.total === 1 ? 'mudança' : 'mudanças'}
        </span>
      </div>
      {group.changes.map((change) => (
        <ChangeCard
          key={change.key}
          change={change}
          onOpenComponent={onOpenComponent}
          onOpenMatrixCompare={onOpenMatrixCompare}
        />
      ))}
    </section>
  );
}

function ChangeCard({
  change,
  onOpenComponent,
  onOpenMatrixCompare,
}: {
  change: PolicyNodeChange;
  onOpenComponent: (change: PolicyNodeChange) => void;
  onOpenMatrixCompare: (change: PolicyNodeChange) => void;
}) {
  const kind = KIND_LABEL[change.kind];
  const Icon = change.component === null ? Grid3x3 : COMPONENT_TYPE_ICONS[change.component.type];
  const name = change.component?.name ?? change.matrix?.name ?? '—';
  const code = change.component?.code ?? change.matrix?.code ?? '';
  const fields = change.payload?.changes.filter((field) => field.kind !== 'UNCHANGED') ?? [];

  return (
    <Card className="flex flex-col gap-2 p-3" data-testid={`policy-change-${code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
        <button
          type="button"
          onClick={() => onOpenComponent(change)}
          className="font-medium text-neutral-900 underline-offset-2 hover:underline dark:text-neutral-100"
        >
          {name}
        </button>
        <span className="font-mono text-xs text-neutral-400">{code}</span>
        <Badge variant={kind.variant}>{kind.label}</Badge>
        {change.component !== null && (
          <Badge variant="outline">{COMPONENT_TYPE_LABELS[change.component.type]}</Badge>
        )}
        <VersionTrail change={change} />
      </div>

      {fields.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {fields.map((field) => (
            <li key={field.field} className="flex flex-wrap gap-1.5">
              <span className="font-mono text-neutral-500 dark:text-neutral-400">{field.field}</span>
              <span className="text-neutral-400 line-through">{field.before ?? '—'}</span>
              <span className="text-neutral-400">→</span>
              <span className="text-neutral-800 dark:text-neutral-200">{field.after ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}

      {change.spec !== null && change.spec.hasChanges && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Especificação: {change.spec.totals.ADDED} bloco(s) novo(s), {change.spec.totals.CHANGED} alterado(s),{' '}
          {change.spec.totals.REMOVED} removido(s), {change.spec.totals.MOVED} movido(s).
        </p>
      )}

      {change.matrixDiff !== null && (
        <div className="flex flex-col gap-1">
          {change.matrixDiff.comparable ? (
            <ul className="flex flex-col gap-0.5 text-xs text-neutral-600 dark:text-neutral-300">
              {change.matrixDiff.summaryText.length === 0 ? (
                <li>{change.matrixDiff.cellsChanged} célula(s) alterada(s).</li>
              ) : (
                change.matrixDiff.summaryText.map((line) => <li key={line}>{line}</li>)
              )}
            </ul>
          ) : (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              As duas versões não são comparáveis célula a célula (a estrutura dos eixos mudou).
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit px-1 text-xs"
            onClick={() => onOpenMatrixCompare(change)}
          >
            <GitCompare className="mr-1.5 h-3.5 w-3.5" /> Abrir a comparação célula a célula
          </Button>
        </div>
      )}
    </Card>
  );
}

/** "v1 → v2", ou só a ponta que existe — a leitura rápida de qualquer mudança. */
function VersionTrail({ change }: { change: PolicyNodeChange }) {
  const before = change.before?.number ?? change.beforeMatrixVersion?.number ?? null;
  const after = change.after?.number ?? change.afterMatrixVersion?.number ?? null;
  return (
    <span className="text-xs text-neutral-500 dark:text-neutral-400">
      {before === null ? 'não existia' : `v${before}`} → {after === null ? 'não vigora mais' : `v${after}`}
    </span>
  );
}
