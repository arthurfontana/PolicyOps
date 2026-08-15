import { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  EyeOff,
  FilePlus,
  FilePlus2,
  GitMerge,
  Grid3x3,
  History as HistoryIcon,
  Library,
  ListTree,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Paperclip,
  ShieldCheck,
  Shuffle,
  SquarePen,
  StickyNote,
  Tag,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import type { DocEvent, DocEventType, Matrix, MatrixVersion, PolicyOpsDocument } from '@/core/document/schema';
import { getErrorMessage } from '@/core/error-messages';
import { axisStructureLabel, getPrecedingVersion, getPublishedVersion, getVersionEvents } from '@/core/queries';
import { createDraft } from '@/core/versioning/lifecycle';
import { formatDateBR, formatDateTimeBR, formatRelativeTime } from '@/lib/format';
import { versionBadge } from '@/lib/matrix-badges';
import { useDocumentStore } from '@/store/document-store';
import { AddNoteDialog } from '@/components/dialogs/AddNoteDialog';

export interface VersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: PolicyOpsDocument;
  matrix: Matrix;
  onOpenVersion: (versionId: string) => void;
  onCompare: (versionAId: string, versionBId: string) => void;
}

const EVENT_ICONS: Record<DocEventType, LucideIcon> = {
  DOCUMENT_CREATED: FilePlus,
  DOCUMENT_MERGED: GitMerge,
  MATRIX_CREATED: Grid3x3,
  DRAFT_CREATED: FilePlus2,
  DRAFT_DISCARDED: Trash2,
  CELLS_UPDATED: SquarePen,
  AXIS_LEVEL_ADDED: Plus,
  AXIS_LEVEL_REMOVED: Minus,
  AXIS_LEVEL_REORDERED: ArrowUpDown,
  AXIS_RESNAPSHOTTED: RefreshCw,
  TUPLES_SUPPRESSED: EyeOff,
  VERSION_PUBLISHED: CheckCircle2,
  VERSION_SUPERSEDED: HistoryIcon,
  NOTE_ADDED: StickyNote,
  VARIABLE_PUBLISHED: ListTree,
  COMPATIBILITY_PUBLISHED: Shuffle,
  CATALOG_CHANGED: Library,
  IMPORT_RUN: Upload,
  IMPORT_PROFILE_SAVED: Save,
  MATRIX_TAGGED: Tag,
  ACL_CHANGED: ShieldCheck,
  EVIDENCE_ATTACHED: Paperclip,
  // O desanexo manda o arquivo para a lixeira do acervo — mesmo ícone do
  // descarte, que é o que a ação parece para quem lê o histórico.
  EVIDENCE_DETACHED: Trash2,
  // Componentes de política (schema 5): o histórico deles tem tela própria no
  // épico Governança (S33a+); aqui só o ícone, para o mapa continuar total.
  COMPONENT_CREATED: FilePlus,
  COMPONENT_UPDATED: SquarePen,
  COMPONENT_MOVED: GitMerge,
  COMPONENT_ARCHIVED: Trash2,
  COMPONENT_DRAFT_CREATED: FilePlus2,
  COMPONENT_DRAFT_DISCARDED: Trash2,
  COMPONENT_VERSION_PUBLISHED: CheckCircle2,
  COMPONENT_VERSION_SUPERSEDED: HistoryIcon,
  // Governança (schema 5, S32b): a trilha do DB vive dentro do próprio DB e
  // ganha tela na S35 — aqui só o ícone, para o mapa continuar total.
  CR_CREATED: FilePlus,
  CR_UPDATED: SquarePen,
  CR_ITEM_CHANGED: ListTree,
  CR_TRANSITIONED: ArrowUpDown,
  CR_DECIDED: ShieldCheck,
  RELEASE_CREATED: FilePlus,
  RELEASE_UPDATED: SquarePen,
  RELEASE_CANCELLED: Trash2,
};

const ALL_FILTER = 'TODOS';

