import { describe, expect, it, vi } from 'vitest';
import {
  classifyPickerFailure,
  computeCapabilities,
  detectCapabilities,
  detectServer,
  extractTokenFromSearch,
  FRONT_API_VERSION,
  originFromProtocol,
  probeServerHealth,
  resolveServerToken,
  serverConnectionMessage,
  serverIncompatibleMessage,
  type CapabilityEnv,
  type TokenScope,
} from '@/storage/capabilities';

/** docs/06-persistencia-e-concorrencia.md §1, docs/14-plataforma-local.md §5 e §8. */

const base: CapabilityEnv = {
  hasShowOpenFilePicker: true,
  hasShowSaveFilePicker: true,
  isSecureContext: true,
  opaqueOrigin: false,
  protocol: 'https:',
  hasIndexedDB: true,
  hasCompressionStream: true,
  localServer: false,
};

describe('computeCapabilities', () => {
  it('https com a API completa é FULL', () => {
    const capabilities = computeCapabilities(base);
    expect(capabilities.mode).toBe('FULL');
    expect(capabilities.fileSystemAccess).toBe(true);
    expect(capabilities.origin).toBe('https');
  });

  it('sem showOpenFilePicker cai para DOWNLOAD_ONLY', () => {
    expect(computeCapabilities({ ...base, hasShowOpenFilePicker: false }).mode).toBe(
      'DOWNLOAD_ONLY',
    );
  });

  it('sem showSaveFilePicker cai para DOWNLOAD_ONLY', () => {
    expect(computeCapabilities({ ...base, hasShowSaveFilePicker: false }).mode).toBe(
      'DOWNLOAD_ONLY',
    );
  });

  it('fora de contexto seguro cai para DOWNLOAD_ONLY', () => {
    expect(computeCapabilities({ ...base, isSecureContext: false }).mode).toBe('DOWNLOAD_ONLY');
  });

  it('origem opaca cai para DOWNLOAD_ONLY — é o caso do file://', () => {
    const capabilities = computeCapabilities({ ...base, protocol: 'file:', opaqueOrigin: true });
    expect(capabilities.origin).toBe('file');
    expect(capabilities.mode).toBe('DOWNLOAD_ONLY');
  });

  it('o que decide é a opacidade da origem, não o protocolo', () => {
    // Um http: de origem opaca (iframe em sandbox) não tem a API…
    expect(computeCapabilities({ ...base, protocol: 'http:', opaqueOrigin: true }).mode).toBe(
      'DOWNLOAD_ONLY',
    );
    // …e um file: que um dia deixe de ser opaco passa a ter, sem mexer aqui.
    expect(computeCapabilities({ ...base, protocol: 'file:', opaqueOrigin: false }).mode).toBe(
      'FULL',
    );
  });

  it('reporta indexedDB e CompressionStream separados do modo', () => {
    const capabilities = computeCapabilities({
      ...base,
      hasIndexedDB: false,
      hasCompressionStream: false,
    });
    expect(capabilities.indexedDB).toBe(false);
    expect(capabilities.compressionStream).toBe(false);
    expect(capabilities.mode).toBe('FULL');
  });

  it('classifica a origem', () => {
    expect(originFromProtocol('https:')).toBe('https');
    expect(originFromProtocol('http:')).toBe('http');
    expect(originFromProtocol('file:')).toBe('file');
    expect(originFromProtocol('blob:')).toBe('other');
    expect(originFromProtocol('')).toBe('other');
  });
});

describe('detectCapabilities', () => {
  it('lê o escopo dado sem tocar em globals', () => {
    const capabilities = detectCapabilities({
      showOpenFilePicker: () => undefined,
      showSaveFilePicker: () => undefined,
      isSecureContext: true,
      indexedDB: {},
      CompressionStream: function CompressionStreamStub() {},
      origin: 'http://localhost:5173',
      location: { protocol: 'http:', origin: 'http://localhost:5173' },
    });
    expect(capabilities.mode).toBe('FULL');
    expect(capabilities.origin).toBe('http');
  });

  it('lê a opacidade em window.origin, não em location.origin', () => {
    // O caso real do Chromium em file://: window.origin é "null" (opaca) e
    // location.origin é "file://". Ler o campo errado põe a aplicação no modo
    // FULL para depois falhar na primeira gravação.
    const capabilities = detectCapabilities({
      showOpenFilePicker: () => undefined,
      showSaveFilePicker: () => undefined,
      isSecureContext: true,
      indexedDB: {},
      origin: 'null',
      location: { protocol: 'file:', origin: 'file://' },
    });
    expect(capabilities.mode).toBe('DOWNLOAD_ONLY');
    expect(capabilities.origin).toBe('file');
  });

  it('num ambiente sem nada, é DOWNLOAD_ONLY', () => {
    const capabilities = detectCapabilities({});
    expect(capabilities.mode).toBe('DOWNLOAD_ONLY');
    expect(capabilities.fileSystemAccess).toBe(false);
    expect(capabilities.indexedDB).toBe(false);
  });
});

