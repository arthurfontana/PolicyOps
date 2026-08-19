import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Paperclip, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PasteRuleDialog } from '@/components/inspector/PasteRuleDialog';
import { cn } from '@/lib/utils';
import type {
  ComponentPayload,
  ListPayload,
  OtherPayload,
  PolicyVariablePayload,
  ReasonCodePayload,
  RulePayload,
} from '@/core/document/schema';
import type { RulePasteRecognition } from '@/core/versioning/rule-paste';

/**
 * Formulário de payload por tipo — docs/07-ux-e-editor.md §17.5,
 * docs/14-governanca-de-alteracoes.md §3.2. Um componente por `kind`, todos
 * com o mesmo padrão de commit: campo controlado localmente, `onBlur` chama
 * `onChange` com o payload inteiro reconstruído. O pai monta esta peça com
 * `key={version.id}` — trocar de versão remonta o formulário em vez de
 * arrastar estado de edição de uma versão para outra.
 *
 * `layout` (docs/07 §17.5): `'narrow'` (default, o inspector antigo de
 * 340px) empilha tudo numa coluna; `'wide'` (a página do componente) faz
 * campos longos ocuparem a largura inteira com no mínimo 6 linhas visíveis
 * e crescendo com o conteúdo, e pareia campos curtos 2 por linha.
 *
 * Campos de lista (`inputs`, `reasonCodes`, `dependencies`) são chips —
 * `Enter` ou vírgula adiciona, `Backspace` no campo vazio remove o último,
 * colar texto com vírgulas vira N chips — em qualquer layout. `fields` do
 * `LIST` continua texto separado por vírgula (fora do escopo da S42). O
 * valor persistido continua `string[]`, igual ao formato antigo.
 */

export type ComponentPayloadFieldsLayout = 'wide' | 'narrow';

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function joinList(values: string[] | undefined): string {
  return (values ?? []).join(', ');
}

/** Omite campo vazio em vez de gravar string vazia — os payloads não aceitam `min(1)` vazio. */
function optionalField<T extends Record<string, unknown>>(target: T, key: keyof T, value: string): void {
  const trimmed = value.trim();
  if (trimmed.length > 0) target[key] = trimmed as T[typeof key];
}

function optionalListField<T extends Record<string, unknown>>(target: T, key: keyof T, value: string): void {
  const list = splitList(value);
  if (list.length > 0) target[key] = list as T[typeof key];
}

function optionalListValue<T extends Record<string, unknown>>(target: T, key: keyof T, value: string[]): void {
  if (value.length > 0) target[key] = value as T[typeof key];
}

export interface ComponentPayloadFieldsProps {
  payload: ComponentPayload;
  editable: boolean;
  onChange: (payload: ComponentPayload) => void;
  layout?: ComponentPayloadFieldsLayout;
}

export function ComponentPayloadFields({ payload, editable, onChange, layout = 'narrow' }: ComponentPayloadFieldsProps) {
  switch (payload.kind) {
    case 'RULE':
      return <RuleFields payload={payload} editable={editable} onChange={onChange} layout={layout} />;
    case 'LIST':
      return <ListFields payload={payload} editable={editable} onChange={onChange} layout={layout} />;
    case 'REASON_CODE':
      return <ReasonCodeFields payload={payload} editable={editable} onChange={onChange} layout={layout} />;
    case 'POLICY_VARIABLE':
      return <PolicyVariableFields payload={payload} editable={editable} onChange={onChange} layout={layout} />;
    case 'OTHER':
      return <OtherFields payload={payload} editable={editable} onChange={onChange} layout={layout} />;
  }
}

/** Contêiner dos campos: pilha vertical no `narrow`, grade de 2 colunas no `wide` (campo `full` ocupa as duas). */
function FieldsLayout({ layout, children }: { layout: ComponentPayloadFieldsLayout; children: ReactNode }) {
  if (layout === 'narrow') return <div className="flex flex-col gap-2.5">{children}</div>;
  return <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 sm:grid-cols-2">{children}</div>;
}

/** `Textarea` que cresce com o conteúdo, sem nunca ficar abaixo de `rows` linhas visíveis (docs/07 §17.5/§21). */
function AutoGrowTextarea({
  value,
  rows = 6,
  className,
  ...props
}: ComponentProps<typeof Textarea>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <Textarea
      ref={ref}
      rows={rows}
      value={value}
      className={cn('resize-none overflow-hidden', className)}
      {...props}
    />
  );
}

/** Campo texto longo: `Textarea` de 2 linhas no `narrow`; largura inteira e ≥6 linhas crescentes no `wide`. */
function LongTextField({
  layout,
  rowsNarrow = 2,
  ...props
}: ComponentProps<typeof Textarea> & { layout: ComponentPayloadFieldsLayout; rowsNarrow?: number }) {
  if (layout === 'wide') return <AutoGrowTextarea rows={6} {...props} />;
  return <Textarea rows={rowsNarrow} {...props} />;
}

