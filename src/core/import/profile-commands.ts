import { applyToDocument, defineCommand, isoFrom, makeEvent, type Command } from '../command';
import type { ImportProfile } from '../document/schema';
import { DomainError } from '../errors';
import { hasBlockingIssue } from './issues';
import { validateProfile } from './profile';

/**
 * `importProfile/save` e `importProfile/delete` — docs/08 §3 (Carga de
 * matrizes), docs/12 US-08, docs/03 §7.1.
 *
 * O perfil é **configuração, não histórico** (docs/03 §7.1): salvar um perfil
 * novo ou reescrever um existente não altera nenhuma carga já aplicada, e por
 * isso o comando é um `upsert` simples pelo `code`, com o inverso carregando o
 * estado anterior por extenso — o mesmo padrão dos comandos de metadados.
 */

export type SaveImportProfileInput = { profile: ImportProfile };
export type SaveImportProfileData = { profileId: string; created: boolean };

export function saveImportProfile(
  input: SaveImportProfileInput,
): Command<SaveImportProfileInput, SaveImportProfileData> {
  return defineCommand({
    type: 'importProfile/save',
    input,
    label: `Salvar o perfil de carga "${input.profile.code}"`,
    execute(doc, ctx) {
      // I21/I22 antes de qualquer escrita (docs/08 §1, regra 4). O primeiro
      // problema bloqueante vira `DomainError` com o código dele — a lista
      // inteira já foi mostrada pelo assistente no passo 2.
      const issues = validateProfile(doc, input.profile);
      const blocking = issues.find((issue) => issue.severity === 'ERROR');
      if (blocking !== undefined && hasBlockingIssue(issues)) {
        throw new DomainError(blocking.code as 'IMPORT_PROFILE_INVALID', blocking.message, blocking.details);
      }

      const index = doc.importProfiles.findIndex(
        (candidate) => candidate.code === input.profile.code,
      );
      const previous = index < 0 ? undefined : doc.importProfiles[index]!;
      const now = isoFrom(ctx.now());
      const saved: ImportProfile =
        previous === undefined
          ? { ...input.profile }
          : // Atualizar preserva a identidade do perfil salvo: quem já
            // referenciou aquele `id` continua apontando para o mesmo perfil.
            { ...input.profile, id: previous.id, createdAt: previous.createdAt, updatedAt: now };

      const event = makeEvent(ctx, {
        type: 'IMPORT_PROFILE_SAVED',
        scope: { projectId: saved.projectId },
        summary:
          previous === undefined
            ? `${ctx.actor} salvou o perfil de carga "${saved.code}".`
            : `${ctx.actor} atualizou o perfil de carga "${saved.code}".`,
        payload: { code: saved.code, name: saved.name, created: previous === undefined },
      });

      return {
        document: applyToDocument(doc, [event], (draft) => {
          if (index < 0) draft.importProfiles.push(saved);
          else draft.importProfiles[index] = saved;
        }),
        data: { profileId: saved.id, created: previous === undefined },
        events: [event],
        inverse:
          previous === undefined
            ? deleteImportProfile({ profileId: saved.id })
            : restoreImportProfile({ profile: previous, index }),
      };
    },
  });
}

export type DeleteImportProfileInput = { profileId: string };

export function deleteImportProfile(
  input: DeleteImportProfileInput,
): Command<DeleteImportProfileInput, void> {
  return defineCommand({
    type: 'importProfile/delete',
    input,
    label: 'Remover o perfil de carga',
    execute(doc) {
      const index = doc.importProfiles.findIndex((candidate) => candidate.id === input.profileId);
      if (index < 0) {
        throw new DomainError('NOT_FOUND', 'O perfil de carga informado não existe neste documento.', {
          profileId: input.profileId,
        });
      }
      const removed = structuredClone(doc.importProfiles[index]!);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.importProfiles.splice(index, 1);
        }),
        data: undefined,
        events: [],
        inverse: restoreImportProfile({ profile: removed, index }),
      };
    },
  });
}

/** Devolve um perfil exatamente como estava, na posição em que estava. */
function restoreImportProfile(input: { profile: ImportProfile; index: number }): Command<
  { profile: ImportProfile; index: number },
  void
> {
  return defineCommand({
    type: 'importProfile/_restore',
    input,
    label: `Restaurar o perfil de carga "${input.profile.code}"`,
    execute(doc) {
      const existing = doc.importProfiles.findIndex(
        (candidate) => candidate.id === input.profile.id,
      );
      // O inverso carrega o estado atual por extenso: sobrescrever devolve o
      // que estava lá, e recriar volta a remover.
      const inverse =
        existing >= 0
          ? restoreImportProfile({
              profile: structuredClone(doc.importProfiles[existing]!),
              index: existing,
            })
          : deleteImportProfile({ profileId: input.profile.id });
      return {
        document: applyToDocument(doc, [], (draft) => {
          if (existing >= 0) draft.importProfiles[existing] = structuredClone(input.profile);
          else draft.importProfiles.splice(input.index, 0, structuredClone(input.profile));
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}
