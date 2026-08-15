import { DomainError } from '../errors';
import { CR_STATUSES, type ChangeRequest, type CrStatus } from './schema';

/**
 * Grafo de estados da Solicitação de Alteração (DB) — docs/14 §5, RN-GOV-01.
 * Módulo **puro**: só o grafo e as guardas que dependem exclusivamente do DB,
 * sem documento e sem `Ctx`. Os comandos que o exercitam estão em
 * `./change-requests.ts`.
 *
 * O grafo é a transcrição literal de docs/14 §5:
 *
 * ```
 * DRAFT → SUBMITTED → IN_REVIEW → { CHANGES_REQUESTED → DRAFT | APPROVED | REJECTED }
 * APPROVED → IN_DEVELOPMENT → IN_VALIDATION → READY_FOR_RELEASE → SCHEDULED → PUBLISHED
 * Qualquer estado exceto PUBLISHED → CANCELLED
 * ```
 *
 * Três leituras que o texto deixa implícitas e que aqui viram código:
 *
 * 1. **`PUBLISHED` é terminal e inalcançável por `changeRequest/transition`.**
 *    A aresta `SCHEDULED → PUBLISHED` existe no grafo, mas quem a percorre é a
 *    publicação (individual ou por release, S36) — nunca uma mudança manual de
 *    status (docs/14 §5, último bullet). `PUBLISHED_REACHED_BY` documenta isso
 *    num lugar só.
 * 2. **`CANCELLED` também é terminal.** "Qualquer estado exceto PUBLISHED →
 *    CANCELLED" descreve as arestas *de entrada*; cancelar o que já está
 *    cancelado não é transição, é ruído.
 * 3. **"status ≥ APPROVED" tem uma ordem definida**: a de `CR_STATUSES`
 *    (docs/03 §13), que é a mesma em que docs/14 §5 lista os estados. É ela que
 *    I30 usa para decidir o que está congelado.
 */

// ---------------------------------------------------------------------------
// O grafo
// ---------------------------------------------------------------------------
// #region: grafo-de-estados

export const CR_TRANSITIONS: Readonly<Record<CrStatus, readonly CrStatus[]>> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['IN_REVIEW', 'CANCELLED'],
  IN_REVIEW: ['CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED'],
  CHANGES_REQUESTED: ['DRAFT', 'CANCELLED'],
  APPROVED: ['IN_DEVELOPMENT', 'CANCELLED'],
  REJECTED: ['CANCELLED'],
  IN_DEVELOPMENT: ['IN_VALIDATION', 'CANCELLED'],
  IN_VALIDATION: ['READY_FOR_RELEASE', 'CANCELLED'],
  READY_FOR_RELEASE: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: [],
  CANCELLED: [],
};

/** Quem carimba `PUBLISHED` — a publicação da S36, jamais `changeRequest/transition`. */
export const PUBLISHED_REACHED_BY =
  'PUBLISHED é atingido só pela publicação do DB ou da release, nunca por mudança manual de status';

export function canTransition(from: CrStatus, to: CrStatus): boolean {
  return CR_TRANSITIONS[from].includes(to);
}

/** Os destinos que o usuário pode escolher a partir daqui — `PUBLISHED` fora, sempre. */
export function allowedTransitions(from: CrStatus): CrStatus[] {
  return CR_TRANSITIONS[from].filter((to) => to !== 'PUBLISHED');
}

// ---------------------------------------------------------------------------
// Ordem dos estados e congelamento (I30)
// ---------------------------------------------------------------------------
// #region: ordem-e-congelamento

const CR_STATUS_RANK: Record<CrStatus, number> = Object.fromEntries(
  CR_STATUSES.map((status, index) => [status, index]),
) as Record<CrStatus, number>;

export function crStatusRank(status: CrStatus): number {
  return CR_STATUS_RANK[status];
}

/**
 * I30: DB com status **≥ `APPROVED`** tem itens imutáveis. Pela ordem de
 * `CR_STATUSES`, isso inclui `REJECTED` e `CANCELLED` — e é o que se quer: um
 * DB fechado não volta a ter escopo editado, ele vira um DB novo (docs/14 §5).
 */
export function isChangeRequestFrozen(status: CrStatus): boolean {
  return CR_STATUS_RANK[status] >= CR_STATUS_RANK.APPROVED;
}

