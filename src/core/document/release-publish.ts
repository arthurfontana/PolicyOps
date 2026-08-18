import { applyToDocument, defineCommand, irreversible, isoFrom, makeEvent, type Command } from '../command';
import { DomainError } from '../errors';
import { preflightChangeRequestPublish, publishChangeRequest, type PublishedEntry } from './cr-publish';
import { step, type Run } from './cr-drafts';
import { listReleaseChangeRequests, locateRelease, type ReleaseBlocker } from './releases';
import type { PolicyOpsDocument, Release } from './schema';

/**
 * `release/publish` — a publicação em lote da release (docs/14 §3.4, §4
 * US-GOV-05, §6 RN-GOV-05, CT-GOV-03). **Não é um comando novo de publicação**:
 * é `changeRequest/publish` (S36) rodado uma vez por DB pronto da release,
 * dentro da mesma transação — a reutilização é DEC-GOV-008. Cada DB mantém a
 * sua própria vigência (`proposedEffectiveDate`); não existe data única de
 * release.
 *
 * As mesmas três decisões de `cr-publish.ts` valem aqui, uma camada acima:
 *
 * 1. **Validar antes de tocar**: a lista de pendências de **todos** os DBs da
 *    release é montada primeiro (`preflightChangeRequestPublish` por DB,
 *    agregado); qualquer pendência em qualquer DB aborta tudo com
 *    `E-GOV-04`, sem publicar nenhum — CT-GOV-03 exatamente.
 * 2. **Base desatualizada nunca é silenciosa** (RN-GOV-02): agregada da mesma
 *    forma, por DB, com reconfirmação `{ changeRequestId, componentId }`.
 * 3. **Atomicidade sai da imutabilidade**: cada DB é um passo (`step`) sobre
 *    um documento de trabalho; qualquer erro que escape da validação estática
 *    (ex.: I6 de matriz, só checado dentro de `version/publish`) propaga e o
 *    documento **recebido** volta intocado — publicação parcial de release é
 *    impossível pela mesma construção do DB individual.
 */

// ---------------------------------------------------------------------------
// Entrada e saída
// ---------------------------------------------------------------------------
// #region: release-publish-contrato

export type PublishReleaseInput = {
  releaseId: string;
  /**
   * Bases desatualizadas revistas e reconfirmadas (RN-GOV-02), por DB — o
   * mesmo `rebasedComponentIds` de `changeRequest/publish`, só que a lista
   * agora precisa dizer **de qual DB** o componente é, porque dois DBs da
   * mesma release podem ter itens sobre componentes diferentes com o mesmo
   * bloqueio.
   */
  rebasedComponentIds?: { changeRequestId: string; componentId: string }[];
};

export type ReleasePublishedEntry = {
  changeRequestId: string;
  changeRequestCode: string;
  effectiveFrom: string;
  published: PublishedEntry[];
};

export type PublishReleaseData = {
  publishedAt: string;
  entries: ReleasePublishedEntry[];
};

// ---------------------------------------------------------------------------
// Pendências agregadas (E-GOV-02 e E-GOV-04)
// ---------------------------------------------------------------------------
// #region: release-publish-pendencias

export type ReleasePublishPreflight = {
  /** `null` quando a release ainda não tem nenhum DB vinculado. */
  changeRequestCount: number;
  /** Pendências que só o autor de cada DB resolve — mesmo catálogo de `ReleaseBlocker`. */
  blockers: ReleaseBlocker[];
  /** Bases desatualizadas ainda não reconfirmadas, em qualquer DB da release. */
  staleBases: ReleaseBlocker[];
};

function rebasedMap(
  entries: PublishReleaseInput['rebasedComponentIds'],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const entry of entries ?? []) {
    const list = map.get(entry.changeRequestId) ?? [];
    list.push(entry.componentId);
    map.set(entry.changeRequestId, list);
  }
  return map;
}

/**
 * Consulta pura da publicação de release: a mesma avaliação que a tela pinta
 * antes de o usuário clicar, e que o comando refaz antes de escrever. Não
 * lança nada além de `NOT_FOUND` (release inexistente).
 */
export function preflightReleasePublish(
  doc: PolicyOpsDocument,
  releaseId: string,
  options: { at?: Date; rebasedComponentIds?: PublishReleaseInput['rebasedComponentIds'] } = {},
): ReleasePublishPreflight {
  const { release } = locateRelease(doc, releaseId);
  const crs = listReleaseChangeRequests(doc, release.id);
  const rebased = rebasedMap(options.rebasedComponentIds);

  const blockers: ReleaseBlocker[] = [];
  const staleBases: ReleaseBlocker[] = [];
  for (const cr of crs) {
    const preflight = preflightChangeRequestPublish(doc, cr.id, {
      ...(options.at === undefined ? {} : { at: options.at }),
      rebasedComponentIds: rebased.get(cr.id) ?? [],
    });
    blockers.push(...preflight.blockers);
    staleBases.push(...preflight.staleBases);
  }

  return { changeRequestCount: crs.length, blockers, staleBases };
}

