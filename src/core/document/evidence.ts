import { applyToDocument, defineCommand, isoFrom, makeEvent, type Command } from '../command';
import { DomainError } from '../errors';
import { isEvidenceAttachment } from './schema';
import type {
  AttachmentTarget,
  DocEvent,
  EvidenceAttachment,
  Matrix,
  PolicyOpsDocument,
} from './schema';

/**
 * Evidências — o vínculo entre o documento e o acervo `_evidencias/`
 * (docs/14-plataforma-local.md §7, ADR-004).
 *
 * A divisão de trabalho é a mesma de todo o resto (ADR-002): **o arquivo é do
 * servidor, o vínculo é do documento**. Este módulo só mexe no vínculo — é
 * `src/core/` puro, não conhece `fetch`, caminho absoluto nem pasta de rede.
 * Quem copia, confere hash e move para a lixeira é `POST/GET/DELETE
 * /api/evidences` (`src/storage/evidences.ts`).
 *
 * Duas consequências dessa divisão valem por si:
 *
 * 1. **`detachEvidence` não apaga nada.** Ele tira a entrada de `attachments`,
 *    e só isso. A ida para `_evidencias/_lixeira/` acontece depois de um
 *    salvamento bem-sucedido (`persistence-store.ts`), porque desfazer um
 *    desanexo não pode depender de um arquivo que já se moveu.
 * 2. **Anexo em versão publicada é permitido** e não fere I3: `attachments`
 *    vive fora do snapshot da versão, como os eventos de auditoria. A evidência
 *    normalmente chega *depois* da publicação — é o caso típico, não a exceção.
 *
 * Desde o schema 5, `attachments` é uma coleção **discriminada**: evidência do
 * acervo (`kind: 'EVIDENCE'`) e imagem embutida do editor rico
 * (`kind: 'INLINE_IMAGE'`, docs/14-governanca-de-alteracoes.md §7) convivem
 * nela. Todo este módulo é sobre evidência, e por isso filtra por `kind` antes
 * de qualquer coisa — uma imagem de especificação não é anexo de matriz nem vai
 * para a lixeira do acervo.
 */

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export function sameTarget(a: AttachmentTarget, b: AttachmentTarget): boolean {
  if (a.kind === 'PROJECT') return b.kind === 'PROJECT' && a.projectId === b.projectId;
  if (a.kind === 'MATRIX') return b.kind === 'MATRIX' && a.matrixId === b.matrixId;
  return b.kind === 'VERSION' && a.matrixId === b.matrixId && a.versionNumber === b.versionNumber;
}

/**
 * Evidências de um alvo, na ordem em que foram anexadas — a lista é
 * **append-only por alvo** (docs/14 §7): anexo novo entra no fim, e nada
 * reordena o que já estava lá.
 */
export function listAttachments(
  doc: PolicyOpsDocument,
  target: AttachmentTarget,
): EvidenceAttachment[] {
  return listEvidences(doc).filter((attachment) => sameTarget(attachment.target, target));
}

/** Só as evidências do acervo — as imagens embutidas do `RichDoc` ficam de fora. */
export function listEvidences(doc: PolicyOpsDocument | null): EvidenceAttachment[] {
  return (doc?.attachments ?? []).filter(isEvidenceAttachment);
}

export function findAttachment(doc: PolicyOpsDocument, id: string): EvidenceAttachment | null {
  return listEvidences(doc).find((attachment) => attachment.id === id) ?? null;
}

/**
 * Todos os caminhos do acervo que este documento reivindica. É o que a camada
 * de persistência compara entre dois salvamentos para descobrir o que foi
 * desanexado e mandar para a lixeira.
 */
export function attachmentRelPaths(doc: PolicyOpsDocument | null): string[] {
  return listEvidences(doc).map((attachment) => attachment.relPath);
}

// ---------------------------------------------------------------------------
// Alvo → escopo de auditoria e validação de existência
// ---------------------------------------------------------------------------

function locateMatrix(doc: PolicyOpsDocument, matrixId: string): Matrix {
  const matrix = doc.matrices.find((candidate) => candidate.id === matrixId);
  if (matrix === undefined) {
    throw new DomainError('NOT_FOUND', 'A matriz informada não existe neste documento.', { matrixId });
  }
  return matrix;
}

/** Confere que o alvo existe (I25) e devolve o `scope` do evento de auditoria. */
function scopeForTarget(doc: PolicyOpsDocument, target: AttachmentTarget): DocEvent['scope'] {
  if (target.kind === 'PROJECT') {
    const project = doc.projects.find((candidate) => candidate.id === target.projectId);
    if (project === undefined) {
      throw new DomainError('NOT_FOUND', 'O projeto informado não existe neste documento.', {
        projectId: target.projectId,
      });
    }
    return { projectId: project.id };
  }

  const matrix = locateMatrix(doc, target.matrixId);
  if (target.kind === 'MATRIX') {
    return { projectId: matrix.projectId, matrixId: matrix.id };
  }

  const version = matrix.versions.find((candidate) => candidate.number === target.versionNumber);
  if (version === undefined) {
    throw new DomainError(
      'NOT_FOUND',
      `A matriz "${matrix.name}" não tem versão ${target.versionNumber}.`,
      { matrixId: matrix.id, versionNumber: target.versionNumber },
    );
  }
  return { projectId: matrix.projectId, matrixId: matrix.id, versionId: version.id };
}

/** *"na versão 12 de Limite de Crédito — PF"* — o pedaço variável do `summary`. */
export function describeTarget(doc: PolicyOpsDocument, target: AttachmentTarget): string {
  if (target.kind === 'PROJECT') {
    const project = doc.projects.find((candidate) => candidate.id === target.projectId);
    return `no projeto ${project?.name ?? '(desconhecido)'}`;
  }
  const matrix = doc.matrices.find((candidate) => candidate.id === target.matrixId);
  const name = matrix?.name ?? '(desconhecida)';
  return target.kind === 'MATRIX' ? `na matriz ${name}` : `na versão ${target.versionNumber} de ${name}`;
}

