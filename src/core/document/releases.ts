import { applyToDocument, defineCommand, isoFrom, makeEvent, type Command } from '../command';
import { DomainError } from '../errors';
import { isChangeRequestClosed } from './cr-workflow';
import {
  ISO_DATE_REGEX,
  type ChangeRequest,
  type PolicyOpsDocument,
  type Release,
  type ReleaseStatus,
} from './schema';

/**
 * Releases — docs/14-governanca-de-alteracoes.md §3.4, docs/08 §3.
 *
 * Uma release agrupa DBs (`ChangeRequest.releaseId`, comando
 * `changeRequest/setRelease`) e, na S36/S37, publica os rascunhos deles em
 * bloco. **Esta sessão não publica nada**: o que entra aqui é o CRUD e a
 * avaliação **estática** de composição — quais DBs da release estão prontos
 * para entrar na publicação, e o que falta em cada um que não está.
 *
 * `assessReleaseComposition` é uma consulta pura, sem comando e sem exceção: é
 * ela que a tela da S37 lê para pintar a lista, e é a lista de pendências que a
 * publicação da S36 vai transformar em `RELEASE_PUBLISH_BLOCKED` (`E-GOV-04`,
 * RN-GOV-05) quando alguém mandar publicar mesmo assim.
 */

// ---------------------------------------------------------------------------
// Localização
// ---------------------------------------------------------------------------
// #region: release-localizacao

export type ReleaseLocation = { release: Release; index: number };

export function locateRelease(doc: PolicyOpsDocument, releaseId: string): ReleaseLocation {
  const index = doc.releases.findIndex((candidate) => candidate.id === releaseId);
  if (index < 0) {
    throw new DomainError('NOT_FOUND', 'A release informada não existe neste documento.', { releaseId });
  }
  return { release: doc.releases[index]!, index };
}

/** Status em que a release ainda aceita mudança — publicada e cancelada são história. */
function assertReleaseOpen(release: Release): void {
  if (release.status === 'PUBLISHED' || release.status === 'CANCELLED') {
    throw new DomainError(
      'CR_TRANSITION_INVALID',
      `A release "${release.code}" está em ${release.status} e não aceita mais edição.`,
      { releaseId: release.id, status: release.status },
    );
  }
}

function assertIsoDate(value: string, what: string): string {
  if (!ISO_DATE_REGEX.test(value)) {
    throw new DomainError('INVALID_INPUT', `${what} precisa estar no formato ISO 8601 UTC.`, { value });
  }
  return value;
}

function assertText(value: string, what: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DomainError('INVALID_INPUT', `${what} não pode ficar em branco.`, { value });
  }
  return trimmed;
}

function previous<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

// ---------------------------------------------------------------------------
// release/create
// ---------------------------------------------------------------------------
// #region: release-create

export type CreateReleaseInput = {
  /** "2026.09.01" — rótulo de calendário; único no documento (I31) e imutável. */
  code: string;
  name?: string;
  plannedDate?: string;
  notes?: string;
};

export function createRelease(input: CreateReleaseInput): Command<CreateReleaseInput, { releaseId: string }> {
  return defineCommand({
    type: 'release/create',
    input,
    label: `Criar a release "${input.code}"`,
    execute(doc, ctx) {
      const code = assertText(input.code, 'O código da release');
      const duplicate = doc.releases.find((candidate) => candidate.code === code);
      if (duplicate !== undefined) {
        throw new DomainError(
          'DUPLICATE_CODE',
          `Já existe uma release com o código "${code}" neste documento.`,
          { code, releaseId: duplicate.id },
        );
      }

      const releaseId = ctx.newId();
      const release: Release = {
        id: releaseId,
        code,
        status: 'PLANNED',
        createdAt: isoFrom(ctx.now()),
      };
      if (input.name !== undefined) release.name = assertText(input.name, 'O nome da release');
      if (input.plannedDate !== undefined) {
        release.plannedDate = assertIsoDate(input.plannedDate, 'A data planejada');
      }
      if (input.notes !== undefined) release.notes = assertText(input.notes, 'A observação da release');

      const events = [
        makeEvent(ctx, {
          type: 'RELEASE_CREATED',
          scope: { releaseId },
          summary: `${ctx.actor} criou a release "${code}".`,
          payload: { code, plannedDate: release.plannedDate ?? null },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          draft.releases.push(release);
        }),
        data: { releaseId },
        events,
        inverse: removeCreatedRelease({ releaseId, code }),
      };
    },
  });
}

