import { findInlineImage } from '../richdoc/attachments';
import { referencedAttachmentIds } from '../richdoc/model';
import { isChangeRequestFrozen } from '../document/cr-workflow';
import { locateChangeRequest } from '../document/change-requests';
import { DomainError } from '../errors';
import type {
  ChangeRequest,
  ChangeRequestChangeType,
  CrPriority,
  CrStatus,
  InlineImageAttachment,
  PolicyComponentType,
  PolicyOpsDocument,
  Project,
  RichDoc,
} from '../document/schema';

/**
 * Gerador puro do Pacote para a Fábrica — docs/14-governanca-de-alteracoes.md
 * §8, RN-GOV-08, US-GOV-06 (S38).
 *
 * `buildFactoryPackage` monta a **estrutura de dados** do pacote, na ordem
 * normativa do §8: identificação, registro de versão, contatos, boilerplate,
 * contexto, escopo por item (hoje × proposto), impactos, critérios, testes,
 * vigência, anexos. Os dois formatos de saída (HTML de impressão e Markdown)
 * são renderizadores separados (`./factory-package-html.ts`,
 * `./factory-package-markdown.ts`) sobre esta mesma estrutura — o pacote é
 * sempre **derivado**, nunca uma cópia editável (RN-GOV-08): não existe
 * comando que grave isto no documento.
 */

// ---------------------------------------------------------------------------
// Rótulos (cópia própria — `src/core/` não importa `src/lib`, regra 4)
// ---------------------------------------------------------------------------
// #region: rotulos

export const FACTORY_PACKAGE_CHANGE_TYPE_LABELS: Record<ChangeRequestChangeType, string> = {
  UPDATE: 'Atualizar',
  CREATE: 'Criar',
  DEACTIVATE: 'Desativar',
  REACTIVATE: 'Reativar',
  MOVE: 'Mover',
  DOC_ONLY: 'Só documentação',
};

export const FACTORY_PACKAGE_COMPONENT_TYPE_LABELS: Record<PolicyComponentType, string> = {
  SECTION: 'Seção',
  RULE: 'Regra',
  MATRIX: 'Matriz',
  LIST: 'Lista',
  REASON_CODE: 'Reason code',
  POLICY_VARIABLE: 'Variável de política',
  OTHER: 'Outro',
};

export const FACTORY_PACKAGE_STATUS_LABELS: Record<CrStatus, string> = {
  DRAFT: 'Rascunho',
  SUBMITTED: 'Submetido',
  IN_REVIEW: 'Em revisão',
  CHANGES_REQUESTED: 'Devolvido',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  IN_DEVELOPMENT: 'Em desenvolvimento',
  IN_VALIDATION: 'Em validação',
  READY_FOR_RELEASE: 'Pronto para release',
  SCHEDULED: 'Agendado',
  PUBLISHED: 'Publicado',
  CANCELLED: 'Cancelado',
};

export const FACTORY_PACKAGE_PRIORITY_LABELS: Record<CrPriority, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};

const APPROVAL_DECISION_LABELS: Record<string, string> = {
  APPROVED: 'Aprovado',
  RETURNED: 'Devolvido',
  REJECTED: 'Rejeitado',
};

// ---------------------------------------------------------------------------
// Disponibilidade — RN-GOV-08 / docs/14 §4 US-GOV-06
// ---------------------------------------------------------------------------
// #region: disponibilidade

/**
 * O pacote está disponível a partir de `APPROVED` (mesma ordem de
 * `CR_STATUSES` que `isChangeRequestFrozen` já usa para I30) — antes disso o
 * escopo do DB ainda pode mudar de forma incompatível com "documento a
 * enviar para a fábrica".
 */
export function isFactoryPackageAvailable(status: CrStatus): boolean {
  return isChangeRequestFrozen(status);
}