// ---------------------------------------------------------------------------
// evidence/attach
// ---------------------------------------------------------------------------

export type AttachEvidenceInput = {
  /** Vem de `POST /api/evidences` (o servidor gera no formato `nanoid(12)`); ausente, sai de `ctx.newId()`. */
  id?: string;
  fileName: string;
  relPath: string;
  sha256: string;
  bytes: number;
  addedBy: { username: string; displayName?: string };
  /** Ausente = `ctx.now()`. Presente só no inverso do desanexo, que restaura o registro exato. */
  addedAt?: string;
  note?: string;
  target: AttachmentTarget;
  /**
   * Posição em que a entrada volta para a lista. **Só o inverso de
   * `evidence/detach` usa isto**: anexar de verdade é sempre append (docs/14
   * §7), mas desfazer um desanexo precisa devolver o documento byte a byte,
   * inclusive a ordem de `attachments`.
   */
  atIndex?: number;
};

export function attachEvidence(
  input: AttachEvidenceInput,
): Command<AttachEvidenceInput, EvidenceAttachment> {
  return defineCommand({
    type: 'evidence/attach',
    input,
    label: 'Anexar evidência',
    execute(doc, ctx) {
      const relPath = input.relPath.trim();
      if (relPath === '' || input.sha256.trim() === '') {
        throw new DomainError(
          'INVALID_INPUT',
          'A evidência precisa do caminho no acervo e do hash devolvidos pelo servidor.',
          { relPath: input.relPath },
        );
      }

      if (listEvidences(doc).some((attachment) => attachment.relPath === relPath)) {
        throw new DomainError(
          'EVIDENCE_DUPLICATE_PATH',
          `O arquivo ${relPath} já está anexado neste documento.`,
          { relPath },
        );
      }

      const scope = scopeForTarget(doc, input.target);

      const attachment: EvidenceAttachment = {
        kind: 'EVIDENCE',
        id: input.id ?? ctx.newId(),
        fileName: input.fileName,
        relPath,
        sha256: input.sha256,
        bytes: input.bytes,
        addedBy: input.addedBy,
        addedAt: input.addedAt ?? isoFrom(ctx.now()),
        target: input.target,
      };
      if (input.note !== undefined && input.note.trim() !== '') attachment.note = input.note.trim();

      const events = [
        makeEvent(ctx, {
          type: 'EVIDENCE_ATTACHED',
          scope,
          summary: `${ctx.actor} anexou a evidência "${attachment.fileName}" ${describeTarget(doc, input.target)}.`,
          payload: { attachmentId: attachment.id, relPath, sha256: attachment.sha256, bytes: attachment.bytes },
        }),
      ];

      return {
        document: applyToDocument(doc, events, (draft) => {
          if (draft.attachments === undefined) draft.attachments = [];
          const list = draft.attachments;
          const at = input.atIndex === undefined ? list.length : Math.min(input.atIndex, list.length);
          list.splice(at, 0, attachment);
        }),
        data: attachment,
        events,
        inverse: detachEvidence({ id: attachment.id }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// evidence/detach
// ---------------------------------------------------------------------------

export type DetachEvidenceInput = { id: string };

export function detachEvidence(
  input: DetachEvidenceInput,
): Command<DetachEvidenceInput, EvidenceAttachment> {
  return defineCommand({
    type: 'evidence/detach',
    input,
    label: 'Desanexar evidência',
    execute(doc, ctx) {
      const list = doc.attachments ?? [];
      const index = list.findIndex(
        (attachment) => attachment.id === input.id && isEvidenceAttachment(attachment),
      );
      if (index < 0) {
        throw new DomainError('EVIDENCE_NOT_FOUND', 'Essa evidência não está anexada neste documento.', {
          id: input.id,
        });
      }
      const attachment = list[index] as EvidenceAttachment;

      // O alvo pode ter sido apagado depois do anexo (I25 é validada na
      // gravação, não impede o documento em memória de existir) — desanexar
      // continua possível, só sem escopo de auditoria para pendurar o evento.
      let scope: DocEvent['scope'];
      try {
        scope = scopeForTarget(doc, attachment.target);
      } catch {
        scope = {};
      }

      const events = [
        makeEvent(ctx, {
          type: 'EVIDENCE_DETACHED',
          scope,
          summary: `${ctx.actor} desanexou a evidência "${attachment.fileName}" ${describeTarget(doc, attachment.target)}. O arquivo vai para a lixeira do acervo no próximo salvamento.`,
          payload: { attachmentId: attachment.id, relPath: attachment.relPath },
        }),
      ];

      /** Inverso exato: o mesmo registro, na mesma posição — inclusive `id` e `addedAt`. */
      const inverse = attachEvidence({
        id: attachment.id,
        fileName: attachment.fileName,
        relPath: attachment.relPath,
        sha256: attachment.sha256,
        bytes: attachment.bytes,
        addedBy: attachment.addedBy,
        addedAt: attachment.addedAt,
        target: attachment.target,
        atIndex: index,
        ...(attachment.note === undefined ? {} : { note: attachment.note }),
      });

      return {
        document: applyToDocument(doc, events, (draft) => {
          const drafted = draft.attachments;
          if (drafted === undefined) return;
          drafted.splice(index, 1);
          // Lista vazia não é gravada (docs/03 §1) — some do documento inteiro.
          if (drafted.length === 0) delete draft.attachments;
        }),
        data: attachment,
        events,
        inverse,
      };
    },
  });
}
