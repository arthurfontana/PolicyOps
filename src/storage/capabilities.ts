/**
 * Detecção de recursos do navegador — docs/06-persistencia-e-concorrencia.md §1.
 *
 * Regra desta camada: **nada é presumido**. A detecção tem dois estágios, e o
 * segundo existe porque o primeiro nunca é conclusivo:
 *
 * 1. **Medir o ambiente**: as funções existem? o contexto é seguro? a origem
 *    é opaca? São os dois requisitos que §1 enuncia, lidos do próprio
 *    ambiente — e não inferidos de "o protocolo é file://".
 * 2. **Chamar de verdade**, na primeira interação do usuário: existe
 *    navegador que expõe `showOpenFilePicker` e recusa a chamada. A falha é
 *    classificada por `classifyPickerFailure` e, quando é o caso, o modo
 *    degrada para `DOWNLOAD_ONLY` — sempre **avisando** (nunca em silêncio).
 *
 * Na prática, `file://` cai no modo `DOWNLOAD_ONLY` já no primeiro estágio,
 * porque o navegador dá a essa página uma origem opaca (`location.origin ===
 * 'null'`). Quem decide isso, porém, é a medição — se um navegador mudar essa
 * regra, esta camada acompanha sozinha.
 */

export type StorageMode = 'FULL' | 'DOWNLOAD_ONLY';

export type Capabilities = {
  /** `window.showOpenFilePicker` existe E é utilizável (contexto seguro, origem não opaca). */
  fileSystemAccess: boolean;
  origin: 'https' | 'http' | 'file' | 'other';
  indexedDB: boolean;
  compressionStream: boolean;
  mode: StorageMode;
};

/**
 * Recorte do ambiente que interessa à detecção. Isolar isso num tipo é o que
 * permite testar `computeCapabilities` sem navegador nenhum.
 */
export type CapabilityEnv = {
  hasShowOpenFilePicker: boolean;
  hasShowSaveFilePicker: boolean;
  isSecureContext: boolean;
  /**
   * Origem opaca — `location.origin === 'null'`. É o segundo requisito de §1,
   * lido direto do ambiente. Note que a checagem **não** é "o protocolo é
   * file:": quem tem origem opaca é quem tem, incluindo iframes em sandbox e
   * excluindo qualquer esquema que um dia deixe de ser opaco.
   */
  opaqueOrigin: boolean;
  /** `window.location.protocol`, com os dois pontos: `'https:'`, `'file:'`… */
  protocol: string;
  hasIndexedDB: boolean;
  hasCompressionStream: boolean;
};

export function originFromProtocol(protocol: string): Capabilities['origin'] {
  switch (protocol) {
    case 'https:':
      return 'https';
    case 'http:':
      return 'http';
    case 'file:':
      return 'file';
    default:
      return 'other';
  }
}

export function computeCapabilities(env: CapabilityEnv): Capabilities {
  // Os dois requisitos de §1, medidos e não presumidos: contexto seguro e
  // origem não opaca. Ambos são estado do ambiente, legíveis diretamente —
  // diferente de "o protocolo é file://, logo não dá", que seria chute.
  //
  // Ainda assim a detecção estática não é a última palavra: existe navegador
  // que expõe as funções e recusa a chamada. Quem confirma é a chamada real
  // na primeira interação, com `classifyPickerFailure` abaixo.
  const fileSystemAccess =
    env.hasShowOpenFilePicker &&
    env.hasShowSaveFilePicker &&
    env.isSecureContext &&
    !env.opaqueOrigin;

  return {
    fileSystemAccess,
    origin: originFromProtocol(env.protocol),
    indexedDB: env.hasIndexedDB,
    compressionStream: env.hasCompressionStream,
    mode: fileSystemAccess ? 'FULL' : 'DOWNLOAD_ONLY',
  };
}

