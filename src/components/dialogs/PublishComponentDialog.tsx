import { useEffect, useMemo, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { getErrorMessage } from '@/core/error-messages';
import { publishComponentVersion } from '@/core/versioning/component-lifecycle';
import type { ComponentVersion, PolicyComponent } from '@/core/document/schema';
import { dateInputToIso, dateInputValue, isoToDateInputValue } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';
import { useRoleGate } from '@/hooks/useRole';

export interface PublishComponentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  component: PolicyComponent;
  version: ComponentVersion;
  /** `Project.foundationEffectiveFrom` (RN-GOV-09) — sugestão para a primeira versão. */
  foundationEffectiveFrom?: string;
  onPublished: () => void;
}

/**
 * Publicação de componente — docs/07 §17.5, mesmo padrão visual do diálogo de
 * matriz (`PublishVersionDialog`, docs/05 §1), adaptado ao contrato de
 * `ComponentVersion` (docs/14 §3.2): sem campo de notas — o schema não tem —
 * e com o aviso da RN-GOV-07 sempre visível, porque nesta sessão toda
 * publicação de componente é direta (sem DB de origem).
 */
export function PublishComponentDialog({
  open,
  onOpenChange,
  component,
  version,
  foundationEffectiveFrom,
  onPublished,
}: PublishComponentDialogProps) {
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const roleGate = useRoleGate('componentVersion/publish');

  const isFirstVersion = version.number === 1;
  const defaultDate = useMemo(() => {
    if (isFirstVersion && foundationEffectiveFrom !== undefined) {
      return isoToDateInputValue(foundationEffectiveFrom);
    }
    return dateInputValue(new Date());
  }, [isFirstVersion, foundationEffectiveFrom]);

  const [effectiveFrom, setEffectiveFrom] = useState(defaultDate);

  useEffect(() => {
    if (open) setEffectiveFrom(defaultDate);
  }, [open, defaultDate]);

  function handlePublish() {
    const result = dispatch(
      publishComponentVersion({
        versionId: version.id,
        effectiveFrom: dateInputToIso(effectiveFrom),
      }),
    );
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível publicar',
        description: result.error.message || getErrorMessage(result.error.code),
      });
      return;
    }
    onOpenChange(false);
    onPublished();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Publicar a versão {version.number}</DialogTitle>
          <DialogDescription>
            "{component.name}"
            {isFirstVersion
              ? ' — primeira publicação deste componente.'
              : ' — substitui a versão vigente atual.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="component-publish-effective-from">Vigência (obrigatória)</Label>
            <Input
              id="component-publish-effective-from"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
            {isFirstVersion && foundationEffectiveFrom !== undefined && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Sugerida pela vigência da fundação do projeto — pode ser alterada.
              </p>
            )}
          </div>

          <Alert>
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>
              Publicação direta (RN-GOV-07): sem Solicitação de Alteração de origem, esta publicação
              entra na linha do tempo marcada como "publicação direta".
            </AlertDescription>
          </Alert>

          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>
              Publicar é definitivo. A versão publicada não pode mais ser editada.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={effectiveFrom === '' || !roleGate.allowed}
            onClick={handlePublish}
            title={roleGate.reason ?? undefined}
          >
            Publicar versão {version.number}
          </Button>
          {roleGate.reason !== null && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{roleGate.reason}</p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
