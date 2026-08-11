import type { PolicyOpsDocument } from '../document/schema';

/**
 * Vocabulário do merge de documentos — docs/06-persistencia-e-concorrencia.md §7.
 *
 * As duas tabelas de §7 estão transcritas aqui como tipos: `MergeAction` é a
 * tabela do que é **resolvido automaticamente**, `MergeConflict` é a tabela do
 * que **exige decisão do usuário**. A tela de merge não inventa categoria
 * nenhuma: ela renderiza estas duas listas.
 */

/** De qual dos dois documentos veio o que foi aplicado. */
export type MergeSide = 'MINE' | 'THEIRS';

export type MergeEntityKind =
  | 'DOCUMENT'
  | 'VARIABLE'
  | 'COMPATIBILITY'
  | 'CATALOG'
  | 'PROJECT'
  | 'MATRIX'
  | 'MATRIX_VERSION'
  | 'TEMPLATE'
  | 'IMPORT_PROFILE'
  | 'EVENTS';

export type MergeEntityRef = {
  kind: MergeEntityKind;
  id: string;
  /** Rótulo pronto em pt-BR — código e nome, do jeito que a tela mostra. */
  label: string;
  /** Presente em `MATRIX_VERSION`: a matriz dona da versão. */
  matrixId?: string;
};

/**
 * As cinco linhas da tabela "resolvido automaticamente" de §7, mais as três
 * normalizações que o merge precisa fazer para o documento continuar válido
 * (renumeração, renomeação e arquivamento do perdedor de um "manter os dois").
 */
export type MergeActionKind =
  | 'UNION_PUBLISHED_VERSION'
  | 'UNION_DRAFT'
  | 'UNION_LIBRARY_ITEM'
  | 'UNION_PROJECT'
  | 'UNION_MATRIX'
  | 'UNION_TEMPLATE'
  | 'UNION_IMPORT_PROFILE'
  | 'UNION_EVENTS'
  | 'CHANGED_SIDE_WINS'
  | 'LIFECYCLE_ADVANCED'
  | 'RENUMBERED'
  | 'RENAMED'
  | 'ARCHIVED_LOSER'
  | 'META_MERGED';

export type MergeAction = {
  kind: MergeActionKind;
  /** `'BOTH'` quando os dois lados contribuíram (união de eventos, metadados). */
  side: MergeSide | 'BOTH';
  entity: MergeEntityRef;
  /** Frase pronta em pt-BR — é o que a tela lista. */
  summary: string;
  /**
   * Aplicado automaticamente, mas alguém precisa olhar depois: é o "sinaliza
   * para revisão manual" de §7.
   */
  needsReview?: boolean;
};

/** As quatro linhas da tabela "conflito, exige decisão do usuário" de §7. */
export type MergeConflictKind =
  | 'DRAFT_DIVERGED'
  | 'PUBLISHED_CLASH'
  | 'ITEM_DIVERGED'
  | 'CODE_CLASH';

export type MergeChoice = 'MINE' | 'THEIRS' | 'KEEP_BOTH';

/** Uma diferença campo a campo — §7 pede exatamente isso para itens de biblioteca. */
export type MergeFieldDiff = {
  key: string;
  label: string;
  mine: string;
  theirs: string;
  /**
   * `false` em campo estrutural (código, tipo, posição, eixos): escolher esses
   * campo a campo poderia montar um item incoerente, então eles seguem a
   * escolha do item inteiro. A tela mostra a diferença assim mesmo.
   */
  choosable: boolean;
};

export type MergeConflictOption = {
  choice: MergeChoice;
  label: string;
  /** O que acontece com o que **não** foi escolhido. Sem eufemismo. */
  detail: string;
};

/**
 * Como a tela previsualiza cada lado. Versões de matriz abrem a tela de
 * comparação da S14; o resto mostra a tabela campo a campo.
 */
export type MergeConflictPreview =
  | {
      kind: 'MATRIX_VERSION';
      matrixId: string;
      /** `null` quando o lado não tem versão correspondente para comparar. */
      mineVersionId: string | null;
      theirsVersionId: string | null;
    }
  | { kind: 'FIELDS' };

export type MergeConflict = {
  /**
   * Determinístico e estável entre execuções: é a chave que liga a decisão
   * tomada na tela ao conflito recalculado a cada mudança de resolução.
   */
  id: string;
  kind: MergeConflictKind;
  entity: MergeEntityRef;
  title: string;
  summary: string;
  options: MergeConflictOption[];
  defaultChoice: MergeChoice;
  fields: MergeFieldDiff[];
  preview: MergeConflictPreview;
};

/** Decisão do usuário para um conflito, com os ajustes campo a campo. */
export type MergeResolution = {
  choice: MergeChoice;
  /** `campo → lado`, sobrepondo a escolha do item para aquele campo. */
  fields?: Record<string, MergeSide>;
};

export type MergeResolutions = Record<string, MergeResolution>;

export type MergeOptions = {
  resolutions?: MergeResolutions;
  /**
   * Instante do merge, usado nos carimbos (`archivedAt` do perdedor de um
   * "manter os dois"). Omitido, é o instante mais recente conhecido pelos dois
   * documentos — o merge continua puro e determinístico.
   */
  at?: string;
};

export type MergeResult = {
  merged: PolicyOpsDocument;
  applied: MergeAction[];
  conflicts: MergeConflict[];
};

export const MERGE_ACTION_LABEL: Record<MergeActionKind, string> = {
  UNION_PUBLISHED_VERSION: 'Versão publicada',
  UNION_DRAFT: 'Rascunho',
  UNION_LIBRARY_ITEM: 'Item de biblioteca',
  UNION_PROJECT: 'Projeto',
  UNION_MATRIX: 'Matriz',
  UNION_TEMPLATE: 'Template',
  UNION_IMPORT_PROFILE: 'Perfil de carga',
  UNION_EVENTS: 'Histórico',
  CHANGED_SIDE_WINS: 'Item alterado de um lado só',
  LIFECYCLE_ADVANCED: 'Ciclo de vida avançou',
  RENUMBERED: 'Renumeração',
  RENAMED: 'Código renomeado',
  ARCHIVED_LOSER: 'Versão arquivada',
  META_MERGED: 'Dados do documento',
};

export const MERGE_CONFLICT_LABEL: Record<MergeConflictKind, string> = {
  DRAFT_DIVERGED: 'Rascunhos diferentes da mesma matriz',
  PUBLISHED_CLASH: 'Mesma versão publicada com conteúdo diferente',
  ITEM_DIVERGED: 'Mesmo item editado dos dois lados',
  CODE_CLASH: 'Mesmo código para entidades diferentes',
};

export const MERGE_SIDE_LABEL: Record<MergeSide | 'BOTH', string> = {
  MINE: 'o meu',
  THEIRS: 'o do arquivo',
  BOTH: 'os dois',
};
