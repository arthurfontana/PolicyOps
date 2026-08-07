import type { PolicyOpsDocument } from '@/core/document/schema';

/**
 * Resumo de topo de um conflito de salvamento —
 * docs/06-persistencia-e-concorrencia.md §5.
 *
 * Quem salvou, quando, e o que entrou ou saiu em cada coleção do documento.
 * A comparação célula a célula é outra coisa e mora em `src/core/diff/`
 * (S14): "Ver o que mudou" abre a tela de comparação de verdade, e esta lista
 * fica lá dentro como cabeçalho — é o contexto que o diff de uma versão de
 * matriz não dá.
 */

export type ConflictLine = {
  label: string;
  mine: string;
  theirs: string;
  changed: boolean;
};

function formatDateTime(iso: string | null): string {
  if (iso === null) return 'nunca salvo';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('pt-BR');
}

function countVersions(doc: PolicyOpsDocument): number {
  return doc.matrices.reduce((total, matrix) => total + matrix.versions.length, 0);
}

function line(label: string, mine: string, theirs: string): ConflictLine {
  return { label, mine, theirs, changed: mine !== theirs };
}

/** Comparação campo a campo entre o documento remoto e o meu. */
export function summarizeConflict(
  mine: PolicyOpsDocument,
  theirs: PolicyOpsDocument,
): ConflictLine[] {
  return [
    line('Revisão', String(mine.meta.revision), String(theirs.meta.revision)),
    line('Salvo por', mine.meta.savedBy ?? '—', theirs.meta.savedBy ?? '—'),
    line('Salvo em', formatDateTime(mine.meta.savedAt), formatDateTime(theirs.meta.savedAt)),
    line('Nome do documento', mine.meta.name, theirs.meta.name),
    line('Variáveis', String(mine.variables.length), String(theirs.variables.length)),
    line(
      'Regras de compatibilidade',
      String(mine.compatibility.length),
      String(theirs.compatibility.length),
    ),
    line('Itens de catálogo', String(mine.catalog.length), String(theirs.catalog.length)),
    line('Projetos', String(mine.projects.length), String(theirs.projects.length)),
    line('Matrizes', String(mine.matrices.length), String(theirs.matrices.length)),
    line('Versões de matriz', String(countVersions(mine)), String(countVersions(theirs))),
    line('Eventos de auditoria', String(mine.events.length), String(theirs.events.length)),
  ];
}

/** Eventos que existem só no lado remoto — o que a outra pessoa fez. */
export function remoteOnlyEvents(mine: PolicyOpsDocument, theirs: PolicyOpsDocument) {
  const known = new Set(mine.events.map((event) => event.id));
  return theirs.events.filter((event) => !known.has(event.id));
}

export function conflictHeadline(theirs: PolicyOpsDocument): string {
  const who = theirs.meta.savedBy ?? 'Outra pessoa';
  const when = formatDateTime(theirs.meta.savedAt);
  return `${who} salvou este arquivo em ${when} (revisão ${theirs.meta.revision}) depois de você abri-lo. Nada foi gravado.`;
}

/**
 * O que "Mesclar" faz, dito antes de o usuário clicar
 * (docs/06-persistencia-e-concorrencia.md §5 e §7).
 */
export const MERGE_EXPLANATION =
  'Mesclar junta os dois documentos: tudo que só existe de um lado entra por união, e você decide o que fazer nos poucos pontos em que os dois divergem. Nada é gravado antes de você ver o resultado.';

export const DOWNLOAD_ONLY_CONFLICT_WARNING =
  'Neste modo a aplicação não consegue reler o arquivo, e por isso não detecta conflito: se outra pessoa salvar enquanto você edita, nada avisa. Use o bloqueio consultivo, combine com o time quem edita e salve com frequência.';