function assertPublishable(preflight: ReleasePublishPreflight, releaseCode: string): void {
  if (preflight.changeRequestCount === 0) {
    throw new DomainError(
      'RELEASE_PUBLISH_BLOCKED',
      `A release "${releaseCode}" não tem nenhuma solicitação vinculada.`,
      { releaseCode },
    );
  }
  if (preflight.blockers.length > 0) {
    throw new DomainError(
      'RELEASE_PUBLISH_BLOCKED',
      `A release "${releaseCode}" não pode ser publicada: ${preflight.blockers.length} pendência(s) impedem — ${preflight.blockers
        .map((blocker) => blocker.message)
        .join(' ')}`,
      { releaseCode, blockers: preflight.blockers },
    );
  }
  if (preflight.staleBases.length > 0) {
    throw new DomainError(
      'CR_BASE_VERSION_STALE',
      `A versão vigente mudou depois que ${preflight.staleBases.length === 1 ? 'um item foi escrito' : 'itens foram escritos'} nesta release: revise o comparativo contra a nova vigente e reconfirme antes de publicar.`,
      { releaseCode, staleBases: preflight.staleBases },
    );
  }
}

// ---------------------------------------------------------------------------
// release/publish
// ---------------------------------------------------------------------------
// #region: release-publish-comando

export function publishRelease(
  input: PublishReleaseInput,
): Command<PublishReleaseInput, PublishReleaseData> {
  return defineCommand({
    type: 'release/publish',
    input,
    label: 'Publicar a release',
    scope: { releaseId: input.releaseId },
    execute(doc, ctx) {
      const { release, index } = locateRelease(doc, input.releaseId);
      if (release.status === 'PUBLISHED' || release.status === 'CANCELLED') {
        throw new DomainError(
          'CR_TRANSITION_INVALID',
          `A release "${release.code}" está em ${release.status} e não pode ser publicada de novo.`,
          { releaseId: release.id, status: release.status },
        );
      }

      const preflight = preflightReleasePublish(doc, release.id, {
        at: ctx.now(),
        ...(input.rebasedComponentIds === undefined ? {} : { rebasedComponentIds: input.rebasedComponentIds }),
      });
      assertPublishable(preflight, release.code);

      const rebased = rebasedMap(input.rebasedComponentIds);
      const crs = listReleaseChangeRequests(doc, release.id);

      const run: Run = { doc, inverses: [] };
      const entries: ReleasePublishedEntry[] = [];
      for (const cr of crs) {
        const data = step(
          run,
          ctx,
          publishChangeRequest({ changeRequestId: cr.id, rebasedComponentIds: rebased.get(cr.id) ?? [] }),
        );
        entries.push({
          changeRequestId: cr.id,
          changeRequestCode: cr.code,
          effectiveFrom: data.effectiveFrom,
          published: data.published,
        });
      }

      const publishedAt = isoFrom(ctx.now());
      const releaseEvent = makeEvent(ctx, {
        type: 'RELEASE_PUBLISHED',
        scope: { releaseId: release.id },
        summary: `${ctx.actor} publicou a release "${release.code}": ${crs.length} solicitação(ões).`,
        payload: {
          releaseId: release.id,
          changeRequestIds: crs.map((cr) => cr.id),
          entries: entries.map((entry) => ({
            changeRequestId: entry.changeRequestId,
            changeRequestCode: entry.changeRequestCode,
            effectiveFrom: entry.effectiveFrom,
          })),
        },
      });

      const document = applyToDocument(run.doc, [releaseEvent], (draft) => {
        const target = draft.releases[index]!;
        target.status = 'PUBLISHED';
        target.publishedAt = publishedAt;
        target.publishedBy = ctx.actor;
      });

      return {
        document,
        data: { publishedAt, entries },
        events: [releaseEvent],
        inverse: irreversible(
          'Publicar uma release não pode ser desfeito. Para voltar atrás, crie um DB novo com o rascunho da versão anterior.',
        ),
      };
    },
  });
}

/** `true` quando a release já publicou — usado pela tela para trocar ação por histórico. */
export function isReleasePublished(release: Release): boolean {
  return release.status === 'PUBLISHED';
}