export function assertFactoryPackageAvailable(cr: ChangeRequest): void {
  if (!isFactoryPackageAvailable(cr.status)) {
    throw new DomainError(
      'CR_TRANSITION_INVALID',
      `O pacote para a fábrica do DB "${cr.code}" só pode ser gerado a partir de Aprovado — hoje o DB está em ${FACTORY_PACKAGE_STATUS_LABELS[cr.status]}.`,
      { changeRequestId: cr.id, status: cr.status },
    );
  }
}

// ---------------------------------------------------------------------------
// Estrutura do pacote
// ---------------------------------------------------------------------------
// #region: estrutura

export type FactoryPackageContact = { name: string; role?: string; email?: string };

export type FactoryPackageVersionEntry = {
  at: string;
  by: string;
  action: string;
  comment?: string;
};

export type FactoryPackageItem = {
  componentCode: string;
  componentName: string;
  componentType: PolicyComponentType;
  changeType: ChangeRequestChangeType;
  current: string;
  proposed: string;
};

export type FactoryPackageImpact = { category: string; description?: string };
export type FactoryPackageAcceptanceCriterion = { given: string; when?: string; then: string };
export type FactoryPackageTestScenario = { kind: string; description: string };

export type FactoryPackageAttachmentRef = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  data: string;
  caption?: string;
};

export type FactoryPackage = {
  identification: {
    changeRequestCode: string;
    title: string;
    projectName: string;
    status: CrStatus;
    requestedBy: string;
    owner?: string;
    priority?: CrPriority;
    generatedAt: string;
  };
  versionHistory: FactoryPackageVersionEntry[];
  contacts: FactoryPackageContact[];
  /** `null` = DB sem template de projeto — pacote sai sem seção de boilerplate. */
  boilerplate: RichDoc | null;
  motivators: string[];
  motivationText: RichDoc | null;
  spec: RichDoc | null;
  items: FactoryPackageItem[];
  impacts: FactoryPackageImpact[];
  acceptanceCriteria: FactoryPackageAcceptanceCriterion[];
  testScenarios: FactoryPackageTestScenario[];
  effectiveDate?: string;
  releaseCode?: string;
  releaseName?: string;
  attachments: FactoryPackageAttachmentRef[];
};

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------
// #region: montagem

function projectNameOf(doc: PolicyOpsDocument, cr: ChangeRequest): string {
  const componentId = cr.items[0]?.componentId;
  const component = componentId === undefined ? undefined : doc.components.find((c) => c.id === componentId);
  const project = component === undefined ? undefined : doc.projects.find((p) => p.id === component.projectId);
  return project?.name ?? '—';
}

function factoryTemplateOf(doc: PolicyOpsDocument, cr: ChangeRequest): Project['factoryTemplate'] {
  const componentId = cr.items[0]?.componentId;
  const component = componentId === undefined ? undefined : doc.components.find((c) => c.id === componentId);
  const project = component === undefined ? undefined : doc.projects.find((p) => p.id === component.projectId);
  return project?.factoryTemplate;
}

