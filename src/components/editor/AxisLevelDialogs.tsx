import { useMemo, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GridMiniature } from '@/components/editor/GridMiniature';
import type { OnCollapse, OnExistingContent } from '@/core/axes/levels';
import type { AxisLevel, AxisRole, PolicyOpsDocument } from '@/core/document/schema';
import { DomainError } from '@/core/errors';
import { readableTuple } from '@/lib/axis-labels';
import {
  previewAddLevelOn,
  previewRemoveLevelOn,
  previewReorderLevelsOn,
  type AxisOperationPreview,
} from '@/core/versioning/axis-commands';

/**
 * Diálogos de preview das operações de nível — docs/07-ux-e-editor.md §7 e
 * docs/04-eixos-aninhados.md §5.
 *
 * **Nenhuma operação de nível é aplicada sem passar por aqui.** O diálogo diz,
 * em português, quantas combinações e quantas células a operação cria ou
 * destrói, deixa escolher a política de conteúdo com a recomendada marcada, e
 * exige confirmação por digitação sempre que houver descarte.
 */

const ROLE_LABEL: Record<AxisRole, string> = { X: 'eixo X (colunas)', Y: 'eixo Y (linhas)' };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Roda o preview convertendo `DomainError` em mensagem — o cálculo pode recusar. */
function usePreview<P>(compute: () => AxisOperationPreview<P>, deps: unknown[]) {
  return useMemo<{ value: AxisOperationPreview<P> | null; error: string | null }>(() => {
    try {
      return { value: compute(), error: null };
    } catch (error) {
      if (error instanceof DomainError) return { value: null, error: error.message };
      throw error;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as dependências reais são as entradas do preview
  }, deps);
}

function ImpactLine({ before, after, unit }: { before: number; after: number; unit: string }) {
  return (
    <p className="text-sm text-neutral-700 dark:text-neutral-300">
      {before} {unit} viram <span className="font-semibold">{after}</span>.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Adicionar nível
// ---------------------------------------------------------------------------

export interface AddLevelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: PolicyOpsDocument;
  versionId: string;
  role: AxisRole;
  levels: AxisLevel[];
  /** Tuplas do outro eixo — não mudam, mas dão a forma real da miniatura. */
  otherTuples: string[];
  /** Variáveis que não podem entrar: as já usadas nos dois eixos. */
  excludedVariableIds: string[];
  onApply: (input: { variableId: string; position: number; onExisting: OnExistingContent }) => void;
}

function positionOptions(levels: AxisLevel[]): Array<{ value: string; label: string }> {
  const options = [{ value: '0', label: `Mais externo (antes de "${levels[0]?.label ?? '—'}")` }];
  for (let index = 1; index < levels.length; index++) {
    options.push({
      value: String(index),
      label: `Entre "${levels[index - 1]!.label}" e "${levels[index]!.label}"`,
    });
  }
  options.push({
    value: String(levels.length),
    label: `Mais interno (depois de "${levels[levels.length - 1]?.label ?? '—'}")`,
  });
  return options;
}

export function AddLevelDialog({
  open,
  onOpenChange,
  doc,
  versionId,
  role,
  levels,
  otherTuples,
  excludedVariableIds,
  onApply,
}: AddLevelDialogProps) {
  const [variableId, setVariableId] = useState<string>('');
  const [position, setPosition] = useState<string>(String(levels.length));
  const [mode, setMode] = useState<OnExistingContent>('REPLICATE');

  const excluded = useMemo(() => new Set(excludedVariableIds), [excludedVariableIds]);
  const options: ComboboxOption[] = useMemo(
    () =>
      doc.variables
        .filter((variable) => variable.archivedAt === undefined)
        .filter((variable) => variable.versions.some((version) => version.state === 'PUBLISHED'))
        .filter((variable) => !excluded.has(variable.id))
        .map((variable) => ({ value: variable.id, label: `${variable.name} (${variable.code})` })),
    [doc, excluded],
  );

  const { value, error } = usePreview(
    () =>
      previewAddLevelOn(doc, {
        versionId,
        role,
        variableId,
        position: Number(position),
        onExisting: mode,
      }),
    [doc, versionId, role, variableId, position, mode],
  );
  const ready = variableId !== '' && value !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar nível ao {ROLE_LABEL[role]}</DialogTitle>
          <DialogDescription>
            Cada combinação atual se desdobra nas combinações do novo nível. Veja o impacto antes de aplicar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Variável</Label>
            <Combobox
              options={options}
              value={variableId === '' ? undefined : variableId}
              onChange={setVariableId}
              placeholder="Escolha uma variável…"
              emptyText="Nenhuma variável publicada disponível."
              aria-label="Variável"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs">Profundidade</Label>
            <Select value={position} onValueChange={setPosition}>
              <SelectTrigger aria-label="Profundidade do novo nível">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {positionOptions(levels).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
              O que fazer com o conteúdo atual
            </legend>
            <label className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
              <input
                type="radio"
                name="on-existing"
                className="mt-0.5"
                checked={mode === 'REPLICATE'}
                onChange={() => setMode('REPLICATE')}
              />
              <span>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  Replicar (recomendado)
                </span>
                <span className="block text-neutral-500 dark:text-neutral-400">
                  Cada célula preenchida é copiada para todas as combinações novas que nascem dela. O grid continua
                  preenchido e você refina só onde precisa.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
              <input
                type="radio"
                name="on-existing"
                className="mt-0.5"
                checked={mode === 'CLEAR'}
                onChange={() => setMode('CLEAR')}
              />
              <span>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">Limpar</span>
                <span className="block text-neutral-500 dark:text-neutral-400">
                  As combinações novas nascem vazias e todo o conteúdo atual é descartado.
                </span>
              </span>
            </label>
          </fieldset>

          {mode === 'CLEAR' && (
            <Alert>
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription>
                Com "Limpar", este rascunho fica bloqueado para publicação até que todas as combinações novas sejam
                preenchidas.
              </AlertDescription>
            </Alert>
          )}

          {error !== null && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {value !== null && (
            <div className="flex flex-col gap-2 rounded-md bg-neutral-50 p-2 dark:bg-neutral-900" data-testid="add-level-preview">
              <ImpactLine
                before={value.preview.before.combinations}
                after={value.preview.after.combinations}
                unit="combinações"
              />
              <ImpactLine
                before={value.preview.before.filledCells}
                after={value.preview.after.filledCells}
                unit="células"
              />
              {value.preview.combinationsWithoutCell > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {plural(value.preview.combinationsWithoutCell, 'combinação ficará pendente', 'combinações ficarão pendentes')}.
                </p>
              )}
              <GridMiniature
                xBefore={role === 'X' ? value.tuplesBefore : otherTuples}
                xAfter={role === 'X' ? value.tuplesAfter : otherTuples}
                yBefore={role === 'Y' ? value.tuplesBefore : otherTuples}
                yAfter={role === 'Y' ? value.tuplesAfter : otherTuples}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!ready}
            onClick={() => onApply({ variableId, position: Number(position), onExisting: mode })}
          >
            Adicionar nível
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Remover nível
// ---------------------------------------------------------------------------

export interface RemoveLevelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: PolicyOpsDocument;
  versionId: string;
  role: AxisRole;
  levels: AxisLevel[];
  otherTuples: string[];
  levelIndex: number;
  onApply: (input: { levelIndex: number; onCollapse: OnCollapse }) => void;
}

export function RemoveLevelDialog({
  open,
  onOpenChange,
  doc,
  versionId,
  role,
  levels,
  otherTuples,
  levelIndex,
  onApply,
}: RemoveLevelDialogProps) {
  const [mode, setMode] = useState<OnCollapse>('KEEP_IF_UNANIMOUS');
  const [typed, setTyped] = useState('');
  const level = levels[levelIndex];

  const { value, error } = usePreview(
    () => previewRemoveLevelOn(doc, { versionId, role, levelIndex, onCollapse: mode }),
    [doc, versionId, role, levelIndex, mode],
  );

  const dropped = value?.preview.droppedCells.length ?? 0;
  const needsTyping = dropped > 0;
  const confirmed = !needsTyping || typed.trim() === (level?.label ?? '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Remover o nível "{level?.label ?? '—'}"</DialogTitle>
          <DialogDescription>
            As combinações desse nível colapsam numa só. Escolha o que acontece com o conteúdo delas.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Quando as células do grupo divergem
            </legend>
            <label className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
              <input
                type="radio"
                name="on-collapse"
                className="mt-0.5"
                checked={mode === 'KEEP_IF_UNANIMOUS'}
                onChange={() => setMode('KEEP_IF_UNANIMOUS')}
              />
              <span>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  Manter só quando houver unanimidade (recomendado)
                </span>
                <span className="block text-neutral-500 dark:text-neutral-400">
                  Grupos com conteúdo idêntico são preservados; grupos divergentes ficam vazios e voltam a pendentes.
                  Nada é escolhido no seu lugar.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
              <input
                type="radio"
                name="on-collapse"
                className="mt-0.5"
                checked={mode === 'KEEP_FIRST'}
                onChange={() => setMode('KEEP_FIRST')}
              />
              <span>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">Manter a primeira</span>
                <span className="block text-neutral-500 dark:text-neutral-400">
                  Vence o conteúdo da primeira combinação do grupo, na ordem do grid. O conteúdo das demais é
                  descartado.
                </span>
              </span>
            </label>
          </fieldset>

          {error !== null && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {value !== null && (
            <div className="flex flex-col gap-2 rounded-md bg-neutral-50 p-2 dark:bg-neutral-900" data-testid="remove-level-preview">
              <ImpactLine
                before={value.preview.before.combinations}
                after={value.preview.after.combinations}
                unit="combinações"
              />
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                {plural(dropped, 'célula será descartada', 'células serão descartadas')}.
              </p>
              {value.preview.divergentCells > 0 && (
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  {plural(value.preview.divergentCells, 'grupo tem', 'grupos têm')} conteúdo divergente
                  {mode === 'KEEP_IF_UNANIMOUS' ? ' e ficarão vazios' : ' e perderão o conteúdo das demais'}.
                </p>
              )}
              {value.preview.droppedSuppressions.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {plural(value.preview.droppedSuppressions.length, 'supressão manual deixa', 'supressões manuais deixam')} de
                  existir: o caminho suprimido não tem mais identidade própria.
                </p>
              )}
              <GridMiniature
                xBefore={role === 'X' ? value.tuplesBefore : otherTuples}
                xAfter={role === 'X' ? value.tuplesAfter : otherTuples}
                yBefore={role === 'Y' ? value.tuplesBefore : otherTuples}
                yAfter={role === 'Y' ? value.tuplesAfter : otherTuples}
              />
            </div>
          )}

          {needsTyping && (
            <div className="flex flex-col gap-1">
              <Label className="text-xs" htmlFor="confirm-remove-level">
                Para confirmar o descarte, digite o nome do nível: <strong>{level?.label}</strong>
              </Label>
              <Input
                id="confirm-remove-level"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={level?.label}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={value === null || !confirmed}
            onClick={() => onApply({ levelIndex, onCollapse: mode })}
          >
            Remover nível
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reordenar níveis (só quando o conjunto de tuplas muda)
// ---------------------------------------------------------------------------

export interface ReorderLevelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: PolicyOpsDocument;
  versionId: string;
  role: AxisRole;
  levels: AxisLevel[];
  otherTuples: string[];
  from: number;
  to: number;
  onApply: () => void;
}

export function ReorderLevelsDialog({
  open,
  onOpenChange,
  doc,
  versionId,
  role,
  levels,
  otherTuples,
  from,
  to,
  onApply,
}: ReorderLevelsDialogProps) {
  const { value, error } = usePreview(
    () => previewReorderLevelsOn(doc, { versionId, role, from, to }),
    [doc, versionId, role, from, to],
  );

  // Depois da troca a ordem dos níveis muda, e com ela a leitura dos caminhos.
  const reordered = useMemo(() => {
    const next = [...levels];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    return next;
  }, [levels, from, to]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reordenar níveis do {ROLE_LABEL[role]}</DialogTitle>
          <DialogDescription>
            A compatibilidade é direcional: invertendo os níveis, a regra aplicável muda — e com ela o conjunto de
            combinações.
          </DialogDescription>
        </DialogHeader>

        {error !== null && (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {value !== null && (
          <div className="flex flex-col gap-2" data-testid="reorder-preview">
            <ImpactLine
              before={value.preview.before.combinations}
              after={value.preview.after.combinations}
              unit="combinações"
            />
            {value.preview.addedTuples.length > 0 && (
              <div className="text-xs">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  Entram ({value.preview.addedTuples.length}):
                </span>
                <ul className="mt-0.5 flex flex-col gap-0.5 text-neutral-500 dark:text-neutral-400">
                  {value.preview.addedTuples.slice(0, 10).map((path) => (
                    <li key={path}>{readableTuple(reordered, path)}</li>
                  ))}
                </ul>
              </div>
            )}
            {value.preview.removedTuples.length > 0 && (
              <div className="text-xs">
                <span className="font-medium text-red-700 dark:text-red-400">
                  Saem ({value.preview.removedTuples.length}):
                </span>
                <ul className="mt-0.5 flex flex-col gap-0.5 text-red-600 line-through dark:text-red-400">
                  {value.preview.removedTuples.slice(0, 10).map((path) => (
                    <li key={path}>{readableTuple(reordered, path)}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {plural(value.preview.droppedCells.length, 'célula será descartada', 'células serão descartadas')}.
            </p>
            <GridMiniature
              xBefore={role === 'X' ? value.tuplesBefore : otherTuples}
              xAfter={role === 'X' ? value.tuplesAfter : otherTuples}
              yBefore={role === 'Y' ? value.tuplesBefore : otherTuples}
              yAfter={role === 'Y' ? value.tuplesAfter : otherTuples}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={value === null} onClick={onApply}>
            Reordenar mesmo assim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
