import { useRef, useState } from 'react';
import { Download, Paperclip, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/library/ConfirmDialog';
import { useToast } from '@/components/ui/use-toast';
import { attachEvidence, detachEvidence, listAttachments } from '@/core/document/evidence';
import type { Attachment, AttachmentTarget } from '@/core/document/schema';
import { DomainError } from '@/core/errors';
import {
  explorerPath,
  formatBytes,
  localDateStamp,
  targetCodes,
  EVIDENCE_TRASH_DIR_NAME,
  EVIDENCE_UNAVAILABLE_REASON,
  MAX_EVIDENCE_BYTES,
} from '@/storage/evidences';
import { formatDateTimeBR } from '@/lib/format';
import { useDocumentStore } from '@/store/document-store';
import { downloadEvidence, uploadEvidence, usePersistenceStore } from '@/store/persistence-store';

/**
 * Seção "Evidências" do inspector — docs/07-ux-e-editor.md §6.3,
 * docs/14-plataforma-local.md §7.
 *
 * Anexar é sempre **duas** operações, nesta ordem: o servidor copia o arquivo
 * para o acervo (`POST /api/evidences`) e só então o documento ganha o vínculo
 * (`evidence/attach`). Desanexar é o contrário e assimétrico de propósito: o
 * vínculo sai na hora, o arquivo só se move depois de um salvamento
 * bem-sucedido (`persistence-store.ts`) — é o que faz `Ctrl+Z` funcionar sem
 * depender de um arquivo que já mudou de lugar.
 *
 * Anexo em versão publicada é permitido e **não** altera o snapshot: a lista
 * vive fora da versão, como os eventos de auditoria (docs/14 §7).
 */

export type EvidenceSectionProps = {
  target: AttachmentTarget;
  /** "Evidências", "Evidências da matriz"… — o alvo aparece no título quando há mais de um na tela. */
  title?: string;
};

function targetLabel(target: AttachmentTarget): string {
  if (target.kind === 'PROJECT') return 'deste projeto';
  if (target.kind === 'MATRIX') return 'desta matriz';
  return `da versão ${target.versionNumber}`;
}

export function EvidenceSection({ target, title = 'Evidências' }: EvidenceSectionProps) {
  const document = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const identity = useDocumentStore((s) => s.identity);
  const mode = usePersistenceStore((s) => s.mode);
  const connection = usePersistenceStore((s) => s.serverConnection);
  const dataDir = connection?.dataDir;
  const { toast } = useToast();

  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [toDetach, setToDetach] = useState<Attachment | null>(null);

  if (document === null) return null;

  const attachments = listAttachments(document, target);
  const available = mode === 'SERVER';

  async function handleFile(file: File): Promise<void> {
    if (document === null) return;
    const codes = targetCodes(document, target);
    if (codes === null) {
      toast({ title: 'Não foi possível anexar', description: 'O alvo desta evidência não existe mais no documento.' });
      return;
    }

    setBusy(true);
    try {
      const copied = await uploadEvidence({ file, date: localDateStamp(), ...codes });
      const result = dispatch(
        attachEvidence({
          id: copied.id,
          fileName: copied.fileName,
          relPath: copied.relPath,
          sha256: copied.sha256,
          bytes: copied.bytes,
          addedBy: {
            username: identity.username,
            // `displayName` é rótulo; `username` é o login que a auditoria
            // reconhece (ADR-003) — os dois entram, cada um no seu papel.
            ...(connection?.displayName == null ? {} : { displayName: connection.displayName }),
          },
          target,
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        }),
      );
      if (!result.ok) {
        // O arquivo já está no acervo; sem o vínculo, a reconciliação do
        // próximo salvamento o manda para a lixeira (docs/14 §7).
        toast({ title: 'O arquivo foi copiado, mas o anexo não', description: result.error.message });
        return;
      }
      setNote('');
      toast({
        title: 'Evidência anexada',
        description: `${copied.fileName} — salve o documento para registrar o vínculo.`,
      });
    } catch (error) {
      toast({
        title: 'Não foi possível anexar',
        description: error instanceof DomainError ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen(attachment: Attachment): Promise<void> {
    setBusy(true);
    try {
      const blob = await downloadEvidence(attachment);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = attachment.fileName;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      // Revogar na hora cancelaria o download em alguns navegadores.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast({
        title: 'Não foi possível abrir a evidência',
        description: error instanceof DomainError ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  function handleDetach(): void {
    if (toDetach === null) return;
    const result = dispatch(detachEvidence({ id: toDetach.id }));
    if (!result.ok) {
      toast({ title: 'Não foi possível desanexar', description: result.error.message });
    }
    setToDetach(null);
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800"
      data-testid="evidence-section"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-neutral-700 dark:text-neutral-300">{title}</span>
        <span className="text-neutral-500 dark:text-neutral-400">{attachments.length}</span>
      </div>

      {attachments.length === 0 ? (
        <p className="text-neutral-500 dark:text-neutral-400">
          Nenhuma evidência {targetLabel(target)} ainda.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-start gap-2 rounded border border-neutral-200 p-1.5 dark:border-neutral-800"
              data-testid="evidence-item"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-neutral-900 dark:text-neutral-100" title={attachment.fileName}>
                  {attachment.fileName}
                </p>
                <p className="text-neutral-500 dark:text-neutral-400">
                  {attachment.addedBy.displayName ?? attachment.addedBy.username} ·{' '}
                  {formatDateTimeBR(attachment.addedAt)} · {formatBytes(attachment.bytes)}
                </p>
                {attachment.note !== undefined && (
                  <p className="text-neutral-500 dark:text-neutral-400">{attachment.note}</p>
                )}
                <p className="truncate font-mono text-[10px] text-neutral-400" title={explorerPath(attachment.relPath, dataDir)}>
                  {explorerPath(attachment.relPath, dataDir)}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Abrir ${attachment.fileName}`}
                disabled={!available || busy}
                onClick={() => void handleOpen(attachment)}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Desanexar ${attachment.fileName}`}
                disabled={!available || busy}
                onClick={() => setToDetach(attachment)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {available ? (
        <div className="flex flex-col gap-1.5">
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Nota sobre a evidência (opcional)"
            aria-label="Nota da evidência"
            className="h-8 text-xs"
          />
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            aria-label="Arquivo da evidência"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file !== undefined) void handleFile(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip className="mr-1.5 h-3.5 w-3.5" />
            {busy ? 'Copiando…' : 'Anexar arquivo'}
          </Button>
          <p className="text-neutral-500 dark:text-neutral-400">
            O arquivo é copiado para o acervo da pasta de rede e fica navegável no Explorer. A aplicação não lê
            nem indexa o conteúdo — limite de {formatBytes(MAX_EVIDENCE_BYTES)} por arquivo.
          </p>
        </div>
      ) : (
        <p className="text-neutral-500 dark:text-neutral-400" data-testid="evidence-unavailable">
          {EVIDENCE_UNAVAILABLE_REASON}
        </p>
      )}

      <ConfirmDialog
        open={toDetach !== null}
        onOpenChange={(open) => {
          if (!open) setToDetach(null);
        }}
        title={`Desanexar "${toDetach?.fileName ?? ''}"?`}
        description={`O vínculo sai do documento agora e pode ser desfeito com Ctrl+Z. No próximo salvamento, o arquivo é movido para ${explorerPath(EVIDENCE_TRASH_DIR_NAME, dataDir)} — nada é apagado, e esvaziar a lixeira é ato manual de quem cuida da pasta.`}
        confirmLabel="Desanexar"
        destructive
        onConfirm={handleDetach}
      />
    </div>
  );
}