describe('classifyPickerFailure — o segundo estágio da detecção', () => {
  it('AbortError é cancelamento do usuário, não degradação', () => {
    expect(classifyPickerFailure(new DOMException('cancelou', 'AbortError'))).toBe('CANCELLED');
  });

  it('SecurityError (origem opaca de file://) é UNSUPPORTED', () => {
    expect(classifyPickerFailure(new DOMException('origem opaca', 'SecurityError'))).toBe(
      'UNSUPPORTED',
    );
  });

  it('TypeError (função inexistente) é UNSUPPORTED', () => {
    expect(classifyPickerFailure(new TypeError('não é função'))).toBe('UNSUPPORTED');
  });

  it('NotAllowedError é permissão', () => {
    expect(classifyPickerFailure(new DOMException('negado', 'NotAllowedError'))).toBe('PERMISSION');
  });

  it('o resto é IO', () => {
    expect(classifyPickerFailure(new Error('disco cheio'))).toBe('IO');
    expect(classifyPickerFailure(null)).toBe('IO');
  });
});

describe('computeCapabilities — ordem de preferência SERVER → FULL → DOWNLOAD_ONLY (docs/14 §8)', () => {
  it('localServer vence mesmo com a File System Access API disponível', () => {
    const capabilities = computeCapabilities({ ...base, localServer: true });
    expect(capabilities.mode).toBe('SERVER');
    expect(capabilities.localServer).toBe(true);
    // Os outros dois estágios continuam medidos e reportados, mesmo sem decidir o modo.
    expect(capabilities.fileSystemAccess).toBe(true);
  });

  it('sem localServer, cai para a cadeia síncrona de sempre (FULL/DOWNLOAD_ONLY)', () => {
    expect(computeCapabilities({ ...base, localServer: false }).mode).toBe('FULL');
    expect(
      computeCapabilities({ ...base, localServer: false, hasShowOpenFilePicker: false }).mode,
    ).toBe('DOWNLOAD_ONLY');
  });

  it('localServer entra em SERVER mesmo em file:// (a origem opaca não importa para este estágio)', () => {
    const capabilities = computeCapabilities({
      ...base,
      localServer: true,
      protocol: 'file:',
      opaqueOrigin: true,
    });
    expect(capabilities.mode).toBe('SERVER');
  });
});

describe('extractTokenFromSearch — token por boot (docs/14 §5)', () => {
  it('lê o "t" da query string', () => {
    expect(extractTokenFromSearch('?t=abc123')).toBe('abc123');
    expect(extractTokenFromSearch('?outro=1&t=abc123')).toBe('abc123');
  });

  it('sem "t", devolve null', () => {
    expect(extractTokenFromSearch('')).toBeNull();
    expect(extractTokenFromSearch('?outro=1')).toBeNull();
  });
});

function fakeTokenScope(search: string, stored: string | null = null): TokenScope & { replaced: string[] } {
  const store = new Map<string, string>();
  if (stored !== null) store.set('policyops.server-token', stored);
  const replaced: string[] = [];
  return {
    location: { search, pathname: '/', hash: '' },
    sessionStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    },
    replaceUrl: (url) => replaced.push(url),
    replaced,
  };
}

describe('resolveServerToken — ?t= na URL vira sessionStorage, e some da barra de endereço (docs/14 §5)', () => {
  it('lê o token da URL, guarda na sessão e limpa a URL', () => {
    const scope = fakeTokenScope('?t=segredo');
    expect(resolveServerToken(scope)).toBe('segredo');
    expect(scope.sessionStorage.getItem('policyops.server-token')).toBe('segredo');
    expect(scope.replaced).toEqual(['/']);
  });

  it('preserva os outros parâmetros da query ao remover só o "t"', () => {
    const scope = fakeTokenScope('?doc=x&t=segredo&y=2');
    resolveServerToken(scope);
    expect(scope.replaced[0]).not.toContain('t=segredo');
    expect(scope.replaced[0]).toContain('doc=x');
    expect(scope.replaced[0]).toContain('y=2');
  });

  it('sem "t" na URL, lê de volta do sessionStorage (recarregar a página, navegar por hash)', () => {
    const scope = fakeTokenScope('', 'já-guardado');
    expect(resolveServerToken(scope)).toBe('já-guardado');
    expect(scope.replaced).toEqual([]);
  });

  it('sem token nenhum, devolve null', () => {
    expect(resolveServerToken(fakeTokenScope(''))).toBeNull();
  });
});

