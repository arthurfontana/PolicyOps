import { useMemo, useState } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { ChangeRequestItemDiff } from '@/components/change-requests/ChangeRequestItemDiff';
import {
  planChangeRequestPublish,
  preflightChangeRequestPublish,
  publishChangeRequest,
  type PublishPlanEntry,
} from '@/core/document/cr-publish';
import type { ChangeRequest } from '@/core/document/schema';
import { formatDateBR } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';

/**
 * Publicar o DB (docs/07-ux-e-editor.md §19.5, RN-GOV-05). O diálogo é o
 * espelho fiel do `preflight` do núcleo (`src/core/document/cr-publish.ts`):
 *
 * - **plano**: uma linha por item, dizendo o que acontece com ele;
 * - **pendências** (`E-GOV-04`): a lista completa, e o botão travado;
 * - **base desatualizada** (`E-GOV-02`): uma caixa por componente, cada uma
 *   exigindo que a pessoa **veja o comparativo contra a nova vigente** antes de
 *   reconfirmar. Nunca silencioso, nunca em bloco: é uma decisão por item.
 *
 * A vigência não se edita aqui — ela é a do DB (`proposedEffectiveDate`), e
 * mudá-la é editar o DB. Uma fonte só de verdade.
 */

const EFFECT_LABEL: Record<PublishPlanEntry['effect'], string> = {
  PUBLISH_VERSION: 'Publica a versão',
  ARCHIVE: 'Arquiva o componente',
  RESTORE: 'Desarquiva o componente',
  NONE: 'Sem efeito na publicação',
};

const EFFECT_VARIANT: Record<PublishPlanEntry['effect'], 'blue' | 'amber' | 'secondary'> = {
  PUBLISH_VERSION: 'blue',
  ARCHIVE: 'amber',
  RESTORE: 'amber',
  NONE: 'secondary',
};

export interface PublishChangeRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changeRequest: ChangeRequest;
}

export function PublishChangeRequestDialog({
  open,
  onOpenChange,
  changeRequest,
}: PublishChangeRequestDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const [rebased, setRebased] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const preflight = useMemo(
    () =>
      document === null
        ? null
        : preflightChangeRequestPublish(document, changeRequest.id, {
            at: new Date(),
            rebasedComponentIds: rebased,
          }),
    [document, changeRequest.id, rebased],
  );
  const plano = useMemo(
    () => (document === null ? [] : planChangeRequestPublish(document, changeRequest.id)),
    [document, changeRequest.id],
  );

  if (document === null || preflight === null) return null;

  const bloqueado = preflight.blockers.length > 0 || preflight.staleBases.length > 0;
  const publicaveis = plano.filter((entry) => entry.effect === 'PUBLISH_VERSION').length;

  function handlePublish() {
    const result = dispatch(
      publishChangeRequest({ changeRequestId: changeRequest.id, rebasedComponentIds: rebased }),
    );
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível publicar',
        description: result.error.message,
      });
      return;
    }
    toast({
      title: `"${changeRequest.code}" publicado`,
      description: `${result.data.published.length} versão(ões) em vigor a partir de ${formatDateBR(result.data.effectiveFrom)}.`,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Publicar &quot;{changeRequest.code}&quot;</DialogTitle>
          <DialogDescription>
            {preflight.effectiveFrom === null
              ? 'Este DB ainda não tem vigência proposta.'
              : `Tudo entra em vigor em ${formatDateBR(preflight.effectiveFrom)}, numa operação só: se um item falhar, nada é publicado (RN-GOV-05).`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">O que vai acontecer ({plano.length} item(ns))</Label>
            <ul className="flex flex-col gap-1">
              {plano.map((entry) => (
                <li
                  key={entry.componentId}
                  className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 p-2 text-sm dark:border-neutral-800"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">
                      {entry.componentName}
                    </span>{' '}
                    <span className="font-mono text-xs text-neutral-400">{entry.componentCode}</span>
                  </span>
                  <Badge variant={EFFECT_VARIANT[entry.effect]}>
                    {EFFECT_LABEL[entry.effect]}
                    {entry.versionNumber === null ? '' : ` ${entry.versionNumber}`}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>

          {preflight.blockers.length > 0 && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>
                {preflight.blockers.length} pendência(s) impedem a publicação (E-GOV-04)
              </AlertTitle>
              <AlertDescription>
                {/* `AlertDescription` já é um `<p>`: a lista aqui é de blocos,
                    não de `<li>`, para não aninhar `<ul>` dentro de parágrafo. */}
                {preflight.blockers.map((blocker, index) => (
                  <span key={`${blocker.kind}-${blocker.componentId ?? index}`} className="block">
                    • {blocker.message}
                  </span>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {preflight.staleBases.length > 0 && (
            <Alert>
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>Base desatualizada (E-GOV-02)</AlertTitle>
              <AlertDescription>
                A versão vigente mudou depois que o item foi escrito — outro DB publicou antes.
                Reveja o comparativo contra a nova vigente e reconfirme item a item.
              </AlertDescription>
            </Alert>
          )}

          {preflight.staleBases.map((blocker) => {
            const componentId = blocker.componentId;
            if (componentId === undefined) return null;
            const component = document!.components.find((candidate) => candidate.id === componentId);
            const item = changeRequest.items.find(
              (candidate) => candidate.componentId === componentId,
            );
            if (component === undefined || item === undefined) return null;
            const aberto = reviewing === componentId;
            // O rebase compara contra a **nova** vigente, não contra a base
            // que o item declarou — é exatamente essa a pergunta que
            // `E-GOV-02` faz (`resolveBase` cai na publicada sem `baseVersionId`).
            // eslint-disable-next-line @typescript-eslint/no-unused-vars -- descartar `baseVersionId` é o ponto
            const { baseVersionId, ...contraAVigente } = item;

            return (
              <div
                key={componentId}
                className="flex flex-col gap-2 rounded-md border border-amber-300 p-3 dark:border-amber-800"
              >
                <p className="text-sm text-neutral-700 dark:text-neutral-300">{blocker.message}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setReviewing(aberto ? null : componentId)}
                  >
                    {aberto ? 'Ocultar o comparativo' : 'Rever contra a nova vigente'}
                  </Button>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`rebase-${componentId}`}
                      checked={rebased.includes(componentId)}
                      disabled={!aberto && !rebased.includes(componentId)}
                      onCheckedChange={(checked) =>
                        setRebased((current) =>
                          checked === true
                            ? [...current, componentId]
                            : current.filter((id) => id !== componentId),
                        )
                      }
                    />
                    <Label htmlFor={`rebase-${componentId}`} className="text-xs">
                      Revi o comparativo e confirmo publicar sobre a nova vigente
                    </Label>
                  </div>
                </div>
                {aberto && (
                  <ChangeRequestItemDiff
                    document={document}
                    component={component}
                    item={contraAVigente}
                  />
                )}
              </div>
            );
          })}

          {!bloqueado && (
            <Alert>
              <CircleCheck className="h-4 w-4" />
              <AlertDescription>
                Tudo pronto: {publicaveis} versão(ões) entram em vigor
                {preflight.effectiveFrom === null ? '' : ` em ${formatDateBR(preflight.effectiveFrom)}`}.
                Publicar não pode ser desfeito.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handlePublish} disabled={bloqueado}>
            Publicar o DB
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
