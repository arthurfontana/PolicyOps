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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { getErrorMessage } from '@/core/error-messages';
import { listPendingComponentVersions } from '@/core/queries';
import { publishPendingComponentVersions } from '@/core/versioning/component-lifecycle';
import { COMPONENT_TYPE_LABELS } from '@/lib/component-labels';
import { dateInputToIso, dateInputValue, isoToDateInputValue } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';
import { useRoleGate } from '@/hooks/useRole';

export interface PublishPendingComponentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** `Project.foundationEffectiveFrom` (RN-GOV-09) — vigência sugerida do lote. */
  foundationEffectiveFrom?: string;
  onPublished: (count: number) => void;
}

/**
 * "Publicar pendentes" — docs/07 §17.4, RN-GOV-09: publicar ~100 componentes
 * que já vigoram não pode custar ~100 diálogos. Uma vigência para o lote
 * inteiro, desmarcação item a item, e o aviso da RN-GOV-07 uma vez só (não
 * repetido por item). A publicação é tudo ou nada (RN-GOV-05,
 * `publishPendingComponentVersions`) — o próprio comando garante isso; este
 * diálogo só monta a lista e mostra o resultado.
 */
export function PublishPendingComponentsDialog({
  open,
  onOpenChange,
  projectId,
  foundationEffectiveFrom,
  onPublished,
}: PublishPendingComponentsDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const roleGate = useRoleGate('componentVersion/publishPending');

  const pending = useMemo(
    () => (document === null ? [] : listPendingComponentVersions(document, projectId)),
    [document, projectId],
  );

  const defaultDate = useMemo(
    () => (foundationEffectiveFrom !== undefined ? isoToDateInputValue(foundationEffectiveFrom) : dateInputValue(new Date())),
    [foundationEffectiveFrom],
  );
  const [effectiveFrom, setEffectiveFrom] = useState(defaultDate);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setEffectiveFrom(defaultDate);
    setChecked(new Set(pending.map((entry) => entry.version.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao abrir: não reempilhar seleção a cada render do documento
  }, [open, defaultDate]);

  function toggle(versionId: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(versionId)) next.delete(versionId);
      else next.add(versionId);
      return next;
    });
  }

  function handlePublish() {
    const versionIds = pending.map((entry) => entry.version.id).filter((id) => checked.has(id));
    const result = dispatch(
      publishPendingComponentVersions({ versionIds, effectiveFrom: dateInputToIso(effectiveFrom) }),
    );
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível publicar o lote',
        description: result.error.message || getErrorMessage(result.error.code),
      });
      return;
    }
    onOpenChange(false);
    onPublished(result.data.published.length);
  }

  const selectedCount = checked.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Publicar pendentes</DialogTitle>
          <DialogDescription>
            {pending.length === 0
              ? 'Nenhum componente com rascunho em aberto neste projeto.'
              : `${pending.length} componente(s) com rascunho em aberto. Publica em lote, na mesma vigência — tudo ou nada.`}
          </DialogDescription>
        </DialogHeader>

        {pending.length > 0 && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pending-effective-from">Vigência do lote (obrigatória)</Label>
              <Input
                id="pending-effective-from"
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
              {foundationEffectiveFrom !== undefined && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Sugerida pela vigência da fundação do projeto — pode ser alterada.
                </p>
              )}
            </div>

            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
              {pending.map((entry) => (
                <li key={entry.version.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <Checkbox
                    id={`pending-${entry.version.id}`}
                    checked={checked.has(entry.version.id)}
                    onCheckedChange={() => toggle(entry.version.id)}
                    aria-label={`Incluir ${entry.component.name} no lote`}
                  />
                  <label htmlFor={`pending-${entry.version.id}`} className="min-w-0 flex-1 cursor-pointer truncate">
                    {entry.component.name}
                    <span className="ml-1.5 font-mono text-[10px] text-neutral-400">{entry.component.code}</span>
                  </label>
                  <span className="shrink-0 text-xs text-neutral-400">
                    {COMPONENT_TYPE_LABELS[entry.component.type]} · v{entry.version.number}
                  </span>
                </li>
              ))}
            </ul>

            <Alert>
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription>
                Publicação direta (RN-GOV-07): sem Solicitação de Alteração de origem, todo o lote entra
                na linha do tempo marcado como "publicação direta".
              </AlertDescription>
            </Alert>
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {pending.length > 0 && (
            <Button
              type="button"
              disabled={selectedCount === 0 || effectiveFrom === '' || !roleGate.allowed}
              onClick={handlePublish}
              title={roleGate.reason ?? undefined}
            >
              Publicar {selectedCount} componente(s)
            </Button>
          )}
          {roleGate.reason !== null && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{roleGate.reason}</p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