/** Fechados: nada mais é editado, nem metadado nem escopo. */
export function isChangeRequestClosed(status: CrStatus): boolean {
  return status === 'PUBLISHED' || status === 'REJECTED' || status === 'CANCELLED';
}

// ---------------------------------------------------------------------------
// Guardas
// ---------------------------------------------------------------------------
// #region: guardas-de-workflow

/** RN-GOV-01 / `E-GOV-01`: fora do grafo, ninguém passa. */
export function assertTransitionAllowed(cr: ChangeRequest, to: CrStatus): void {
  if (to === 'PUBLISHED') {
    throw new DomainError(
      'CR_TRANSITION_INVALID',
      `A solicitação "${cr.code}" não pode ser marcada como PUBLISHED por mudança de status: ${PUBLISHED_REACHED_BY}.`,
      { changeRequestId: cr.id, from: cr.status, to },
    );
  }
  if (cr.status === to) {
    throw new DomainError(
      'CR_TRANSITION_INVALID',
      `A solicitação "${cr.code}" já está em ${to}.`,
      { changeRequestId: cr.id, from: cr.status, to },
    );
  }
  if (!canTransition(cr.status, to)) {
    const allowed = allowedTransitions(cr.status);
    throw new DomainError(
      'CR_TRANSITION_INVALID',
      allowed.length === 0
        ? `A solicitação "${cr.code}" está em ${cr.status}, que é um estado final — não há transição possível.`
        : `A solicitação "${cr.code}" está em ${cr.status} e não pode ir para ${to}; daqui só ${allowed.join(', ')}.`,
      { changeRequestId: cr.id, from: cr.status, to, allowed },
    );
  }
}

/** I30 em tempo de comando: mexer no escopo de um DB congelado é `E-GOV-01`. */
export function assertItemsEditable(cr: ChangeRequest): void {
  if (isChangeRequestFrozen(cr.status)) {
    throw new DomainError(
      'CR_TRANSITION_INVALID',
      `Os itens da solicitação "${cr.code}" estão congelados desde ${cr.status}: para mudar o escopo, devolva o DB para edição ou crie outro.`,
      { changeRequestId: cr.id, status: cr.status },
    );
  }
}

/** Metadado de DB fechado (publicado, rejeitado ou cancelado) também não se edita. */
export function assertChangeRequestOpen(cr: ChangeRequest): void {
  if (isChangeRequestClosed(cr.status)) {
    throw new DomainError(
      'CR_TRANSITION_INVALID',
      `A solicitação "${cr.code}" está em ${cr.status} e não aceita mais edição.`,
      { changeRequestId: cr.id, status: cr.status },
    );
  }
}

// ---------------------------------------------------------------------------
// RN-GOV-03 — o que falta para submeter
// ---------------------------------------------------------------------------
// #region: rn-gov-03-submissao

export type SubmitRequirement = 'MOTIVATOR' | 'ITEM' | 'EFFECTIVE_DATE';

const SUBMIT_REQUIREMENT_LABEL: Record<SubmitRequirement, string> = {
  MOTIVATOR: 'ao menos um motivador',
  ITEM: 'ao menos um item com o texto do proposto',
  EFFECTIVE_DATE: 'a vigência pretendida',
};

/** O que ainda falta para o DB poder ser submetido (RN-GOV-03) — vazio = pronto. */
export function missingForSubmit(cr: ChangeRequest): SubmitRequirement[] {
  const missing: SubmitRequirement[] = [];
  if (cr.motivators.length === 0) missing.push('MOTIVATOR');
  if (!cr.items.some((item) => item.proposedSummary.trim() !== '')) missing.push('ITEM');
  if (cr.proposedEffectiveDate === undefined) missing.push('EFFECTIVE_DATE');
  return missing;
}

/** RN-GOV-03 / `E-GOV-03`. */
export function assertSubmittable(cr: ChangeRequest): void {
  const missing = missingForSubmit(cr);
  if (missing.length === 0) return;
  throw new DomainError(
    'CR_INCOMPLETE',
    `A solicitação "${cr.code}" ainda não pode ser submetida: falta ${missing
      .map((requirement) => SUBMIT_REQUIREMENT_LABEL[requirement])
      .join(', ')}.`,
    { changeRequestId: cr.id, missing },
  );
}
