import {
  applyToDocument,
  defineCommand,
  irreversible,
  makeEvent,
  type Command,
  type Ctx,
} from '../command';
import { DomainError } from '../errors';
import { publishVersion } from '../versioning/lifecycle';
import { publishComponentVersion } from '../versioning/component-lifecycle';
import { locateChangeRequest } from './change-requests';
import { archiveComponent, locateComponent, restoreArchivedComponent } from './components';
import { step, type Run } from './cr-drafts';
import { assessChangeRequestReadiness, type ReleaseBlocker } from './releases';
import type { ChangeRequest, DocEvent, PolicyComponent, PolicyOpsDocument } from './schema';

/**
 * `changeRequest/publish` — a publicação do DB (docs/14 §3.3, RN-GOV-05,
 * US-GOV-05; docs/08 §3). A operação que faz o DB valer alguma coisa: o que o
 * gestor aprovou entra em vigor na data do DB, **tudo ou nada**.
 *
 * Cinco decisões que valem para o arquivo inteiro:
 *
 * 1. **Atomicidade sai da imutabilidade**, como em `import/apply` (docs/08 §3):
 *    cada item vira um comando existente (`componentVersion/publish`,
 *    `version/publish`, `component/archive`) aplicado sobre um documento de
 *    trabalho; um `DomainError` no meio do lote propaga para fora de `execute`
 *    e `defineCommand` devolve `{ ok: false }` com o documento **recebido**
 *    intocado. Publicação parcial é impossível por construção, não por
 *    disciplina — não existe caminho de escrita item a item no documento real.
 * 2. **Validar antes de tocar** (docs/08 §1, regra 4): a lista inteira de
 *    pendências é montada por `assessChangeRequestReadiness` **antes** do
 *    primeiro passo, e vira `E-GOV-04` (`RELEASE_PUBLISH_BLOCKED`) com todas
 *    elas juntas. Descobrir uma pendência por vez faria o usuário publicar
 *    cinco vezes para achar cinco problemas.
 * 3. **Base desatualizada nunca é silenciosa** (RN-GOV-02): se a versão vigente
 *    mudou depois que o item foi escrito, a publicação falha com `E-GOV-02`
 *    (`CR_BASE_VERSION_STALE`) até o usuário rever o diff contra a nova vigente
 *    e reconfirmar por `rebasedComponentIds`. A reconfirmação vale só para a
 *    chamada em que ela é passada.
 * 4. **A vigência é a do DB** (`proposedEffectiveDate`), a mesma para todos os
 *    itens. Vigência retroativa vale para componente (RN-GOV-09) e **não** vale
 *    para matriz (docs/05 §1.3) — cada entidade mantém a sua regra, e o item de
 *    matriz com data no passado aparece como pendência antes de publicar
 *    (DEC-GOV-035, docs/14 §12 pergunta 4).
 * 5. **`PUBLISHED` só se chega por aqui** (docs/14 §5, `PUBLISHED_REACHED_BY`).
 *    Publicar é irreversível, como publicar versão: o inverso é
 *    `irreversible(...)`.
 */

// ---------------------------------------------------------------------------
// Entrada e saída
// ---------------------------------------------------------------------------
// #region: cr-publish-contrato

export type PublishChangeRequestInput = {
  changeRequestId: string;
  /**
   * `componentId` dos itens cuja base desatualizada o usuário reviu e
   * reconfirmou (RN-GOV-02). Sem isso, `E-GOV-02`.
   */
  rebasedComponentIds?: string[];
};

export type PublishedEntry = {
  componentId: string;
  componentCode: string;
  kind: 'COMPONENT' | 'MATRIX';
  versionId: string;
  supersededVersionId: string | null;
};

export type PublishChangeRequestData = {
  effectiveFrom: string;
  published: PublishedEntry[];
  /** Itens `DEACTIVATE`: componentes arquivados na mesma transação. */
  archived: string[];
  /** Itens `REACTIVATE`: componentes desarquivados na mesma transação. */
  restored: string[];
};