describe('probeServerHealth — GET /api/health (docs/14 §4 e §5)', () => {
  function fetchWith(status: number, apiVersion: string | null, body?: unknown): typeof fetch {
    return vi.fn(async () =>
      new Response(JSON.stringify(body ?? {}), {
        status,
        headers: apiVersion === null ? {} : { 'X-PolicyOps-Api': apiVersion },
      }),
    ) as unknown as typeof fetch;
  }

  const healthBody = {
    app: 'Policy Matrix Studio',
    dataDir: '\\\\rede\\Politicas',
    dataFile: 'politicas.json',
    started: '2026-08-05T12:00:00.000Z',
  };

  it('servidor compatível (apiVersion <= FRONT_API_VERSION)', async () => {
    const probe = await probeServerHealth(fetchWith(200, String(FRONT_API_VERSION), healthBody));
    expect(probe.reachable).toBe(true);
    if (!probe.reachable) return;
    expect(probe.compatible).toBe(true);
    expect(probe.health.dataDir).toBe('\\\\rede\\Politicas');
  });

  it('servidor com API mais nova é reachable mas incompatible', async () => {
    const probe = await probeServerHealth(fetchWith(200, String(FRONT_API_VERSION + 1), healthBody));
    expect(probe.reachable).toBe(true);
    if (!probe.reachable) return;
    expect(probe.compatible).toBe(false);
  });

  it('sem servidor escutando (fetch rejeita), reachable é false', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect((await probeServerHealth(fetchImpl)).reachable).toBe(false);
  });

  it('resposta sem o cabeçalho de versão ou sem corpo reconhecível não é reachable', async () => {
    expect((await probeServerHealth(fetchWith(200, null, healthBody))).reachable).toBe(false);
    expect((await probeServerHealth(fetchWith(200, '1', {}))).reachable).toBe(false);
  });

  it('status de erro não é reachable', async () => {
    expect((await probeServerHealth(fetchWith(404, '1'))).reachable).toBe(false);
  });
});

describe('detectServer — composição do terceiro estágio (docs/14 §5 e §8)', () => {
  const healthBody = {
    app: 'Policy Matrix Studio',
    dataDir: '\\\\rede\\Politicas',
    dataFile: 'politicas.json',
    started: '2026-08-05T12:00:00.000Z',
  };

  function fetchWith(apiVersion: number): typeof fetch {
    return vi.fn(async () =>
      new Response(JSON.stringify(healthBody), { status: 200, headers: { 'X-PolicyOps-Api': String(apiVersion) } }),
    ) as unknown as typeof fetch;
  }

  it('sem token, nem chama a rede', async () => {
    const fetchImpl = vi.fn();
    const detection = await detectServer(fakeTokenScope(''), fetchImpl as unknown as typeof fetch);
    expect(detection).toEqual({ available: false, token: null, incompatible: false, health: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('token + API compatível → available', async () => {
    const detection = await detectServer(fakeTokenScope('?t=abc'), fetchWith(FRONT_API_VERSION));
    expect(detection.available).toBe(true);
    expect(detection.token).toBe('abc');
    expect(detection.incompatible).toBe(false);
    expect(detection.health?.dataDir).toBe('\\\\rede\\Politicas');
  });

  it('token + API mais nova → incompatible, não available (mesma regra do schemaVersion)', async () => {
    const detection = await detectServer(fakeTokenScope('?t=abc'), fetchWith(FRONT_API_VERSION + 1));
    expect(detection.available).toBe(false);
    expect(detection.incompatible).toBe(true);
    expect(detection.token).toBe('abc');
  });

  it('token + sem servidor alcançável → not available, not incompatible (cadeia atual segue)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const detection = await detectServer(fakeTokenScope('?t=abc'), fetchImpl);
    expect(detection.available).toBe(false);
    expect(detection.incompatible).toBe(false);
    expect(detection.token).toBe('abc');
  });
});

describe('mensagens do modo SERVER', () => {
  it('serverIncompatibleMessage cita as duas versões', () => {
    const message = serverIncompatibleMessage(2);
    expect(message).toContain('2');
    expect(message).toContain(String(FRONT_API_VERSION));
  });

  it('serverConnectionMessage compõe pasta e identidade', () => {
    expect(serverConnectionMessage('\\\\rede\\Politicas', 'Arthur')).toBe(
      'Conectado à pasta \\\\rede\\Politicas como Arthur',
    );
  });
});
