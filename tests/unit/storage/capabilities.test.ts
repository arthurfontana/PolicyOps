import { describe, expect, it } from 'vitest';
import {
  classifyPickerFailure,
  computeCapabilities,
  detectCapabilities,
  originFromProtocol,
  type CapabilityEnv,
} from '@/storage/capabilities';

/** docs/06-persistencia-e-concorrencia.md §1. */

const base: CapabilityEnv = {
  hasShowOpenFilePicker: true,
  hasShowSaveFilePicker: true,
  isSecureContext: true,
  opaqueOrigin: false,
  protocol: 'https:',
  hasIndexedDB: true,
  hasCompressionStream: true,
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
