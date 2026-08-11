import { applyToDocument, defineCommand, isoFrom, makeEvent, type Command } from '../command';
import { DomainError, type DomainErrorCode } from '../errors';
import type { PolicyOpsDocument } from '../document/schema';
import { validateProfile, type ImportProfile } from './profile';

/**
 * Comandos do perfil de carga — docs/08-camada-de-comandos.md §3,
 * docs/03-modelo-do-documento.md §7.1. `ImportProfile` não tem `position`
 * (docs/03 §7.1 não declara o campo), então inserir/remover em qualquer
 * índice não abre o buraco que `checkPositions` vigia para catálogo e
 * projeto — diferente do padrão de `catalog/create`.
 *
 * Mesmo padrão de inverso do resto do documento (docs/08 §1, regra 3): o
 * inverso carrega o valor **exato** anterior, sem recalcular `ctx.now()` no
 * desfazer — é o que faz desfazer/refazer devolverem o documento byte a byte
 * (mesmo raciocínio de `setProjectArchived` em `document/commands.ts`).
 */

function locateImportProfile(
  doc: PolicyOpsDocument,
  profileId: string,
): { profile: ImportProfile; index: number } {
  const index = doc.importProfiles.findIndex((candidate) => candidate.id === profileId);
  if (index < 0) {
    throw new DomainError('NOT_FOUND', 'O perfil de carga informado não existe neste documento.', {
      profileId,
    });
  }
  return { profile: doc.importProfiles[index]!, index };
}

// ---------------------------------------------------------------------------
// importProfile/save — cria ou atualiza pelo id; code duplicado com outro id
// é IMPORT_PROFILE_DUPLICATE (I21, validado por `validateProfile`).
// ---------------------------------------------------------------------------

export type SaveImportProfileInput = { profile: ImportProfile };
export type SaveImportProfileData = { profileId: string };

export function saveImportProfile(
  input: SaveImportProfileInput,
): Command<SaveImportProfileInput, SaveImportProfileData> {
  return defineCommand({
    type: 'importProfile/save',
    input,
    label: `Salvar o perfil de carga "${input.profile.code}"`,
    execute(doc, ctx) {
      const issues = validateProfile(doc, input.profile);
      const blocking = issues.find((issue) => issue.severity === 'ERROR');
      if (blocking !== undefined) {
        // Todo código de severidade ERROR de `validateProfile` também é um
        // `DomainErrorCode` (issues.ts: `IMPORT_ERROR_CODES ... satisfies
        // readonly DomainErrorCode[]`) — só o union bruto não carrega essa
        // garantia para o TypeScript.
        throw new DomainError(blocking.code as DomainErrorCode, blocking.message, blocking.details);
      }

      const existingIndex = doc.importProfiles.findIndex((candidate) => candidate.id === input.profile.id);
      const isUpdate = existingIndex >= 0;
      const previous = isUpdate ? structuredClone(doc.importProfiles[existingIndex]!) : null;

      const stored: ImportProfile = isUpdate
        ? { ...input.profile, createdAt: previous!.createdAt, updatedAt: isoFrom(ctx.now()) }
        : { ...input.profile, createdAt: isoFrom(ctx.now()) };

      const event = makeEvent(ctx, {
        type: 'IMPORT_PROFILE_SAVED',
        scope: { projectId: stored.projectId },
        summary: `${ctx.actor} ${isUpdate ? 'atualizou' : 'criou'} o perfil de carga "${stored.code}".`,
        payload: { profileId: stored.id, code: stored.code },
      });

      const inverse: Command = isUpdate
        ? setImportProfileExact({ profile: previous! })
        : removeImportProfileExact({ profileId: stored.id });

      return {
        document: applyToDocument(doc, [event], (draft) => {
          if (isUpdate) draft.importProfiles[existingIndex] = stored;
          else draft.importProfiles.push(stored);
        }),
        data: { profileId: stored.id },
        events: [event],
        inverse,
      };
    },
  });
}

/** Sobrescreve um perfil existente com um valor exato — sem tocar `ctx.now()`. */
function setImportProfileExact(
  input: { profile: ImportProfile },
): Command<{ profile: ImportProfile }, void> {
  return defineCommand({
    type: 'importProfile/_setExact',
    input,
    label: 'Restaurar o perfil de carga anterior',
    execute(doc) {
      const { index } = locateImportProfile(doc, input.profile.id);
      const before = structuredClone(doc.importProfiles[index]!);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.importProfiles[index] = structuredClone(input.profile);
        }),
        data: undefined,
        events: [],
        inverse: setImportProfileExact({ profile: before }),
      };
    },
  });
}

/** Inverso de `importProfile/save` quando criou, e de `importProfile/delete`: remove por id. */
function removeImportProfileExact(input: { profileId: string }): Command<{ profileId: string }, void> {
  return defineCommand({
    type: 'importProfile/_removeExact',
    input,
    label: 'Desfazer a criação do perfil de carga',
    execute(doc) {
      const { profile, index } = locateImportProfile(doc, input.profileId);
      const removed = structuredClone(profile);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.importProfiles.splice(index, 1);
        }),
        data: undefined,
        events: [],
        inverse: restoreImportProfileExact({ profile: removed, index }),
      };
    },
  });
}

/** Reinsere um perfil removido, na posição exata em que estava. */
function restoreImportProfileExact(
  input: { profile: ImportProfile; index: number },
): Command<{ profile: ImportProfile; index: number }, void> {
  return defineCommand({
    type: 'importProfile/_restoreExact',
    input,
    label: 'Restaurar o perfil de carga apagado',
    execute(doc) {
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.importProfiles.splice(input.index, 0, structuredClone(input.profile));
        }),
        data: undefined,
        events: [],
        inverse: removeImportProfileExact({ profileId: input.profile.id }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// importProfile/delete
// ---------------------------------------------------------------------------

export type DeleteImportProfileInput = { profileId: string };

export function deleteImportProfile(
  input: DeleteImportProfileInput,
): Command<DeleteImportProfileInput, void> {
  return defineCommand({
    type: 'importProfile/delete',
    input,
    label: 'Apagar o perfil de carga',
    execute(doc) {
      const { profile, index } = locateImportProfile(doc, input.profileId);
      const removed = structuredClone(profile);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.importProfiles.splice(index, 1);
        }),
        data: undefined,
        events: [],
        inverse: restoreImportProfileExact({ profile: removed, index }),
      };
    },
  });
}
