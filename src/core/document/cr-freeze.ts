import { DomainError } from '../errors';
import { isChangeRequestFrozen } from './cr-workflow';
import type { ChangeRequest, PolicyOpsDocument } from './schema';

/**
 * Congelamento do rascunho vinculado (I25/I30, `E-GOV-01`) — a segunda metade
 * do que docs/14 §5 promete: "a partir de `APPROVED`, itens **e rascunhos
 * vinculados** ficam somente leitura".
 *
 * A S32b congelou os **itens** (`assertItemsEditable`, em `./cr-workflow.ts`);
 * o rascunho que o item aponta continuava editável, e é isso que esta sessão
 * fecha. Vive num módulo próprio, e não em `./cr-workflow.ts`, por dois
 * motivos: o grafo é puro (não conhece documento) e quem chama estas guardas é
 * `src/core/versioning/` — um módulo minúsculo, sem os comandos de DB junto,
 * evita o ciclo `versioning → change-requests → versioning`.
 *
 * **O que congela é edição de conteúdo, não mudança de estado.** Editar
 * células, eixos, payload ou especificação de um rascunho vinculado a um DB
 * aprovado é recusado; **publicar** aquele rascunho por fora do DB continua
 * possível — é publicação direta (RN-GOV-07), e ela não corrompe nada: o item
 * passa a apontar uma versão que não é mais rascunho, o que a avaliação de
 * `assessChangeRequestReadiness` denuncia como pendência
 * (`ITEM_DRAFT_NOT_DRAFT`) e a publicação do DB recusa com `E-GOV-04`. Barrar
 * também a publicação exigiria uma exceção para o próprio
 * `changeRequest/publish`, que publica exatamente esses rascunhos a partir de
 * `READY_FOR_RELEASE` — um estado já congelado (DEC-GOV-034).
 */

/** O DB que vinculou este rascunho — componente ou matriz, pelo `draftVersionId` do item. */
export function findChangeRequestForDraft(
  doc: PolicyOpsDocument,
  versionId: string,
): ChangeRequest | undefined {
  return doc.changeRequests.find((cr) =>
    cr.items.some((item) => item.draftVersionId === versionId),
  );
}

/**
 * Recusa a edição de um rascunho vinculado a um DB congelado (status ≥
 * `APPROVED`). `changeRequestId` é o vínculo de volta que só existe em versão
 * de componente (docs/14 §3.3): conferir os dois lados pega também o caso do
 * rascunho que perdeu o item mas manteve o carimbo.
 */
export function assertLinkedDraftEditable(
  doc: PolicyOpsDocument,
  versionId: string,
  changeRequestId?: string,
): void {
  const byItem = findChangeRequestForDraft(doc, versionId);
  const byBackRef =
    changeRequestId === undefined
      ? undefined
      : doc.changeRequests.find((cr) => cr.id === changeRequestId);

  for (const cr of [byItem, byBackRef]) {
    if (cr === undefined || !isChangeRequestFrozen(cr.status)) continue;
    throw new DomainError(
      'CR_TRANSITION_INVALID',
      `Este rascunho está no escopo da solicitação "${cr.code}", congelada desde ${cr.status}: para editá-lo, devolva o DB para edição ou crie outro.`,
      { changeRequestId: cr.id, status: cr.status, versionId },
    );
  }
}
