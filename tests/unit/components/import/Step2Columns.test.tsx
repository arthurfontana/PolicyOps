// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ImportWizard } from '@/components/import/ImportWizard';
import { createSampleDocument } from '@/core/document/create';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useImportStore.getState().reset();
});

function projectId(): string {
  return useDocumentStore.getState().document!.projects[0]!.id;
}

/** Abre o assistente já no passo 2, com a tabela informada carregada. */
async function renderAtStep2(rows: string[][], header: string[]) {
  useDocumentStore.getState().openDocument(createSampleDocument());
  useDocumentStore.getState().setActor('Teste');
  useImportStore.setState({
    step: 2,
    parsed: { format: { delimiter: ';', headerRow: 1, hasBom: false, trimValues: true }, header, rows, lines: rows.map((_, i) => i + 2), warnings: [], errors: [] },
    profile: {
      ...useImportStore.getState().profile,
      signature: header,
      columns: header.map((column) => ({ column, role: 'IGNORE' as const })),
      projectId: projectId(),
      codeTemplate: 'MTZ_{CLUSTER}',
      nameTemplate: '{CLUSTER}',
    },
  });
  return render(
    <TooltipProvider>
      <ImportWizard />
    </TooltipProvider>,
  );
}

describe('Step2Columns — nível de eixo sem contiguidade bloqueia o avanço', () => {
  it('eixo Y no nível 1 sem nível 0 mapeado não deixa avançar', async () => {
    const user = userEvent.setup();
    await renderAtStep2(
      [
        ['G1', 'R01', 'X'],
        ['G2', 'R02', 'Y'],
      ],
      ['CLUSTER', 'SCORE', 'MODELO'],
    );

    await user.click(screen.getByLabelText('Papel de CLUSTER'));
    await user.click(screen.getByRole('option', { name: 'Partição' }));

    await user.click(screen.getByLabelText('Papel de SCORE'));
    await user.click(screen.getByRole('option', { name: 'Eixo X' }));
    await user.click(screen.getByLabelText('Variável de SCORE'));
    await user.click(screen.getByRole('option', { name: 'SCORE_HVI3' }));

    await user.click(screen.getByLabelText('Papel de MODELO'));
    await user.click(screen.getByRole('option', { name: 'Eixo Y' }));
    await user.click(screen.getByLabelText('Variável de MODELO'));
    await user.click(screen.getByRole('option', { name: 'RESTRITIVO' }));
    // Nível errado: 1, sem ninguém no nível 0 deste eixo.
    const level = screen.getByLabelText('Nível de MODELO');
    fireEvent.change(level, { target: { value: '1' } });

    expect(await screen.findByText(/eixo Y precisam ser contíguos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeDisabled();
  });
});

describe('Step2Columns — prévia de código destaca colisão', () => {
  it('duas chaves distintas gerando o mesmo código ficam destacadas', async () => {
    const user = userEvent.setup();
    await renderAtStep2(
      [
        ['G1', '15'],
        ['G2', '0'],
      ],
      ['CLUSTER', 'OFERTA'],
    );

    await user.click(screen.getByLabelText('Papel de CLUSTER'));
    await user.click(screen.getByRole('option', { name: 'Partição' }));
    await user.click(screen.getByLabelText('Papel de OFERTA'));
    await user.click(screen.getByRole('option', { name: 'Valor' }));

    // Template sem marcador nenhum: as duas chaves (G1 e G2) colidem no
    // mesmo código "MTZ_FIXO".
    const codeTemplate = screen.getByLabelText('Padrão de código');
    await user.clear(codeTemplate);
    await user.type(codeTemplate, 'MTZ_FIXO');

    const collided = await screen.findAllByText('MTZ_FIXO');
    expect(collided.length).toBeGreaterThan(0);
    const highlighted = collided.find((el) => el.className.includes('border-red-400'));
    expect(highlighted).toBeDefined();
  });
});
