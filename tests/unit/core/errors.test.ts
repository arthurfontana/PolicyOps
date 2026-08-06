import { describe, expect, it } from 'vitest';
import { DomainError, isDomainError } from '@/core/errors';

describe('DomainError', () => {
  it('carrega code, message e details', () => {
    const error = new DomainError('NOT_FOUND', 'não encontrado', { id: 'abc' });
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('não encontrado');
    expect(error.details).toEqual({ id: 'abc' });
    expect(error).toBeInstanceOf(Error);
  });

  it('é reconhecido por isDomainError', () => {
    expect(isDomainError(new DomainError('NOT_FOUND', 'x'))).toBe(true);
    expect(isDomainError(new Error('x'))).toBe(false);
    expect(isDomainError('x')).toBe(false);
  });
});
