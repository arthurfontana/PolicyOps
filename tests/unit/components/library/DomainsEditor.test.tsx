// @vitest-environment jsdom
import { useMemo, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Domain, RegionalDimension } from '@/core/document/schema';
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

/**
 * Harness com dimensão regional — exercita o toggle, o grid por regional e a
 * colagem de tabela (docs/07 §11, docs/05 §5.6).
 */
function RegionalHarness({
  initialDomains,
  initialRegional,
}: {
  initialDomains: Domain[];
  initialRegional: RegionalDimension | undefined;
}) {
  const [domains, setDomains] = useState<Domain[]>(initialDomains);
  const [regionalDimension, setRegionalDimension] = useState<RegionalDimension | undefined>(initialRegional);
  const validation = useMemo(
    () => validateDomains('RANGE', domains, regionalDimension),
    [domains, regionalDimension],
  );
  const issues = validation.ok ? [] : validation.issues;
  return (
    <DomainsEditor
      type="RANGE"
      domains={domains}
      onChange={setDomains}
      issues={issues}
      regionalDimension={regionalDimension}
      onRegionalDimensionChange={setRegionalDimension}
    />
  );
}

const REGIONAL_CONTIGUOUS: Domain[] = [
  {
    code: 'A',
    label: 'A',
    position: 0,
    regionalRanges: { BASE: { min: '0', max: '100' }, SP: { min: '0', max: '120' } },
  },
  {
    code: 'B',
    label: 'B',
    position: 1,
    regionalRanges: { BASE: { min: '100', max: '200' }, SP: { min: '120', max: '240' } },
  },
];

const TWO_REGIONS: RegionalDimension = {
  regions: [
    { code: 'BASE', label: 'Base' },
    { code: 'SP', label: 'São Paulo' },
  ],
};

describe('DomainsEditor — dimensão regional (docs/07 §11)', () => {
  it('sem onRegionalDimensionChange, o toggle não aparece (modo de sempre)', () => {
    render(<Harness initial={CONTIGUOUS} />);
    expect(screen.queryByText(/varia por regional/)).not.toBeInTheDocument();
  });

  it('alternar o toggle limpa o modo anterior sem erro (RANGE simples → regional)', async () => {
    const user = userEvent.setup();
    render(<RegionalHarness initialDomains={CONTIGUOUS} initialRegional={undefined} />);

    expect(screen.getAllByLabelText('Mínimo')).toHaveLength(2);
    await user.click(screen.getByRole('checkbox', { name: /varia por regional/ }));

    // Modo trocou: os campos "Mínimo"/"Máximo" únicos somem, e nenhum erro é lançado.
    expect(screen.queryByLabelText('Mínimo')).not.toBeInTheDocument();
    expect(screen.getByText('Regionais')).toBeInTheDocument();
    expect(screen.getByText(/Nenhum regional ainda/)).toBeInTheDocument();
  });

  it('alternar de volta (regional → simples) também limpa sem erro', async () => {
    const user = userEvent.setup();
    render(<RegionalHarness initialDomains={REGIONAL_CONTIGUOUS} initialRegional={TWO_REGIONS} />);

    expect(screen.getAllByLabelText(/Mínimo \(BASE\)/)).toHaveLength(2);
    await user.click(screen.getByRole('checkbox', { name: /varia por regional/ }));

    expect(screen.queryByText(/Regionais/)).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Mínimo')).toHaveLength(2);
    expect(screen.getAllByLabelText('Mínimo').every((input) => (input as HTMLInputElement).value === '')).toBe(
      true,
    );
  });

  it('erro de contiguidade regional aponta a regional certa, sem confundir BASE com SP', () => {
    const withHole: Domain[] = [
      REGIONAL_CONTIGUOUS[0]!,
      {
        code: 'B',
        label: 'B',
        position: 1,
        // SP tem um buraco (120 -> 150); BASE segue contíguo.
        regionalRanges: { BASE: { min: '100', max: '200' }, SP: { min: '150', max: '240' } },
      },
    ];
    render(<RegionalHarness initialDomains={withHole} initialRegional={TWO_REGIONS} />);
    expect(screen.getAllByText(/não são contíguas.*no regional "SP"/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/no regional "BASE"/)).not.toBeInTheDocument();
  });

  it('colar tabela mal formada mostra erro sem fechar a caixa nem gravar', async () => {
    const user = userEvent.setup();
    render(<RegionalHarness initialDomains={[]} initialRegional={{ regions: [] }} />);

    await user.click(screen.getByRole('button', { name: /Colar tabela/ }));
    const textarea = screen.getByLabelText('Tabela colada');
    await user.type(textarea, 'uma linha só, sem cabeçalho completo');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));

    // A caixa continua aberta, mostrando o erro — nada foi aplicado ao grid.
    expect(screen.getByLabelText('Tabela colada')).toBeInTheDocument();
    expect(screen.getByText(/Cabeçalho ausente/)).toBeInTheDocument();
    expect(screen.getByText(/Nenhum regional ainda/)).toBeInTheDocument();
  });

  it('colar tabela bem formada preenche o grid e fecha a caixa', async () => {
    const user = userEvent.setup();
    render(<RegionalHarness initialDomains={[]} initialRegional={{ regions: [] }} />);

    await user.click(screen.getByRole('button', { name: /Colar tabela/ }));
    const textarea = screen.getByLabelText('Tabela colada');
    const table = ['\tBASE\t', '\tMIN\tMAX', 'R1 - Baixo\t0\t100'].join('\n');
    fireEvent.change(textarea, { target: { value: table } });
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(screen.queryByLabelText('Tabela colada')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('R1')).toBeInTheDocument();
    expect(screen.getByLabelText('Mínimo (BASE)')).toHaveValue('0');
  });
});