/** Inverso de `release/create`: recusa se a release já agrupa DB — desfazer não desmonta escopo alheio. */
function removeCreatedRelease(input: { releaseId: string; code: string }): Command<
  { releaseId: string; code: string },
  void
> {
  return defineCommand({
    type: 'release/_removeCreated',
    input,
    label: `Desfazer a criação da release "${input.code}"`,
    scope: { releaseId: input.releaseId },
    execute(doc) {
      const { release, index } = locateRelease(doc, input.releaseId);
      const linked = doc.changeRequests.filter((cr) => cr.releaseId === release.id);
      if (linked.length > 0) {
        throw new DomainError(
          'CR_TRANSITION_INVALID',
          `A release "${release.code}" já agrupa ${linked.length} solicitação(ões) e não pode ser removida por um desfazer.`,
          { releaseId: release.id },
        );
      }
      const removed = structuredClone(release);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.releases.splice(index, 1);
        }),
        data: undefined,
        events: [],
        inverse: restoreRelease({ release: removed, index }),
      };
    },
  });
}

function restoreRelease(input: { release: Release; index: number }): Command<
  { release: Release; index: number },
  void
> {
  return defineCommand({
    type: 'release/_restore',
    input,
    label: `Refazer a criação da release "${input.release.code}"`,
    scope: { releaseId: input.release.id },
    execute(doc) {
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.releases.splice(input.index, 0, structuredClone(input.release));
        }),
        data: undefined,
        events: [],
        inverse: removeCreatedRelease({ releaseId: input.release.id, code: input.release.code }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// release/update
// ---------------------------------------------------------------------------
// #region: release-update

/**
 * Três estados nos opcionais (ausente = não mexe, `null` = apaga). **Não aceita
 * `code`** (imutável, I31); `status` só entre `PLANNED` e `IN_DEVELOPMENT` —
 * `PUBLISHED` é da publicação (S36/S37) e `CANCELLED` é de `release/cancel`.
 */
export type UpdateReleaseInput = {
  releaseId: string;
  name?: string | null;
  plannedDate?: string | null;
  notes?: string | null;
  status?: Extract<ReleaseStatus, 'PLANNED' | 'IN_DEVELOPMENT'>;
};

export function updateRelease(input: UpdateReleaseInput): Command<UpdateReleaseInput, void> {
  return defineCommand({
    type: 'release/update',
    input,
    label: 'Editar a release',
    scope: { releaseId: input.releaseId },
    execute(doc, ctx) {
      const { release, index } = locateRelease(doc, input.releaseId);
      assertReleaseOpen(release);

      const name =
        input.name === undefined || input.name === null ? input.name : assertText(input.name, 'O nome da release');
      const plannedDate =
        input.plannedDate === undefined || input.plannedDate === null
          ? input.plannedDate
          : assertIsoDate(input.plannedDate, 'A data planejada');
      const notes =
        input.notes === undefined || input.notes === null
          ? input.notes
          : assertText(input.notes, 'A observação da release');

      const inverse = updateRelease({
        releaseId: release.id,
        name: previous(release.name),
        plannedDate: previous(release.plannedDate),
        notes: previous(release.notes),
        // `release.status` só chega aqui em PLANNED/IN_DEVELOPMENT: `assertReleaseOpen`
        // já barrou os outros dois.
        status: release.status as 'PLANNED' | 'IN_DEVELOPMENT',
      });

      const events = [
        makeEvent(ctx, {
          type: 'RELEASE_UPDATED',
          scope: { releaseId: release.id },
          summary: `${ctx.actor} editou a release "${release.code}".`,
          payload: { releaseId: release.id, status: input.status ?? release.status },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          const target = draft.releases[index]!;
          if (name !== undefined) {
            if (name === null) delete target.name;
            else target.name = name;
          }
          if (plannedDate !== undefined) {
            if (plannedDate === null) delete target.plannedDate;
            else target.plannedDate = plannedDate;
          }
          if (notes !== undefined) {
            if (notes === null) delete target.notes;
            else target.notes = notes;
          }
          if (input.status !== undefined) target.status = input.status;
        }),
        data: undefined,
        events,
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// release/cancel
// ---------------------------------------------------------------------------
// #region: release-cancel

export type CancelReleaseInput = { releaseId: string; reason?: string };

/**
 * Cancelar **não** mexe nos DBs vinculados: eles continuam apontando a release
 * cancelada até que alguém os mova (`changeRequest/setRelease`), e é isso que
 * mantém legível "este DB estava na release que caiu".
 */
export function cancelRelease(input: CancelReleaseInput): Command<CancelReleaseInput, { from: ReleaseStatus }> {
  return defineCommand({
    type: 'release/cancel',
    input,
    label: 'Cancelar a release',
    scope: { releaseId: input.releaseId },
    execute(doc, ctx) {
      const { release, index } = locateRelease(doc, input.releaseId);
      assertReleaseOpen(release);
      const reason = input.reason === undefined ? undefined : assertText(input.reason, 'O motivo do cancelamento');

      const events = [
        makeEvent(ctx, {
          type: 'RELEASE_CANCELLED',
          scope: { releaseId: release.id },
          summary:
            reason === undefined
              ? `${ctx.actor} cancelou a release "${release.code}".`
              : `${ctx.actor} cancelou a release "${release.code}": ${reason}`,
          payload: { releaseId: release.id, from: release.status },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          draft.releases[index]!.status = 'CANCELLED';
        }),
        data: { from: release.status },
        events,
        inverse: setReleaseStatus({ releaseId: release.id, status: release.status }),
      };
    },
  });
}

function setReleaseStatus(input: { releaseId: string; status: ReleaseStatus }): Command<
  { releaseId: string; status: ReleaseStatus },
  void
> {
  return defineCommand({
    type: 'release/_setStatus',
    input,
    label: `Voltar a release para ${input.status}`,
    scope: { releaseId: input.releaseId },
    execute(doc) {
      const { release, index } = locateRelease(doc, input.releaseId);
      const inverse = setReleaseStatus({ releaseId: release.id, status: release.status });
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.releases[index]!.status = input.status;
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Composição da release (consulta pura)
// ---------------------------------------------------------------------------
// #region: release-composicao

/** Os estados em que um DB está pronto para entrar numa publicação de release (docs/14 §3.4). */
export const RELEASE_READY_STATUSES = ['READY_FOR_RELEASE', 'SCHEDULED'] as const;

export type ReleaseBlockerKind =
  | 'CR_NOT_READY'
  | 'CR_WITHOUT_ITEMS'
  | 'CR_WITHOUT_EFFECTIVE_DATE'
  | 'ITEM_WITHOUT_DRAFT'
  | 'ITEM_DRAFT_NOT_DRAFT'
  | 'ITEM_BASE_STALE';

export type ReleaseBlocker = {
  kind: ReleaseBlockerKind;
  changeRequestId: string;
  changeRequestCode: string;
  componentId?: string;
  message: string;
};

export type ReleaseCompositionEntry = {
  changeRequestId: string;
  code: string;
  title: string;
  status: ChangeRequest['status'];
  ready: boolean;
  blockers: ReleaseBlocker[];
};

export type ReleaseComposition = {
  releaseId: string;
  code: string;
  status: ReleaseStatus;
  entries: ReleaseCompositionEntry[];
  ready: boolean;
  blockers: ReleaseBlocker[];
};

/** Os DBs vinculados a uma release, na ordem em que estão no documento. */
export function listReleaseChangeRequests(doc: PolicyOpsDocument, releaseId: string): ChangeRequest[] {
  return doc.changeRequests.filter((cr) => cr.releaseId === releaseId);
}

/**
 * Avaliação **estática** da release: o que já dá para publicar e o que falta.
 * Não escreve nada e não lança — release inexistente é `NOT_FOUND` por
 * `locateRelease`, o único caso em que a pergunta não faz sentido.
 *
 * Um item só é cobrado de rascunho quando o `changeType` produz versão nova
 * (`UPDATE`/`CREATE`); `DOC_ONLY`, `MOVE`, `DEACTIVATE` e `REACTIVATE` não
 * carregam rascunho de conteúdo (docs/14 §3.3).
 */
export function assessReleaseComposition(doc: PolicyOpsDocument, releaseId: string): ReleaseComposition {
  const { release } = locateRelease(doc, releaseId);
  const entries = listReleaseChangeRequests(doc, release.id).map((cr) => assessChangeRequest(doc, cr));
  const blockers = entries.flatMap((entry) => entry.blockers);
  return {
    releaseId: release.id,
    code: release.code,
    status: release.status,
    entries,
    ready: entries.length > 0 && blockers.length === 0,
    blockers,
  };
}

/** A mesma avaliação para um DB solto — a publicação individual da S36 usa esta. */
export function assessChangeRequestReadiness(
  doc: PolicyOpsDocument,
  changeRequest: ChangeRequest,
): ReleaseCompositionEntry {
  return assessChangeRequest(doc, changeRequest);
}

function assessChangeRequest(doc: PolicyOpsDocument, cr: ChangeRequest): ReleaseCompositionEntry {
  const blockers: ReleaseBlocker[] = [];
  const blocker = (kind: ReleaseBlockerKind, message: string, componentId?: string): void => {
    blockers.push({
      kind,
      changeRequestId: cr.id,
      changeRequestCode: cr.code,
      ...(componentId === undefined ? {} : { componentId }),
      message,
    });
  };

  if (!(RELEASE_READY_STATUSES as readonly string[]).includes(cr.status)) {
    blocker(
      'CR_NOT_READY',
      `A solicitação "${cr.code}" está em ${cr.status}; para publicar, ela precisa estar em ${RELEASE_READY_STATUSES.join(' ou ')}.`,
    );
  }
  if (cr.items.length === 0) {
    blocker('CR_WITHOUT_ITEMS', `A solicitação "${cr.code}" não tem nenhum item no escopo.`);
  }
  if (cr.proposedEffectiveDate === undefined) {
    blocker('CR_WITHOUT_EFFECTIVE_DATE', `A solicitação "${cr.code}" não tem vigência proposta.`);
  }

  for (const item of cr.items) {
    const component = doc.components.find((candidate) => candidate.id === item.componentId);
    const label = component?.code ?? item.componentId;
    const carriesDraft = item.changeType === 'UPDATE' || item.changeType === 'CREATE';

    if (carriesDraft && item.draftVersionId === undefined) {
      blocker(
        'ITEM_WITHOUT_DRAFT',
        `O item "${label}" da solicitação "${cr.code}" não tem rascunho vinculado.`,
        item.componentId,
      );
      continue;
    }
    if (item.draftVersionId === undefined || component === undefined) continue;

    const versions =
      component.type === 'MATRIX'
        ? (doc.matrices.find((matrix) => matrix.id === component.matrixId)?.versions ?? [])
        : component.versions;
    const draft = versions.find((version) => version.id === item.draftVersionId);
    if (draft === undefined || draft.state !== 'DRAFT') {
      blocker(
        'ITEM_DRAFT_NOT_DRAFT',
        `O rascunho vinculado ao item "${label}" da solicitação "${cr.code}" não está mais em rascunho.`,
        item.componentId,
      );
    }

    // RN-GOV-02: a base mudou desde que o item foi escrito, então publicar
    // exigiria rebase explícito — que é da S36. Aqui isso é só um aviso de
    // composição, nunca uma escrita.
    if (item.baseVersionId !== undefined) {
      const publishedNow = versions.find((version) => version.state === 'PUBLISHED');
      if (publishedNow !== undefined && publishedNow.id !== item.baseVersionId) {
        blocker(
          'ITEM_BASE_STALE',
          `A versão vigente de "${label}" mudou depois que o item da solicitação "${cr.code}" foi escrito — o comparativo precisa de rebase.`,
          item.componentId,
        );
      }
    }
  }

  return {
    changeRequestId: cr.id,
    code: cr.code,
    title: cr.title,
    status: cr.status,
    ready: blockers.length === 0,
    blockers,
  };
}

/**
 * Candidatos a entrar numa release: DB ainda aberto e sem release. Quem decide
 * se ele *pode ser publicado* é `assessReleaseComposition` — esta lista é a da
 * tela "adicionar à release", não a da publicação.
 */
export function listChangeRequestsAvailableForRelease(doc: PolicyOpsDocument): ChangeRequest[] {
  return doc.changeRequests.filter(
    (cr) => !isChangeRequestClosed(cr.status) && cr.releaseId === undefined,
  );
}
