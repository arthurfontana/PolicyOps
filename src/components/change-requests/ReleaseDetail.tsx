import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Rocket, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/library/ConfirmDialog';
import { AddChangeRequestToReleaseDialog } from '@/components/change-requests/AddChangeRequestToReleaseDialog';
import { downloadFactoryPackageMarkdown, printFactoryPackage } from '@/components/change-requests/factory-package-actions';
import { PublishReleaseDialog } from '@/components/change-requests/PublishReleaseDialog';
import { ExportMenu } from '@/components/shell/ExportMenu';
import { setChangeRequestRelease } from '@/core/document/change-requests';
import { isFactoryPackageAvailable } from '@/core/export';
import { cancelRelease, deriveReleaseJointStatus, listReleaseChangeRequests, updateRelease } from '@/core/document/releases';
import { CR_STATUS_LABELS, CR_STATUS_VARIANTS } from '@/lib/change-request-labels';
import { dateInputToIso, formatDateBR, formatDateTimeBR, isoToDateInputValue } from '@/lib/format';
import { RELEASE_JOINT_STATUS_LABELS, RELEASE_JOINT_STATUS_VARIANTS, RELEASE_STATUS_LABELS, RELEASE_STATUS_VARIANTS } from '@/lib/release-labels';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

export interface ReleaseDetailProps {
  releaseId: string;
}

/**
 * Tela da release (docs/07 §19.6, docs/14 §3.4): conteúdo ("o que entrou na
 * subida"), status por DB, data planejada × publicada. Publicar é
 * `PublishReleaseDialog`, que roda `changeRequest/publish` por DB, tudo numa
 * transação (RN-GOV-05, CT-GOV-03).
 */