/**
 * Editor de chips (docs/07 §17.5): `Enter` ou vírgula adiciona, `Backspace`
 * no campo vazio remove o último chip, colar texto com vírgulas vira N
 * chips de uma vez. O valor persistido é `string[]`, igual ao formato
 * antigo de texto separado por vírgula.
 */
function ChipsField({
  id,
  value,
  editable,
  onChange,
  placeholder,
}: {
  id: string;
  value: string[];
  editable: boolean;
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  function addFromText(text: string) {
    const parts = splitList(text);
    if (parts.length === 0) return;
    onChange([...value, ...parts]);
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div
      className={cn(
        'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2 py-1.5 dark:border-neutral-800 dark:bg-neutral-950',
        !editable && 'bg-neutral-50 dark:bg-neutral-900',
      )}
    >
      {value.map((chip, index) => (
        <Badge key={`${chip}-${index}`} variant="secondary" className="gap-1 pr-1">
          <span>{chip}</span>
          {editable && (
            <button
              type="button"
              aria-label={`Remover ${chip}`}
              onClick={() => removeAt(index)}
              className="rounded-full p-0.5 hover:bg-neutral-300/60 dark:hover:bg-neutral-700"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </Badge>
      ))}
      {editable && (
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addFromText(draft);
              setDraft('');
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              removeAt(value.length - 1);
            }
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (!text.includes(',')) return;
            e.preventDefault();
            addFromText(text);
            setDraft('');
          }}
          onBlur={() => {
            if (draft.trim().length === 0) return;
            addFromText(draft);
            setDraft('');
          }}
          placeholder={value.length === 0 ? placeholder : undefined}
          className="min-w-[80px] flex-1 border-0 bg-transparent p-0.5 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-600"
        />
      )}
      {!editable && value.length === 0 && <span className="text-sm text-neutral-400 dark:text-neutral-600">—</span>}
    </div>
  );
}