function versionHistoryOf(cr: ChangeRequest): FactoryPackageVersionEntry[] {
  const entries: FactoryPackageVersionEntry[] = [
    { at: cr.createdAt, by: cr.requestedBy, action: 'Criação do DB' },
  ];
  for (const approval of cr.approvals) {
    const entry: FactoryPackageVersionEntry = {
      at: approval.at,
      by: approval.by,
      action: APPROVAL_DECISION_LABELS[approval.decision] ?? approval.decision,
    };
    if (approval.comment !== undefined) entry.comment = approval.comment;
    entries.push(entry);
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

function motivatorLabelsOf(doc: PolicyOpsDocument, cr: ChangeRequest): string[] {
  return cr.motivators.map((code) => {
    const item = doc.catalog.find((candidate) => candidate.kind === 'MOTIVATOR' && candidate.code === code);
    return item?.label ?? code;
  });
}

function itemsOf(doc: PolicyOpsDocument, cr: ChangeRequest): FactoryPackageItem[] {
  return cr.items.map((item) => {
    const component = doc.components.find((candidate) => candidate.id === item.componentId);
    return {
      componentCode: component?.code ?? item.componentId,
      componentName: component?.name ?? '(componente removido)',
      componentType: component?.type ?? 'OTHER',
      changeType: item.changeType,
      current: item.currentSummary ?? 'Não existe — sem versão vigente registrada.',
      proposed: item.proposedSummary,
    };
  });
}

function impactsOf(doc: PolicyOpsDocument, cr: ChangeRequest): FactoryPackageImpact[] {
  return cr.impacts.map((impact) => {
    const item = doc.catalog.find(
      (candidate) => candidate.kind === 'IMPACT_CATEGORY' && candidate.code === impact.category,
    );
    const entry: FactoryPackageImpact = { category: item?.label ?? impact.category };
    if (impact.description !== undefined) entry.description = impact.description;
    return entry;
  });
}

/** Todos os `attachmentId` de imagem referenciados pelos três `RichDoc` do pacote, sem repetição. */
function attachmentsOf(
  doc: PolicyOpsDocument,
  richDocs: RichDoc[],
): FactoryPackageAttachmentRef[] {
  const ids = [...new Set(richDocs.flatMap(referencedAttachmentIds))];
  const refs: FactoryPackageAttachmentRef[] = [];
  for (const id of ids) {
    const image: InlineImageAttachment | undefined = findInlineImage(doc, id);
    if (image === undefined) continue;
    const ref: FactoryPackageAttachmentRef = {
      attachmentId: image.id,
      fileName: image.fileName,
      mimeType: image.mimeType,
      data: image.data,
    };
    refs.push(ref);
  }
  return refs;
}

/**
 * Monta o pacote de `changeRequestId` — puro, sem `Ctx`: nada aqui grava no
 * documento. Disponível a partir de `APPROVED` (RN-GOV-08); chamar antes
 * disso lança `CR_TRANSITION_INVALID`, o mesmo código de "DB não está pronto"
 * usado no resto do workflow.
 */
export function buildFactoryPackage(
  doc: PolicyOpsDocument,
  changeRequestId: string,
  at: Date = new Date(),
): FactoryPackage {
  const { changeRequest: cr } = locateChangeRequest(doc, changeRequestId);
  assertFactoryPackageAvailable(cr);

  const template = factoryTemplateOf(doc, cr);
  const release = cr.releaseId === undefined ? undefined : doc.releases.find((r) => r.id === cr.releaseId);
  const boilerplate = template?.boilerplate ?? null;
  const motivationText = cr.motivationText ?? null;
  const spec = cr.spec ?? null;

  const richDocs = [boilerplate, motivationText, spec].filter(
    (candidate): candidate is RichDoc => candidate !== null,
  );

  const pkg: FactoryPackage = {
    identification: {
      changeRequestCode: cr.code,
      title: cr.title,
      projectName: projectNameOf(doc, cr),
      status: cr.status,
      requestedBy: cr.requestedBy,
      generatedAt: at.toISOString(),
    },
    versionHistory: versionHistoryOf(cr),
    contacts: template?.contacts ?? [],
    boilerplate,
    motivators: motivatorLabelsOf(doc, cr),
    motivationText,
    spec,
    items: itemsOf(doc, cr),
    impacts: impactsOf(doc, cr),
    acceptanceCriteria: cr.acceptanceCriteria,
    testScenarios: cr.testScenarios,
    attachments: attachmentsOf(doc, richDocs),
  };
  if (cr.owner !== undefined) pkg.identification.owner = cr.owner;
  if (cr.priority !== undefined) pkg.identification.priority = cr.priority;
  if (cr.proposedEffectiveDate !== undefined) pkg.effectiveDate = cr.proposedEffectiveDate;
  if (release !== undefined) {
    pkg.releaseCode = release.code;
    if (release.name !== undefined) pkg.releaseName = release.name;
  }
  return pkg;
}