// ---------------------------------------------------------------------------
// Pendências (E-GOV-02 e E-GOV-04)
// ---------------------------------------------------------------------------
// #region: cr-publish-pendencias

/**
 * O que separa os dois erros: base desatualizada tem código próprio
 * (`E-GOV-02`) porque tem **tratamento** próprio — rever o diff e reconfirmar.
 * Todo o resto é pendência de composição e vira `E-GOV-04` com a lista.
 */
export type PublishPreflight = {
  effectiveFrom: string | null;
  /** Pendências que só o autor resolve: rascunho ausente, status, vigência. */
  blockers: ReleaseBlocker[];
  /** Bases desatualizadas ainda **não** reconfirmadas (RN-GOV-02). */
  staleBases: ReleaseBlocker[];
};

/**
 * Consulta pura da publicação: a mesma avaliação que a tela pinta antes de o
 * usuário clicar, e que o comando refaz antes de escrever. Não lança nada
 * além de `NOT_FOUND` (DB inexistente).
 */
export function preflightChangeRequestPublish(
  doc: PolicyOpsDocument,
  changeRequestId: string,
  options: { at?: Date; rebasedComponentIds?: readonly string[] } = {},
): PublishPreflight {
  const { changeRequest: cr } = locateChangeRequest(doc, changeRequestId);
  const entry = assessChangeRequestReadiness(doc, cr, {
    ...(options.at === undefined ? {} : { at: options.at }),
  });
  const rebased = new Set(options.rebasedComponentIds ?? []);

  const blockers: ReleaseBlocker[] = [];
  const staleBases: ReleaseBlocker[] = [];
  for (const blocker of entry.blockers) {
    if (blocker.kind !== 'ITEM_BASE_STALE') {
      blockers.push(blocker);
      continue;
    }
    if (blocker.componentId !== undefined && rebased.has(blocker.componentId)) continue;
    staleBases.push(blocker);
  }

  return {
    effectiveFrom: cr.proposedEffectiveDate ?? null,
    blockers,
    staleBases,
  };
}

function assertPublishable(preflight: PublishPreflight, cr: ChangeRequest): string {
  if (preflight.blockers.length > 0) {
    throw new DomainError(
      'RELEASE_PUBLISH_BLOCKED',
      `A solicitação "${cr.code}" não pode ser publicada: ${preflight.blockers.length} pendência(s) impedem — ${preflight.blockers
        .map((blocker) => blocker.message)
        .join(' ')}`,
      { changeRequestId: cr.id, blockers: preflight.blockers },
    );
  }
  if (preflight.staleBases.length > 0) {
    throw new DomainError(
      'CR_BASE_VERSION_STALE',
      `A versão vigente mudou depois que ${preflight.staleBases.length === 1 ? 'o item foi escrito' : 'os itens foram escritos'} na solicitação "${cr.code}": revise o comparativo contra a nova vigente e reconfirme antes de publicar.`,
      { changeRequestId: cr.id, staleBases: preflight.staleBases },
    );
  }
  // `CR_WITHOUT_EFFECTIVE_DATE` já teria entrado em `blockers`; o `??` existe
  // para o compilador, não para o usuário.
  return preflight.effectiveFrom ?? '';
}

// ---------------------------------------------------------------------------
// changeRequest/publish
// ---------------------------------------------------------------------------
// #region: cr-publish-comando

/** Os tipos de item que carregam versão nova — o resto não publica conteúdo. */
function carriesDraft(changeType: ChangeRequest['items'][number]['changeType']): boolean {
  return changeType === 'UPDATE' || changeType === 'CREATE' || changeType === 'DOC_ONLY';
}

