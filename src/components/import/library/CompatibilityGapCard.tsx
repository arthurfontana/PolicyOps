import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import type { DefaultForUnlisted } from '@/core/document/schema';
import type { CompatibilityGap } from '@/core/import/library-gaps';
import { CompatibilityMapEditor } from '@/components/library/CompatibilityMapEditor';
import { useDocumentStore } from '@/store/document-store';
import { applyCompatibilityGap } from './library-actions';

/** Uma seção do passo 3 por par de eixo com compatibilidade a completar — US-03/US-04. */
export function CompatibilityGapCard({ gap }: { gap: CompatibilityGap }) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [allow, setAllow] = useState<Record<string, string[]>>(gap.allow);
  const [defaultForUnlisted, setDefaultForUnlisted] = useState<DefaultForUnlisted>(gap.defaultForUnlisted);

  if (document === null) return null;

  const parentVariable = document.variables.find((v) => v.id === gap.parentVariableId);
  const childVariable = document.variables.find((v) => v.id === gap.childVariableId);
  const parentPublished = parentVariable?.versions.find((v) => v.state === 'PUBLISHED');
  const childPublished = childVariable?.versions.find((v) => v.state === 'PUBLISHED');
  const ready = parentPublished !== undefined && childPublished !== undefined;

  function openDialog() {
    setAllow(gap.allow);
    setDefaultForUnlisted(gap.defaultForUnlisted);
    setDialogOpen(true);
  }

  function handleConfirm() {
    if (document === null) return;
    const result = applyCompatibilityGap(dispatch, document, gap, allow, defaultForUnlisted);
    if (!result.ok) {
      toast({ title: 'Não foi possível salvar o mapa de compatibilidade', description: result.message });
      return;
    }
    setDialogOpen(false);
    toast({ title: `Compatibilidade ${gap.parentVariableCode} × ${gap.childVariableCode} publicada` });
  }

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Compatibilidade {gap.parentVariableCode || '?'} × {gap.childVariableCode || '?'}
          </h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {gap.exists
              ? `${gap.missingPairs.length} pares do arquivo fora do mapa publicado`
              : 'nenhuma regra publicada ainda'}
            {!ready && ' — resolva os domínios dos dois lados antes'}
          </p>
        </div>
        <Button type="button" size="sm" disabled={!ready} onClick={openDialog}>
          Criar mapa do arquivo
        </Button>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Compatibilidade {gap.parentVariableCode} × {gap.childVariableCode}
            </DialogTitle>
            <DialogDescription>
              Mapa deduzido dos pares observados no arquivo — revise antes de publicar.
            </DialogDescription>
          </DialogHeader>
          {ready && (
            <CompatibilityMapEditor
              ruleId="preview"
              ruleCode={`${gap.parentVariableCode}_${gap.childVariableCode}`}
              parentVariableId={gap.parentVariableId}
              childVariableId={gap.childVariableId}
              compatibilityVersionId="preview"
              parentLabel={gap.parentVariableCode}
              childLabel={gap.childVariableCode}
              parentDomains={parentPublished?.domains ?? []}
              childDomains={childPublished?.domains ?? []}
              allow={allow}
              defaultForUnlisted={defaultForUnlisted}
              onChange={(next) => {
                setAllow(next.allow);
                setDefaultForUnlisted(next.defaultForUnlisted);
              }}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleConfirm}>
              Salvar e publicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