function RuleFields({
  payload,
  editable,
  onChange,
  layout,
}: {
  payload: RulePayload;
  editable: boolean;
  onChange: (payload: RulePayload) => void;
  layout: ComponentPayloadFieldsLayout;
}) {
  const [businessDescription, setBusinessDescription] = useState(payload.businessDescription);
  const [technicalDefinition, setTechnicalDefinition] = useState(payload.technicalDefinition ?? '');
  const [inputs, setInputs] = useState<string[]>(payload.inputs ?? []);
  const [conditions, setConditions] = useState(payload.conditions ?? '');
  const [outcome, setOutcome] = useState(payload.outcome ?? '');
  const [reasonCodes, setReasonCodes] = useState<string[]>(payload.reasonCodes ?? []);
  const [dependencies, setDependencies] = useState<string[]>(payload.dependencies ?? []);
  const [notes, setNotes] = useState(payload.notes ?? '');
  const [pasteOpen, setPasteOpen] = useState(false);

  function commit(
    overrides: Partial<{
      businessDescription: string;
      technicalDefinition: string;
      inputs: string[];
      outcome: string;
      reasonCodes: string[];
      dependencies: string[];
      notes: string;
    }> = {},
  ) {
    const nextBusinessDescription = overrides.businessDescription ?? businessDescription;
    if (nextBusinessDescription.trim().length === 0) return;
    const next: RulePayload = { kind: 'RULE', businessDescription: nextBusinessDescription.trim() };
    optionalField(next, 'technicalDefinition', overrides.technicalDefinition ?? technicalDefinition);
    optionalField(next, 'conditions', conditions);
    optionalField(next, 'outcome', overrides.outcome ?? outcome);
    optionalField(next, 'notes', overrides.notes ?? notes);
    optionalListValue(next, 'inputs', overrides.inputs ?? inputs);
    optionalListValue(next, 'reasonCodes', overrides.reasonCodes ?? reasonCodes);
    optionalListValue(next, 'dependencies', overrides.dependencies ?? dependencies);
    onChange(next);
  }

  function applyPaste(recognition: RulePasteRecognition) {
    setBusinessDescription(recognition.businessDescription);
    if (recognition.technicalDefinition !== undefined) setTechnicalDefinition(recognition.technicalDefinition);
    if (recognition.reasonCodes !== undefined) setReasonCodes(recognition.reasonCodes);
    if (recognition.outcome !== undefined) setOutcome(recognition.outcome);
    if (recognition.notes !== undefined) setNotes(recognition.notes);
    commit({
      businessDescription: recognition.businessDescription,
      technicalDefinition: recognition.technicalDefinition,
      reasonCodes: recognition.reasonCodes,
      outcome: recognition.outcome,
      notes: recognition.notes,
    });
  }

  return (
    <FieldsLayout layout={layout}>
      {editable && (
        <Button type="button" variant="outline" size="sm" className="w-fit sm:col-span-2" onClick={() => setPasteOpen(true)}>
          <Paperclip className="mr-1.5 h-3.5 w-3.5" /> Colar bloco de texto
        </Button>
      )}
      <Field id="payload-rule-business-description" label="Descrição de negócio" required full>
        <LongTextField
          layout={layout}
          value={businessDescription}
          disabled={!editable}
          onChange={(e) => setBusinessDescription(e.target.value)}
          onBlur={() => commit()}
        />
      </Field>
      <Field id="payload-rule-technical-definition" label="Definição técnica">
        <Input
          value={technicalDefinition}
          disabled={!editable}
          onChange={(e) => setTechnicalDefinition(e.target.value)}
          onBlur={() => commit()}
          placeholder="Aging > 0 e Valor >= 5000"
        />
      </Field>
      <Field id="payload-rule-outcome" label="Resultado">
        <Input
          value={outcome}
          disabled={!editable}
          onChange={(e) => setOutcome(e.target.value)}
          onBlur={() => commit()}
          placeholder="Aprovar / Reprovar / Derivar p/ Mesa / Continuar"
        />
      </Field>
      <Field id="payload-rule-inputs" label="Entradas">
        <ChipsField
          id="payload-rule-inputs"
          value={inputs}
          editable={editable}
          onChange={(next) => {
            setInputs(next);
            commit({ inputs: next });
          }}
        />
      </Field>
      <Field id="payload-rule-reason-codes" label="Reason codes">
        <ChipsField
          id="payload-rule-reason-codes"
          value={reasonCodes}
          editable={editable}
          placeholder="DV01"
          onChange={(next) => {
            setReasonCodes(next);
            commit({ reasonCodes: next });
          }}
        />
      </Field>
      <Field id="payload-rule-conditions" label="Condições" full>
        <LongTextField
          layout={layout}
          value={conditions}
          disabled={!editable}
          onChange={(e) => setConditions(e.target.value)}
          onBlur={() => commit()}
        />
      </Field>
      <Field id="payload-rule-dependencies" label="Dependências (codes)">
        <ChipsField
          id="payload-rule-dependencies"
          value={dependencies}
          editable={editable}
          onChange={(next) => {
            setDependencies(next);
            commit({ dependencies: next });
          }}
        />
      </Field>
      <Field id="payload-rule-notes" label="Notas" full>
        <LongTextField
          layout={layout}
          value={notes}
          disabled={!editable}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => commit()}
        />
      </Field>
      <PasteRuleDialog open={pasteOpen} onOpenChange={setPasteOpen} onApply={applyPaste} />
    </FieldsLayout>
  );
}