function effectiveWindowLabel(version: MatrixVersion, now: Date): string {
  if (version.state === 'DRAFT') return 'ainda não publicada';
  if (version.state === 'ARCHIVED') {
    return version.archivedAt === undefined ? 'descartada' : `descartada em ${formatDateBR(version.archivedAt)}`;
  }
  const from = version.effectiveFrom === undefined ? null : new Date(version.effectiveFrom);
  if (version.state === 'SUPERSEDED') {
    const to = version.effectiveTo === undefined ? '?' : formatDateBR(version.effectiveTo);
    return `vigente de ${from === null ? '?' : formatDateBR(version.effectiveFrom!)} até ${to}`;
  }
  // PUBLISHED: vigente ou agendada.
  if (from !== null && from.getTime() > now.getTime()) {
    return `agendada a partir de ${formatDateBR(version.effectiveFrom!)}`;
  }
  return `vigente desde ${from === null ? '?' : formatDateBR(version.effectiveFrom!)}`;
}

function EventRow({ event }: { event: DocEvent }) {
  const Icon = EVENT_ICONS[event.type];
  const [payloadOpen, setPayloadOpen] = useState(false);

  return (
    <li className="flex flex-col gap-1 border-b border-neutral-100 py-2 last:border-b-0 dark:border-neutral-800">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-neutral-700 dark:text-neutral-300">{event.summary}</p>
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
            {event.actor} ·{' '}
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{formatRelativeTime(event.at)}</span>
              </TooltipTrigger>
              <TooltipContent>{formatDateTimeBR(event.at)}</TooltipContent>
            </Tooltip>
          </p>
        </div>
        {event.payload !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-[11px]"
            onClick={() => setPayloadOpen((current) => !current)}
          >
            {payloadOpen ? 'ocultar dados' : 'ver dados'}
          </Button>
        )}
      </div>
      {payloadOpen && event.payload !== undefined && (
        <pre className="ml-5 overflow-x-auto rounded-md bg-neutral-50 p-2 text-[10px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </li>
  );
}

function VersionRow({
  doc,
  matrix,
  version,
  expanded,
  onToggle,
  filterType,
  filterAuthor,
  onOpenVersion,
  onCompare,
  onAnnotate,
}: {
  doc: PolicyOpsDocument;
  matrix: Matrix;
  version: MatrixVersion;
  expanded: boolean;
  onToggle: () => void;
  filterType: string;
  filterAuthor: string;
  onOpenVersion: (versionId: string) => void;
  onCompare: (versionAId: string, versionBId: string) => void;
  onAnnotate: (version: MatrixVersion) => void;
}) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const now = useMemo(() => new Date(), []);

  const events = useMemo(() => {
    const all = getVersionEvents(doc, version.id);
    return all.filter(
      (event) =>
        (filterType === ALL_FILTER || event.type === filterType) &&
        (filterAuthor === ALL_FILTER || event.actor === filterAuthor),
    );
  }, [doc, version.id, filterType, filterAuthor]);

  const badge = versionBadge(version, now);
  const published = getPublishedVersion(matrix);
  const compareTarget =
    published !== null && published.id !== version.id
      ? published
      : getPrecedingVersion(matrix, version);
  const canRestore = version.state === 'SUPERSEDED' || version.state === 'ARCHIVED';

  function handleRestore() {
    const result = dispatch(createDraft({ matrixId: matrix.id, baseVersionId: version.id }));
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível restaurar',
        description: result.error.message || getErrorMessage(result.error.code),
      });
      return;
    }
    onOpenVersion((result.data as { versionId: string }).versionId);
  }

  return (
    <li className="rounded-md border border-neutral-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-2 p-2.5 text-left"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Versão {version.number}
            </span>
            <Badge variant={badge.variant} className={badge.strike ? 'line-through' : undefined}>
              {badge.label}
            </Badge>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {effectiveWindowLabel(version, now)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {axisStructureLabel(version.axes.x)} × {axisStructureLabel(version.axes.y)}
          </p>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            criada por {version.createdBy} em {formatDateTimeBR(version.createdAt)}
            {version.publishedAt !== undefined &&
              ` · publicada por ${version.publishedBy} em ${formatDateTimeBR(version.publishedAt)}`}
            {' · '}
            {getVersionEvents(doc, version.id).length} evento(s)
          </p>
          {version.notes !== undefined && (
            <p className="mt-0.5 text-xs italic text-neutral-500 dark:text-neutral-400">"{version.notes}"</p>
          )}
        </div>
      </button>

      <div className="flex flex-wrap gap-3 border-t border-neutral-100 px-2.5 py-1.5 text-xs dark:border-neutral-800">
        <button
          type="button"
          className="text-neutral-600 hover:underline dark:text-neutral-300"
          onClick={() => onOpenVersion(version.id)}
        >
          Abrir
        </button>
        <button
          type="button"
          disabled={compareTarget === null}
          className="text-neutral-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline dark:text-neutral-300"
          onClick={() => compareTarget !== null && onCompare(compareTarget.id, version.id)}
        >
          Comparar com a vigente
        </button>
        {canRestore && (
          <button
            type="button"
            className="text-neutral-600 hover:underline dark:text-neutral-300"
            onClick={handleRestore}
          >
            Restaurar como rascunho
          </button>
        )}
        <button
          type="button"
          className="ml-auto flex items-center gap-1 text-neutral-600 hover:underline dark:text-neutral-300"
          onClick={() => onAnnotate(version)}
        >
          <StickyNote className="h-3 w-3" /> Adicionar nota
        </button>
      </div>

      {expanded && (
        <div className="border-t border-neutral-100 px-2.5 py-1.5 dark:border-neutral-800">
          {events.length === 0 ? (
            <p className="py-2 text-xs text-neutral-400 dark:text-neutral-500">
              Nenhum evento corresponde aos filtros.
            </p>
          ) : (
            <ul>
              {events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Histórico da matriz — docs/prompts/S13-ciclo-de-vida.md item 4. Timeline
 * vertical de todas as versões, mais recente primeiro, cada uma expansível
 * para a trilha de auditoria com filtro por tipo de evento e por autor.
 */
export function VersionHistoryDialog({
  open,
  onOpenChange,
  doc,
  matrix,
  onOpenVersion,
  onCompare,
}: VersionHistoryDialogProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>(ALL_FILTER);
  const [filterAuthor, setFilterAuthor] = useState<string>(ALL_FILTER);
  const [annotating, setAnnotating] = useState<MatrixVersion | null>(null);

  const versions = useMemo(
    () => [...matrix.versions].sort((a, b) => b.number - a.number),
    [matrix.versions],
  );

  const matrixEvents = useMemo(
    () => doc.events.filter((event) => event.scope.matrixId === matrix.id),
    [doc.events, matrix.id],
  );
  const eventTypes = useMemo(
    () => [...new Set(matrixEvents.map((event) => event.type))].sort(),
    [matrixEvents],
  );
  const authors = useMemo(
    () => [...new Set(matrixEvents.map((event) => event.actor))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [matrixEvents],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HistoryIcon className="h-4 w-4" aria-hidden />
              Histórico de "{matrix.name}"
            </DialogTitle>
            <DialogDescription>
              {versions.length} versão(ões) · {matrixEvents.length} evento(s) no total.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-52" aria-label="Filtrar por tipo de evento">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER}>Todos os tipos de evento</SelectItem>
                {eventTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterAuthor} onValueChange={setFilterAuthor}>
              <SelectTrigger className="w-52" aria-label="Filtrar por autor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER}>Todos os autores</SelectItem>
                {authors.map((author) => (
                  <SelectItem key={author} value={author}>
                    {author}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {versions.map((version) => (
              <VersionRow
                key={version.id}
                doc={doc}
                matrix={matrix}
                version={version}
                expanded={expandedId === version.id}
                onToggle={() => setExpandedId((current) => (current === version.id ? null : version.id))}
                filterType={filterType}
                filterAuthor={filterAuthor}
                onOpenVersion={(versionId) => {
                  onOpenChange(false);
                  onOpenVersion(versionId);
                }}
                onCompare={(aId, bId) => {
                  onOpenChange(false);
                  onCompare(aId, bId);
                }}
                onAnnotate={setAnnotating}
              />
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      {annotating !== null && (
        <AddNoteDialog
          open
          onOpenChange={(next) => {
            if (!next) setAnnotating(null);
          }}
          version={annotating}
        />
      )}
    </>
  );
}
