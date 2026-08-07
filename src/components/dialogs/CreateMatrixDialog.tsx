import { useEffect, useMemo, useState } from 'react';
import { LayoutTemplate, Sparkles, TriangleAlert } from 'lucide-react';
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
import { TemplateGridPreview } from '@/components/templates/TemplateGridPreview';
import { CODE_REGEX } from '@/core/document/schema';
import { createMatrix } from '@/core/versioning/lifecycle';
import { instantiateTemplate } from '@/core/templates/instantiate';
import { previewTemplate, type TemplatePreview } from '@/core/templates/preview';
import { DomainError } from '@/core/errors';
import { MAX_COMBINATIONS, LARGE_GRID_THRESHOLD } from '@/core/axes/tuples';
import { listTemplates } from '@/core/queries';
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

type Origin = 'scratch' | 'template';

/**
 * Wizard de criação de matriz em Dialog — docs/07-ux-e-editor.md, docs/prompts/S09.
 *
 * Passo 0 — "Começar do zero" ou "Usar um template" (docs/prompts/S17 Parte
 * A): com template, os eixos do passo 2 vêm preenchidos e bloqueados, e
 * regras que não puderam ser aplicadas viram um aviso depois da criação.
 */
export function CreateMatrixDialog({ open, onOpenChange, projectId, onCreated }: CreateMatrixDialogProps) {
  const doc = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [origin, setOrigin] = useState<Origin>('scratch');
  const [templateId, setTemplateId] = useState<string | null>(null);
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
    setStep(0);
    setOrigin('scratch');
    setTemplateId(null);
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
  const templates = useMemo(() => (doc === null ? [] : listTemplates(doc)), [doc]);

  const { templatePreview, templateError } = useMemo<{
    templatePreview: TemplatePreview | null;
    templateError: string | null;
  }>(() => {
    if (doc === null || templateId === null) return { templatePreview: null, templateError: null };
    try {
      return { templatePreview: previewTemplate(doc, templateId), templateError: null };
    } catch (error) {
      const message = error instanceof DomainError ? error.message : 'Não foi possível calcular o preview do template.';
      return { templatePreview: null, templateError: message };
    }
  }, [doc, templateId]);

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
  const canCreate =
    step1Valid &&
    (origin === 'scratch'
      ? axesReady && !gridTooLarge
      : templateId !== null && templateError === null);

  function chooseScratch() {
    setOrigin('scratch');
    setTemplateId(null);
    setStep(1);
  }

  function chooseTemplate(id: string) {
    setOrigin('template');
    setTemplateId(id);
    setStep(1);
  }

  function handleCreate() {
    if (doc === null) return;

    if (origin === 'template') {
      if (templateId === null) return;
      const result = dispatch(
        instantiateTemplate({
          templateId,
          projectId,
          code: code.trim(),
          name: name.trim(),
          ...(description.trim() !== '' ? { description: description.trim() } : {}),
        }),
      );
      if (!result.ok) {
        toast({ title: 'Não foi possível criar a matriz', description: result.error.message });
        return;
      }
      onOpenChange(false);
      if (result.data.skippedRules.length > 0) {
        const count = result.data.skippedRules.length;
        toast({
          title: `Matriz criada — ${count} regra${count === 1 ? '' : 's'} do template não p${count === 1 ? 'ôde' : 'uderam'} ser aplicada${count === 1 ? '' : 's'}`,
          description: 'A biblioteca pode ter evoluído desde que o template foi criado. Revise as células afetadas.',
        });
      }
      onCreated(result.data.matrixId, result.data.versionId);
      return;
    }

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

  const stepLabel =
    step === 0
      ? 'Passo 1 de 3 — origem.'
      : step === 1
        ? 'Passo 2 de 3 — identificação.'
        : origin === 'scratch'
          ? 'Passo 3 de 3 — eixos X (colunas) e Y (linhas).'
          : 'Passo 3 de 3 — eixos vindos do template.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova matriz {project !== null ? `em "${project.name}"` : ''}</DialogTitle>
          <DialogDescription>{stepLabel}</DialogDescription>
        </DialogHeader>

        {step === 0 && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={chooseScratch}
              className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3 text-left transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
            >
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" />
              <div>
                <div className="font-medium text-neutral-900 dark:text-neutral-100">Começar do zero</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">
                  Monta os eixos do zero no próximo passo.
                </div>
              </div>
            </button>

            <div>
              <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                <LayoutTemplate className="h-3.5 w-3.5" /> Ou use um template
              </div>
              {templates.length === 0 ? (
                <p className="rounded-md bg-neutral-50 p-2 text-xs text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                  Nenhum template ainda. Crie um em "Templates" na barra lateral.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5" data-testid="wizard-template-list">
                  {templates.map(({ template, combinations, filledCount, error }) => (
                    <li key={template.id}>
                      <button
                        type="button"
                        onClick={() => chooseTemplate(template.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-200 p-3 text-left transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                            {template.name}
                          </div>
                          <div className="text-xs text-neutral-500 dark:text-neutral-400">
                            {error !== null
                              ? error
                              : `${filledCount} de ${combinations} combinações pré-preenchidas`}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

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

        {step === 2 && origin === 'scratch' && (
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

        {step === 2 && origin === 'template' && (
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Os eixos vêm do template e não podem ser alterados aqui — edite o template em "Templates" se
              precisar de outra estrutura.
            </p>
            {templateError !== null ? (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription>{templateError}</AlertDescription>
              </Alert>
            ) : (
              templatePreview !== null && (
                <>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
                      <span className="font-semibold text-neutral-700 dark:text-neutral-300">Eixo X</span>
                      <p className="text-neutral-500 dark:text-neutral-400">
                        {templatePreview.x.levels.map((level) => level.label).join(' › ')}
                      </p>
                    </div>
                    <div className="rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
                      <span className="font-semibold text-neutral-700 dark:text-neutral-300">Eixo Y</span>
                      <p className="text-neutral-500 dark:text-neutral-400">
                        {templatePreview.y.levels.map((level) => level.label).join(' › ')}
                      </p>
                    </div>
                  </div>
                  <TemplateGridPreview
                    xTuples={templatePreview.x.tuples}
                    yTuples={templatePreview.y.tuples}
                    cells={templatePreview.cells}
                  />
                  {templatePreview.skippedRules.length > 0 && (
                    <Alert>
                      <TriangleAlert className="h-4 w-4" />
                      <AlertDescription>
                        {templatePreview.skippedRules.length}{' '}
                        {templatePreview.skippedRules.length === 1 ? 'regra' : 'regras'} deste template não{' '}
                        {templatePreview.skippedRules.length === 1 ? 'poderá' : 'poderão'} ser aplicada
                        {templatePreview.skippedRules.length === 1 ? '' : 's'} — a biblioteca pode ter
                        evoluído. Isso não impede a criação da matriz.
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              )
            )}
          </div>
        )}

        <DialogFooter>
          {step === 0 && (
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          )}
          {step === 1 && (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep(0)}>
                Voltar
              </Button>
              <Button type="button" disabled={!step1Valid} onClick={() => setStep(2)}>
                Avançar
              </Button>
            </>
          )}
          {step === 2 && (
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
