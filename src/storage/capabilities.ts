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
 *
 * O modo `SERVER` (docs/14-plataforma-local.md §8) entra por um terceiro
 * estágio, assíncrono e independente dos dois de cima: existe token na sessão
 * (`?t=` na URL, guardado em `sessionStorage`) **e** `fetch('/api/health')`
 * responde com uma versão de API que este front sabe falar? Os dois juntos
 * são `localServer`. `computeCapabilities` continua síncrona e pura — quem
 * resolve o assíncrono é `resolveServerToken`/`probeServerHealth`, chamadas
 * uma vez no boot antes da primeira composição de `Capabilities`.
 */

export type StorageMode = 'SERVER' | 'FULL' | 'DOWNLOAD_ONLY';

export type Capabilities = {
  /** `fetch('/api/health')` respondeu, com versão de API compatível, e há token na sessão. */
  localServer: boolean;
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
  /** Resultado já resolvido do terceiro estágio (token + `/api/health`), ver acima. */
  localServer: boolean;
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

  // Ordem de preferência fixa (docs/14-plataforma-local.md §8): SERVER →
  // FULL → DOWNLOAD_ONLY. `localServer` já chegou resolvido — ver o bloco
  // de detecção assíncrona mais abaixo.
  const mode: StorageMode = env.localServer ? 'SERVER' : fileSystemAccess ? 'FULL' : 'DOWNLOAD_ONLY';

  return {
    localServer: env.localServer,
    fileSystemAccess,
    origin: originFromProtocol(env.protocol),
    indexedDB: env.hasIndexedDB,
    compressionStream: env.hasCompressionStream,
    mode,
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

export function readEnv(
  scope: MaybeWindow = globalThis as MaybeWindow,
  localServer = false,
): CapabilityEnv {
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
    localServer,
  };
}

/** Sem servidor local — só os dois primeiros estágios (síncronos) de §1. */
export function detectCapabilities(scope?: MaybeWindow): Capabilities {
  return computeCapabilities(readEnv(scope));
}

// ---------------------------------------------------------------------------
// Terceiro estágio — detecção do servidor local (docs/14-plataforma-local.md §5, §8)
// ---------------------------------------------------------------------------

/**
 * Versão de API que **este** front sabe falar — docs/14-plataforma-local.md
 * §4. Mesma regra do `schemaVersion`: uma API maior que esta é recusada, não
 * "tentada mesmo assim".
 */
export const FRONT_API_VERSION = 1;

const SERVER_TOKEN_QUERY_KEY = 't';
const SERVER_TOKEN_STORAGE_KEY = 'policyops.server-token';

/** Recorte do `window` que a resolução do token precisa — testável sem DOM. */
export type TokenScope = {
  location: { search: string; pathname: string; hash: string };
  sessionStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  /** `history.replaceState` real; ausente nos testes, que só conferem o token. */
  replaceUrl?: (url: string) => void;
};

export function extractTokenFromSearch(search: string): string | null {
  return new URLSearchParams(search).get(SERVER_TOKEN_QUERY_KEY);
}

function searchWithoutToken(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(SERVER_TOKEN_QUERY_KEY);
  const rest = params.toString();
  return rest === '' ? '' : `?${rest}`;
}

/**
 * Token por boot (docs/14-plataforma-local.md §5): lido de `?t=` na URL na
 * primeira visita, guardado em `sessionStorage` e removido da barra de
 * endereço (o token nunca deve sobreviver num histórico ou ser colado por
 * engano). Visitas seguintes na mesma aba — recarregar, navegar por hash —
 * o leem de volta do `sessionStorage`, sem precisar do `?t=` de novo.
 */
export function resolveServerToken(scope: TokenScope): string | null {
  const fromUrl = extractTokenFromSearch(scope.location.search);
  if (fromUrl !== null && fromUrl !== '') {
    scope.sessionStorage.setItem(SERVER_TOKEN_STORAGE_KEY, fromUrl);
    scope.replaceUrl?.(`${scope.location.pathname}${searchWithoutToken(scope.location.search)}${scope.location.hash}`);
    return fromUrl;
  }
  return scope.sessionStorage.getItem(SERVER_TOKEN_STORAGE_KEY);
}

/** Corpo de `GET /api/health` (docs/14 §4). */
export type ServerHealth = {
  app: string;
  apiVersion: number;
  dataDir: string;
  dataFile: string;
  started: string;
};

export type HealthProbe =
  | { reachable: true; compatible: boolean; health: ServerHealth }
  | { reachable: false };

/**
 * `GET /api/health` — o único endpoint sem token (docs/14 §4 e §5). Devolve o
 * corpo inteiro, não só a versão: `dataDir`/`dataFile` são o que monta
 * `ServerAdapter` e a mensagem "conectado à pasta … como …" da tela inicial —
 * uma segunda chamada não teria nada a mais para perguntar.
 */
export async function probeServerHealth(fetchImpl: typeof fetch): Promise<HealthProbe> {
  try {
    const response = await fetchImpl('/api/health');
    if (!response.ok) return { reachable: false };
    const apiVersionHeader = response.headers.get('X-PolicyOps-Api');
    if (apiVersionHeader === null || apiVersionHeader === '') return { reachable: false };
    const apiVersion = Number(apiVersionHeader);
    if (!Number.isFinite(apiVersion)) return { reachable: false };
    const body = (await response.json()) as Partial<ServerHealth>;
    if (
      typeof body.app !== 'string' ||
      typeof body.dataDir !== 'string' ||
      typeof body.dataFile !== 'string' ||
      typeof body.started !== 'string'
    ) {
      return { reachable: false };
    }
    return {
      reachable: true,
      compatible: apiVersion <= FRONT_API_VERSION,
      health: { app: body.app, apiVersion, dataDir: body.dataDir, dataFile: body.dataFile, started: body.started },
    };
  } catch {
    // Sem servidor escutando em 127.0.0.1, ou a aba não foi aberta por ele —
    // não é erro, é o caso normal dos modos FULL/DOWNLOAD_ONLY.
    return { reachable: false };
  }
}

export type ServerDetection = {
  /** `true` = entra em `SERVER`. `false` cobre "sem servidor" e "API incompatível". */
  available: boolean;
  token: string | null;
  /** Servidor respondeu, mas com uma API mais nova que esta — mesma regra do `schemaVersion`. */
  incompatible: boolean;
  health: ServerHealth | null;
};

/**
 * Composição do terceiro estágio: token na sessão **e** `/api/health`
 * compatível. Sem token, nem chama a rede — não há por que: a aplicação só
 * foi servida pelo servidor local se ele abriu a aba com `?t=`.
 */
export async function detectServer(scope: TokenScope, fetchImpl: typeof fetch): Promise<ServerDetection> {
  const token = resolveServerToken(scope);
  if (token === null) return { available: false, token: null, incompatible: false, health: null };

  const probe = await probeServerHealth(fetchImpl);
  if (!probe.reachable) return { available: false, token, incompatible: false, health: null };

  return {
    available: probe.compatible,
    token,
    incompatible: !probe.compatible,
    health: probe.health,
  };
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
  SERVER: 'Modo servidor — conectado à pasta de rede pelo servidor local',
  FULL: 'Modo completo — a aplicação grava direto no arquivo',
  DOWNLOAD_ONLY: 'Modo somente download — salvar gera um arquivo baixado',
};

export const MODE_DETAIL: Record<StorageMode, string> = {
  SERVER:
    'Abrir e salvar acontecem direto na pasta de rede, pelo servidor local: detecção de conflito, bloqueio consultivo, backups automáticos e identidade resolvidos pelo servidor, em qualquer navegador. É o modo recomendado de operação.',
  FULL:
    'Abrir e salvar acontecem no próprio arquivo escolhido, com detecção de conflito quando outra pessoa salvar antes de você, bloqueio consultivo e backups automáticos.',
  DOWNLOAD_ONLY:
    'Abrir é por seletor ou arrastar-e-soltar; salvar baixa um arquivo novo, que você precisa colocar de volta na pasta. Neste modo não há detecção de conflito: se outra pessoa salvar enquanto você edita, nada avisa. Salve com frequência e combine com o time quem está editando.',
};

export const MODE_RECOMMENDATION =
  'Para o modo completo, abra a aplicação pelo endereço da biblioteca (https) no Microsoft Edge ou no Google Chrome. Abrir o arquivo por duplo clique (file://) cai no modo somente download: o navegador trata a página como origem opaca e não deixa gravar em arquivo.';

/** API do servidor local maior que a deste front (docs/14 §4, mesma regra do `schemaVersion`). */
export function serverIncompatibleMessage(apiVersion: number | null): string {
  return `O servidor local desta pasta fala uma versão da API (${apiVersion ?? '?'}) mais nova do que esta aplicação entende (${FRONT_API_VERSION}). Publique o build mais recente de PolicyOps.html ao lado do servidor.`;
}

/** "Conectado à pasta \\rede\Politicas como Arthur" — tela inicial no modo `SERVER` (docs/14 §8). */
export function serverConnectionMessage(dataDir: string, who: string): string {
  return `Conectado à pasta ${dataDir} como ${who}`;
}
