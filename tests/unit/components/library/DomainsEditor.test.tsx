// @vitest-environment jsdom
import { useMemo, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { BoundaryMode, Domain, GroupingDimension, VariableType } from '@/core/document/schema';
import { findRangeContiguityWarnings, validateDomains } from '@/core/library/validate-domains';
import { DomainsEditor } from '@/components/library/DomainsEditor';

/**
 * Harness idêntico ao fio real de `VariableDetail`: estado de domínios +
 * `validateDomains`/`findRangeContiguityWarnings` recalculados a cada
 * mudança, alimentando `DomainsEditor`. É o caminho que precisa mostrar o
 * aviso de contiguidade sem recarregar, e fazê-lo sumir ao corrigir
 * (critério de aceite de docs/prompts/S06) — desde que I9 (valores) deixou
 * de bloquear, o aviso não impede mais salvar.
 */
function Harness({ initial }: { initial: Domain[] }) {
  const [domains, setDomains] = useState<Domain[]>(initial);
  const validation = useMemo(() => validateDomains('RANGE', domains), [domains]);
  const issues = validation.ok ? [] : validation.issues;
  const rangeWarnings = useMemo(() => findRangeContiguityWarnings('RANGE', domains), [domains]);
  return (
    <DomainsEditor
      type="RANGE"
      domains={domains}
      onChange={setDomains}
      issues={issues}
      rangeWarnings={rangeWarnings}
    />
  );
}

const CONTIGUOUS: Domain[] = [
  { code: 'BAIXO', label: 'Baixo', position: 0, rangeMin: '0', rangeMax: '99' },
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

    fireEvent.change(screen.getAllByLabelText('Máximo')[0]!, { target: { value: '99' } });
    expect(screen.queryByText(/não são contíguas/)).not.toBeInTheDocument();
  });

  it('mostra o erro de mínimo de domínios quando há menos de 2', () => {
    render(<Harness initial={[CONTIGUOUS[0]!]} />);
    expect(screen.getByText(/pelo menos 2 domínios/)).toBeInTheDocument();
  });
});

/**
 * Harness com agrupamentos — exercita o editor de níveis, a tabela tidy e a
 * colagem que os detecta sozinha (docs/07 §11, docs/05 §5.6).
 */
function GroupingHarness({
  initialDomains,
  initialGrouping,
}: {
  initialDomains: Domain[];
  initialGrouping: GroupingDimension[] | undefined;
}) {
  const [domains, setDomains] = useState<Domain[]>(initialDomains);
  const [groupingDimensions, setGroupingDimensions] = useState<GroupingDimension[] | undefined>(
    initialGrouping,
  );
  const validation = useMemo(
    () => validateDomains('RANGE', domains, groupingDimensions),
    [domains, groupingDimensions],
  );
  const issues = validation.ok ? [] : validation.issues;
  const rangeWarnings = useMemo(
    () => findRangeContiguityWarnings('RANGE', domains, groupingDimensions),
    [domains, groupingDimensions],
  );
  return (
    <DomainsEditor
      type="RANGE"
      domains={domains}
      onChange={setDomains}
      issues={issues}
      rangeWarnings={rangeWarnings}
      groupingDimensions={groupingDimensions}
      onGroupingDimensionsChange={setGroupingDimensions}
    />
  );
}

const REGIONAL_PORTE: GroupingDimension[] = [
  {
    code: 'REGIONAL',
    label: 'Regional',
    options: [
      { code: 'SAO_PAULO', label: 'São Paulo' },
      { code: 'SUL', label: 'Sul' },
    ],
  },
  {
    code: 'PORTE',
    label: 'Porte',
    options: [
      { code: 'MEI', label: 'MEI' },
      { code: 'NAO_MEI', label: 'Não MEI' },
    ],
  },
];

