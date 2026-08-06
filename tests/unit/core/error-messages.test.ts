import { describe, expect, it } from 'vitest';
import { DOMAIN_ERROR_CODES } from '@/core/errors';
import { ERROR_MESSAGES } from '@/core/error-messages';

describe('ERROR_MESSAGES', () => {
  it('tem uma mensagem pt-BR não vazia para cada código do catálogo', () => {
    for (const code of DOMAIN_ERROR_CODES) {
      const message = ERROR_MESSAGES[code];
      expect(message, `código sem mensagem: ${code}`).toBeTypeOf('string');
      expect(message.trim().length, `mensagem vazia para: ${code}`).toBeGreaterThan(0);
    }
  });

  it('não tem mensagens órfãs para códigos fora do catálogo', () => {
    const knownCodes = new Set<string>(DOMAIN_ERROR_CODES);
    for (const key of Object.keys(ERROR_MESSAGES)) {
      expect(knownCodes.has(key), `mensagem para código desconhecido: ${key}`).toBe(true);
    }
  });
});
