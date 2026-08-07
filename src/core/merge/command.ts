import {
  applyToDocument,
  defineCommand,
  irreversible,
  isoFrom,
  makeEvent,
  type Command,
} from '../command';
import type { PolicyOpsDocument } from '../document/schema';
import { mergeDocuments } from './documents';
import type { MergeAction, MergeConflict, MergeResolutions } from './types';

/**
 * `document/merge` — docs/08-camada-de-comandos.md §3 e
 * docs/06-persistencia-e-concorrencia.md §7.
 *
 * O comando é a casca fina em volta de `mergeDocuments`: o merge em si é puro
 * e não conhece `Ctx`; o que o comando acrescenta é o carimbo de tempo do
 * merge e o evento `DOCUMENT_MERGED` com o resumo completo — quem foi
 * mesclado, o que entrou automaticamente e que decisão foi tomada em cada
 * conflito.
 *
 * Sem inverso: desfazer um merge devolveria o documento a um estado que
 * ignora o que a outra pessoa salvou, e o arquivo em disco já tem o conteúdo
 * dela. Para voltar atrás, o caminho é abrir o backup (§9).
 */

export type MergeDocumentInput = {
  /** O documento que está no arquivo — o "deles" de §7. */
  theirs: PolicyOpsDocument;
  resolutions?: MergeResolutions;
};

export type MergeDocumentData = {
  applied: MergeAction[];
  conflicts: MergeConflict[];
};

export function mergeDocument(
  input: MergeDocumentInput,
): Command<MergeDocumentInput, MergeDocumentData> {
  return defineCommand({
    type: 'document/merge',
    input,
    label: 'Mesclar com o arquivo',
    execute(doc, ctx) {
      const at = isoFrom(ctx.now());
      const { merged, applied, conflicts } = mergeDocuments(doc, input.theirs, {
        at,
        ...(input.resolutions === undefined ? {} : { resolutions: input.resolutions }),
      });

      const who = input.theirs.meta.savedBy ?? 'outra pessoa';
      const event = makeEvent(ctx, {
        type: 'DOCUMENT_MERGED',
        scope: {},
        summary: `${ctx.actor} mesclou o documento com a revisão ${input.theirs.meta.revision} salva por ${who}: ${applied.length} aplicação(ões) automática(s) e ${conflicts.length} decisão(ões).`,
        payload: {
          remoteRevision: input.theirs.meta.revision,
          remoteSavedBy: input.theirs.meta.savedBy,
          remoteSavedAt: input.theirs.meta.savedAt,
          appliedCount: applied.length,
          conflictCount: conflicts.length,
          // O resumo completo, em frases prontas: é o que a timeline mostra e
          // o que permite auditar um merge meses depois.
          applied: applied.map((action) => action.summary),
          needsReview: applied.filter((action) => action.needsReview === true).map((action) => action.summary),
          decisions: conflicts.map((conflict) => ({
            conflict: conflict.title,
            choice: input.resolutions?.[conflict.id]?.choice ?? conflict.defaultChoice,
          })),
        },
      });

      return {
        document: applyToDocument(merged, [event], () => {}),
        data: { applied, conflicts },
        events: [event],
        inverse: irreversible(
          'Mesclar dois documentos não pode ser desfeito: o arquivo em disco já tem o conteúdo da outra pessoa. Para voltar atrás, abra um backup automático da pasta _backups.',
        ),
      };
    },
  });
}
