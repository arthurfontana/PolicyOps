import { applyToDocument, defineCommand, isoFrom, makeEvent, type Command } from '../command';
import { DomainError } from '../errors';
import { CODE_REGEX, type Matrix, type PolicyOpsDocument, type Project } from './schema';

/**
 * Comandos de documento, projeto e metadados de matriz — docs/08 §3.
 *
 * Nenhum deles gera `DocEvent`: `DocEventType` (docs/03 §8) é normativo e
 * fechado, e não tem tipo para criação/edição de projeto nem para metadados de
 * matriz. Ver a nota sobre a regra 5 em `src/core/command.ts`.
 *
 * O padrão do inverso aqui é sempre o mesmo: **o próprio comando com os
 * valores anteriores**. Nada de "reverter" — o inverso carrega o estado
 * antigo por extenso, e por isso desfazer e refazer devolvem o documento
 * byte a byte, sem depender de `ctx.now()` na hora do desfazer.
 */

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function assertText(value: string, what: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DomainError('INVALID_INPUT', `${what} não pode ficar em branco.`, { value });
  }
  return trimmed;
}

function assertCode(code: string): void {
  if (!CODE_REGEX.test(code)) {
    throw new DomainError(
      'INVALID_INPUT',
      `"${code}" não é um código válido: um código casa ^[A-Z0-9_]+$.`,
      { code },
    );
  }
}

function locateProject(
  doc: PolicyOpsDocument,
  projectId: string,
): { project: Project; index: number } {
  const index = doc.projects.findIndex((candidate) => candidate.id === projectId);
  if (index < 0) {
    throw new DomainError('NOT_FOUND', 'O projeto informado não existe neste documento.', {
      projectId,
    });
  }
  return { project: doc.projects[index]!, index };
}

function locateMatrix(doc: PolicyOpsDocument, matrixId: string): { matrix: Matrix; index: number } {
  const index = doc.matrices.findIndex((candidate) => candidate.id === matrixId);
  if (index < 0) {
    throw new DomainError('NOT_FOUND', 'A matriz informada não existe neste documento.', {
      matrixId,
    });
  }
  return { matrix: doc.matrices[index]!, index };
}

/**
 * Semântica de três estados dos campos opcionais de metadados, igual à das
 * células: ausente = não mexe, `null` = apaga, valor = define. Campos vazios
 * são **omitidos** do documento, nunca gravados como `null` (docs/03 §1).
 */
function optionalTextUpdate(
  target: { description?: string },
  value: string | null | undefined,
  what: string,
): void {
  if (value === undefined) return;
  if (value === null) delete target.description;
  else target.description = assertText(value, what);
}

/** Valor anterior de um campo opcional, no formato que o inverso precisa. */
function previous(value: string | undefined): string | null {
  return value === undefined ? null : value;
}

// ---------------------------------------------------------------------------
// document/rename
// ---------------------------------------------------------------------------

export type RenameDocumentInput = { name: string; description?: string | null };

export function renameDocument(input: RenameDocumentInput): Command<RenameDocumentInput, void> {
  return defineCommand({
    type: 'document/rename',
    input,
    label: 'Renomear o documento',
    execute(doc) {
      const name = assertText(input.name, 'O nome do documento');
      const inverse = renameDocument({
        name: doc.meta.name,
        description: previous(doc.meta.description),
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.meta.name = name;
          optionalTextUpdate(draft.meta, input.description, 'A descrição do documento');
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// project/create · project/update · project/archive
// ---------------------------------------------------------------------------

export type CreateProjectInput = { code: string; name: string; description?: string };

export function createProject(
  input: CreateProjectInput,
): Command<CreateProjectInput, { projectId: string }> {
  return defineCommand({
    type: 'project/create',
    input,
    label: `Criar o projeto "${input.code}"`,
    execute(doc, ctx) {
      assertCode(input.code);
      const name = assertText(input.name, 'O nome do projeto');
      if (doc.projects.some((candidate) => candidate.code === input.code)) {
        throw new DomainError(
          'DUPLICATE_CODE',
          `Já existe um projeto com o código "${input.code}".`,
          { code: input.code },
        );
      }
      const projectId = ctx.newId();
      const project: Project = {
        id: projectId,
        code: input.code,
        name,
        // Projetos entram no fim: `position` é 0-based e sem buracos (docs/03 §1).
        position: doc.projects.length,
        createdAt: isoFrom(ctx.now()),
      };
      if (input.description !== undefined) {
        project.description = assertText(input.description, 'A descrição do projeto');
      }
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.projects.push(project);
        }),
        data: { projectId },
        events: [],
        inverse: removeCreatedProject({ projectId, code: input.code }),
      };
    },
  });
}

/**
 * Inverso de `project/create`. Só remove o **último** projeto da lista — que é
 * sempre o recém-criado, porque a pilha de undo é LIFO e `project/create`
 * sempre acrescenta no fim. Assim `position` continua 0-based e sem buracos.
 */
function removeCreatedProject(input: { projectId: string; code: string }): Command<
  { projectId: string; code: string },
  void
> {
  return defineCommand({
    type: 'project/_removeCreated',
    input,
    label: `Desfazer a criação do projeto "${input.code}"`,
    scope: { projectId: input.projectId },
    execute(doc) {
      const { project, index } = locateProject(doc, input.projectId);
      if (index !== doc.projects.length - 1) {
        throw new DomainError(
          'INVALID_INPUT',
          `O projeto "${project.code}" não é o último da lista e removê-lo abriria um buraco nas posições.`,
          { projectId: project.id },
        );
      }
      if (doc.matrices.some((matrix) => matrix.projectId === project.id)) {
        throw new DomainError(
          'INVALID_INPUT',
          `O projeto "${project.code}" já tem matrizes e não pode ser removido por um desfazer.`,
          { projectId: project.id },
        );
      }
      const removed = structuredClone(project);
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.projects.splice(index, 1);
        }),
        data: undefined,
        events: [],
        inverse: restoreProject({ project: removed, index }),
      };
    },
  });
}