const GROUPED_CONTIGUOUS: Domain[] = [
  {
    code: 'R1',
    label: 'R1',
    position: 0,
    groupingRanges: [
      { path: ['SAO_PAULO', 'MEI'], min: '0', max: '99' },
      { path: ['SUL', 'MEI'], min: '0', max: '119' },
    ],
  },
  {
    code: 'R2',
    label: 'R2',
    position: 1,
    groupingRanges: [
      { path: ['SAO_PAULO', 'MEI'], min: '100', max: '200' },
      { path: ['SUL', 'MEI'], min: '120', max: '240' },
    ],
  },
];

describe('DomainsEditor — agrupamentos hierárquicos (docs/07 §11)', () => {
  it('sem groupingDimensions, o editor de agrupamentos e a tabela tidy não aparecem', () => {
    render(<Harness initial={CONTIGUOUS} />);
    expect(screen.queryByText(/Agrupamentos \(hierarquia/)).not.toBeInTheDocument();
    expect(screen.queryByText('Faixas por combinação')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Mínimo')).toHaveLength(2);
  });

  it('lista os níveis com a contagem de opções, na ordem da hierarquia', () => {
    render(<GroupingHarness initialDomains={GROUPED_CONTIGUOUS} initialGrouping={REGIONAL_PORTE} />);
    const rows = screen.getAllByTestId('grouping-dimension-row');
    expect(rows).toHaveLength(2);
    const names = screen.getAllByLabelText('Nome do agrupamento').map((el) => (el as HTMLInputElement).value);
    expect(names).toEqual(['Regional', 'Porte']);
    expect(rows[0]!).toHaveTextContent('2 opção(ões)');
  });

  it('agrupa a tabela visualmente por caminho, um bloco por combinação usada', () => {
    render(<GroupingHarness initialDomains={GROUPED_CONTIGUOUS} initialGrouping={REGIONAL_PORTE} />);
    const groups = screen.getAllByTestId('grouping-path-group');
    expect(groups.map((group) => group.getAttribute('data-path'))).toEqual([
      'SAO_PAULO|MEI',
      'SUL|MEI',
    ]);
    expect(groups[0]!).toHaveTextContent('SAO_PAULO › MEI');
    // Duas linhas (R1 e R2) dentro de cada caminho.
    expect(screen.getAllByTestId('grouping-range-row')).toHaveLength(4);
    // No modo agrupado a linha de identidade não tem mais mín/máx únicos.
    expect(screen.queryByLabelText('Mínimo')).not.toBeInTheDocument();
  });

  it('erro de contiguidade aponta o caminho certo, sem confundir São Paulo com Sul', () => {
    const withHole: Domain[] = [
      GROUPED_CONTIGUOUS[0]!,
      {
        code: 'R2',
        label: 'R2',
        position: 1,
        groupingRanges: [
          { path: ['SAO_PAULO', 'MEI'], min: '100', max: '200' },
          // Só Sul › MEI tem buraco (120 -> 150).
          { path: ['SUL', 'MEI'], min: '150', max: '240' },
        ],
      },
    ];
    render(<GroupingHarness initialDomains={withHole} initialGrouping={REGIONAL_PORTE} />);
    expect(screen.getAllByText(/não são contíguas em "SUL › MEI"/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/em "SAO_PAULO › MEI"/)).not.toBeInTheDocument();
  });

  it('editar o mínimo de um caminho não toca o mesmo domínio nos outros caminhos', () => {
    render(<GroupingHarness initialDomains={GROUPED_CONTIGUOUS} initialGrouping={REGIONAL_PORTE} />);
    fireEvent.change(screen.getByLabelText('Mínimo de R2 em SAO_PAULO › MEI'), {
      target: { value: '150' },
    });
    expect(screen.getByLabelText('Mínimo de R2 em SAO_PAULO › MEI')).toHaveValue('150');
    expect(screen.getByLabelText('Mínimo de R2 em SUL › MEI')).toHaveValue('120');
  });

  it('banner de combinação incompleta aparece, nomeia o domínio faltante e não bloqueia salvar', () => {
    const asymmetric: Domain[] = [
      {
        code: 'R1',
        label: 'R1',
        position: 0,
        groupingRanges: [
          { path: ['SAO_PAULO', 'MEI'], min: '0', max: '99' },
          { path: ['SAO_PAULO', 'NAO_MEI'], min: '0', max: '120' },
        ],
      },
      // R2 só existe em São Paulo › MEI.
      {
        code: 'R2',
        label: 'R2',
        position: 1,
        groupingRanges: [{ path: ['SAO_PAULO', 'MEI'], min: '100', max: '200' }],
      },
    ];
    render(<GroupingHarness initialDomains={asymmetric} initialGrouping={REGIONAL_PORTE} />);

    const banner = screen.getByTestId('incomplete-grouping-banner');
    expect(banner).toHaveTextContent('SAO_PAULO › NAO_MEI');
    expect(banner).toHaveTextContent('R2');
    // Não é erro de validação: nada em vermelho no topo bloqueando o salvamento.
    expect(validateDomains('RANGE', asymmetric, REGIONAL_PORTE).ok).toBe(true);
  });

  it('colar uma tabela com colunas de agrupamento configura tudo sozinha', async () => {
    const user = userEvent.setup();
    render(<GroupingHarness initialDomains={[]} initialGrouping={undefined} />);

    expect(screen.queryByText('Faixas por combinação')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Colar tabela' }));
    const textarea = screen.getByLabelText('Tabela de domínios colada');
    const table = [
      'Regional\tPorte\tDomínio\tMínimo\tMáximo',
      'São Paulo\tMEI\tR1\t0\t357',
      'São Paulo\tMEI\tR2\t357\t420',
      'São Paulo\tNão MEI\tR1\t0\t340',
      'Sul\tMEI\tR1\t0\t360',
    ].join('\n');
    fireEvent.change(textarea, { target: { value: table } });
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(screen.queryByLabelText('Tabela de domínios colada')).not.toBeInTheDocument();

    // Dois níveis detectados, sem nenhuma configuração manual prévia.
    expect(screen.getAllByTestId('grouping-dimension-row')).toHaveLength(2);
    expect(
      screen.getAllByLabelText('Nome do agrupamento').map((el) => (el as HTMLInputElement).value),
    ).toEqual(['Regional', 'Porte']);
    expect(
      screen.getAllByLabelText('Código do agrupamento').map((el) => (el as HTMLInputElement).value),
    ).toEqual(['REGIONAL', 'PORTE']);

    // Três caminhos, só as combinações que a tabela trouxe.
    expect(
      screen.getAllByTestId('grouping-path-group').map((group) => group.getAttribute('data-path')),
    ).toEqual(['SAO_PAULO|MEI', 'SAO_PAULO|NAO_MEI', 'SUL|MEI']);
    expect(screen.getByLabelText('Mínimo de R1 em SUL › MEI')).toHaveValue('0');
  });

  it('oferece o modelo com agrupamentos para download só em RANGE', async () => {
    const user = userEvent.setup();
    render(<GroupingHarness initialDomains={[]} initialGrouping={undefined} />);
    await user.click(screen.getByRole('button', { name: 'Colar tabela' }));
    expect(
      screen.getByRole('button', { name: /Baixar modelo com agrupamentos/ }),
    ).toBeInTheDocument();
  });

  it('remover o último nível volta ao modo simples e limpa as faixas agrupadas', async () => {
    const user = userEvent.setup();
    render(
      <GroupingHarness
        initialDomains={GROUPED_CONTIGUOUS}
        initialGrouping={[REGIONAL_PORTE[0]!]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Remover agrupamento "REGIONAL"/ }));
    // Remover apaga faixas: passa por confirmação (docs/07 §11).
    await user.click(screen.getByRole('button', { name: 'Remover agrupamento', exact: true }));

    expect(screen.queryByText('Faixas por combinação')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Mínimo')).toHaveLength(2);
  });

  it('adiciona um nível vazio manualmente e a versão entra no modo agrupado com faixas em branco', async () => {
    const user = userEvent.setup();
    render(<GroupingHarness initialDomains={CONTIGUOUS} initialGrouping={undefined} />);

    // Antes: modo simples, com mín/máx por domínio.
    expect(screen.getAllByLabelText('Mínimo')).toHaveLength(2);
    expect(screen.getByText(/Nenhum agrupamento ainda/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Adicionar agrupamento/ }));

    // O interruptor é binário: as faixas do modo simples são descartadas.
    expect(screen.queryByLabelText('Mínimo')).not.toBeInTheDocument();
    expect(screen.getByText('Faixas por combinação')).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma combinação ainda/)).toBeInTheDocument();
  });
});