function ListFields({
  payload,
  editable,
  onChange,
  layout,
}: {
  payload: ListPayload;
  editable: boolean;
  onChange: (payload: ListPayload) => void;
  layout: ComponentPayloadFieldsLayout;
}) {
  const [businessDescription, setBusinessDescription] = useState(payload.businessDescription);
  const [purpose, setPurpose] = useState(payload.purpose ?? '');
  const [fields, setFields] = useState(joinList(payload.fields));
  const [notes, setNotes] = useState(payload.notes ?? '');

  function commit() {
    if (businessDescription.trim().length === 0) return;
    const next: ListPayload = { kind: 'LIST', businessDescription: businessDescription.trim() };
    optionalField(next, 'purpose', purpose);
    optionalField(next, 'notes', notes);
    optionalListField(next, 'fields', fields);
    onChange(next);
  }

  return (
    <FieldsLayout layout={layout}>
      <Field id="payload-list-business-description" label="Descrição de negócio" required full>
        <LongTextField layout={layout} value={businessDescription} disabled={!editable} onChange={(e) => setBusinessDescription(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-list-purpose" label="Finalidade">
        <Input value={purpose} disabled={!editable} onChange={(e) => setPurpose(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-list-fields" label="Campos (separados por vírgula)">
        <Input value={fields} disabled={!editable} onChange={(e) => setFields(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-list-notes" label="Notas" full>
        <LongTextField layout={layout} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} onBlur={commit} />
      </Field>
    </FieldsLayout>
  );
}

function ReasonCodeFields({
  payload,
  editable,
  onChange,
  layout,
}: {
  payload: ReasonCodePayload;
  editable: boolean;
  onChange: (payload: ReasonCodePayload) => void;
  layout: ComponentPayloadFieldsLayout;
}) {
  const [businessDescription, setBusinessDescription] = useState(payload.businessDescription);
  const [code, setCode] = useState(payload.code ?? '');
  const [decision, setDecision] = useState(payload.decision ?? '');
  const [message, setMessage] = useState(payload.message ?? '');
  const [notes, setNotes] = useState(payload.notes ?? '');

  function commit() {
    if (businessDescription.trim().length === 0) return;
    const next: ReasonCodePayload = { kind: 'REASON_CODE', businessDescription: businessDescription.trim() };
    optionalField(next, 'code', code);
    optionalField(next, 'decision', decision);
    optionalField(next, 'message', message);
    optionalField(next, 'notes', notes);
    onChange(next);
  }

  return (
    <FieldsLayout layout={layout}>
      <Field id="payload-reason-code-business-description" label="Descrição de negócio" required full>
        <LongTextField layout={layout} value={businessDescription} disabled={!editable} onChange={(e) => setBusinessDescription(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-reason-code-code" label="Código">
        <Input value={code} disabled={!editable} onChange={(e) => setCode(e.target.value)} onBlur={commit} placeholder="DV01" />
      </Field>
      <Field id="payload-reason-code-decision" label="Decisão">
        <Input value={decision} disabled={!editable} onChange={(e) => setDecision(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-reason-code-message" label="Mensagem">
        <Input value={message} disabled={!editable} onChange={(e) => setMessage(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-reason-code-notes" label="Notas" full>
        <LongTextField layout={layout} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} onBlur={commit} />
      </Field>
    </FieldsLayout>
  );
}

function PolicyVariableFields({
  payload,
  editable,
  onChange,
  layout,
}: {
  payload: PolicyVariablePayload;
  editable: boolean;
  onChange: (payload: PolicyVariablePayload) => void;
  layout: ComponentPayloadFieldsLayout;
}) {
  const [businessDescription, setBusinessDescription] = useState(payload.businessDescription);
  const [technicalName, setTechnicalName] = useState(payload.technicalName ?? '');
  const [source, setSource] = useState(payload.source ?? '');
  const [domainDescription, setDomainDescription] = useState(payload.domainDescription ?? '');
  const [notes, setNotes] = useState(payload.notes ?? '');

  function commit() {
    if (businessDescription.trim().length === 0) return;
    const next: PolicyVariablePayload = { kind: 'POLICY_VARIABLE', businessDescription: businessDescription.trim() };
    optionalField(next, 'technicalName', technicalName);
    optionalField(next, 'source', source);
    optionalField(next, 'domainDescription', domainDescription);
    optionalField(next, 'notes', notes);
    onChange(next);
  }

  return (
    <FieldsLayout layout={layout}>
      <Field id="payload-variable-business-description" label="Descrição de negócio" required full>
        <LongTextField layout={layout} value={businessDescription} disabled={!editable} onChange={(e) => setBusinessDescription(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-variable-technical-name" label="Nome técnico">
        <Input value={technicalName} disabled={!editable} onChange={(e) => setTechnicalName(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-variable-source" label="Origem">
        <Input value={source} disabled={!editable} onChange={(e) => setSource(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-variable-domain-description" label="Domínio (descritivo)" full>
        <LongTextField layout={layout} value={domainDescription} disabled={!editable} onChange={(e) => setDomainDescription(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-variable-notes" label="Notas" full>
        <LongTextField layout={layout} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} onBlur={commit} />
      </Field>
    </FieldsLayout>
  );
}

function OtherFields({
  payload,
  editable,
  onChange,
  layout,
}: {
  payload: OtherPayload;
  editable: boolean;
  onChange: (payload: OtherPayload) => void;
  layout: ComponentPayloadFieldsLayout;
}) {
  const [businessDescription, setBusinessDescription] = useState(payload.businessDescription);
  const [notes, setNotes] = useState(payload.notes ?? '');

  function commit() {
    if (businessDescription.trim().length === 0) return;
    const next: OtherPayload = { kind: 'OTHER', businessDescription: businessDescription.trim() };
    optionalField(next, 'notes', notes);
    onChange(next);
  }

  return (
    <FieldsLayout layout={layout}>
      <Field id="payload-other-business-description" label="Descrição de negócio" required full>
        <LongTextField layout={layout} rowsNarrow={3} value={businessDescription} disabled={!editable} onChange={(e) => setBusinessDescription(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-other-notes" label="Notas" full>
        <LongTextField layout={layout} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} onBlur={commit} />
      </Field>
    </FieldsLayout>
  );
}

function Field({
  id,
  label,
  required,
  full,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  full?: boolean;
  children: ReactElement<{ id?: string }>;
}) {
  return (
    <div className={cn('flex flex-col gap-1', full === true && 'sm:col-span-2')}>
      <Label htmlFor={id} className="text-xs">
        {label}
        {required === true && <span className="text-red-500"> *</span>}
      </Label>
      {isValidElement(children) ? cloneElement(children, { id }) : children}
    </div>
  );
}