type MaybeWindow = {
  showOpenFilePicker?: unknown;
  showSaveFilePicker?: unknown;
  isSecureContext?: boolean;
  indexedDB?: unknown;
  CompressionStream?: unknown;
  location?: { protocol?: string; origin?: string };
  origin?: string;
};

export function readEnv(scope: MaybeWindow = globalThis as MaybeWindow): CapabilityEnv {
  // Quem serializa uma origem opaca como a string "null" é `window.origin`.
  // `location.origin` **não** serve para isto: no Chromium, uma página
  // `file://` tem `window.origin === 'null'` (opaca) e, ao mesmo tempo,
  // `location.origin === 'file://'`. Medido, não presumido — mas medido no
  // lugar certo.
  const origin = scope.origin ?? scope.location?.origin ?? '';
  return {
    hasShowOpenFilePicker: typeof scope.showOpenFilePicker === 'function',
    hasShowSaveFilePicker: typeof scope.showSaveFilePicker === 'function',
    isSecureContext: scope.isSecureContext === true,
    opaqueOrigin: origin === 'null' || origin === '',
    protocol: scope.location?.protocol ?? '',
    hasIndexedDB: scope.indexedDB !== undefined && scope.indexedDB !== null,
    hasCompressionStream: typeof scope.CompressionStream === 'function',
  };
}

export function detectCapabilities(scope?: MaybeWindow): Capabilities {
  return computeCapabilities(readEnv(scope));
}

/**
 * Classificação da falha de uma chamada real ao seletor de arquivos. É o
 * segundo estágio da detecção: só uma chamada de verdade distingue "a função
 * existe" de "a função funciona nesta origem".
 *
 * - `CANCELLED` — o usuário fechou o seletor. Não é degradação.
 * - `UNSUPPORTED` — a origem não suporta a API (origem opaca de `file://`,
 *   iframe sem permissão). Degrada para `DOWNLOAD_ONLY`, **avisando**.
 * - `PERMISSION` — o navegador negou o acesso ao arquivo.
 * - `IO` — qualquer outra falha.
 */
export type PickerFailure = 'CANCELLED' | 'UNSUPPORTED' | 'PERMISSION' | 'IO';

export function classifyPickerFailure(error: unknown): PickerFailure {
  if (error instanceof TypeError) return 'UNSUPPORTED';
  const name = (error as { name?: string } | null)?.name;
  switch (name) {
    case 'AbortError':
      return 'CANCELLED';
    case 'SecurityError':
    case 'InvalidStateError':
    case 'NotSupportedError':
      return 'UNSUPPORTED';
    case 'NotAllowedError':
      return 'PERMISSION';
    default:
      return 'IO';
  }
}

/** Texto da faixa de modo da tela inicial (docs/07-ux-e-editor.md §1). */
export const MODE_HEADLINE: Record<StorageMode, string> = {
  FULL: 'Modo completo — a aplicação grava direto no arquivo',
  DOWNLOAD_ONLY: 'Modo somente download — salvar gera um arquivo baixado',
};

export const MODE_DETAIL: Record<StorageMode, string> = {
  FULL:
    'Abrir e salvar acontecem no próprio arquivo escolhido, com detecção de conflito quando outra pessoa salvar antes de você, bloqueio consultivo e backups automáticos.',
  DOWNLOAD_ONLY:
    'Abrir é por seletor ou arrastar-e-soltar; salvar baixa um arquivo novo, que você precisa colocar de volta na pasta. Neste modo não há detecção de conflito: se outra pessoa salvar enquanto você edita, nada avisa. Salve com frequência e combine com o time quem está editando.',
};

export const MODE_RECOMMENDATION =
  'Para o modo completo, abra a aplicação pelo endereço da biblioteca (https) no Microsoft Edge ou no Google Chrome. Abrir o arquivo por duplo clique (file://) cai no modo somente download: o navegador trata a página como origem opaca e não deixa gravar em arquivo.';
