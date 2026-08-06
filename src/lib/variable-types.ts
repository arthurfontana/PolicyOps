import type { VariableType } from '@/core/document/schema';

/** Rótulos pt-BR dos tipos de variável — compartilhado entre lista, criação e detalhe. */
export const VARIABLE_TYPE_LABELS: Record<VariableType, string> = {
  ORDINAL: 'Ordinal',
  CATEGORICAL: 'Categórica',
  RANGE: 'Faixa',
  BOOLEAN: 'Booleana',
};
