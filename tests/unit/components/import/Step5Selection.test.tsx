// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { Step5Plan } from '@/components/import/Step5Plan';
import { Step6Apply } from '@/components/import/Step6Apply';
import type { PolicyOpsDocument } from '@/core/document/schema';
import type { ImportTable } from '@/core/import/parse-table';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';
import { useUiStore } from '@/store/ui-store';
import {
  cineminhaDocument,
  cineminhaProfile,
  excerptTable,
} from '../../core/import/fixtures';

/**
 * Passo 5 interativo e passo 6 — docs/12-carga-de-matrizes.md US-05, US-06,
 * §6.1. O documento é o do recorte real: 18 matrizes novas, todas aplicáveis.
 */

const profile = cineminhaProfile();
const table: ImportTable = excerptTable();

function setup(doc: PolicyOpsDocument = cineminhaDocument()) {
  useDocumentStore.getState().openDocument(doc);
  useDocumentStore.getState().setActor('Teste');
  useImportStore.setState({ profile, fileName: 'recorte.csv' });
}

function renderStep5() {
  return render(
    <TooltipProvider>
      <Step5Plan table={table} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  useDocumentStore.getState().closeDocument();
  useImportStore.getState().reset();
  useUiStore.setState({ importRunFilter: null, reviewedVersionIds: [] });
});

describe('Step5Plan — seleção', () => {
  it('tudo o que é aplicável começa marcado', async () => {
    setup();
    renderStep5();
    expect(await screen.findByTestId('plan-selected-count')).toHaveTextContent(
      '18 de 18 selecionadas',
    );
  });

  it('desmarcar uma matriz tira só ela da seleção', async () => {
    const user = userEvent.setup();
    setup();
    renderStep5();
    await user.click(await screen.findByTestId('plan-select-MTZ_G1_SEM_RISCO_DIGITAL'));
    expect(screen.getByTestId('plan-selected-count')).toHaveTextContent('17 de 18 selecionadas');
  });

  it('seleção em massa por estado desmarca e remarca todas as novas', async () => {
    const user = userEvent.setup();
    setup();
    renderStep5();
    await user.click(await screen.findByText('Desmarcar'));
    expect(screen.getByTestId('plan-selected-count')).toHaveTextContent('0 de 18 selecionadas');

    await user.click(screen.getByTestId('plan-select-all-NEW'));
    expect(screen.getByTestId('plan-selected-count')).toHaveTextContent('18 de 18 selecionadas');
  });

  it('a busca por código filtra a lista', async () => {
    const user = userEvent.setup();
    setup();
    renderStep5();
    await user.type(await screen.findByLabelText('Buscar por código'), 'URA');
    expect(screen.getAllByText(/MTZ_/)).toHaveLength(3);
  });

  it('"Ver diff" abre o CompareView dentro do assistente', async () => {
    const user = userEvent.setup();
    setup();
    renderStep5();
    const linhas = await screen.findAllByText('Ver diff');
    await user.click(linhas[0]!);
    expect(await screen.findByTestId('plan-diff-panel')).toBeInTheDocument();
    // O CompareView traz os seus modos de visualização (docs/07 §9).
    expect(screen.getByText('Sobreposto')).toBeInTheDocument();
  });
});

describe('Step6Apply', () => {
  function renderStep6() {
    return render(
      <TooltipProvider>
        <Step6Apply table={table} />
        <Toaster />
      </TooltipProvider>,
    );
  }

  it('com seleção vazia, o botão de aplicar fica desabilitado', async () => {
    setup();
    useImportStore.getState().setSelectedKeys([]);
    useImportStore.getState().setNotes('Carga de teste do recorte');
    renderStep6();
    expect(await screen.findByTestId('apply-import')).toBeDisabled();
    expect(screen.getByTestId('apply-summary')).toHaveTextContent('Nenhuma alteração a aplicar.');
  });

  it('com nota curta demais, o botão de aplicar fica desabilitado', async () => {
    setup();
    useImportStore.getState().setNotes('curta');
    renderStep6();
    expect(await screen.findByTestId('apply-import')).toBeDisabled();
  });

  it('o resumo diz em números o que vai acontecer e que nada é publicado', async () => {
    setup();
    useImportStore.getState().setNotes('Carga de teste do recorte');
    renderStep6();
    expect(await screen.findByTestId('apply-summary')).toHaveTextContent(
      'cria 18 matrizes. Não publica nada.',
    );
  });
});
