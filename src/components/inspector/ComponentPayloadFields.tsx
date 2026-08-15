import { cloneElement, isValidElement, useState, type ReactElement } from 'react';
import { Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PasteRuleDialog } from '@/components/inspector/PasteRuleDialog';
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
 * Campos de lista (`inputs`, `reasonCodes`, `dependencies`, `fields`) são
 * texto separado por vírgula: mais rápido de digitar do que um editor
 * chave-valor para o volume desta sessão (§17.3), e o payload continua
 * `string[]` no documento.
 */

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

export interface ComponentPayloadFieldsProps {
  payload: ComponentPayload;
  editable: boolean;
  onChange: (payload: ComponentPayload) => void;
}

export function ComponentPayloadFields({ payload, editable, onChange }: ComponentPayloadFieldsProps) {
  switch (payload.kind) {
    case 'RULE':
      return <RuleFields payload={payload} editable={editable} onChange={onChange} />;
    case 'LIST':
      return <ListFields payload={payload} editable={editable} onChange={onChange} />;
    case 'REASON_CODE':
      return <ReasonCodeFields payload={payload} editable={editable} onChange={onChange} />;
    case 'POLICY_VARIABLE':
      return <PolicyVariableFields payload={payload} editable={editable} onChange={onChange} />;
    case 'OTHER':
      return <OtherFields payload={payload} editable={editable} onChange={onChange} />;
  }
}

