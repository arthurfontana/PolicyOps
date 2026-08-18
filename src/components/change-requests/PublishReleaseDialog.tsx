import { useMemo, useState } from 'react';
import { CircleCheck, ExternalLink, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { planChangeRequestPublish } from '@/core/document/cr-publish';
import { preflightReleasePublish, publishRelease } from '@/core/document/release-publish';
import { listReleaseChangeRequests } from '@/core/document/releases';
import type { Release } from '@/core/document/schema';
import { formatDateBR } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';
import { useEditorStore } from '@/store/editor-store';
import { useUiStore } from '@/store/ui-store';

export interface PublishReleaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  release: Release;
}

/**
 * Publicar a release (docs/07 §19.6, RN-GOV-05, CT-GOV-03) — o mesmo espelho
 * fiel de `PublishChangeRequestDialog`, uma camada acima: um DB por bloco, e
 * a reconfirmação de base desatualizada (E-GOV-02) por `{DB, componente}`, já
 * que dois DBs da mesma release podem ter itens defasados ao mesmo tempo.
 * Cada DB continua publicando com a **sua própria** vigência — não existe
 * data única de release (docs/14 §3.4).
 */
export function PublishReleaseDialog({ open, onOpenChange, release }: PublishReleaseDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const setSelectedChangeRequest = useEditorStore((s) => s.setSelectedChangeRequest);
  const setSelectedRelease = useEditorStore((s) => s.setSelectedRelease);
  const setView = useUiStore((s) => s.setView);
  const { toast } = useToast();
  const [rebased, setRebased] = useState<{ changeRequestId: string; componentId: string }[]>([]);

  const crs = useMemo(
    () => (document === null ? [] : listReleaseChangeRequests(document, release.id)),
    [document, release.id],
  );

  const preflight = useMemo(
    () =>
      document === null
        ? null
        : preflightReleasePublish(document, release.id, { at: new Date(), rebasedComponentIds: rebased }),
    [document, release.id, rebased],
  );

  if (document === null || preflight === null) return null;

  const bloqueado = preflight.blockers.length > 0 || preflight.staleBases.length > 0;

  function isRebased(changeRequestId: string, componentId: string): boolean {
    return rebased.some((entry) => entry.changeRequestId === changeRequestId && entry.componentId === componentId);
  }

  function toggleRebased(changeRequestId: string, componentId: string, checked: boolean) {
    setRebased((current) => {
      const withoutThis = current.filter(
        (entry) => !(entry.changeRequestId === changeRequestId && entry.componentId === componentId),
      );
      return checked ? [...withoutThis, { changeRequestId, componentId }] : withoutThis;
    });
  }

  function openChangeRequest(changeRequestId: string) {
    onOpenChange(false);
    setSelectedRelease(null);
    setSelectedChangeRequest(changeRequestId);
    setView('change-requests');
  }

  function handlePublish() {
    const result = dispatch(publishRelease({ releaseId: release.id, rebasedComponentIds: rebased }));
    if (!result.ok) {
      toast({ variant: 'destructive', title: 'Não foi possível publicar a release', description: result.error.message });
      return;
    }
    toast({
      title: `Release "${release.code}" publicada`,
      description: `${result.data.entries.length} DB(s), cada um com a sua vigência.`,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Publicar a release &quot;{release.code}&quot;</DialogTitle>
          <DialogDescription>
            {crs.length} DB(s), cada um em vigor na sua própria data — numa operação só: se um falhar, nada é
            publicado (RN-GOV-05).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {crs.map((cr) => {
            const plano = planChangeRequestPublish(document, cr.id);
            return (
              <div key={cr.id} className="flex flex-col gap-1.5 rounded-md border border-neutral-200 p-2.5 dark:border-neutral-800">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">{cr.title}</span>
                    <span className="shrink-0 font-mono text-xs text-neutral-400">{cr.code}</span>
                  </div>
                  <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                    {cr.proposedEffectiveDate === undefined ? 'sem vigência' : formatDateBR(cr.proposedEffectiveDate)}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {plano.filter((entry) => entry.effect === 'PUBLISH_VERSION').length} versão(ões) a publicar de{' '}
                  {plano.length} item(ns)
                </p>
              </div>
            );
          })}

          {preflight.blockers.length > 0 && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>{preflight.blockers.length} pendência(s) impedem a publicação (E-GOV-04)</AlertTitle>
              <AlertDescription>
                {preflight.blockers.map((blocker, index) => (
                  <span key={`${blocker.changeRequestId}-${blocker.kind}-${blocker.componentId ?? index}`} className="block">
                    • [{blocker.changeRequestCode}] {blocker.message}
                  </span>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {preflight.staleBases.length > 0 && (
            <Alert>
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>Base desatualizada em {preflight.staleBases.length} item(ns) (E-GOV-02)</AlertTitle>
              <AlertDescription>
                A versão vigente mudou depois que o item foi escrito. Abra o DB, reveja o comparativo contra a
                nova vigente e volte para reconfirmar.
              </AlertDescription>
            </Alert>
          )}

          {preflight.staleBases.map((blocker) => {
            const componentId = blocker.componentId;
            if (componentId === undefined) return null;
            const key = `${blocker.changeRequestId}-${componentId}`;
            return (
              <div key={key} className="flex flex-col gap-2 rounded-md border border-amber-300 p-3 dark:border-amber-800">
                <p className="text-sm text-neutral-700 dark:text-neutral-300">
                  [{blocker.changeRequestCode}] {blocker.message}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => openChangeRequest(blocker.changeRequestId)}
                  >
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir o DB e rever o comparativo
                  </Button>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`rebase-${key}`}
                      checked={isRebased(blocker.changeRequestId, componentId)}
                      onCheckedChange={(checked) => toggleRebased(blocker.changeRequestId, componentId, checked === true)}
                    />
                    <Label htmlFor={`rebase-${key}`} className="text-xs">
                      Revi o comparativo e confirmo publicar sobre a nova vigente
                    </Label>
                  </div>
                </div>
              </div>
            );
          })}

          {!bloqueado && (
            <Alert>
              <CircleCheck className="h-4 w-4" />
              <AlertDescription>
                Tudo pronto: {crs.length} DB(s) entram em vigor, cada um na sua data. Publicar não pode ser
                desfeito.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handlePublish} disabled={bloqueado}>
            Publicar a release ({crs.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