function restoreProject(input: { project: Project; index: number }): Command<
  { project: Project; index: number },
  void
> {
  return defineCommand({
    type: 'project/_restore',
    input,
    label: `Refazer a criação do projeto "${input.project.code}"`,
    scope: { projectId: input.project.id },
    execute(doc) {
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.projects.splice(input.index, 0, structuredClone(input.project));
        }),
        data: undefined,
        events: [],
        inverse: removeCreatedProject({
          projectId: input.project.id,
          code: input.project.code,
        }),
      };
    },
  });
}

export type UpdateProjectInput = {
  projectId: string;
  name?: string;
  description?: string | null;
};

export function updateProject(input: UpdateProjectInput): Command<UpdateProjectInput, void> {
  return defineCommand({
    type: 'project/update',
    input,
    label: 'Editar o projeto',
    scope: { projectId: input.projectId },
    execute(doc) {
      const { project, index } = locateProject(doc, input.projectId);
      const name = input.name === undefined ? undefined : assertText(input.name, 'O nome do projeto');
      const inverse = updateProject({
        projectId: project.id,
        name: project.name,
        description: previous(project.description),
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.projects[index]!;
          if (name !== undefined) target.name = name;
          optionalTextUpdate(target, input.description, 'A descrição do projeto');
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}

export type ArchiveProjectInput = { projectId: string };

export function archiveProject(input: ArchiveProjectInput): Command<ArchiveProjectInput, void> {
  return defineCommand({
    type: 'project/archive',
    input,
    label: 'Arquivar o projeto',
    scope: { projectId: input.projectId },
    execute(doc, ctx) {
      const { project, index } = locateProject(doc, input.projectId);
      const archivedAt = isoFrom(ctx.now());
      const inverse = setProjectArchived({
        projectId: project.id,
        archivedAt: previous(project.archivedAt),
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.projects[index]!.archivedAt = archivedAt;
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}

/**
 * Grava `archivedAt` com um valor exato (ou o remove). É o inverso de
 * `project/archive`: desfazer não pode chamar `ctx.now()` de novo, senão
 * refazer produziria um carimbo diferente do original.
 */
function setProjectArchived(input: { projectId: string; archivedAt: string | null }): Command<
  { projectId: string; archivedAt: string | null },
  void
> {
  return defineCommand({
    type: 'project/_setArchived',
    input,
    label: input.archivedAt === null ? 'Desarquivar o projeto' : 'Arquivar o projeto',
    scope: { projectId: input.projectId },
    execute(doc) {
      const { project, index } = locateProject(doc, input.projectId);
      const inverse = setProjectArchived({
        projectId: project.id,
        archivedAt: previous(project.archivedAt),
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.projects[index]!;
          if (input.archivedAt === null) delete target.archivedAt;
          else target.archivedAt = input.archivedAt;
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// matrix/updateMeta · matrix/archive
// ---------------------------------------------------------------------------

export type UpdateMatrixMetaInput = {
  matrixId: string;
  name?: string;
  description?: string | null;
};

export function updateMatrixMeta(
  input: UpdateMatrixMetaInput,
): Command<UpdateMatrixMetaInput, void> {
  return defineCommand({
    type: 'matrix/updateMeta',
    input,
    label: 'Editar a matriz',
    scope: { matrixId: input.matrixId },
    execute(doc) {
      const { matrix, index } = locateMatrix(doc, input.matrixId);
      const name = input.name === undefined ? undefined : assertText(input.name, 'O nome da matriz');
      const inverse = updateMatrixMeta({
        matrixId: matrix.id,
        name: matrix.name,
        description: previous(matrix.description),
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.matrices[index]!;
          if (name !== undefined) target.name = name;
          optionalTextUpdate(target, input.description, 'A descrição da matriz');
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// matrix/setTags — docs/08 §3, docs/12 US-09 e RN-12
// ---------------------------------------------------------------------------

export type SetMatrixTagsInput = { matrixId: string; add?: string[]; remove?: string[] };

/**
 * Acrescenta e remove tags de uma matriz. **Idempotente**: acrescentar uma tag
 * que já está lá não duplica nem falha, e remover uma que não está é no-op — é
 * o que permite a carga aplicar as tags do perfil a cada rodada sem tocar no
 * que foi marcado à mão (RN-12: a carga só usa `add`).
 *
 * I20: toda tag apontada precisa existir no catálogo como item de kind `TAG`.
 * A ordem final é a de inserção, e o campo é **omitido** quando a lista fica
 * vazia (docs/03 §1).
 */
export function setMatrixTags(input: SetMatrixTagsInput): Command<SetMatrixTagsInput, { tags: string[] }> {
  return defineCommand({
    type: 'matrix/setTags',
    input,
    label: 'Alterar as tags da matriz',
    scope: { matrixId: input.matrixId },
    execute(doc, ctx) {
      const { matrix, index } = locateMatrix(doc, input.matrixId);
      const add = input.add ?? [];
      const remove = new Set(input.remove ?? []);

      for (const code of add) {
        assertCode(code);
        const item = doc.catalog.find(
          (candidate) => candidate.kind === 'TAG' && candidate.code === code,
        );
        if (item === undefined) {
          throw new DomainError('TAG_NOT_FOUND', `A tag "${code}" não existe no catálogo.`, {
            code,
            matrixId: matrix.id,
          });
        }
      }

      const current = matrix.tags ?? [];
      const next = current.filter((code) => !remove.has(code));
      for (const code of add) {
        if (!next.includes(code)) next.push(code);
      }

      const added = next.filter((code) => !current.includes(code));
      const removed = current.filter((code) => !next.includes(code));
      const inverse = setMatrixTags({
        matrixId: matrix.id,
        add: removed,
        remove: added,
      });

      // Nada mudou: sem evento e sem escrita, para que a carga possa chamar o
      // comando por matriz sem sujar a auditoria (RN-02).
      const events =
        added.length === 0 && removed.length === 0
          ? []
          : [
              makeEvent(ctx, {
                type: 'MATRIX_TAGGED',
                scope: { projectId: matrix.projectId, matrixId: matrix.id },
                summary: tagSummary(ctx.actor, matrix.code, added, removed),
                payload: { added, removed, tags: next },
              }),
            ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          const target = draft.matrices[index]!;
          if (next.length === 0) delete target.tags;
          else target.tags = next;
        }),
        data: { tags: next },
        events,
        inverse,
      };
    },
  });
}

function tagSummary(actor: string, code: string, added: string[], removed: string[]): string {
  const parts: string[] = [];
  if (added.length > 0) parts.push(`aplicou ${added.join(', ')}`);
  if (removed.length > 0) parts.push(`removeu ${removed.join(', ')}`);
  return `${actor} ${parts.join(' e ')} em "${code}".`;
}

export type ArchiveMatrixInput = { matrixId: string };

export function archiveMatrix(input: ArchiveMatrixInput): Command<ArchiveMatrixInput, void> {
  return defineCommand({
    type: 'matrix/archive',
    input,
    label: 'Arquivar a matriz',
    scope: { matrixId: input.matrixId },
    execute(doc, ctx) {
      const { matrix, index } = locateMatrix(doc, input.matrixId);
      const archivedAt = isoFrom(ctx.now());
      const inverse = setMatrixArchived({
        matrixId: matrix.id,
        archivedAt: previous(matrix.archivedAt),
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          draft.matrices[index]!.archivedAt = archivedAt;
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}

function setMatrixArchived(input: { matrixId: string; archivedAt: string | null }): Command<
  { matrixId: string; archivedAt: string | null },
  void
> {
  return defineCommand({
    type: 'matrix/_setArchived',
    input,
    label: input.archivedAt === null ? 'Desarquivar a matriz' : 'Arquivar a matriz',
    scope: { matrixId: input.matrixId },
    execute(doc) {
      const { matrix, index } = locateMatrix(doc, input.matrixId);
      const inverse = setMatrixArchived({
        matrixId: matrix.id,
        archivedAt: previous(matrix.archivedAt),
      });
      return {
        document: applyToDocument(doc, [], (draft) => {
          const target = draft.matrices[index]!;
          if (input.archivedAt === null) delete target.archivedAt;
          else target.archivedAt = input.archivedAt;
        }),
        data: undefined,
        events: [],
        inverse,
      };
    },
  });
}