export function ReleaseDetail({ releaseId }: ReleaseDetailProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const setSelectedRelease = useEditorStore((s) => s.setSelectedRelease);
  const setSelectedChangeRequest = useEditorStore((s) => s.setSelectedChangeRequest);
  const setView = useUiStore((s) => s.setView);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const release = document?.releases.find((candidate) => candidate.id === releaseId) ?? null;

  useEffect(() => {
    if (release === null) return;
    setName(release.name ?? '');
    setPlannedDate(release.plannedDate === undefined ? '' : isoToDateInputValue(release.plannedDate));
    setNotes(release.notes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mesmo raciocínio de ChangeRequestDetail
  }, [release?.id, release?.name, release?.plannedDate, release?.notes]);

  if (document === null || release === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Esta release não existe mais.</p>
        <Button onClick={() => setSelectedRelease(null)}>Voltar à lista</Button>
      </div>
    );
  }

  const open = release.status === 'PLANNED' || release.status === 'IN_DEVELOPMENT';
  const crs = listReleaseChangeRequests(document, release.id);
  const jointStatus = deriveReleaseJointStatus(document, release.id, { at: new Date() });
  const canPublish = open && jointStatus === 'READY';

  function commitName() {
    const trimmed = name.trim();
    if (trimmed === (release!.name ?? '')) return;
    const result = dispatch(updateRelease({ releaseId, name: trimmed === '' ? null : trimmed }));
    if (!result.ok) {
      setName(release!.name ?? '');
      toast({ title: 'Não foi possível renomear', description: result.error.message });
    }
  }

  function commitPlannedDate(value: string) {
    setPlannedDate(value);
    const result = dispatch(updateRelease({ releaseId, plannedDate: value === '' ? null : dateInputToIso(value) }));
    if (!result.ok) toast({ title: 'Não foi possível salvar a data planejada', description: result.error.message });
  }

  function commitNotes() {
    const trimmed = notes.trim();
    if (trimmed === (release!.notes ?? '')) return;
    const result = dispatch(updateRelease({ releaseId, notes: trimmed === '' ? null : trimmed }));
    if (!result.ok) {
      setNotes(release!.notes ?? '');
      toast({ title: 'Não foi possível salvar a observação', description: result.error.message });
    }
  }

  function handleRemove(changeRequestId: string) {
    const result = dispatch(setChangeRequestRelease({ changeRequestId, releaseId: null }));
    if (!result.ok) toast({ title: 'Não foi possível tirar o DB da release', description: result.error.message });
  }

  function handleCancel() {
    const result = dispatch(cancelRelease({ releaseId }));
    if (!result.ok) toast({ title: 'Não foi possível cancelar a release', description: result.error.message });
    setCancelOpen(false);
  }

  /** DBs elegíveis a pacote (≥ APPROVED, RN-GOV-08) — os demais ficam de fora, sem erro. */
  const packageableCrs = crs.filter((cr) => isFactoryPackageAvailable(cr.status));

  function handlePrintAllPackages() {
    for (const cr of packageableCrs) printFactoryPackage(document!, cr.id);
  }

  function handleDownloadAllPackagesMarkdown() {
    for (const cr of packageableCrs) downloadFactoryPackageMarkdown(document!, cr.id);
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-start gap-2">
        <Button type="button" variant="ghost" size="icon" aria-label="Voltar à lista" onClick={() => setSelectedRelease(null)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 font-mono text-sm text-neutral-400">{release.code}</span>
            <Badge variant={RELEASE_STATUS_VARIANTS[release.status]}>{RELEASE_STATUS_LABELS[release.status]}</Badge>
            <Badge variant={RELEASE_JOINT_STATUS_VARIANTS[jointStatus]}>{RELEASE_JOINT_STATUS_LABELS[jointStatus]}</Badge>
          </div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            disabled={!open}
            placeholder="Nome da release (opcional)"
            className="mt-1 h-auto border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
            aria-label="Nome da release"
          />
        </div>
        {open && (
          <Button type="button" onClick={() => setPublishOpen(true)} disabled={!canPublish}>
            <Rocket className="mr-1.5 h-4 w-4" /> Publicar release
          </Button>
        )}
      </div>

      {open && !canPublish && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {jointStatus === 'EMPTY'
            ? 'Adicione ao menos um DB aprovado para publicar.'
            : 'Ainda há pendência em algum DB — abra "Publicar release" para ver a lista.'}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="release-planned-date" className="text-xs">
            Data planejada
          </Label>
          <Input
            id="release-planned-date"
            type="date"
            value={plannedDate}
            disabled={!open}
            onChange={(e) => commitPlannedDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Data publicada</Label>
          <p className="flex h-9 items-center text-sm text-neutral-700 dark:text-neutral-300">
            {release.publishedAt === undefined ? '— ainda não publicada' : formatDateTimeBR(release.publishedAt)}
            {release.publishedBy !== undefined ? ` · ${release.publishedBy}` : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="release-notes" className="text-xs">
          Observações
        </Label>
        <Textarea
          id="release-notes"
          value={notes}
          disabled={!open}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
          className="min-h-[64px] text-sm"
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            O que entra na subida ({crs.length})
          </p>
          <div className="flex items-center gap-2">
            {packageableCrs.length > 0 && (
              <ExportMenu
                label="Gerar pacotes"
                items={[
                  { key: 'print', label: `Imprimir todos (${packageableCrs.length} HTML)`, onSelect: handlePrintAllPackages },
                  {
                    key: 'markdown',
                    label: `Baixar todos (${packageableCrs.length} Markdown)`,
                    onSelect: handleDownloadAllPackagesMarkdown,
                  },
                ]}
              />
            )}
            {open && (
              <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar DB
              </Button>
            )}
          </div>
        </div>

        {crs.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-200 p-4 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            Nenhum DB vinculado ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {crs.map((cr) => (
              <li
                key={cr.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedChangeRequest(cr.id);
                    setView('change-requests');
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">{cr.title}</span>
                    <span className="shrink-0 font-mono text-xs text-neutral-400">{cr.code}</span>
                  </div>
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {cr.proposedEffectiveDate === undefined ? 'sem vigência' : `vigência ${formatDateBR(cr.proposedEffectiveDate)}`}
                    {` · ${cr.items.length} item(ns)`}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={CR_STATUS_VARIANTS[cr.status]}>{CR_STATUS_LABELS[cr.status]}</Badge>
                  {open && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Tirar ${cr.code} da release`}
                      onClick={() => handleRemove(cr.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {open && (
        <Button type="button" variant="ghost" className="self-start text-red-600 dark:text-red-400" onClick={() => setCancelOpen(true)}>
          Cancelar release
        </Button>
      )}

      <AddChangeRequestToReleaseDialog open={addOpen} onOpenChange={setAddOpen} releaseId={release.id} />
      <PublishReleaseDialog open={publishOpen} onOpenChange={setPublishOpen} release={release} />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancelar a release "${release.code}"?`}
        description="Os DBs vinculados continuam apontando esta release até alguém movê-los para outra."
        confirmLabel="Cancelar release"
        destructive
        onConfirm={handleCancel}
      />
    </div>
  );
}