function RuleFields({
  payload,
  editable,
  onChange,
}: {
  payload: RulePayload;
  editable: boolean;
  onChange: (payload: RulePayload) => void;
}) {
  const [businessDescription, setBusinessDescription] = useState(payload.businessDescription);
  const [technicalDefinition, setTechnicalDefinition] = useState(payload.technicalDefinition ?? '');
  const [inputs, setInputs] = useState(joinList(payload.inputs));
  const [conditions, setConditions] = useState(payload.conditions ?? '');
  const [outcome, setOutcome] = useState(payload.outcome ?? '');
  const [reasonCodes, setReasonCodes] = useState(joinList(payload.reasonCodes));
  const [dependencies, setDependencies] = useState(joinList(payload.dependencies));
  const [notes, setNotes] = useState(payload.notes ?? '');
  const [pasteOpen, setPasteOpen] = useState(false);

  function commit(overrides: Partial<Record<'businessDescription' | 'technicalDefinition' | 'reasonCodes' | 'outcome' | 'notes', string>> = {}) {
    const nextBusinessDescription = overrides.businessDescription ?? businessDescription;
    if (nextBusinessDescription.trim().length === 0) return;
    const next: RulePayload = { kind: 'RULE', businessDescription: nextBusinessDescription.trim() };
    optionalField(next, 'technicalDefinition', overrides.technicalDefinition ?? technicalDefinition);
    optionalField(next, 'conditions', conditions);
    optionalField(next, 'outcome', overrides.outcome ?? outcome);
    optionalField(next, 'notes', overrides.notes ?? notes);
    optionalListField(next, 'inputs', inputs);
    optionalListField(next, 'reasonCodes', overrides.reasonCodes ?? reasonCodes);
    optionalListField(next, 'dependencies', dependencies);
    onChange(next);
  }

  function applyPaste(recognition: RulePasteRecognition) {
    setBusinessDescription(recognition.businessDescription);
    if (recognition.technicalDefinition !== undefined) setTechnicalDefinition(recognition.technicalDefinition);
    if (recognition.reasonCodes !== undefined) setReasonCodes(recognition.reasonCodes.join(', '));
    if (recognition.outcome !== undefined) setOutcome(recognition.outcome);
    if (recognition.notes !== undefined) setNotes(recognition.notes);
    commit({
      businessDescription: recognition.businessDescription,
      technicalDefinition: recognition.technicalDefinition,
      reasonCodes: recognition.reasonCodes?.join(', '),
      outcome: recognition.outcome,
      notes: recognition.notes,
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      {editable && (
        <Button type="button" variant="outline" size="sm" onClick={() => setPasteOpen(true)}>
          <Paperclip className="mr-1.5 h-3.5 w-3.5" /> Colar bloco de texto
        </Button>
      )}
      <Field id="payload-rule-business-description" label="Descrição de negócio" required>
        <Textarea
          rows={2}
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
      <Field id="payload-rule-inputs" label="Entradas (separadas por vírgula)">
        <Input value={inputs} disabled={!editable} onChange={(e) => setInputs(e.target.value)} onBlur={() => commit()} />
      </Field>
      <Field id="payload-rule-conditions" label="Condições">
        <Textarea rows={2} value={conditions} disabled={!editable} onChange={(e) => setConditions(e.target.value)} onBlur={() => commit()} />
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
      <Field id="payload-rule-reason-codes" label="Reason codes (separados por vírgula)">
        <Input value={reasonCodes} disabled={!editable} onChange={(e) => setReasonCodes(e.target.value)} onBlur={() => commit()} placeholder="DV01" />
      </Field>
      <Field id="payload-rule-dependencies" label="Dependências (codes, separados por vírgula)">
        <Input value={dependencies} disabled={!editable} onChange={(e) => setDependencies(e.target.value)} onBlur={() => commit()} />
      </Field>
      <Field id="payload-rule-notes" label="Notas">
        <Textarea rows={2} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} onBlur={() => commit()} />
      </Field>
      <PasteRuleDialog open={pasteOpen} onOpenChange={setPasteOpen} onApply={applyPaste} />
    </div>
  );
}

function ListFields({
  payload,
  editable,
  onChange,
}: {
  payload: ListPayload;
  editable: boolean;
  onChange: (payload: ListPayload) => void;
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
    <div className="flex flex-col gap-2.5">
      <Field id="payload-list-business-description" label="Descrição de negócio" required>
        <Textarea rows={2} value={businessDescription} disabled={!editable} onChange={(e) => setBusinessDescription(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-list-purpose" label="Finalidade">
        <Input value={purpose} disabled={!editable} onChange={(e) => setPurpose(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-list-fields" label="Campos (separados por vírgula)">
        <Input value={fields} disabled={!editable} onChange={(e) => setFields(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-list-notes" label="Notas">
        <Textarea rows={2} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} onBlur={commit} />
      </Field>
    </div>
  );
}

function ReasonCodeFields({
  payload,
  editable,
  onChange,
}: {
  payload: ReasonCodePayload;
  editable: boolean;
  onChange: (payload: ReasonCodePayload) => void;
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
    <div className="flex flex-col gap-2.5">
      <Field id="payload-reason-code-business-description" label="Descrição de negócio" required>
        <Textarea rows={2} value={businessDescription} disabled={!editable} onChange={(e) => setBusinessDescription(e.target.value)} onBlur={commit} />
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
      <Field id="payload-reason-code-notes" label="Notas">
        <Textarea rows={2} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} onBlur={commit} />
      </Field>
    </div>
  );
}

function PolicyVariableFields({
  payload,
  editable,
  onChange,
}: {
  payload: PolicyVariablePayload;
  editable: boolean;
  onChange: (payload: PolicyVariablePayload) => void;
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
    <div className="flex flex-col gap-2.5">
      <Field id="payload-variable-business-description" label="Descrição de negócio" required>
        <Textarea rows={2} value={businessDescription} disabled={!editable} onChange={(e) => setBusinessDescription(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-variable-technical-name" label="Nome técnico">
        <Input value={technicalName} disabled={!editable} onChange={(e) => setTechnicalName(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-variable-source" label="Origem">
        <Input value={source} disabled={!editable} onChange={(e) => setSource(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-variable-domain-description" label="Domínio (descritivo)">
        <Textarea rows={2} value={domainDescription} disabled={!editable} onChange={(e) => setDomainDescription(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-variable-notes" label="Notas">
        <Textarea rows={2} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} onBlur={commit} />
      </Field>
    </div>
  );
}

function OtherFields({
  payload,
  editable,
  onChange,
}: {
  payload: OtherPayload;
  editable: boolean;
  onChange: (payload: OtherPayload) => void;
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
    <div className="flex flex-col gap-2.5">
      <Field id="payload-other-business-description" label="Descrição de negócio" required>
        <Textarea rows={3} value={businessDescription} disabled={!editable} onChange={(e) => setBusinessDescription(e.target.value)} onBlur={commit} />
      </Field>
      <Field id="payload-other-notes" label="Notas">
        <Textarea rows={2} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} onBlur={commit} />
      </Field>
    </div>
  );
}

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: ReactElement<{ id?: string }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
        {required === true && <span className="text-red-500"> *</span>}
      </Label>
      {isValidElement(children) ? cloneElement(children, { id }) : children}
    </div>
  );
}
