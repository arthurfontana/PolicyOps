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
import { AxisBuilder, type AxisPreview } from '@/components/editor/axis-builder';
import { CODE_REGEX } from '@/core/document/schema';
import { createMatrix } from '@/core/versioning/lifecycle';
import { MAX_COMBINATIONS, LARGE_GRID_THRESHOLD } from '@/core/axes/tuples';
import { useDocumentStore } from '@/store/document-store';

export interface CreateMatrixDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCreated: (matrixId: string, versionId: string) => void;
}

/** Remove acentos via decomposição Unicode (NFD) e descarta as marcas combinantes resultantes. */
function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function suggestCode(name: string): string {
  const slug = stripDiacritics(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug === '' ? '' : `MTZ_${slug}`;
}

const EMPTY_PREVIEW: AxisPreview = { tupleCount: 0, warnings: [], error: null };

/** Wizard de criação de matriz em Dialog, 2 passos — docs/07-ux-e-editor.md, docs/prompts/S09. */
export function CreateMatrixDialog({ open, onOpenChange, projectId, onCreated }: CreateMatrixDialogProps) {
  const doc = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [xVariableIds, setXVariableIds] = useState<string[]>([]);
  const [yVariableIds, setYVariableIds] = useState<string[]>([]);
  const [xPreview, setXPreview] = useState<AxisPreview>(EMPTY_PREVIEW);
  const [yPreview, setYPreview] = useState<AxisPreview>(EMPTY_PREVIEW);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setName('');
    setCode('');
    setCodeTouched(false);
    setDescription('');
    setXVariableIds([]);
    setYVariableIds([]);
    setXPreview(EMPTY_PREVIEW);
    setYPreview(EMPTY_PREVIEW);
  }, [open]);

  const project = doc?.projects.find((candidate) => candidate.id === projectId) ?? null;

  const codeError = useMemo(() => {
    if (code.trim() === '') return null;
    return CODE_REGEX.test(code) ? null : 'O código só pode ter letras maiúsculas, números e "_".';
  }, [code]);

  const totalCombinations = xPreview.tupleCount * yPreview.tupleCount;
  const axesReady =
    xVariableIds.length > 0 &&
    yVariableIds.length > 0 &&
    xPreview.error === null &&
    yPreview.error === null;
  const gridTooLarge = axesReady && totalCombinations > MAX_COMBINATIONS;
  const gridLarge = axesReady && !gridTooLarge && totalCombinations > LARGE_GRID_THRESHOLD;

  const step1Valid = name.trim() !== '' && code.trim() !== '' && codeError === null;
  const canCreate = step1Valid && axesReady && !gridTooLarge;

  function handleCreate() {
    if (doc === null) return;
    const result = dispatch(
      createMatrix({
        projectId,
        code: code.trim(),
        name: name.trim(),
        ...(description.trim() !== '' ? { description: description.trim() } : {}),
        x: { levels: xVariableIds.map((variableId) => ({ variableId })) },
        y: { levels: yVariableIds.map((variableId) => ({ variableId })) },
      }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível criar a matriz', description: result.error.message });
      return;
    }
    onOpenChange(false);
    onCreated(result.data.matrixId, result.data.versionId);
  }

  if (doc === null) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova matriz {project !== null ? `em "${project.name}"` : ''}</DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'Passo 1 de 2 — identificação.'
              : 'Passo 2 de 2 — eixos X (colunas) e Y (linhas).'}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-matrix-name">Nome</Label>
              <Input
                id="new-matrix-name"
                autoFocus
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!codeTouched) setCode(suggestCode(event.target.value));
                }}
                placeholder="Limite de Crédito — Pessoa Jurídica"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-matrix-code">Código</Label>
              <Input
                id="new-matrix-code"
                value={code}
                onChange={(event) => {
                  setCodeTouched(true);
                  setCode(event.target.value.toUpperCase());
                }}
                placeholder="MTZ_LIMITE_PJ"
                required
              />
              {codeError !== null && <p className="text-xs text-red-600 dark:text-red-400">{codeError}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-matrix-description">Descrição (opcional)</Label>
              <Input
                id="new-matrix-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            <AxisBuilder
              role="X"
              title="Eixo X (colunas)"
              doc={doc}
              variableIds={xVariableIds}
              onChange={setXVariableIds}
              excludedVariableIds={yVariableIds}
              onPreviewChange={setXPreview}
            />
            <AxisBuilder
              role="Y"
              title="Eixo Y (linhas)"
              doc={doc}
              variableIds={yVariableIds}
              onChange={setYVariableIds}
              excludedVariableIds={xVariableIds}
              onPreviewChange={setYPreview}
            />

            {axesReady && (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {yPreview.tupleCount} linha{yPreview.tupleCount === 1 ? '' : 's'} ×{' '}
                {xPreview.tupleCount} coluna{xPreview.tupleCount === 1 ? '' : 's'} = {totalCombinations}{' '}
                combinações
              </p>
            )}
            {gridLarge && (
              <Alert>
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription>
                  {totalCombinations} combinações é um grid grande — acima do limite confortável de{' '}
                  {LARGE_GRID_THRESHOLD}.
                </AlertDescription>
              </Alert>
            )}
            {gridTooLarge && (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription>
                  {totalCombinations} combinações passa do teto de {MAX_COMBINATIONS}. Remova um nível ou
                  escolha variáveis com menos domínios.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="button" disabled={!step1Valid} onClick={() => setStep(2)}>
                Avançar
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                Voltar
              </Button>
              <Button type="button" disabled={!canCreate} onClick={handleCreate}>
                Criar matriz
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
