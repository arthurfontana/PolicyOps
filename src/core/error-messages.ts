import { DOMAIN_ERROR_CODES, type DomainErrorCode } from './errors';

/**
 * Mensagem pt-BR para cada código de `DomainErrorCode`. A interface nunca
 * mostra o código cru — sempre traduz por aqui (docs/05-regras-de-negocio.md §9).
 */
export const ERROR_MESSAGES: Record<DomainErrorCode, string> = {
  NOT_FOUND: 'O item procurado não foi encontrado.',
  DUPLICATE_CODE: 'Já existe um item com esse código neste escopo. Escolha outro.',
  INVALID_INPUT: 'Os dados informados são inválidos.',
  VARIABLE_HAS_NO_PUBLISHED_VERSION:
    'Esta variável ainda não tem nenhuma versão publicada — publique uma versão na biblioteca antes de usá-la num eixo.',
  VARIABLE_VERSION_IMMUTABLE: 'Esta versão da variável já foi publicada e não pode mais ser alterada.',
  INVALID_DOMAIN_SET:
    'O conjunto de domínios da variável é inválido — são necessários pelo menos 2 domínios.',
  RANGE_NOT_CONTIGUOUS:
    'As faixas da variável precisam ser contíguas, ordenadas e ter exatamente uma faixa "acima de" ao final.',
  BOOLEAN_NEEDS_TWO_DOMAINS: 'Uma variável booleana precisa ter exatamente 2 domínios.',
  COMPATIBILITY_PAIR_DUPLICATE:
    'Já existe uma regra de compatibilidade publicada para este par de variáveis.',
  COMPATIBILITY_VERSION_IMMUTABLE:
    'Esta versão da regra de compatibilidade já foi publicada e não pode mais ser alterada.',
  DRAFT_ALREADY_EXISTS:
    'Esta matriz já tem um rascunho em andamento. Abra-o ou descarte-o antes de criar outro.',
  NO_VERSION_TO_DERIVE: 'Não há versão vigente para derivar um rascunho — informe a versão de origem.',
  VERSION_NOT_DRAFT: 'Esta ação só é permitida enquanto a versão está em rascunho.',
  VERSION_IMMUTABLE: 'Esta versão já foi publicada e não pode mais ser editada.',
  NOTES_REQUIRED: 'Descreva o que mudou nesta publicação (mínimo de 10 caracteres).',
  UNSET_CELLS_REMAIN: 'Ainda há combinações pendentes de decisão — preencha todas antes de publicar.',
  CELL_GRID_INCONSISTENT: 'A grade de células está inconsistente com os eixos atuais da matriz.',
  INVALID_COORD: 'A coordenada informada não existe nos eixos desta matriz.',
  CATALOG_KIND_MISMATCH: 'O item do catálogo informado não é do tipo esperado para este campo.',
  CATALOG_ITEM_ARCHIVED: 'Este item do catálogo foi descontinuado e não pode ser usado em novas células.',
  CATALOG_REF_MISSING: 'Uma célula referencia um item do catálogo que não existe mais.',
  LIMIT_NEEDS_NUMERIC_VALUE: 'Itens de limite precisam de um valor numérico.',
  EFFECTIVE_DATE_INVALID:
    'A data de vigência informada é inválida — não pode ser retroativa nem anterior à vigência da versão atual.',
  PATCH_TOO_LARGE: 'A edição em massa abrange combinações demais para ser aplicada de uma vez.',
  TOO_MANY_LEVELS: 'Um eixo pode ter no máximo 3 níveis de variáveis.',
  DUPLICATE_VARIABLE_IN_AXIS: 'Esta variável já está em outro nível deste eixo.',
  VARIABLE_ON_BOTH_AXES: 'Esta variável já está em uso no outro eixo da matriz.',
  AXIS_NEEDS_ONE_LEVEL:
    'Um eixo precisa ter pelo menos um nível — remova a matriz em vez de esvaziar o eixo.',
  NO_VALID_TUPLES: 'Nenhuma combinação válida resulta desta configuração de eixos.',
  GRID_TOO_LARGE: 'Esta configuração de eixos geraria combinações demais para a matriz.',
  AXIS_NOT_STALE: 'Este eixo já está atualizado com a versão mais recente da biblioteca.',
  VERSIONS_NOT_COMPARABLE:
    'Estas versões têm estruturas de eixos diferentes e não podem ser comparadas diretamente.',
  DOCUMENT_SCHEMA_TOO_NEW:
    'Este arquivo foi salvo por uma versão mais nova do PolicyOps. Atualize a aplicação para abri-lo.',
  DOCUMENT_INVALID: 'O arquivo de dados está corrompido ou não é um documento válido do PolicyOps.',
  SAVE_CONFLICT:
    'Outra pessoa salvou este arquivo enquanto você editava. Revise as mudanças antes de salvar novamente.',
};

export function getErrorMessage(code: DomainErrorCode): string {
  return ERROR_MESSAGES[code];
}

/** Usado em teste: garante que todo código do catálogo tem mensagem. */
export function assertAllErrorCodesHaveMessages(): void {
  for (const code of DOMAIN_ERROR_CODES) {
    if (!ERROR_MESSAGES[code]) {
      throw new Error(`Falta mensagem pt-BR para o código de erro "${code}".`);
    }
  }
}