export function publishChangeRequest(
  input: PublishChangeRequestInput,
): Command<PublishChangeRequestInput, PublishChangeRequestData> {
  return defineCommand({
    type: 'changeRequest/publish',
    input,
    label: 'Publicar a solicitação',
    scope: { changeRequestId: input.changeRequestId },
    execute(doc, ctx) {
      const { changeRequest: cr, index: crIndex } = locateChangeRequest(doc, input.changeRequestId);

      const preflight = preflightChangeRequestPublish(doc, cr.id, {
        at: ctx.now(),
        ...(input.rebasedComponentIds === undefined
          ? {}
          : { rebasedComponentIds: input.rebasedComponentIds }),
      });
      const effectiveFrom = assertPublishable(preflight, cr);

      const run: Run = { doc, inverses: [] };
      const published: PublishedEntry[] = [];
      const archived: string[] = [];
      const restored: string[] = [];
      // Os eventos de publicação desta rodada, para carimbar o DB de origem —
      // mesma técnica do `importRunId` de `import/apply` (docs/08 §3). Em
      // componente o `changeRequestId` já vem do próprio rascunho; em matriz,
      // `MatrixVersion` não tem o campo (DEC-GOV-002), e é o carimbo no evento
      // que faz a timeline da matriz apontar o DB (CT-GOV-06).
      const stamped = new Set<string>();

      for (const item of cr.items) {
        const { component } = locateComponent(run.doc, item.componentId);

        if (item.changeType === 'DEACTIVATE') {
          if (component.archivedAt === undefined) {
            step(run, ctx, archiveComponent({ componentId: component.id }));
            archived.push(component.id);
          }
        } else if (item.changeType === 'REACTIVATE') {
          if (component.archivedAt !== undefined) {
            step(run, ctx, restoreArchivedComponent({ componentId: component.id }));
            restored.push(component.id);
          }
        }

        if (item.draftVersionId === undefined || !carriesDraft(item.changeType)) continue;
        published.push(
          publishItem(run, ctx, cr, component, item.draftVersionId, effectiveFrom, stamped),
        );
      }

      const transition = makeEvent(ctx, {
        type: 'CR_TRANSITIONED',
        scope: { changeRequestId: cr.id },
        summary: `${ctx.actor} publicou a solicitação "${cr.code}": ${published.length} versão(ões) em vigor a partir de ${effectiveFrom}.`,
        payload: {
          from: cr.status,
          to: 'PUBLISHED',
          effectiveFrom,
          published: published.map((entry) => ({
            componentId: entry.componentId,
            versionId: entry.versionId,
            kind: entry.kind,
          })),
          archived,
          restored,
        },
      });

      const document = applyToDocument(run.doc, [], (draft) => {
        const target = draft.changeRequests[crIndex]!;
        target.status = 'PUBLISHED';
        target.events.push(transition);
        for (const event of draft.events) {
          if (!stamped.has(event.id)) continue;
          const payload = (event.payload ?? {}) as Record<string, unknown>;
          payload.changeRequestId = cr.id;
          payload.changeRequestCode = cr.code;
          event.payload = payload as DocEvent['payload'];
        }
      });

      return {
        document,
        data: { effectiveFrom, published, archived, restored },
        events: [transition],
        inverse: irreversible(
          'Publicar uma solicitação não pode ser desfeito. Para voltar atrás, crie um DB novo com o rascunho da versão anterior.',
        ),
      };
    },
  });
}

function publishItem(
  run: Run,
  ctx: Ctx,
  cr: ChangeRequest,
  component: PolicyComponent,
  draftVersionId: string,
  effectiveFrom: string,
  stamped: Set<string>,
): PublishedEntry {
  const before = run.doc.events.length;

  if (component.type === 'MATRIX') {
    const data = step(
      run,
      ctx,
      publishVersion({
        versionId: draftVersionId,
        effectiveFrom,
        // `version/publish` exige nota de ao menos 10 caracteres (docs/05
        // §1.3); quem carrega o "por quê" numa publicação por DB é o próprio
        // DB, então a nota é derivada dele — nunca pedida de novo ao usuário.
        notes: `Publicado pelo ${cr.code} — ${cr.title}`,
      }),
    );
    markNewEvents(run, before, stamped);
    return {
      componentId: component.id,
      componentCode: component.code,
      kind: 'MATRIX',
      versionId: data.versionId,
      supersededVersionId: data.supersededVersionId,
    };
  }

  const data = step(run, ctx, publishComponentVersion({ versionId: draftVersionId, effectiveFrom }));
  markNewEvents(run, before, stamped);
  return {
    componentId: component.id,
    componentCode: component.code,
    kind: 'COMPONENT',
    versionId: data.versionId,
    supersededVersionId: data.supersededVersionId,
  };
}

