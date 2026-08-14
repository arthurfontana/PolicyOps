import { useMemo, useState } from 'react';
import { ArrowLeft, Archive, GripVertical, Plus, TriangleAlert, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { AxisBuilder, type AxisPreview } from '@/components/editor/axis-builder';
import { ConfirmDialog } from '@/components/library/ConfirmDialog';
import { TemplateGridPreview } from './TemplateGridPreview';
import { CODE_REGEX, COLOR_REGEX } from '@/core/document/schema';
import type { CatalogItemKind, Domain, PolicyOpsDocument, SeedRule, Template } from '@/core/document/schema';
import { archiveTemplate, createTemplate, updateTemplate } from '@/core/templates/commands';
import { resolveTemplateAxes } from '@/core/templates/preview';
import { buildSeedCells, type SkippedSeedRule } from '@/core/templates/seed';
import type { ExtractedTemplateSeed } from '@/core/templates/extract';
import { DomainError } from '@/core/errors';
import { useDocumentStore } from '@/store/document-store';

/**
 * Editor de template — docs/07-ux-e-editor.md §11: eixos com o `axis-builder`
 * da S09, construtor de regras (reordenável por drag, a última vencendo) e
 * preview ao vivo do grid resultante.
 */

export interface TemplateEditorProps {
  template: Template | null;
  seed?: ExtractedTemplateSeed;
  onBack: () => void;
  onSaved: (templateId: string) => void;
}

type RuleRow = {
  key: string;
  x: Array<string | null>;
  y: Array<string | null>;
  decision: string;
  offer: string;
  limit: string;
  color: string;
};

const EMPTY_PREVIEW: AxisPreview = { tupleCount: 0, warnings: [], error: null };
const ANY_VALUE = '__any__';
const NONE_VALUE = '__none__';

// #region: helpers-de-linha-e-regra

function normalizeMatcher(matcher: Array<string | null> | undefined, length: number): Array<string | null> {
  const arr = matcher !== undefined ? [...matcher] : [];
  while (arr.length < length) arr.push(null);
  return arr.slice(0, length);
}

function compactMatcher(arr: Array<string | null>): Array<string | null> | undefined {
  return arr.every((value) => value === null) ? undefined : arr;
}

let rowSeq = 0;
function newRowKey(): string {
  rowSeq += 1;
  return `row-${rowSeq}`;
}

function rowFromSeedRule(rule: SeedRule, xLevels: number, yLevels: number): RuleRow {
  return {
    key: newRowKey(),
    x: normalizeMatcher(rule.when.x, xLevels),
    y: normalizeMatcher(rule.when.y, yLevels),
    decision: rule.set.decision ?? '',
    offer: rule.set.offer ?? '',
    limit: rule.set.limit ?? '',
    color: rule.set.color ?? '',
  };
}

function seedRuleFromRow(row: RuleRow): SeedRule {
  const when: SeedRule['when'] = {};
  const x = compactMatcher(row.x);
  const y = compactMatcher(row.y);
  if (x !== undefined) when.x = x;
  if (y !== undefined) when.y = y;
  const set: SeedRule['set'] = {};
  if (row.decision !== '') set.decision = row.decision;
  if (row.offer !== '') set.offer = row.offer;
  if (row.limit !== '') set.limit = row.limit;
  if (row.color !== '') set.color = row.color;
  return { when, set };
}

function publishedDomains(doc: PolicyOpsDocument, variableId: string): Domain[] {
  const variable = doc.variables.find((candidate) => candidate.id === variableId);
  const published = variable?.versions.find((candidate) => candidate.state === 'PUBLISHED');
  return published?.domains ?? [];
}

function catalogOptions(doc: PolicyOpsDocument, kind: CatalogItemKind): Array<{ code: string; label: string }> {
  return doc.catalog
    .filter((item) => item.kind === kind && item.archivedAt === undefined)
    .map((item) => ({ code: item.code, label: item.label }));
}

// #region: componentes-de-selecao-reutilizaveis

function MatcherSelect({
  domains,
  value,
  onChange,
  ariaLabel,
}: {
  domains: Domain[];
  value: string | null;
  onChange: (value: string | null) => void;
  ariaLabel: string;
}) {
  return (
    <Select value={value ?? ANY_VALUE} onValueChange={(next) => onChange(next === ANY_VALUE ? null : next)}>
      <SelectTrigger aria-label={ariaLabel} className="h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY_VALUE}>Qualquer</SelectItem>
        {domains.map((domain) => (
          <SelectItem key={domain.code} value={domain.code}>
            {domain.shortLabel ?? domain.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SetSelect({
  options,
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  options: Array<{ code: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  return (
    <Select value={value === '' ? NONE_VALUE : value} onValueChange={(next) => onChange(next === NONE_VALUE ? '' : next)}>
      <SelectTrigger aria-label={ariaLabel} className="h-8 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>— não definir —</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.code} value={option.code}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// #region: template-editor

export function TemplateEditor({ template, seed, onBack, onSaved }: TemplateEditorProps) {
  const doc = useDocumentStore((s) => s.document);
  const dispatch = useDocumentStore((s) => s.dispatch);
  const { toast } = useToast();

  const isNew = template === null;
  const [code, setCode] = useState(template?.code ?? '');
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [xVariableIds, setXVariableIds] = useState<string[]>(
    (template?.axes.x.levels ?? seed?.axes.x.levels ?? []).map((level) => level.variableId),
  );
  const [yVariableIds, setYVariableIds] = useState<string[]>(
    (template?.axes.y.levels ?? seed?.axes.y.levels ?? []).map((level) => level.variableId),
  );
  const [defaultDecision, setDefaultDecision] = useState(template?.defaults?.decision ?? seed?.defaults?.decision ?? '');
  const [defaultOffer, setDefaultOffer] = useState(template?.defaults?.offer ?? seed?.defaults?.offer ?? '');
  const [defaultLimit, setDefaultLimit] = useState(template?.defaults?.limit ?? seed?.defaults?.limit ?? '');
  const [rows, setRows] = useState<RuleRow[]>(() =>
    (template?.seedRules ?? []).map((rule) => rowFromSeedRule(rule, xVariableIds.length, yVariableIds.length)),
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [xPreview, setXPreview] = useState<AxisPreview>(EMPTY_PREVIEW);
  const [yPreview, setYPreview] = useState<AxisPreview>(EMPTY_PREVIEW);
  const [archiveConfirm, setArchiveConfirm] = useState(false);

  const xDomains = useMemo(
    () => xVariableIds.map((id) => (doc === null ? [] : publishedDomains(doc, id))),
    [doc, xVariableIds],
  );
  const yDomains = useMemo(
    () => yVariableIds.map((id) => (doc === null ? [] : publishedDomains(doc, id))),
    [doc, yVariableIds],
  );

  const decisionOptions = useMemo(() => (doc === null ? [] : catalogOptions(doc, 'DECISION')), [doc]);
  const offerOptions = useMemo(() => (doc === null ? [] : catalogOptions(doc, 'OFFER')), [doc]);
  const limitOptions = useMemo(() => (doc === null ? [] : catalogOptions(doc, 'LIMIT')), [doc]);

  const defaults = useMemo(() => {
    const value: Template['defaults'] = {};
    if (defaultDecision !== '') value.decision = defaultDecision;
    if (defaultOffer !== '') value.offer = defaultOffer;
    if (defaultLimit !== '') value.limit = defaultLimit;
    return Object.keys(value).length > 0 ? value : undefined;
  }, [defaultDecision, defaultOffer, defaultLimit]);

  const seedRules = useMemo(() => rows.map(seedRuleFromRow), [rows]);

  type PreviewState = {
    xTuples: string[];
    yTuples: string[];
    cells: ReturnType<typeof buildSeedCells>['cells'];
    combinations: number;
    filledCount: number;
    skippedRules: SkippedSeedRule[];
    error: string | null;
  };

  const preview = useMemo<PreviewState>(() => {
    if (doc === null || xVariableIds.length === 0 || yVariableIds.length === 0) {
      return { xTuples: [], yTuples: [], cells: {}, combinations: 0, filledCount: 0, skippedRules: [], error: null };
    }
    try {
      const draftTemplate: Template = {
        id: 'preview',
        code: code || 'PREVIEW',
        name: name || 'Preview',
        axes: {
          x: { levels: xVariableIds.map((variableId) => ({ variableId })) },
          y: { levels: yVariableIds.map((variableId) => ({ variableId })) },
        },
        seedRules,
        createdAt: '',
      };
      const axes = resolveTemplateAxes(doc, draftTemplate);
      const seeded = buildSeedCells({
        xTuples: axes.x.tuples,
        yTuples: axes.y.tuples,
        defaults,
        seedRules,
        catalog: doc.catalog,
      });
      const combinations = axes.x.tuples.length * axes.y.tuples.length;
      const filledCount = Object.values(seeded.cells).filter((cell) => cell.decision !== undefined).length;
      return {
        xTuples: axes.x.tuples,
        yTuples: axes.y.tuples,
        cells: seeded.cells,
        combinations,
        filledCount,
        skippedRules: seeded.skippedRules,
        error: null,
      };
    } catch (error) {
      const message = error instanceof DomainError ? error.message : 'Não foi possível calcular o preview.';
      return { xTuples: [], yTuples: [], cells: {}, combinations: 0, filledCount: 0, skippedRules: [], error: message };
    }
  }, [doc, code, name, xVariableIds, yVariableIds, seedRules, defaults]);

  if (doc === null) return null;

  const codeError = code.trim() === '' ? null : CODE_REGEX.test(code) ? null : 'O código só pode ter letras maiúsculas, números e "_".';
  const axesReady = xVariableIds.length > 0 && yVariableIds.length > 0 && xPreview.error === null && yPreview.error === null;
  const canSave = name.trim() !== '' && code.trim() !== '' && codeError === null && axesReady;

  // #region: handlers-de-regras-e-salvamento
  function addRule() {
    setRows((prev) => [
      ...prev,
      { key: newRowKey(), x: normalizeMatcher(undefined, xVariableIds.length), y: normalizeMatcher(undefined, yVariableIds.length), decision: '', offer: '', limit: '', color: '' },
    ]);
  }

  function updateRow(index: number, patch: Partial<RuleRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function moveRow(from: number, to: number) {
    if (from === to) return;
    setRows((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
  }

  function handleSave() {
    const axes: Template['axes'] = {
      x: { levels: xVariableIds.map((variableId) => ({ variableId })) },
      y: { levels: yVariableIds.map((variableId) => ({ variableId })) },
    };
    if (isNew) {
      const result = dispatch(
        createTemplate({
          code: code.trim(),
          name: name.trim(),
          ...(description.trim() !== '' ? { description: description.trim() } : {}),
          axes,
          ...(defaults !== undefined ? { defaults } : {}),
          seedRules,
        }),
      );
      if (!result.ok) {
        toast({ title: 'Não foi possível criar o template', description: result.error.message });
        return;
      }
      toast({ title: 'Template criado', description: `"${name.trim()}" já pode ser usado para criar matrizes.` });
      onSaved(result.data.templateId);
      return;
    }

    const result = dispatch(
      updateTemplate({
        templateId: template.id,
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        axes,
        defaults: defaults ?? null,
        seedRules,
      }),
    );
    if (!result.ok) {
      toast({ title: 'Não foi possível salvar o template', description: result.error.message });
      return;
    }
    toast({ title: 'Template salvo' });
    onSaved(template.id);
  }

  function handleArchive() {
    if (template === null) return;
    const result = dispatch(archiveTemplate({ templateId: template.id }));
    if (!result.ok) {
      toast({ title: 'Não foi possível arquivar', description: result.error.message });
      return;
    }
    toast({ title: 'Template arquivado' });
    onBack();
  }

  // #region: jsx-formulario-e-preview
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-8">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon" aria-label="Voltar" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          {isNew ? 'Novo template' : `Editar template`}
        </h1>
        {!isNew && template.archivedAt !== undefined && <Badge variant="outline">arquivado</Badge>}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-name">Nome</Label>
            <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Limite PJ segmentado" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-code">Código</Label>
            <Input
              id="template-code"
              value={code}
              disabled={!isNew}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="TPL_PJ_SEGMENTADO"
            />
            {codeError !== null && <p className="text-xs text-red-600 dark:text-red-400">{codeError}</p>}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="template-description">Descrição (opcional)</Label>
          <Textarea id="template-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
      </div>

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

      <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Defaults</h3>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">Aplicados a todas as combinações antes das regras.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Decisão</Label>
            <SetSelect options={decisionOptions} value={defaultDecision} onChange={setDefaultDecision} placeholder="—" ariaLabel="Decisão padrão" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Oferta</Label>
            <SetSelect options={offerOptions} value={defaultOffer} onChange={setDefaultOffer} placeholder="—" ariaLabel="Oferta padrão" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Limite</Label>
            <SetSelect options={limitOptions} value={defaultLimit} onChange={setDefaultLimit} placeholder="—" ariaLabel="Limite padrão" />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Regras</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Cada linha casa um caminho por eixo. Arraste para reordenar — a última regra que casar uma célula vence.
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={addRule} disabled={!axesReady}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar regra
          </Button>
        </div>

        {rows.length === 0 && (
          <p className="rounded-md bg-neutral-50 p-2 text-xs text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
            Nenhuma regra ainda — só os defaults valem.
          </p>
        )}

        <ul className="flex flex-col gap-2" data-testid="seed-rule-list">
          {rows.map((row, index) => (
            <li
              key={row.key}
              draggable
              data-testid="seed-rule-row"
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex !== null) moveRow(dragIndex, index);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-neutral-400" aria-label={`Arrastar regra ${index + 1}`} />
                <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Regra {index + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  aria-label={`Remover regra ${index + 1}`}
                  onClick={() => removeRow(index)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Quando X é</span>
                  <div className="flex flex-wrap gap-1">
                    {xDomains.map((domains, level) => (
                      <MatcherSelect
                        key={level}
                        domains={domains}
                        value={row.x[level] ?? null}
                        ariaLabel={`Regra ${index + 1}: nível ${level} de X`}
                        onChange={(value) => {
                          const next = [...row.x];
                          next[level] = value;
                          updateRow(index, { x: next });
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Quando Y é</span>
                  <div className="flex flex-wrap gap-1">
                    {yDomains.map((domains, level) => (
                      <MatcherSelect
                        key={level}
                        domains={domains}
                        value={row.y[level] ?? null}
                        ariaLabel={`Regra ${index + 1}: nível ${level} de Y`}
                        onChange={(value) => {
                          const next = [...row.y];
                          next[level] = value;
                          updateRow(index, { y: next });
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SetSelect
                  options={decisionOptions}
                  value={row.decision}
                  onChange={(value) => updateRow(index, { decision: value })}
                  placeholder="Decisão"
                  ariaLabel={`Regra ${index + 1}: decisão`}
                />
                <SetSelect
                  options={offerOptions}
                  value={row.offer}
                  onChange={(value) => updateRow(index, { offer: value })}
                  placeholder="Oferta"
                  ariaLabel={`Regra ${index + 1}: oferta`}
                />
                <SetSelect
                  options={limitOptions}
                  value={row.limit}
                  onChange={(value) => updateRow(index, { limit: value })}
                  placeholder="Limite"
                  ariaLabel={`Regra ${index + 1}: limite`}
                />
                <div className="flex items-center gap-1">
                  <input
                    type="color"
                    aria-label={`Regra ${index + 1}: cor`}
                    value={COLOR_REGEX.test(row.color) ? row.color : '#e5e7eb'}
                    onChange={(event) => updateRow(index, { color: event.target.value })}
                    className="h-8 w-8 shrink-0 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700"
                  />
                  {row.color !== '' && (
                    <button
                      type="button"
                      className="text-[11px] text-neutral-400 underline-offset-2 hover:text-neutral-700 hover:underline dark:hover:text-neutral-200"
                      onClick={() => updateRow(index, { color: '' })}
                    >
                      limpar
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Preview</h3>
        {preview.error !== null ? (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>{preview.error}</AlertDescription>
          </Alert>
        ) : (
          <TemplateGridPreview xTuples={preview.xTuples} yTuples={preview.yTuples} cells={preview.cells} />
        )}
        {preview.skippedRules.length > 0 && (
          <Alert>
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>
              {preview.skippedRules.length === 1
                ? '1 regra não pôde ser aplicada'
                : `${preview.skippedRules.length} regras não puderam ser aplicadas`}{' '}
              — {preview.skippedRules[0]!.reason}
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div>
          {!isNew && (
            <Button type="button" variant="outline" onClick={() => setArchiveConfirm(true)} disabled={template.archivedAt !== undefined}>
              <Archive className="mr-1.5 h-4 w-4" /> Arquivar
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onBack}>
            Cancelar
          </Button>
          <Button type="button" disabled={!canSave} onClick={handleSave}>
            {isNew ? 'Criar template' : 'Salvar'}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={archiveConfirm}
        onOpenChange={setArchiveConfirm}
        title="Arquivar template"
        description={`Arquivar "${template?.name ?? ''}"? Ele deixa de aparecer na lista e no assistente de criação de matriz, mas continua existindo para matrizes já criadas a partir dele.`}
        confirmLabel="Arquivar"
        destructive
        onConfirm={handleArchive}
      />
    </div>
  );
}
