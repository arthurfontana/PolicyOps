// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DefaultForUnlisted, Domain } from '@/core/document/schema';
import { CompatibilityMapEditor } from '@/components/library/CompatibilityMapEditor';

/**
 * Harness idêntico ao fio real de `CompatibilityDetail`: estado local de
 * `allow`/`defaultForUnlisted` alimentando o editor — marcar/desmarcar
 * precisa atualizar o contador e o preview de tuplas na hora, sem recarregar
 * (critério de aceite da S07).
 */
function Harness() {
  const [allow, setAllow] = useState<Record<string, string[]>>({});
  const [defaultForUnlisted, setDefaultForUnlisted] = useState<DefaultForUnlisted>('NONE');
  return (
    <CompatibilityMapEditor
      ruleId="rule-1"
      ruleCode="SEG_X_FAT"
      parentVariableId="var-parent"
      childVariableId="var-child"
      compatibilityVersionId="version-1"
      parentLabel="Segmento"
      childLabel="Faturamento"
      parentDomains={PARENT_DOMAINS}
      childDomains={CHILD_DOMAINS}
      allow={allow}
      defaultForUnlisted={defaultForUnlisted}
      onChange={(next) => {
        setAllow(next.allow);
        setDefaultForUnlisted(next.defaultForUnlisted);
      }}
    />
  );
}

const PARENT_DOMAINS: Domain[] = [
  { code: 'VAREJO', label: 'Varejo', position: 0 },
  { code: 'ATACADO', label: 'Atacado', position: 1 },
];

const CHILD_DOMAINS: Domain[] = [
  { code: 'BAIXO', label: 'Baixo', position: 0 },
  { code: 'ALTO', label: 'Alto', position: 1 },
];

describe('CompatibilityMapEditor — marcar/desmarcar atualiza contador e preview na hora', () => {
  it('parte de 0 de 4 combinações válidas com o mapa vazio e defaultForUnlisted NONE', () => {
    render(<Harness />);
    expect(screen.getByText('0 de 4 combinações válidas')).toBeInTheDocument();
    expect(screen.getByText('Preview do eixo resultante — 0 tupla(s)')).toBeInTheDocument();
  });

  it('marcar uma caixa atualiza o contador geral, o contador de linha/coluna e o preview', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Varejo → Baixo' }));

    expect(screen.getByText('1 de 4 combinações válidas')).toBeInTheDocument();
    expect(screen.getByText('Preview do eixo resultante — 1 tupla(s)')).toBeInTheDocument();
    expect(screen.getByText('Varejo → Baixo')).toBeInTheDocument();
  });

  it('desmarcar uma caixa já marcada devolve o contador e some do preview', () => {
    render(<Harness />);
    const checkbox = screen.getByRole('checkbox', { name: 'Varejo → Baixo' });
    fireEvent.click(checkbox);
    expect(screen.getByText('1 de 4 combinações válidas')).toBeInTheDocument();

    fireEvent.click(checkbox);
    expect(screen.getByText('0 de 4 combinações válidas')).toBeInTheDocument();
    expect(screen.getByText('Preview do eixo resultante — 0 tupla(s)')).toBeInTheDocument();
  });

  it('"todos" na linha marca as duas colunas daquela linha', () => {
    render(<Harness />);
    const varejoRow = screen.getByRole('row', { name: /^Varejo/ });
    fireEvent.click(within(varejoRow).getByRole('button', { name: 'todos' }));
    expect(screen.getByRole('checkbox', { name: 'Varejo → Baixo' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Varejo → Alto' })).toBeChecked();
    expect(screen.getByText('2 de 4 combinações válidas')).toBeInTheDocument();
  });
});
