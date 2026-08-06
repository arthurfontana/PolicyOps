// @vitest-environment jsdom
import { useMemo, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Domain } from '@/core/document/schema';
import { validateDomains } from '@/core/library/validate-domains';
import { DomainsEditor } from '@/components/library/DomainsEditor';

/**
 * Harness idêntico ao fio real de `VariableDetail`: estado de domínios +
 * `validateDomains` recalculado a cada mudança, alimentando `DomainsEditor`.
 * É o caminho que precisa mostrar o erro de contiguidade sem recarregar, e
 * fazê-lo sumir ao corrigir (critério de aceite de docs/prompts/S06).
 */
function Harness({ initial }: { initial: Domain[] }) {
  const [domains, setDomains] = useState<Domain[]>(initial);
  const validation = useMemo(() => validateDomains('RANGE', domains), [domains]);
  const issues = validation.ok ? [] : validation.issues;
  return <DomainsEditor type="RANGE" domains={domains} onChange={setDomains} issues={issues} />;
}

const CONTIGUOUS: Domain[] = [
  { code: 'BAIXO', label: 'Baixo', position: 0, rangeMin: '0', rangeMax: '100' },
  { code: 'ALTO', label: 'Alto', position: 1, rangeMin: '100', rangeMax: '200' },
];

describe('DomainsEditor — validação de contiguidade em tempo real', () => {
  it('não mostra erro quando as faixas já são contíguas', () => {
    render(<Harness initial={CONTIGUOUS} />);
    expect(screen.queryByText(/não são contíguas/)).not.toBeInTheDocument();
  });

  it('mostra o erro de contiguidade assim que um buraco é digitado, sem recarregar', () => {
    render(<Harness initial={CONTIGUOUS} />);
    const maxInputs = screen.getAllByLabelText('Máximo');
    fireEvent.change(maxInputs[0]!, { target: { value: '50' } });

    // A mensagem aponta o par problemático, e aparece junto de cada domínio
    // envolvido (BAIXO e ALTO) — por isso duas ocorrências, não uma.
    expect(screen.getAllByText(/"BAIXO" e "ALTO" não são contíguas/).length).toBeGreaterThan(0);
  });

  it('some ao corrigir de volta o buraco', () => {
    render(<Harness initial={CONTIGUOUS} />);
    const maxInputs = screen.getAllByLabelText('Máximo');
    fireEvent.change(maxInputs[0]!, { target: { value: '50' } });
    expect(screen.getAllByText(/não são contíguas/).length).toBeGreaterThan(0);

    fireEvent.change(screen.getAllByLabelText('Máximo')[0]!, { target: { value: '100' } });
    expect(screen.queryByText(/não são contíguas/)).not.toBeInTheDocument();
  });

  it('mostra o erro de mínimo de domínios quando há menos de 2', () => {
    render(<Harness initial={[CONTIGUOUS[0]!]} />);
    expect(screen.getByText(/pelo menos 2 domínios/)).toBeInTheDocument();
  });
});
