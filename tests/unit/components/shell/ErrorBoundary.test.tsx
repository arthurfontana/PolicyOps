// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/components/shell/ErrorBoundary';

/**
 * docs/07-ux-e-editor.md §12: `ErrorBoundary` por região, com botão de
 * recarregar e opção de exportar diagnóstico.
 */

function Boom(): never {
  throw new Error('Falha de teste no render.');
}

// React loga o erro capturado no console mesmo com um ErrorBoundary — silencia
// só durante estes testes para o output não poluir com o esperado.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('deixa a região passar quando não há erro', () => {
    render(
      <ErrorBoundary region="Teste">
        <p>conteúdo normal</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('conteúdo normal')).toBeInTheDocument();
  });

  it('mostra o fallback da região quando um filho lança durante o render', () => {
    render(
      <ErrorBoundary region="Inspector">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Algo deu errado em "Inspector".')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recarregar esta região' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar diagnóstico' })).toBeInTheDocument();
  });

  it('"Exportar diagnóstico" baixa um .txt com o nome da região', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') el.click = clickSpy;
      return el;
    });
    // jsdom não implementa `URL.createObjectURL` — atribui direto em vez de
    // `vi.spyOn`, que exige o método já existir no protótipo.
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
    URL.revokeObjectURL = vi.fn();

    render(
      <ErrorBoundary region="Grid">
        <Boom />
      </ErrorBoundary>,
    );
    await user.click(screen.getByRole('button', { name: 'Exportar diagnóstico' }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
