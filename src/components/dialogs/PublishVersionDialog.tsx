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
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { getErrorMessage } from '@/core/error-messages';
import { diffVersions, type VersionDiff } from '@/core/diff';
import { MIN_NOTES_LENGTH, publishVersion } from '@/core/versioning/lifecycle';
import type { Matrix, MatrixVersion } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';

export interface PublishVersionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matrix: Matrix;
  version: MatrixVersion;
  publishedVersion: MatrixVersion | null;
  onPublished: () => void;
  /**
   * `UNSET_CELLS_REMAIN` não é um toast (docs/prompts/S13, item 2): quem
   * chama fecha o diálogo, destaca as pendências no grid e mostra a barra
   * dedicada. Este diálogo só entrega as coordenadas.
   */
  onUnsetCellsRemain: (coords: Array<{ xPath: string; yPath: string }>) => void;
}

/** A frase de abertura do diálogo, em linguagem de negócio (docs/05 §4.3). */
function describeDiff(diff: VersionDiff | null): string {
  if (diff === null) return 'primeira publicação desta matriz, sem versão anterior para comparar.';
  if (!diff.comparable) {
    return 'a estrutura dos eixos mudou em relação à vigente, e as duas versões não são comparáveis célula a célula.';
  }
  if (diff.summaryText.length === 0) return 'nenhuma alteração em relação à vigente.';
  return `em relação à versão ${diff.a.number}:`;
}

/** `YYYY-MM-DD` local, para o `min` do seletor de data e o valor inicial. */
function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function tomorrow(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date;
}

/**
 * Diálogo de publicação — docs/prompts/S13-ciclo-de-vida.md item 2. Notas
 * obrigatórias (≥10 caracteres), vigência imediata ou agendada, aviso literal
 * de irreversibilidade, e confirmação exigindo digitar o número da versão.
 */
export function PublishVersionDialog({
  open,
  onOpenChange,
  matrix,
  version,
  publishedVersion,
  onPublished,
  onUnsetCellsRemain,
}: PublishVersionDialogProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const [notes, setNotes] = useState('');
  const [schedule, setSchedule] = useState<'now' | 'scheduled'>('now');
  const minScheduledDate = useMemo(() => toDateInputValue(tomorrow()), []);
  const [scheduledDate, setScheduledDate] = useState(minScheduledDate);
  const [confirmNumber, setConfirmNumber] = useState('');

  useEffect(() => {
    if (!open) return;
    setNotes('');
    setSchedule('now');
    setScheduledDate(minScheduledDate);
    setConfirmNumber('');
  }, [open, minScheduledDate]);

  /**
   * O resumo semântico contra a vigente — docs/05 §4.3. É o mesmo motor da
   * tela de comparação, e é exatamente o que vai para o payload do evento
   * `VERSION_PUBLISHED` na hora de publicar.
   */
  const diff = useMemo(
    () =>
      document === null || publishedVersion === null
        ? null
        : diffVersions(document, publishedVersion.id, version.id),
    [document, publishedVersion, version.id],
  );

  const notesValid = notes.trim().length >= MIN_NOTES_LENGTH;
  const confirmValid = confirmNumber.trim() === String(version.number);
  const canPublish = notesValid && confirmValid && (schedule === 'now' || scheduledDate !== '');

  function handlePublish() {
    const effectiveFrom =
      schedule === 'scheduled' ? new Date(`${scheduledDate}T00:00:00.000Z`).toISOString() : undefined;

    const result = dispatch(
      publishVersion({
        versionId: version.id,
        notes: notes.trim(),
        ...(effectiveFrom !== undefined ? { effectiveFrom } : {}),
      }),
    );

    if (!result.ok) {
      if (result.error.code === 'UNSET_CELLS_REMAIN') {
        onOpenChange(false);
        const details = result.error.details as
          | { coords?: Array<{ xPath: string; yPath: string }> }
          | undefined;
        onUnsetCellsRemain(details?.coords ?? []);
        return;
      }
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
            "{matrix.name}" — {describeDiff(diff)}
          </DialogDescription>
        </DialogHeader>

        {diff !== null && diff.comparable && diff.summaryText.length > 0 && (
          <ul
            data-testid="publish-diff-summary"
            className="flex flex-wrap gap-1.5 text-xs text-neutral-700 dark:text-neutral-300"
          >
            {diff.summaryText.map((phrase) => (
              <li
                key={phrase}
                className="rounded-full bg-neutral-100 px-2.5 py-0.5 dark:bg-neutral-800"
              >
                {phrase}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="publish-notes">Notas desta publicação</Label>
            <Textarea
              id="publish-notes"
              autoFocus
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="O que mudou nesta versão e por quê (mínimo de 10 caracteres)."
            />
            {!notesValid && notes.length > 0 && (
              <p className="text-xs text-red-600 dark:text-red-400">
                Faltam {MIN_NOTES_LENGTH - notes.trim().length} caractere(s).
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Vigência</Label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <input
                  type="radio"
                  name="publish-schedule"
                  checked={schedule === 'now'}
                  onChange={() => setSchedule('now')}
                />
                Imediatamente
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <input
                  type="radio"
                  name="publish-schedule"
                  checked={schedule === 'scheduled'}
                  onChange={() => setSchedule('scheduled')}
                />
                Agendar para
                <Input
                  type="date"
                  className="w-auto"
                  min={minScheduledDate}
                  value={scheduledDate}
                  disabled={schedule !== 'scheduled'}
                  onChange={(event) => setScheduledDate(event.target.value)}
                  onFocus={() => setSchedule('scheduled')}
                />
              </label>
            </div>
          </div>

          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>
              Publicar é definitivo. A versão publicada não pode ser editada, e o histórico de desfazer
              desta sessão será perdido.
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="publish-confirm">
              Para confirmar, digite o número da versão (<strong>{version.number}</strong>)
            </Label>
            <Input
              id="publish-confirm"
              value={confirmNumber}
              onChange={(event) => setConfirmNumber(event.target.value)}
              placeholder={String(version.number)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={!canPublish} onClick={handlePublish}>
            Publicar versão {version.number}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