/**
 * Colagem genérica (sem agrupamento), continuidade automática de
 * faixas e paletas de cor — docs/07-ux-e-editor.md §11, docs/05 §5.6.2/§5.6.4.
 */
function GenericHarness({
  type,
  initial,
  withAdvancedOptions = false,
}: {
  type: VariableType;
  initial: Domain[];
  /** Só quando true o pai passa `boundaryMode`/`onBoundaryModeChange` — expõe "Opções avançadas". */
  withAdvancedOptions?: boolean;
}) {
  const [domains, setDomains] = useState<Domain[]>(initial);
  const [boundaryMode, setBoundaryMode] = useState<BoundaryMode | undefined>(undefined);
  const validation = useMemo(
    () => validateDomains(type, domains, undefined, boundaryMode),
    [type, domains, boundaryMode],
  );
  const issues = validation.ok ? [] : validation.issues;
  return (
    <DomainsEditor
      type={type}
      domains={domains}
      onChange={setDomains}
      issues={issues}
      {...(withAdvancedOptions ? { boundaryMode, onBoundaryModeChange: setBoundaryMode } : {})}
    />
  );
}

describe('DomainsEditor — colagem genérica sem agrupamento (docs/05 §5.6.2)', () => {
  it('colar tabela simples (Domínio, Cor) fora do modo regional preenche o editor', async () => {
    const user = userEvent.setup();
    render(<GenericHarness type="CATEGORICAL" initial={[]} />);

    await user.click(screen.getByRole('button', { name: 'Colar tabela' }));
    const textarea = screen.getByLabelText('Tabela de domínios colada');
    const table = ['Domínio\tCor', 'SIM\t#16A34A', 'NAO\t#DC2626'].join('\n');
    fireEvent.change(textarea, { target: { value: table } });
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(screen.queryByLabelText('Tabela de domínios colada')).not.toBeInTheDocument();
    const codes = screen.getAllByLabelText('Código').map((el) => (el as HTMLInputElement).value);
    expect(codes).toEqual(['SIM', 'NAO']);
  });

  it('colar com erro de formato mostra a lista de erros sem fechar a caixa', async () => {
    const user = userEvent.setup();
    render(<GenericHarness type="CATEGORICAL" initial={[]} />);

    await user.click(screen.getByRole('button', { name: 'Colar tabela' }));
    const textarea = screen.getByLabelText('Tabela de domínios colada');
    fireEvent.change(textarea, { target: { value: ['Cor', 'vermelho'].join('\n') } });
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(screen.getByLabelText('Tabela de domínios colada')).toBeInTheDocument();
    expect(screen.getByText(/sem a coluna "Domínio"/)).toBeInTheDocument();
  });

  it('recolar Domínio+Cor sobre uma variável RANGE existente preserva mínimo/máximo', async () => {
    const user = userEvent.setup();
    const initial: Domain[] = [{ code: 'R1', label: 'R1', position: 0, rangeMin: '0', rangeMax: '100' }];
    render(<GenericHarness type="RANGE" initial={initial} />);

    await user.click(screen.getByRole('button', { name: 'Colar tabela' }));
    const textarea = screen.getByLabelText('Tabela de domínios colada');
    fireEvent.change(textarea, { target: { value: ['Domínio\tCor', 'R1\t#FF0000'].join('\n') } });
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(screen.getByLabelText('Mínimo')).toHaveValue('0');
    expect(screen.getByLabelText('Máximo')).toHaveValue('100');
  });
});