const STAMPED_EVENT_TYPES = new Set([
  'VERSION_PUBLISHED',
  'VERSION_SUPERSEDED',
  'COMPONENT_VERSION_PUBLISHED',
  'COMPONENT_VERSION_SUPERSEDED',
]);

function markNewEvents(run: Run, from: number, stamped: Set<string>): void {
  for (let index = from; index < run.doc.events.length; index++) {
    const event = run.doc.events[index]!;
    if (STAMPED_EVENT_TYPES.has(event.type)) stamped.add(event.id);
  }
}

// ---------------------------------------------------------------------------
// Consulta: o que a publicação vai fazer
// ---------------------------------------------------------------------------
// #region: cr-publish-plano

export type PublishPlanEntry = {
  componentId: string;
  componentCode: string;
  componentName: string;
  kind: 'COMPONENT' | 'MATRIX';
  /** O que acontece com este item na publicação. */
  effect: 'PUBLISH_VERSION' | 'ARCHIVE' | 'RESTORE' | 'NONE';
  versionNumber: number | null;
};

/**
 * O plano da publicação, em linguagem de tela: um item por linha, dizendo o que
 * vai acontecer com ele. Puro, sem escrita — é o corpo do diálogo de
 * publicação (docs/07 §19.5) e o que prova, na revisão, que `MOVE` não muda
 * nada no ato de publicar (a árvore já foi movida quando o analista a moveu).
 */
export function planChangeRequestPublish(
  doc: PolicyOpsDocument,
  changeRequestId: string,
): PublishPlanEntry[] {
  const { changeRequest: cr } = locateChangeRequest(doc, changeRequestId);
  return cr.items.map((item) => {
    const component = doc.components.find((candidate) => candidate.id === item.componentId);
    const kind: 'COMPONENT' | 'MATRIX' = component?.type === 'MATRIX' ? 'MATRIX' : 'COMPONENT';
    const versions =
      component === undefined
        ? []
        : kind === 'MATRIX'
          ? (doc.matrices.find((matrix) => matrix.id === component.matrixId)?.versions ?? [])
          : component.versions;
    const draft = versions.find((version) => version.id === item.draftVersionId);

    const effect: PublishPlanEntry['effect'] =
      item.draftVersionId !== undefined && carriesDraft(item.changeType)
        ? 'PUBLISH_VERSION'
        : item.changeType === 'DEACTIVATE'
          ? 'ARCHIVE'
          : item.changeType === 'REACTIVATE'
            ? 'RESTORE'
            : 'NONE';

    return {
      componentId: item.componentId,
      componentCode: component?.code ?? item.componentId,
      componentName: component?.name ?? item.componentId,
      kind,
      effect,
      versionNumber: draft?.number ?? null,
    };
  });
}

/** `true` quando o DB já publicou — usado pela tela para trocar ação por histórico. */
export function isChangeRequestPublished(cr: ChangeRequest): boolean {
  return cr.status === 'PUBLISHED';
}

/**
 * Quando o DB foi publicado, lido da trilha — `null` enquanto não publicado.
 * `ChangeRequest` não tem `publishedAt` no schema (docs/03 §13): quem guarda o
 * carimbo é o evento da transição, como em toda a trilha do DB (DEC-GOV-019).
 */
export function changeRequestPublishedAt(cr: ChangeRequest): string | null {
  const event = [...cr.events]
    .reverse()
    .find((candidate) => candidate.type === 'CR_TRANSITIONED' && candidate.payload?.to === 'PUBLISHED');
  return event?.at ?? null;
}
