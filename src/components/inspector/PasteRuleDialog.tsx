import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { recognizeRulePaste, type RulePasteRecognition } from '@/core/versioning/rule-paste';

export interface PasteRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (recognition: RulePasteRecognition) => void;
}

const EXAMPLE = [
  'Bloqueia o cliente com dívida em aberto igual ou superior a R$ 5.000.',
  'Definição técnica: Aging > 0 e Valor >= 5000',
  'Observação: Reason code DV01 — reprovado, Oferta = 0.',
].join('\n');

/**
 * Entrada em volume — docs/07 §17.3 item 5: colar o parágrafo do documento
 * real e reconhecer por prefixo de linha, com **preview antes de aplicar**.
 * Sem parser de Markdown e sem lib nova (DEC-GOV-005 nesta mesma linha de
 * raciocínio) — é regex sobre o formato de origem, nada mais.
 */
export function PasteRuleDialog({ open, onOpenChange, onApply }: PasteRuleDialogProps) {
  const [text, setText] = useState('');
  const recognition = text.trim().length === 0 ? null : recognizeRulePaste(text);

  function handleClose(next: boolean) {
    if (!next) setText('');
    onOpenChange(next);
  }

  function handleApply() {
    if (recognition === null) return;
    onApply(recognition);
    setText('');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Colar bloco de texto</DialogTitle>
          <DialogDescription>
            Cole o parágrafo do documento de política, no formato de origem — parágrafo solto,{' '}
            <code>Definição técnica:</code> e <code>Observação:</code>. Exemplo:
            <span className="mt-1 block whitespace-pre-wrap rounded-md bg-neutral-100 p-2 font-mono text-[11px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
              {EXAMPLE}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="paste-rule-text">Texto colado</Label>
          <Textarea
            id="paste-rule-text"
            autoFocus
            rows={6}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={EXAMPLE}
          />
        </div>

        {recognition !== null && (
          <div
            data-testid="paste-rule-preview"
            className="flex flex-col gap-1.5 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800"
          >
            <p className="font-semibold text-neutral-700 dark:text-neutral-300">Preview</p>
            <p>
              <span className="text-neutral-500 dark:text-neutral-400">Descrição de negócio: </span>
              {recognition.businessDescription || <em>vazio</em>}
            </p>
            {recognition.technicalDefinition !== undefined && (
              <p>
                <span className="text-neutral-500 dark:text-neutral-400">Definição técnica: </span>
                {recognition.technicalDefinition}
              </p>
            )}
            {recognition.reasonCodes !== undefined && (
              <p>
                <span className="text-neutral-500 dark:text-neutral-400">Reason codes: </span>
                {recognition.reasonCodes.join(', ')}
              </p>
            )}
            {recognition.outcome !== undefined && (
              <p>
                <span className="text-neutral-500 dark:text-neutral-400">Resultado: </span>
                {recognition.outcome}
              </p>
            )}
            {recognition.notes !== undefined && (
              <p>
                <span className="text-neutral-500 dark:text-neutral-400">Notas: </span>
                {recognition.notes}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleClose(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={recognition === null} onClick={handleApply}>
            Aplicar ao rascunho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