describe('DomainsEditor — continuidade automática e opções avançadas (docs/07 §11)', () => {
  it('por padrão não mostra os checkboxes de inclusão manual', () => {
    render(<GenericHarness type="RANGE" initial={CONTIGUOUS} withAdvancedOptions />);
    expect(screen.queryByText('mín. inclusivo')).not.toBeInTheDocument();
    expect(screen.queryByText('máx. inclusivo')).not.toBeInTheDocument();
  });

  it('alternar "Opções avançadas" e o controle de inclusão manual reexibe os checkboxes', async () => {
    const user = userEvent.setup();
    render(<GenericHarness type="RANGE" initial={CONTIGUOUS} withAdvancedOptions />);

    await user.click(screen.getByRole('button', { name: /Opções avançadas/ }));
    expect(screen.queryByText('mín. inclusivo')).not.toBeInTheDocument();

    // A inclusão manual por faixa só existe dentro de HALF_OPEN — em
    // INCLUSIVE_INTEGER (o default) todas as faixas seguem [mín, máx] igual.
    await user.click(screen.getByRole('checkbox', { name: /Faixas decimais\/meio-abertas/ }));
    await user.click(screen.getByRole('checkbox', { name: /inclusão manualmente por faixa/ }));
    expect(screen.getAllByText('mín. inclusivo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('máx. inclusivo').length).toBeGreaterThan(0);
  });
});

describe('DomainsEditor — paletas de cor (docs/05 §5.6.4)', () => {
  it('aplicar paleta atualiza as cores visíveis', async () => {
    const user = userEvent.setup();
    const initial: Domain[] = [
      { code: 'R1', label: 'R1', position: 0, rangeMin: '0', rangeMax: '100' },
      { code: 'R2', label: 'R2', position: 1, rangeMin: '100', rangeMax: '200' },
    ];
    render(<GenericHarness type="RANGE" initial={initial} />);

    await user.selectOptions(screen.getByLabelText('Aplicar paleta'), 'RISCO_R01_R20');

    const colorInputs = screen.getAllByLabelText('Cor');
    expect((colorInputs[0] as HTMLInputElement).value).toBe('#00ff2a');
    expect((colorInputs[1] as HTMLInputElement).value).toBe('#24ff48');
    expect(screen.getByText(/2 de 2 domínio\(s\) coloridos/)).toBeInTheDocument();
  });

  it('reaplicar a mesma paleta sobre domínios já coloridos por ela continua contando como acerto', async () => {
    const user = userEvent.setup();
    const initial: Domain[] = [
      { code: 'R1', label: 'R1', position: 0, rangeMin: '0', rangeMax: '100' },
      { code: 'R2', label: 'R2', position: 1, rangeMin: '100', rangeMax: '200' },
    ];
    render(<GenericHarness type="RANGE" initial={initial} />);

    const select = screen.getByLabelText('Aplicar paleta');
    await user.selectOptions(select, 'RISCO_R01_R20');
    expect(screen.getByText(/2 de 2 domínio\(s\) coloridos/)).toBeInTheDocument();

    // Reaplicar não muda nenhuma cor (já estavam certas) — "bateram" ainda é 2, não 0.
    await user.selectOptions(select, 'RISCO_R01_R20');
    expect(screen.getByText(/2 de 2 domínio\(s\) coloridos/)).toBeInTheDocument();
  });
});
